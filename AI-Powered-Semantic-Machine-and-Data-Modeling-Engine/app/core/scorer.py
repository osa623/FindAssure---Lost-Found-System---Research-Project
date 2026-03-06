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
from bson import ObjectId
import logging
import math
import os
import pickle
from datetime import datetime, timezone
from typing import Optional

import numpy as np
from app.config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Cross-Encoder Re-Ranker  (lazy singleton)
# ---------------------------------------------------------------------------

_cross_encoder = None

def _load_cross_encoder():
    """Lazy-load a cross-encoder model for precise pairwise relevance scoring."""
    global _cross_encoder
    if _cross_encoder is not None:
        return _cross_encoder
    try:
        from sentence_transformers import CrossEncoder
        _cross_encoder = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2", max_length=256)
        logger.info("Cross-encoder loaded: ms-marco-MiniLM-L-6-v2")
    except Exception as e:
        logger.warning(f"Cross-encoder load failed (will skip feature): {e}")
        _cross_encoder = None
    return _cross_encoder

def cross_encoder_score(query_text: str, doc_text: str) -> float:
    """
    Return a [0,1] relevance score from the cross-encoder.
    Returns -1.0 (N/A) if model unavailable or inputs empty.
    """
    if not query_text or not doc_text:
        return -1.0
    ce = _load_cross_encoder()
    if ce is None:
        return -1.0
    try:
        raw = float(ce.predict([(query_text[:256], doc_text[:256])]))
        # ms-marco outputs logits; sigmoid → [0,1]
        score = 1.0 / (1.0 + math.exp(-raw))
        return round(score, 4)
    except Exception as e:
        logger.debug(f"Cross-encoder inference error: {e}")
        return -1.0

# ---------------------------------------------------------------------------
# Time-Decay Function  (72-hour half-life)
# ---------------------------------------------------------------------------

def time_decay_score(found_item: dict, half_life_hours: float = 72.0) -> float:
    """
    Exponential decay based on how old a found item is.
    Returns 1.0 for brand-new items, ~0.5 at half_life_hours, approaching 0 for very old items.
    Returns -1.0 if created_at is not available.
    """
    created = found_item.get("created_at")
    if created is None:
        return -1.0
    try:
        if isinstance(created, str):
            created = datetime.fromisoformat(created.replace("Z", "+00:00"))
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        age_hours = max(0.0, (now - created).total_seconds() / 3600.0)
        decay = math.exp(-0.693 * age_hours / half_life_hours)  # ln(2) ≈ 0.693
        return round(decay, 4)
    except Exception:
        return -1.0

# ---------------------------------------------------------------------------
# Synonym Dictionary  (Lost & Found domain)
# ---------------------------------------------------------------------------

