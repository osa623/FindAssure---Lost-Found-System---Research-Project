import os
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from app.config.settings import settings

# Core
from app.core.redis_client import get_redis_client
from app.core.db import engine, Base
from app.models import item_models  # noqa: F401
from app.models.item_models import ensure_founder_prefill_feedback_schema

# Services
from app.services.yolo_service import YoloService
from app.services.florence_service import FlorenceService
from app.services.dino_embedder import DINOEmbedder
from app.services.gemini_reasoner import GeminiReasoner
from app.services.unified_pipeline import UnifiedPipeline
from app.services.faiss_service import FaissService
from app.services.pp2_geometric_verifier import GeometricVerifier
from app.services.pp2_multiview_verifier import MultiViewVerifier
from app.services.pp2_fusion_service import MultiViewFusionService
from app.services.pp2_multiview_pipeline import MultiViewPipeline

# Configure logging
logger = logging.getLogger(__name__)

# Constants
FAISS_DIM = 128

# Register HEIF/HEIC opener so Pillow can read iOS gallery photos
try:
    import pillow_heif
    pillow_heif.register_heif_opener()
    logger.info("pillow-heif HEIC/HEIF opener registered.")
except ImportError:
    logger.warning("pillow-heif not installed — HEIC/HEIF images from iOS gallery will fail analysis. Run: pip install pillow-heif")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # --- Startup ---
    logger.info("Starting up application lifecycle...")

    # 1. Check/Create data directory
    os.makedirs("data", exist_ok=True)

    # 2. Initialize Redis
    redis = get_redis_client()
    if redis:
        try:
            if redis.ping():
                logger.info("Redis connection established successfully.")
            else:
                logger.warning("Redis ping returned False.")
        except Exception as e:
            logger.error(f"Redis initialization/ping failed: {e}")
    else:
        logger.warning("Redis client is None.")

    # 3. Database Connection Check
    try:
        Base.metadata.create_all(bind=engine)
        ensure_founder_prefill_feedback_schema(engine)
        logger.info("Database schema initialized for %s", settings.DATABASE_URL)
    except Exception as e:
        logger.error(f"Database configuration warning: {e}")

    # 4. Initialize Services
    try:
        logger.info("Initializing ML Services and Vectors...")

        # Initialize FaissService
        faiss_service = FaissService(
            dim=FAISS_DIM,
            index_path=settings.FAISS_INDEX_PATH,
            mapping_path=settings.FAISS_MAPPING_PATH
        )
        faiss_service.load_or_create()

        # Initialize Model Services
        yolo_service = YoloService()
        try:
            yolo_service.warmup()
        except Exception:
            if yolo_service.model is None:
                raise
            logger.warning("YOLO warmup failed; continuing with loaded model.", exc_info=True)
        florence_service = FlorenceService()
        dino_embedder = DINOEmbedder()
        gemini_reasoner = GeminiReasoner()

        # Initialize Logic Services
        geometric_verifier = GeometricVerifier()
        multiview_verifier = MultiViewVerifier(geometric_service=geometric_verifier)
        fusion_service = MultiViewFusionService()

        # Initialize PP2 Pipeline
        multiview_pipeline = MultiViewPipeline(
            yolo=yolo_service,
            florence=florence_service,
            dino=dino_embedder,
            verifier=multiview_verifier,
            fusion=fusion_service,
            faiss=faiss_service
        )

        # Initialize PP1 Pipeline with shared services
        unified_pipeline = UnifiedPipeline(
            yolo=yolo_service,
            florence=florence_service,
            gemini=gemini_reasoner,
            dino=dino_embedder,
        )

        # 5. Store in App State
        app.state.unified_pipeline = unified_pipeline
        app.state.multiview_pipeline = multiview_pipeline
        logger.info("UnifiedPipeline and MultiViewPipeline initialized and stored in app.state.")

    except Exception as e:
        logger.critical(f"Critical failure during service initialization: {e}")
        raise e

    yield

    # --- Shutdown ---
    logger.info("Shutting down application...")

    # 1. Save FAISS Index
    if hasattr(app.state, "multiview_pipeline") and app.state.multiview_pipeline:
        try:
            if app.state.multiview_pipeline.faiss:
                app.state.multiview_pipeline.faiss.save()
        except Exception as e:
            logger.error(f"Error saving FAISS index during shutdown: {e}")

    # 2. Clear State
    app.state.unified_pipeline = None
    app.state.multiview_pipeline = None

    # 3. Close Redis
    if redis:
        try:
            redis.close()
            logger.info("Redis connection closed.")
        except Exception as e:
            logger.error(f"Error closing Redis connection: {e}")
