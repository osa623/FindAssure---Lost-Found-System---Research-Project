from fastapi import FastAPI, UploadFile, File, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from typing import List
import shutil
import os
import uuid
import logging

from app.core.lifespan import lifespan
from app.routers import pp2_router
from app.routers import search_router
from app.services.storage_service import StorageService
from app.core.db import get_db

app = FastAPI(title="Vision Core Backend", lifespan=lifespan)
logger = logging.getLogger(__name__)

app.include_router(pp2_router.router, prefix="/pp2", tags=["Phase 2"])
app.include_router(search_router.router, prefix="/search", tags=["Search"])

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)

UPLOAD_DIR = "temp_uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

@app.get("/")
def read_root():
    return {"message": "Vision Core Backend is running."}

@app.post("/pp1/analyze")
async def analyze_pp1(
    request: Request,
    files: List[UploadFile] = File(...),
):
    """
    Phase 1 Analysis: Single Image -> YOLO -> Florence -> Gemini
    """
    if len(files) != 1:
        raise HTTPException(status_code=400, detail="PP1 requires exactly one image.")
    
    file = files[0]
    # Basic extension check/sanitization
    filename = file.filename or "image.jpg"
    file_ext = filename.split(".")[-1] if "." in filename else "jpg"
    temp_filename = f"{uuid.uuid4()}.{file_ext}"
    temp_path = os.path.join(UPLOAD_DIR, temp_filename)
    
    try:
        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        # Call the pipeline from app state (shared service instances)
        try:
            pipeline = getattr(request.app.state, "unified_pipeline", None)
            if pipeline is None:
                raise HTTPException(status_code=500, detail="UnifiedPipeline not initialized.")
            result = pipeline.process_pp1(temp_path)
        except HTTPException:
            raise
        except Exception:
            logger.exception("PP1 processing failed unexpectedly.")
            raise HTTPException(status_code=500, detail="PP1 processing failed")

        # Persist PP1 results to DB
        try:
            db = next(get_db())
            storage = StorageService(db)
            for item in result if isinstance(result, list) else [result]:
                item_id = item.get("item_id")
                if item_id and item.get("status") in ("accepted", "accepted_degraded"):
                    storage.store_pp1_result(item_id, item)
        except Exception:
            logger.warning("PP1 storage failed (non-fatal)", exc_info=True)

        return result
        
    finally:
        # Cleanup
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                logger.debug("Failed to remove temp file %s", temp_path, exc_info=True)

@app.post("/analyze")
async def analyze_legacy(files: List[UploadFile] = File(...)):
    """
    Legacy endpoint. Deprecated.
    """
    raise HTTPException(
        status_code=400, 
        detail="This endpoint is deprecated. Please use POST /pp1/analyze for single-image analysis."
    )