SYNONYMS: dict[str, list[str]] = {
    # Electronics
    "phone": ["mobile", "cell", "cellphone", "smartphone", "handphone", "device"],
    "mobile": ["phone", "cell", "cellphone", "smartphone", "handphone"],
    "laptop": ["notebook", "computer", "macbook", "chromebook", "pc"],
    "computer": ["laptop", "notebook", "pc", "desktop"],
    "headphones": ["earphones", "earbuds", "headset", "airpods", "earpods"],
    "earphones": ["headphones", "earbuds", "headset", "airpods"],
    "charger": ["adapter", "charging cable", "power adapter", "power cable"],
    "cable": ["cord", "wire"],
    "usb": ["type-c", "micro-usb", "lightning"],
    "watch": ["wristwatch", "smartwatch", "timepiece"],
    "smartwatch": ["watch", "wristwatch", "apple watch", "fitbit"],
    "tablet": ["ipad", "tab", "slate"],
    "camera": ["dslr", "mirrorless", "gopro", "cam"],
    # Accessories
    "wallet": ["purse", "billfold", "pocketbook", "card holder"],
    "purse": ["wallet", "handbag", "clutch", "pouch"],
    "bag": ["backpack", "rucksack", "satchel", "tote", "sack"],
    "backpack": ["bag", "rucksack", "knapsack", "bookbag"],
    "umbrella": ["parasol", "brolly"],
    "glasses": ["spectacles", "eyeglasses", "eyewear", "specs"],
    "sunglasses": ["shades", "sunnies", "sun glasses"],
    "keys": ["key ring", "keychain", "key set", "key bunch"],
    "ring": ["band", "finger ring"],
    "necklace": ["chain", "pendant", "locket"],
    "bracelet": ["bangle", "wristband"],
    # Documents
    "id": ["identification", "id card", "identity card", "nic"],
    "license": ["licence", "driving license", "dl"],
    "passport": ["travel document"],
    "card": ["credit card", "debit card", "atm card", "bank card"],
    # Clothing
    "jacket": ["coat", "hoodie", "blazer", "windbreaker"],
    "coat": ["jacket", "overcoat", "parka"],
    "shoes": ["sneakers", "boots", "footwear", "trainers", "runners"],
    "sneakers": ["shoes", "trainers", "runners", "athletic shoes"],
    "cap": ["hat", "beanie", "baseball cap"],
    "hat": ["cap", "beanie", "headwear"],
    "scarf": ["muffler", "shawl", "wrap"],
    # Stationery
    "pen": ["ballpoint", "fountain pen", "marker", "writing instrument"],
    "notebook": ["notepad", "journal", "diary", "exercise book"],
    "calculator": ["calc", "scientific calculator", "graphing calculator"],
    # Containers
    "bottle": ["water bottle", "flask", "thermos", "tumbler", "container"],
    "flask": ["bottle", "thermos", "tumbler"],
    "lunchbox": ["tiffin", "food container", "lunch container", "bento"],
    # Colours (common misspellings + variants)
    "black": ["dark", "jet black", "ebony"],
    "white": ["ivory", "cream", "off-white"],
    "red": ["crimson", "scarlet", "maroon", "burgundy"],
    "blue": ["navy", "cobalt", "azure", "sky blue", "navy blue"],
    "green": ["olive", "emerald", "lime", "forest green"],
    "brown": ["tan", "chocolate", "chestnut", "khaki"],
    "grey": ["gray", "silver", "charcoal"],
    "gray": ["grey", "silver", "charcoal"],
    "pink": ["rose", "magenta", "fuchsia"],
    "gold": ["golden", "gilt"],
    "silver": ["grey", "gray", "metallic"],
}

def expand_with_synonyms(tokens: list[str]) -> set[str]:
    """Expand a list of keyword tokens with their synonyms."""
    expanded = set(t.lower() for t in tokens)
    for token in list(expanded):
        for syn in SYNONYMS.get(token, []):
            expanded.add(syn.lower())
    return expanded

def synonym_keyword_boost(query_tokens: list[str], found_tokens: list[str]) -> float:
    """
    Compute synonym-aware keyword overlap ratio.
    Returns fraction of query tokens (or their synonyms) found in the document.
    Returns -1.0 if no query tokens.
    """
    if not query_tokens:
        return -1.0
    q_expanded = expand_with_synonyms(query_tokens)
    f_set = set(t.lower() for t in found_tokens)
    if not f_set:
        return 0.0
    matched = len(q_expanded & f_set)
    return round(min(1.0, matched / max(1, len(query_tokens))), 4)

# ---------------------------------------------------------------------------
# Category-Specific Feature Weights
# ---------------------------------------------------------------------------

