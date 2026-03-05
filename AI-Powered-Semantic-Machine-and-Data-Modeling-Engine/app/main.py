from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api import routes
from app.config import settings
from app.core.database import connect_to_mongo, close_mongo_connection, is_mongodb_connected
from app.core.semantic import SemanticEngine
import logging
import os

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = FastAPI(title=settings.PROJECT_NAME)

@app.on_event("startup")
async def startup_event():
    """Startup: Connect to MongoDB, load semantic engine, and initialize AI components."""
    logger.info("Starting AI Semantic Engine...")

    # STEP 1: Establish MongoDB connection with retry logic
    logger.info("Step 1/4: Connecting to MongoDB...")
    connection_success = await connect_to_mongo()

    if not connection_success:
        logger.warning("MongoDB connection failed - running in standalone mode")
    else:
        logger.info("MongoDB connection established")

    # STEP 2: Initialize Semantic Engine (loads model and creates FAISS index)
    logger.info("Step 2/4: Initializing Semantic Engine...")
    semantic_engine = SemanticEngine()
    logger.info("Semantic Engine initialized")

    # STEP 3: Load data from MongoDB ONLY if connected
    if connection_success and is_mongodb_connected():
        logger.info("Step 3/4: Loading vectors from MongoDB...")
        try:
            items_loaded = await semantic_engine.load_from_mongodb()
            logger.info(f"Loaded {items_loaded} items from MongoDB")
        except Exception as e:
            logger.error(f"Failed to load from MongoDB: {e}")
            logger.info("Falling back to disk cache")
    else:
        logger.info("Step 3/4: Using disk cache (MongoDB not available)")

    # STEP 4: Initialize AI components
    logger.info("Step 4/4: Initializing AI components...")

    # 4a. Gemini normalizer (pre-init to surface any key config errors early)
    if settings.GEMINI_API_KEY:
        try:
            from app.core.normalizer import LostTextNormalizer
            _normalizer = LostTextNormalizer()
            logger.info("Gemini LostTextNormalizer ready")
        except Exception as e:
            logger.warning(f"Gemini normalizer init failed: {e} — will use fallback")
    else:
        logger.warning(
            "GEMINI_API_KEY not set — text normalization will use passthrough fallback. "
            "Add GEMINI_API_KEY to .env to enable full Gemini extraction."
        )

    # 4b. Load LightGBM re-ranker (if a trained model exists)
    try:
        from app.core.scorer import get_lgbm_model
        _model, _version = get_lgbm_model()
        if _model is not None:
            logger.info(f"LightGBM re-ranker loaded: {_version}")
        else:
            logger.info(
                "No trained re-ranker found — using rule-based scoring. "
                f"Train a model with scripts/train_reranker.py (needs {settings.MIN_TRAIN_POSITIVES}+ verified pairs)."
            )
        # Ensure reranker models directory exists
        os.makedirs(settings.RERANKER_MODELS_DIR, exist_ok=True)
    except Exception as e:
        logger.warning(f"Re-ranker init skipped: {e}")

    logger.info("System ready! All initialization steps completed.")

@app.on_event("shutdown")
async def shutdown_event():
    """Shutdown: Close MongoDB connection"""
    logger.info("Shutting down...")
    await close_mongo_connection()
    logger.info("Shutdown complete")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],  # React ports
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API Routes
app.include_router(routes.router)

@app.get("/")
def health_check():
    return {
        "status": "online",
        "module": "Semantic & Data Modeling",
        "gemini_enabled": bool(settings.GEMINI_API_KEY),
        "ab_rollout_pct": settings.AB_ROLLOUT_PCT,
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)