import asyncio
import io
import shutil
import os
import uuid
import logging
from typing import List

from fastapi import BackgroundTasks, FastAPI, UploadFile, File, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image as PILImage

from app.core.lifespan import lifespan
from app.routers import pp2_router
from app.routers import search_router
from app.core.db import SessionLocal, get_db
from app.services.storage_service import StorageService
from app.services.pre_analysis_job_store import get_job, save_job, update_job
from app.config.settings import settings

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

PRE_ANALYSIS_STAGE_META = {
    "queued": {
        "status": "queued",
        "label": "Preparing your photos",
        "message": "Getting the image analysis job ready.",
    },
    "detecting": {
        "status": "processing",
        "label": "Scanning the item",
        "message": "Inspecting the item across the uploaded photos.",
    },
    "reasoning": {
        "status": "processing",
        "label": "Refining category and description",
        "message": "Turning the visual evidence into useful report details.",
    },
    "finalizing": {
        "status": "processing",
        "label": "Preparing the next step",
        "message": "Packaging the analysis result for the app.",
    },
}


def _analysis_path_label(image_count: int) -> str:
    return "Multi-view analysis" if image_count > 1 else "Single photo analysis"


def _stage_payload(stage_key: str, analysis_mode: str, image_count: int) -> dict:
    meta = PRE_ANALYSIS_STAGE_META[stage_key]
    return {
        "status": meta["status"],
        "stageKey": stage_key,
        "stageLabel": meta["label"],
        "stageMessage": meta["message"],
        "analysisMode": analysis_mode,
        "imageCount": image_count,
        "analysisPathLabel": _analysis_path_label(image_count),
        "retryAfterMs": int(getattr(settings, "PRE_ANALYSIS_RETRY_AFTER_MS", 1000)),
    }


def _terminal_payload(
    status: str,
    analysis_mode: str,
    image_count: int,
    *,
    result: dict | list | None = None,
    error: str | None = None,
) -> dict:
    payload = {
        "status": status,
        "stageKey": "finalizing" if status == "completed" else None,
        "stageLabel": None,
        "stageMessage": None,
        "analysisMode": analysis_mode,
        "imageCount": image_count,
        "analysisPathLabel": _analysis_path_label(image_count),
        "retryAfterMs": int(getattr(settings, "PRE_ANALYSIS_RETRY_AFTER_MS", 1000)),
        "result": result,
        "error": error,
    }
    return payload