CATEGORY_FEATURE_WEIGHTS: dict[str, dict[str, float]] = {
    "electronics": {"color": 0.15, "brand": 0.35, "model": 0.35, "material": 0.15},
    "phone": {"color": 0.15, "brand": 0.35, "model": 0.35, "material": 0.15},
    "mobile": {"color": 0.15, "brand": 0.35, "model": 0.35, "material": 0.15},
    "laptop": {"color": 0.15, "brand": 0.35, "model": 0.35, "material": 0.15},
    "tablet": {"color": 0.15, "brand": 0.35, "model": 0.35, "material": 0.15},
    "camera": {"color": 0.10, "brand": 0.40, "model": 0.40, "material": 0.10},
    "wallet": {"color": 0.35, "brand": 0.20, "model": 0.10, "material": 0.35},
    "purse": {"color": 0.35, "brand": 0.20, "model": 0.10, "material": 0.35},
    "bag": {"color": 0.30, "brand": 0.25, "model": 0.15, "material": 0.30},
    "backpack": {"color": 0.30, "brand": 0.25, "model": 0.15, "material": 0.30},
    "clothing": {"color": 0.40, "brand": 0.25, "model": 0.10, "material": 0.25},
    "jacket": {"color": 0.35, "brand": 0.25, "model": 0.10, "material": 0.30},
    "shoes": {"color": 0.25, "brand": 0.35, "model": 0.25, "material": 0.15},
    "sneakers": {"color": 0.25, "brand": 0.35, "model": 0.25, "material": 0.15},
    "keys": {"color": 0.10, "brand": 0.15, "model": 0.10, "material": 0.65},
    "jewelry": {"color": 0.25, "brand": 0.20, "model": 0.15, "material": 0.40},
    "watch": {"color": 0.15, "brand": 0.35, "model": 0.35, "material": 0.15},
    "glasses": {"color": 0.30, "brand": 0.30, "model": 0.15, "material": 0.25},
    "sunglasses": {"color": 0.25, "brand": 0.35, "model": 0.15, "material": 0.25},
    "umbrella": {"color": 0.45, "brand": 0.15, "model": 0.10, "material": 0.30},
    "bottle": {"color": 0.35, "brand": 0.20, "model": 0.10, "material": 0.35},
    "headphones": {"color": 0.15, "brand": 0.35, "model": 0.35, "material": 0.15},
    "earphones": {"color": 0.15, "brand": 0.35, "model": 0.35, "material": 0.15},
    "document": {"color": 0.05, "brand": 0.05, "model": 0.05, "material": 0.85},
    "stationery": {"color": 0.25, "brand": 0.30, "model": 0.20, "material": 0.25},
    "pen": {"color": 0.25, "brand": 0.35, "model": 0.15, "material": 0.25},
    "calculator": {"color": 0.10, "brand": 0.40, "model": 0.40, "material": 0.10},
}

DEFAULT_ATTR_WEIGHTS = {"color": 0.30, "brand": 0.30, "model": 0.25, "material": 0.15}

def get_category_weights(category: str) -> dict[str, float]:
    """Return attribute weights for a given category, falling back to defaults."""
    if not category:
        return DEFAULT_ATTR_WEIGHTS
    cat_lower = category.lower().strip()
    # Try exact match first, then substring match
    if cat_lower in CATEGORY_FEATURE_WEIGHTS:
        return CATEGORY_FEATURE_WEIGHTS[cat_lower]
    for key, weights in CATEGORY_FEATURE_WEIGHTS.items():
        if key in cat_lower or cat_lower in key:
            return weights
    return DEFAULT_ATTR_WEIGHTS

# ---------------------------------------------------------------------------
# Confidence Calibration  (Platt scaling)
# ---------------------------------------------------------------------------

_calibrator = None
_calibrator_loaded = False

def _load_calibrator():
    """Load a pre-trained Platt scaling calibrator if available."""
    global _calibrator, _calibrator_loaded
    if _calibrator_loaded:
        return _calibrator
    _calibrator_loaded = True
    try:
        cal_path = os.path.join(settings.RERANKER_MODELS_DIR, "calibrator.pkl")
        if os.path.exists(cal_path):
            with open(cal_path, "rb") as f:
                _calibrator = pickle.load(f)
            logger.info(f"Calibrator loaded from {cal_path}")
        else:
            logger.debug("No calibrator file found — using raw scores")
    except Exception as e:
        logger.warning(f"Calibrator load failed: {e}")
    return _calibrator

def calibrate_score(raw_score: float) -> float:
    """
    Apply Platt scaling to convert raw model score → calibrated probability.
    Falls back to sigmoid mapping if no trained calibrator is available.
    """
    cal = _load_calibrator()
    if cal is not None:
        try:
            prob = float(cal.predict_proba([[raw_score]])[0, 1])
            return round(prob, 4)
        except Exception:
            pass
    # Fallback: simple sigmoid calibration centred at 0.5
    # Maps 0→~0.27, 0.5→0.5, 1.0→~0.73 — preserves ordering, compresses extremes
    return round(1.0 / (1.0 + math.exp(-4.0 * (raw_score - 0.5))), 4)

