import uuid
import cv2
import numpy as np
import io
import time
import logging
import re
import os
import threading
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError, as_completed
from PIL import Image
from typing import Any, Dict, List, Optional, Tuple
from fastapi import UploadFile

from app.schemas.pp2_schemas import (
    PP2Response,
    PP2PerViewResult,
    PP2PerViewDetection,
    PP2PerViewExtraction,
    PP2PerViewEmbedding,
    PP2VerificationResult,
)

# Services
from app.services.yolo_service import YoloService
from app.services.florence_service import FlorenceService
from app.services.dino_embedder import DINOEmbedder
from app.services.pp2_fusion_service import MultiViewFusionService
from app.services.pp2_multiview_verifier import MultiViewVerifier
from app.services.storage_service import StorageService
from app.services.faiss_service import FaissService
from app.services.gemini_reasoner import GeminiReasoner
from app.config.settings import settings
from app.domain.category_specs import canonicalize_label

logger = logging.getLogger(__name__)


class MultiViewPipeline:
    MIN_VIEWS = 2
    MAX_VIEWS = 3
    PP2_TOP_K_DETECTIONS = 5
    LITE_EXTRACTION_CONFIDENCE = 0.7
    LITE_FAILED_EXTRACTION_CONFIDENCE = 0.0
    DEFAULT_EMBEDDING_DIM = 128
    CENTER_CROP_RATIO = 0.70
    PASS_REFINEMENT_MIN_CAPTION_WORDS = 4
    PASS_REFINEMENT_MIN_OCR_LEN = 2
    HINT_KEYWORDS: Dict[str, List[str]] = {
        "Helmet": ["helmet", "visor", "chin strap", "motorcycle helmet", "bike helmet", "headgear"],
        "Smart Phone": ["smartphone", "mobile phone", "cell phone", "iphone", "android phone", "phone"],
        "Laptop": ["laptop", "notebook", "macbook", "ultrabook"],
        "Earbuds - Earbuds case": ["earbud", "earbuds", "airpods", "earphone case", "charging case", "tws case"],
        "Wallet": ["wallet", "billfold", "card holder"],
        "Handbag": ["bag", "handbag", "purse", "tote", "sling bag"],
        "Backpack": ["backpack", "rucksack", "knapsack", "school bag"],
        "Key": ["key", "keys", "keychain", "key ring"],
        "Student ID": ["student id", "id card", "school id", "campus card"],
        "Laptop/Mobile chargers & cables": [
            "charger",
            "charging cable",
            "usb cable",
            "type-c cable",
            "lightning cable",
            "power adapter",
        ],
    }
    UMBRELLA_KEYWORDS: List[str] = ["umbrella", "parasol"]
    HINT_PRIORITY: List[str] = [
        "Helmet",
        "Smart Phone",
        "Laptop",
        "Earbuds - Earbuds case",
        "Wallet",
        "Handbag",
        "Backpack",
        "Key",
        "Student ID",
        "Laptop/Mobile chargers & cables",
    ]

    def __init__(
        self, 
        yolo: YoloService, 
        florence: FlorenceService, 
        dino: DINOEmbedder, 
        verifier: MultiViewVerifier, 
        fusion: MultiViewFusionService, 
        faiss: FaissService,
        gemini: Optional[GeminiReasoner] = None,
    ):
        self.yolo = yolo
        self.florence = florence
        self.dino = dino
        self.verifier = verifier
        self.fusion = fusion
        self.faiss = faiss
        self._gemini = gemini
        self._gemini_lock = threading.Lock()
        self.perf_profile = str(settings.PERF_PROFILE).lower()
        configured = float(getattr(settings, "FLORENCE_LITE_SUCCESS_CONFIDENCE", self.LITE_EXTRACTION_CONFIDENCE))
        self.lite_success_confidence = max(self.LITE_EXTRACTION_CONFIDENCE, configured)

    def _get_gemini(self) -> Optional[GeminiReasoner]:
        if not bool(getattr(settings, "PP2_ENABLE_GEMINI", False)):
            return None
        if self._gemini is not None:
            return self._gemini
        with self._gemini_lock:
            if self._gemini is None:
                self._gemini = GeminiReasoner()
        return self._gemini

    @staticmethod
    def _verification_has_near_miss(verification: PP2VerificationResult) -> bool:
        geometric_scores = verification.geometric_scores if isinstance(verification.geometric_scores, dict) else {}
        for info in geometric_scores.values():
            if not isinstance(info, dict):
                continue
            if str(info.get("pair_strength", "")).strip().lower() == "near_miss":
                return True

        for reason in verification.failure_reasons or []:
            text = str(reason).strip().lower()
            if "near_miss" in text or "near-miss" in text or "near miss" in text:
                return True
        return False

    @staticmethod
    def _view_has_sparse_florence_text(view: PP2PerViewResult) -> bool:
        caption = str(getattr(view.extraction, "caption", "") or "").strip()
        ocr_text = str(getattr(view.extraction, "ocr_text", "") or "").strip()
        return (not caption) or (not ocr_text)

    @classmethod
    def _is_weak_text_evidence(cls, caption_text: Any, ocr_text: Any) -> bool:
        caption = str(caption_text or "").strip()
        ocr = str(ocr_text or "").strip()

        caption_words = re.findall(r"[A-Za-z0-9]+", caption)
        caption_weak = len(caption_words) < int(cls.PASS_REFINEMENT_MIN_CAPTION_WORDS)

        ocr_tokens = re.findall(r"[A-Za-z0-9]+", ocr)
        joined_ocr = "".join(ocr_tokens)
        ocr_len_weak = len(joined_ocr) < int(cls.PASS_REFINEMENT_MIN_OCR_LEN)
        ocr_single_char_like = bool(ocr_tokens) and all(len(tok) <= 1 for tok in ocr_tokens)
        ocr_weak = (not ocr_tokens) or ocr_len_weak or ocr_single_char_like
        return caption_weak and ocr_weak

    def _needs_pass_caption_refinement(
        self,
        per_view_results: List[PP2PerViewResult],
        used_indices: List[int],
    ) -> bool:
        if not used_indices:
            return False

        checked_count = 0
        for idx in used_indices:
            if idx < 0 or idx >= len(per_view_results):
                continue
            checked_count += 1
            extraction = per_view_results[idx].extraction
            if not self._is_weak_text_evidence(extraction.caption, extraction.ocr_text):
                return False
        return checked_count > 0

    def _select_best_gemini_view(
        self,
        per_view_results: List[PP2PerViewResult],
        verification: PP2VerificationResult,
    ) -> Optional[int]:
        n = len(per_view_results)
        if n <= 0:
            return None

        used_views = [int(idx) for idx in (verification.used_views or []) if isinstance(idx, int)]
        dropped_indices: set[int] = set()
        for dropped in verification.dropped_views or []:
            if isinstance(dropped, dict):
                idx_raw = dropped.get("view_index")
            else:
                idx_raw = getattr(dropped, "view_index", None)
            if isinstance(idx_raw, int):
                dropped_indices.add(idx_raw)

        if len(used_views) >= 1:
            candidates = [idx for idx in used_views if 0 <= idx < n]
        else:
            candidates = [idx for idx in range(n) if idx not in dropped_indices]
            if not candidates:
                candidates = list(range(n))

        if not candidates:
            return None
        return sorted(
            candidates,
            key=lambda idx: (-float(per_view_results[idx].quality_score), int(per_view_results[idx].view_index)),
        )[0]

    @staticmethod
    def _build_pp2_gemini_evidence(
        view: PP2PerViewResult,
        canonical_label: Optional[str],
    ) -> Dict[str, Any]:
        raw_payload = view.extraction.raw if isinstance(view.extraction.raw, dict) else {}
        return {
            "detection": {
                "label": str(view.detection.cls_name),
                "confidence": float(view.detection.confidence),
                "bbox": [float(v) for v in view.detection.bbox],
            },
            "canonical_label": canonical_label or str(view.detection.cls_name),
            "label_lock": True,
            "label_candidates": [canonical_label or str(view.detection.cls_name)],
            "crop_analysis": {
                "caption": str(view.extraction.caption or ""),
                "ocr_text": str(view.extraction.ocr_text or ""),
                "grounded_features": view.extraction.grounded_features if isinstance(view.extraction.grounded_features, dict) else {},
                "raw": raw_payload,
            },
        }

    def _run_gemini_for_views_parallel(
        self,
        *,
        indices: List[int],
        per_view_results: List[PP2PerViewResult],
        crop_by_index: Dict[int, Image.Image],
        canonical_label_by_index: Dict[int, str],
        timeout_s: int,
        request_id: str,
        item_id: str,
    ) -> Dict[int, Dict[str, Any]]:
        outputs: Dict[int, Dict[str, Any]] = {}
        if not indices:
            return outputs

        gemini = self._get_gemini()
        if gemini is None:
            for idx in indices:
                outputs[int(idx)] = {
                    "status": "skipped",
                    "reason": "disabled",
                    "timeout_s": int(timeout_s),
                }
            return outputs

        max_workers = max(1, min(8, int(os.cpu_count() or 1), len(indices)))
        logger.debug(
            "PP2_GEMINI_POOL_START request_id=%s item_id=%s views=%s max_workers=%d timeout_s=%d",
            request_id,
            item_id,
            sorted([int(i) for i in indices]),
            max_workers,
            int(timeout_s),
        )

        def _gemini_task(view_idx: int) -> Dict[str, Any]:
            start = time.perf_counter()
            view = per_view_results[view_idx]
            evidence = self._build_pp2_gemini_evidence(
                view=view,
                canonical_label=canonical_label_by_index.get(view_idx),
            )
            logger.debug(
                "PP2_GEMINI_CALL_START request_id=%s item_id=%s view=%d",
                request_id,
                item_id,
                view_idx,
            )
            response = gemini.confirm_pp2_view(
                evidence_json=evidence,
                crop_image=crop_by_index.get(view_idx),
            )
            elapsed_ms = (time.perf_counter() - start) * 1000.0
            payload = {
                "status": str(response.get("status", "error") or "error"),
                "label": response.get("label"),
                "description": response.get("description"),
                "message": str(response.get("message", "") or ""),
                "elapsed_ms": round(elapsed_ms, 2),
                "timeout_s": int(timeout_s),
            }
            if "error" in response:
                payload["error"] = response.get("error")
            logger.debug(
                "PP2_GEMINI_CALL_DONE request_id=%s item_id=%s view=%d status=%s elapsed_ms=%.2f",
                request_id,
                item_id,
                view_idx,
                payload["status"],
                elapsed_ms,
            )
            return payload

        executor = ThreadPoolExecutor(max_workers=max_workers)
        futures: Dict[Any, int] = {}
        try:
            for idx in indices:
                futures[executor.submit(_gemini_task, int(idx))] = int(idx)

            for future, idx in list(futures.items()):
                try:
                    outputs[idx] = future.result(timeout=max(1, int(timeout_s)))
                except FutureTimeoutError:
                    outputs[idx] = {
                        "status": "timeout",
                        "reason": "timeout",
                        "elapsed_ms": float(max(1, int(timeout_s)) * 1000),
                        "timeout_s": int(timeout_s),
                    }
                    logger.warning(
                        "PP2_GEMINI_TIMEOUT request_id=%s item_id=%s view=%d timeout_s=%d",
                        request_id,
                        item_id,
                        idx,
                        int(timeout_s),
                    )
                except Exception as exc:
                    outputs[idx] = {
                        "status": "error",
                        "reason": "exception",
                        "message": str(exc),
                        "timeout_s": int(timeout_s),
                    }
                    logger.exception(
                        "PP2_GEMINI_ERROR request_id=%s item_id=%s view=%d",
                        request_id,
                        item_id,
                        idx,
                    )
        finally:
            executor.shutdown(wait=False, cancel_futures=True)
        return outputs

    @staticmethod
    def _normalize_string_list(value: Any) -> List[str]:
        """Coerce mixed list payloads into clean string lists."""
        if not isinstance(value, list):
            return []

        out: List[str] = []
        for item in value:
            if item is None:
                continue
            text = item if isinstance(item, str) else str(item)
            text = text.strip()
            if text:
                out.append(text)
        return out

    def _normalize_extraction_payload(self, extraction_data: Any) -> Dict[str, Any]:
        """
        Normalize extractor output into the PP2 extraction contract.
        Ensures grounded_features is always a dict and OCR uses ocr_text first.
        """
        data = extraction_data if isinstance(extraction_data, dict) else {}

        caption_raw = data.get("caption", "")
        caption = caption_raw if isinstance(caption_raw, str) else str(caption_raw or "")

        if "ocr_text" in data:
            ocr_raw = data.get("ocr_text", "")
        else:
            ocr_raw = data.get("ocr", "")

        if isinstance(ocr_raw, list):
            ocr_text = " ".join(self._normalize_string_list(ocr_raw))
        elif ocr_raw is None:
            ocr_text = ""
        else:
            ocr_text = ocr_raw if isinstance(ocr_raw, str) else str(ocr_raw)

        grounded_raw = data.get("grounded_features", {})
        if isinstance(grounded_raw, dict):
            grounded_features: Dict[str, Any] = dict(grounded_raw)
        elif isinstance(grounded_raw, list):
            normalized_features = self._normalize_string_list(grounded_raw)
            grounded_features = {"features": normalized_features} if normalized_features else {}
        else:
            grounded_features = {}

        defects = self._normalize_string_list(data.get("grounded_defects"))
        if defects:
            existing = grounded_features.get("defects")
            if isinstance(existing, list):
                grounded_features["defects"] = self._normalize_string_list(existing) + defects
            elif "defects" not in grounded_features:
                grounded_features["defects"] = defects

        attachments = self._normalize_string_list(data.get("grounded_attachments"))
        if attachments:
            existing = grounded_features.get("attachments")
            if isinstance(existing, list):
                grounded_features["attachments"] = self._normalize_string_list(existing) + attachments
            elif "attachments" not in grounded_features:
                grounded_features["attachments"] = attachments

        color_vqa = data.get("color_vqa")
        if isinstance(color_vqa, str):
            color_vqa = color_vqa.strip()
            if color_vqa and "color" not in grounded_features:
                grounded_features["color"] = color_vqa

        key_count = data.get("key_count")
        if isinstance(key_count, int) and not isinstance(key_count, bool) and "key_count" not in grounded_features:
            grounded_features["key_count"] = key_count

        raw_data = data.get("raw", {})
        if isinstance(raw_data, dict):
            raw: Dict[str, Any] = dict(raw_data)
        else:
            raw = {}

        return {
            "caption": caption,
            "ocr_text": ocr_text,
            "grounded_features": grounded_features,
            "raw": raw,
        }

    def _load_image(self, file: UploadFile) -> Image.Image:
        """Loads UploadFile bytes into a PIL Image."""
        content = file.file.read()
        file.file.seek(0)
        return Image.open(io.BytesIO(content)).convert("RGB")

    def _compute_quality(self, image: Image.Image) -> float:
        """
        Computes a scalar quality score based on Laplacian variance (sharpness).
        Returns value used for ranking views.
        """
        try:
            cv_img = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2GRAY)
            variance = cv2.Laplacian(cv_img, cv2.CV_64F).var()
            # Normalize reasonably for display (log scale or just raw)
            # Simple heuristic: > 100 is usually okay.
            return float(variance)
        except Exception:
            return 0.0

    @staticmethod
    def _center_crop(image: Image.Image, ratio: float = 0.70) -> Image.Image:
        if not isinstance(image, Image.Image):
            return image
        w, h = image.size
        if w <= 0 or h <= 0:
            return image
        safe_ratio = max(0.1, min(1.0, float(ratio)))
        crop_w = max(1, int(round(w * safe_ratio)))
        crop_h = max(1, int(round(h * safe_ratio)))

        left = max(0, (w - crop_w) // 2)
        top = max(0, (h - crop_h) // 2)
        right = min(w, left + crop_w)
        bottom = min(h, top + crop_h)

        if right <= left or bottom <= top:
            return image
        return image.crop((left, top, right, bottom))

    @staticmethod
    def _stage1_reason(caption_text: Any, ocr_text: Any) -> str:
        has_caption = bool(str(caption_text or "").strip())
        has_ocr = bool(str(ocr_text or "").strip())
        if has_caption and has_ocr:
            return "ok_nonempty"
        if not has_caption and not has_ocr:
            return "ok_empty_both"
        if not has_caption:
            return "ok_empty_caption"
        return "ok_empty_ocr"

    def _is_stage1_nonempty(self, extraction_data: Dict[str, Any]) -> bool:
        caption_text = str(extraction_data.get("caption", "")).strip()
        ocr_text = str(extraction_data.get("ocr_text", "")).strip()
        return bool(caption_text) or bool(ocr_text)

    @staticmethod
    def _is_florence_failed(extraction_data: Dict[str, Any]) -> bool:
        if not isinstance(extraction_data, dict):
            return False
        raw = extraction_data.get("raw", {})
        if not isinstance(raw, dict):
            return False
        florence_meta = raw.get("florence", {})
        if not isinstance(florence_meta, dict):
            return False
        return str(florence_meta.get("status", "")).strip().lower() == "failed"

    @staticmethod
    def _is_tiny_bbox(
        bbox: Optional[Tuple[int, int, int, int]],
        image_size: Tuple[int, int],
        threshold_ratio: float,
    ) -> bool:
        if not bbox or len(bbox) != 4:
            return True
        width, height = image_size
        if width <= 0 or height <= 0:
            return True
        x1, y1, x2, y2 = [int(v) for v in bbox]
        box_w = max(0, x2 - x1)
        box_h = max(0, y2 - y1)
        if box_w <= 0 or box_h <= 0:
            return True
        box_area = float(box_w * box_h)
        image_area = float(width * height)
        if image_area <= 0:
            return True
        ratio = box_area / image_area
        return ratio < max(0.0, float(threshold_ratio))

    def _call_ocr_first_once(
        self,
        crop: Image.Image,
        canonical_label: Optional[str],
        request_id: str,
        item_id: str,
        view_index: int,
    ) -> Dict[str, Any]:
        ocr_first_start = time.perf_counter()
        try:
            stage1_raw = self.florence.analyze_ocr_first(
                crop,
                canonical_label=canonical_label,
                fast=True,
            )
        except Exception as exc:
            logger.exception(
                "PP2_OCR_FIRST_EXTRACTION_FAILED request_id=%s item_id=%s view=%d",
                request_id,
                item_id,
                view_index,
            )
            stage1_raw = {
                "caption": "",
                "ocr_text": "",
                "grounded_features": {},
                "raw": {
                    "error": {"type": "error", "message": str(exc)},
                    "ocr_first": {
                        "status": "error",
                        "reason": "exception",
                    },
                    "timings": {},
                },
            }

        measured_ms = (time.perf_counter() - ocr_first_start) * 1000.0
        normalized = self._normalize_extraction_payload(stage1_raw)
        raw_data = normalized.get("raw", {})
        if not isinstance(raw_data, dict):
            raw_data = {}

        timings = raw_data.get("timings", {})
        if not isinstance(timings, dict):
            timings = {}
        ocr_first_ms_raw = timings.get("ocr_first_ms")
        if not isinstance(ocr_first_ms_raw, (int, float)):
            ocr_first_ms_raw = measured_ms
        ocr_first_ms = float(ocr_first_ms_raw)
        timings["ocr_first_ms"] = round(ocr_first_ms, 2)
        raw_data["timings"] = timings

        ocr_first_meta = raw_data.get("ocr_first", {})
        if not isinstance(ocr_first_meta, dict):
            ocr_first_meta = {}
        caption_text = str(normalized.get("caption", ""))
        ocr_text = str(normalized.get("ocr_text", ""))
        stage1_nonempty = self._is_stage1_nonempty(normalized)
        ocr_first_meta["status"] = str(ocr_first_meta.get("status", "success"))
        ocr_first_meta["reason"] = str(
            ocr_first_meta.get("reason", self._stage1_reason(caption_text, ocr_text))
        )
        ocr_first_meta["caption_len"] = int(len(caption_text.strip()))
        ocr_first_meta["ocr_len"] = int(len(ocr_text.strip()))
        ocr_first_meta["stage1_nonempty"] = bool(stage1_nonempty)
        ocr_first_meta["timeout_ms_used"] = {
            "ocr_ms": int(getattr(settings, "FLORENCE_OCR_TIMEOUT_MS", 15000)),
            "full_ms": int(getattr(settings, "FLORENCE_TIMEOUT_MS", 30000)),
        }
        raw_data["ocr_first"] = ocr_first_meta

        florence_meta = raw_data.get("florence", {})
        if not isinstance(florence_meta, dict):
            florence_meta = {}
        florence_status = str(florence_meta.get("status", "")).strip().lower()
        if not florence_status:
            ocr_first_status = str(ocr_first_meta.get("status", "success")).strip().lower()
            ocr_first_reason = str(ocr_first_meta.get("reason", self._stage1_reason(caption_text, ocr_text))).strip().lower()
            if ocr_first_status in {"failed", "error"}:
                florence_status = "failed"
            elif ocr_first_status in {"timeout"}:
                florence_status = "failed"
            else:
                florence_status = "success"
            florence_meta["status"] = florence_status
            if "reason" not in florence_meta:
                florence_meta["reason"] = "timeout" if "timeout" in ocr_first_reason else ("exception" if ocr_first_status == "error" else "ok")
            if "stage" not in florence_meta:
                florence_meta["stage"] = "ocr_first"
        raw_data["florence"] = florence_meta
        normalized["raw"] = raw_data
        return normalized

    @staticmethod
    def _label_conf_pairs(detections: List[Any]) -> List[Tuple[str, float]]:
        return [(str(det.label), float(det.confidence)) for det in detections]

    @staticmethod
    def _normalize_hint_text(text: Any) -> str:
        if text is None:
            return ""
        if isinstance(text, str):
            raw = text
        else:
            raw = str(text)
        normalized = raw.lower().strip()
        normalized = re.sub(r"\s+", " ", normalized)
        return normalized

    @staticmethod
    def _collect_text_fragments(value: Any) -> List[str]:
        fragments: List[str] = []
        if value is None:
            return fragments
        if isinstance(value, str):
            text = value.strip()
            if text:
                fragments.append(text)
            return fragments
        if isinstance(value, dict):
            for k, v in value.items():
                fragments.extend(MultiViewPipeline._collect_text_fragments(k))
                fragments.extend(MultiViewPipeline._collect_text_fragments(v))
            return fragments
        if isinstance(value, (list, tuple, set)):
            for item in value:
                fragments.extend(MultiViewPipeline._collect_text_fragments(item))
            return fragments
        text = str(value).strip()
        if text:
            fragments.append(text)
        return fragments

    def _extract_feature_tokens(self, grounded_features: Dict[str, Any]) -> str:
        fragments = self._collect_text_fragments(grounded_features if isinstance(grounded_features, dict) else {})
        return self._normalize_hint_text(" ".join(fragments))

    def _normalize_label(self, text: Any) -> Optional[str]:
        normalized = self._normalize_hint_text(text)
        if not normalized:
            return None

        if any(self._text_has_keyword(normalized, kw) for kw in self.UMBRELLA_KEYWORDS):
            return None

        canonical = canonicalize_label(normalized)
        alias_hit: Optional[str] = None
        for label, aliases in self.HINT_KEYWORDS.items():
            for alias in aliases:
                if self._text_has_keyword(normalized, alias):
                    alias_hit = label
                    break
            if alias_hit:
                break

        if canonical == "Handbag" and alias_hit == "Backpack":
            return "Backpack"
        if canonical:
            return canonical
        return alias_hit

    @staticmethod
    def _text_has_keyword(text: str, keyword: str) -> bool:
        if not text or not keyword:
            return False
        kw = str(keyword).strip().lower()
        if not kw:
            return False
        pattern = r"\b" + re.escape(kw).replace(r"\ ", r"\s+") + r"\b"
        return re.search(pattern, text) is not None

    def _infer_canonical_hint_with_signals(
        self,
        caption: str,
        ocr_text: str,
        grounded_features: Dict[str, Any],
    ) -> Tuple[Optional[str], Dict[str, bool]]:
        caption_text = self._normalize_hint_text(caption)
        ocr_text_norm = self._normalize_hint_text(ocr_text)
        feature_text = self._extract_feature_tokens(grounded_features)

        helmet_caption = any(self._text_has_keyword(caption_text, kw) for kw in self.HINT_KEYWORDS["Helmet"])
        helmet_ocr = any(self._text_has_keyword(ocr_text_norm, kw) for kw in self.HINT_KEYWORDS["Helmet"])
        helmet_feature = any(self._text_has_keyword(feature_text, kw) for kw in self.HINT_KEYWORDS["Helmet"])
        if helmet_caption or helmet_ocr or helmet_feature:
            return "Helmet", {
                "caption_hit": helmet_caption,
                "ocr_hit": helmet_ocr,
                "feature_hit": helmet_feature,
            }

        weights = {"caption": 1, "ocr": 3, "feature": 2}
        scores: Dict[str, int] = {}
        caption_any = False
        ocr_any = False
        feature_any = False
        for label, keywords in self.HINT_KEYWORDS.items():
            score = 0
            for keyword in keywords:
                if self._text_has_keyword(caption_text, keyword):
                    score += weights["caption"]
                    caption_any = True
                if self._text_has_keyword(ocr_text_norm, keyword):
                    score += weights["ocr"]
                    ocr_any = True
                if self._text_has_keyword(feature_text, keyword):
                    score += weights["feature"]
                    feature_any = True
            scores[label] = score

        best_score = max(scores.values()) if scores else 0
        if best_score <= 0:
            return None, {
                "caption_hit": False,
                "ocr_hit": False,
                "feature_hit": False,
            }

        priority = {label: idx for idx, label in enumerate(self.HINT_PRIORITY)}
        winners = [label for label, score in scores.items() if score == best_score]
        winners.sort(key=lambda label: (priority.get(label, len(priority)), label))
        return winners[0], {
            "caption_hit": caption_any,
            "ocr_hit": ocr_any,
            "feature_hit": feature_any,
        }

    def infer_canonical_hint(
        self,
        caption: str,
        ocr_text: str,
        grounded_features: Dict[str, Any],
    ) -> Optional[str]:
        hint, _ = self._infer_canonical_hint_with_signals(caption, ocr_text, grounded_features)
        return hint

    def _choose_consensus_label(self, per_view_detections: List[List[Any]]) -> Tuple[Optional[str], str]:
        """
        Choose a cross-view consensus label.
        Priority:
          1) strict majority among per-view top-1 labels
          2) fallback ranking over top-K labels:
             (view_coverage_count, summed_best_confidence, best_single_confidence, label asc)
        """
        top1_labels: List[str] = []
        for dets in per_view_detections:
            if not dets:
                continue
            canonical_top1 = self._normalize_label(str(dets[0].label))
            if canonical_top1:
                top1_labels.append(canonical_top1)
        if top1_labels:
            observed_vote_count = len(top1_labels)
            counts = Counter(top1_labels)
            winner, count = counts.most_common(1)[0]

            # In two-view tie cases (different top-1 labels), do not force a majority winner.
            # We intentionally fall through to coverage/confidence fallback (or hint majority upstream).
            if observed_vote_count == 2 and count == 1 and len(counts) == 2:
                pass
            elif count > (observed_vote_count / 2.0):
                return winner, "strict_majority"

        label_stats: Dict[str, Dict[str, float]] = {}
        for detections in per_view_detections:
            if not detections:
                continue
            per_view_best: Dict[str, float] = {}
            for det in detections:
                label = self._normalize_label(str(det.label))
                if not label:
                    continue
                conf = float(det.confidence)
                existing = per_view_best.get(label)
                if existing is None or conf > existing:
                    per_view_best[label] = conf

            for label, best_conf in per_view_best.items():
                stats = label_stats.setdefault(
                    label,
                    {"coverage": 0.0, "sum_conf": 0.0, "best_conf": 0.0},
                )
                stats["coverage"] += 1.0
                stats["sum_conf"] += best_conf
                stats["best_conf"] = max(float(stats["best_conf"]), best_conf)

        if not label_stats:
            return None, "no_consensus"

        ranked = sorted(
            label_stats.items(),
            key=lambda item: (
                -item[1]["coverage"],
                -item[1]["sum_conf"],
                -item[1]["best_conf"],
                item[0],
            ),
        )
        return ranked[0][0], "coverage_conf_fallback"

    def _choose_consensus_label_with_hints(
        self,
        per_view_detections: List[List[Any]],
        canonical_hints: List[Optional[str]],
    ) -> Tuple[Optional[str], str, Dict[str, int]]:
        hint_votes = Counter([hint for hint in canonical_hints if hint])
        if hint_votes:
            top_vote_count = max(hint_votes.values())
            if top_vote_count >= 2:
                priority = {label: idx for idx, label in enumerate(self.HINT_PRIORITY)}
                winners = [label for label, count in hint_votes.items() if count == top_vote_count]
                winners.sort(key=lambda label: (priority.get(label, len(priority)), label))
                return winners[0], "hint_majority", {label: int(count) for label, count in hint_votes.items()}

        fallback_label, fallback_strategy = self._choose_consensus_label(per_view_detections)
        return fallback_label, fallback_strategy, {label: int(count) for label, count in hint_votes.items()}

    def _select_detection_for_view(
        self,
        detections: List[Any],
        consensus_label: Optional[str],
    ) -> Tuple[Optional[Any], bool, str]:
        """
        Select final detection for a view.
        Returns (selected_detection, label_outlier, selected_by).
        """
        if not detections:
            return None, bool(consensus_label), "fallback_top1"
        if not consensus_label:
            return detections[0], False, "fallback_top1"

        consensus_canonical = self._normalize_label(str(consensus_label)) or str(consensus_label)
        matching = []
        for det in detections:
            det_label = str(det.label)
            det_canonical = self._normalize_label(det_label) or det_label
            if det_canonical == consensus_canonical:
                matching.append(det)
        if matching:
            best = max(matching, key=lambda det: float(getattr(det, "confidence", 0.0)))
            return best, False, "consensus_match"
        return detections[0], True, "fallback_top1"

    @staticmethod
    def _apply_bbox_padding(
        bbox: Optional[Tuple[int, int, int, int]],
        image_size: Tuple[int, int],
        pad_ratio: float,
    ) -> Optional[Tuple[int, int, int, int]]:
        if not bbox or len(bbox) != 4:
            return None
        width, height = image_size
        if width <= 0 or height <= 0:
            return None
        x1, y1, x2, y2 = [int(v) for v in bbox]
        x1 = max(0, min(width, x1))
        y1 = max(0, min(height, y1))
        x2 = max(0, min(width, x2))
        y2 = max(0, min(height, y2))
        if x2 <= x1 or y2 <= y1:
            return None

        box_w = x2 - x1
        box_h = y2 - y1
        pad_w = int(round(float(box_w) * max(0.0, float(pad_ratio))))
        pad_h = int(round(float(box_h) * max(0.0, float(pad_ratio))))

        px1 = max(0, x1 - pad_w)
        py1 = max(0, y1 - pad_h)
        px2 = min(width, x2 + pad_w)
        py2 = min(height, y2 + pad_h)
        if px2 <= px1 or py2 <= py1:
            return None
        return (int(px1), int(py1), int(px2), int(py2))

    def _mark_extraction_skipped(self, raw: Any, skipped_steps: Optional[List[str]] = None) -> Dict[str, Any]:
        out: Dict[str, Any] = dict(raw) if isinstance(raw, dict) else {}
        out["skipped"] = True
        out["reason"] = "early_exit"
        steps = out.get("skipped_steps", [])
        if not isinstance(steps, list):
            steps = []
        for step in skipped_steps or []:
            s = str(step).strip()
            if s and s not in steps:
                steps.append(s)
        out["skipped_steps"] = steps
        return out

    def _build_skipped_view_stub(
        self,
        view_index: int,
        filename: str,
        embedding_dim: int,
        reason: str = "early_exit",
    ) -> Dict[str, Any]:
        if reason == "early_exit":
            raw = self._mark_extraction_skipped({}, ["load", "detect", "florence", "embedding"])
        else:
            raw = {
                "error": {"type": "error", "message": str(reason)},
                "skipped": True,
                "reason": str(reason),
                "skipped_steps": ["load", "detect", "florence", "embedding"],
            }
        extraction = {
            "caption": "",
            "ocr_text": "",
            "grounded_features": {},
            "raw": raw,
        }
        return {
            "view_index": int(view_index),
            "filename": str(filename),
            "image": Image.new("RGB", (1, 1), color=(0, 0, 0)),
            "detections": [],
            "stage1_extraction": extraction,
            "canonical_hint": None,
            "florence_stage1_ms": 0.0,
            "stage1_vector": [0.0] * max(1, int(embedding_dim)),
            "stage1_vector_dim": max(1, int(embedding_dim)),
            "stage1_crop": Image.new("RGB", (1, 1), color=(0, 0, 0)),
            "pair_label": None,
            "provisional_label": "unknown",
            "view_elapsed_ms": 0.0,
            "stage1_skipped": True,
        }

    def _run_view_stage1_task(
        self,
        file: UploadFile,
        view_index: int,
        request_id: str,
        item_id: str,
        early_exit_event: threading.Event,
    ) -> Dict[str, Any]:
        view_start = time.perf_counter()
        filename = file.filename or f"view_{view_index}.jpg"
        pil_img = self._load_image(file)

        detections = self.yolo.detect_objects(
            pil_img,
            max_detections=self.PP2_TOP_K_DETECTIONS,
        )

        top1 = detections[0] if detections else None
        top1_label = str(getattr(top1, "label", "none"))
        top1_conf = float(getattr(top1, "confidence", 0.0)) if top1 else 0.0
        top1_bbox = getattr(top1, "bbox", None) if top1 else None
        logger.debug(
            "PP2_VIEW_YOLO request_id=%s item_id=%s view=%d image_wh=%dx%d detections=%d top1_label=%s top1_conf=%.4f top1_bbox=%s",
            request_id,
            item_id,
            view_index,
            pil_img.width,
            pil_img.height,
            len(detections),
            top1_label,
            top1_conf,
            top1_bbox,
        )
        logger.debug(
            "PP2_VIEW_TOPK request_id=%s item_id=%s view=%d labels=%s",
            request_id,
            item_id,
            view_index,
            self._label_conf_pairs(detections),
        )

        provisional_det = detections[0] if detections else None
        has_valid_bbox = False
        is_tiny_crop = False
        tiny_ratio_threshold = float(getattr(settings, "PP2_OCR_FIRST_TINY_BBOX_AREA_RATIO", 0.05))
        pad_ratio = float(getattr(settings, "FLORENCE_LITE_PAD_RATIO", 0.20))
        raw_bbox: Optional[Tuple[int, int, int, int]] = None

        if provisional_det:
            provisional_label = str(provisional_det.label)
            w, h = pil_img.size
            x1, y1, x2, y2 = provisional_det.bbox
            x1 = max(0, min(w, x1))
            y1 = max(0, min(h, y1))
            x2 = max(0, min(w, x2))
            y2 = max(0, min(h, y2))
            if x2 > x1 and y2 > y1:
                raw_bbox = (int(x1), int(y1), int(x2), int(y2))
                has_valid_bbox = True
                is_tiny_crop = self._is_tiny_bbox(
                    raw_bbox,
                    image_size=(w, h),
                    threshold_ratio=tiny_ratio_threshold,
                )
                padded_bbox = self._apply_bbox_padding(raw_bbox, image_size=(w, h), pad_ratio=pad_ratio) or raw_bbox
                provisional_crop = pil_img.crop(padded_bbox)
                stage1_input_source = "yolo_top1_crop_tiny" if is_tiny_crop else "yolo_top1_crop"
                bbox_w = int(raw_bbox[2] - raw_bbox[0])
                bbox_h = int(raw_bbox[3] - raw_bbox[1])
            else:
                provisional_crop = pil_img
                stage1_input_source = "full_image_fallback"
                bbox_w = int(pil_img.width)
                bbox_h = int(pil_img.height)
        else:
            provisional_crop = pil_img
            provisional_label = "unknown"
            stage1_input_source = "full_image_fallback"
            bbox_w = int(pil_img.width)
            bbox_h = int(pil_img.height)

        logger.debug(
            "PP2_VIEW_OCR_FIRST_INPUT request_id=%s item_id=%s view=%d source=%s crop_wh=%dx%d bbox_wh=%dx%d",
            request_id,
            item_id,
            view_index,
            stage1_input_source,
            provisional_crop.width,
            provisional_crop.height,
            bbox_w,
            bbox_h,
        )

        if early_exit_event.is_set():
            skipped_extraction = {
                "caption": "",
                "ocr_text": "",
                "grounded_features": {},
                "raw": self._mark_extraction_skipped({}, ["florence", "embedding"]),
            }
            return {
                "view_index": int(view_index),
                "filename": str(filename),
                "image": pil_img,
                "detections": detections,
                "stage1_extraction": skipped_extraction,
                "canonical_hint": None,
                "florence_stage1_ms": 0.0,
                "stage1_vector": None,
                "stage1_vector_dim": None,
                "stage1_crop": provisional_crop,
                "pair_label": self._normalize_label(provisional_label),
                "provisional_label": provisional_label,
                "view_elapsed_ms": (time.perf_counter() - view_start) * 1000.0,
                "stage1_skipped": True,
            }

        stage1_extraction = self._call_ocr_first_once(
            crop=provisional_crop,
            canonical_label=provisional_label if provisional_label != "unknown" else None,
            request_id=request_id,
            item_id=item_id,
            view_index=view_index,
        )
        stage1_crop = provisional_crop

        if has_valid_bbox and is_tiny_crop and not early_exit_event.is_set():
            fallback_extraction = self._call_ocr_first_once(
                crop=pil_img,
                canonical_label=provisional_label if provisional_label != "unknown" else None,
                request_id=request_id,
                item_id=item_id,
                view_index=view_index,
            )
            primary_failed = self._is_florence_failed(stage1_extraction)
            fallback_failed = self._is_florence_failed(fallback_extraction)
            primary_nonempty = self._is_stage1_nonempty(stage1_extraction)
            fallback_nonempty = self._is_stage1_nonempty(fallback_extraction)
            choose_fallback = False
            if primary_failed and not fallback_failed:
                choose_fallback = True
            elif (not primary_nonempty) and fallback_nonempty:
                choose_fallback = True
            elif fallback_nonempty and primary_nonempty:
                primary_len = len(str(stage1_extraction.get("caption", "")).strip()) + len(
                    str(stage1_extraction.get("ocr_text", "")).strip()
                )
                fallback_len = len(str(fallback_extraction.get("caption", "")).strip()) + len(
                    str(fallback_extraction.get("ocr_text", "")).strip()
                )
                choose_fallback = fallback_len > primary_len

            selected_stage1 = fallback_extraction if choose_fallback else stage1_extraction
            selected_raw = selected_stage1.get("raw", {}) if isinstance(selected_stage1, dict) else {}
            if not isinstance(selected_raw, dict):
                selected_raw = {}
            selected_ocr_first = selected_raw.get("ocr_first", {})
            if not isinstance(selected_ocr_first, dict):
                selected_ocr_first = {}
            selected_ocr_first["fallback_attempted"] = True
            selected_ocr_first["fallback_source"] = "full_image_fallback"
            selected_ocr_first["selected_source"] = "full_image_fallback" if choose_fallback else "yolo_top1_crop_tiny"
            selected_raw["ocr_first"] = selected_ocr_first
            selected_stage1["raw"] = selected_raw
            stage1_extraction = selected_stage1
            stage1_crop = pil_img if choose_fallback else provisional_crop

        raw_stage1 = stage1_extraction.get("raw", {}) if isinstance(stage1_extraction, dict) else {}
        timings = raw_stage1.get("timings", {}) if isinstance(raw_stage1, dict) else {}
        stage1_ms = timings.get("ocr_first_ms") if isinstance(timings, dict) else None
        if not isinstance(stage1_ms, (int, float)):
            stage1_ms = 0.0
        stage1_ms_float = float(stage1_ms)

        stage1_meta = raw_stage1.get("ocr_first", {}) if isinstance(raw_stage1, dict) else {}
        if not isinstance(stage1_meta, dict):
            stage1_meta = {}
        caption_text = str(stage1_extraction.get("caption", ""))
        ocr_text = str(stage1_extraction.get("ocr_text", ""))
        caption_len = len(caption_text.strip())
        ocr_len = len(ocr_text.strip())
        stage1_status = str(stage1_meta.get("status", "unknown"))
        stage1_reason = str(stage1_meta.get("reason", "unknown"))
        if stage1_status == "unknown":
            stage1_status = "success"
            stage1_reason = self._stage1_reason(caption_text, ocr_text)
        logger.debug(
            "PP2_VIEW_OCR_FIRST_RESULT request_id=%s item_id=%s view=%d status=%s reason=%s ocr_first_ms=%.2f caption_len=%d ocr_len=%d has_caption=%s has_ocr=%s",
            request_id,
            item_id,
            view_index,
            stage1_status,
            stage1_reason,
            stage1_ms_float,
            caption_len,
            ocr_len,
            caption_len > 0,
            ocr_len > 0,
        )

        canonical_hint, hint_signals = self._infer_canonical_hint_with_signals(
            caption=stage1_extraction.get("caption", ""),
            ocr_text=stage1_extraction.get("ocr_text", ""),
            grounded_features=stage1_extraction.get("grounded_features", {}),
        )
        logger.debug(
            "PP2_HINT_SIGNAL request_id=%s item_id=%s view=%d hint=%s caption_hit=%s ocr_hit=%s feature_hit=%s",
            request_id,
            item_id,
            view_index,
            canonical_hint,
            hint_signals.get("caption_hit", False),
            hint_signals.get("ocr_hit", False),
            hint_signals.get("feature_hit", False),
        )
        logger.debug(
            "PP2_VIEW_OCR_FIRST view=%d provisional_label=%s canonical_hint=%s florence_stage1_ms=%.2f",
            view_index,
            provisional_label,
            canonical_hint,
            stage1_ms_float,
        )

        stage1_vector: Optional[List[float]] = None
        stage1_vector_dim: Optional[int] = None
        stage1_skipped = False
        if early_exit_event.is_set():
            stage1_skipped = True
            raw = stage1_extraction.get("raw", {}) if isinstance(stage1_extraction, dict) else {}
            stage1_extraction["raw"] = self._mark_extraction_skipped(raw, ["embedding"])
        else:
            try:
                vec = self.dino.embed_128(stage1_crop)
                stage1_vector = [float(v) for v in list(vec)]
                stage1_vector_dim = len(stage1_vector)
            except Exception:
                logger.exception(
                    "PP2_STAGE1_EMBEDDING_FAILED request_id=%s item_id=%s view=%d",
                    request_id,
                    item_id,
                    view_index,
                )
                raw = stage1_extraction.get("raw", {}) if isinstance(stage1_extraction, dict) else {}
                if not isinstance(raw, dict):
                    raw = {}
                raw["embedding_error"] = {"type": "error", "reason": "stage1_embedding_exception"}
                stage1_extraction["raw"] = raw

        pair_label = canonical_hint or self._normalize_label(provisional_label)
        return {
            "view_index": int(view_index),
            "filename": str(filename),
            "image": pil_img,
            "detections": detections,
            "stage1_extraction": stage1_extraction,
            "canonical_hint": canonical_hint,
            "florence_stage1_ms": stage1_ms_float,
            "stage1_vector": stage1_vector,
            "stage1_vector_dim": stage1_vector_dim,
            "stage1_crop": stage1_crop,
            "pair_label": pair_label,
            "provisional_label": provisional_label,
            "view_elapsed_ms": (time.perf_counter() - view_start) * 1000.0,
            "stage1_skipped": stage1_skipped,
        }

    def _run_provisional_pair_verify(
        self,
        pair_indices: Tuple[int, int],
        stage1_results_by_index: Dict[int, Dict[str, Any]],
        request_id: str,
        item_id: str,
        decision_label: Optional[str],
    ) -> Tuple[bool, Optional[PP2VerificationResult]]:
        local_vectors: List[np.ndarray] = []
        local_crops: List[Image.Image] = []
        local_per_view: List[PP2PerViewResult] = []

        for local_idx, global_idx in enumerate(pair_indices):
            entry = stage1_results_by_index.get(global_idx, {})
            filename = str(entry.get("filename", f"view_{global_idx}.jpg"))
            extraction = entry.get("stage1_extraction", {})
            if not isinstance(extraction, dict):
                extraction = {"caption": "", "ocr_text": "", "grounded_features": {}, "raw": {}}
            vector = entry.get("stage1_vector") or []
            vector_list = [float(v) for v in list(vector)]
            vec_np = np.array(vector_list, dtype=np.float32)
            crop = entry.get("stage1_crop")
            if not isinstance(crop, Image.Image):
                crop = Image.new("RGB", (1, 1), color=(0, 0, 0))
            local_vectors.append(vec_np)
            local_crops.append(crop)

            cls_name = str(entry.get("pair_label") or entry.get("provisional_label") or "unknown")
            local_per_view.append(
                PP2PerViewResult(
                    view_index=local_idx,
                    filename=filename,
                    detection=PP2PerViewDetection(
                        bbox=(0.0, 0.0, float(crop.width), float(crop.height)),
                        cls_name=cls_name,
                        confidence=1.0,
                        selected_by="provisional_pair",
                        outlier_view=False,
                        candidates=[],
                    ),
                    extraction=PP2PerViewExtraction(
                        caption=str(extraction.get("caption", "")),
                        ocr_text=str(extraction.get("ocr_text", "")),
                        grounded_features=extraction.get("grounded_features", {})
                        if isinstance(extraction.get("grounded_features", {}), dict)
                        else {},
                        extraction_confidence=self.lite_success_confidence,
                        raw=extraction.get("raw", {}) if isinstance(extraction.get("raw", {}), dict) else {},
                    ),
                    embedding=PP2PerViewEmbedding(
                        dim=int(vec_np.shape[0]),
                        vector_preview=vector_list[:8],
                        vector_id=f"{item_id}_provisional_{global_idx}",
                    ),
                    quality_score=float(self._compute_quality(crop)),
                )
            )

        if len(local_vectors) != 2 or any(v.size == 0 for v in local_vectors):
            return False, None

        variants = {
            0: {"full": local_vectors[0]},
            1: {"full": local_vectors[1]},
        }
        verification = self.verifier.verify(
            local_per_view,
            local_vectors,
            local_crops,
            self.faiss,
            eligible_indices=[0, 1],
            used_views_override=[0, 1],
            dropped_views=[],
            decision_category=decision_label,
            embedding_variants_by_index=variants,
            request_id=request_id,
            item_id=item_id,
        )
        return bool(verification.passed), verification

    async def analyze(
        self,
        files: List[UploadFile],
        storage: StorageService,
        request_id: Optional[str] = None,
    ) -> PP2Response:
        request_start = time.perf_counter()
        profile = self.perf_profile
        item_id = str(uuid.uuid4())
        trace_request_id = str(request_id or "")
        if not trace_request_id:
            trace_request_id = str(uuid.uuid4())
        n_views = len(files)
        if n_views < self.MIN_VIEWS or n_views > self.MAX_VIEWS:
            raise ValueError(
                f"Multi-view analysis requires {self.MIN_VIEWS} to {self.MAX_VIEWS} views, got {n_views}."
            )
        logger.info(
            "PP2_PIPELINE_START request_id=%s item_id=%s n_views=%d profile=%s",
            trace_request_id,
            item_id,
            n_views,
            profile,
        )

        per_view_results: List[PP2PerViewResult] = []
        vectors: List[List[float]] = []
        crops: List[Image.Image] = []
        per_view_ms: List[float] = []
        label_outliers: Dict[int, bool] = {}
        view_meta_by_index: Dict[int, Dict[str, Any]] = {}
        view_inputs: List[Dict[str, Any]] = []
        crop_by_index: Dict[int, Image.Image] = {}
        canonical_label_by_index: Dict[int, str] = {}
        canonical_hint_by_index: Dict[int, Optional[str]] = {}
        stage1_ms_by_index: Dict[int, float] = {}
        florence_stage1_total_ms = 0.0
        early_exit_event = threading.Event()
        early_exit_pair: Optional[Tuple[int, int]] = None
        stage1_results_by_index: Dict[int, Dict[str, Any]] = {}
        resolved_embedding_dim = int(self.DEFAULT_EMBEDDING_DIM)
        attempted_pairs: set[Tuple[int, int]] = set()

        cpu_count = os.cpu_count() or 1
        max_workers = max(1, min(8, int(cpu_count)))
        logger.debug(
            "PP2_CONCURRENT_STAGE1_START request_id=%s item_id=%s n_views=%d max_workers=%d",
            trace_request_id,
            item_id,
            n_views,
            max_workers,
        )

        future_to_index: Dict[Any, int] = {}
        futures_by_index: Dict[int, Any] = {}
        pending_indices: set[int] = set(range(n_views))
        eligible_indices_by_label: Dict[str, List[int]] = {}

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            for i, file in enumerate(files):
                fut = executor.submit(
                    self._run_view_stage1_task,
                    file,
                    i,
                    trace_request_id,
                    item_id,
                    early_exit_event,
                )
                future_to_index[fut] = i
                futures_by_index[i] = fut

            for fut in as_completed(list(future_to_index.keys())):
                i = future_to_index[fut]
                pending_indices.discard(i)
                try:
                    entry = fut.result()
                except Exception as exc:
                    logger.exception(
                        "PP2_VIEW_STAGE1_TASK_FAILED request_id=%s item_id=%s view=%d",
                        trace_request_id,
                        item_id,
                        i,
                    )
                    logger.debug(
                        "PP2_VIEW_STAGE1_TASK_FAILED_META request_id=%s item_id=%s view=%d exc_type=%s",
                        trace_request_id,
                        item_id,
                        i,
                        type(exc).__name__,
                    )
                    reason = "early_exit" if early_exit_event.is_set() else "stage1_task_failed"
                    entry = self._build_skipped_view_stub(
                        view_index=i,
                        filename=(files[i].filename or f"view_{i}.jpg"),
                        embedding_dim=resolved_embedding_dim,
                        reason=reason,
                    )
                stage1_results_by_index[i] = entry

                vec = entry.get("stage1_vector")
                if isinstance(vec, list) and vec:
                    resolved_embedding_dim = len(vec)

                if n_views <= 2 or early_exit_event.is_set() or early_exit_pair is not None:
                    continue

                pair_label = str(entry.get("pair_label") or "").strip()
                extraction_data = entry.get("stage1_extraction", {})
                has_vector = isinstance(vec, list) and len(vec) > 0
                if not pair_label or not has_vector or self._is_florence_failed(extraction_data if isinstance(extraction_data, dict) else {}):
                    continue

                bucket = eligible_indices_by_label.setdefault(pair_label, [])
                if i not in bucket:
                    bucket.append(i)
                if len(bucket) < 2:
                    continue

                pair = tuple(sorted((bucket[0], bucket[1])))
                if pair in attempted_pairs:
                    continue
                attempted_pairs.add(pair)

                logger.debug(
                    "PP2_EARLY_VERIFY_ATTEMPT request_id=%s item_id=%s pair=%s label=%s pending=%s",
                    trace_request_id,
                    item_id,
                    pair,
                    pair_label,
                    sorted(list(pending_indices)),
                )
                try:
                    provisional_passed, provisional_result = self._run_provisional_pair_verify(
                        pair_indices=(pair[0], pair[1]),
                        stage1_results_by_index=stage1_results_by_index,
                        request_id=trace_request_id,
                        item_id=item_id,
                        decision_label=pair_label,
                    )
                except Exception:
                    logger.exception(
                        "PP2_EARLY_VERIFY_FAILED request_id=%s item_id=%s pair=%s",
                        trace_request_id,
                        item_id,
                        pair,
                    )
                    provisional_passed = False
                    provisional_result = None

                logger.debug(
                    "PP2_EARLY_VERIFY_RESULT request_id=%s item_id=%s pair=%s passed=%s reasons=%s",
                    trace_request_id,
                    item_id,
                    pair,
                    provisional_passed,
                    (provisional_result.failure_reasons if provisional_result else []),
                )

                remaining_pending = [idx for idx in pending_indices if not futures_by_index[idx].done()]
                if provisional_passed and remaining_pending:
                    early_exit_pair = pair
                    early_exit_event.set()
                    cancel_attempts = 0
                    cancel_success = 0
                    for idx in remaining_pending:
                        pending_future = futures_by_index.get(idx)
                        if pending_future is None or pending_future.done():
                            continue
                        cancel_attempts += 1
                        if pending_future.cancel():
                            cancel_success += 1
                    logger.debug(
                        "PP2_EARLY_EXIT_TRIGGERED request_id=%s item_id=%s pair=%s cancel_attempts=%d cancel_success=%d",
                        trace_request_id,
                        item_id,
                        pair,
                        cancel_attempts,
                        cancel_success,
                    )

        for i in range(n_views):
            if i not in stage1_results_by_index:
                stage1_results_by_index[i] = self._build_skipped_view_stub(
                    view_index=i,
                    filename=(files[i].filename or f"view_{i}.jpg"),
                    embedding_dim=resolved_embedding_dim,
                    reason="early_exit" if early_exit_event.is_set() else "stage1_missing",
                )

        view_inputs = [stage1_results_by_index[i] for i in range(n_views)]
        florence_stage1_total_ms = sum(float(entry.get("florence_stage1_ms", 0.0) or 0.0) for entry in view_inputs)
        logger.debug(
            "PP2_CONCURRENT_STAGE1_DONE request_id=%s item_id=%s early_exit_pair=%s skipped_views=%d gemini_skipped=true",
            trace_request_id,
            item_id,
            list(early_exit_pair) if early_exit_pair else [],
            sum(1 for entry in view_inputs if bool(entry.get('stage1_skipped', False))),
        )

        # 2. Cross-view consensus (hint-first, then YOLO fallback)
        per_view_detections = [entry["detections"] for entry in view_inputs]
        hint_list = [entry.get("canonical_hint") for entry in view_inputs]
        top1_votes = [
            self._normalize_label(str(dets[0].label)) or str(dets[0].label)
            for dets in per_view_detections
            if dets
        ]
        consensus_label, consensus_strategy, hint_votes = self._choose_consensus_label_with_hints(
            per_view_detections,
            hint_list,
        )
        logger.debug(
            "PP2_LABEL_CONSENSUS top1_votes=%s hint_votes=%s chosen_label=%s strategy=%s",
            top1_votes,
            hint_votes,
            consensus_label,
            consensus_strategy,
        )
        logger.debug(
            "PP2_CONSENSUS_PATH request_id=%s item_id=%s strategy=%s used_hint_majority=%s yolo_fallback=%s top1_votes=%s hint_votes=%s",
            trace_request_id,
            item_id,
            consensus_strategy,
            consensus_strategy == "hint_majority",
            consensus_strategy != "hint_majority",
            top1_votes,
            hint_votes,
        )

        # 3. Process each view using consensus-aligned selection
        for entry in view_inputs:
            i = int(entry["view_index"])
            filename = str(entry["filename"])
            pil_img = entry["image"]
            if not isinstance(pil_img, Image.Image):
                pil_img = Image.new("RGB", (1, 1), color=(0, 0, 0))
            detections = entry.get("detections", [])
            canonical_hint_by_index[i] = entry.get("canonical_hint")
            stage1_ms_by_index[i] = float(entry.get("florence_stage1_ms", 0.0) or 0.0)

            selected_det, label_outlier, selection_mode = self._select_detection_for_view(detections, consensus_label)
            label_outliers[i] = label_outlier

            candidates = []
            for det in detections:
                raw_label = str(getattr(det, "label", ""))
                canonical_det_label = self._normalize_label(raw_label)
                det_bbox = getattr(det, "bbox", None) or (0, 0, 0, 0)
                if len(det_bbox) != 4:
                    det_bbox = (0, 0, 0, 0)
                candidates.append(
                    {
                        "raw_label": raw_label,
                        "canonical_label": canonical_det_label,
                        "confidence": float(getattr(det, "confidence", 0.0)),
                        "bbox": (
                            float(det_bbox[0]),
                            float(det_bbox[1]),
                            float(det_bbox[2]),
                            float(det_bbox[3]),
                        ),
                    }
                )

            if selected_det:
                bbox = selected_det.bbox
                w, h = pil_img.size
                x1, y1, x2, y2 = bbox
                x1, y1 = max(0, x1), max(0, y1)
                x2, y2 = min(w, x2), min(h, y2)

                if x2 > x1 and y2 > y1:
                    crop = pil_img.crop((x1, y1, x2, y2))
                else:
                    crop = pil_img

                cls_name = str(selected_det.label)
                det_conf = float(selected_det.confidence)
            else:
                # Fallback: Whole Image
                bbox = (0.0, 0.0, float(pil_img.width), float(pil_img.height))
                crop = pil_img
                cls_name = "unknown"
                det_conf = 0.0

            canonical_label = consensus_label or cls_name
            canonical_differs = canonical_label != cls_name
            logger.debug(
                "PP2_VIEW_SELECTION view=%d selected_label=%s canonical_label=%s canonical_differs=%s selected_conf=%.4f outlier=%s selected_by=%s",
                i,
                cls_name,
                canonical_label,
                canonical_differs,
                det_conf,
                label_outlier,
                selection_mode,
            )
            view_meta_by_index[i] = {
                "final_label": cls_name,
                "selected_label": cls_name,
                "canonical_label": canonical_label,
                "label_outlier": label_outlier,
                "selected_by": selection_mode,
                "candidates": candidates,
                "canonical_hint": canonical_hint_by_index.get(i),
                "florence_stage1_ms": stage1_ms_by_index.get(i),
            }
            
            crop_by_index[i] = crop
            canonical_label_by_index[i] = canonical_label

            # C. Embedding from stage-1 task; avoid extra GPU work for early-exit skipped views.
            vector = entry.get("stage1_vector")
            stage1_extraction = entry.get("stage1_extraction", {})
            if not isinstance(stage1_extraction, dict):
                stage1_extraction = {"caption": "", "ocr_text": "", "grounded_features": {}, "raw": {}}
            stage1_raw = stage1_extraction.get("raw", {})
            if not isinstance(stage1_raw, dict):
                stage1_raw = {}

            if not isinstance(vector, list) or not vector:
                if bool(early_exit_pair) and i not in set(early_exit_pair):
                    stage1_raw = self._mark_extraction_skipped(stage1_raw, ["embedding"])
                    stage1_extraction["raw"] = stage1_raw
                vector = [0.0] * max(1, int(resolved_embedding_dim))

            vectors.append([float(v) for v in vector])
            crops.append(crop)

            # E. Quality
            quality = self._compute_quality(crop)
            
            # E. Build Stage-1 Result Object (placeholder extraction, real extraction deferred)
            stage1_nonempty = self._is_stage1_nonempty(stage1_extraction)
            stage1_failed = self._is_florence_failed(stage1_extraction)
            per_view_results.append(PP2PerViewResult(
                view_index=i,
                filename=filename,
                detection=PP2PerViewDetection(
                    bbox=(float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3])),
                    cls_name=cls_name,
                    confidence=det_conf,
                    selected_by=selection_mode,
                    outlier_view=label_outlier,
                    candidates=candidates,
                ),
                extraction=PP2PerViewExtraction(
                    caption=str(stage1_extraction.get("caption", "")),
                    ocr_text=str(stage1_extraction.get("ocr_text", "")),
                    grounded_features=stage1_extraction.get("grounded_features", {}),
                    extraction_confidence=(
                        self.LITE_FAILED_EXTRACTION_CONFIDENCE
                        if stage1_failed
                        else (
                            self.lite_success_confidence
                            if stage1_nonempty
                            else self.LITE_FAILED_EXTRACTION_CONFIDENCE
                        )
                    ),
                    raw=stage1_extraction.get("raw", {}) if isinstance(stage1_extraction.get("raw", {}), dict) else {},
                ),
                embedding=PP2PerViewEmbedding(
                    dim=len(vector),
                    vector_preview=[float(v) for v in vector[:8]],
                    vector_id=f"{item_id}_view_{i}"
                ),
                quality_score=quality
            ))
            per_view_ms.append(float(entry.get("view_elapsed_ms", 0.0) or 0.0))

        outlier_views = sorted([idx for idx, is_outlier in label_outliers.items() if is_outlier])
        logger.debug(
            "PP2_CONSENSUS_OUTLIERS request_id=%s item_id=%s any_fallback=%s outlier_views=%s",
            trace_request_id,
            item_id,
            bool(outlier_views),
            outlier_views,
        )

        consensus_canonical = self._normalize_label(consensus_label) if consensus_label else None
        dropped_reasons_by_index: Dict[int, str] = {}
        for idx, result in enumerate(per_view_results):
            reasons: List[str] = []
            if bool(label_outliers.get(idx, False)) or bool(getattr(result.detection, "outlier_view", False)):
                reasons.append("outlier_view=true")

            selected_canonical = self._normalize_label(result.detection.cls_name)
            if consensus_canonical and selected_canonical != consensus_canonical:
                reasons.append(
                    f"label_mismatch_vs_consensus(selected={selected_canonical or 'unknown'}, consensus={consensus_canonical})"
                )

            if reasons:
                dropped_reasons_by_index[idx] = "; ".join(reasons)

        eligible_indices = sorted(
            idx for idx in range(len(per_view_results)) if idx not in dropped_reasons_by_index
        )
        logger.debug(
            "PP2_ELIGIBLE_VIEWS request_id=%s item_id=%s eligible_indices=%s",
            trace_request_id,
            item_id,
            eligible_indices,
        )

        # 4. Verification
        # Convert vectors to numpy for verifier
        verify_start = time.perf_counter()
        vectors_np = [np.array(v, dtype=np.float32) for v in vectors]
        embedding_variants_by_index: Dict[int, Dict[str, np.ndarray]] = {
            idx: {"full": vectors_np[idx]}
            for idx in range(len(vectors_np))
        }
        if early_exit_pair is None:
            for idx in eligible_indices:
                center_source = crop_by_index.get(idx)
                if center_source is None:
                    continue
                center_crop = self._center_crop(center_source, ratio=self.CENTER_CROP_RATIO)
                try:
                    center_vec = self.dino.embed_128(center_crop)
                except Exception:
                    logger.exception(
                        "PP2_CENTER_EMBEDDING_FAILED request_id=%s item_id=%s view=%d",
                        trace_request_id,
                        item_id,
                        idx,
                    )
                    continue
                embedding_variants_by_index[idx]["center"] = np.array(center_vec, dtype=np.float32)

        used_views: List[int] = []
        pair_scores: Dict[str, float] = {}
        valid_early_exit_pair: Optional[Tuple[int, int]] = None
        if early_exit_pair is not None:
            normalized_early_pair = tuple(sorted([int(early_exit_pair[0]), int(early_exit_pair[1])]))
            if all(idx in eligible_indices for idx in normalized_early_pair):
                valid_early_exit_pair = normalized_early_pair

        if len(eligible_indices) >= 2:
            best_pair: Optional[Tuple[int, int]] = None
            try:
                best_pair, pair_scores = self.verifier.select_best_pair(
                    vectors_np,
                    self.faiss,
                    candidate_indices=eligible_indices,
                    embedding_variants_by_index=embedding_variants_by_index,
                )
            except Exception:
                logger.exception(
                    "PP2_BEST_PAIR_SELECTION_FAILED request_id=%s item_id=%s eligible_indices=%s",
                    trace_request_id,
                    item_id,
                    eligible_indices,
                )
            if best_pair is None and valid_early_exit_pair is not None:
                best_pair = valid_early_exit_pair
            if best_pair is None:
                best_pair = (int(eligible_indices[0]), int(eligible_indices[1]))

            used_views = [int(best_pair[0]), int(best_pair[1])]
            for idx in eligible_indices:
                if idx not in used_views and idx not in dropped_reasons_by_index:
                    dropped_reasons_by_index[idx] = "not_best_pair_lower_similarity"

        dropped_views = [
            {"view_index": idx, "reason": dropped_reasons_by_index[idx]}
            for idx in sorted(dropped_reasons_by_index.keys())
        ]
        logger.debug(
            "PP2_BEST_PAIR_SELECTION request_id=%s item_id=%s eligible_indices=%s pair_scores=%s used_views=%s dropped_views=%s",
            trace_request_id,
            item_id,
            eligible_indices,
            pair_scores,
            used_views,
            dropped_views,
        )

        decision_indices = list(used_views) if len(used_views) == 2 else list(eligible_indices)
        verification = self.verifier.verify(
            per_view_results,
            vectors_np,
            crops,
            self.faiss,
            eligible_indices=decision_indices,
            used_views_override=used_views if len(used_views) == 2 else None,
            dropped_views=dropped_views,
            decision_category=consensus_label,
            embedding_variants_by_index=embedding_variants_by_index,
            request_id=trace_request_id,
            item_id=item_id,
        )
        verification_payload = verification.model_dump()
        verification_payload["used_views"] = used_views if len(used_views) == 2 else []
        verification_payload["dropped_views"] = dropped_views
        mode_value = str(verification_payload.get("mode", "") or "").strip().lower()
        if mode_value not in {"two_view", "three_view"}:
            if len(verification_payload["used_views"]) == 2:
                mode_value = "two_view"
            elif len(decision_indices) == 3:
                mode_value = "three_view"
            else:
                mode_value = "unsupported"
        verification_payload["mode"] = mode_value
        verification = PP2VerificationResult(**verification_payload)
        verify_ms = (time.perf_counter() - verify_start) * 1000.0

        gemini_evidence_by_index: Dict[int, Dict[str, Any]] = {}
        gemini_enabled = bool(getattr(settings, "PP2_ENABLE_GEMINI", False))
        gemini_on_near_miss = bool(getattr(settings, "PP2_GEMINI_ON_NEAR_MISS", True))
        near_miss = self._verification_has_near_miss(verification)
        selected_gemini_idx = self._select_best_gemini_view(per_view_results, verification)
        selected_sparse = (
            selected_gemini_idx is not None
            and 0 <= int(selected_gemini_idx) < len(per_view_results)
            and self._view_has_sparse_florence_text(per_view_results[int(selected_gemini_idx)])
        )
        should_run_gemini = (
            (not verification.passed)
            and gemini_enabled
            and ((not gemini_on_near_miss) or near_miss)
            and (selected_gemini_idx is not None)
            and selected_sparse
        )
        logger.debug(
            "PP2_GEMINI_POLICY request_id=%s item_id=%s enabled=%s verify_passed=%s near_miss=%s near_miss_required=%s selected_view=%s selected_sparse=%s should_run=%s",
            trace_request_id,
            item_id,
            gemini_enabled,
            bool(verification.passed),
            near_miss,
            gemini_on_near_miss,
            selected_gemini_idx,
            selected_sparse,
            should_run_gemini,
        )
        if should_run_gemini and selected_gemini_idx is not None:
            timeout_s = int(getattr(settings, "PP2_GEMINI_TIMEOUT_S", 12))
            timeout_s = max(1, timeout_s)
            gemini_evidence_by_index = self._run_gemini_for_views_parallel(
                indices=[int(selected_gemini_idx)],
                per_view_results=per_view_results,
                crop_by_index=crop_by_index,
                canonical_label_by_index=canonical_label_by_index,
                timeout_s=timeout_s,
                request_id=trace_request_id,
                item_id=item_id,
            )
            gemini_meta = gemini_evidence_by_index.get(int(selected_gemini_idx), {})
            gemini_status = str(gemini_meta.get("status", "")).strip().lower()
            if gemini_status in {"timeout", "error"}:
                warning = (
                    f"Gemini fallback {gemini_status} for view {int(selected_gemini_idx)}; "
                    "continuing with partial evidence."
                )
                if warning not in verification.failure_reasons:
                    verification.failure_reasons.append(warning)

        # 5. Optional detailed enrichment:
        # - verification fail => all views
        # - force grounding => all views (or used pair when early-exit skipped others)
        # - verification pass + sparse text on used pair => used pair only
        florence_detail_ms = 0.0
        force_grounding = bool(getattr(settings, "PP2_FORCE_GROUNDING", False))
        used_for_refinement = [int(idx) for idx in (verification.used_views or []) if isinstance(idx, int)]
        if len(used_for_refinement) < 2 and len(used_views) == 2:
            used_for_refinement = [int(used_views[0]), int(used_views[1])]
        pass_caption_refinement = (
            bool(verification.passed)
            and (not force_grounding)
            and self._needs_pass_caption_refinement(per_view_results, used_for_refinement)
        )
        should_run_detail = (not verification.passed) or force_grounding or pass_caption_refinement
        if should_run_detail:
            detail_start = time.perf_counter()
            per_view_by_index: Dict[int, PP2PerViewResult] = {res.view_index: res for res in per_view_results}
            detail_reason = "verification_failed"
            mark_non_targets_skipped = False
            if not verification.passed:
                detail_targets = set(range(len(per_view_results)))
                detail_reason = "verification_failed"
            elif force_grounding and early_exit_pair is not None:
                detail_targets = set(verification.used_views or list(early_exit_pair))
                detail_reason = "force_grounding_early_exit_used_pair"
                mark_non_targets_skipped = True
            elif force_grounding:
                detail_targets = set(range(len(per_view_results)))
                detail_reason = "force_grounding_all_views"
            else:
                detail_targets = set(used_for_refinement)
                detail_reason = "pass_sparse_refinement_used_pair"
            for idx in range(len(per_view_results)):
                if idx not in detail_targets:
                    if mark_non_targets_skipped:
                        existing_raw = per_view_by_index[idx].extraction.raw or {}
                        per_view_by_index[idx].extraction.raw = self._mark_extraction_skipped(existing_raw, ["detail_florence"])
                        per_view_by_index[idx].extraction.extraction_confidence = self.LITE_FAILED_EXTRACTION_CONFIDENCE
                    continue
                extraction_data = self.florence.analyze_ocr_first(
                    crop_by_index[idx],
                    canonical_label=canonical_label_by_index.get(idx),
                    fast=False,
                )
                normalized = self._normalize_extraction_payload(extraction_data)
                detail_nonempty = (
                    self._is_stage1_nonempty(normalized)
                    or bool(normalized.get("grounded_features"))
                )
                detail_failed = self._is_florence_failed(normalized)
                per_view_by_index[idx].extraction = PP2PerViewExtraction(
                    caption=normalized["caption"],
                    ocr_text=normalized["ocr_text"],
                    grounded_features=normalized["grounded_features"],
                    extraction_confidence=(
                        self.LITE_FAILED_EXTRACTION_CONFIDENCE
                        if detail_failed
                        else (1.0 if detail_nonempty else self.LITE_FAILED_EXTRACTION_CONFIDENCE)
                    ),
                    raw=normalized.get("raw", {}) if isinstance(normalized.get("raw", {}), dict) else {},
                )
            florence_detail_ms = (time.perf_counter() - detail_start) * 1000.0
            logger.debug(
                "PP2_FLORENCE_OCR_FIRST_DETAILED request_id=%s item_id=%s executed_views=%s verify_passed=%s forced=%s pass_refinement=%s reason=%s detail_ms=%.2f",
                trace_request_id,
                item_id,
                sorted(list(detail_targets)),
                bool(verification.passed),
                force_grounding,
                pass_caption_refinement,
                detail_reason,
                florence_detail_ms,
            )
        else:
            if early_exit_pair is not None:
                used_set = set(verification.used_views or list(early_exit_pair))
                for idx, res in enumerate(per_view_results):
                    if idx in used_set:
                        continue
                    existing_raw = res.extraction.raw or {}
                    res.extraction.raw = self._mark_extraction_skipped(existing_raw, ["detail_florence"])
                    res.extraction.extraction_confidence = self.LITE_FAILED_EXTRACTION_CONFIDENCE
            logger.debug(
                "PP2_FLORENCE_OCR_FIRST_DETAILED_SKIPPED request_id=%s item_id=%s verify_passed=%s forced=%s pass_refinement=%s",
                trace_request_id,
                item_id,
                bool(verification.passed),
                force_grounding,
                pass_caption_refinement,
            )

        if gemini_evidence_by_index:
            for idx, gemini_meta in gemini_evidence_by_index.items():
                if idx < 0 or idx >= len(per_view_results):
                    continue
                existing_raw = per_view_results[idx].extraction.raw or {}
                if not isinstance(existing_raw, dict):
                    existing_raw = {}
                existing_raw["gemini"] = gemini_meta
                per_view_results[idx].extraction.raw = existing_raw

        # 6. Fusion & Storage
        fused = None
        stored = False
        cache_key = None
        storage_ms = 0.0
        
        if verification.passed:
            storage_start = time.perf_counter()
            selected_indices = (
                list(verification.used_views)
                if len(getattr(verification, "used_views", [])) == 2
                else (decision_indices if len(decision_indices) == 2 else list(range(len(per_view_results))))
            )
            fused = self.fusion.fuse(
                per_view_results,
                vectors_np,
                item_id=item_id,
                view_meta_by_index=view_meta_by_index,
                used_view_indices=selected_indices,
            )

            try:
                selected_vectors = [vectors_np[i] for i in selected_indices]
                fused_vector_np = self.fusion.compute_fused_vector(selected_vectors)
                faiss_id = self.faiss.add(
                    fused_vector_np,
                    metadata={
                        "item_id": item_id,
                        "fused_embedding_id": fused.fused_embedding_id,
                        "embedding_id": fused.fused_embedding_id,
                        "view_index": None,
                        "best_view_index": fused.best_view_index,
                        "category": fused.category,
                    },
                )
            except Exception:
                logger.exception(
                    "PP2_FUSED_VECTOR_INDEXING_FAILED request_id=%s item_id=%s embedding_id=%s",
                    trace_request_id,
                    item_id,
                    fused.fused_embedding_id,
                )
            else:
                # Prepare data for synchronous storage call
                per_view_dicts = [res.model_dump() for res in per_view_results]
                fused_dict = fused.model_dump()

                result = storage.store_multiview_result(
                    item_id=item_id,
                    per_view_results=per_view_dicts,
                    fused_profile=fused_dict,
                    fused_vector=fused_vector_np.tolist(),
                    faiss_id=faiss_id,
                )

                stored = result.get("stored", False)
                cache_key = result.get("cache_key")
            storage_ms = (time.perf_counter() - storage_start) * 1000.0
        else:
            logger.debug(
                "PP2_STORAGE_SKIPPED request_id=%s item_id=%s verification_passed=false",
                trace_request_id,
                item_id,
            )

        total_ms = (time.perf_counter() - request_start) * 1000.0
        logger.info(
            "PP2_TIMING request_id=%s item_id=%s total_ms=%.2f per_view_avg_ms=%.2f verify_ms=%.2f florence_stage1_total_ms=%.2f florence_stage1_avg_ms=%.2f florence_detail_ms=%.2f storage_ms=%.2f early_exit=%s profile=%s",
            trace_request_id,
            item_id,
            total_ms,
            (sum(per_view_ms) / len(per_view_ms)) if per_view_ms else 0.0,
            verify_ms,
            florence_stage1_total_ms,
            (florence_stage1_total_ms / len(view_inputs)) if view_inputs else 0.0,
            florence_detail_ms,
            storage_ms,
            bool(early_exit_pair),
            profile,
        )
        if total_ms > 18000:
            logger.warning(
                "PP2_SLOW_REQUEST request_id=%s item_id=%s total_ms=%.2f profile=%s",
                trace_request_id,
                item_id,
                total_ms,
                profile,
            )
        logger.info(
            "PP2_PIPELINE_END request_id=%s item_id=%s verification_passed=%s stored=%s total_ms=%.2f early_exit_pair=%s",
            trace_request_id,
            item_id,
            bool(verification.passed),
            bool(stored),
            total_ms,
            list(early_exit_pair) if early_exit_pair else [],
        )

        per_view_results = sorted(per_view_results, key=lambda r: int(r.view_index))
             
        return PP2Response(
            item_id=item_id,
            per_view=per_view_results,
            verification=verification,
            fused=fused,
            stored=stored,
            cache_key=cache_key
        )
