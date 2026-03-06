"""
TrainingPipeline — builds labeled training datasets from MongoDB logs and
trains a LightGBM lambdarank re-ranker.

Implements DESIGN_DOC §E (Feedback-to-Training Dataset Builder) and §F (Model Training).

Workflow (run by scripts/train_reranker.py):
  1. build_training_dataset()  — joins impressions + selections + verifications
  2. train_reranker_model()    — LightGBM lambdarank, saves versioned model
"""

import logging
import os
import pickle
from datetime import datetime
from typing import Optional
from bson import ObjectId
from app.config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Feature columns — must match scorer.py FEATURE_COLUMNS exactly
# ---------------------------------------------------------------------------
from app.core.scorer import FEATURE_COLUMNS, compute_features


# ---------------------------------------------------------------------------
# Hard negative sampler  (DESIGN_DOC §E2 — Enhanced)
# ---------------------------------------------------------------------------

def sample_hard_negatives(impression: dict, positive_found_id: str, n_neg: int = 8) -> list[dict]:
    """
    From an impression, take the top-ranked items that are NOT the positive.
    These are hard negatives: current model ranked them highly but they were wrong.

    Enhanced strategy:
      - Prioritize items ranked ABOVE the positive (model put them higher → harder)
      - Then fill remaining slots from items ranked below

    Returns up to n_neg candidates (sorted closest-to-rank-1 first).
    """
    shown = impression.get("shown_results") or []
    negatives = [r for r in shown if r.get("found_id") != positive_found_id]

    # Find the rank of the positive item
    pos_rank = 999
    for r in shown:
        if r.get("found_id") == positive_found_id:
            pos_rank = r.get("rank", 999)
            break

    # Prioritize items ranked above positive (harder negatives)
    above_positive = [r for r in negatives if r.get("rank", 999) < pos_rank]
    below_positive = [r for r in negatives if r.get("rank", 999) >= pos_rank]

    above_positive.sort(key=lambda x: x.get("rank", 999))
    below_positive.sort(key=lambda x: x.get("rank", 999))

    # Merge: above first, then below
    prioritized = above_positive + below_positive
    return prioritized[:n_neg]


