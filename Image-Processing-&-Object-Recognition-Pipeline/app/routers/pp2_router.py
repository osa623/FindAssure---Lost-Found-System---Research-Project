import asyncio
from fastapi import APIRouter, UploadFile, File, HTTPException, Request, Depends, BackgroundTasks
from sqlalchemy.orm import Session
from typing import List, Optional
import io
import os
import time
import uuid
import logging
from PIL import Image
from tempfile import NamedTemporaryFile
from app.core.db import get_db, SessionLocal
from app.services.pre_analysis_job_store import save_job, update_job

# Internal
from app.schemas.pp2_schemas import PP2Response, PP2VerifyPairResponse
from app.services.storage_service import StorageService

router = APIRouter()
logger = logging.getLogger(__name__)

PRE_ANALYSIS_STAGE_META = {
    "queued": {
        "status": "queued",
        "label": "Preparing your photos",
        "message": "Getting the multi-view analysis job ready.",
    },
    "detecting": {
        "status": "processing",
        "label": "Scanning the item",
        "message": "Comparing the uploaded views and checking item consistency.",
    },
    "reasoning": {
        "status": "processing",
        "label": "Refining category and description",
        "message": "Combining the views into a stronger report suggestion.",
    },
    "finalizing": {
        "status": "processing",
        "label": "Preparing the next step",
        "message": "Packaging the analysis result for the app.",
    },
}


class _SavedUpload:
    def __init__(self, filename: str, path: str):
        self.filename = filename
        self.file = open(path, "rb")

    def close(self) -> None:
        self.file.close()


def _analysis_path_label(image_count: int) -> str:
    return "Multi-view analysis"


def _stage_payload(stage_key: str, image_count: int) -> dict:
    meta = PRE_ANALYSIS_STAGE_META[stage_key]
    return {
        "status": meta["status"],
        "stageKey": stage_key,
        "stageLabel": meta["label"],
        "stageMessage": meta["message"],
        "analysisMode": "pp2",
        "imageCount": image_count,
        "analysisPathLabel": _analysis_path_label(image_count),
    }


def _terminal_payload(image_count: int, status: str, *, result=None, error: str | None = None) -> dict:
    return {
        "status": status,
        "stageKey": "finalizing" if status == "completed" else None,
        "stageLabel": None,
        "stageMessage": None,
        "analysisMode": "pp2",
        "imageCount": image_count,
        "analysisPathLabel": _analysis_path_label(image_count),
        "result": result,
        "error": error,
    }


def _persist_uploads(files: List[UploadFile]) -> List[tuple[str, str]]:
    saved_files: List[tuple[str, str]] = []
    for upload in files:
      suffix = os.path.splitext(upload.filename or "")[1] or ".jpg"
      with NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
          upload.file.seek(0)
          tmp.write(upload.file.read())
          temp_path = tmp.name
      upload.file.seek(0)
      saved_files.append((upload.filename or os.path.basename(temp_path), temp_path))
    return saved_files


def _cleanup_saved_files(saved_files: List[tuple[str, str]]) -> None:
    for _, temp_path in saved_files:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                logger.debug("Failed to remove PP2 temp file %s", temp_path, exc_info=True)


async def _run_pp2_analysis_job(app, task_id: str, saved_files: List[tuple[str, str]]) -> None:
    image_count = len(saved_files)
    upload_wrappers: List[_SavedUpload] = []
    try:
        pipeline = getattr(app.state, "multiview_pipeline", None)
        if not pipeline:
            raise RuntimeError("MultiViewPipeline not initialized.")

        update_job(task_id, _stage_payload("detecting", image_count))

        upload_wrappers = [_SavedUpload(filename, path) for filename, path in saved_files]
        db = SessionLocal()
        try:
            storage = StorageService(db)
            result = await pipeline.analyze(upload_wrappers, storage=storage, request_id=task_id)
        finally:
            db.close()

        if getattr(result, "verification", None) and getattr(result.verification, "passed", False) and getattr(result, "fused", None):
            update_job(task_id, _stage_payload("reasoning", image_count))
            update_job(task_id, _stage_payload("finalizing", image_count))
            update_job(task_id, _terminal_payload(image_count, "completed", result=result.model_dump()))
            return

        update_job(task_id, _terminal_payload(image_count, "manual_fallback", result=result.model_dump()))
    except Exception as exc:
        logger.exception("PP2 async job failed for task %s", task_id)
        update_job(task_id, _terminal_payload(image_count, "failed", error=str(exc)))
    finally:
        for wrapper in upload_wrappers:
            wrapper.close()
        _cleanup_saved_files(saved_files)

