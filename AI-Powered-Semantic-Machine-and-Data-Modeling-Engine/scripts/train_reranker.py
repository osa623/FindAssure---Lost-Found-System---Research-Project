#!/usr/bin/env python
"""
train_reranker.py
==================
Standalone script to build a training dataset from MongoDB and train the
LightGBM lambdarank re-ranking model.

Usage:
    cd AI-Powered-Semantic-Machine-and-Data-Modeling-Engine
    python scripts/train_reranker.py [--days 30]

Flags:
    --days     INT   Number of days of data to include (default: all available)
    --dry-run        Fetch and print dataset stats, but skip training

Prerequisites:
    - MongoDB must be reachable (MONGODB_URL in .env)
    - At least MIN_TRAIN_POSITIVES verified handover pairs
    - pip install lightgbm pandas numpy
"""

import argparse
import asyncio
import logging
import os
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config import settings
from app.core.database import connect_to_mongo, get_database, close_mongo_connection
from app.core.trainer import build_training_dataset, train_reranker_model
from app.core.scorer import reload_lgbm_model

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


async def run_training(days: int = None, dry_run: bool = False):
    logger.info("=" * 60)
    logger.info(" FindAssure Re-Ranker Training Script")
    logger.info("=" * 60)

    # Connect
    ok = await connect_to_mongo()
    if not ok:
        logger.error("Cannot connect to MongoDB. Aborting.")
        sys.exit(1)

    db = get_database()

    min_date = None
    if days:
        min_date = datetime.utcnow() - timedelta(days=days)
        logger.info(f"Window: last {days} days (since {min_date.isoformat()})")

    # Build dataset
    logger.info("Building training dataset...")
    df = await build_training_dataset(db, min_date=min_date)

    if df.empty:
        logger.warning("Dataset is empty. Check that match_impressions and match_selections have data.")
        await close_mongo_connection()
        sys.exit(1)

    # Print stats
    n_pos = (df["label"] == 1).sum()
    n_neg = (df["label"] == 0).sum()
    n_train = (df["split"] == "train").sum()
    n_val = (df["split"] == "val").sum()

    logger.info(f"Dataset stats:")
    logger.info(f"  Total rows:  {len(df)}")
    logger.info(f"  Positives:   {n_pos}")
    logger.info(f"  Negatives:   {n_neg}")
    logger.info(f"  Train:       {n_train}")
    logger.info(f"  Val:         {n_val}")
    logger.info(f"  Queries:     {df['query_id'].nunique()}")

    if dry_run:
        logger.info("Dry run — skipping model training.")
        await close_mongo_connection()
        return

    if n_pos < settings.MIN_TRAIN_POSITIVES:
        logger.error(
            f"Insufficient positive pairs: {n_pos} < {settings.MIN_TRAIN_POSITIVES}. "
            "Cannot train. Collect more verified handovers first."
        )
        await close_mongo_connection()
        sys.exit(1)

    # Train
    logger.info("Training LightGBM lambdarank re-ranker...")
    try:
        model = train_reranker_model(df)
        logger.info("Training complete!")
    except Exception as e:
        logger.error(f"Training failed: {e}")
        await close_mongo_connection()
        sys.exit(1)

    # Reload model in scorer singleton
    loaded_model, version = reload_lgbm_model()
    if loaded_model is not None:
        logger.info(f"Re-ranker hot-reloaded into inference: {version}")
    else:
        logger.warning("Model not automatically reloaded in running server — restart server to apply.")

    logger.info("=" * 60)
    logger.info(f" Training done. Set AB_ROLLOUT_PCT > 0 in .env to enable ML re-ranking.")
    logger.info("=" * 60)

    await close_mongo_connection()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train LightGBM re-ranker for FindAssure")
    parser.add_argument("--days", type=int, default=None, help="Number of days of data to use")
    parser.add_argument("--dry-run", action="store_true", help="Print stats without training")
    args = parser.parse_args()

    asyncio.run(run_training(days=args.days, dry_run=args.dry_run))