def load_mined_hard_negatives() -> list[dict]:
    """
    Load pre-mined hard negatives from scripts/mine_hard_negatives.py output.
    Returns list of {anchor, negative, source, difficulty} dicts.
    """
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    hn_path = os.path.join(base_dir, "data", "raw", "hard_negatives.json")
    if not os.path.exists(hn_path):
        return []
    try:
        import json
        with open(hn_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        logger.info(f"Loaded {len(data)} pre-mined hard negatives from {hn_path}")
        return data
    except Exception as e:
        logger.warning(f"Failed to load hard negatives: {e}")
        return []


# ---------------------------------------------------------------------------
# Dataset builder  (DESIGN_DOC §E, §H6)
# ---------------------------------------------------------------------------

async def build_training_dataset(
    db,
    min_date: Optional[datetime] = None,
    max_date: Optional[datetime] = None,
):
    """
    Joins match_impressions + match_selections + handover_verifications
    to produce a labeled DataFrame of (lost, found) pairs.

    Label strategy (DESIGN_DOC §E1):
      verified=True  + selected=True → label=1, weight=3.0  STRONG POSITIVE
      selected=True  + no verif       → label=1, weight=0.5  WEAK POSITIVE
      selected=True  + verified=False → SKIP
      shown but NOT selected          → label=0, weight=1.0  NEGATIVE
         (only when a strong positive exists in same impression)

    Args:
        db:       Motor database instance
        min_date: Optional start window for impressions
        max_date: Optional end window for impressions

    Returns:
        pd.DataFrame with FEATURE_COLUMNS + label, weight, query_id, split, timestamp
    """
    try:
        import pandas as pd
    except ImportError:
        raise RuntimeError("pandas is required for dataset building. Install it.")

    # Step 1: Build match filter
    match_filter: dict = {}
    if min_date:
        match_filter.setdefault("timestamp", {})["$gte"] = min_date
    if max_date:
        match_filter.setdefault("timestamp", {})["$lte"] = max_date

    # Step 2: Aggregate impressions with their selections
    pipeline = []
    if match_filter:
        pipeline.append({"$match": match_filter})
    pipeline += [
        {"$lookup": {
            "from": "match_selections",
            "localField": "impression_id",
            "foreignField": "impression_id",
            "as": "selection",
        }},
        {"$match": {"selection": {"$ne": []}}},  # only impressions WITH a selection
        {"$unwind": "$selection"},
    ]

    logger.info("Building training dataset — fetching impressions with selections...")
    impressions_with_selection = await db.match_impressions.aggregate(pipeline).to_list(length=None)
    logger.info(f"Found {len(impressions_with_selection)} impressions with selections")

    if not impressions_with_selection:
        return __import__("pandas").DataFrame()

    # Step 3: Build verification lookup (lost_id, found_id) → verified bool
    ver_docs = await db.handover_verifications.find().to_list(length=None)
    verifications: dict[tuple, dict] = {
        (str(v.get("lost_id", "")), str(v.get("found_id", ""))): v
        for v in ver_docs
    }
    logger.info(f"Loaded {len(verifications)} handover verification records")

    # Step 4: Pre-fetch found item attributes for all found_ids in impressions
    all_found_ids: set[str] = set()
    for imp in impressions_with_selection:
        for r in imp.get("shown_results") or []:
            all_found_ids.add(r.get("found_id", ""))
    all_found_ids.discard("")

    found_attr_map: dict[str, dict] = {}
    if all_found_ids:
        found_items_col = db[settings.FOUND_ITEMS_COLLECTION]
        found_ids_list = list(all_found_ids)
        object_ids = [ObjectId(fid) for fid in found_ids_list if ObjectId.is_valid(fid)]
        cursor = found_items_col.find(
            {
                "$or": [
                    {"item_id": {"$in": found_ids_list}},
                    {"_id": {"$in": object_ids}},
                ]
            },
            {"item_id": 1, "extracted_attributes_json": 1, "description": 1}
        )
        async for doc in cursor:
            doc_id = str(doc.get("item_id") or doc.get("_id"))
            found_attr_map[doc_id] = doc

    # Step 5: Build labeled rows
    rows = []
    skipped_no_ver = 0

    for imp in impressions_with_selection:
        sel = imp["selection"]
        pos_found_id = sel.get("selected_found_id", "")
        query_id = str(imp.get("query_id", ""))
        imp_timestamp = imp.get("timestamp", datetime.utcnow())

        # Reconstruct minimal lost_attrs from impression context
        lost_attrs = {
            "clean_description": imp.get("lost_item_raw", ""),
            "keywords": [],
            "must_match_tokens": [],
            "missing_fields": [],
            "attributes": {},
        }

        # Determine label + weight for the POSITIVE pair
        ver_key = (query_id, pos_found_id)
        ver = verifications.get(ver_key)

        if ver is not None and ver.get("verified"):
            pos_label, pos_weight = 1, 3.0    # STRONG positive
        elif ver is not None and not ver.get("verified"):
            skipped_no_ver += 1
            continue                           # verification failed → skip
        else:
            pos_label, pos_weight = 1, 0.5    # no verification → weak positive

        # Build found_item for positive
        pos_found_doc = found_attr_map.get(pos_found_id, {})
        pos_found_item = _build_found_item_from_impression(imp, pos_found_id, pos_found_doc)

        pos_features = compute_features(lost_attrs, pos_found_item)

        rows.append({
            "query_id": query_id,
            "found_id": pos_found_id,
            "label": pos_label,
            "weight": pos_weight,
            **{k: pos_features.get(k, 0.0) for k in FEATURE_COLUMNS},
            "timestamp": imp_timestamp,
        })

        # Hard negatives (only if we have a strong positive — DESIGN_DOC §E1 rule)
        negative_weight = 1.0 if pos_weight == 3.0 else 0.3
        neg_candidates = sample_hard_negatives(imp, pos_found_id, n_neg=8)

        for neg in neg_candidates:
            neg_found_id = neg.get("found_id", "")
            if not neg_found_id:
                continue
            neg_found_doc = found_attr_map.get(neg_found_id, {})
            neg_item = _build_found_item_from_impression(imp, neg_found_id, neg_found_doc)
            neg_features = compute_features(lost_attrs, neg_item)

            rows.append({
                "query_id": query_id,
                "found_id": neg_found_id,
                "label": 0,
                "weight": negative_weight,
                **{k: neg_features.get(k, 0.0) for k in FEATURE_COLUMNS},
                "timestamp": imp_timestamp,
            })

    logger.info(
        f"Dataset built: {len(rows)} rows total. "
        f"Skipped {skipped_no_ver} failed-verification impressions."
    )

    if not rows:
        return __import__("pandas").DataFrame()

    df = __import__("pandas").DataFrame(rows)

    # Step 6: Train/val split by query_id (no leakage) + time boundary (DESIGN_DOC §F5)
    import numpy as np
    unique_queries = df["query_id"].unique()
    rng = np.random.default_rng(seed=42)
    rng.shuffle(unique_queries)
    val_queries = set(unique_queries[:max(1, int(len(unique_queries) * 0.20))])

    # Enforce time cutoff: val set uses later 20% of time range
    if "timestamp" in df.columns and df["timestamp"].notna().any():
        cutoff = df["timestamp"].quantile(0.80)
        df["split"] = df.apply(
            lambda row: "val"
            if (row["query_id"] in val_queries and row["timestamp"] >= cutoff)
            else "train",
            axis=1
        )
    else:
        df["split"] = df["query_id"].apply(lambda q: "val" if q in val_queries else "train")

    # Leakage assertion
    assert set(df[df["split"] == "train"]["query_id"]).isdisjoint(
        set(df[df["split"] == "val"]["query_id"])
    ), "Leakage: query_id appears in both train and val!"

    logger.info(
        f"Split: {(df['split']=='train').sum()} train rows, {(df['split']=='val').sum()} val rows."
    )
    return df


def _build_found_item_from_impression(imp: dict, found_id: str, found_doc: dict) -> dict:
    """
    Build a minimal found_item dict from impression data + MongoDB document.
    Falls back to impression score_breakdown for feature reconstruction.
    """
    # Find score_breakdown from impression shown_results
    score_breakdown = {}
    vector_score = 0.0
    bm25_score = 0.0
    for r in imp.get("shown_results") or []:
        if r.get("found_id") == found_id:
            score_breakdown = r.get("score_breakdown") or {}
            vector_score = score_breakdown.get("f_semantic_sim", 0.0)
            bm25_score = score_breakdown.get("f_bm25_score_norm", 0.0)
            break

    return {
        "found_id": found_id,
        "description": found_doc.get("description", ""),
        "category": found_doc.get("category", ""),
        "vector_score": vector_score,   # already normalized [0,1]
        "bm25_score": bm25_score * 20,  # unnormalize back (scorer normalizes /20)
        "extracted_attributes_json": found_doc.get("extracted_attributes_json") or {},
    }


# ---------------------------------------------------------------------------
# Model trainer  (DESIGN_DOC §F3, §H7)
# ---------------------------------------------------------------------------

def train_reranker_model(df) -> object:
    """
    Train a LightGBM lambdarank re-ranker from a labeled DataFrame.

    Args:
        df: DataFrame from build_training_dataset() with FEATURE_COLUMNS + label + weight + split

    Returns:
        Trained lgb.Booster model, also saved to disk.

    Raises:
        ValueError: if insufficient positive training examples.
        ImportError: if lightgbm is not installed.
    """
    try:
        import lightgbm as lgb
    except ImportError:
        raise ImportError("lightgbm is required. Install with: pip install lightgbm")

    from app.config import settings

    n_positives = (df["label"] == 1).sum()
    if n_positives < settings.MIN_TRAIN_POSITIVES:
        raise ValueError(
            f"Insufficient data: only {n_positives} positive pairs. "
            f"Need >= {settings.MIN_TRAIN_POSITIVES}. Collect more verified handovers."
        )

    df_train = df[df["split"] == "train"].copy()
    df_val   = df[df["split"] == "val"].copy()

    # LightGBM lambdarank requires group sizes: number of candidates per query
    g_train = df_train.groupby("query_id", sort=False).size().values
    g_val   = df_val.groupby("query_id", sort=False).size().values

    X_train = df_train[FEATURE_COLUMNS].fillna(0)
    y_train = df_train["label"]
    w_train = df_train["weight"]

    X_val = df_val[FEATURE_COLUMNS].fillna(0)
    y_val = df_val["label"]

    train_ds = lgb.Dataset(X_train, label=y_train, weight=w_train, group=g_train)
    val_ds   = lgb.Dataset(X_val,   label=y_val,   group=g_val,   reference=train_ds)

    params = {
        "objective": "lambdarank",
        "metric": "ndcg",
        "ndcg_eval_at": [1, 3, 5],
        "learning_rate": 0.05,
        "num_leaves": 31,
        "min_data_in_leaf": 10,
        "feature_fraction": 0.8,
        "bagging_fraction": 0.8,
        "bagging_freq": 5,
        "lambdarank_truncation_level": 10,
        "verbose": -1,
    }

    model = lgb.train(
        params,
        train_ds,
        num_boost_round=500,
        valid_sets=[val_ds],
        callbacks=[lgb.early_stopping(50), lgb.log_evaluation(50)],
    )

    # Save versioned model
    os.makedirs(settings.RERANKER_MODELS_DIR, exist_ok=True)
    version_str = datetime.utcnow().strftime("%Y%m%d_%H%M")
    model_filename = f"lgbm_v{version_str}.pkl"
    model_path = os.path.join(settings.RERANKER_MODELS_DIR, model_filename)

    with open(model_path, "wb") as f:
        pickle.dump(model, f)

    # Update pointer to current model
    with open(settings.RERANKER_PTR_PATH, "w") as f:
        f.write(model_path)

    logger.info(f"Model saved: {model_path}")
    logger.info(f"Pointer updated: {settings.RERANKER_PTR_PATH}")

    # Print feature importance
    import_vals = model.feature_importance(importance_type="gain")
    feat_importance = sorted(
        zip(FEATURE_COLUMNS, import_vals),
        key=lambda x: x[1], reverse=True
    )
    logger.info("Feature importance (top 10):")
    for feat, imp in feat_importance[:10]:
        logger.info(f"  {feat}: {imp:.2f}")

    # --- NEW: Train confidence calibrator (Platt scaling) ---
    try:
        from app.core.scorer import train_calibrator
        import pandas as pd

        # Use the entire dataset to fit calibrator
        X_all = df[FEATURE_COLUMNS].fillna(0)
        raw_scores = model.predict(X_all)
        cal_labels = df["label"].values
        train_calibrator(list(raw_scores), list(cal_labels))
        logger.info("Confidence calibrator trained successfully")
    except Exception as cal_err:
        logger.warning(f"Calibrator training failed (non-critical): {cal_err}")

    return model
