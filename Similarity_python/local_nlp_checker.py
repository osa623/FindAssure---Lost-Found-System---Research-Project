# local_nlp_checker.py
import os
# Force transformers/sentence-transformers to avoid TensorFlow in this service.
os.environ.setdefault("USE_TF", "0")
os.environ.setdefault("TRANSFORMERS_NO_TF", "1")
os.environ.setdefault("USE_FLAX", "0")

import spacy
import numpy as np
import re
from sentence_transformers import SentenceTransformer, util
from sklearn.feature_extraction.text import TfidfVectorizer, CountVectorizer

NEGATIONS = {
    "no", "not", "never", "dont", "don't", "didnt", "didn't",
    "cannot", "can't", "wont", "won't"
}

GENERIC_WORDS = {
    "it", "is", "a", "the", "with", "this", "that",
    "thing", "object", "something", "someone"
}

def py(v):
    """Convert numpy / scalar types to native Python types."""
    try:
        # numpy scalars (.item()) and other objects
        if hasattr(v, "item"):
            return v.item()
        # numpy arrays -> list
        if isinstance(v, (np.ndarray,)):
            return v.tolist()
    except Exception:
        pass
    # fallback for builtin numerics/bools/None/str
    return v

class LocalNLP:
    def __init__(self):
        self.nlp = spacy.load("en_core_web_lg")
        self.sbert = SentenceTransformer("all-mpnet-base-v2")
        self.tfidf = TfidfVectorizer()
        self.char_vec = CountVectorizer(analyzer="char", ngram_range=(3, 6))
        self.cache_emb = {}

    # -----------------------------
    # BASIC TEXT UTILS
    # -----------------------------

    def normalize(self, text):
        if not text:
            return ""
        t = text.lower()
        t = re.sub(r"[^a-z0-9\s']", " ", t)
        t = re.sub(r"\s+", " ", t).strip()
        return t

    def tokenize(self, text):
        return self.nlp(self.normalize(text))

    def extract_keywords(self, text):
        """
        Dynamically extract meaningful keywords from text
        (nouns, verbs, adjectives, proper nouns + negations)
        """
        doc = self.tokenize(text)
        keywords = set()

        for t in doc:
            if t.is_punct or t.like_num:
                continue

            if t.is_stop and t.text.lower() not in NEGATIONS:
                continue

            if t.lemma_.lower() in GENERIC_WORDS:
                continue

            if t.pos_ in {"NOUN", "VERB", "ADJ", "PROPN"}:
                kw = re.sub(r"[^a-z0-9_-]", "", t.lemma_.lower())
                if kw:
                    keywords.add(kw)

        return keywords

    # -----------------------------
    # KEYWORD COVERAGE CHECK
    # -----------------------------

    def keyword_coverage(self, founder_kw, owner_kw):
        """
        Measures how much of the founder keywords
        are covered by owner answer (0..1)
        """
        if not founder_kw:
            return 0.0
        covered = founder_kw & owner_kw
        return float(len(covered) / len(founder_kw))

    def is_generic_answer(self, keywords):
        """
        Generic answers contain almost no meaningful keywords
        """
        return len(keywords) <= 2

    # -----------------------------
    # SIMILARITY METHODS
    # -----------------------------

    def _cosine_sparse(self, X):
        a = X[0].toarray().ravel()
        b = X[1].toarray().ravel()
        denom = np.linalg.norm(a) * np.linalg.norm(b)
        return 0.0 if denom == 0 else float(np.dot(a, b) / denom)

    def tfidf_sim(self, A, B):
        if not A or not B:
            return 0.0
        X = self.tfidf.fit_transform([" ".join(A), " ".join(B)])
        return float(np.clip(self._cosine_sparse(X), 0, 1))

    def char_ngram_sim(self, a, b):
        if not a or not b:
            return 0.0
        X = self.char_vec.fit_transform([a, b])
        return float(np.clip(self._cosine_sparse(X), 0, 1))

    def jaccard(self, A, B):
        return 0.0 if not A or not B else float(len(A & B) / len(A | B))

    def embed(self, text):
        if text in self.cache_emb:
            return self.cache_emb[text]
        emb = self.sbert.encode(text, convert_to_numpy=True)
        self.cache_emb[text] = emb
        return emb

    def sbert_sim(self, a, b):
        if not a or not b:
            return 0.0
        sim = float(util.cos_sim(self.embed(a), self.embed(b)))
        return float(np.clip((sim + 1) / 2, 0, 1))

    def spacy_sim(self, a, b):
        if not a or not b:
            return 0.0
        va, vb = self.nlp(a).vector, self.nlp(b).vector
        denom = np.linalg.norm(va) * np.linalg.norm(vb)
        return 0.0 if denom == 0 else float(np.clip(np.dot(va, vb) / denom, 0, 1))

    # -----------------------------
    # FEATURE + FUSION
    # -----------------------------

    def compute_features(self, founder, owner, fk, ok):
        sf = " ".join(sorted(fk))
        so = " ".join(sorted(ok))

        return {
            "tfidf": float(self.tfidf_sim(fk, ok)),
            "char_ngram": float(self.char_ngram_sim(sf, so)),
            "jaccard": float(self.jaccard(fk, ok)),
            "sbert": float(self.sbert_sim(sf, so)),
            "spacy": float(self.spacy_sim(sf, so)),
        }

    def fuse_score(self, f, coverage):
        base = (
            f["tfidf"] * 0.25 +
            f["jaccard"] * 0.25 +
            f["char_ngram"] * 0.15 +
            f["sbert"] * 0.20 +
            f["spacy"] * 0.15
        )
        # Coverage acts as a multiplier (0..1). keep as float.
        return float(np.clip(base * float(coverage), 0, 1))

    # -----------------------------
    # MAIN ENTRY
    # -----------------------------

    def score_pair(self, founder, owner):
        if not owner or len(owner.strip()) < 3:
            return {"fused": 0.0, "reason": "empty_answer"}

        # Normalize for comparison
        founder_norm = self.normalize(founder)
        owner_norm = self.normalize(owner)

        #  EXACT MATCH CHECK FIRST (handles cases like "toyota" == "toyota")
        if founder_norm == owner_norm:
            return {
                "fused": 1.0,
                "coverage": 1.0,
                "reason": "exact_match",
                "features": {
                    "tfidf": 1.0,
                    "char_ngram": 1.0,
                    "jaccard": 1.0,
                    "sbert": 1.0,
                    "spacy": 1.0
                }
            }

        #  OPPOSITE/NEGATION CHECK (yes vs no, true vs false, etc.)
        opposite_pairs = [
            ("yes", "no"), ("no", "yes"),
            ("true", "false"), ("false", "true"),
            ("correct", "incorrect"), ("incorrect", "correct"),
            ("right", "wrong"), ("wrong", "right"),
            ("positive", "negative"), ("negative", "positive"),
            ("have", "dont have"), ("have", "do not have"),
            ("has", "doesnt have"), ("has", "does not have"),
            ("is", "isnt"), ("is", "is not"),
            ("are", "arent"), ("are", "are not"),
            ("was", "wasnt"), ("was", "was not"),
            ("were", "werent"), ("were", "were not")
        ]
        
        for pair1, pair2 in opposite_pairs:
            if (pair1 in founder_norm and pair2 in owner_norm) or \
               (pair2 in founder_norm and pair1 in owner_norm):
                return {
                    "fused": 0.0,
                    "coverage": 0.0,
                    "reason": "opposite_answer",
                    "features": {
                        "tfidf": 0.0,
                        "char_ngram": 0.0,
                        "jaccard": 0.0,
                        "sbert": 0.0,
                        "spacy": 0.0
                    }
                }

        # SUBSTRING MATCH - Only for whole words or meaningful phrases
        # Split into words for whole word matching
        founder_words = set(founder_norm.split())
        owner_words = set(owner_norm.split())
        
        # Check if one is a complete subset of the other (whole word match)
        # IMPORTANT: Both must be non-empty (to avoid empty set matching everything)
        if founder_words and owner_words and len(founder_words) > 0 and len(owner_words) > 0:
            # Check subset only if both have meaningful words
            # Prevent empty set from matching 
            if founder_words.issubset(owner_words) or owner_words.issubset(founder_words):
                # One answer contains all words from the other
           
                substring_score = 0.85
                return {
                    "fused": substring_score,
                    "coverage": 0.9,
                    "reason": "word_subset_match",
                    "features": {
                        "tfidf": substring_score,
                        "char_ngram": substring_score,
                        "jaccard": substring_score,
                        "sbert": substring_score,
                        "spacy": substring_score
                    }
                }
            
            # Check for significant word overlap (at least 60% of words match)
            common_words = founder_words & owner_words
            if common_words:
                overlap_ratio = len(common_words) / max(len(founder_words), len(owner_words))
                if overlap_ratio >= 0.6:
                    # Significant word overlap
                    word_overlap_score = 0.70 + (overlap_ratio * 0.2)  # 70-90% based on overlap
                    return {
                        "fused": word_overlap_score,
                        "coverage": overlap_ratio,
                        "reason": "high_word_overlap",
                        "features": {
                            "tfidf": word_overlap_score,
                            "char_ngram": word_overlap_score,
                            "jaccard": word_overlap_score,
                            "sbert": word_overlap_score,
                            "spacy": word_overlap_score
                        }
                    }

        founder_kw = self.extract_keywords(founder)
        owner_kw = self.extract_keywords(owner)

        if self.is_generic_answer(owner_kw):
            return {"fused": 0.05, "reason": "generic_answer"}

        coverage = self.keyword_coverage(founder_kw, owner_kw)

        # HARD FAIL if owner misses too many founder keywords.
        if coverage < 0.5:
            return {
                "fused": float(0.05),
                "coverage": float(coverage),
                "reason": "insufficient_detail_match"
            }

        feats = self.compute_features(founder, owner, founder_kw, owner_kw)
        fused = self.fuse_score(feats, coverage)

        # sanitize everything into native types
        return {
            "features": {k: py(v) for k, v in feats.items()},
            "fused": float(py(fused)),
            "coverage": float(py(coverage)),
            "reason": "ok"
        }
