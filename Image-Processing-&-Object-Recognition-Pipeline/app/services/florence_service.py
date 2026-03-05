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
- Loads model from local path: app/models/florence2-base-ft/
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
import threading
import time

from PIL import Image

from app.domain.category_specs import canonicalize_label, CATEGORY_SPECS
from app.config.settings import settings
from app.services.gpu_semaphore import gpu_inference_guard

logger = logging.getLogger(__name__)


def _lite_worker_main(req_q: Any, resp_q: Any, service_cfg: Dict[str, Any]) -> None:
    """
    Dedicated worker process for Florence-lite inference.
    This allows hard timeouts by terminating the worker process.
    """
    svc = FlorenceService(
        model_path=str(service_cfg.get("model_path", "app/models/florence2-base-ft/")),
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


def _caption_mentions_person(text: str) -> bool:
    """True if text mentions person-related words."""
    if not text:
        return False
    keywords = {"person", "hand", "finger", "skin", "holding", "man", "woman", "boy", "girl", "human"}
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


def _sanitize_caption(text: str) -> Tuple[str, List[str]]:
    """
    Splits caption into sentences and drops those mentioning person/hand/skin.
    Returns (sanitized_text, removed_sentences).
    """
    if not text:
        return "", []
    
    # Split by . ! ? but keep delimiters. Simple split by . is often enough for Florence.
    sentences = re.split(r'(?<=[.!?])\s+', text)
    
    kept = []
    removed = []
    
    for s in sentences:
        if _caption_mentions_person(s) or _caption_mentions_demographics(s):
            removed.append(s)
        else:
            kept.append(s)
            
    return " ".join(kept).strip(), removed


def _is_generic_caption(text: str) -> bool:
    """
    Returns True if caption is too short or matches generic patterns.
    """
    if not text:
        return True
    
    # 1. Length check (< 10 words)
    words = text.split()
    if len(words) < 10:
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


class FlorenceService:
    _shared_model = None
    _shared_processor = None
    _shared_model_key = None
    _shared_using_fp16 = False
    _shared_lock = threading.Lock()

    def __init__(
        self,
        model_path: str = "app/models/florence2-base-ft/",
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
            pass

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
            pass

        for q in (req_q, resp_q):
            if q is None:
                continue
            try:
                q.close()
            except Exception:
                pass
            try:
                q.cancel_join_thread()
            except Exception:
                pass

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
        else:
            max_tokens = self.max_new_tokens
            num_beams = 3

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
                # so we assign a default high confidence since it detected it.
                # Or we could try to extract it if we used a different task, but <OD> is standard.
                conf = 0.9 
                
                detections.append(Detection(
                    label=canonical,
                    confidence=conf,
                    bbox=(x1, y1, x2, y2)
                ))
                
            return detections
            
        except Exception as e:
            print(f"Florence detection error: {e}")
            return []

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
            return ""

    def ocr(self, image: Image.Image, profile: Optional[str] = None) -> str:
        """
        OCR task. Returns plain concatenated text. If OCR task unsupported, returns "".
        """
        try:
            out = self._run_task(image, "<OCR>", profile=profile)
            # Some variants return {"text": "..."} or a list of lines.
            for k in ("text", "ocr", "<OCR>"):
                val = out.get(k)
                if isinstance(val, str):
                    return val.strip()
                if isinstance(val, list):
                    parts = [_safe_str(x).strip() for x in val]
                    parts = [p for p in parts if p]
                    return "\n".join(parts).strip()

            # Sometimes OCR returns tokens with boxes:
            # {"tokens": [{"text": "..."} ...]}
            tokens = out.get("tokens")
            if isinstance(tokens, list):
                parts = []
                for t in tokens:
                    if isinstance(t, dict) and "text" in t:
                        parts.append(_safe_str(t["text"]).strip())
                parts = [p for p in parts if p]
                return "\n".join(parts).strip()

            return ""
        except Exception:
            return ""

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
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(fn, *args, **kwargs)
            try:
                return future.result(timeout=timeout_sec)
            except FuturesTimeoutError as exc:
                raise TimeoutError(f"Operation exceeded timeout of {timeout_ms} ms") from exc

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

        ocr_text = self.ocr(crop, profile=profile_key)
        color_q = (
            "What is the primary color of the object? "
            "Answer with a short phrase or 'unknown'."
        )
        color_vqa = self.vqa(crop, color_q, profile=profile_key).strip() or None
        if color_vqa and color_vqa.lower() == "unknown":
            color_vqa = None

        reason = self._lite_reason(final_caption, ocr_text)
        lite_nonempty = self._is_lite_nonempty(final_caption, ocr_text)
        caption_len = len(str(final_caption or "").strip())
        ocr_len = len(str(ocr_text or "").strip())

        return {
            "caption": final_caption,
            "ocr_text": ocr_text,
            "color_vqa": color_vqa,
            "grounded_features": [],
            "grounded_defects": [],
            "grounded_attachments": [],
            "key_count": None,
            "raw": {
                "caption_source": "lite_caption",
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
            nonlocal ocr_text
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
            ocr_raw = self._run_with_timeout(
                self.ocr,
                ocr_timeout_ms,
                ocr_image,
                profile_key,
            )
            ocr_text = str(ocr_raw or "").strip()
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
                return {
                    "caption": "",
                    "ocr_text": recovered_ocr if recovered_nonempty else "",
                    "color_vqa": None,
                    "grounded_features": [],
                    "grounded_defects": [],
                    "grounded_attachments": [],
                    "key_count": None,
                    "raw": {
                        "caption_source": "lite_caption",
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
        
        # B) Guided VQA (Object-only)
        guide_prompt = (
            "Describe ONLY the main object (ignore the person/hand and background) in 2–4 sentences. "
            "Include: object type, material (if visible), primary color/shade, shape, any logos/text (if visible), "
            "any attachments/accessories (only separate add-ons like a metal ring, lanyard, tag, or remote fob — if clearly visible), and any visible wear/defects "
            "(scratches, dents, cracks, stains, rust, bends). If something is not visible, say 'not visible'. "
            "Do NOT mention the person, hand, skin, gender, or race. Do NOT guess. Do NOT treat holes/slots/built-in parts as attachments."
        )
        guided_val = self.vqa(crop, guide_prompt, profile=profile_key) if profile_key != "fast" else ""
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

        # 2. OCR
        ocr_text = self.ocr(crop, profile=profile_key)

        # 3. Color VQA
        color_q = (
            "What is the primary color of the OBJECT (not the background)? "
            "Answer with a short phrase including shade/tone if visible (e.g., 'dark gray', 'navy blue', 'matte black'). "
            "If unsure, answer 'unknown'."
        )
        color_vqa = self.vqa(crop, color_q, profile=profile_key).strip() or None
        if color_vqa and color_vqa.lower() == "unknown":
            color_vqa = None

        # 4. Key Count (Conditional)
        key_count: Optional[int] = None
        if canonical_label == "Key":
            kc_q = "How many separate keys are visible in this image? Answer with a single integer."
            kc_ans = self.vqa(crop, kc_q, profile=profile_key)
            m = re.search(r"\\b(\\d+)\\b", kc_ans)
            if m:
                try:
                    key_count = int(m.group(1))
                except Exception:
                    key_count = 1
            else:
                key_count = 1

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

            raw_fast: Dict[str, Any] = {
                "caption": final_caption,
                "caption_primary": raw_caption,
                "caption_guided": guided_val,
                "caption_source": caption_source,
                "ocr": ocr_text,
                "color_vqa": color_vqa,
                "defects_vqa": "None",
                "grounding_raw": {
                    "labels": raw_grounding_labels
                },
                "attachment_vqa_checks": [],
            }

            return {
                "caption": final_caption,
                "ocr_text": ocr_text,
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

        raw: Dict[str, Any] = {
            "caption": final_caption,
            "caption_primary": raw_caption,
            "caption_guided": guided_val,
            "caption_source": caption_source,
            "ocr": ocr_text,
            "color_vqa": color_vqa,
            "defects_vqa": defects_vqa_ans,
            "grounding_raw": {
                "labels": raw_grounding_labels
            },
            "attachment_vqa_checks": attachment_vqa_checks
        }

        return {
            "caption": final_caption,
            "ocr_text": ocr_text,
            "color_vqa": color_vqa,
            "grounded_features": grounded_features,
            "grounded_defects": grounded_defects,
            "grounded_attachments": grounded_attachments,
            "key_count": key_count,
            "raw": raw,
        }
