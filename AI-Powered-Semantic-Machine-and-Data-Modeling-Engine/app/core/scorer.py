"""
Scoring Engine — Feature computation, rule-based scoring, LightGBM re-ranking.

Implements DESIGN_DOC §C2, §C3, §H3, §H4, §G3.

Components:
  - FeatureComputer:     computes feature vector for a (lost, found) pair
  - ReRanker:            applies rule-based formula OR LightGBM to rank candidates
  - apply_must_match_rule: DESIGN_DOC §C3 hard identifier matching logic
  - get_model_variant:    deterministic A/B routing per session
"""

import hashlib
import logging
import os
import pickle
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

# Feature columns in the exact order expected by LightGBM
FEATURE_COLUMNS = [
    "f_semantic_sim",
    "f_bm25_score_norm",
    "f_attr_color_match",
    "f_attr_brand_match",
    "f_attr_model_match",
    "f_attr_material_match",
    "f_identifier_match_ratio",
    "f_n_must_match_tokens",
    "f_identifier_in_found_text",
    "f_contradiction_score",
    "f_initial_rank",
    "f_candidate_pool_size",
    "f_query_n_tokens",
    "f_found_n_tokens",
    "f_query_missing_fields",
    "f_len_ratio",
    # --- NEW: Numeric/monetary matching features ---
    "f_numeric_match",         # overlap ratio of extracted numbers
    "f_money_amount_match",    # closeness of monetary values (0=far, 1=exact)
]

# ---------------------------------------------------------------------------
# Fuzzy string match helper
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Numeric value extraction + matching  (handles money amounts like "10000")
# ---------------------------------------------------------------------------

import re as _re

_MONEY_PATTERN = _re.compile(
    r'(?:rs\.?|lkr|usd|\$|rupees?)\s*[\d,]+(?:\.\d+)?'   # currency prefix
    r'|[\d,]+(?:\.\d+)?\s*(?:rs\.?|lkr|usd|rupees?)'      # currency suffix
    r'|\b\d[\d,]*(?:\.\d+)?\b',                             # plain numbers
    _re.IGNORECASE,
)

def _extract_numbers(text: str) -> list[float]:
    """Extract all numeric values from text, normalizing commas/currency."""
    if not text:
        return []
    nums = []
    for m in _MONEY_PATTERN.finditer(text):
        raw = _re.sub(r'[^\d.]', '', m.group())
        try:
            val = float(raw)
            if val > 0:
                nums.append(val)
        except (ValueError, OverflowError):
            continue
    return sorted(set(nums))

def _numeric_overlap(lost_nums: list[float], found_nums: list[float]) -> float:
    """Fraction of lost numbers that appear in found numbers (exact match)."""
    if not lost_nums:
        return -1.0  # N/A — no numbers to compare
    if not found_nums:
        return 0.0
    matched = sum(1 for n in lost_nums if n in found_nums)
    return round(matched / len(lost_nums), 4)

def _money_proximity(lost_nums: list[float], found_nums: list[float]) -> float:
    """
    Best-case closeness between monetary amounts.
    Returns 1.0 for exact match, decreasing toward 0.0 for distant values.
    Returns -1.0 (N/A) when either side has no numbers.
    """
    if not lost_nums or not found_nums:
        return -1.0
    # Find best pair proximity
    best = 0.0
    for lv in lost_nums:
        for fv in found_nums:
            if lv == fv:
                return 1.0  # exact
            max_val = max(abs(lv), abs(fv), 1.0)
            proximity = 1.0 - min(abs(lv - fv) / max_val, 1.0)
            best = max(best, proximity)
    return round(best, 4)

# ---------------------------------------------------------------------------
# Fuzzy string match helper
# ---------------------------------------------------------------------------

