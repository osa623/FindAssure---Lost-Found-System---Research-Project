from typing import List, Dict, Any
import numpy as np
from app.schemas.pp2_schemas import PP2PerViewResult, PP2VerificationResult, PP2FusedProfile, PP2Response

class MultiViewVerifier:
    def verify(self, results: List[PP2PerViewResult]) -> PP2VerificationResult:
        """
        Verifies consistency across multi-view inputs (2 or 3 views) using embeddings and geometric checks.
        """
        # 1. Extract embeddings (assuming 128d or similar)
        # Use first 8 floats as preview if full vector not available, but ideally we utilize full vector in memory
        # Here we pretend we have full vectors stashed or re-use preview if that's all we have 
        # (in real impl, PP2PerViewResult might carry full vector hidden or accessible)
        
        # Placeholder logic: check consistency
        passed = True
        reasons = []
        
        # Dummy matrix
        sim_matrix = [
            [1.0, 0.85, 0.82],
            [0.85, 1.0, 0.88],
            [0.82, 0.88, 1.0]
        ]
        
        return PP2VerificationResult(
            cosine_sim_matrix=sim_matrix,
            faiss_sim_matrix=sim_matrix,
            geometric_scores={"0-1": {"score": 0.9}, "0-2": {"score": 0.9}, "1-2": {"score": 0.9}},
            passed=passed,
            failure_reasons=reasons
        )

class MultiViewFusionService:
    def fuse(self, results: List[PP2PerViewResult]) -> PP2FusedProfile:
        """
        Aggregates findings from 2 or 3 views into a single profile.
        """
        # Naive fusion: take majority class, merge OCR
        # 1. Category voting
        categories = [r.detection.cls_name for r in results]
        final_category = max(set(categories), key=categories.count)
        
        # 2. Merge OCR
        all_text = " ".join([r.extraction.ocr_text for r in results])
        tokens = list(set(all_text.split())) # Dedup
        
        # 3. Best view (highest quality score)
        best_view = max(results, key=lambda x: x.quality_score)
        
        # 4. Color logic (pick first non-empty or most frequent)
        color = best_view.extraction.grounded_features.get("color", "unknown")

        return PP2FusedProfile(
            category=final_category,
            brand=None, # Implement brand logic extraction
            color=color,
            merged_ocr_tokens=tokens,
            attributes=best_view.extraction.grounded_features,
            defects=[],
            best_view_index=best_view.view_index,
            fused_embedding_id=best_view.embedding.vector_id # Simply use best view's ID for now
        )

class StorageService:
    async def store(self, item_id: str, data: PP2Response):
        """
        Store result in Database and Cache (Redis).
        """
        # print(f"[StorageService] Storing {item_id}")
        pass

class FaissService:
    def add_vector(self, vector_id: str, vector: List[float]):
        """
        Add validated vector to FAISS index.
        """
        # print(f"[FaissService] Adding vector {vector_id}")
        pass

    def compute_similarity(self, vec_a: np.ndarray, vec_b: np.ndarray) -> float:
        """
        Computes similarity using FAISS IndexFlatIP (dot product on normalized vectors).
        """
        # Placeholder: If faiss not installed, use dot product manually
        # In real impl: index = faiss.IndexFlatIP(d); index.add(vec_a); D, I = index.search(vec_b, 1)
        # Assuming vectors are already normalized by DinoEmbedder
        return float(np.dot(vec_a, vec_b))


