"""
Lightweight Semantic Engine using TF-IDF (no PyTorch/Transformers needed)
This works on systems with limited RAM and no GPU
"""
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
import numpy as np
import pickle
import os
import re
from datetime import datetime
from typing import List, Dict, Optional
from app.config import settings
from app.core.database import get_database

class LightweightSemanticEngine:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(LightweightSemanticEngine, cls).__new__(cls)
            cls._instance._initialize()
        return cls._instance

    def _initialize(self):
        print("Loading Lightweight Semantic Engine...")
        print("   Using TF-IDF for semantic matching (No GPU/PyTorch required)")
        
        # TF-IDF vectorizer with optimized parameters
        self.vectorizer = TfidfVectorizer(
            max_features=5000,  # Limit vocabulary size
            ngram_range=(1, 3),  # Unigrams, bigrams, trigrams
            min_df=1,
            max_df=0.95,
            sublinear_tf=True,  # Use log scaling
            strip_accents='unicode',
            lowercase=True,
            stop_words='english'
        )
        
        self.items_metadata = []
        self.item_vectors = None
        self.fitted = False
        
        print("Engine initialized")

    def _preprocess_text(self, text: str) -> str:
        """Clean and normalize text"""
        text = text.lower()
        text = re.sub(r'[^a-z0-9\s]', ' ', text)
        text = ' '.join(text.split())
        return text.strip()

    async def add_item(self, item_data: dict):
        """Add a FOUND item"""
        metadata = {
            "id": item_data['id'],
            "description": item_data['description'],
            "category": item_data['category']
        }
        self.items_metadata.append(metadata)
        
        # Mark as need to refit
        self.fitted = False
        
        # Save to MongoDB
        try:
            db = get_database()
            if db is not None:
                document = {
                    "item_id": item_data['id'],
                    "description": item_data['description'],
                    "category": item_data['category'],
                    "created_at": datetime.utcnow()
                }
                await db[settings.FOUND_ITEMS_COLLECTION].insert_one(document)
                print(f"Saved to MongoDB: {item_data['id']}")
        except Exception as e:
            print(f"MongoDB save failed: {e}")
        
        return item_data['id']

    async def load_from_mongodb(self):
        """Load all items from MongoDB"""
        try:
            db = get_database()
            if db is None:
                print("MongoDB connection is None")
                return
            
            cursor = db[settings.FOUND_ITEMS_COLLECTION].find({"status": {"$ne": "claimed"}}).sort("_id", 1)
            items = await cursor.to_list(length=None)
            
            if not items:
                print("No items found in MongoDB")
                return
            
            print(f"Loading {len(items)} items from MongoDB...")
            
            # Clear and rebuild
            self.items_metadata = []
            for item in items:
                self.items_metadata.append({
                    "id": item.get('item_id') or str(item.get('_id', '')),
                    "description": item['description'],
                    "category": item['category']
                })
            
            # Refit vectorizer
            self._fit_vectorizer()
            
            print(f"Loaded {len(items)} items from MongoDB")
            
        except Exception as e:
            import traceback
            print(f"Could not load from MongoDB: {str(e)}")
            print(f"Full error: {traceback.format_exc()}")

    def _fit_vectorizer(self):
        """Fit TF-IDF vectorizer on all item descriptions"""
        if len(self.items_metadata) == 0:
            return
        
        descriptions = [item['description'] for item in self.items_metadata]
        self.item_vectors = self.vectorizer.fit_transform(descriptions)
        self.fitted = True
        print(f"   Vectorizer fitted on {len(descriptions)} descriptions")

    def search(self, query_text: str, limit: int = 10, category_filter: str = None):
        """Search for matching items"""
        if len(self.items_metadata) == 0:
            return []
        
        # Ensure vectorizer is fitted
        if not self.fitted:
            self._fit_vectorizer()
        
        # Vectorize query
        query_vec = self.vectorizer.transform([query_text])
        
        # Calculate cosine similarities
        similarities = cosine_similarity(query_vec, self.item_vectors)[0]
        
        # Get top matches
        top_indices = np.argsort(similarities)[::-1][:limit * 2]
        
        results = []
        for idx in top_indices:
            if idx >= len(self.items_metadata):
                continue
            
            metadata = self.items_metadata[idx]
            
            # Apply category filter
            if category_filter and metadata['category'].lower() != category_filter.lower():
                continue
            
            # Calculate scores
            cosine_sim = float(similarities[idx])
            
            # Convert to percentage (TF-IDF scores are typically 0-0.7 range)
            if cosine_sim >= 0.5:
                semantic_score = 85 + (cosine_sim - 0.5) * 30  # 85-100%
            elif cosine_sim >= 0.3:
                semantic_score = 70 + (cosine_sim - 0.3) * 75  # 70-85%
            elif cosine_sim >= 0.15:
                semantic_score = 50 + (cosine_sim - 0.15) * 133  # 50-70%
            else:
                semantic_score = cosine_sim * 333  # 0-50%
            
            semantic_score = max(0, min(100, semantic_score))
            
            # Calculate keyword overlap
            query_words = set(self._preprocess_text(query_text).split())
            desc_words = set(self._preprocess_text(metadata['description']).split())
            keyword_score = (len(query_words & desc_words) / len(query_words | desc_words) * 100) if query_words | desc_words else 0
            
            # Category boost
            category_match = category_filter and metadata['category'].lower() == category_filter.lower()
            
            # Hybrid score (85% semantic, 10% keyword, 5% category)
            final_score = (semantic_score * 0.85 + 
                          keyword_score * 0.10 + 
                          (5.0 if category_match else 0.0))
            
            results.append({
                "item": metadata,
                "semantic_score": round(final_score, 2),
                "cosine_similarity": round(cosine_sim, 4),
                "keyword_match": round(keyword_score, 2),
                "details": {
                    "semantic": round(semantic_score, 2),
                    "keyword": round(keyword_score, 2),
                    "category_boost": category_match
                }
            })
        
        # Sort by score
        results.sort(key=lambda x: x['semantic_score'], reverse=True)
        
        return results[:limit]