def _fuzzy_match(a: Optional[str], b: Optional[str]) -> float:
    """
    Returns 0.0-1.0 fuzzy similarity using thefuzz.ratio.
    Returns 0.0 if either value is None/empty.
    """
    if not a or not b:
        return 0.0
    try:
        from thefuzz import fuzz
        return fuzz.ratio(str(a).lower(), str(b).lower()) / 100.0
    except ImportError:
        # Fallback: simple case-insensitive equality
        return 1.0 if str(a).lower() == str(b).lower() else 0.0

# ---------------------------------------------------------------------------
# Attribute-level scorer  (DESIGN_DOC §C2 — Attribute Match Score)
# ---------------------------------------------------------------------------

def attribute_score(lost_attrs: dict, found_attrs: dict) -> float:
    """
    Compare attribute dicts. Returns score in [0.0, 1.0].
    Weights: color=0.30, brand=0.30, model=0.25, material=0.15.
    Partial credit (0.3×) when found value is unknown.
    Neutral (0.5) when no attributes to compare.
    """
    weights = {"color": 0.30, "brand": 0.30, "model": 0.25, "material": 0.15}
    total_weight = 0.0
    matched_weight = 0.0

    la = lost_attrs.get("attributes") or {}
    fa = found_attrs.get("attributes") or {}

    for attr, w in weights.items():
        lost_val = la.get(attr)
        found_val = fa.get(attr)

        if lost_val is None:
            continue  # user didn't mention → skip

        total_weight += w

        if found_val is None:
            matched_weight += w * 0.3  # partial credit: unknown found
        else:
            sim = _fuzzy_match(str(lost_val), str(found_val))
            if sim >= 0.85:
                matched_weight += w           # strong match
            elif sim >= 0.60:
                matched_weight += w * 0.5     # partial match
            # else: mismatch → 0 contribution

    if total_weight == 0.0:
        return 0.5  # no attributes to compare → neutral

    return round(matched_weight / total_weight, 4)

def _per_attr_score(lost_attrs: dict, found_attrs: dict, attr: str) -> float:
    """
    Returns individual attribute match: -1 (N/A), 0 (mismatch), 0.5 (partial), 1.0 (match).
    """
    la = lost_attrs.get("attributes") or {}
    fa = found_attrs.get("attributes") or {}
    lost_val = la.get(attr)
    found_val = fa.get(attr)

    if lost_val is None or found_val is None:
        return -1.0  # N/A: not comparable

    sim = _fuzzy_match(str(lost_val), str(found_val))
    if sim >= 0.85:
        return 1.0
    elif sim >= 0.60:
        return 0.5
    else:
        return 0.0

# ---------------------------------------------------------------------------
# Identifier bonus/penalty  (DESIGN_DOC §C2 — Identifier Bonus/Penalty)
# ---------------------------------------------------------------------------

def identifier_score(lost_attrs: dict, found_attrs: dict) -> tuple[float, float]:
    """
    Returns (bonus, penalty).
    bonus in [0, 1], penalty in [0, 1].
    """
    must_match = lost_attrs.get("must_match_tokens") or []
    fa = found_attrs.get("attributes") or {}
    found_identifiers = [i.get("value", "") for i in (fa.get("identifiers") or [])]
    # Also check searchable_tokens if available
    searchable = found_attrs.get("searchable_tokens") or []
    found_text = " ".join(found_identifiers + searchable).lower()

    if not must_match:
        return 0.0, 0.0

    try:
        from thefuzz import fuzz
        def _token_match(token: str) -> bool:
            t = token.lower().strip()
            if not t:
                return False
            if t in found_text:
                return True
            # fuzzy token check
            for chunk in found_text.split():
                if fuzz.ratio(t, chunk) > 90:
                    return True
            return False
    except ImportError:
        def _token_match(token: str) -> bool:
            return token.lower() in found_text

    matched = sum(1 for t in must_match if _token_match(t))
    match_ratio = matched / len(must_match)

    if match_ratio == 1.0:
        return 1.0, 0.0            # all matched → full bonus
    elif match_ratio > 0:
        return round(match_ratio * 0.5, 4), 0.0
    else:
        return 0.0, 0.50           # none matched → hard penalty (DESIGN_DOC §C2)

