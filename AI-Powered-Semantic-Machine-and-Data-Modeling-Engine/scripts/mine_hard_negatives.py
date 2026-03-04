#!/usr/bin/env python3
"""
Hard Negative Mining Script
============================

Mines hard negatives from MongoDB logs to generate challenging training pairs.

Strategy:
  1. **Verification failures**: Pairs where user selected an item but verification
     failed (verified=False). These are the hardest negatives — model ranked them
     high enough for the user to try, but they were wrong.
  2. **High-rank rejects**: From impressions, take top-ranked items that the user
     did NOT select. These were ranked highly by the model but the user knew better.
  3. **Cross-category confusions**: Items from different categories that the model
     scored highly — indicates embedding space confusion.

Output:
  Saves hard negatives as JSON to data/raw/hard_negatives.json for training pipeline.

Usage:
  python scripts/mine_hard_negatives.py
"""

import asyncio
import json
import logging
import os
import sys
from datetime import datetime

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.database import get_database

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


async def mine_verification_failures(db) -> list[dict]:
    """
    Mine pairs where verification failed: user thought it matched but it didn't.
    These are the most valuable hard negatives.
    """
    failures = await db.handover_verifications.find({"verified": False}).to_list(length=None)
    logger.info(f"Found {len(failures)} verification failures")

    pairs = []
    for f in failures:
        lost_id = f.get("lost_id", "")
        found_id = f.get("found_id", "")
        if not lost_id or not found_id:
            continue

        # Get the original impression to retrieve the lost description
        impression = await db.match_impressions.find_one({"query_id": lost_id})
        if not impression:
            # Try finding via selection
            selection = await db.match_selections.find_one({"selected_found_id": found_id})
            if selection:
                impression = await db.match_impressions.find_one(
                    {"impression_id": selection.get("impression_id")}
                )

        lost_text = impression.get("lost_item_raw", "") if impression else ""

        # Get the found item description
        found_doc = await db.found_items.find_one({"item_id": found_id})
        found_text = found_doc.get("description", "") if found_doc else ""

        if lost_text and found_text:
            pairs.append({
                "anchor": lost_text,
                "negative": found_text,
                "source": "verification_failure",
                "difficulty": "very_hard",
                "lost_id": lost_id,
                "found_id": found_id,
                "mined_at": datetime.utcnow().isoformat(),
            })

    logger.info(f"Mined {len(pairs)} verification failure pairs")
    return pairs


async def mine_high_rank_rejects(db, top_n: int = 5) -> list[dict]:
    """
    Mine items ranked in top-N that user did NOT select.
    Focus on impressions where a selection WAS made (so we know what the user wanted).
    """
    pipeline = [
        {"$lookup": {
            "from": "match_selections",
            "localField": "impression_id",
            "foreignField": "impression_id",
            "as": "selections",
        }},
        {"$match": {"selections": {"$ne": []}}},
        {"$unwind": "$selections"},
        {"$limit": 500},  # Cap for performance
    ]

    impressions = await db.match_impressions.aggregate(pipeline).to_list(length=None)
    logger.info(f"Processing {len(impressions)} impressions for high-rank rejects")

    pairs = []
    for imp in impressions:
        selected_id = imp["selections"].get("selected_found_id", "")
        lost_text = imp.get("lost_item_raw", "")
        if not lost_text or not selected_id:
            continue

        shown = imp.get("shown_results") or []
        for result in shown[:top_n]:
            found_id = result.get("found_id", "")
            if found_id == selected_id or not found_id:
                continue

            # Get found description
            found_doc = await db.found_items.find_one({"item_id": found_id})
            found_text = found_doc.get("description", "") if found_doc else ""

            if found_text:
                rank = result.get("rank", 99)
                pairs.append({
                    "anchor": lost_text,
                    "negative": found_text,
                    "source": "high_rank_reject",
                    "difficulty": "hard" if rank <= 3 else "medium",
                    "original_rank": rank,
                    "original_score": result.get("score", 0.0),
                    "mined_at": datetime.utcnow().isoformat(),
                })

    logger.info(f"Mined {len(pairs)} high-rank reject pairs")
    return pairs


async def mine_cross_category_confusions(db) -> list[dict]:
    """
    Mine cases where the system returned results from wrong categories.
    These help the model learn category boundaries.
    """
    pipeline = [
        {"$lookup": {
            "from": "match_selections",
            "localField": "impression_id",
            "foreignField": "impression_id",
            "as": "selections",
        }},
        {"$match": {"selections": {"$ne": []}}},
        {"$unwind": "$selections"},
        {"$limit": 300},
    ]

    impressions = await db.match_impressions.aggregate(pipeline).to_list(length=None)

    pairs = []
    for imp in impressions:
        selected_id = imp["selections"].get("selected_found_id", "")
        lost_text = imp.get("lost_item_raw", "")
        query_category = imp.get("category", "").lower()

        if not lost_text or not query_category:
            continue

        shown = imp.get("shown_results") or []
        for result in shown:
            found_id = result.get("found_id", "")
            result_category = result.get("category", "").lower()

            # Only interested in cross-category results
            if result_category == query_category or found_id == selected_id:
                continue

            found_doc = await db.found_items.find_one({"item_id": found_id})
            found_text = found_doc.get("description", "") if found_doc else ""

            if found_text:
                pairs.append({
                    "anchor": lost_text,
                    "negative": found_text,
                    "source": "cross_category",
                    "difficulty": "medium",
                    "query_category": query_category,
                    "found_category": result_category,
                    "mined_at": datetime.utcnow().isoformat(),
                })

    logger.info(f"Mined {len(pairs)} cross-category confusion pairs")
    return pairs


async def main():
    """Main mining pipeline."""
    logger.info("=" * 60)
    logger.info("Hard Negative Mining — Starting")
    logger.info("=" * 60)

    db = get_database()
    if db is None:
        logger.error("Database not available. Set MONGODB_URL in .env")
        return

    # Mine from all three sources
    ver_failures = await mine_verification_failures(db)
    high_rank = await mine_high_rank_rejects(db)
    cross_cat = await mine_cross_category_confusions(db)

    all_negatives = ver_failures + high_rank + cross_cat

    # Deduplicate by (anchor, negative) hash
    seen = set()
    unique = []
    for pair in all_negatives:
        key = (pair["anchor"][:100], pair["negative"][:100])
        if key not in seen:
            seen.add(key)
            unique.append(pair)

    logger.info(f"\nTotal hard negatives: {len(all_negatives)} → {len(unique)} unique")

    # Save to file
    output_dir = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "data", "raw"
    )
    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, "hard_negatives.json")

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(unique, f, indent=2, ensure_ascii=False)

    logger.info(f"Saved to: {output_path}")

    # Print summary
    by_source = {}
    by_difficulty = {}
    for p in unique:
        src = p.get("source", "unknown")
        diff = p.get("difficulty", "unknown")
        by_source[src] = by_source.get(src, 0) + 1
        by_difficulty[diff] = by_difficulty.get(diff, 0) + 1

    logger.info("\nBreakdown by source:")
    for s, c in sorted(by_source.items()):
        logger.info(f"  {s}: {c}")
    logger.info("\nBreakdown by difficulty:")
    for d, c in sorted(by_difficulty.items()):
        logger.info(f"  {d}: {c}")


if __name__ == "__main__":
    asyncio.run(main())
