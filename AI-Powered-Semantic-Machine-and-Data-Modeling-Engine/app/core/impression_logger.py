"""
ImpressionLogger — async MongoDB writer for match impressions and selections.

Implements DESIGN_DOC §H5, §D2, §D3.
Fire-and-forget: impression logging runs as an asyncio task (non-blocking).
Selection logging is awaited since it's smaller and user-initiated.
"""

import logging
import uuid
from datetime import datetime
from typing import Optional

logger = logging.getLogger(__name__)


class ImpressionLogger:

    _instance: Optional["ImpressionLogger"] = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    async def log_impression(
        self,
        db,
        query_id: str,
        lost_raw: str,
        category: str,
        session_id: str,
        shown_results: list[dict],
        model_version: str,
    ) -> Optional[str]:
        """
        Insert a MatchImpressions document.  (DESIGN_DOC §D2)

        Args:
            db:            Motor database (or None — skips logging)
            query_id:      UUID for this search session
            lost_raw:      User's original raw description
            category:      Category selected by user
            session_id:    Optional session/user token
            shown_results: top-K candidates (each has found_id, score, features)
            model_version: "rule_based_v1" or "lgbm_vXXX"

        Returns:
            impression_id string, or None if db unavailable
        """
        if db is None:
            return None

        impression_id = str(uuid.uuid4())

        doc = {
            "impression_id": impression_id,
            "query_id": query_id,
            "lost_item_raw": lost_raw[:1000],  # cap to avoid oversized docs
            "category": category,
            "session_id": session_id or "anonymous",
            "timestamp": datetime.utcnow(),
            "shown_results": [
                {
                    "rank": i + 1,
                    "found_id": r.get("found_id", ""),
                    "score": r.get("score", 0.0),
                    "score_breakdown": {
                        k: v
                        for k, v in (r.get("features") or {}).items()
                        if not k.startswith("_")  # exclude private _id_penalty
                    },
                    "model_version": r.get("model_version", model_version),
                }
                for i, r in enumerate(shown_results)
            ],
        }

        try:
            import asyncio
            asyncio.create_task(db.match_impressions.insert_one(doc))
        except RuntimeError:
            # No running event loop (e.g. tests) — insert synchronously
            try:
                await db.match_impressions.insert_one(doc)
            except Exception as e:
                logger.error(f"Impression log insert failed: {e}")

        return impression_id

    async def log_selection(
        self,
        db,
        impression_id: str,
        query_id: str,
        lost_raw: str,
        selected_found_id: str,
        selected_rank: int,
    ) -> bool:
        """
        Insert a MatchSelections document.  (DESIGN_DOC §D3)
        Called when user clicks / selects an item from the ranked list.

        Args:
            db:                Motor database (or None — skips logging)
            impression_id:     Reference to the impression this belongs to
            query_id:          UUID for the search session
            lost_raw:          User's original raw description (denormalized)
            selected_found_id: found_id the user selected
            selected_rank:     Rank position (1-indexed) of the selected item

        Returns:
            True if logged successfully, False otherwise
        """
        if db is None:
            logger.warning("log_selection: no DB — skipping")
            return False

        doc = {
            "selection_id": str(uuid.uuid4()),
            "impression_id": impression_id,
            "query_id": query_id,
            "lost_item_raw": lost_raw[:1000],
            "selected_found_id": selected_found_id,
            "selected_rank": selected_rank,
            "timestamp": datetime.utcnow(),
        }

        try:
            await db.match_selections.insert_one(doc)
            logger.debug(f"Selection logged: impression={impression_id}, found={selected_found_id}")
            return True
        except Exception as e:
            logger.error(f"Selection log insert failed: {e}")
            return False
