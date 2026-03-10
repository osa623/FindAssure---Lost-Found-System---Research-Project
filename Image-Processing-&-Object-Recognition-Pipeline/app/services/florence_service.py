"""
Florence-2 service wrapper.

Responsibilities:
- caption(image, detailed=True) -> str
- analyze_crop(crop, canonical_label=None) -> dict:
    {
      "caption": str,
      "ocr_text": str,
      "color_vqa": str | None,
      "grounded_features": list[str],
      "grounded_defects": list[str],
      "grounded_attachments": list[str],
      "key_count": int | None,
      "raw": dict
    }

Notes:
- Loads model from local path: app/models/florence2-large-ft/
- Fails fast if model path is missing.
- Uses CATEGORY_SPECS for grounding candidates.
- For PP2, list-style grounded fields are normalized in the pipeline into
  a strict dict-based `grounded_features` contract.
"""

from __future__ import annotations

import atexit
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
import io
import multiprocessing as mp
import os
import queue
import re
import logging
import math
import threading
import time

from PIL import Image

from app.domain.category_specs import canonicalize_label, CATEGORY_SPECS
from app.domain.color_utils import normalize_color, extract_color_from_text
from app.config.settings import settings
from app.services.gpu_semaphore import gpu_inference_guard

logger = logging.getLogger(__name__)


def _lite_worker_main(req_q: Any, resp_q: Any, service_cfg: Dict[str, Any]) -> None:
    """
    Dedicated worker process for Florence-lite inference.
    This allows hard timeouts by terminating the worker process.
    """
    svc = FlorenceService(
        model_path=str(service_cfg.get("model_path", "app/models/florence2-large-ft/")),
        device=str(service_cfg.get("device", "cuda")),
        torch_dtype=str(service_cfg.get("torch_dtype", "auto")),
        max_new_tokens=int(service_cfg.get("max_new_tokens", 512)),
    )
    svc.perf_profile = str(service_cfg.get("perf_profile", "balanced")).lower()

    while True:
        msg = req_q.get()
        if not isinstance(msg, dict):
            continue
        if msg.get("cmd") == "stop":
            break

        req_id = msg.get("req_id")
        try:
            image_bytes = msg.get("image_bytes", b"")
            profile_key = str(msg.get("profile_key", "balanced")).lower()
            crop = Image.open(io.BytesIO(image_bytes)).convert("RGB")
            result = svc._analyze_crop_lite_core(crop, profile_key)
            resp_q.put({"req_id": req_id, "ok": True, "result": result})
        except Exception as exc:
            resp_q.put(
                {
                    "req_id": req_id,
                    "ok": False,
                    "error": str(exc),
                    "error_type": "exception",
                }
            )


@dataclass
class Detection:
    label: str
    confidence: float
    bbox: Tuple[int, int, int, int]  # x1,y1,x2,y2


@dataclass
class FlorenceDetection:
    """Enriched detection from Florence OD + per-crop caption/OCR."""
    label: str
    confidence: float
    bbox: Tuple[int, int, int, int]  # x1,y1,x2,y2
    caption: str
    ocr_text: str


@dataclass
class OCRToken:
    text: str
    bbox: Tuple[float, float, float, float]


@dataclass
class OCRLine:
    text: str
    bbox: Tuple[float, float, float, float]
    block_index: int


def _safe_str(x: Any) -> str:
    if x is None:
        return ""
    if isinstance(x, str):
        return x
    try:
        return str(x)
    except Exception:
        return ""


def _dedup_phrases(items: List[str]) -> List[str]:
    out: List[str] = []
    seen = set()
    for it in items or []:
        s = " ".join(it.strip().split())
        if not s:
            continue
        key = s.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(s)
    return out


def _normalize_grounding_candidates(candidates: List[str]) -> List[str]:
    """
    Splits combined strings (e.g. "scratch. dent") and normalizes phrases.
    """
    out = []
    for c in candidates:
        # Split by common delimiters
        parts = re.split(r'[.,;|]', c)
        for p in parts:
            s = p.strip()
            if s:
                out.append(s)
    # Dedup case-insensitive
    seen = set()
    final = []
    for x in out:
        k = x.lower()
        if k not in seen:
            seen.add(k)
            final.append(x)
    return final


def _chunk_list(items: List[str], chunk_size: int = 25) -> List[List[str]]:
    return [items[i:i + chunk_size] for i in range(0, len(items), chunk_size)]


def _normalize_ocr_text(value: Any) -> str:
    text = _safe_str(value)
    # Strip model special tokens (</s>, <s>, <pad>, etc.)
    text = re.sub(r"</\s*s\s*>|<s>|<pad>", "", text, flags=re.IGNORECASE)
    # Strip any remaining isolated XML/HTML-like tags (short tags only)
    text = re.sub(r"<[^>]{0,10}>", "", text)
    # Collapse whitespace
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _median(values: List[float], default: float = 0.0) -> float:
    clean = sorted(float(v) for v in values if v is not None)
    if not clean:
        return float(default)
    mid = len(clean) // 2
    if len(clean) % 2:
        return clean[mid]
    return (clean[mid - 1] + clean[mid]) / 2.0


def _flatten_numbers(value: Any) -> List[float]:
    if isinstance(value, dict):
        out: List[float] = []
        for nested in value.values():
            out.extend(_flatten_numbers(nested))
        return out
    if isinstance(value, (list, tuple)):
        out: List[float] = []
        for nested in value:
            out.extend(_flatten_numbers(nested))
        return out
    try:
        return [float(value)]
    except Exception:
        return []


def _coerce_bbox(value: Any) -> Optional[Tuple[float, float, float, float]]:
    if value is None:
        return None

    if isinstance(value, dict):
        for key in ("bbox", "box", "quad_box", "quad_boxes", "polygon", "polygons", "points"):
            if key in value:
                coerced = _coerce_bbox(value.get(key))
                if coerced:
                    return coerced
        keys = ("x1", "y1", "x2", "y2")
        if all(k in value for k in keys):
            try:
                x1, y1, x2, y2 = (float(value[k]) for k in keys)
                if x2 > x1 and y2 > y1:
                    return (x1, y1, x2, y2)
            except Exception:
                return None

    nums = _flatten_numbers(value)
    if len(nums) == 4:
        x1, y1, x2, y2 = nums
        if x2 > x1 and y2 > y1:
            return (x1, y1, x2, y2)
    if len(nums) >= 8 and len(nums) % 2 == 0:
        xs = nums[0::2]
        ys = nums[1::2]
        x1, x2 = min(xs), max(xs)
        y1, y2 = min(ys), max(ys)
        if x2 > x1 and y2 > y1:
            return (x1, y1, x2, y2)
    return None


def _union_bbox(boxes: List[Tuple[float, float, float, float]]) -> Tuple[float, float, float, float]:
    x1 = min(box[0] for box in boxes)
    y1 = min(box[1] for box in boxes)
    x2 = max(box[2] for box in boxes)
    y2 = max(box[3] for box in boxes)
    return (x1, y1, x2, y2)


def _join_ocr_tokens(tokens: List[OCRToken]) -> str:
    if not tokens:
        return ""

    pieces: List[str] = []
    last_text = ""
    for token in tokens:
        text = _normalize_ocr_text(token.text)
        if not text:
            continue
        if not pieces:
            pieces.append(text)
            last_text = text
            continue

        no_space_before = bool(re.match(r"^[,.;:!?%)}\]/]", text))
        no_space_after_prev = bool(re.search(r"[(\[{/$-]$", last_text))
        if no_space_before or no_space_after_prev:
            pieces[-1] = pieces[-1] + text
        else:
            pieces.append(text)
        last_text = text

    return " ".join(piece for piece in pieces if piece).strip()


def _build_ocr_layout(tokens: List[OCRToken], source: str) -> Dict[str, Any]:
    clean_tokens = [
        OCRToken(text=_normalize_ocr_text(token.text), bbox=token.bbox)
        for token in tokens
        if _normalize_ocr_text(token.text)
    ]
    if not clean_tokens:
        return {
            "ocr_text": "",
            "ocr_text_display": "",
            "ocr_lines": [],
            "ocr_layout_source": source,
            "ocr_tokens": [],
        }

    sorted_tokens = sorted(
        clean_tokens,
        key=lambda token: (
            (token.bbox[1] + token.bbox[3]) / 2.0,
            token.bbox[0],
        ),
    )
    token_heights = [max(1.0, token.bbox[3] - token.bbox[1]) for token in sorted_tokens]
    median_height = max(8.0, _median(token_heights, 10.0))
    line_y_threshold = max(8.0, median_height * 0.7)

    grouped_lines: List[List[OCRToken]] = []
    line_centers: List[float] = []
    for token in sorted_tokens:
        token_center_y = (token.bbox[1] + token.bbox[3]) / 2.0
        if grouped_lines and abs(token_center_y - line_centers[-1]) <= line_y_threshold:
            grouped_lines[-1].append(token)
            centers = [
                (line_token.bbox[1] + line_token.bbox[3]) / 2.0
                for line_token in grouped_lines[-1]
            ]
            line_centers[-1] = sum(centers) / float(len(centers))
        else:
            grouped_lines.append([token])
            line_centers.append(token_center_y)

    built_lines: List[OCRLine] = []
    sorted_grouped = sorted(
        grouped_lines,
        key=lambda group: min(token.bbox[1] for token in group),
    )

    line_heights: List[float] = []
    prev_line: Optional[OCRLine] = None
    current_block = 0
    for token_group in sorted_grouped:
        ordered_tokens = sorted(token_group, key=lambda token: token.bbox[0])
        line_text = _join_ocr_tokens(ordered_tokens)
        if not line_text:
            continue
        line_bbox = _union_bbox([token.bbox for token in ordered_tokens])
        line_height = max(1.0, line_bbox[3] - line_bbox[1])
        line_heights.append(line_height)

        if prev_line is not None:
            prev_bbox = prev_line.bbox
            vertical_gap = line_bbox[1] - prev_bbox[3]
            indent_delta = abs(line_bbox[0] - prev_bbox[0])
            median_line_height = max(10.0, _median(line_heights, line_height))
            new_block = (
                vertical_gap > (median_line_height * 0.9)
                or (indent_delta > (median_line_height * 1.2) and vertical_gap > math.ceil(median_line_height * 0.2))
            )
            if new_block:
                current_block += 1

        built_lines.append(
            OCRLine(
                text=line_text,
                bbox=line_bbox,
                block_index=current_block,
            )
        )
        prev_line = built_lines[-1]

    deduped_lines: List[OCRLine] = []
    for line in built_lines:
        if deduped_lines and deduped_lines[-1].text.lower() == line.text.lower():
            continue
        deduped_lines.append(line)

    display_parts: List[str] = []
    for idx, line in enumerate(deduped_lines):
        if idx > 0 and line.block_index != deduped_lines[idx - 1].block_index:
            display_parts.append("")
        display_parts.append(line.text)

    compact_text = " ".join(line.text for line in deduped_lines).strip()
    display_text = "\n".join(display_parts).strip()

    return {
        "ocr_text": compact_text,
        "ocr_text_display": display_text,
        "ocr_lines": [
            {
                "text": line.text,
                "bbox": [round(coord, 2) for coord in line.bbox],
                "block_index": line.block_index,
            }
            for line in deduped_lines
        ],
        "ocr_layout_source": source,
        "ocr_tokens": [
            {
                "text": token.text,
                "bbox": [round(coord, 2) for coord in token.bbox],
            }
            for token in sorted_tokens
        ],
    }


def _caption_mentions_person(text: str) -> bool:
    """True if text mentions person-related words."""
    if not text:
        return False
    keywords = {
        "person", "hand", "finger", "skin", "holding", "man", "woman",
        "boy", "girl", "human", "selfie",
    }
    text_lower = text.lower()
    words = set(re.findall(r"\b\w+\b", text_lower))
    return bool(keywords & words)


