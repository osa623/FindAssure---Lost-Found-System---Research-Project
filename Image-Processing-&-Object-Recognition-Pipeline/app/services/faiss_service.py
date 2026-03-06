import os
import json
import logging
import shutil
import threading
import numpy as np
import faiss
from typing import List, Dict, Any

# Configure logging
logger = logging.getLogger(__name__)

class FaissService:
    def __init__(self, dim: int, index_path: str, mapping_path: str):
        """
        Initialize the FAISS service.
        
        Args:
            dim: Dimension of the vectors (e.g., 128 for DINOv2 small).
            index_path: Path to save/load the FAISS index.
            mapping_path: Path to save/load the metadata mapping.
        """
        self.dim = dim
        self.index_path = index_path
        self.mapping_path = mapping_path
        self.lock = threading.Lock()
        
        self.index = None
        self.mapping: Dict[int, Dict[str, Any]] = {}

    def load_or_create(self) -> None:
        """
        Load the index and mapping from disk, or create them if they don't exist.
        Ensures the directory structure exists.
        """
        # Ensure data directory exists
        os.makedirs(os.path.dirname(self.index_path), exist_ok=True)
        os.makedirs(os.path.dirname(self.mapping_path), exist_ok=True)

        with self.lock:
            # Load Index
            if os.path.exists(self.index_path):
                try:
                    self.index = faiss.read_index(self.index_path)
                    logger.info(f"Loaded FAISS index from {self.index_path}")
                except Exception as e:
                    logger.error(f"Failed to load FAISS index: {e}")
                    raise
            else:
                logger.info(f"Creating new FAISS IndexFlatIP with dim={self.dim}")
                self.index = faiss.IndexFlatIP(self.dim)

            # Check dimension match
            if self.index.d != self.dim:
                raise ValueError(f"Index dimension mismatch: loaded {self.index.d}, expected {self.dim}")

            # Load Mapping
            if os.path.exists(self.mapping_path):
                try:
                    with open(self.mapping_path, 'r') as f:
                        # JSON keys are strings, convert back to int for internal mapping
                        raw_mapping = json.load(f)
                        self.mapping = {int(k): v for k, v in raw_mapping.items()}
                    logger.info(f"Loaded metadata mapping from {self.mapping_path} ({len(self.mapping)} entries)")
                except Exception as e:
                    logger.error(f"Failed to load mapping: {e}")
                    # If index exists but mapping fails, we might have a sync issue. 
                    # For now, raise.
                    raise
            else:
                self.mapping = {}
                
            # Verify consistency
            if self.index.ntotal != len(self.mapping):
                logger.error(
                    f"FAISS consistency mismatch: index has {self.index.ntotal} vectors but mapping has {len(self.mapping)} entries. "
                    "Backing up corrupt files and rebuilding from scratch."
                )
                # Backup corrupt files before resetting
                for src in (self.index_path, self.mapping_path):
                    if os.path.exists(src):
                        bak = src + ".bak"
                        try:
                            shutil.copy2(src, bak)
                            logger.info("Backed up %s -> %s", src, bak)
                        except OSError:
                            logger.warning("Failed to backup %s", src, exc_info=True)
                self.index = faiss.IndexFlatIP(self.dim)
                self.mapping = {}
                logger.info("FAISS index and mapping reset to empty.")

    def _normalize(self, vector: np.ndarray) -> np.ndarray:
        """Normalize vector to L2 unit length."""
        if vector.ndim == 1:
            vector = vector.reshape(1, -1)
        # Faiss expects float32
        vector = vector.astype(np.float32)
        faiss.normalize_L2(vector)
        return vector

    def add(self, vector: np.ndarray, metadata: dict) -> int:
        """
        Add a vector to the index.
        
        Args:
            vector: The embedding vector (will be normalized).
            metadata: dict containing item_id, embedding_id, view_index, etc.
            
        Returns:
            The internal FAISS ID assigned to this vector.
        """
        vec_normalized = self._normalize(vector)
        
        with self.lock:
            if self.index is None:
                raise RuntimeError("Index not initialized. Call load_or_create() first.")
            
            faiss_id = self.index.ntotal
            self.index.add(vec_normalized)
            self.mapping[faiss_id] = metadata
            
            return faiss_id

    def search(self, vector: np.ndarray, top_k: int = 5) -> List[Dict[str, Any]]:
        """
        Search for similar vectors.
        
        Args:
            vector: Query vector (will be normalized).
            top_k: Number of results to return.
            
        Returns:
            List of dicts containing score (cosine similarity) and metadata.
        """
        vec_normalized = self._normalize(vector)
        
        # Generally, it's safer to lock if there's concurrent writing.
        with self.lock:
            if self.index is None:
                 raise RuntimeError("Index not initialized. Call load_or_create() first.")
                 
            scores, ids = self.index.search(vec_normalized, top_k)
            
            results = []
            # scores and ids are 2D arrays (1, top_k)
            for score, idx in zip(scores[0], ids[0]):
                if idx == -1:
                    continue
                
                meta = self.mapping.get(int(idx))
                if meta:
                    # Copy meta to avoid external mutation affecting internal state or vice versa
                    entry = meta.copy()
                    entry['score'] = float(score)
                    entry['faiss_id'] = int(idx)
                    results.append(entry)
                    
            return results

    def pair_similarity(self, vec_a: np.ndarray, vec_b: np.ndarray) -> float:
        """
        Calculate cosine similarity between two vectors using FAISS.
        
        Args:
            vec_a: First vector.
            vec_b: Second vector.
            
        Returns:
            Cosine similarity score (-1.0 to 1.0).
        """
        # This operation is independent of the main index.
        vec_a_norm = self._normalize(vec_a)
        vec_b_norm = self._normalize(vec_b)
        
        # Use a temporary index for calculation
        temp_index = faiss.IndexFlatIP(self.dim)
        temp_index.add(vec_a_norm)
        scores, _ = temp_index.search(vec_b_norm, 1)
        
        return float(scores[0][0])

    def compute_similarity(self, vec_a: np.ndarray, vec_b: np.ndarray) -> float:
        """Backward-compatible alias for legacy callers."""
        return self.pair_similarity(vec_a, vec_b)

    def save(self) -> None:
        """Save index and mapping to disk atomically (write-then-rename)."""
        with self.lock:
            if self.index is None:
                return
                
            logger.info("Saving FAISS index and mapping to disk...")
            tmp_index = self.index_path + ".tmp"
            tmp_mapping = self.mapping_path + ".tmp"
            try:
                faiss.write_index(self.index, tmp_index)
                with open(tmp_mapping, 'w') as f:
                    json.dump(self.mapping, f, indent=2)
                # Atomic rename (on Windows this replaces if target exists in Python 3.3+)
                os.replace(tmp_index, self.index_path)
                os.replace(tmp_mapping, self.mapping_path)
                logger.info("Save complete.")
            except Exception:
                # Clean up temp files on failure
                for tmp in (tmp_index, tmp_mapping):
                    if os.path.exists(tmp):
                        try:
                            os.remove(tmp)
                        except OSError:
                            pass
                raise
