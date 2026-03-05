"""
CandidateRetriever — Merges FAISS vector search + MongoDB $text keyword search
into a single deduplicated candidate pool per DESIGN_DOC §C1.
"""

import logging
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)


class CandidateRetriever:
    """
    Two-path retrieval:
      Path 1 (Vector): delegates to SemanticEngine.search() — FAISS cosine ANN
      Path 2 (Keyword): MongoDB $text search on `found_items` description + searchable_tokens
    Both results are merged and deduplicated by item_id.
    """

    _instance: Optional["CandidateRetriever"] = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    # ------------------------------------------------------------------
    # Path 1 — Vector (FAISS)
    # ------------------------------------------------------------------

    def get_vector_candidates(
        self,
        category: str,
        query_text: str,
        top_k: int = 200,
    ) -> list[dict]:
        """
        Use SemanticEngine to retrieve top-k semantically similar found items.

        Args:
            category:   Category filter string
            query_text: Clean description text (from normalizer) OR raw text
            top_k:      Maximum candidates from vector search

        Returns:
            list of dicts: {found_id, description, category, vector_score, source="vector"}
        """
        from app.core.semantic import SemanticEngine
        engine = SemanticEngine()

        raw_results = engine.search(
            query_text=query_text,
            limit=top_k,
            category_filter=category if category else None,
        )

        candidates = []
        for res in raw_results:
            candidates.append({
                "found_id": res["item"]["id"],
                "description": res["item"].get("description", ""),
                "category": res["item"].get("category", ""),
                "vector_score": res.get("raw_cosine_similarity", 0.0),
                "bm25_score": 0.0,
                "source": "vector",
            })
        return candidates

    # ------------------------------------------------------------------
    # Path 2 — Keyword ($text search via MongoDB)
    # ------------------------------------------------------------------

    async def get_keyword_candidates(
        self,
        db,
        category: str,
        tokens: list[str],
        top_k: int = 50,
    ) -> list[dict]:
        """
        MongoDB full-text search using $text index on found_items.description + searchable_tokens.

        Args:
            db:       Motor database instance
            category: Category to restrict search
            tokens:   List of tokens (must_match_tokens + keywords from normalizer)
            top_k:    Maximum candidates from keyword search

        Returns:
            list of dicts: {found_id, description, category, vector_score, bm25_score, source="keyword"}
        """
        if db is None or not tokens:
            return []

        search_string = " ".join(tokens[:15])  # MongoDB $text caps work best with moderate strings

        try:
            query: dict = {
                "$text": {"$search": search_string},
            }
            if category:
                query["category"] = {"$regex": f"^{category}$", "$options": "i"}

            projection = {
                "item_id": 1,
                "description": 1,
                "category": 1,
                "score": {"$meta": "textScore"},
            }

            cursor = (
                db.found_items.find(query, projection)
                .sort([("score", {"$meta": "textScore"})])
                .limit(top_k)
            )
            docs = await cursor.to_list(length=None)

            candidates = []
            for doc in docs:
                candidates.append({
                    "found_id": doc.get("item_id", str(doc.get("_id", ""))),
                    "description": doc.get("description", ""),
                    "category": doc.get("category", ""),
                    "vector_score": 0.0,
                    "bm25_score": float(doc.get("score", 0.0)),
                    "source": "keyword",
                })
            return candidates

        except Exception as e:
            logger.warning(f"Keyword search failed: {e}")
            return []

    # ------------------------------------------------------------------
    # Merge + Deduplicate
    # ------------------------------------------------------------------

    async def get_candidates(
        self,
        db,
        category: str,
        query_text: str,
        must_match_tokens: list[str],
        keywords: list[str],
        top_vector: int = 200,
        top_keyword: int = 50,
    ) -> list[dict]:
        """
        Merge vector and keyword retrieval paths into a deduplicated pool.

        Vector candidates come first (higher priority for dedup).
        Keyword-only candidates are appended after.
        If a found_id appears in both paths, the entry from the keyword path
        provides its bm25_score to the already-added vector entry.

        Args:
            db:                 Motor database (or None)
            category:           Category filter
            query_text:         Text to embed for vector search
            must_match_tokens:  Identifiers from normalizer (e.g. serial, IMEI)
            keywords:           Semantic keywords from normalizer
            top_vector:         Max vector candidates
            top_keyword:        Max keyword candidates

        Returns:
            list of merged dicts (up to top_vector + top_keyword, deduplicated)
        """
        search_tokens = must_match_tokens + keywords[:5]

        # Run vector and keyword searches (keyword is async)
        vector_candidates = self.get_vector_candidates(
            category=category,
            query_text=query_text,
            top_k=top_vector,
        )
        keyword_candidates = await self.get_keyword_candidates(
            db=db,
            category=category,
            tokens=search_tokens,
            top_k=top_keyword,
        )

        # Merge: vector first (preserves ranking signal), then keyword-only additions
        seen_ids: dict[str, int] = {}  # found_id -> index in merged
        merged: list[dict] = []

        for c in vector_candidates:
            idx = len(merged)
            seen_ids[c["found_id"]] = idx
            merged.append(c)

        for c in keyword_candidates:
            fid = c["found_id"]
            if fid in seen_ids:
                # Enrich existing entry with bm25_score
                merged[seen_ids[fid]]["bm25_score"] = c["bm25_score"]
                merged[seen_ids[fid]]["source"] = "both"
            else:
                seen_ids[fid] = len(merged)
                merged.append(c)

        logger.info(
            f"Candidates: {len(vector_candidates)} vector + "
            f"{len(keyword_candidates)} keyword → {len(merged)} merged"
        )
        return merged