def _caption_mentions_demographics(text: str) -> bool:
    """True if text mentions demographics or skin tone."""
    if not text:
        return False
    text_lower = text.lower()
    patterns = [
        r"person is (white|black|asian|brown)",
        r"skin tone",
        r"race",
        r"gender",
        r"ethnicity"
    ]
    for p in patterns:
        if re.search(p, text_lower):
            return True
    return False


def _caption_mentions_scene(text: str) -> bool:
    """True if text mentions scene/camera/meta context rather than the object."""
    if not text:
        return False
    scene_patterns = [
        r"\btaking\s+a\s+(?:photo|picture|pic)\b",
        r"\bclose[\s-]?up\b",
        r"\bthis\s+(?:image|photo|picture)\b",
        r"\bin\s+(?:the\s+)?(?:image|photo|picture)\b",
        r"\bcan\s+(?:be\s+)?seen\b",
        r"\bplaced\s+on\s+(?:a\s+)?(?:table|desk|surface|floor)\b",
        r"\bsitting\s+on\s+(?:a\s+)?(?:table|desk|surface|wood)\b",
        r"\blying\s+on\b",
        r"\bon\s+(?:a\s+)?(?:wooden\s+)?table\b",
        # Background object as sentence subject ("a white table under the helmet")
        r"^(?:a|the|an)\s+(?:\w+\s+){0,2}(?:table|desk|surface|floor|wall|carpet|mat|counter|shelf)\s+(?:under|near|beside|below|beneath|behind|next\s+to)\b",
    ]
    text_lower = text.lower()
    return any(re.search(p, text_lower) for p in scene_patterns)


def _strip_caption_context(text: str) -> str:
    cleaned = str(text or "").strip()
    if not cleaned:
        return ""

    prefix_patterns = [
        r"(?i)^a\s+person\s+is\s+holding\s+",
        r"(?i)^the\s+person\s+is\s+holding\s+",
        r"(?i)^someone\s+is\s+holding\s+",
        r"(?i)^a\s+hand\s+is\s+holding\s+",
        r"(?i)^the\s+hand\s+is\s+holding\s+",
        r"(?i)^held\s+in\s+(?:a\s+)?hand\s*,?\s*",
        r"(?i)^being\s+held\s+in\s+(?:a\s+)?hand\s*,?\s*",
        r"(?i)^close[\s-]?up\s+of\s+",
        r"(?i)^this\s+(?:image|photo|picture)\s+shows\s+",
        r"(?i)^in\s+(?:this|the)\s+(?:image|photo|picture)\s*,?\s*",
        r"(?i)^there\s+is\s+",
        r"(?i)^(?:the\s+)?(?:inside|front|back|side|rear|top|bottom)\s+view\s+shows\s+",
    ]
    for pattern in prefix_patterns:
        cleaned = re.sub(pattern, "", cleaned).strip()

    tail_patterns = [
        r"(?i)\s+(?:on|against|near|beside|above|over|below|beneath|next\s+to)\s+(?:a\s+|the\s+)?(?:\w+\s+){0,2}(?:table|desk|surface|floor|wall|carpet|mat|counter|shelf)\b.*$",
        r"(?i)\s+sitting\s+on\s+(?:a\s+|the\s+)?(?:\w+\s+)?(?:table|desk|surface|floor)\b.*$",
        r"(?i)\s+lying\s+on\s+(?:a\s+|the\s+)?(?:\w+\s+)?(?:table|desk|surface|floor)\b.*$",
        r"(?i)\s+is\s+sitting\s+on\s+(?:a\s+|the\s+)?(?:\w+\s+)?(?:table|desk|surface|floor)\b.*$",
        r"(?i)\s+is\s+lying\s+on\s+(?:a\s+|the\s+)?(?:\w+\s+)?(?:table|desk|surface|floor)\b.*$",
        r"(?i)\s+is\s+sitting\b.*$",
        r"(?i)\s+is\s+lying\b.*$",
    ]
    for pattern in tail_patterns:
        cleaned = re.sub(pattern, "", cleaned).strip(" ,.")

    return cleaned


def _sanitize_caption(text: str) -> Tuple[str, List[str]]:
    """
    Splits caption into sentences and drops those mentioning person/hand/skin
    or scene/camera/background context.
    Returns (sanitized_text, removed_sentences).
    """
    if not text:
        return "", []
    
    # Split by . ! ? but keep delimiters. Simple split by . is often enough for Florence.
    sentences = re.split(r'(?<=[.!?])\s+', text)
    
    kept = []
    removed = []
    
    for s in sentences:
        stripped = _strip_caption_context(s)
        if stripped and stripped != s:
            s = stripped

        if s.strip().lower() in {"it", "this", "that", "object", "item"}:
            removed.append(s)
            continue

        if _caption_mentions_person(s) or _caption_mentions_demographics(s) or _caption_mentions_scene(s):
            removed.append(s)
        else:
            normalized = s.strip().rstrip(". ")
            if normalized:
                kept.append(normalized + ".")
            
    return " ".join(kept).strip(), removed


def _is_generic_caption(text: str) -> bool:
    """
    Returns True if caption is too short or matches generic patterns.
    """
    if not text:
        return True
    
    # 1. Length check (< 5 words) — lowered from 10 to preserve valid short
    #    captions like "A brown leather wallet with stitched logo" (8 words).
    words = text.split()
    if len(words) < 5:
        return True
        
    text_lower = text.lower()
    
    # 2. Generic patterns check
    intros = ["in this picture", "in this image", "we can see", "this picture shows", "there is", "an image of", "a photo of"]
    clean_text = text_lower
    for intro in intros:
        if clean_text.startswith(intro):
            clean_text = clean_text[len(intro):].strip()
            
    # If remainder is very short (< 4 words), it's generic (e.g. "a bag", "an object")
    if len(clean_text.split()) < 4:
        return True
    
    # Check for specific generic phrases
    generic_phrases = ["a bag", "an object", "a person"]
    for phrase in generic_phrases:
        if phrase in clean_text and len(clean_text.split()) <= len(phrase.split()) + 2:
             return True
             
    return False


def _normalize_ocr_quote(ocr_text: str, max_words: int = 10, max_chars: int = 80) -> str:
    cleaned = " ".join(str(ocr_text or "").split()).strip()
    if not cleaned:
        return ""

    snippet = " ".join(cleaned.split()[:max_words])
    if len(snippet) > max_chars:
        snippet = snippet[: max_chars - 1].rstrip()
    return snippet