# ---------------------------------------------------------------------------
# Contradiction penalty  (DESIGN_DOC §C2)
# ---------------------------------------------------------------------------

def contradiction_penalty(lost_attrs: dict, found_attrs: dict) -> float:
    """
    Returns penalty value in [0.0, 0.5].
    Triggered when attributes clearly contradict each other.
    """
    la = lost_attrs.get("attributes") or {}
    fa = found_attrs.get("attributes") or {}
    penalty = 0.0

    if la.get("color") and fa.get("color"):
        if _fuzzy_match(la["color"], fa["color"]) < 0.40:
            penalty += 0.15

    if la.get("brand") and fa.get("brand"):
        if _fuzzy_match(la["brand"], fa["brand"]) < 0.40:
            penalty += 0.20

    if la.get("model") and fa.get("model"):
        if _fuzzy_match(la["model"], fa["model"]) < 0.40:
            penalty += 0.10

    return round(min(penalty, 0.50), 4)

# ---------------------------------------------------------------------------
# Final score formula  (DESIGN_DOC §C2 — Final Assembly)
# ---------------------------------------------------------------------------

def compute_final_score(
    semantic: float,
    keyword: float,
    attr: float,
    id_bonus: float,
    id_penalty: float,
    contradiction: float,
    numeric_match: float = -1.0,
    money_match: float = -1.0,
) -> float:
    """
    Rule-based final score in [0.0, 1.0].
    Base weights: semantic=0.40, keyword=0.20, attribute=0.25, identifier=0.15.
    When numeric values exist, they contribute an additive bonus up to +0.10.
    """
    score = (
        0.40 * semantic +
        0.20 * keyword +
        0.25 * attr +
        0.15 * id_bonus
    )
    # --- NEW: Numeric bonus (only when values exist, i.e. >= 0) ---
    num_bonus = 0.0
    if numeric_match >= 0:
        num_bonus += 0.05 * numeric_match
    if money_match >= 0:
        num_bonus += 0.05 * money_match
    score += num_bonus

    score = max(0.0, score - id_penalty - contradiction)
    return round(min(1.0, score), 4)

# ---------------------------------------------------------------------------
# Feature computer  (DESIGN_DOC §H3)
# ---------------------------------------------------------------------------