def _save_upload_to_temp(file: UploadFile) -> tuple[str, str]:
    filename = file.filename or "image.jpg"
    file_ext = filename.split(".")[-1] if "." in filename else "jpg"
    temp_filename = f"{uuid.uuid4()}.{file_ext}"
    temp_path = os.path.join(UPLOAD_DIR, temp_filename)

    with open(temp_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    with open(temp_path, "rb") as saved_file:
        raw_header = saved_file.read(16)

    is_heic = (
        len(raw_header) >= 12
        and raw_header[4:8] == b"ftyp"
        and raw_header[8:12] in (b"heic", b"heif", b"heix", b"hevc", b"hevx", b"mif1", b"msf1")
    )

    if is_heic:
        try:
            import pillow_heif as pillow_heif

            heif = pillow_heif.open_heif(temp_path, convert_hdr_to_8bit=True)
            pil_image = heif.to_pillow()
            jpeg_path = os.path.splitext(temp_path)[0] + "_converted.jpg"
            pil_image.save(jpeg_path, "JPEG", quality=92)
            os.remove(temp_path)
            temp_path = jpeg_path
            file_ext = "jpg"
        except ImportError as exc:
            if os.path.exists(temp_path):
                os.remove(temp_path)
            raise HTTPException(
                status_code=422,
                detail="HEIC image format requires pillow-heif. Please use a JPEG/PNG image or contact support."
            ) from exc
        except Exception as exc:
            if os.path.exists(temp_path):
                os.remove(temp_path)
            raise HTTPException(status_code=422, detail=f"Failed to convert HEIC image: {exc}") from exc

    file.file.seek(0)
    return temp_path, file_ext


def _cleanup_temp_paths(paths: List[str]) -> None:
    for temp_path in paths:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                logger.debug("Failed to remove temp file %s", temp_path, exc_info=True)


def _select_accepted_pp1_detection(result: dict | list) -> dict | None:
    detections = result if isinstance(result, list) else [result]
    for item in detections:
        if item and item.get("status") in ("accepted", "accepted_degraded"):
            return item
    return None


async def _run_pp1_analysis_job(app: FastAPI, task_id: str, temp_path: str) -> None:
    try:
        pipeline = getattr(app.state, "unified_pipeline", None)
        if pipeline is None:
            raise RuntimeError("UnifiedPipeline not initialized.")

        update_job(task_id, _stage_payload("detecting", "pp1", 1))
        result = await asyncio.to_thread(pipeline.process_pp1, temp_path)

        detection = _select_accepted_pp1_detection(result)
        if not detection:
            update_job(task_id, _terminal_payload("manual_fallback", "pp1", 1, result=result))
            return

        update_job(task_id, _stage_payload("reasoning", "pp1", 1))
        update_job(task_id, _stage_payload("finalizing", "pp1", 1))

        try:
            db = SessionLocal()
            try:
                storage = StorageService(db)
                for item in result if isinstance(result, list) else [result]:
                    item_id = item.get("item_id")
                    if item_id and item.get("status") in ("accepted", "accepted_degraded"):
                        storage.store_pp1_result(item_id, item)
            finally:
                db.close()
        except Exception:
            logger.warning("PP1 async storage failed (non-fatal)", exc_info=True)

        update_job(task_id, _terminal_payload("completed", "pp1", 1, result=result))
    except Exception as exc:
        logger.exception("PP1 async job failed for task %s", task_id)
        update_job(task_id, _terminal_payload("failed", "pp1", 1, error=str(exc)))
    finally:
        _cleanup_temp_paths([temp_path])

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

    logger.info("PP1_UPLOAD: filename=%s content_type=%s", filename, file.content_type)
    
    try:
        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        # Log saved file size and magic bytes to diagnose format issues
        saved_size = os.path.getsize(temp_path)
        with open(temp_path, "rb") as f:
            raw_header = f.read(16)
        magic = raw_header.hex()
        logger.info("PP1_TEMP_SAVE: path=%s ext=%s size=%d magic=%s", temp_path, file_ext, saved_size, magic)

        # Detect HEIC/HEIF by magic bytes (ftyp box at offset 4) and convert to JPEG
        # This handles iOS gallery images which are always HEIC regardless of the filename extension
        _is_heic = len(raw_header) >= 12 and raw_header[4:8] == b"ftyp" and raw_header[8:12] in (
            b"heic", b"heif", b"heix", b"hevc", b"hevx", b"mif1", b"msf1"
        )
        if _is_heic:
            logger.info("PP1_HEIC_DETECTED: Converting HEIC -> JPEG for %s", temp_path)
            try:
                import pillow_heif as _pillow_heif
                _heif = _pillow_heif.open_heif(temp_path, convert_hdr_to_8bit=True)
                _pil = _heif.to_pillow()
                _jpeg_path = os.path.splitext(temp_path)[0] + "_converted.jpg"
                _pil.save(_jpeg_path, "JPEG", quality=92)
                os.remove(temp_path)
                temp_path = _jpeg_path
                logger.info("PP1_HEIC_CONVERTED: saved JPEG -> %s", temp_path)
            except ImportError:
                logger.error(
                    "PP1_HEIC_CONVERT_FAILED: pillow-heif not installed. "
                    "Run: .\\venv\\Scripts\\python -m pip install pillow-heif"
                )
                raise HTTPException(
                    status_code=422,
                    detail="HEIC image format requires pillow-heif. Please use a JPEG/PNG image or contact support."
                )
            except Exception as _heic_err:
                logger.error("PP1_HEIC_CONVERT_FAILED: %r", str(_heic_err))
                raise HTTPException(status_code=422, detail=f"Failed to convert HEIC image: {_heic_err}")

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
        # Cleanup — temp_path may have been reassigned to the converted JPEG path
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                logger.debug("Failed to remove temp file %s", temp_path, exc_info=True)


@app.post("/pp1/analyze_async")
async def analyze_pp1_async(
    request: Request,
    background_tasks: BackgroundTasks,
    files: List[UploadFile] = File(...),
):
    if len(files) != 1:
        raise HTTPException(status_code=400, detail="PP1 requires exactly one image.")

    temp_path, _ = _save_upload_to_temp(files[0])
    task_id = str(uuid.uuid4())
    initial_payload = _stage_payload("queued", "pp1", 1)
    save_job(task_id, initial_payload)
    background_tasks.add_task(_run_pp1_analysis_job, request.app, task_id, temp_path)

    return {
        "taskId": task_id,
        **initial_payload,
    }

@app.post("/analyze")
async def analyze_legacy(files: List[UploadFile] = File(...)):
    """
    Legacy endpoint. Deprecated.
    """
    raise HTTPException(
        status_code=400, 
        detail="This endpoint is deprecated. Please use POST /pp1/analyze for single-image analysis."
    )


@app.get("/jobs/pre-analysis/{task_id}")
async def get_pre_analysis_job(task_id: str):
    job = get_job(task_id)
    if not job:
        raise HTTPException(status_code=404, detail="Pre-analysis job not found.")
    return job
