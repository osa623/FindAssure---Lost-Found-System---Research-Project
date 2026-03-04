import faiss
import numpy as np
from sentence_transformers import SentenceTransformer, util
from app.config import settings
from app.core.database import get_database
import os
import pickle
from datetime import datetime
from typing import Optional, List, Dict
import re
from sklearn.metrics.pairwise import cosine_similarity

class SemanticEngine:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(SemanticEngine, cls).__new__(cls)
            cls._instance._initialize()
        return cls._instance

    def _initialize(self):
        print("Loading Semantic Model...")
        try:
            self.model = SentenceTransformer(settings.MODEL_PATH)
            print("Loaded Fine-Tuned Model")
        except Exception as e:
            print("Loading High-Performance Model...")
            # Using better model for improved accuracy
            # all-mpnet-base-v2 is one of the best models for semantic similarity
            # Falls back to all-MiniLM-L6-v2 if mpnet fails (faster, still good)
            try:
                self.model = SentenceTransformer('all-mpnet-base-v2')
                print("Loaded all-mpnet-base-v2 (High Accuracy)")
            except:
                self.model = SentenceTransformer('all-MiniLM-L6-v2')
                print("Loaded all-MiniLM-L6-v2 (Balanced)")

        # Get actual dimension from model
        self.dimension = self.model.get_sentence_embedding_dimension()
        print(f"Model dimension: {self.dimension}")

    def reload_model(self):
        """
        Hot-reload the sentence-transformer model from disk.
        Called after embedding fine-tuning completes, so the running server
        picks up the new model without a restart.
        """
        print("Reloading Semantic Model after fine-tuning...")
        try:
            new_model = SentenceTransformer(settings.MODEL_PATH)
            new_dim = new_model.get_sentence_embedding_dimension()
            if new_dim != self.dimension:
                print(f"WARNING: New model dimension {new_dim} differs from current {self.dimension}. Skipping reload.")
                return False
            self.model = new_model
            print(f"Model reloaded successfully (dim={self.dimension})")
            return True
        except Exception as e:
            print(f"Model reload failed: {e}")
            return False
        
        # Use Inner Product (IP) index for cosine similarity
        # Vectors will be normalized, so IP = cosine similarity
        if os.path.exists(settings.INDEX_PATH):
            try:
                print("Loading FAISS index from disk...")
                self.index = faiss.read_index(settings.INDEX_PATH)
                print("Index loaded successfully")
            except Exception as e:
                print("Creating fresh FAISS IndexFlatIP (cosine similarity)...")
                self.index = faiss.IndexFlatIP(self.dimension)  # Inner Product for cosine
                # Delete corrupted file
                try:
                    os.remove(settings.INDEX_PATH)
                except:
                    pass
        else:
            print("Initializing new FAISS IndexFlatIP (cosine similarity)...")
            self.index = faiss.IndexFlatIP(self.dimension)  # Better for semantic similarity
        
        # Load or create metadata
        if os.path.exists(settings.METADATA_PATH):
            try:
                print("Loading metadata from cache...")
                with open(settings.METADATA_PATH, 'rb') as f:
                    self.items_metadata = pickle.load(f)
                print(f"Loaded {len(self.items_metadata)} items from cache")
            except Exception as e:
                print("Starting with empty metadata")
                self.items_metadata = []
                # Delete corrupted file
                try:
                    os.remove(settings.METADATA_PATH)
                except:
                    pass
        else:
            self.items_metadata = []
            if len(self.items_metadata) == 0:
                print("Cache is empty - will load from MongoDB")
    
    def _save_to_disk(self):
        """Save FAISS index and metadata to disk"""
        try:
            # Ensure directory exists
            os.makedirs(os.path.dirname(settings.INDEX_PATH), exist_ok=True)
            
            # Save FAISS index
            faiss.write_index(self.index, settings.INDEX_PATH)
            
            # Save metadata
            with open(settings.METADATA_PATH, 'wb') as f:
                pickle.dump(self.items_metadata, f)
            
            print(f"Saved index and metadata ({len(self.items_metadata)} items)")
        except Exception as e:
            print(f"Could not save to disk: {e}")

    def _preprocess_text(self, text: str) -> str:
        """Clean and normalize text for better matching"""
        # Convert to lowercase
        text = text.lower()
        
        # Remove extra whitespace
        text = ' '.join(text.split())
        
        # Remove special characters but keep letters, numbers, and spaces
        text = re.sub(r'[^a-z0-9\s\u0D80-\u0DFF]', ' ', text)
        
        # Remove extra spaces again
        text = ' '.join(text.split())
        
        return text.strip()
    
    def vectorize(self, text: str, normalize: bool = True):
        """Vectorize text with preprocessing and normalization"""
        # Preprocess text
        processed_text = self._preprocess_text(text)
        
        # Encode
        vector = self.model.encode([processed_text])[0]
        
        # Normalize for cosine similarity (required for IndexFlatIP)
        if normalize:
            vector = vector / np.linalg.norm(vector)
        
        return vector

    async def add_item(self, item_data: dict):
        """Add a FOUND item to the vector database and MongoDB"""
        # 1. Vectorize the Description (English/Singlish/Sinhala)
        vector = self.vectorize(item_data['description'])
        
        # 2. Add to Vector DB (FAISS Index)
        self.index.add(np.array([vector], dtype=np.float32))
        
        # 3. Store Metadata in memory
        metadata = {
            "id": item_data['id'],
            "description": item_data['description'],
            "category": item_data['category']
        }
        self.items_metadata.append(metadata)
        
        # 4. Save to MongoDB (if available)
        try:
            db = get_database()
            if db is not None:
                document = {
                    "item_id": item_data['id'],
                    "description": item_data['description'],
                    "category": item_data['category'],
                    "vector": vector.tolist(),  # Store vector for future use
                    "created_at": datetime.utcnow(),
                    "index_position": len(self.items_metadata) - 1
                }
                await db.found_items.insert_one(document)
                print(f"Saved to MongoDB: {item_data['id']}")
        except Exception as e:
            print(f"MongoDB save failed: {e}")
        
        # 5. Persist to disk every 10 items
        if len(self.items_metadata) % 10 == 0:
            self._save_to_disk()
        
        return item_data['id']
    
    async def load_from_mongodb(self) -> int:
        """Load all items from MongoDB on startup
        
        Returns:
            int: Number of items loaded
        """
        try:
            db = get_database()
            if db is None:
                print("MongoDB not available, skipping data load")
                return 0
            
            # Verify database is actually responsive
            try:
                await db.command('ping')
            except Exception as ping_error:
                print(f"MongoDB not responsive: {ping_error}")
                return 0
            
            cursor = db.found_items.find().sort("created_at", 1)
            items = await cursor.to_list(length=None)
            
            if not items:
                print("No items found in MongoDB (empty database)")
                return 0
            
            print(f"Loading {len(items)} items from MongoDB...")
            
            # Clear existing data
            self.index = faiss.IndexFlatIP(self.dimension)  # FIXED: Use IP for cosine similarity
            self.items_metadata = []
            
            # Rebuild index from MongoDB
            for idx, item in enumerate(items):
                try:
                    vector = np.array(item['vector'], dtype=np.float32)
                    # Normalize vector for cosine similarity
                    vector = vector / np.linalg.norm(vector)
                    self.index.add(np.array([vector]))
                    
                    self.items_metadata.append({
                        "id": item['item_id'],
                        "description": item['description'],
                        "category": item['category']
                    })
                except Exception as item_error:
                    print(f"Failed to load item {idx}: {item_error}")
                    continue
            
            # Save to disk
            self._save_to_disk()
            print(f"Successfully loaded {len(self.items_metadata)} items from MongoDB")
            return len(self.items_metadata)
            
        except Exception as e:
            print(f"Critical error loading from MongoDB: {e}")
            import traceback
            traceback.print_exc()
            return 0

    def _calculate_keyword_overlap(self, query: str, description: str) -> float:
        """Calculate keyword overlap score for hybrid ranking"""
        query_words = set(self._preprocess_text(query).split())
        desc_words = set(self._preprocess_text(description).split())
        
        if not query_words or not desc_words:
            return 0.0
        
        # Jaccard similarity
        intersection = len(query_words & desc_words)
        union = len(query_words | desc_words)
        
        return (intersection / union) * 100 if union > 0 else 0.0
    
    def _hybrid_score(self, semantic_score: float, keyword_score: float, 
                      category_match: bool = False) -> float:
        """Weighted Hybrid Search: (Vector_Score * 0.7) + (Keyword_Score * 0.3)
        
        This balanced approach prevents over-reliance on either signal:
        - 70% semantic: Captures meaning and context
        - 30% keyword: Ensures exact term matches get proper weight
        
        Args:
            semantic_score: Vector similarity score (0-100)
            keyword_score: Keyword overlap score (0-100)
            category_match: Whether categories match
            
        Returns:
            Combined weighted score (0-100)
        """
        # WEIGHTED HYBRID SEARCH: 70% vector, 30% keyword
        combined = (semantic_score * 0.70 + keyword_score * 0.30)
        
        # Category match provides small bonus (not part of 70/30 split)
        if category_match:
            combined = min(100.0, combined * 1.05)  # 5% boost
        
        return min(100.0, combined)
    
    def search(self, query_text: str, limit: int = 10, category_filter: str = None):
        """Search for LOST item using Weighted Hybrid Search (70% vector + 30% keyword)
        
        Args:
            query_text: Lost item description
            limit: Maximum results to return
            category_filter: Optional category to filter by
            
        Returns:
            List of matched items with detailed scoring
        """
        import logging
        logger = logging.getLogger(__name__)
        
        if len(self.items_metadata) == 0:
            logger.warning("Search attempted but index is empty")
            return []
        
        logger.info(f"Searching for: '{query_text}' (category: {category_filter or 'any'})")
        
        # Vectorize the LOST item description (normalized)
        query_vec = self.vectorize(query_text, normalize=True)
        logger.debug(f"Query vector shape: {query_vec.shape}, norm: {np.linalg.norm(query_vec):.4f}")
        
        # Search in FAISS index using cosine similarity
        # With IndexFlatIP and normalized vectors, higher score = more similar
        k = min(limit * 2, len(self.items_metadata))  # Get more candidates for re-ranking
        scores, indices = self.index.search(np.array([query_vec], dtype=np.float32), k)
        
        logger.info(f"FAISS returned {len(indices[0])} candidates")
        
        results = []
        for i, idx in enumerate(indices[0]):
            if idx == -1 or idx >= len(self.items_metadata):
                continue
            
            metadata = self.items_metadata[idx]
            
            # Apply category filter if provided
            if category_filter and metadata['category'].lower() != category_filter.lower():
                continue
            
            # RAW COSINE SIMILARITY from FAISS (this is the vector math result)
            raw_cosine_sim = float(scores[0][i])
            
            # Convert to percentage (0-100%) with linear scaling
            # Cosine similarity ranges from -1 to 1, but typically 0.2 to 1.0 for text
            # We use linear scaling: (cosine + 1) / 2 * 100
            # This preserves the mathematical relationships
            semantic_score = max(0, min(100, ((raw_cosine_sim + 1) / 2) * 100))
            
            # Calculate keyword overlap for hybrid ranking
            keyword_score = self._calculate_keyword_overlap(query_text, metadata['description'])
            
            # Check category match
            category_match = False
            if category_filter:
                category_match = metadata['category'].lower() == category_filter.lower()
            
            # WEIGHTED HYBRID SCORE: 70% semantic + 30% keyword
            final_score = self._hybrid_score(semantic_score, keyword_score, category_match)
            
            # DETAILED LOGGING: Show raw similarity scores
            logger.info(
                f"  Match #{i+1}: {metadata['id'][:20]}... | "
                f"RAW_COSINE: {raw_cosine_sim:.4f} | "
                f"VECTOR: {semantic_score:.1f}% | "
                f"KEYWORD: {keyword_score:.1f}% | "
                f"FINAL: {final_score:.1f}%"
            )
            
            results.append({
                "item": metadata,
                "semantic_score": round(final_score, 2),
                "raw_cosine_similarity": round(raw_cosine_sim, 4),  # RAW score for debugging
                "vector_score": round(semantic_score, 2),  # Converted to %
                "keyword_score": round(keyword_score, 2),
                "details": {
                    "semantic": round(semantic_score, 2),
                    "keyword": round(keyword_score, 2),
                    "category_boost": category_match,
                    "formula": f"({semantic_score:.1f} * 0.7) + ({keyword_score:.1f} * 0.3)"
                }
            })
        
        # Sort by hybrid score descending
        results.sort(key=lambda x: x['semantic_score'], reverse=True)
        
        logger.info(f"Returning top {min(limit, len(results))} results")
        
        # Return top matches
        return results[:limit]