def compute_features(lost_attrs: dict, found_item: dict) -> dict:
    """
    Compute feature vector for a (lost_attrs, found_item) pair.

    Args:
        lost_attrs:  Normalized lost description dict (from LostTextNormalizer)
        found_item:  Candidate dict including extracted_attributes_json and scores

    Returns:
        Feature dict (keys = FEATURE_COLUMNS + private _id_penalty key)
    """
    found_attrs = found_item.get("extracted_attributes_json") or {}

    # Semantic similarity: already in found_item["vector_score"] from FAISS (raw cosine [-1,1])
    # Normalize to [0,1]
    raw_cosine = float(found_item.get("vector_score", 0.0))
    sem = max(0.0, min(1.0, (raw_cosine + 1.0) / 2.0))

    # BM25 / keyword score: normalize found_item["bm25_score"] to [0,1]
    raw_bm25 = float(found_item.get("bm25_score", 0.0))
    # Simple hard-cap normalization at 20 (MongoDB textScore rarely exceeds this)
    kw = min(1.0, raw_bm25 / 20.0)

    id_bonus, id_penalty = identifier_score(lost_attrs, found_attrs)
    contradiction = contradiction_penalty(lost_attrs, found_attrs)

    # --- NEW: Extract numeric / monetary values from both sides ---
    lost_text = (lost_attrs.get("clean_description") or "")
    found_text_desc = found_item.get("description", "")
    lost_nums = _extract_numbers(lost_text)
    found_nums = _extract_numbers(found_text_desc)

    return {
        "f_semantic_sim":            round(sem, 4),
        "f_bm25_score_norm":         round(kw, 4),
        "f_attr_color_match":        _per_attr_score(lost_attrs, found_attrs, "color"),
        "f_attr_brand_match":        _per_attr_score(lost_attrs, found_attrs, "brand"),
        "f_attr_model_match":        _per_attr_score(lost_attrs, found_attrs, "model"),
        "f_attr_material_match":     _per_attr_score(lost_attrs, found_attrs, "material"),
        "f_identifier_match_ratio":  id_bonus,
        "f_n_must_match_tokens":     len(lost_attrs.get("must_match_tokens") or []),
        "f_identifier_in_found_text": 1 if id_bonus > 0 else 0,
        "f_contradiction_score":     contradiction,
        "f_initial_rank":            0,  # filled by score_and_rank_candidates
        "f_candidate_pool_size":     0,  # filled by score_and_rank_candidates
        "f_query_n_tokens":          len((lost_attrs.get("keywords") or [])),
        "f_found_n_tokens":          len(found_item.get("description", "").split()),
        "f_query_missing_fields":    len(lost_attrs.get("missing_fields") or []),
        "f_len_ratio": (
            len((lost_attrs.get("clean_description") or "").split()) /
            max(1, len(found_item.get("description", "").split()))
        ),
        # --- NEW: Numeric/monetary features ---
        "f_numeric_match":      _numeric_overlap(lost_nums, found_nums),
        "f_money_amount_match": _money_proximity(lost_nums, found_nums),
        # Private key used by rule-based scorer (not a feature column)
        "_id_penalty": id_penalty,
    }

# ---------------------------------------------------------------------------
# Must-match hard rule  (DESIGN_DOC §C3)
# ---------------------------------------------------------------------------

def apply_must_match_rule(candidates: list[dict], lost_attrs: dict) -> list[dict]:
    """
    If must_match_tokens are present:
      - Candidates where ALL tokens match get score boosted by +0.30 and sorted first.
      - Candidates where NO tokens match get identifier penalty already applied in features.
    Returns re-sorted list: forced-top candidates first, then remaining.
    """
    must = lost_attrs.get("must_match_tokens") or []
    if not must:
        return sorted(candidates, key=lambda c: c.get("score", 0.0), reverse=True)

    try:
        from thefuzz import fuzz
        def _match(token: str, text: str) -> bool:
            return token.lower() in text.lower() or fuzz.ratio(token.lower(), text.lower()[:100]) > 90
    except ImportError:
        def _match(token: str, text: str) -> bool:
            return token.lower() in text.lower()

    forced_top = []
    normal = []

    for c in candidates:
        found_attrs = c.get("extracted_attributes_json") or {}
        fa = found_attrs.get("attributes") or {}
        id_vals = [i.get("value", "") for i in (fa.get("identifiers") or [])]
        searchable = found_attrs.get("searchable_tokens") or []
        found_text = " ".join(id_vals + searchable + [c.get("description", "")])

        all_matched = all(_match(m, found_text) for m in must)
        if all_matched:
            c["score"] = round(min(1.0, c.get("score", 0.0) + 0.30), 4)
            forced_top.append(c)
        else:
            normal.append(c)

    forced_top.sort(key=lambda x: x.get("score", 0.0), reverse=True)
    normal.sort(key=lambda x: x.get("score", 0.0), reverse=True)
    return forced_top + normal

# ---------------------------------------------------------------------------
# A/B routing  (DESIGN_DOC §G3)
# ---------------------------------------------------------------------------

def get_model_variant(session_id: str, rollout_pct: float = 0.0) -> str:
    """
    Deterministic, sticky A/B assignment per session_id.
    rollout_pct=0.0 → 100% rule-based. rollout_pct=1.0 → 100% ML.
    """
    h = int(hashlib.sha256(session_id.encode()).hexdigest(), 16)
    if (h % 100) < int(rollout_pct * 100):
        return "lgbm"
    return "rule_based_v1"

