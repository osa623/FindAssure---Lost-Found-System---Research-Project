from typing import Any, Dict, List, Optional
from PIL import Image
import numpy as np
import os
import re
import time
import uuid
import logging

from app.services.yolo_service import YoloService
from app.services.florence_service import FlorenceService
from app.services.gemini_reasoner import (
    GeminiReasoner,
    GeminiFatalError,
    GeminiTransientError,
    REASONING_FAILED_MESSAGE,
    RETRYABLE_UNAVAILABLE_MESSAGE,
)
from app.services.dino_embedder import DINOEmbedder
from app.services.detection_arbiter import should_run_florence_od, arbitrate
from app.domain.color_utils import normalize_color
from app.domain.label_keywords import (
    CATEGORY_KEYWORDS,
    KEYWORD_SOURCE_WEIGHTS,
    NEGATIVE_KEYWORDS,
    NEGATIVE_KEYWORD_WEIGHT,
)
from app.config.settings import settings
from app.domain.category_specs import canonicalize_label
# from app.domain.category_specs import ALLOWED_LABELS # Removed restriction

logger = logging.getLogger(__name__)

class UnifiedPipeline:
    LABEL_RERANK_TOPK = 5
    LABEL_RERANK_KEYWORDS: Dict[str, List[str]] = CATEGORY_KEYWORDS
    LABEL_RERANK_SOURCE_WEIGHTS: Dict[str, int] = KEYWORD_SOURCE_WEIGHTS
    LABEL_RERANK_MIN_WINNER_SCORE = int(settings.LABEL_RERANK_MIN_WINNER_SCORE)
    LABEL_RERANK_MIN_MARGIN = int(settings.LABEL_RERANK_MIN_MARGIN)

    def __init__(
        self,
        yolo: Optional[YoloService] = None,
        florence: Optional[FlorenceService] = None,
        gemini: Optional[GeminiReasoner] = None,
        dino: Optional[DINOEmbedder] = None,
    ):
        # Initialize services
        # Note: Models are loaded lazily or on first use in their respective services
        self.yolo = yolo or YoloService()
        self.florence = florence or FlorenceService()
        self.gemini = gemini or GeminiReasoner()
        self.dino = dino or DINOEmbedder()
        self.perf_profile = str(settings.PERF_PROFILE).lower()
        self.max_detections = max(1, int(settings.PP1_MAX_DETECTIONS))
        self.include_gemini_image = bool(settings.PP1_GEMINI_INCLUDE_IMAGE)

        # Gemini circuit breaker state
        self._gemini_fail_count: int = 0
        self._gemini_open_until: float = 0.0

    @staticmethod
    def _validate_embedding(vec, label: str = "embedding") -> bool:
        """Return True if the vector is usable (no NaN/Inf/all-zeros)."""
        arr = np.asarray(vec, dtype=np.float32)
        if np.isnan(arr).any() or np.isinf(arr).any():
            logger.warning("PP1_%s_INVALID: NaN/Inf detected — skipping", label)
            return False
        if np.allclose(arr, 0):
            logger.warning("PP1_%s_INVALID: all-zeros — skipping", label)
            return False
        return True

    def _empty_response(self, status: str, message: str) -> Dict[str, Any]:
        """Helper to return a standardized empty/rejected response."""
        return {
            "status": status,
            "message": message,
            "item_id": str(uuid.uuid4()),
            "image": { "image_id": str(uuid.uuid4()), "filename": None },
            "label": None,
            "confidence": None,
            "bbox": None,
            "color": None,
            "ocr_text": "",
            "final_description": None,
            "category_details": {
                "features": [],
                "defects": [],
                "attachments": []
            },
            "key_count": None,
            "tags": [],
            "embeddings": {
                "vector_128d": [],
                "vector_dinov2": []
            },
            "raw": {
                "yolo": None,
                "florence": None,
                "gemini": None
            }
        }

    @staticmethod
    def _normalize_text_for_rerank(text: Any) -> str:
        if text is None:
            return ""
        if isinstance(text, str):
            return text.lower()
        if isinstance(text, (list, tuple, set)):
            return " ".join(str(x) for x in text if x is not None).lower()
        return str(text).lower()

    def _collect_rerank_texts(self, analysis: Dict[str, Any]) -> Dict[str, str]:
        raw = analysis.get("raw", {})
        grounding_raw = raw.get("grounding_raw", {}) if isinstance(raw, dict) else {}
        grounding_labels = grounding_raw.get("labels", []) if isinstance(grounding_raw, dict) else []
        caption_text = analysis.get("caption", "")
        if not caption_text and isinstance(raw, dict):
            caption_text = raw.get("caption_primary", "")
        return {
            "caption": self._normalize_text_for_rerank(caption_text),
            "ocr": self._normalize_text_for_rerank(analysis.get("ocr_text", "")),
            "grounding": self._normalize_text_for_rerank(grounding_labels),
        }

    @staticmethod
    def _text_has_keyword(text: str, keyword: str) -> bool:
        if not text:
            return False
        phrase = str(keyword or "").strip().lower()
        if not phrase:
            return False
        pattern = r"\b" + re.escape(phrase).replace(r"\ ", r"\s+") + r"\b"
        return re.search(pattern, text) is not None

    def _caption_confirms_yolo_label(self, label: str, analysis: Dict[str, Any]) -> bool:
        """Return True if caption or OCR text contains at least one keyword for *label*."""
        keywords = CATEGORY_KEYWORDS.get(str(label), [])
        if not keywords:
            return True  # no keywords defined → assume confirmed
        raw = analysis.get("raw_output", analysis)
        caption = str(raw.get("caption_primary", "") if isinstance(raw, dict) else analysis.get("caption", "")).lower()
        ocr = str(analysis.get("ocr_text", "")).lower()
        for kw in keywords:
            if self._text_has_keyword(caption, kw) or self._text_has_keyword(ocr, kw):
                return True
        return False

    def _score_label_keywords(self, label: str, texts: Dict[str, str], caption_is_generic: bool = False) -> Dict[str, Any]:
        keywords = self.LABEL_RERANK_KEYWORDS.get(str(label), [])
        matched_keywords: Dict[str, List[str]] = {"caption": [], "ocr": [], "grounding": []}
        total = 0

        for source in ("caption", "ocr", "grounding"):
            source_text = texts.get(source, "")
            for kw in keywords:
                if self._text_has_keyword(source_text, kw):
                    matched_keywords[source].append(kw)
                elif source == "ocr" and len(kw) >= 3 and kw.lower() in source_text:
                    matched_keywords[source].append(kw)
            weight = int(self.LABEL_RERANK_SOURCE_WEIGHTS.get(source, 0))
            # Halve caption weight when the caption is too generic to be reliable
            if source == "caption" and caption_is_generic:
                weight = 0
            total += len(matched_keywords[source]) * weight

        # Negative-keyword penalty (caption only)
        neg_kws = NEGATIVE_KEYWORDS.get(str(label), [])
        caption_text = texts.get("caption", "")
        neg_hits = sum(1 for nk in neg_kws if self._text_has_keyword(caption_text, nk))
        if neg_hits:
            total = max(0, total - neg_hits * NEGATIVE_KEYWORD_WEIGHT)

        return {"score": total, "matched_keywords": matched_keywords}

    def _rerank_label(self, top1_label: str, candidates: List[Any], analysis: Dict[str, Any]) -> Dict[str, Any]:
        candidate_labels: List[str] = []
        best_conf_by_label: Dict[str, float] = {}
        for det in candidates:
            label = str(getattr(det, "label", "") or "")
            if not label:
                continue
            if label not in candidate_labels:
                candidate_labels.append(label)
            conf = float(getattr(det, "confidence", 0.0))
            prev = best_conf_by_label.get(label)
            if prev is None or conf > prev:
                best_conf_by_label[label] = conf

        texts = self._collect_rerank_texts(analysis)
        caption_is_generic = bool((analysis.get("raw") or {}).get("caption_is_generic", False))
        scores_by_label = {}
        # Score YOLO candidate labels
        for label in candidate_labels:
            scores_by_label[label] = self._score_label_keywords(label, texts, caption_is_generic=caption_is_generic)
        # Also score all known labels not already in candidates
        for label in self.LABEL_RERANK_KEYWORDS:
            if label not in scores_by_label:
                details = self._score_label_keywords(label, texts, caption_is_generic=caption_is_generic)
                if int(details.get("score", 0)) >= self.LABEL_RERANK_MIN_WINNER_SCORE:
                    scores_by_label[label] = details
                    if label not in candidate_labels:
                        candidate_labels.append(label)
                        best_conf_by_label[label] = 0.0
        top1_score = int(scores_by_label.get(top1_label, {}).get("score", 0))

        if not candidate_labels:
            return {
                "final_label": top1_label,
                "winner_label": top1_label,
                "winner_score": top1_score,
                "top1_score": top1_score,
                "applied": False,
                "reason": "no_candidates",
                "scores_by_label": scores_by_label,
            }

        winner_label = sorted(
            candidate_labels,
            key=lambda label: (
                -int(scores_by_label[label]["score"]),
                -float(best_conf_by_label.get(label, 0.0)),
                label,
            ),
        )[0]
        winner_score = int(scores_by_label[winner_label]["score"])
        margin = winner_score - top1_score
        contradiction_pair = (
            top1_label in self.LABEL_RERANK_KEYWORDS
            and winner_label in self.LABEL_RERANK_KEYWORDS
        )
        # Relax margin requirement when OCR evidence strongly supports winner
        winner_ocr_hits = len(scores_by_label.get(winner_label, {}).get("matched_keywords", {}).get("ocr", []))
        top1_ocr_hits = len(scores_by_label.get(top1_label, {}).get("matched_keywords", {}).get("ocr", []))
        effective_min_margin = 1 if (winner_ocr_hits > 0 and top1_ocr_hits == 0) else self.LABEL_RERANK_MIN_MARGIN
        applied = (
            winner_label != top1_label
            and winner_score >= self.LABEL_RERANK_MIN_WINNER_SCORE
            and margin >= effective_min_margin
            and contradiction_pair
        )

        if applied:
            reason = "override_strong_contradiction"
        elif winner_label == top1_label:
            reason = "top1_best_score"
        elif winner_score < self.LABEL_RERANK_MIN_WINNER_SCORE:
            reason = "winner_score_below_threshold"
        elif margin < effective_min_margin:
            reason = "margin_below_threshold"
        elif not contradiction_pair:
            reason = "not_contradiction_pair"
        else:
            reason = "no_override"

        return {
            "final_label": winner_label if applied else top1_label,
            "winner_label": winner_label,
            "winner_score": winner_score,
            "top1_score": top1_score,
            "applied": applied,
            "reason": reason,
            "scores_by_label": scores_by_label,
        }

    def _derive_florence_strong_label(self, analysis: Dict[str, Any]) -> Optional[str]:
        texts = self._collect_rerank_texts(analysis)
        caption_is_generic = bool((analysis.get("raw") or {}).get("caption_is_generic", False))
        scored: List[Dict[str, Any]] = []
        for label in self.LABEL_RERANK_KEYWORDS:
            details = self._score_label_keywords(label, texts, caption_is_generic=caption_is_generic)
            matched = details.get("matched_keywords", {})
            caption_hits = len(matched.get("caption", []))
            ocr_hits = len(matched.get("ocr", []))
            grounding_hits = len(matched.get("grounding", []))
            score = int(details.get("score", 0))
            if score >= self.LABEL_RERANK_MIN_WINNER_SCORE and (caption_hits + ocr_hits + grounding_hits) > 0:
                scored.append(
                    {
                        "label": label,
                        "score": score,
                        "caption_ocr_hits": caption_hits + ocr_hits,
                    }
                )

        if not scored:
            return None

        scored.sort(
            key=lambda item: (
                -int(item["score"]),
                -int(item["caption_ocr_hits"]),
                str(item["label"]),
            )
        )
        return str(scored[0]["label"])

    def _labels_incompatible(self, yolo_label: str, florence_label: str) -> bool:
        yolo = str(yolo_label or "")
        florence = str(florence_label or "")
        return (
            yolo != florence
            and yolo in self.LABEL_RERANK_KEYWORDS
            and florence in self.LABEL_RERANK_KEYWORDS
        )

    @staticmethod
    def _unique_labels(labels: List[str]) -> List[str]:
        seen = set()
        out: List[str] = []
        for label in labels:
            text = str(label or "").strip()
            if not text or text in seen:
                continue
            seen.add(text)
            out.append(text)
        return out

    def _build_florence_primary_response(
        self,
        image: Image,
        filename: str,
        profile: str,
        detect_ms: float,
        request_start: float,
    ) -> Optional[List[Dict[str, Any]]]:
        """
        Florence-primary detection path: runs when YOLO returns no detections.
        Uses Florence OD to detect objects, then Florence analyze_crop for
        caption/OCR/grounding. Skips Gemini — uses Florence caption as description.
        Returns None if Florence also finds nothing.
        """
        florence_od_start = time.perf_counter()
        try:
            florence_detections = self.florence.detect_and_describe(image)
        except Exception as exc:
            logger.warning("PP1_FLORENCE_PRIMARY_OD_ERROR: %s", exc)
            return None
        florence_od_ms = (time.perf_counter() - florence_od_start) * 1000.0

        if not florence_detections:
            return None

        # Take the first detection with a valid canonical label
        best_det = florence_detections[0]
        florence_label = canonicalize_label(str(getattr(best_det, "label", ""))) or str(getattr(best_det, "label", ""))
        florence_conf = float(getattr(best_det, "confidence", 0.9))
        florence_bbox = tuple(getattr(best_det, "bbox", (0, 0, 0, 0)))

        if not florence_label:
            return None

        # Crop with padding
        w, h = image.size
        x1, y1, x2, y2 = florence_bbox
        x1 = max(0, min(w, int(x1)))
        y1 = max(0, min(h, int(y1)))
        x2 = max(0, min(w, int(x2)))
        y2 = max(0, min(h, int(y2)))
        if x2 <= x1 or y2 <= y1:
            # Fallback to full image if bbox is invalid
            crop = image
            florence_bbox = (0, 0, w, h)
        else:
            # Apply 10% padding
            pad_w = int(round((x2 - x1) * 0.10))
            pad_h = int(round((y2 - y1) * 0.10))
            px1 = max(0, x1 - pad_w)
            py1 = max(0, y1 - pad_h)
            px2 = min(w, x2 + pad_w)
            py2 = min(h, y2 + pad_h)
            crop = image.crop((px1, py1, px2, py2))

        # Full Florence extraction on the crop
        florence_start = time.perf_counter()
        analysis = self.florence.analyze_crop(
            crop,
            canonical_label=florence_label,
            profile=profile,
        )
        florence_extract_ms = (time.perf_counter() - florence_start) * 1000.0

        # Build description from Florence caption (skip Gemini)
        caption = str(analysis.get("caption", "") or "").strip()
        color = analysis.get("color_vqa") or None
        ocr_text = str(analysis.get("ocr_text", "") or "")
        grounded_features = analysis.get("grounded_features", [])
        grounded_defects = analysis.get("grounded_defects", [])
        grounded_attachments = analysis.get("grounded_attachments", [])
        key_count = analysis.get("key_count")

        final_description = caption if caption else None

        # Enrich short captions with a targeted VQA call
        if final_description and len(final_description.split()) < 6:
            try:
                enrich_q = (
                    f"Describe the {florence_label} in this image in 2-3 sentences. "
                    "Include color, condition, and notable features."
                )
                enriched = self.florence.vqa(crop, enrich_q, profile=profile)
                if enriched and len(enriched.split()) >= 5:
                    final_description = enriched.strip()
                    analysis["caption_enriched"] = True
            except Exception as e:
                logger.debug("Florence-primary caption enrichment failed: %s", e)

        # Generate tags from Florence evidence
        tags: List[str] = []
        if florence_label:
            tags.append(florence_label.lower())
        if color and str(color).lower() not in ("unknown", "none", ""):
            tags.append(str(color).lower())

        # DINOv2 embeddings
        embeddings_start = time.perf_counter()
        vec_768_list: List[float] = []
        vec_128_list: List[float] = []
        try:
            vec_768, vec_128 = self.dino.embed_both(crop)
            if self._validate_embedding(vec_768, "florence_primary_768") and self._validate_embedding(vec_128, "florence_primary_128"):
                vec_768_list = vec_768.tolist()
                vec_128_list = vec_128.tolist()
        except Exception as e:
            logger.warning("Florence-primary embedding failed: %s", e)
        embeddings_ms = (time.perf_counter() - embeddings_start) * 1000.0

        total_ms = (time.perf_counter() - request_start) * 1000.0
        timings = {
            "detect_ms": round(detect_ms, 2),
            "florence_od_ms": round(florence_od_ms, 2),
            "florence_extract_ms": round(florence_extract_ms, 2),
            "embeddings_ms": round(embeddings_ms, 2),
            "total_ms": round(total_ms, 2),
        }

        response = {
            "status": "accepted",
            "message": "Florence-primary detection (YOLO did not detect this category)",
            "item_id": str(uuid.uuid4()),
            "image": {
                "image_id": str(uuid.uuid4()),
                "filename": filename,
            },
            "label": florence_label,
            "confidence": florence_conf,
            "bbox": florence_bbox,
            "color": color,
            "ocr_text": ocr_text,
            "final_description": final_description,
            "category_details": {
                "features": grounded_features if isinstance(grounded_features, list) else [],
                "defects": grounded_defects if isinstance(grounded_defects, list) else [],
                "attachments": grounded_attachments if isinstance(grounded_attachments, list) else [],
            },
            "key_count": key_count,
            "tags": tags,
            "embeddings": {
                "vector_128d": vec_128_list,
                "vector_dinov2": vec_768_list,
            },
            "processing_time": round(total_ms, 2),
            "raw": {
                "detection_source": "florence_primary",
                "yolo": None,
                "florence": analysis,
                "florence_od_fallback": {
                    "triggered": True,
                    "reason": "yolo_empty",
                    "winner_source": "florence",
                    "florence_detections": [
                        {
                            "label": str(getattr(d, "label", "")),
                            "confidence": float(getattr(d, "confidence", 0.0)),
                            "bbox": tuple(getattr(d, "bbox", (0, 0, 0, 0))),
                        }
                        for d in florence_detections
                    ],
                },
                "gemini": None,
                "gemini_warnings": ["Gemini skipped — Florence-primary detection path"],
                "timings": timings,
            },
        }
        return [response]

    def process_pp1(self, image_path: str) -> List[Dict[str, Any]]:
        """
        Phase 1 Pipeline: Single Image Analysis
        
        Steps:
        1. Detect object using YOLOv8m (Local).
        2. Crop to each detection.
        3. Analyze crop with Florence-2 (Caption, OCR, VQA, Grounding).
           - Grounding uses candidates from CATEGORY_SPECS.
        4. Reason with Gemini (Evidence-Locked) to produce final JSON.
        5. Generate Embeddings (DINOv2).
        """
        request_start = time.perf_counter()

        if not os.path.exists(image_path):
            return [self._empty_response("rejected", f"Image file not found: {image_path}")]

        try:
            image = Image.open(image_path).convert("RGB")
            logger.info("PP1_IMAGE_OPEN: OK path=%s format=%s size=%s", image_path, image.format, image.size)
        except Exception as e:
            # Dump magic bytes to identify the actual file format in logs
            try:
                with open(image_path, "rb") as _f:
                    _magic = _f.read(16).hex()
            except Exception:
                _magic = "unreadable"
            logger.error(
                "PP1_IMAGE_OPEN_FAILED: path=%s error=%r magic_bytes=%s",
                image_path, str(e), _magic
            )
            return [self._empty_response("rejected", f"Failed to open image: {str(e)}")]

        filename = os.path.basename(image_path)
        profile = self.perf_profile
        include_gemini_image = self.include_gemini_image or profile in {"balanced", "quality"}

        # 1. Detect
        detect_start = time.perf_counter()
        all_detections = self.yolo.detect_objects(
            image,
            max_detections=max(self.max_detections, self.LABEL_RERANK_TOPK),
        )
        detect_ms = (time.perf_counter() - detect_start) * 1000.0
        
        if not all_detections:
            # Florence-primary path: YOLO found nothing, let Florence try
            florence_result = self._build_florence_primary_response(
                image, filename, profile, detect_ms, request_start,
            )
            if florence_result:
                logger.info("PP1_FLORENCE_PRIMARY: YOLO empty, Florence detected '%s'",
                            florence_result[0].get("label", "unknown"))
                return florence_result
            resp = self._empty_response("rejected", "No object detected by YOLO or Florence.")
            resp["image"]["filename"] = filename
            return [resp]

        # Sort by confidence (descending) and process only top-N detections
        all_detections.sort(key=lambda x: x.confidence, reverse=True)
        detections = all_detections[: self.max_detections]
        rerank_candidates = all_detections[: self.LABEL_RERANK_TOPK]
        
        results: List[Dict[str, Any]] = []
        
        for detection_idx, detection in enumerate(detections):
            det_start = time.perf_counter()

            # 2. Crop
            # Ensure bbox is within image bounds
            x1, y1, x2, y2 = detection.bbox
            w, h = image.size
            x1 = max(0, x1)
            y1 = max(0, y1)
            x2 = min(w, x2)
            y2 = min(h, y2)
            
            if x2 <= x1 or y2 <= y1:
                 continue

            # Minimum area gate: skip tiny detections (noise / partial bboxes)
            bbox_area = (x2 - x1) * (y2 - y1)
            image_area = w * h
            if image_area > 0 and (bbox_area / image_area) < 0.005:
                logger.info(
                    "PP1_SKIP_TINY detection=%s area_ratio=%.4f",
                    detection.label, bbox_area / image_area,
                )
                continue

            crop = image.crop((x1, y1, x2, y2))

            # 3. Analyze Crop (Caption, OCR, VQA, Grounding)
            florence_start = time.perf_counter()
            analysis = self.florence.analyze_crop(
                crop,
                canonical_label=detection.label,
                profile=profile,
            )
            florence_ms = (time.perf_counter() - florence_start) * 1000.0

            final_detection = detection
            final_label = detection.label
            label_rerank_ms = 0.0
            label_lock = False
            florence_strong_label: Optional[str] = None
            gemini_warnings: List[str] = []
            label_rerank_payload: Dict[str, Any] = {
                "enabled": False,
                "applied": False,
                "initial_label": detection.label,
                "final_label": detection.label,
                "topk_candidates": [],
                "scores_by_label": {},
                "winner_label": detection.label,
                "winner_score": 0,
                "top1_score": 0,
                "selected_bbox_source": "top1",
                "reason": "not_applied_non_primary_detection",
            }
            if detection_idx == 0:
                rerank_start = time.perf_counter()
                rerank_decision = self._rerank_label(
                    top1_label=detection.label,
                    candidates=rerank_candidates,
                    analysis=analysis,
                )
                final_label = str(rerank_decision["final_label"])
                selected_bbox_source = "top1"
                if bool(rerank_decision.get("applied")):
                    matching = [det for det in rerank_candidates if str(getattr(det, "label", "")) == final_label]
                    if matching:
                        final_detection = max(matching, key=lambda det: float(getattr(det, "confidence", 0.0)))
                        selected_bbox_source = "label_best_conf"
                label_rerank_ms = (time.perf_counter() - rerank_start) * 1000.0
                label_rerank_payload = {
                    "enabled": True,
                    "applied": bool(rerank_decision.get("applied", False)),
                    "initial_label": detection.label,
                    "final_label": final_label,
                    "topk_candidates": [
                        {
                            "label": str(getattr(det, "label", "")),
                            "confidence": float(getattr(det, "confidence", 0.0)),
                            "bbox": tuple(getattr(det, "bbox", ())),
                        }
                        for det in rerank_candidates
                    ],
                    "scores_by_label": rerank_decision.get("scores_by_label", {}),
                    "winner_label": rerank_decision.get("winner_label"),
                    "winner_score": int(rerank_decision.get("winner_score", 0)),
                    "top1_score": int(rerank_decision.get("top1_score", 0)),
                    "selected_bbox_source": selected_bbox_source,
                    "reason": str(rerank_decision.get("reason", "")),
                }

                # Flag low-confidence labels: no keyword evidence AND weak YOLO detection
                winner_score = int(rerank_decision.get("winner_score", 0))
                yolo_conf = float(detection.confidence)
                if winner_score == 0 and yolo_conf < 0.85:
                    label_rerank_payload["low_confidence_label"] = True

                florence_strong_label = self._derive_florence_strong_label(analysis)
                if (
                    florence_strong_label
                    and self._labels_incompatible(detection.label, florence_strong_label)
                ):
                    label_lock = True
                    final_label = florence_strong_label
                    matching = [
                        det for det in rerank_candidates
                        if str(getattr(det, "label", "")) == final_label
                    ]
                    if matching:
                        final_detection = max(
                            matching,
                            key=lambda det: float(getattr(det, "confidence", 0.0)),
                        )
                        label_rerank_payload["selected_bbox_source"] = "label_best_conf"
                    else:
                        label_rerank_payload["selected_bbox_source"] = "top1"
                    label_rerank_payload["final_label"] = final_label
                    label_rerank_payload["reason"] = "canonical_lock_florence_strong"
                    label_rerank_payload["canonical_lock_applied"] = True
                else:
                    label_rerank_payload["canonical_lock_applied"] = False
            else:
                label_rerank_payload["canonical_lock_applied"] = False

            if florence_strong_label is None:
                florence_strong_label = self._derive_florence_strong_label(analysis)

            label_candidates = self._unique_labels(
                [str(getattr(det, "label", "")) for det in rerank_candidates]
                + ([florence_strong_label] if florence_strong_label else [])
            )

            # ── Florence OD Fallback ─────────────────────────────────────
            florence_od_payload: Dict[str, Any] = {"triggered": False, "reason": "not_checked"}
            florence_od_ms = 0.0
            if detection_idx == 0:
                # Skip Florence OD when YOLO is very confident + bbox is substantial
                # AND caption/OCR evidence confirms the YOLO label
                top1_conf = float(detection.confidence)
                bbox_area_ratio = (x2 - x1) * (y2 - y1) / max(1, w * h)
                caption_confirms = self._caption_confirms_yolo_label(final_label, analysis)
                if top1_conf >= 0.88 and bbox_area_ratio >= 0.05 and caption_confirms:
                    florence_od_payload = {
                        "triggered": False,
                        "reason": "skipped_high_confidence",
                        "yolo_confidence": top1_conf,
                        "bbox_area_ratio": round(bbox_area_ratio, 4),
                    }
                elif top1_conf >= 0.88 and bbox_area_ratio >= 0.05 and not caption_confirms:
                    # High-confidence YOLO but caption does not confirm — force OD
                    trigger_reason = "caption_did_not_confirm"
                    florence_od_start = time.perf_counter()
                    try:
                        florence_enriched = self.florence.detect_and_describe(image)
                        arbiter_result = arbitrate(all_detections, florence_enriched, analysis)
                        florence_od_ms = (time.perf_counter() - florence_od_start) * 1000.0

                        if arbiter_result.winner_source == "florence":
                            final_label = arbiter_result.final_label
                            final_detection = type(detection)(
                                label=arbiter_result.final_label,
                                confidence=arbiter_result.final_confidence,
                                bbox=arbiter_result.final_bbox,
                            )
                            label_rerank_payload["final_label"] = final_label
                            label_rerank_payload["selected_bbox_source"] = "florence_od_arbiter"
                            # Re-run Florence analyze_crop on possibly new crop
                            nx1, ny1, nx2, ny2 = arbiter_result.final_bbox
                            nx1, ny1 = max(0, nx1), max(0, ny1)
                            nx2, ny2 = min(w, nx2), min(h, ny2)
                            if nx2 > nx1 and ny2 > ny1:
                                crop = image.crop((nx1, ny1, nx2, ny2))
                                analysis = self.florence.analyze_crop(
                                    crop,
                                    canonical_label=final_label,
                                    profile=profile,
                                )

                        florence_od_payload = {
                            "triggered": True,
                            "reason": trigger_reason,
                            "winner_source": arbiter_result.winner_source,
                            "florence_detections": arbiter_result.florence_detections,
                            "arbiter_metadata": arbiter_result.metadata,
                        }
                    except Exception as exc:
                        florence_od_ms = (time.perf_counter() - florence_od_start) * 1000.0
                        logger.warning("PP1_FLORENCE_OD_FALLBACK_ERROR: %s", exc)
                        florence_od_payload = {
                            "triggered": True,
                            "reason": trigger_reason,
                            "error": str(exc),
                        }
                else:
                    should_run, trigger_reason = should_run_florence_od()
                    if should_run:
                        florence_od_start = time.perf_counter()
                        try:
                            florence_enriched = self.florence.detect_and_describe(image)
                            arbiter_result = arbitrate(all_detections, florence_enriched, analysis)
                            florence_od_ms = (time.perf_counter() - florence_od_start) * 1000.0

                            if arbiter_result.winner_source == "florence":
                                final_label = arbiter_result.final_label
                                final_detection = type(detection)(
                                    label=arbiter_result.final_label,
                                    confidence=arbiter_result.final_confidence,
                                    bbox=arbiter_result.final_bbox,
                                )
                                label_rerank_payload["final_label"] = final_label
                                label_rerank_payload["selected_bbox_source"] = "florence_od_arbiter"
                                nx1, ny1, nx2, ny2 = arbiter_result.final_bbox
                                nx1, ny1 = max(0, nx1), max(0, ny1)
                                nx2, ny2 = min(w, nx2), min(h, ny2)
                                if nx2 > nx1 and ny2 > ny1:
                                    crop = image.crop((nx1, ny1, nx2, ny2))
                                    analysis = self.florence.analyze_crop(
                                        crop,
                                        canonical_label=final_label,
                                        profile=profile,
                                    )

                            florence_od_payload = {
                                "triggered": True,
                                "reason": trigger_reason,
                                "winner_source": arbiter_result.winner_source,
                                "florence_detections": arbiter_result.florence_detections,
                                "arbiter_metadata": arbiter_result.metadata,
                            }
                        except Exception as exc:
                            florence_od_ms = (time.perf_counter() - florence_od_start) * 1000.0
                            logger.warning("PP1_FLORENCE_OD_FALLBACK_ERROR: %s", exc)
                            florence_od_payload = {
                                "triggered": True,
                                "reason": trigger_reason,
                                "error": str(exc),
                            }
                    else:
                        florence_od_payload = {"triggered": False, "reason": trigger_reason}

            # Update label candidates if Florence OD changed the label
            if florence_od_payload.get("triggered") and florence_od_payload.get("winner_source") == "florence":
                label_candidates = self._unique_labels(
                    label_candidates + [final_label]
                )
                florence_strong_label = final_label

            # 4. Construct Evidence JSON for Gemini
            evidence = {
                "detection": {
                    "label": final_label,
                    "confidence": final_detection.confidence,
                    "bbox": final_detection.bbox
                },
                "canonical_label": final_label,
                "label_candidates": label_candidates,
                "label_lock": label_lock,
                "crop_analysis": analysis
            }

            # 5. Reason (Gemini)
            gemini_start = time.perf_counter()
            gemini_error_meta = None

            # Circuit breaker: skip Gemini if too many consecutive failures
            _cb_open = time.time() < self._gemini_open_until
            if _cb_open:
                logger.warning(
                    "PP1_GEMINI_CIRCUIT_BREAKER_OPEN: skipping Gemini for %d more seconds",
                    int(self._gemini_open_until - time.time()),
                )
                fallback_color = analysis.get("color_vqa") or None
                if fallback_color:
                    fallback_color = normalize_color(fallback_color) or fallback_color
                fallback_desc = analysis.get("caption") or None
                gemini_result = {
                    "status": "accepted_degraded",
                    "message": "Gemini circuit breaker open — accepted with Florence-only data.",
                    "label": final_label,
                    "color": fallback_color,
                    "category_details": {"features": [], "defects": [], "attachments": []},
                    "key_count": None,
                    "final_description": fallback_desc,
                    "tags": [],
                    "degradation_reason": "circuit_breaker_open",
                }
                gemini_warnings.append(
                    "Gemini circuit breaker open — accepted with Florence-only data."
                )

            if not _cb_open:
              try:
                gemini_result = self.gemini.run_phase1(
                    evidence,
                    crop_image=crop if include_gemini_image else None,
                )
                # Success — reset circuit breaker
                self._gemini_fail_count = 0
              except GeminiTransientError as exc:
                logger.warning(
                    "PP1_GEMINI_TRANSIENT_FALLBACK status_code=%s provider_status=%s — using Florence data",
                    exc.status_code,
                    exc.provider_status,
                )
                gemini_error_meta = exc.to_dict()
                self._gemini_fail_count += 1
                if self._gemini_fail_count >= int(settings.GEMINI_CB_FAILURE_THRESHOLD):
                    self._gemini_open_until = time.time() + float(settings.GEMINI_CB_RECOVERY_TIMEOUT_S)
                    logger.warning("PP1_GEMINI_CIRCUIT_BREAKER_TRIPPED after %d failures", self._gemini_fail_count)
                # Build a usable fallback from Florence so the item stays searchable
                fallback_color = analysis.get("color_vqa") or None
                if fallback_color:
                    fallback_color = normalize_color(fallback_color) or fallback_color
                fallback_desc = analysis.get("caption") or None
                gemini_result = {
                    "status": "accepted_degraded",
                    "message": RETRYABLE_UNAVAILABLE_MESSAGE,
                    "label": final_label,
                    "color": fallback_color,
                    "category_details": {"features": [], "defects": [], "attachments": []},
                    "key_count": None,
                    "final_description": fallback_desc,
                    "tags": [],
                    "degradation_reason": "gemini_transient",
                }
                gemini_warnings.append(
                    "Gemini unavailable — accepted with Florence-only data. "
                    "Description and color derived from Florence caption/VQA."
                )
              except GeminiFatalError as exc:
                logger.warning(
                    "PP1_GEMINI_FATAL_FALLBACK status_code=%s provider_status=%s",
                    exc.status_code,
                    exc.provider_status,
                )
                gemini_error_meta = exc.to_dict()
                self._gemini_fail_count += 1
                if self._gemini_fail_count >= int(settings.GEMINI_CB_FAILURE_THRESHOLD):
                    self._gemini_open_until = time.time() + float(settings.GEMINI_CB_RECOVERY_TIMEOUT_S)
                    logger.warning("PP1_GEMINI_CIRCUIT_BREAKER_TRIPPED after %d failures", self._gemini_fail_count)
                # Build Florence-only fallback so the item stays searchable
                fallback_color = analysis.get("color_vqa") or None
                if fallback_color:
                    fallback_color = normalize_color(fallback_color) or fallback_color
                fallback_desc = analysis.get("caption") or None
                gemini_result = {
                    "status": "accepted_degraded",
                    "message": "Gemini authentication/authorization failed — accepted with Florence-only data.",
                    "label": final_label,
                    "color": fallback_color,
                    "category_details": {"features": [], "defects": [], "attachments": []},
                    "key_count": None,
                    "final_description": fallback_desc,
                    "tags": [],
                }
                gemini_warnings.append(
                    "Gemini fatal error (auth) — accepted with Florence-only data. "
                    "Description and color derived from Florence caption/VQA."
                )
              except Exception as exc:
                logger.exception("PP1_GEMINI_UNKNOWN_ERROR")
                self._gemini_fail_count += 1
                if self._gemini_fail_count >= int(settings.GEMINI_CB_FAILURE_THRESHOLD):
                    self._gemini_open_until = time.time() + float(settings.GEMINI_CB_RECOVERY_TIMEOUT_S)
                    logger.warning("PP1_GEMINI_CIRCUIT_BREAKER_TRIPPED after %d failures", self._gemini_fail_count)
                gemini_error_meta = {
                    "type": "gemini_unknown_error",
                    "status_code": None,
                    "retryable": False,
                    "provider_status": None,
                    "message": str(exc),
                }
                gemini_result = {
                    "status": "rejected",
                    "message": REASONING_FAILED_MESSAGE,
                    "label": final_label,
                    "color": None,
                    "category_details": {"features": [], "defects": [], "attachments": []},
                    "key_count": None,
                    "final_description": None,
                    "tags": [],
                }
            gemini_ms = (time.perf_counter() - gemini_start) * 1000.0

            gemini_label_raw = gemini_result.get("label")
            gemini_label = str(gemini_label_raw).strip() if gemini_label_raw is not None else ""

            # Gemini label guard: reject silent label changes
            # If Gemini changed the label but gave no explanation, revert.
            if (
                gemini_label
                and gemini_label != final_label
                and not label_lock
                and not gemini_result.get("label_change_reason")
            ):
                logger.info(
                    "PP1_GEMINI_LABEL_GUARD: Gemini silently changed %s -> %s — reverting",
                    final_label, gemini_label,
                )
                gemini_result["label"] = final_label
                gemini_warnings.append(
                    f"Gemini label change reverted ({gemini_label} -> {final_label}): "
                    "no label_change_reason provided."
                )
                gemini_label = final_label

            if (
                florence_strong_label
                and gemini_label
                and self._labels_incompatible(gemini_label, florence_strong_label)
            ):
                gemini_result["label"] = florence_strong_label
                gemini_warnings.append(
                    "Gemini label overridden from "
                    f"{gemini_label} to {florence_strong_label} due to strong Florence evidence (caption/ocr)."
                )
                matching = [
                    det for det in rerank_candidates
                    if str(getattr(det, "label", "")) == florence_strong_label
                ]
                if matching:
                    final_detection = max(
                        matching,
                        key=lambda det: float(getattr(det, "confidence", 0.0)),
                    )
                final_label = florence_strong_label
            
            # 6. Embeddings (DINOv2) from a single forward pass
            embeddings_start = time.perf_counter()
            vec_768_list = []
            vec_128_list = []
            try:
                vec_768, vec_128 = self.dino.embed_both(crop)
                if self._validate_embedding(vec_768, "yolo_768") and self._validate_embedding(vec_128, "yolo_128"):
                    vec_768_list = vec_768.tolist()
                    vec_128_list = vec_128.tolist()
            except Exception as e:
                logger.warning("Embedding failed: %s", e)
            embeddings_ms = (time.perf_counter() - embeddings_start) * 1000.0

            total_ms = (time.perf_counter() - det_start) * 1000.0
            timings = {
                "detect_ms": round(detect_ms, 2),
                "florence_ms": round(florence_ms, 2),
                "florence_od_ms": round(florence_od_ms, 2),
                "label_rerank_ms": round(label_rerank_ms, 2),
                "gemini_ms": round(gemini_ms, 2),
                "embeddings_ms": round(embeddings_ms, 2),
                "total_ms": round(total_ms, 2),
            }

            # 7. Construct Final Response
            status = gemini_result.get("status", "rejected")
            
            raw_payload = {
                "detection_source": "florence_override" if florence_od_payload.get("winner_source") == "florence" else "yolo",
                "yolo": {
                    "label": detection.label,
                    "confidence": detection.confidence,
                    "bbox": detection.bbox
                },
                "florence": analysis,
                "florence_od_fallback": florence_od_payload,
                "label_rerank": label_rerank_payload,
                "gemini": gemini_result,
                "gemini_warnings": gemini_warnings,
                "timings": timings,
            }
            if gemini_error_meta is not None:
                raw_payload["gemini_error"] = gemini_error_meta

            response = {
                "status": status,
                "message": gemini_result.get("message", "Success" if status == "accepted" else "Rejected by Gemini"),
                "item_id": str(uuid.uuid4()),
                "image": {
                    "image_id": str(uuid.uuid4()),
                    "filename": filename
                },
                "label": gemini_result.get("label") or final_label,
                "confidence": final_detection.confidence,
                "bbox": final_detection.bbox,
                "color": gemini_result.get("color"),
                "ocr_text": analysis.get("ocr_text", ""),
                "final_description": gemini_result.get("final_description"),
                "category_details": gemini_result.get("category_details", {
                    "features": [], "defects": [], "attachments": []
                }),
                "key_count": gemini_result.get("key_count"),
                "tags": gemini_result.get("tags", []),
                "embeddings": {
                    "vector_128d": vec_128_list,
                    "vector_dinov2": vec_768_list
                },
                "processing_time": round(total_ms, 2),
                "raw": raw_payload
            }
            results.append(response)
        
        if not results:
             resp = self._empty_response("rejected", "No valid objects processed.")
             resp["image"]["filename"] = filename
             return [resp]

        request_total_ms = (time.perf_counter() - request_start) * 1000.0
        logger.info(
            "PP1_TIMING total_ms=%.2f detect_ms=%.2f detections=%d profile=%s",
            request_total_ms,
            detect_ms,
            len(results),
            profile,
        )
        if request_total_ms > 8000:
            logger.warning("PP1_SLOW_REQUEST total_ms=%.2f profile=%s", request_total_ms, profile)
             
        return results