def _build_florence_description(
    caption: str,
    label: Optional[str] = None,
    color: Optional[str] = None,
    ocr_text: str = "",
    grounded_features: Optional[List[str]] = None,
    grounded_defects: Optional[List[str]] = None,
    grounded_attachments: Optional[List[str]] = None,
    key_count: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Build a description directly from Florence caption/VQA output.
    No word-cap — preserves the full richness of Florence's output.
    """
    # Clean caption: remove meta-phrases that Florence sometimes injects
    desc = _safe_str(caption).strip()
    meta_patterns = [
        r"(?i)^this (?:image |picture |photo |answering |answer ).*?(?:shows?|depicts?|contains?|requires?)\s+",
        r"(?i)^(?:the image |the picture |the photo )(?:shows?|depicts?|contains?)\s+",
        r"(?i)\bthis (?:answering|answer) does not require\b.*$",
    ]
    for pat in meta_patterns:
        desc = re.sub(pat, "", desc).strip()
    desc, _ = _sanitize_caption(desc)
    if _is_generic_caption(desc):
        desc = ""

    # Build a structured prefix with label/color if available
    prefix_parts = []
    canonical = canonicalize_label(label or "") if label else None
    if canonical:
        label_word = canonical.lower()
        if canonical == "Key" and isinstance(key_count, int) and key_count > 1:
            label_word = f"{key_count} keys"
        prefix_parts.append(label_word)

    if color and str(color).lower() not in ("unknown", "none", ""):
        prefix_parts.insert(0, str(color).lower())

    desc_lower = desc.lower()
    sentences = []
    if prefix_parts:
        prefix = " ".join(prefix_parts)
        if not desc or not any(p in desc_lower[:60] for p in prefix_parts):
            sentences.append(f"A {prefix}.")
    if desc:
        sentences.append(desc.rstrip(". ") + ".")

    # Append grounded evidence that the caption may have missed
    extras = []
    features = grounded_features or []
    defects = grounded_defects or []
    attachments = grounded_attachments or []

    unseen_features = [f for f in features if f.lower() not in desc_lower]
    if unseen_features:
        extras.append("It has " + ", ".join(unseen_features[:5]) + ".")

    unseen_defects = [d for d in defects if d.lower() not in desc_lower]
    if unseen_defects:
        extras.append("It shows " + ", ".join(unseen_defects[:3]) + ".")

    unseen_attachments = [a for a in attachments if a.lower() not in desc_lower]
    if unseen_attachments:
        extras.append("It includes " + ", ".join(unseen_attachments[:3]) + ".")

    if ocr_text and ocr_text.strip():
        snippet = _normalize_ocr_quote(ocr_text)
        if snippet.lower() not in desc_lower:
            extras.append(f'The text "{snippet}" is visible on the surface.')

    if extras:
        sentences.extend(extras)

    if not sentences:
        sentences.append("Item visible in the image.")

    desc = " ".join(sentence.strip() for sentence in sentences if sentence.strip())

    word_count = len(desc.split())

    evidence = []
    if caption:
        evidence.append("florence_caption")
    if features:
        evidence.append("grounded_features")
    if defects:
        evidence.append("grounded_defects")
    if attachments:
        evidence.append("grounded_attachments")
    if ocr_text:
        evidence.append("ocr_text")

    return {
        "final_description": desc,
        "detailed_description": desc,
        "description_source": "florence_direct",
        "detailed_description_source": "florence_direct",
        "description_evidence_used": {"summary": evidence, "detailed": evidence},
        "description_filters_applied": ["florence_direct"],
        "description_word_count": {"final_description": word_count, "detailed_description": word_count},
        "description_timings_ms": {},
    }


class FlorenceService:
    _shared_model = None
    _shared_processor = None
    _shared_model_key = None
    _shared_using_fp16 = False
    _shared_lock = threading.Lock()

    def __init__(
        self,
        model_path: str = "app/models/florence2-large-ft/",
        device: str = "cuda",
        torch_dtype: str = "auto",
        max_new_tokens: int = 512,
    ) -> None:
        self.model_path = model_path
        
        import torch
        if device == "cuda" and not torch.cuda.is_available():
            print("Warning: CUDA requested but not available. Falling back to CPU.")
            self.device = "cpu"
        else:
            self.device = device

        self.torch_dtype = torch_dtype
        self.max_new_tokens = max_new_tokens
        self.fast_max_new_tokens = settings.FLORENCE_FAST_MAX_NEW_TOKENS
        self.fast_num_beams = settings.FLORENCE_FAST_NUM_BEAMS
        self.perf_profile = str(settings.PERF_PROFILE).lower()
        self.enable_amp = bool(getattr(settings, "FLORENCE_ENABLE_AMP", True))
        self.use_fp16 = bool(getattr(settings, "FLORENCE_USE_FP16", True))
        self.ocr_max_side = int(getattr(settings, "FLORENCE_OCR_MAX_SIDE", 512))
        self.caption_max_side = int(getattr(settings, "FLORENCE_CAPTION_MAX_SIDE", 640))
        self._using_fp16 = False

        self._processor = None
        self._model = None
        self._model_load_lock = threading.Lock()

        self._lite_worker_ctx = mp.get_context("spawn")
        self._lite_worker_proc = None
        self._lite_req_q = None
        self._lite_resp_q = None
        self._lite_req_counter = 0
        self._lite_worker_lock = threading.Lock()
        atexit.register(self._shutdown_lite_worker)

    def _shutdown_lite_worker(self) -> None:
        with self._lite_worker_lock:
            self._stop_lite_worker_locked()

    def _start_lite_worker_locked(self) -> None:
        proc = self._lite_worker_proc
        if proc is not None and proc.is_alive():
            return

        req_q = self._lite_worker_ctx.Queue(maxsize=2)
        resp_q = self._lite_worker_ctx.Queue(maxsize=2)
        service_cfg = {
            "model_path": self.model_path,
            "device": self.device,
            "torch_dtype": self.torch_dtype,
            "max_new_tokens": self.max_new_tokens,
            "perf_profile": self.perf_profile,
        }
        proc = self._lite_worker_ctx.Process(
            target=_lite_worker_main,
            args=(req_q, resp_q, service_cfg),
            daemon=True,
            name="florence-lite-worker",
        )
        proc.start()
        self._lite_req_q = req_q
        self._lite_resp_q = resp_q
        self._lite_worker_proc = proc

    def _stop_lite_worker_locked(self) -> None:
        proc = self._lite_worker_proc
        req_q = self._lite_req_q
        resp_q = self._lite_resp_q

        if proc is None and req_q is None and resp_q is None:
            return

        try:
            if req_q is not None:
                req_q.put_nowait({"cmd": "stop"})
        except Exception:
            logger.debug("Lite worker stop signal failed", exc_info=True)

        try:
            if proc is not None and proc.is_alive():
                proc.join(timeout=0.2)
                if proc.is_alive():
                    proc.terminate()
                    proc.join(timeout=1.0)
                if proc.is_alive() and hasattr(proc, "kill"):
                    proc.kill()
                    proc.join(timeout=1.0)
        except Exception:
            logger.debug("Lite worker process cleanup failed", exc_info=True)

        for q in (req_q, resp_q):
            if q is None:
                continue
            try:
                q.close()
            except Exception:
                logger.debug("Queue close failed", exc_info=True)
            try:
                q.cancel_join_thread()
            except Exception:
                logger.debug("Queue cancel_join_thread failed", exc_info=True)

        self._lite_worker_proc = None
        self._lite_req_q = None
        self._lite_resp_q = None

    def _next_lite_req_id_locked(self) -> int:
        self._lite_req_counter += 1
        return int(self._lite_req_counter)

    # ----------------------------
    # Model loading / core runner
    # ----------------------------
    def _cache_key(self) -> Tuple[str, str, str, bool]:
        return (
            os.path.abspath(self.model_path),
            str(self.device),
            str(self.torch_dtype),
            bool(self.device == "cuda" and self.use_fp16),
        )

    def load_model(self) -> None:
        if self._model is not None and self._processor is not None:
            logger.debug("FLORENCE_MODEL_LOAD_SKIP_ALREADY_LOADED")
            return
        lock = getattr(self, "_model_load_lock", None)
        if lock is None:
            self._model_load_lock = threading.Lock()
            lock = self._model_load_lock
        assert lock is not None
        with lock:
            if self._model is not None and self._processor is not None:
                logger.debug("FLORENCE_MODEL_LOAD_SKIP_ALREADY_LOADED_LOCKED")
                return
            cache_key = self._cache_key()
            with FlorenceService._shared_lock:
                if (
                    FlorenceService._shared_model is not None
                    and FlorenceService._shared_processor is not None
                    and FlorenceService._shared_model_key == cache_key
                ):
                    self._model = FlorenceService._shared_model
                    self._processor = FlorenceService._shared_processor
                    self._using_fp16 = bool(FlorenceService._shared_using_fp16)
                    logger.debug(
                        "FLORENCE_MODEL_REUSE_SHARED model_path=%s device=%s fp16=%s",
                        self.model_path,
                        self.device,
                        self._using_fp16,
                    )
                    return

            logger.debug(
                "FLORENCE_MODEL_LOAD_START model_path=%s device=%s",
                self.model_path,
                self.device,
            )
            if not os.path.exists(self.model_path):
                raise RuntimeError(f"Florence model not found at {self.model_path}. Please ensure weights are present locally.")

            from transformers import AutoModelForCausalLM, AutoProcessor, dynamic_module_utils  # type: ignore
            import torch  # type: ignore
            from unittest.mock import patch

            # Workaround for flash_attn dependency on Windows
            original_check_imports = dynamic_module_utils.check_imports

            def custom_check_imports(filename):
                try:
                    return original_check_imports(filename)
                except ImportError as e:
                    if "flash_attn" in str(e):
                        return []
                    raise e

            kwargs = {"trust_remote_code": True, "local_files_only": True}
            
            try:
                with patch("transformers.dynamic_module_utils.check_imports", side_effect=custom_check_imports):
                    self._processor = AutoProcessor.from_pretrained(self.model_path, **kwargs)
            except Exception as e:
                 raise RuntimeError(f"Failed to load Florence processor from {self.model_path}: {e}")

            # dtype
            if self.torch_dtype == "auto":
                model_kwargs = {"trust_remote_code": True, "local_files_only": True}
            else:
                dtype = getattr(torch, self.torch_dtype)
                model_kwargs = {"trust_remote_code": True, "torch_dtype": dtype, "local_files_only": True}
            
            # Use SDPA attention if available (PyTorch 2.0+) to avoid flash_attn dependency
            if hasattr(torch.nn.functional, "scaled_dot_product_attention"):
                 model_kwargs["attn_implementation"] = "sdpa"
            else:
                 model_kwargs["attn_implementation"] = "eager"

            try:
                with patch("transformers.dynamic_module_utils.check_imports", side_effect=custom_check_imports):
                    self._model = AutoModelForCausalLM.from_pretrained(self.model_path, **model_kwargs)
            except Exception as e:
                # Fallback: try without attn_implementation if it fails (some older transformers versions)
                if "attn_implementation" in model_kwargs:
                    del model_kwargs["attn_implementation"]
                    try:
                        with patch("transformers.dynamic_module_utils.check_imports", side_effect=custom_check_imports):
                            self._model = AutoModelForCausalLM.from_pretrained(self.model_path, **model_kwargs)
                    except Exception as e2:
                        raise RuntimeError(f"Failed to load Florence model from {self.model_path}: {e2}")
                else:
                    raise RuntimeError(f"Failed to load Florence model from {self.model_path}: {e}")

            if self.device:
                self._model.to(self.device)
            if self.device == "cuda" and self.use_fp16:
                try:
                    self._model.half()
                    self._using_fp16 = True
                except Exception:
                    self._using_fp16 = False
                    logger.warning("FLORENCE_MODEL_HALF_FAILED_FALLBACK_FP32")
            else:
                self._using_fp16 = False
            self._model.eval()
            with FlorenceService._shared_lock:
                FlorenceService._shared_model = self._model
                FlorenceService._shared_processor = self._processor
                FlorenceService._shared_model_key = cache_key
                FlorenceService._shared_using_fp16 = bool(self._using_fp16)
            logger.debug(
                "FLORENCE_MODEL_LOAD_DONE model_path=%s device=%s fp16=%s",
                self.model_path,
                self.device,
                self._using_fp16,
            )

    def _run_task(
        self,
        image: Image.Image,
        task: str,
        text: Optional[str] = None,
        profile: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Run a Florence task and return post-processed JSON when possible.

        task examples (commonly used with Florence-2):
          "<CAPTION>", "<DETAILED_CAPTION>", "<OCR>", "<VQA>"
        """
        self.load_model()
        assert self._processor is not None and self._model is not None

        import torch  # type: ignore

        prompt = task if text is None else f"{task} {text}"
        inputs = self._processor(text=prompt, images=image, return_tensors="pt")

        if self.device:
            inputs = {k: v.to(self.device) for k, v in inputs.items()}

        profile_key = (profile or self.perf_profile or "balanced").lower()
        if profile_key == "fast":
            max_tokens = self.fast_max_new_tokens
            num_beams = self.fast_num_beams
            early_stopping = False
        else:
            max_tokens = self.max_new_tokens
            num_beams = 3
            early_stopping = True

        use_amp_cuda = bool(
            self.device == "cuda"
            and torch.cuda.is_available()
            and bool(getattr(self, "enable_amp", True))
        )
        with torch.no_grad():
            with gpu_inference_guard("generate", "florence"):
                with torch.autocast(
                    device_type="cuda",
                    dtype=torch.float16,
                    enabled=use_amp_cuda,
                ):
                    generated_ids = self._model.generate(
                        **inputs,
                        max_new_tokens=max_tokens,
                        num_beams=num_beams,
                        early_stopping=early_stopping,
                        do_sample=False,
                    )

        generated_text = self._processor.batch_decode(generated_ids, skip_special_tokens=False)[0]

        # Try Florence's post-process helper. If it fails, return raw text.
        try:
            out = self._processor.post_process_generation(
                generated_text,
                task=task,
                image_size=(image.width, image.height),
            )
            if isinstance(out, dict):
                out["_raw_text"] = generated_text
                out["_task"] = task
                return out
            return {"_raw_text": generated_text, "_task": task, "result": out}
        except Exception:
            logger.debug("Florence task post-processing failed for %s", task, exc_info=True)
            return {"_raw_text": generated_text, "_task": task}

    # ----------------------------
    # Public API
    # ----------------------------
    def detect_objects(self, image: Image.Image) -> List[Detection]:
        """
        Runs Florence-2 Object Detection (<OD>) and maps results to allowed labels.
        NOTE: Not used in PP1 (UnifiedPipeline), which uses YOLOv8m.
        """
        try:
            # Run <OD> task
            out = self._run_task(image, "<OD>")
            
            # Parse result. Florence <OD> returns:
            # {'<OD>': {'bboxes': [[x1, y1, x2, y2], ...], 'labels': ['label1', ...], 'polygons': ...}}
            # or sometimes just the dict directly if post-processing worked.
            
            data = out.get("<OD>") or out.get("OD")
            if not data or not isinstance(data, dict):
                # Fallback check if it's in 'result' key
                data = out.get("result", {}).get("<OD>")
                
            if not data:
                return []

            bboxes = data.get("bboxes", [])
            labels = data.get("labels", [])
            
            detections: List[Detection] = []
            
            for box, label_raw in zip(bboxes, labels):
                # Florence labels are often lower case or slightly different.
                canonical = canonicalize_label(label_raw)
                if not canonical:
                    continue
                
                # Florence bboxes are [x1, y1, x2, y2]
                x1, y1, x2, y2 = [int(c) for c in box]
                
                # Florence doesn't give confidence scores for OD in the standard output,
                # so we assign a conservative default since Florence OD has no built-in
                # confidence. This avoids artificially inflating downstream decisions.
                conf = float(getattr(settings, "FLORENCE_OD_DEFAULT_CONF", 0.5))
                
                detections.append(Detection(
                    label=canonical,
                    confidence=conf,
                    bbox=(x1, y1, x2, y2)
                ))
                
            return detections
            
        except Exception as e:
            logger.warning("Florence detection error: %s", e, exc_info=True)
            return []

    def detect_and_describe(self, image: Image.Image) -> List[FlorenceDetection]:
        """
        Full-image Florence OD fallback: run <OD> on the entire image, then
        for each canonical detection crop the region and extract a detailed
        caption + OCR.  Returns enriched FlorenceDetection list.
        """
        base_detections = self.detect_objects(image)
        if not base_detections:
            return []

        max_dets = int(getattr(settings, "FLORENCE_OD_FALLBACK_MAX_DETECTIONS", 5))
        base_detections = base_detections[:max_dets]

        enriched: List[FlorenceDetection] = []
        w, h = image.size

        for det in base_detections:
            x1, y1, x2, y2 = det.bbox
            x1 = max(0, min(w, x1))
            y1 = max(0, min(h, y1))
            x2 = max(0, min(w, x2))
            y2 = max(0, min(h, y2))
            if x2 <= x1 or y2 <= y1:
                continue

            crop = image.crop((x1, y1, x2, y2))
            crop_caption = self.caption(crop, detailed=True)
            crop_ocr = self.ocr(crop)

            enriched.append(FlorenceDetection(
                label=det.label,
                confidence=det.confidence,
                bbox=(x1, y1, x2, y2),
                caption=crop_caption,
                ocr_text=crop_ocr,
            ))

        return enriched

    def caption(self, image: Image.Image, detailed: bool = True, profile: Optional[str] = None) -> str:
        # Try multiple levels of detail if requested
        tasks = ["<MORE_DETAILED_CAPTION>", "<DETAILED_CAPTION>", "<CAPTION>"] if detailed else ["<CAPTION>"]
        
        for task in tasks:
            try:
                out = self._run_task(image, task, profile=profile)
                # Check standard keys
                for k in (task, "caption", "CAPTION", "DETAILED_CAPTION", "MORE_DETAILED_CAPTION"):
                    if k in out and isinstance(out[k], str) and out[k].strip():
                        return out[k].strip()
                
                # Fallback: raw text
                raw = out.get("_raw_text", "")
                s = _safe_str(raw).strip()
                if s:
                    return s
            except Exception:
                logger.debug("Caption parse fallback failed", exc_info=True)
                continue
                
        return ""

    def vqa(self, image: Image.Image, question: str, profile: Optional[str] = None) -> str:
        """
        VQA task. Returns a plain short answer string.
        """
        try:
            out = self._run_task(image, "<VQA>", question, profile=profile)
            # Different Florence revs return different keys.
            # Try common patterns.
            for k in ("answer", "vqa", "VQA", "<VQA>"):
                val = out.get(k)
                if isinstance(val, str) and val.strip():
                    return val.strip()
                if isinstance(val, list) and val:
                    # sometimes list of answers
                    s = _safe_str(val[0]).strip()
                    if s:
                        return s
            # last resort: parse raw text (often contains "Answer:" or similar)
            raw = _safe_str(out.get("_raw_text", ""))
            m = re.search(r"(?i)answer\s*:\s*([^\n<]+)", raw)
            if m:
                return m.group(1).strip()
            return raw.strip()
        except Exception:
            logger.debug("VQA extraction failed", exc_info=True)
            return ""

    def _extract_ocr_region_tokens(self, payload: Any) -> List[OCRToken]:
        tokens: List[OCRToken] = []

        def _append_token(text_value: Any, bbox_value: Any) -> None:
            text = _normalize_ocr_text(text_value)
            bbox = _coerce_bbox(bbox_value)
            if not text or bbox is None:
                return
            tokens.append(OCRToken(text=text, bbox=bbox))

        def _walk(value: Any) -> None:
            if isinstance(value, dict):
                token_items = value.get("tokens")
                if isinstance(token_items, list):
                    for item in token_items:
                        if isinstance(item, dict):
                            _append_token(
                                item.get("text") or item.get("label") or item.get("value"),
                                item.get("bbox")
                                or item.get("box")
                                or item.get("quad_box")
                                or item.get("quad_boxes")
                                or item.get("polygon")
                                or item.get("polygons"),
                            )

                labels = value.get("labels") or value.get("texts") or value.get("text")
                boxes = (
                    value.get("quad_boxes")
                    or value.get("bboxes")
                    or value.get("boxes")
                    or value.get("polygons")
                )
                if isinstance(labels, list) and isinstance(boxes, list) and len(labels) == len(boxes):
                    for label, box in zip(labels, boxes):
                        _append_token(label, box)

                regions = value.get("regions")
                if isinstance(regions, list):
                    for item in regions:
                        if isinstance(item, dict):
                            _append_token(
                                item.get("text") or item.get("label") or item.get("value"),
                                item.get("bbox")
                                or item.get("box")
                                or item.get("quad_box")
                                or item.get("quad_boxes")
                                or item.get("polygon")
                                or item.get("polygons"),
                            )

                for nested in value.values():
                    if isinstance(nested, (dict, list)):
                        _walk(nested)

            elif isinstance(value, list):
                for item in value:
                    _walk(item)

        _walk(payload)

        deduped: List[OCRToken] = []
        seen = set()
        for token in tokens:
            key = (
                token.text.lower(),
                round(token.bbox[0], 1),
                round(token.bbox[1], 1),
                round(token.bbox[2], 1),
                round(token.bbox[3], 1),
            )
            if key in seen:
                continue
            seen.add(key)
            deduped.append(token)

        return deduped

    def _parse_plain_ocr_output(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        plain_lines: List[str] = []

        for key in ("text", "ocr", "<OCR>"):
            value = payload.get(key)
            if isinstance(value, str):
                plain_lines = [line.strip() for line in value.splitlines() if line.strip()]
                if plain_lines:
                    break
            if isinstance(value, list):
                plain_lines = [_normalize_ocr_text(item) for item in value]
                plain_lines = [line for line in plain_lines if line]
                if plain_lines:
                    break

        if not plain_lines:
            tokens = payload.get("tokens")
            if isinstance(tokens, list):
                plain_lines = [
                    _normalize_ocr_text(item.get("text") if isinstance(item, dict) else item)
                    for item in tokens
                ]
                plain_lines = [line for line in plain_lines if line]

        if not plain_lines:
            raw_text = _normalize_ocr_text(payload.get("_raw_text", ""))
            if raw_text:
                plain_lines = [raw_text]

        fallback_tokens = [
            OCRToken(text=line, bbox=(0.0, float(idx) * 24.0, max(120.0, float(len(line) * 8.0)), float(idx) * 24.0 + 20.0))
            for idx, line in enumerate(plain_lines)
            if line
        ]
        return _build_ocr_layout(fallback_tokens, source="ocr_text_fallback")

    def ocr_structured(self, image: Image.Image, profile: Optional[str] = None) -> Dict[str, Any]:
        """
        OCR task with additive layout-aware output using Florence OCR.

        Returns:
          {
            "ocr_text": str,
            "ocr_text_display": str,
            "ocr_lines": list[dict],
            "ocr_layout_source": str,
            "ocr_tokens": list[dict],
          }
        """
        # --- Florence OCR --------------------------
        try:
            region_out = self._run_task(image, "<OCR_WITH_REGION>", profile=profile)
            region_tokens = self._extract_ocr_region_tokens(region_out)
            if region_tokens:
                return _build_ocr_layout(region_tokens, source="ocr_with_region")
        except Exception:
            logger.debug("OCR_WITH_REGION extraction failed", exc_info=True)

        try:
            plain_out = self._run_task(image, "<OCR>", profile=profile)
            return self._parse_plain_ocr_output(plain_out)
        except Exception:
            logger.debug("OCR extraction failed", exc_info=True)
            return {
                "ocr_text": "",
                "ocr_text_display": "",
                "ocr_lines": [],
                "ocr_layout_source": "ocr_text_fallback",
                "ocr_tokens": [],
            }

    def ocr(self, image: Image.Image, profile: Optional[str] = None) -> str:
        """
        OCR task. Returns plain concatenated text. If OCR task unsupported, returns "".
        """
        return str(self.ocr_structured(image, profile=profile).get("ocr_text", "") or "").strip()

    def ground_phrases(self, image: Image.Image, text: str, profile: Optional[str] = None) -> Dict[str, Any]:
        """
        Runs Phrase Grounding task (<CAPTION_TO_PHRASE_GROUNDING>).
        'text' should be a comma-separated list of phrases or a sentence.
        """
        # Florence-2 expects the task token and the text input
        return self._run_task(image, "<CAPTION_TO_PHRASE_GROUNDING>", text, profile=profile)

    @staticmethod
    def _resize_for_lite(image: Image.Image, max_side: int = 512) -> Image.Image:
        return FlorenceService._resize_with_max_side(image, max_side=max_side)

    @staticmethod
    def _resize_with_max_side(image: Image.Image, max_side: int) -> Image.Image:
        if not isinstance(image, Image.Image):
            return image
        w, h = image.size
        if w <= 0 or h <= 0:
            return image
        longest = max(w, h)
        if longest <= max_side:
            return image

        scale = float(max_side) / float(longest)
        new_w = max(1, int(round(w * scale)))
        new_h = max(1, int(round(h * scale)))
        return image.resize((new_w, new_h), Image.BILINEAR)

    @staticmethod
    def _run_with_timeout(fn, timeout_ms: int, *args, **kwargs):
        timeout_sec = max(1, int(timeout_ms)) / 1000.0
        last_exc = None
        for attempt in range(2):  # 1 initial + 1 retry
            with ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(fn, *args, **kwargs)
                try:
                    return future.result(timeout=timeout_sec)
                except FuturesTimeoutError as exc:
                    last_exc = exc
                    if attempt == 0:
                        logger.warning("Florence timeout (%dms), retrying once...", timeout_ms)
                        continue
        raise TimeoutError(f"Operation exceeded timeout of {timeout_ms} ms after retry") from last_exc

    def _run_ocr_recovery_once(
        self,
        image: Image.Image,
        profile_key: str,
        timeout_ms: int,
        max_side: int,
    ) -> Tuple[str, Dict[str, Any]]:
        """
        Single OCR-only recovery attempt on a downscaled image.
        """
        start = time.perf_counter()
        resized = self._resize_for_lite(image, max_side=max_side)
        source = f"ocr_recovery_{int(max_side)}"
        try:
            recovered = self._run_with_timeout(
                self.ocr,
                timeout_ms,
                resized,
                profile_key,
            )
            text = str(recovered or "").strip()
            return text, {
                "source": source,
                "status": "success",
                "reason": "ok_nonempty" if text else "ok_empty_ocr",
                "elapsed_ms": round((time.perf_counter() - start) * 1000.0, 2),
                "recovered_nonempty": bool(text),
                "max_side": int(max_side),
                "input_wh": (int(image.width), int(image.height)),
                "resized_wh": (int(resized.width), int(resized.height)),
            }
        except TimeoutError:
            return "", {
                "source": source,
                "status": "timeout",
                "reason": "timeout",
                "elapsed_ms": round((time.perf_counter() - start) * 1000.0, 2),
                "recovered_nonempty": False,
                "max_side": int(max_side),
                "input_wh": (int(image.width), int(image.height)),
                "resized_wh": (int(resized.width), int(resized.height)),
            }
        except Exception as exc:
            return "", {
                "source": source,
                "status": "error",
                "reason": "exception",
                "message": str(exc),
                "elapsed_ms": round((time.perf_counter() - start) * 1000.0, 2),
                "recovered_nonempty": False,
                "max_side": int(max_side),
                "input_wh": (int(image.width), int(image.height)),
                "resized_wh": (int(resized.width), int(resized.height)),
            }

    @staticmethod
    def _encode_lite_image(image: Image.Image, jpeg_quality: int) -> bytes:
        safe_quality = max(35, min(95, int(jpeg_quality)))
        buf = io.BytesIO()
        image.convert("RGB").save(buf, format="JPEG", quality=safe_quality, optimize=True)
        return buf.getvalue()

    def _run_lite_via_worker_with_timeout(
        self,
        crop: Image.Image,
        profile_key: str,
        timeout_ms: int,
        jpeg_quality: int,
    ) -> Dict[str, Any]:
        if not hasattr(self, "_lite_worker_lock"):
            return self._run_with_timeout(
                self._analyze_crop_lite_core,
                timeout_ms,
                crop,
                profile_key,
            )

        timeout_sec = max(1, int(timeout_ms)) / 1000.0
        payload = self._encode_lite_image(crop, jpeg_quality=jpeg_quality)

        with self._lite_worker_lock:
            self._start_lite_worker_locked()
            req_q = self._lite_req_q
            resp_q = self._lite_resp_q
            if req_q is None or resp_q is None:
                raise RuntimeError("Florence-lite worker queues are unavailable.")

            req_id = self._next_lite_req_id_locked()
            message = {
                "cmd": "infer",
                "req_id": req_id,
                "profile_key": profile_key,
                "image_bytes": payload,
            }
            req_q.put(message, timeout=0.5)

            try:
                response = resp_q.get(timeout=timeout_sec)
            except queue.Empty as exc:
                self._stop_lite_worker_locked()
                raise TimeoutError(
                    f"Florence-lite hard timeout after {timeout_ms} ms."
                ) from exc
            except Exception as exc:
                self._stop_lite_worker_locked()
                raise RuntimeError("Failed while waiting for Florence-lite worker response.") from exc

            if not isinstance(response, dict) or int(response.get("req_id", -1)) != req_id:
                self._stop_lite_worker_locked()
                raise RuntimeError("Received mismatched Florence-lite worker response.")

            if not bool(response.get("ok", False)):
                raise RuntimeError(str(response.get("error", "Lite worker error")))

            result = response.get("result", {})
            if not isinstance(result, dict):
                raise RuntimeError("Florence-lite worker returned invalid payload.")
            return result

    @staticmethod
    def _is_lite_nonempty(caption_text: str, ocr_text: str) -> bool:
        return bool(str(caption_text or "").strip()) or bool(str(ocr_text or "").strip())

    @staticmethod
    def _lite_reason(caption_text: str, ocr_text: str) -> str:
        has_caption = bool(str(caption_text or "").strip())
        has_ocr = bool(str(ocr_text or "").strip())
        if has_caption and has_ocr:
            return "ok_nonempty"
        if not has_caption and not has_ocr:
            return "ok_empty_both"
        if not has_caption:
            return "ok_empty_caption"
        return "ok_empty_ocr"

    def _analyze_crop_lite_core(self, crop: Image.Image, profile_key: str) -> Dict[str, Any]:
        lite_prompt = (
            "Return only what you can see about the main object. "
            "Use one short factual sentence. If unsure, return empty."
        )
        guided_caption = self.vqa(crop, lite_prompt, profile=profile_key).strip()
        sanitized_guided, _ = _sanitize_caption(guided_caption)

        fallback_caption = ""
        if not sanitized_guided:
            fallback_caption_raw = self.caption(crop, detailed=False, profile=profile_key)
            sanitized_fallback, _ = _sanitize_caption(fallback_caption_raw)
            fallback_caption = sanitized_fallback.strip()

        caption_candidate = sanitized_guided.strip() or fallback_caption
        if caption_candidate:
            first_sentence = re.split(r"(?<=[.!?])\s+", caption_candidate.strip())[0].strip()
            final_caption = first_sentence
        else:
            final_caption = ""

        ocr_payload = self.ocr_structured(crop, profile=profile_key)
        ocr_text = str(ocr_payload.get("ocr_text", "") or "").strip()
        ocr_text_display = str(ocr_payload.get("ocr_text_display", "") or "").strip()
        ocr_lines = list(ocr_payload.get("ocr_lines", []) or [])
        ocr_layout_source = str(ocr_payload.get("ocr_layout_source", "ocr_text_fallback") or "ocr_text_fallback")
        color_q = (
            "What is the primary color of the main foreground object? "
            "Ignore the background, hands, and any surface the object rests on. "
            "Answer with a short color phrase (e.g. 'black', 'navy blue'). If unsure, answer 'unknown'."
        )
        color_vqa = self.vqa(crop, color_q, profile=profile_key).strip() or None
        if color_vqa and color_vqa.lower() == "unknown":
            color_vqa = None

        # Normalize VQA color; use caption only as a fallback when VQA yielded nothing
        if color_vqa:
            color_vqa = normalize_color(color_vqa) or color_vqa
        caption_color = extract_color_from_text(final_caption) if final_caption else None
        if caption_color and not color_vqa:
            color_vqa = caption_color

        reason = self._lite_reason(final_caption, ocr_text)
        lite_nonempty = self._is_lite_nonempty(final_caption, ocr_text)
        caption_len = len(str(final_caption or "").strip())
        ocr_len = len(str(ocr_text or "").strip())

        return {
            "caption": final_caption,
            "final_description": final_caption,
            "detailed_description": final_caption,
            "description_source": "florence_lite",
            "detailed_description_source": "florence_lite",
            "description_evidence_used": {"summary": ["florence_caption"], "detailed": ["florence_caption"]},
            "description_filters_applied": ["florence_lite"],
            "description_word_count": {"final_description": len(final_caption.split()), "detailed_description": len(final_caption.split())},
            "ocr_text": ocr_text,
            "ocr_text_display": ocr_text_display,
            "ocr_lines": ocr_lines,
            "ocr_layout_source": ocr_layout_source,
            "color_vqa": color_vqa,
            "grounded_features": [],
            "grounded_defects": [],
            "grounded_attachments": [],
            "key_count": None,
            "raw": {
                "caption_source": "lite_caption",
                "ocr_layout": {
                    "source": ocr_layout_source,
                    "lines": ocr_lines,
                    "tokens": ocr_payload.get("ocr_tokens", []),
                },
                "guided_caption": guided_caption,
                "lite_prompt": lite_prompt,
                "lite": {
                    "status": "success",
                    "reason": reason,
                    "lite_nonempty": bool(lite_nonempty),
                    "caption_len": caption_len,
                    "ocr_len": ocr_len,
                },
            },
        }

    @staticmethod
    def _ocr_first_reason(caption_text: Any, ocr_text: Any) -> str:
        has_caption = bool(str(caption_text or "").strip())
        has_ocr = bool(str(ocr_text or "").strip())
        if has_caption and has_ocr:
            return "ok_nonempty"
        if not has_caption and not has_ocr:
            return "ok_empty_both"
        if not has_caption:
            return "ok_empty_caption"
        return "ok_empty_ocr"

    def analyze_ocr_first(
        self,
        image_or_crop: Image.Image,
        *,
        canonical_label: Optional[str] = None,
        fast: bool = True,
    ) -> Dict[str, Any]:
        """
        OCR-first extraction path for PP2.

        Behavior:
          1) OCR first (timeout-bounded).
          2) Run detailed caption only when OCR is empty, label is unknown, or fast=False.
          3) Optional color and grounding only in non-fast mode.
        """
        start = time.perf_counter()
        profile_key = (self.perf_profile or "balanced").lower()
        timeout_ms = int(getattr(settings, "FLORENCE_TIMEOUT_MS", 30000))
        ocr_timeout_ms = int(getattr(settings, "FLORENCE_OCR_TIMEOUT_MS", 15000))
        recovery_max_side = int(getattr(settings, "FLORENCE_OCR_RECOVERY_MAX_SIDE", 384))
        ocr_max_side = int(getattr(settings, "FLORENCE_OCR_MAX_SIDE", getattr(self, "ocr_max_side", 512)))
        caption_max_side = int(getattr(settings, "FLORENCE_CAPTION_MAX_SIDE", getattr(self, "caption_max_side", 640)))
        ocr_image = self._resize_with_max_side(image_or_crop, max_side=ocr_max_side)
        detail_image = self._resize_with_max_side(image_or_crop, max_side=caption_max_side)

        def _img_wh(img: Any) -> Optional[Tuple[int, int]]:
            if isinstance(img, Image.Image):
                return (int(img.width), int(img.height))
            return None

        caption_text = ""
        ocr_text = ""
        ocr_text_display = ""
        ocr_lines: List[Dict[str, Any]] = []
        ocr_layout_source = "ocr_text_fallback"
        color_vqa: Optional[str] = None
        grounded_features: List[str] = []
        grounded_defects: List[str] = []
        grounded_attachments: List[str] = []
        key_count: Optional[int] = None

        timings: Dict[str, Any] = {}
        raw: Dict[str, Any] = {
            "caption_source": "ocr_first",
            "timings": timings,
            "ocr_first": {
                "status": "success",
                "fast": bool(fast),
                "ran_caption": False,
                "ran_color_vqa": False,
                "ran_grounding": False,
                "needs_detail": False,
                "detail_trigger": [],
                "ocr_input_wh": _img_wh(image_or_crop),
                "ocr_resized_wh": _img_wh(ocr_image),
                "detail_input_wh": _img_wh(image_or_crop),
                "detail_resized_wh": _img_wh(detail_image),
                "timeout_ms_used": {
                    "ocr_ms": int(ocr_timeout_ms),
                    "full_ms": int(timeout_ms),
                },
            },
            "florence": {
                "status": "success",
                "reason": "ok",
                "stage": "all",
                "attempts": [],
                "timeout_ms_used": {
                    "ocr_ms": int(ocr_timeout_ms),
                    "full_ms": int(timeout_ms),
                },
                "recovery_attempted": False,
                "recovery_succeeded": False,
            },
        }

        def _record_attempt(source: str, status: str, reason: str, elapsed_ms: float, **extra: Any) -> None:
            florence_meta = raw.get("florence", {})
            if not isinstance(florence_meta, dict):
                florence_meta = {}
            attempts = florence_meta.get("attempts", [])
            if not isinstance(attempts, list):
                attempts = []
            attempt_entry: Dict[str, Any] = {
                "source": str(source),
                "status": str(status),
                "reason": str(reason),
                "elapsed_ms": round(float(elapsed_ms), 2),
            }
            for key, value in extra.items():
                attempt_entry[key] = value
            attempts.append(attempt_entry)
            florence_meta["attempts"] = attempts
            raw["florence"] = florence_meta

        def _try_timeout_recovery(stage_name: str) -> bool:
            nonlocal ocr_text, ocr_text_display, ocr_lines, ocr_layout_source
            florence_meta = raw.get("florence", {})
            if not isinstance(florence_meta, dict):
                florence_meta = {}
            florence_meta["recovery_attempted"] = True
            raw["florence"] = florence_meta

            recovered_text, recovery_meta = self._run_ocr_recovery_once(
                image_or_crop,
                profile_key=profile_key,
                timeout_ms=ocr_timeout_ms,
                max_side=recovery_max_side,
            )
            timings["ocr_recovery_ms"] = float(recovery_meta.get("elapsed_ms", 0.0) or 0.0)
            _record_attempt(
                source=str(recovery_meta.get("source", f"ocr_recovery_{recovery_max_side}")),
                status=str(recovery_meta.get("status", "error")),
                reason=str(recovery_meta.get("reason", "exception")),
                elapsed_ms=float(recovery_meta.get("elapsed_ms", 0.0) or 0.0),
                max_side=int(recovery_meta.get("max_side", recovery_max_side)),
                recovered_nonempty=bool(recovery_meta.get("recovered_nonempty", False)),
            )

            florence_meta = raw.get("florence", {})
            if not isinstance(florence_meta, dict):
                florence_meta = {}

            if recovered_text:
                if not ocr_text:
                    ocr_text = recovered_text
                    recovered_layout = _build_ocr_layout(
                        [
                            OCRToken(
                                text=recovered_text,
                                bbox=(0.0, 0.0, max(120.0, float(len(recovered_text) * 8.0)), 24.0),
                            )
                        ],
                        source="ocr_recovery",
                    )
                    ocr_text_display = str(recovered_layout.get("ocr_text_display", "") or "").strip()
                    ocr_lines = list(recovered_layout.get("ocr_lines", []) or [])
                    ocr_layout_source = "ocr_recovery"
                    raw["ocr_layout"] = {
                        "source": "ocr_recovery",
                        "lines": ocr_lines,
                        "tokens": recovered_layout.get("ocr_tokens", []),
                    }
                florence_meta["recovery_succeeded"] = True
                florence_meta["status"] = "degraded"
                florence_meta["reason"] = "timeout_recovered_ocr_only"
                florence_meta["stage"] = stage_name
                raw["florence"] = florence_meta
                raw["ocr_first"]["status"] = "degraded"
                raw["ocr_first"]["reason"] = "timeout_recovered_ocr_only"
                return True

            florence_meta["recovery_succeeded"] = False
            florence_meta["status"] = "failed"
            florence_meta["reason"] = "timeout"
            florence_meta["stage"] = stage_name
            raw["florence"] = florence_meta
            raw["ocr_first"]["status"] = "failed"
            raw["ocr_first"]["reason"] = "timeout"
            return False

        def _safe_payload() -> Dict[str, Any]:
            timings["total_ms"] = round((time.perf_counter() - start) * 1000.0, 2)
            meta = raw.get("ocr_first", {})
            if isinstance(meta, dict):
                meta["caption_len"] = int(len(str(caption_text or "").strip()))
                meta["ocr_len"] = int(len(str(ocr_text or "").strip()))
                meta["reason"] = str(meta.get("reason", self._ocr_first_reason(caption_text, ocr_text)))
                raw["ocr_first"] = meta
            florence_meta = raw.get("florence", {})
            if isinstance(florence_meta, dict):
                florence_meta["caption_len"] = int(len(str(caption_text or "").strip()))
                florence_meta["ocr_len"] = int(len(str(ocr_text or "").strip()))
                if not florence_meta.get("reason"):
                    florence_meta["reason"] = "ok"
                if not florence_meta.get("status"):
                    florence_meta["status"] = "success"
                if not florence_meta.get("stage"):
                    florence_meta["stage"] = "all"
                raw["florence"] = florence_meta
            return {
                "caption": caption_text,
                "ocr_text": ocr_text,
                "ocr_text_display": ocr_text_display,
                "ocr_lines": ocr_lines,
                "ocr_layout_source": ocr_layout_source,
                "color_vqa": color_vqa,
                "grounded_features": grounded_features,
                "grounded_defects": grounded_defects,
                "grounded_attachments": grounded_attachments,
                "key_count": key_count,
                "raw": raw,
            }

        # Step 1: OCR first (hard requirement for stage order).
        ocr_start = time.perf_counter()
        try:
            ocr_payload = self._run_with_timeout(
                self.ocr_structured,
                ocr_timeout_ms,
                ocr_image,
                profile_key,
            )
            ocr_text = str(ocr_payload.get("ocr_text", "") or "").strip()
            ocr_text_display = str(ocr_payload.get("ocr_text_display", "") or "").strip()
            ocr_lines = list(ocr_payload.get("ocr_lines", []) or [])
            ocr_layout_source = str(ocr_payload.get("ocr_layout_source", "ocr_text_fallback") or "ocr_text_fallback")
            raw["ocr_layout"] = {
                "source": ocr_layout_source,
                "lines": ocr_lines,
                "tokens": ocr_payload.get("ocr_tokens", []),
            }
            _record_attempt("primary_ocr", "success", "ok_nonempty" if ocr_text else "ok_empty_ocr", (time.perf_counter() - ocr_start) * 1000.0)
        except TimeoutError as exc:
            raw["error"] = {"type": "timeout", "stage": "ocr", "message": str(exc)}
            _record_attempt("primary_ocr", "timeout", "timeout", (time.perf_counter() - ocr_start) * 1000.0)
            raw["ocr_first"]["status"] = "timeout"
            raw["ocr_first"]["reason"] = "ocr_timeout"
            raw["florence"]["status"] = "failed"
            raw["florence"]["reason"] = "timeout"
            raw["florence"]["stage"] = "ocr"
            _try_timeout_recovery("ocr")
            return _safe_payload()
        except Exception as exc:
            raw["error"] = {"type": "error", "stage": "ocr", "message": str(exc)}
            raw["ocr_first"]["status"] = "error"
            raw["ocr_first"]["reason"] = "ocr_exception"
            _record_attempt("primary_ocr", "error", "exception", (time.perf_counter() - ocr_start) * 1000.0)
            raw["florence"]["status"] = "failed"
            raw["florence"]["reason"] = "exception"
            raw["florence"]["stage"] = "ocr"
            return _safe_payload()
        timings["ocr_ms"] = round((time.perf_counter() - ocr_start) * 1000.0, 2)

        needs_detail_reasons: List[str] = []
        if not ocr_text:
            needs_detail_reasons.append("ocr_empty")
        if canonical_label is None:
            needs_detail_reasons.append("canonical_label_missing")
        if not fast:
            needs_detail_reasons.append("fast_false")

        needs_detail = bool(needs_detail_reasons)
        raw["ocr_first"]["needs_detail"] = needs_detail
        raw["ocr_first"]["detail_trigger"] = list(needs_detail_reasons)

        # Step 2: Optional detailed caption.
        if needs_detail:
            raw["ocr_first"]["ran_caption"] = True
            caption_start = time.perf_counter()
            try:
                caption_raw = self._run_with_timeout(
                    self.caption,
                    timeout_ms,
                    detail_image,
                    True,
                    profile_key,
                )
                caption_clean, _ = _sanitize_caption(str(caption_raw or ""))
                caption_text = caption_clean.strip() or str(caption_raw or "").strip()
                _record_attempt(
                    "primary_caption",
                    "success",
                    "ok_nonempty" if caption_text else "ok_empty_caption",
                    (time.perf_counter() - caption_start) * 1000.0,
                )
            except TimeoutError as exc:
                raw["error"] = {"type": "timeout", "stage": "caption", "message": str(exc)}
                _record_attempt("primary_caption", "timeout", "timeout", (time.perf_counter() - caption_start) * 1000.0)
                raw["ocr_first"]["status"] = "timeout"
                raw["ocr_first"]["reason"] = "caption_timeout"
                raw["florence"]["status"] = "failed"
                raw["florence"]["reason"] = "timeout"
                raw["florence"]["stage"] = "caption"
                _try_timeout_recovery("caption")
                timings["caption_ms"] = round((time.perf_counter() - caption_start) * 1000.0, 2)
                return _safe_payload()
            except Exception as exc:
                raw["error"] = {"type": "error", "stage": "caption", "message": str(exc)}
                raw["ocr_first"]["status"] = "error"
                raw["ocr_first"]["reason"] = "caption_exception"
                _record_attempt("primary_caption", "error", "exception", (time.perf_counter() - caption_start) * 1000.0)
                raw["florence"]["status"] = "failed"
                raw["florence"]["reason"] = "exception"
                raw["florence"]["stage"] = "caption"
                timings["caption_ms"] = round((time.perf_counter() - caption_start) * 1000.0, 2)
                return _safe_payload()
            timings["caption_ms"] = round((time.perf_counter() - caption_start) * 1000.0, 2)

            # Step 2b: Guided VQA for richer object-only descriptions (same
            # prompt used in analyze_crop full-mode).  This produces multi-
            # sentence descriptions whereas caption() alone is brief.
            if profile_key != "fast":
                guided_start = time.perf_counter()
                try:
                    guide_prompt = (
                        "Describe ONLY the main object in this image in 3–5 detailed sentences. "
                        "Focus on physical characteristics you can directly observe: "
                        "object type, material and texture (e.g. leather, fabric, metal, plastic), "
                        "primary color and shade, exact shape and size, "
                        "any brand names/logos/printed text (spell them out exactly as written), "
                        "stitching style, closure mechanism (zipper, button, snap, clasp), "
                        "compartments/pockets, surface condition, "
                        "any attachments or accessories (only separate add-ons like a metal ring, lanyard, tag, or remote fob — if clearly visible), "
                        "and any visible wear or defects (scratches, dents, cracks, stains, rust, bends, fading, peeling, tears). "
                        "IMPORTANT: Describe only what is physically visible. Do NOT mention the person, hand, background, or any surface. "
                        "Do NOT include meta-commentary about the task or about reading text. "
                        "Do NOT say 'this image shows' or 'I can see'. Just describe the object directly."
                    )
                    guided_raw = self._run_with_timeout(
                        self.vqa,
                        timeout_ms,
                        detail_image,
                        guide_prompt,
                        profile_key,
                    )
                    guided_clean, _ = _sanitize_caption(str(guided_raw or ""))
                    _record_attempt(
                        "guided_vqa",
                        "success",
                        "ok_nonempty" if guided_clean.strip() else "ok_empty_guided",
                        (time.perf_counter() - guided_start) * 1000.0,
                    )
                    # Prefer guided if substantial (>= 5 words), else keep caption
                    if len(guided_clean.split()) >= 5:
                        caption_text = guided_clean.strip()
                        raw["ocr_first"]["caption_source"] = "guided_vqa"
                    else:
                        raw["ocr_first"]["caption_source"] = "detailed_caption"
                    raw["ocr_first"]["guided_vqa_len"] = len(guided_clean.strip())
                except TimeoutError:
                    _record_attempt("guided_vqa", "timeout", "timeout", (time.perf_counter() - guided_start) * 1000.0)
                    raw["ocr_first"]["caption_source"] = "detailed_caption"
                except Exception:
                    _record_attempt("guided_vqa", "error", "exception", (time.perf_counter() - guided_start) * 1000.0)
                    raw["ocr_first"]["caption_source"] = "detailed_caption"
                timings["guided_vqa_ms"] = round((time.perf_counter() - guided_start) * 1000.0, 2)

        # Step 3: Optional enrichments for non-fast pass only.
        if not fast:
            color_start = time.perf_counter()
            raw["ocr_first"]["ran_color_vqa"] = True
            color_q = (
                "What is the primary color of the OBJECT (not the background)? "
                "Answer with a short phrase including shade/tone if visible. If unsure, answer 'unknown'."
            )
            try:
                color_ans = self._run_with_timeout(
                    self.vqa,
                    timeout_ms,
                    detail_image,
                    color_q,
                    profile_key,
                )
                color_vqa = str(color_ans or "").strip() or None
                if isinstance(color_vqa, str) and color_vqa.lower() == "unknown":
                    color_vqa = None
                # Normalize VQA color; use caption only as a fallback when VQA yielded nothing
                if color_vqa:
                    color_vqa = normalize_color(color_vqa) or color_vqa
                caption_color_ocr_first = extract_color_from_text(caption_text) if caption_text else None
                if caption_color_ocr_first and not color_vqa:
                    color_vqa = caption_color_ocr_first
            except TimeoutError as exc:
                raw["color_error"] = {"type": "timeout", "message": str(exc)}
            except Exception as exc:
                raw["color_error"] = {"type": "error", "message": str(exc)}
            timings["color_ms"] = round((time.perf_counter() - color_start) * 1000.0, 2)

            spec_key = canonicalize_label(canonical_label) if canonical_label else None
            if spec_key and spec_key in CATEGORY_SPECS:
                raw["ocr_first"]["ran_grounding"] = True
                grounding_start = time.perf_counter()
                raw_grounding_labels: List[str] = []

                def _run_grounding_candidates(candidates: List[str]) -> List[str]:
                    normalized = _normalize_grounding_candidates(candidates)
                    if not normalized:
                        return []

                    found_items = set()
                    for chunk in _chunk_list(normalized, chunk_size=25):
                        prompt_text = ", ".join(chunk)
                        g_out = self._run_with_timeout(
                            self.ground_phrases,
                            timeout_ms,
                            detail_image,
                            prompt_text,
                            profile_key,
                        )
                        g_data = (
                            g_out.get("<CAPTION_TO_PHRASE_GROUNDING>")
                            or g_out.get("result", {}).get("<CAPTION_TO_PHRASE_GROUNDING>")
                        )
                        if g_data and "labels" in g_data:
                            detected_labels = [str(l).strip().lower() for l in g_data["labels"]]
                            raw_grounding_labels.extend(g_data["labels"])
                            for cand in chunk:
                                if cand.lower() in detected_labels:
                                    found_items.add(cand)
                    return list(found_items)

                try:
                    specs = CATEGORY_SPECS[spec_key]
                    grounded_features = _run_grounding_candidates(specs.get("features", []))
                    grounded_defects = _run_grounding_candidates(specs.get("defects", []))
                    raw["grounding_raw"] = {"labels": raw_grounding_labels}
                except TimeoutError as exc:
                    raw["grounding_error"] = {"type": "timeout", "message": str(exc)}
                except Exception as exc:
                    raw["grounding_error"] = {"type": "error", "message": str(exc)}
                timings["grounding_ms"] = round((time.perf_counter() - grounding_start) * 1000.0, 2)

            if canonical_label == "Key":
                key_count_start = time.perf_counter()
                try:
                    kc_q = "How many separate keys are visible in this image? Answer with a single integer."
                    kc_ans = self._run_with_timeout(
                        self.vqa,
                        timeout_ms,
                        detail_image,
                        kc_q,
                        profile_key,
                    )
                    m = re.search(r"\b(\d+)\b", str(kc_ans or ""))
                    if m:
                        key_count = int(m.group(1))
                except Exception:
                    logger.debug("Key count parse failed (lite)", exc_info=True)
                    key_count = None
                timings["key_count_ms"] = round((time.perf_counter() - key_count_start) * 1000.0, 2)

        raw["florence"]["status"] = str(raw.get("florence", {}).get("status", "success"))
        raw["florence"]["reason"] = str(raw.get("florence", {}).get("reason", "ok"))
        raw["florence"]["stage"] = str(raw.get("florence", {}).get("stage", "all"))
        return _safe_payload()

    def analyze_crop(
        self,
        crop: Image.Image,
        canonical_label: Optional[str] = None,
        profile: Optional[str] = None,
        mode: str = "full",
    ) -> Dict[str, Any]:
        """
        Evidence extraction on a crop.

        1. Caption (Detailed) AND Guided VQA (Object-only).
           - Select best sanitized caption.
        2. OCR
        3. Color VQA (Specific Prompt)
        4. Key Count VQA (if label == "Key")
        5. Phrase Grounding (Features, Defects, Attachments) - Split calls.
        6. Defects VQA (Extra evidence).
        """
        profile_key = (profile or self.perf_profile or "balanced").lower()
        mode_key = str(mode or "full").lower().strip()

        if mode_key == "lite":
            lite_start = time.perf_counter()
            timeout_ms = int(getattr(settings, "FLORENCE_TIMEOUT_MS", 30000))
            ocr_timeout_ms = int(getattr(settings, "FLORENCE_OCR_TIMEOUT_MS", 15000))
            recovery_max_side = int(getattr(settings, "FLORENCE_OCR_RECOVERY_MAX_SIDE", 384))
            max_side = int(getattr(settings, "FLORENCE_LITE_MAX_SIDE", 512))
            input_wh = (int(crop.width), int(crop.height)) if isinstance(crop, Image.Image) else None
            resized_crop = self._resize_for_lite(crop, max_side=max_side)
            resized_wh = (
                (int(resized_crop.width), int(resized_crop.height))
                if isinstance(resized_crop, Image.Image)
                else input_wh
            )
            try:
                lite_out = self._run_with_timeout(
                    self._analyze_crop_lite_core,
                    timeout_ms,
                    resized_crop,
                    profile_key,
                )
                if not isinstance(lite_out, dict):
                    raise RuntimeError("Lite output must be a dict")

                raw = lite_out.get("raw", {})
                if not isinstance(raw, dict):
                    raw = {}
                timings = raw.get("timings", {})
                if not isinstance(timings, dict):
                    timings = {}
                timings["lite_ms"] = round((time.perf_counter() - lite_start) * 1000.0, 2)
                raw["timings"] = timings
                raw.setdefault("caption_source", "lite_caption")
                lite_meta = raw.get("lite", {})
                if not isinstance(lite_meta, dict):
                    lite_meta = {}
                caption_val = str(lite_out.get("caption", ""))
                ocr_val = str(lite_out.get("ocr_text", ""))
                lite_nonempty = self._is_lite_nonempty(caption_val, ocr_val)
                lite_meta["status"] = str(lite_meta.get("status", "success"))
                lite_meta["reason"] = str(lite_meta.get("reason", self._lite_reason(caption_val, ocr_val)))
                lite_meta["lite_nonempty"] = bool(lite_nonempty)
                lite_meta["input_wh"] = input_wh
                lite_meta["resized_wh"] = resized_wh
                lite_meta["timeout_ms_used"] = int(timeout_ms)
                lite_meta["caption_len"] = int(len(caption_val.strip()))
                lite_meta["ocr_len"] = int(len(ocr_val.strip()))
                raw["lite"] = lite_meta
                raw["florence"] = {
                    "status": "success",
                    "reason": "ok",
                    "stage": "lite_core",
                    "attempts": [
                        {
                            "source": "primary_lite_core",
                            "status": "success",
                            "reason": str(lite_meta.get("reason", self._lite_reason(caption_val, ocr_val))),
                            "elapsed_ms": float(timings.get("lite_ms", 0.0) or 0.0),
                        }
                    ],
                    "timeout_ms_used": {
                        "ocr_ms": int(ocr_timeout_ms),
                        "full_ms": int(timeout_ms),
                    },
                    "recovery_attempted": False,
                    "recovery_succeeded": False,
                }
                lite_out["raw"] = raw
                return lite_out
            except TimeoutError as exc:
                primary_elapsed = round((time.perf_counter() - lite_start) * 1000.0, 2)
                recovered_ocr, recovery_meta = self._run_ocr_recovery_once(
                    resized_crop,
                    profile_key=profile_key,
                    timeout_ms=ocr_timeout_ms,
                    max_side=recovery_max_side,
                )
                attempts: List[Dict[str, Any]] = [
                    {
                        "source": "primary_lite_core",
                        "status": "timeout",
                        "reason": "timeout",
                        "elapsed_ms": float(primary_elapsed),
                    },
                    {
                        "source": str(recovery_meta.get("source", f"ocr_recovery_{recovery_max_side}")),
                        "status": str(recovery_meta.get("status", "error")),
                        "reason": str(recovery_meta.get("reason", "exception")),
                        "elapsed_ms": float(recovery_meta.get("elapsed_ms", 0.0) or 0.0),
                        "max_side": int(recovery_meta.get("max_side", recovery_max_side)),
                        "recovered_nonempty": bool(recovery_meta.get("recovered_nonempty", False)),
                    },
                ]
                recovered_nonempty = bool(str(recovered_ocr or "").strip())
                florence_status = "degraded" if recovered_nonempty else "failed"
                florence_reason = "timeout_recovered_ocr_only" if recovered_nonempty else "timeout"
                recovered_layout = (
                    _build_ocr_layout(
                        [
                            OCRToken(
                                text=recovered_ocr,
                                bbox=(0.0, 0.0, max(120.0, float(len(recovered_ocr) * 8.0)), 24.0),
                            )
                        ],
                        source="ocr_recovery",
                    )
                    if recovered_nonempty
                    else {
                        "ocr_text_display": "",
                        "ocr_lines": [],
                        "ocr_layout_source": "ocr_text_fallback",
                        "ocr_tokens": [],
                    }
                )
                return {
                    "caption": "",
                    "ocr_text": recovered_ocr if recovered_nonempty else "",
                    "ocr_text_display": str(recovered_layout.get("ocr_text_display", "") or "").strip(),
                    "ocr_lines": list(recovered_layout.get("ocr_lines", []) or []),
                    "ocr_layout_source": str(recovered_layout.get("ocr_layout_source", "ocr_text_fallback") or "ocr_text_fallback"),
                    "color_vqa": None,
                    "grounded_features": [],
                    "grounded_defects": [],
                    "grounded_attachments": [],
                    "key_count": None,
                    "raw": {
                        "caption_source": "lite_caption",
                        "ocr_layout": {
                            "source": str(recovered_layout.get("ocr_layout_source", "ocr_text_fallback") or "ocr_text_fallback"),
                            "lines": list(recovered_layout.get("ocr_lines", []) or []),
                            "tokens": recovered_layout.get("ocr_tokens", []),
                        },
                        "error": {"type": "timeout", "message": str(exc)},
                        "lite": {
                            "status": florence_status,
                            "reason": florence_reason,
                            "lite_nonempty": bool(recovered_nonempty),
                            "input_wh": input_wh,
                            "resized_wh": resized_wh,
                            "timeout_ms_used": int(timeout_ms),
                            "caption_len": 0,
                            "ocr_len": int(len(str(recovered_ocr or "").strip())),
                        },
                        "florence": {
                            "status": florence_status,
                            "reason": florence_reason,
                            "stage": "lite_core",
                            "attempts": attempts,
                            "timeout_ms_used": {
                                "ocr_ms": int(ocr_timeout_ms),
                                "full_ms": int(timeout_ms),
                            },
                            "recovery_attempted": True,
                            "recovery_succeeded": bool(recovered_nonempty),
                        },
                        "timings": {
                            "lite_ms": float(primary_elapsed),
                            "ocr_recovery_ms": float(recovery_meta.get("elapsed_ms", 0.0) or 0.0),
                        },
                    },
                }
            except Exception as exc:
                primary_elapsed = round((time.perf_counter() - lite_start) * 1000.0, 2)
                return {
                    "caption": "",
                    "ocr_text": "",
                    "ocr_text_display": "",
                    "ocr_lines": [],
                    "ocr_layout_source": "ocr_text_fallback",
                    "color_vqa": None,
                    "grounded_features": [],
                    "grounded_defects": [],
                    "grounded_attachments": [],
                    "key_count": None,
                    "raw": {
                        "caption_source": "lite_caption",
                        "error": {"type": "error", "message": str(exc)},
                        "lite": {
                            "status": "failed",
                            "reason": "exception",
                            "lite_nonempty": False,
                            "input_wh": input_wh,
                            "resized_wh": resized_wh,
                            "timeout_ms_used": int(timeout_ms),
                            "caption_len": 0,
                            "ocr_len": 0,
                        },
                        "florence": {
                            "status": "failed",
                            "reason": "exception",
                            "stage": "lite_core",
                            "attempts": [
                                {
                                    "source": "primary_lite_core",
                                    "status": "error",
                                    "reason": "exception",
                                    "elapsed_ms": float(primary_elapsed),
                                }
                            ],
                            "timeout_ms_used": {
                                "ocr_ms": int(ocr_timeout_ms),
                                "full_ms": int(timeout_ms),
                            },
                            "recovery_attempted": False,
                            "recovery_succeeded": False,
                        },
                        "timings": {
                            "lite_ms": float(primary_elapsed),
                        },
                    },
                }

        # 1. Captioning Strategy
        # Always run both detailed caption and guided VQA to get best object description
        
        # A) Detailed Caption
        raw_caption = self.caption(crop, detailed=(profile_key != "fast"), profile=profile_key)
        sanitized_caption, _ = _sanitize_caption(raw_caption)
        
        # B) Guided VQA (Object-only) — always run for richer detail
        guided_val = ""
        sanitized_guided = ""
        if profile_key != "fast":
            guide_prompt = (
                "Describe ONLY the main object in this image in 3–5 detailed sentences. "
                "Focus on physical characteristics you can directly observe: "
                "object type, material and texture (e.g. leather, fabric, metal, plastic), "
                "primary color and shade, exact shape and size, "
                "any brand names/logos/printed text (spell them out exactly as written), "
                "stitching style, closure mechanism (zipper, button, snap, clasp), "
                "compartments/pockets, surface condition, "
                "any attachments or accessories (only separate add-ons like a metal ring, lanyard, tag, or remote fob — if clearly visible), "
                "and any visible wear or defects (scratches, dents, cracks, stains, rust, bends, fading, peeling, tears). "
                "IMPORTANT: Describe only what is physically visible. Do NOT mention the person, hand, background, or any surface. "
                "Do NOT include meta-commentary about the task or about reading text. "
                "Do NOT say 'this image shows' or 'I can see'. Just describe the object directly."
            )
            guided_val = self.vqa(crop, guide_prompt, profile=profile_key)
            sanitized_guided, _ = _sanitize_caption(guided_val)
        
        # Selection Logic: Prefer guided if it's substantial, else fallback to sanitized caption
        # Guided is usually better for "object only" constraint.
        if len(sanitized_guided.split()) >= 5:
            final_caption = sanitized_guided
            caption_source = "guided_vqa"
        elif len(sanitized_caption.split()) >= 5:
            final_caption = sanitized_caption
            caption_source = "detailed_caption"
        else:
            # Both failed to produce good text, use whatever we have
            final_caption = sanitized_guided if len(sanitized_guided) > len(sanitized_caption) else sanitized_caption
            caption_source = "fallback"

        # Caption quality gate: flag generic captions so downstream stages
        # (reranking, Gemini) can lower their weight on caption evidence.
        caption_is_generic = _is_generic_caption(final_caption)

        # 2-4. Run OCR, Color VQA, and Key Count VQA in parallel (CPU I/O overlap
        # while GPU semaphore serializes the actual inference).
        from concurrent.futures import ThreadPoolExecutor, as_completed

        def _ocr_task():
            return self.ocr_structured(crop, profile=profile_key)

        def _color_vqa_task():
            color_q = (
                "What is the primary color of the OBJECT (not the background)? "
                "Answer with a short phrase including shade/tone if visible (e.g., 'dark gray', 'navy blue', 'matte black'). "
                "If unsure, answer 'unknown'."
            )
            val = self.vqa(crop, color_q, profile=profile_key).strip() or None
            if val and val.lower() == "unknown":
                val = None
            return val

        def _key_count_task():
            if canonical_label != "Key":
                return None
            kc_q = "How many separate keys are visible in this image? Answer with a single integer."
            kc_ans = self.vqa(crop, kc_q, profile=profile_key)
            m = re.search(r"\\b(\\d+)\\b", kc_ans)
            if m:
                try:
                    return int(m.group(1))
                except Exception:
                    logger.debug("Key count int parse failed", exc_info=True)
                    return 1
            return 1

        with ThreadPoolExecutor(max_workers=3) as pool:
            fut_ocr = pool.submit(_ocr_task)
            fut_color = pool.submit(_color_vqa_task)
            fut_key = pool.submit(_key_count_task)

        ocr_payload = fut_ocr.result()
        ocr_text = str(ocr_payload.get("ocr_text", "") or "").strip()
        ocr_text_display = str(ocr_payload.get("ocr_text_display", "") or "").strip()
        ocr_lines = list(ocr_payload.get("ocr_lines", []) or [])
        ocr_layout_source = str(ocr_payload.get("ocr_layout_source", "ocr_text_fallback") or "ocr_text_fallback")
        color_vqa = fut_color.result()
        key_count: Optional[int] = fut_key.result()

        # Normalize color and cross-validate with pixel-based extraction
        if color_vqa:
            color_vqa = normalize_color(color_vqa) or color_vqa

        # Pixel-based dominant color extraction for cross-validation
        pixel_color: Optional[str] = None
        try:
            from app.services.image_preprocessing import extract_pixel_dominant_color
            pixel_color = extract_pixel_dominant_color(crop)
        except Exception:
            logger.debug("Pixel color extraction failed", exc_info=True)

        if pixel_color and color_vqa:
            # If VQA and pixel disagree, prefer pixel (more reliable for solid colors)
            norm_vqa = normalize_color(color_vqa)
            if norm_vqa != pixel_color:
                logger.debug(
                    "COLOR_CROSS_VALIDATION vqa=%s pixel=%s → using pixel",
                    norm_vqa, pixel_color,
                )
                color_vqa = pixel_color
        elif pixel_color and not color_vqa:
            color_vqa = pixel_color
        elif not color_vqa:
            # Last resort: try extracting from caption text
            caption_color_full = extract_color_from_text(final_caption) if final_caption else None
            if caption_color_full:
                color_vqa = caption_color_full

        spec_key = canonicalize_label(canonical_label) if canonical_label else None

        # Fast profile: keep only core extraction fields and feature grounding.
        if profile_key == "fast":
            grounded_features: List[str] = []
            raw_grounding_labels: List[str] = []

            if spec_key and spec_key in CATEGORY_SPECS:
                specs = CATEGORY_SPECS[spec_key]
                normalized = _normalize_grounding_candidates(specs.get("features", []))
                if normalized:
                    chunks = _chunk_list(normalized, chunk_size=25)
                    found_items = set()
                    for chunk in chunks:
                        prompt_text = ", ".join(chunk)
                        g_out = self.ground_phrases(crop, prompt_text, profile=profile_key)
                        g_data = g_out.get("<CAPTION_TO_PHRASE_GROUNDING>") or g_out.get("result", {}).get("<CAPTION_TO_PHRASE_GROUNDING>")
                        if g_data and "labels" in g_data:
                            detected_labels = [l.strip().lower() for l in g_data["labels"]]
                            raw_grounding_labels.extend(g_data["labels"])
                            for cand in chunk:
                                if cand.lower() in detected_labels:
                                    found_items.add(cand)
                    grounded_features = list(found_items)

            grounded_description = _build_florence_description(
                caption=final_caption,
                label=canonical_label,
                color=color_vqa,
                ocr_text=ocr_text,
                grounded_features=grounded_features,
                grounded_defects=[],
                grounded_attachments=[],
                key_count=key_count,
            )

            raw_fast: Dict[str, Any] = {
                "caption": final_caption,
                "caption_primary": raw_caption,
                "caption_guided": guided_val,
                "caption_source": caption_source,
                "caption_is_generic": caption_is_generic,
                "description_source": grounded_description.get("description_source"),
                "detailed_description_source": grounded_description.get("detailed_description_source"),
                "description_evidence_used": grounded_description.get("description_evidence_used"),
                "description_filters_applied": grounded_description.get("description_filters_applied"),
                "description_word_count": grounded_description.get("description_word_count"),
                "description_timings_ms": grounded_description.get("description_timings_ms"),
                "ocr": ocr_text,
                "ocr_layout": {
                    "source": ocr_layout_source,
                    "lines": ocr_lines,
                    "tokens": ocr_payload.get("ocr_tokens", []),
                },
                "color_vqa": color_vqa,
                "defects_vqa": "None",
                "grounding_raw": {
                    "labels": raw_grounding_labels
                },
                "attachment_vqa_checks": [],
            }

            return {
                "caption": final_caption,
                "grounded_description": grounded_description.get("final_description"),
                "final_description": grounded_description.get("final_description"),
                "detailed_description": grounded_description.get("detailed_description"),
                "description_source": grounded_description.get("description_source"),
                "detailed_description_source": grounded_description.get("detailed_description_source"),
                "description_evidence_used": grounded_description.get("description_evidence_used"),
                "description_filters_applied": grounded_description.get("description_filters_applied"),
                "description_word_count": grounded_description.get("description_word_count"),
                "ocr_text": ocr_text,
                "ocr_text_display": ocr_text_display,
                "ocr_lines": ocr_lines,
                "ocr_layout_source": ocr_layout_source,
                "color_vqa": color_vqa,
                "grounded_features": grounded_features,
                "grounded_defects": [],
                "grounded_attachments": [],
                "key_count": key_count,
                "raw": raw_fast,
            }

        # 5. Grounding (Features, Defects, Attachments)
        grounded_features = []
        grounded_defects = []
        grounded_attachments = []
        
        raw_grounding_labels = []
        attachment_vqa_checks = []

        if spec_key and spec_key in CATEGORY_SPECS:
            specs = CATEGORY_SPECS[spec_key]
            
            # Helper to run grounding on a list of candidates
            def run_grounding_for_list(candidates: List[str]) -> List[str]:
                normalized = _normalize_grounding_candidates(candidates)
                if not normalized:
                    return []
                
                found_items = set()
                # Chunk to avoid context limits
                chunks = _chunk_list(normalized, chunk_size=25)
                
                for chunk in chunks:
                    # Use comma separation for list of phrases
                    prompt_text = ", ".join(chunk)
                    g_out = self.ground_phrases(crop, prompt_text, profile=profile_key)
                    
                    # Parse result
                    g_data = g_out.get("<CAPTION_TO_PHRASE_GROUNDING>") or g_out.get("result", {}).get("<CAPTION_TO_PHRASE_GROUNDING>")
                    
                    if g_data and "labels" in g_data:
                        # Florence returns labels found. We match them back to our candidates.
                        # Match case-insensitive.
                        detected_labels = [l.strip().lower() for l in g_data["labels"]]
                        raw_grounding_labels.extend(g_data["labels"])
                        
                        for cand in chunk:
                            if cand.lower() in detected_labels:
                                found_items.add(cand)
                                
                return list(found_items)

            # Run separately
            grounded_features = run_grounding_for_list(specs.get("features", []))
            grounded_defects = run_grounding_for_list(specs.get("defects", []))
            
            # Attachments with extra validation
            raw_grounded_attachments = run_grounding_for_list(specs.get("attachments", []))
            
            # Validate attachments with VQA
            for att in raw_grounded_attachments:
                q = f"Is there a separate {att} physically attached to the main object? Answer yes or no."
                ans = self.vqa(crop, q, profile=profile_key).strip().lower()
                is_valid = ans.startswith("yes")
                
                attachment_vqa_checks.append({
                    "attachment": att,
                    "answer": ans,
                    "kept": is_valid
                })
                
                if is_valid:
                    grounded_attachments.append(att)

        # 6. Defects VQA (Extra Evidence)
        defects_vqa_q = "List any visible wear or damage on the object using short phrases (e.g., scratches, dents, rust, cracks, stains, bent). If none, answer 'none'."
        defects_vqa_ans = self.vqa(crop, defects_vqa_q, profile=profile_key)
        if defects_vqa_ans.lower() in ["none", "no", "n/a"]:
            defects_vqa_ans = "None"

        grounded_description = _build_florence_description(
            caption=final_caption,
            label=canonical_label,
            color=color_vqa,
            ocr_text=ocr_text,
            grounded_features=grounded_features,
            grounded_defects=grounded_defects,
            grounded_attachments=grounded_attachments,
            key_count=key_count,
        )

        raw: Dict[str, Any] = {
            "caption": final_caption,
            "caption_primary": raw_caption,
            "caption_guided": guided_val,
            "caption_source": caption_source,
            "caption_is_generic": caption_is_generic,
            "description_source": grounded_description.get("description_source"),
            "detailed_description_source": grounded_description.get("detailed_description_source"),
            "description_evidence_used": grounded_description.get("description_evidence_used"),
            "description_filters_applied": grounded_description.get("description_filters_applied"),
            "description_word_count": grounded_description.get("description_word_count"),
            "description_timings_ms": grounded_description.get("description_timings_ms"),
            "ocr": ocr_text,
            "ocr_layout": {
                "source": ocr_layout_source,
                "lines": ocr_lines,
                "tokens": ocr_payload.get("ocr_tokens", []),
            },
            "color_vqa": color_vqa,
            "defects_vqa": defects_vqa_ans,
            "grounding_raw": {
                "labels": raw_grounding_labels
            },
            "attachment_vqa_checks": attachment_vqa_checks
        }

        return {
            "caption": final_caption,
            "grounded_description": grounded_description.get("final_description"),
            "final_description": grounded_description.get("final_description"),
            "detailed_description": grounded_description.get("detailed_description"),
            "description_source": grounded_description.get("description_source"),
            "detailed_description_source": grounded_description.get("detailed_description_source"),
            "description_evidence_used": grounded_description.get("description_evidence_used"),
            "description_filters_applied": grounded_description.get("description_filters_applied"),
            "description_word_count": grounded_description.get("description_word_count"),
            "ocr_text": ocr_text,
            "ocr_text_display": ocr_text_display,
            "ocr_lines": ocr_lines,
            "ocr_layout_source": ocr_layout_source,
            "color_vqa": color_vqa,
            "grounded_features": grounded_features,
            "grounded_defects": grounded_defects,
            "grounded_attachments": grounded_attachments,
            "key_count": key_count,
            "raw": raw,
        }