# ---------------------------------------------------------------------------
# LightGBM model loader (lazy singleton)
# ---------------------------------------------------------------------------

_lgbm_model = None
_lgbm_model_version = "none"

def _load_lgbm_model():
    global _lgbm_model, _lgbm_model_version
    from app.config import settings
    ptr_path = settings.RERANKER_PTR_PATH
    if not os.path.exists(ptr_path):
        return None, "none"
    try:
        with open(ptr_path) as f:
            model_path = f.read().strip()
        if not os.path.exists(model_path):
            return None, "none"
        with open(model_path, "rb") as f:
            model = pickle.load(f)
        version = os.path.basename(model_path).replace(".pkl", "")
        logger.info(f"LightGBM re-ranker loaded: {version}")
        return model, version
    except Exception as e:
        logger.warning(f"LightGBM model load failed: {e}")
        return None, "none"

def get_lgbm_model():
    global _lgbm_model, _lgbm_model_version
    if _lgbm_model is None:
        _lgbm_model, _lgbm_model_version = _load_lgbm_model()
    return _lgbm_model, _lgbm_model_version

def reload_lgbm_model():
    """Force reload the LightGBM model (e.g., after retraining)."""
    global _lgbm_model, _lgbm_model_version
    _lgbm_model = None
    _lgbm_model_version = "none"
    return get_lgbm_model()

# ---------------------------------------------------------------------------
# Main ranking function  (DESIGN_DOC §H4)
# ---------------------------------------------------------------------------

def score_and_rank_candidates(
    lost_attrs: dict,
    candidates: list[dict],
    model_variant: str = "rule_based_v1",
) -> list[dict]:
    """
    Score and rank a candidate pool.

    Args:
        lost_attrs:     Normalized lost description (from normalizer)
        candidates:     List of candidate dicts, each must have "features" key
        model_variant:  "rule_based_v1" or "lgbm" (from get_model_variant)

    Returns:
        Sorted candidates list with "score" key set.
    """
    pool_size = len(candidates)

    # Fill positional features
    for i, c in enumerate(candidates):
        c["features"]["f_initial_rank"] = i + 1
        c["features"]["f_candidate_pool_size"] = pool_size

    lgbm_model, lgbm_version = get_lgbm_model()

    if model_variant == "lgbm" and lgbm_model is not None:
        # ---- ML re-ranking ----
        try:
            import pandas as pd
            X = pd.DataFrame(
                [c["features"] for c in candidates]
            )[FEATURE_COLUMNS]
            scores = lgbm_model.predict(X)
            for c, s in zip(candidates, scores):
                c["score"] = round(float(s), 4)
                c["model_version"] = lgbm_version
        except Exception as e:
            logger.warning(f"LightGBM inference failed, falling back to rule-based: {e}")
            model_variant = "rule_based_v1"

    if model_variant != "lgbm" or lgbm_model is None:
        # ---- Rule-based scoring ----
        for c in candidates:
            f = c["features"]
            # Weighted attribute sub-score
            attr_sub = 0.0
            attr_count = 0
            for attr_key, attr_weight in [
                ("f_attr_color_match", 0.30),
                ("f_attr_brand_match", 0.30),
                ("f_attr_model_match", 0.25),
                ("f_attr_material_match", 0.15),
            ]:
                v = f.get(attr_key, -1.0)
                if v >= 0:  # -1 means N/A
                    attr_sub += v * attr_weight
                    attr_count += attr_weight
            attr_score_val = (attr_sub / attr_count) if attr_count > 0 else 0.5

            c["score"] = compute_final_score(
                semantic=f["f_semantic_sim"],
                keyword=f["f_bm25_score_norm"],
                attr=attr_score_val,
                id_bonus=f["f_identifier_match_ratio"],
                id_penalty=f.get("_id_penalty", 0.0),
                contradiction=f["f_contradiction_score"],
                numeric_match=f.get("f_numeric_match", -1.0),
                money_match=f.get("f_money_amount_match", -1.0),
            )
            c["model_version"] = "rule_based_v1"

    # Apply must-match forced ranking (hard rule — always runs last)
    ranked = apply_must_match_rule(candidates, lost_attrs)
    return ranked

