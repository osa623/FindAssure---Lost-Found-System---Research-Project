from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from io import BytesIO
from PIL import Image
import numpy as np

from app.schemas.search_schemas import IndexVectorRequest, IndexVectorResponse, SearchByImageResponse, SearchMatch
from app.domain.bbox_utils import clip_bbox
from app.domain.category_specs import canonicalize_label

router = APIRouter()

MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB


@router.post("/index_vector", response_model=IndexVectorResponse)
async def index_vector(request: Request, payload: IndexVectorRequest):
    pipeline = getattr(request.app.state, "multiview_pipeline", None)
    if pipeline is None or getattr(pipeline, "faiss", None) is None:
        raise HTTPException(status_code=500, detail="FAISS pipeline is not initialized.")

    vector = np.array(payload.vector_128d, dtype=np.float32)
    metadata = payload.metadata or {}

    try:
        faiss_id = pipeline.faiss.add(vector, metadata)
        pipeline.faiss.save()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to index vector: {exc}")

    return IndexVectorResponse(faiss_id=int(faiss_id))


@router.post("/by-image", response_model=SearchByImageResponse)
async def search_by_image(
    request: Request,
    file: UploadFile = File(...),
    top_k: int = Form(1),
    min_score: float = Form(0.7),
    category: str = Form(None),
):
    pipeline = getattr(request.app.state, "multiview_pipeline", None)
    if pipeline is None or getattr(pipeline, "faiss", None) is None:
        raise HTTPException(status_code=500, detail="FAISS pipeline is not initialized.")

    if top_k < 1 or top_k > 50:
        raise HTTPException(status_code=400, detail="top_k must be between 1 and 50.")

    if min_score < 0 or min_score > 1:
        raise HTTPException(status_code=400, detail="min_score must be between 0 and 1.")

    try:
        content = await file.read()
        if len(content) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail=f"File too large. Maximum size is {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.")
        image = Image.open(BytesIO(content)).convert("RGB")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid image input: {exc}")

    try:
        # Multi-crop strategy: generate embeddings from multiple views
        crops = []

        # 1. YOLO crop (highest priority)
        detections = pipeline.yolo.detect_objects(image)
        if detections:
            best = max(detections, key=lambda det: float(det.confidence))
            x1, y1, x2, y2 = best.bbox
            w, h = image.size
            x1, y1, x2, y2 = clip_bbox((x1, y1, x2, y2), w, h)
            if x2 > x1 and y2 > y1:
                crops.append(image.crop((x1, y1, x2, y2)))

        # 2. Center crop (70% of image — captures the main subject)
        w, h = image.size
        cx, cy = w / 2, h / 2
        cw, ch = w * 0.7, h * 0.7
        cc_x1 = max(0, int(cx - cw / 2))
        cc_y1 = max(0, int(cy - ch / 2))
        cc_x2 = min(w, int(cx + cw / 2))
        cc_y2 = min(h, int(cy + ch / 2))
        if cc_x2 > cc_x1 and cc_y2 > cc_y1:
            crops.append(image.crop((cc_x1, cc_y1, cc_x2, cc_y2)))

        # 3. Full image fallback
        crops.append(image)

        # Search with each crop vector, aggregate results
        all_results = []
        candidate_k = min(200, max(top_k * 8, 40))
        for crop_img in crops:
            vec_128 = pipeline.dino.embed_128(crop_img)
            results = pipeline.faiss.search(vec_128, top_k=candidate_k)
            all_results.extend(results)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Search pipeline failed: {exc}")

    # Deduplicate: keep highest score per faiss_id across all crops
    best_by_faiss_id: dict[int, dict] = {}
    for entry in all_results:
        fid = int(entry.get("faiss_id", -1))
        score = float(entry.get("score", 0.0))
        if fid not in best_by_faiss_id or score > float(best_by_faiss_id[fid].get("score", 0.0)):
            best_by_faiss_id[fid] = entry
    deduped_results = list(best_by_faiss_id.values())

    # Normalize optional category filter
    category_filter = category.strip() if category else None
    if category_filter:
        canonical = canonicalize_label(category_filter)
        if canonical:
            category_filter = canonical

    per_item_hits: dict[str, list[dict]] = {}
    for entry in deduped_results:
        score = float(entry.get("score", 0.0))
        if score < min_score:
            continue

        # Apply category filter if provided
        if category_filter:
            entry_cat = str(entry.get("category", "")).strip()
            if entry_cat.lower() != category_filter.lower():
                continue

        raw_item_id = entry.get("item_id")
        if raw_item_id is None:
            continue

        item_id = str(raw_item_id).strip()
        if not item_id:
            continue

        faiss_id = int(entry.get("faiss_id"))
        metadata = {
            k: v
            for k, v in entry.items()
            if k not in {"score", "faiss_id", "item_id"}
        }
        per_item_hits.setdefault(item_id, []).append(
            {
                "score": score,
                "faiss_id": faiss_id,
                "metadata": metadata,
            }
        )

    matches: list[SearchMatch] = []
    for item_id, hits in per_item_hits.items():
        best_hit = max(hits, key=lambda hit: float(hit["score"]))
        vector_hits = [
            {
                "score": float(hit["score"]),
                "faiss_id": int(hit["faiss_id"]),
                "metadata": dict(hit["metadata"]),
            }
            for hit in sorted(hits, key=lambda hit: float(hit["score"]), reverse=True)
        ]

        matches.append(
            SearchMatch(
                score=float(best_hit["score"]),
                faiss_id=int(best_hit["faiss_id"]),
                item_id=item_id,
                metadata=dict(best_hit["metadata"]),
                vector_hits=vector_hits,
                vector_hits_count=len(vector_hits),
            )
        )

    matches.sort(key=lambda item: float(item.score), reverse=True)
    matches = matches[:top_k]

    return SearchByImageResponse(top_k=top_k, min_score=min_score, category_filter=category_filter, matches=matches)
