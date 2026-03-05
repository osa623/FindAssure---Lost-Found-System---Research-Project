import os
from dotenv import load_dotenv

load_dotenv()

class Settings:
    PROJECT_NAME: str = os.getenv("APP_NAME", "Semantic Engine")

    # MongoDB Configuration (loaded from .env — no hardcoded credentials)
    MONGODB_URL: str = os.getenv("MONGODB_URL", "")
    DATABASE_NAME: str = os.getenv("DATABASE_NAME", "lost_and_found")

    # Paths (Relative to project root)
    BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    MODEL_PATH = os.path.join(BASE_DIR, "data/models/fine_tuned_bert")
    GRAPH_PATH = os.path.join(BASE_DIR, "data/models/knowledge_graph.pkl")
    INDEX_PATH = os.path.join(BASE_DIR, "data/indices/faiss.index")
    METADATA_PATH = os.path.join(BASE_DIR, "data/indices/metadata.pkl")

    # --- New: LightGBM model versioning ---
    RERANKER_MODELS_DIR = os.path.join(BASE_DIR, "data/models/reranker")
    RERANKER_PTR_PATH = os.path.join(BASE_DIR, "data/models/reranker/current_model_ptr.txt")

    # --- New: Gemini API ---
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
    GEMINI_CACHE_TTL_SECONDS: int = int(os.getenv("GEMINI_CACHE_TTL_SECONDS", "3600"))

    # --- New: A/B Testing ---
    # 0.0 = 0% ML model traffic (rule-based only), 1.0 = 100% ML model traffic
    AB_ROLLOUT_PCT: float = float(os.getenv("AB_ROLLOUT_PCT", "0.0"))

    # --- New: Training thresholds ---
    MIN_TRAIN_POSITIVES: int = int(os.getenv("MIN_TRAIN_POSITIVES", "50"))

settings = Settings()