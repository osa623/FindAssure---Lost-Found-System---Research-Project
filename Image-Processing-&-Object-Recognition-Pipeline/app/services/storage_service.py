import json
import logging
import uuid
import numpy as np
from sqlalchemy.orm import Session
from app.models.item_models import ItemRecord, ViewEvidence, EmbeddingRecord
from app.core.redis_client import get_redis_client

# Configure logging
logger = logging.getLogger(__name__)

class StorageService:
    def __init__(self, db: Session):
        self.db = db
        self.redis_client = get_redis_client()

    def store_multiview_result(self, item_id, per_view_results, fused_profile, fused_vector, faiss_id) -> dict:
        """
        Stores the processed item data into PostgreSQL and caches the profile in Redis.
        """
        try:
            # --- 1. DB Transaction ---
            
            # Ensure item_id is a UUID object for SQLAlchemy
            if isinstance(item_id, str):
                item_id_uuid = uuid.UUID(item_id)
            else:
                item_id_uuid = item_id

            # Create ItemRecord
            item_record = ItemRecord(
                id=item_id_uuid,
                category=fused_profile.get("category", "Unknown"),
                best_view_index=fused_profile.get("best_view_index", 0),
                attributes_json=fused_profile,  # Storing full profile/attributes
                defects_json=fused_profile.get("defects", {})
            )
            self.db.add(item_record)

            # Create ViewEvidence records
            for i, view_data in enumerate(per_view_results):
                resolved_view_index = view_data.get("view_index", i)
                evidence = ViewEvidence(
                    item_id=item_id_uuid,
                    view_index=resolved_view_index,
                    filename=view_data.get("filename", ""),
                    caption=view_data.get("caption", ""),
                    ocr_text=view_data.get("ocr_text", ""),
                    quality_score=view_data.get("quality_score", 0.0),
                    bbox_json=view_data.get("detections", []),
                    grounded_json=view_data.get("grounding", [])
                )
                self.db.add(evidence)

            # Create EmbeddingRecord
            # Note: fused_vector is typically a numpy array or list
            dim = len(fused_vector) if fused_vector is not None else 0
            
            vec_bytes = None
            if fused_vector is not None:
                vec_bytes = np.asarray(fused_vector, dtype=np.float32).tobytes()

            embedding_record = EmbeddingRecord(
                item_id=item_id_uuid,
                view_index=None,  # Represents the fused/master view
                dim=dim,
                faiss_id=faiss_id,
                vector_bytes=vec_bytes,
            )
            self.db.add(embedding_record)

            # Commit the transaction
            self.db.commit()

            # --- 2. Redis Cache ---
            cache_key = f"item:{str(item_id_uuid)}"
            try:
                if self.redis_client:
                    # Specific cache logic: Expiry 1 day (86400 seconds)
                    self.redis_client.setex(
                        name=cache_key,
                        time=86400,
                        value=json.dumps(fused_profile, default=str)
                    )
            except Exception as e:
                # Log usage warning but do not fail the main storage operation
                logger.warning(f"Redis cache set failed for {cache_key}: {e}")
                cache_key = None

            return {"stored": True, "cache_key": cache_key}

        except Exception as e:
            self.db.rollback()
            logger.error(f"Database storage failed for item {item_id}: {e}")
            return {"stored": False, "error": str(e)}

    def store_pp1_result(self, item_id, result: dict) -> dict:
        """
        Stores a PP1 single-image analysis result into PostgreSQL and caches in Redis.
        """
        try:
            if isinstance(item_id, str):
                item_id_uuid = uuid.UUID(item_id)
            else:
                item_id_uuid = item_id

            item_record = ItemRecord(
                id=item_id_uuid,
                category=result.get("label", "Unknown"),
                best_view_index=0,
                attributes_json={
                    "label": result.get("label"),
                    "color": result.get("color"),
                    "ocr_text": result.get("ocr_text"),
                    "ocr_text_display": result.get("ocr_text_display"),
                    "ocr_lines": result.get("ocr_lines"),
                    "ocr_layout_source": result.get("ocr_layout_source"),
                    "final_description": result.get("final_description"),
                    "detailed_description": result.get("detailed_description"),
                    "description_source": result.get("description_source"),
                    "detailed_description_source": result.get("detailed_description_source"),
                    "description_evidence_used": result.get("description_evidence_used"),
                    "description_filters_applied": result.get("description_filters_applied"),
                    "description_word_count": result.get("description_word_count"),
                    "category_details": result.get("category_details", {}),
                    "key_count": result.get("key_count"),
                    "tags": result.get("tags", []),
                    "confidence": result.get("confidence"),
                    "status": result.get("status"),
                    "detection_source": (result.get("raw") or {}).get("detection_source"),
                },
                defects_json=result.get("category_details", {}).get("defects", {}),
            )
            self.db.add(item_record)

            evidence = ViewEvidence(
                item_id=item_id_uuid,
                view_index=0,
                filename=result.get("image", {}).get("filename", ""),
                caption=result.get("final_description") or "",
                ocr_text=result.get("ocr_text") or "",
                quality_score=float(result.get("confidence", 0.0)),
                bbox_json=[{"bbox": result.get("bbox"), "label": result.get("label")}] if result.get("bbox") else [],
                grounded_json=result.get("category_details", {}).get("features", []),
            )
            self.db.add(evidence)

            embeddings = result.get("embeddings", {})
            vec_128 = embeddings.get("vector_128d", [])

            vec_bytes = None
            if vec_128:
                vec_bytes = np.asarray(vec_128, dtype=np.float32).tobytes()

            embedding_record = EmbeddingRecord(
                item_id=item_id_uuid,
                view_index=0,
                dim=len(vec_128),
                faiss_id=None,
                vector_bytes=vec_bytes,
            )
            self.db.add(embedding_record)

            self.db.commit()

            cache_key = f"item:{str(item_id_uuid)}"
            try:
                if self.redis_client:
                    cache_payload = {
                        "label": result.get("label"),
                        "color": result.get("color"),
                        "final_description": result.get("final_description"),
                        "detailed_description": result.get("detailed_description"),
                        "status": result.get("status"),
                    }
                    self.redis_client.setex(
                        name=cache_key,
                        time=86400,
                        value=json.dumps(cache_payload, default=str),
                    )
            except Exception as e:
                logger.warning(f"Redis cache set failed for {cache_key}: {e}")
                cache_key = None

            return {"stored": True, "cache_key": cache_key}

        except Exception as e:
            self.db.rollback()
            logger.error(f"PP1 database storage failed for item {item_id}: {e}")
            return {"stored": False, "error": str(e)}
