#!/usr/bin/env python
"""
batch_extract_found_attributes.py
==================================
Offline batch job: runs Gemini attribute extraction on all found_items that
do NOT yet have `extracted_attributes_json`, then writes results back to MongoDB.

Usage:
    cd AI-Powered-Semantic-Machine-and-Data-Modeling-Engine
    python scripts/batch_extract_found_attributes.py

Rate limit: ~2 req/s (Gemini free tier). Adjust RATE_LIMIT_RPS for paid tier.

Run periodically (e.g., nightly cron) or after bulk item imports.
"""

import asyncio
import logging
import os
import sys
import time

# Ensure project root is on path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config import settings
from app.core.database import connect_to_mongo, get_database, close_mongo_connection
from app.core.normalizer import LostTextNormalizer

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# Requests per second (stay below Gemini rate limit)
RATE_LIMIT_RPS = float(os.getenv("BATCH_RATE_LIMIT_RPS", "2.0"))
BATCH_SIZE = int(os.getenv("BATCH_EXTRACT_BATCH_SIZE", "50"))


async def run_batch_extraction():
    if not settings.GEMINI_API_KEY:
        logger.warning(
            "GEMINI_API_KEY is not set. Extraction will use passthrough fallback "
            "(basic tokenization). Set GEMINI_API_KEY for real attribute extraction."
        )

    # Connect to MongoDB
    ok = await connect_to_mongo()
    if not ok:
        logger.error("Cannot connect to MongoDB. Aborting.")
        sys.exit(1)

    db = get_database()
    normalizer = LostTextNormalizer()

    # Query items without extracted attributes
    cursor = db.found_items.find(
        {"extracted_attributes_json": {"$exists": False}},
        {"item_id": 1, "description": 1, "category": 1},
    )
    items = await cursor.to_list(length=None)

    logger.info(f"Items needing attribute extraction: {len(items)}")

    if not items:
        logger.info("All found items already have extracted attributes. Nothing to do.")
        await close_mongo_connection()
        return

    processed = 0
    errors = 0
    min_delay = 1.0 / RATE_LIMIT_RPS  # seconds between requests

    for item in items:
        item_id = item.get("item_id", str(item.get("_id", "")))
        description = item.get("description", "")
        category = item.get("category", "Unknown")

        if not description:
            continue

        t_start = time.monotonic()

        try:
            extracted = await normalizer.extract_found_attributes(
                db=db,
                raw_text=description,
                category=category,
            )

            # Build searchable_tokens list for MongoDB $text index
            attrs = extracted.get("attributes") or {}
            identifier_vals = [i.get("value", "") for i in (attrs.get("identifiers") or [])]
            search_tokens = list(set(
                extracted.get("keywords", []) +
                extracted.get("searchable_tokens", []) +
                identifier_vals
            ))

            await db.found_items.update_one(
                {"item_id": item_id},
                {"$set": {
                    "extracted_attributes_json": extracted,
                    "searchable_tokens": " ".join(search_tokens),  # for $text index
                    "attributes_extracted_at": __import__("datetime").datetime.utcnow(),
                }},
                upsert=False,
            )

            processed += 1
            logger.info(f"[{processed}/{len(items)}] Processed item_id={item_id}")

        except Exception as e:
            errors += 1
            logger.error(f"Failed for item_id={item_id}: {e}")

        # Rate limiting
        elapsed = time.monotonic() - t_start
        wait = max(0, min_delay - elapsed)
        if wait > 0:
            await asyncio.sleep(wait)

    logger.info(
        f"Batch extraction complete. Processed: {processed}, Errors: {errors}, "
        f"Total: {len(items)}"
    )

    await close_mongo_connection()


if __name__ == "__main__":
    asyncio.run(run_batch_extraction())