@router.post("/verify_pair", response_model=PP2VerifyPairResponse)
async def verify_pair(
    request: Request,
    files: List[UploadFile] = File(...),
):
    """
    Verify similarity between exactly 2 images.
    Returns cosine similarity and geometric verification results.
    """
    if len(files) != 2:
        raise HTTPException(
            status_code=400,
            detail=f"Exactly 2 images are required for pair verification. Got {len(files)}."
        )

    try:
        pipeline = request.app.state.multiview_pipeline
        if not pipeline:
             raise HTTPException(status_code=500, detail="MultiViewPipeline not initialized.")

        # Threshold from env, default 0.85
        threshold = float(os.getenv("VERIFY_THRESHOLD", 0.85))

        # Helper to process image (Load -> Detect -> Crop)
        def process_image(upload_file: UploadFile) -> Image.Image:
            content = upload_file.file.read()
            upload_file.file.seek(0)
            img = Image.open(io.BytesIO(content)).convert("RGB")
            
            # Detect
            detections = pipeline.yolo.detect_objects(img)
            
            if detections:
                # Get best detection
                best = max(detections, key=lambda x: x.confidence)
                x1, y1, x2, y2 = best.bbox
                
                # Bounds check
                w, h = img.size
                x1 = max(0, x1)
                y1 = max(0, y1)
                x2 = min(w, x2)
                y2 = min(h, y2)
                
                return img.crop((x1, y1, x2, y2))
            
            # Fallback to full image
            return img

        # Run processing
        # Note: In a real high-load async scenarios, CPU bound tasks like detection/cropping 
        # should ideally be offloaded to a threadpool, but for this implementation we run inline 
        # as per existing patterns in this codebase.
        crop1 = process_image(files[0])
        crop2 = process_image(files[1])

        # Embeddings
        vec1 = pipeline.dino.embed_128(crop1)
        vec2 = pipeline.dino.embed_128(crop2)

        # Similarity
        sim_score = pipeline.faiss.pair_similarity(vec1, vec2)

        # Geometric Verification
        geo_result = pipeline.verifier.geometric_service.verify_pair(crop1, crop2)

        # Decision
        passed = (sim_score >= threshold)

        return {
            "cosine_like_score_faiss": sim_score,
            "geometric": geo_result,
            "passed": passed,
            "threshold": threshold
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/analyze_multiview", response_model=PP2Response)
async def analyze_multiview(
    request: Request,
    files: Optional[List[UploadFile]] = File(None),
    db: Session = Depends(get_db)
):
    """
    Phase 2: Multi-View Analysis Endpoint.
    Requires 2 or 3 images.
    """
    normalized_files = files or []
    file_count = len(normalized_files)
    if file_count < 2 or file_count > 3:
        raise HTTPException(
            status_code=400, 
            detail=f"PP2 multi-view analysis requires 2 or 3 images. Got {file_count}."
        )
    request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    req_start = time.perf_counter()
    logger.info("PP2_REQ_START request_id=%s file_count=%d", request_id, file_count)

    try:
        # Retrieve Pipeline from App State
        pipeline = request.app.state.multiview_pipeline
        if not pipeline:
            raise HTTPException(status_code=500, detail="MultiViewPipeline not initialized.")

        # Initialize scoped StorageService with DB access
        storage = StorageService(db)

        # Call pipeline (files are passed directly)
        result = await pipeline.analyze(normalized_files, storage=storage, request_id=request_id)
        logger.info(
            "PP2_REQ_END request_id=%s item_id=%s stored=%s total_ms=%.2f",
            request_id,
            getattr(result, "item_id", None),
            bool(getattr(result, "stored", False)),
            (time.perf_counter() - req_start) * 1000.0,
        )
        return result

    except ValueError as ve:
        logger.warning(
            "PP2_REQ_END request_id=%s status=400 error=%s total_ms=%.2f",
            request_id,
            str(ve),
            (time.perf_counter() - req_start) * 1000.0,
        )
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        # Log error in production
        logger.exception(
            "PP2_REQ_END request_id=%s status=500 total_ms=%.2f",
            request_id,
            (time.perf_counter() - req_start) * 1000.0,
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/analyze_multiview_async")
async def analyze_multiview_async(
    request: Request,
    background_tasks: BackgroundTasks,
    files: Optional[List[UploadFile]] = File(None),
):
    normalized_files = files or []
    file_count = len(normalized_files)
    if file_count < 2 or file_count > 3:
        raise HTTPException(
            status_code=400,
            detail=f"PP2 multi-view analysis requires 2 or 3 images. Got {file_count}."
        )

    saved_files = _persist_uploads(normalized_files)
    task_id = str(uuid.uuid4())
    initial_payload = _stage_payload("queued", file_count)
    save_job(task_id, initial_payload)
    background_tasks.add_task(_run_pp2_analysis_job, request.app, task_id, saved_files)

    return {
        "taskId": task_id,
        **initial_payload,
    }