# ---------------------------------------------------------------------------
# End-to-end inference  (DESIGN_DOC §H8)
# ---------------------------------------------------------------------------

async def inference_rerank(
    db,
    raw_lost_text: str,
    category: str,
    session_id: str,
    top_k: int = 10,
) -> dict:
    """
    Full pipeline: normalize → retrieve → feature → rank → log impression.
    Returns top-K results and impression_id.
    """
    import uuid
    from app.config import settings
    from app.core.normalizer import LostTextNormalizer
    from app.core.retriever import CandidateRetriever
    from app.core.impression_logger import ImpressionLogger

    normalizer = LostTextNormalizer()
    retriever = CandidateRetriever()
    impression_logger = ImpressionLogger()

    # Step 1: Normalize
    lost_attrs = await normalizer.normalize_lost_description(db, raw_lost_text, category)
    query_id = str(uuid.uuid4())

    # Step 2: Retrieve candidates
    clean_text = lost_attrs.get("clean_description") or raw_lost_text
    candidates = await retriever.get_candidates(
        db=db,
        category=category,
        query_text=clean_text,
        must_match_tokens=lost_attrs.get("must_match_tokens") or [],
        keywords=lost_attrs.get("keywords") or [],
    )

    if not candidates:
        return {
            "query_id": query_id,
            "impression_id": None,
            "ranked_results": [],
        }

    # Step 3: Batch-fetch found item attributes from MongoDB
    found_ids = [c["found_id"] for c in candidates]
    attr_map: dict[str, dict] = {}
    if db is not None:
        try:
            cursor = db.found_items.find(
                {"item_id": {"$in": found_ids}},
                {"item_id": 1, "extracted_attributes_json": 1, "description": 1, "category": 1},
            )
            async for doc in cursor:
                attr_map[doc["item_id"]] = doc
        except Exception as e:
            logger.warning(f"Batch attribute fetch failed: {e}")

    for c in candidates:
        enriched = attr_map.get(c["found_id"], {})
        c["extracted_attributes_json"] = enriched.get("extracted_attributes_json") or {}
        if not c.get("description") and enriched.get("description"):
            c["description"] = enriched["description"]

    # Step 4: Compute features
    for c in candidates:
        c["features"] = compute_features(lost_attrs, c)

    # Step 5: A/B variant + rank
    model_variant = get_model_variant(session_id, rollout_pct=settings.AB_ROLLOUT_PCT)
    ranked = score_and_rank_candidates(lost_attrs, candidates, model_variant)
    top_results = ranked[:top_k]

    # Step 6: Log impression (async, non-blocking)
    model_ver = top_results[0].get("model_version", "rule_based_v1") if top_results else "rule_based_v1"
    impression_id = await impression_logger.log_impression(
        db=db,
        query_id=query_id,
        lost_raw=raw_lost_text,
        category=category,
        session_id=session_id,
        shown_results=top_results,
        model_version=model_ver,
    )

    return {
        "query_id": query_id,
        "impression_id": impression_id,
        "ranked_results": [
            {
                "rank": i + 1,
                "found_id": r["found_id"],
                "score": r["score"],
                "description": r.get("description", ""),
                "category": r.get("category", ""),
                "score_breakdown": {k: v for k, v in r.get("features", {}).items() if not k.startswith("_")},
                "model_version": r.get("model_version", "rule_based_v1"),
            }
            for i, r in enumerate(top_results)
        ],
    }