def train_calibrator(scores: list[float], labels: list[int]):
    """
    Train a Platt scaling calibrator from scored data + binary labels.
    Saves to disk for future use.
    """
    try:
        from sklearn.linear_model import LogisticRegression
        from app.config import settings

        X = np.array(scores).reshape(-1, 1)
        y = np.array(labels)
        cal = LogisticRegression(C=1.0, solver="lbfgs")
        cal.fit(X, y)

        os.makedirs(settings.RERANKER_MODELS_DIR, exist_ok=True)
        cal_path = os.path.join(settings.RERANKER_MODELS_DIR, "calibrator.pkl")
        with open(cal_path, "wb") as f:
            pickle.dump(cal, f)
        logger.info(f"Calibrator trained and saved to {cal_path}")

        global _calibrator, _calibrator_loaded
        _calibrator = cal
        _calibrator_loaded = True
        return cal
    except Exception as e:
        logger.error(f"Calibrator training failed: {e}")
        return None

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
    # --- Numeric/monetary matching features ---
    "f_numeric_match",         # overlap ratio of extracted numbers
    "f_money_amount_match",    # closeness of monetary values (0=far, 1=exact)
    # --- NEW: Accuracy improvement features ---
    "f_cross_encoder_score",   # pairwise relevance from cross-encoder [0,1]
    "f_time_decay",            # freshness score with 72h half-life [0,1]
    "f_synonym_keyword_boost", # synonym-aware keyword overlap [0,1]
    "f_category_weight_score", # category-tuned attribute sub-score [0,1]
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
    cross_enc: float = -1.0,
    time_decay: float = -1.0,
    syn_boost: float = -1.0,
    cat_weight: float = -1.0,
) -> float:
    """
    Rule-based final score in [0.0, 1.0].
    Base weights: semantic=0.35, keyword=0.15, attribute=0.20, identifier=0.10,
                  cross_encoder=0.10, synonym=0.05, category_attr=0.05.
    When available, new features contribute additive bonuses / adjustments.
    """
    # --- Base score with cross-encoder integration ---
    ce_component = 0.0
    if cross_enc >= 0:
        ce_component = 0.10 * cross_enc
        # Reduce semantic weight to make room
        score = (
            0.30 * semantic +
            0.15 * keyword +
            0.20 * attr +
            0.10 * id_bonus +
            ce_component
        )
    else:
        score = (
            0.40 * semantic +
            0.20 * keyword +
            0.25 * attr +
            0.15 * id_bonus
        )

    # --- Numeric bonus (only when values exist, i.e. >= 0) ---
    num_bonus = 0.0
    if numeric_match >= 0:
        num_bonus += 0.05 * numeric_match
    if money_match >= 0:
        num_bonus += 0.05 * money_match
    score += num_bonus

    # --- Synonym keyword boost (additive up to +0.05) ---
    if syn_boost >= 0:
        score += 0.05 * syn_boost

    # --- Category-weighted attribute score (replaces generic attr partially) ---
    if cat_weight >= 0:
        score += 0.05 * cat_weight

    # --- Time-decay (slight freshness bonus up to +0.03) ---
    if time_decay >= 0:
        score += 0.03 * time_decay

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

    # --- Extract numeric / monetary values from both sides ---
    lost_text = (lost_attrs.get("clean_description") or "")
    found_text_desc = found_item.get("description", "")
    lost_nums = _extract_numbers(lost_text)
    found_nums = _extract_numbers(found_text_desc)

    # --- NEW: Cross-encoder score (query vs found description) ---
    ce_score = cross_encoder_score(lost_text, found_text_desc)

    # --- NEW: Time-decay score ---
    td_score = time_decay_score(found_item)

    # --- NEW: Synonym-aware keyword boost ---
    query_keywords = lost_attrs.get("keywords") or []
    found_desc_tokens = found_text_desc.lower().split()
    syn_boost = synonym_keyword_boost(query_keywords, found_desc_tokens)

    # --- NEW: Category-weighted attribute sub-score ---
    category = found_item.get("category", "")
    cat_weights = get_category_weights(category)
    la = lost_attrs.get("attributes") or {}
    fa = found_attrs.get("attributes") or {}
    cat_total_w = 0.0
    cat_matched_w = 0.0
    for attr_name, w in cat_weights.items():
        lost_val = la.get(attr_name)
        found_val = fa.get(attr_name)
        if lost_val is None:
            continue
        cat_total_w += w
        if found_val is None:
            cat_matched_w += w * 0.3
        else:
            sim = _fuzzy_match(str(lost_val), str(found_val))
            if sim >= 0.85:
                cat_matched_w += w
            elif sim >= 0.60:
                cat_matched_w += w * 0.5
    cat_score = round(cat_matched_w / cat_total_w, 4) if cat_total_w > 0 else -1.0

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
        # --- Numeric/monetary features ---
        "f_numeric_match":           _numeric_overlap(lost_nums, found_nums),
        "f_money_amount_match":      _money_proximity(lost_nums, found_nums),
        # --- NEW: Accuracy improvement features ---
        "f_cross_encoder_score":     ce_score,
        "f_time_decay":              td_score,
        "f_synonym_keyword_boost":   syn_boost,
        "f_category_weight_score":   cat_score,
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
            # Weighted attribute sub-score (use category weights if available)
            attr_sub = 0.0
            attr_count = 0
            category = c.get("category", "")
            cat_w = get_category_weights(category)
            for attr_key, w_key in [
                ("f_attr_color_match", "color"),
                ("f_attr_brand_match", "brand"),
                ("f_attr_model_match", "model"),
                ("f_attr_material_match", "material"),
            ]:
                v = f.get(attr_key, -1.0)
                attr_weight = cat_w.get(w_key, 0.25)
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
                cross_enc=f.get("f_cross_encoder_score", -1.0),
                time_decay=f.get("f_time_decay", -1.0),
                syn_boost=f.get("f_synonym_keyword_boost", -1.0),
                cat_weight=f.get("f_category_weight_score", -1.0),
            )
            c["model_version"] = "rule_based_v2"

    # Apply must-match forced ranking (hard rule — always runs last)
    ranked = apply_must_match_rule(candidates, lost_attrs)

    # Apply confidence calibration to final scores
    for c in ranked:
        c["raw_score"] = c["score"]
        c["score"] = calibrate_score(c["score"])

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

    # Step 1b: Query expansion via Gemini (extra keywords boost recall)
    clean_text = lost_attrs.get("clean_description") or raw_lost_text
    try:
        expansion = await normalizer.expand_query(db, clean_text, category)
        extra_kw = expansion.get("extra_keywords") or []
        existing_kw = lost_attrs.get("keywords") or []
        # Merge extra keywords (deduplicated)
        merged_kw = list(dict.fromkeys(existing_kw + [k.lower() for k in extra_kw]))
        lost_attrs["keywords"] = merged_kw
        logger.info(f"Query expanded: +{len(extra_kw)} extra keywords → {len(merged_kw)} total")
    except Exception as qe_err:
        logger.debug(f"Query expansion skipped: {qe_err}")

    # Step 2: Retrieve candidates
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
            found_items_col = db[settings.FOUND_ITEMS_COLLECTION]
            object_ids = [ObjectId(fid) for fid in found_ids if ObjectId.is_valid(fid)]
            cursor = found_items_col.find(
                {
                    "$or": [
                        {"item_id": {"$in": found_ids}},
                        {"_id": {"$in": object_ids}},
                    ]
                },
                {"item_id": 1, "description": 1, "category": 1, "created_at": 1, "createdAt": 1, "extracted_attributes_json": 1},
            )
            async for doc in cursor:
                doc_id = str(doc.get("item_id") or doc.get("_id"))
                attr_map[doc_id] = doc
        except Exception as e:
            logger.warning(f"Batch attribute fetch failed: {e}")

    for c in candidates:
        enriched = attr_map.get(c["found_id"], {})
        c["extracted_attributes_json"] = enriched.get("extracted_attributes_json") or {}
        if not c.get("description") and enriched.get("description"):
            c["description"] = enriched["description"]
        # Carry created_at for time-decay feature
        created_at = enriched.get("created_at") or enriched.get("createdAt")
        if created_at:
            c["created_at"] = created_at

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
