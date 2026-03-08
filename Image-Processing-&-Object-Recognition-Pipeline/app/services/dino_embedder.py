"""
DINOv2 embedder for image vectors.

- Uses facebook/dinov2-base by default.
- Returns:
  - raw embedding (768d) and
  - a deterministic projected 128d vector (for storage / indexing).

Why projection?
- You asked for vector_128d; in production you'd ideally train a projection head
  or use PCA fitted on your dataset. This deterministic random projection is a
  pragmatic placeholder that is stable across runs.
"""

from __future__ import annotations

from dataclasses import dataclass
import logging
import os
import threading
from typing import List, Optional, Tuple

import numpy as np
from PIL import Image
from app.services.gpu_semaphore import gpu_inference_guard
from app.config import model_paths
from app.config.settings import settings

logger = logging.getLogger(__name__)


class DINOEmbedder:
    _shared_model = None
    _shared_processor = None
    _shared_model_key = None
    _shared_using_fp16 = False
    _shared_lock = threading.Lock()

    def __init__(
        self,
        model_name: str = model_paths.DINOV2_REPO_PATH,
        device: str = "cuda",
        projection_dim: int = 128,
        projection_seed: int = 42,
    ) -> None:
        self.model_name = model_name
        
        import torch
        if device == "cuda" and not torch.cuda.is_available():
            print("Warning: CUDA requested but not available. Falling back to CPU.")
            self.device = "cpu"
        else:
            self.device = device

        self.projection_dim = projection_dim
        self.projection_seed = projection_seed
        self.input_size = int(getattr(settings, "DINO_INPUT_SIZE", 224))
        self.enable_amp = bool(getattr(settings, "DINO_ENABLE_AMP", True))
        self.use_fp16 = bool(getattr(settings, "DINO_USE_FP16", True))
        self._using_fp16 = False

        self._processor = None
        self._model = None
        self._proj = None  # np.ndarray (D x projection_dim)
        self._model_load_lock = threading.Lock()

    def _required_model_files(self) -> Tuple[str, ...]:
        return (
            "config.json",
            "preprocessor_config.json",
        )

    def _validate_local_model_path(self) -> str:
        model_path = os.path.abspath(str(self.model_name))
        if not os.path.isdir(model_path):
            raise RuntimeError(
                f"Local DINO model directory not found at {model_path}. "
                "Expected a local Hugging Face model folder under app/models/DINOv2."
            )

        missing_required = [
            filename for filename in self._required_model_files() if not os.path.exists(os.path.join(model_path, filename))
        ]
        if missing_required:
            raise RuntimeError(
                f"Local DINO model directory is incomplete at {model_path}. "
                f"Missing required files: {', '.join(missing_required)}."
            )

        has_weights = any(
            os.path.exists(os.path.join(model_path, filename))
            for filename in ("model.safetensors", "pytorch_model.bin")
        )
        if not has_weights:
            raise RuntimeError(
                f"Local DINO model directory is incomplete at {model_path}. "
                "Missing model weights (expected model.safetensors or pytorch_model.bin)."
            )

        return model_path

    def _cache_key(self) -> Tuple[str, str, bool]:
        return (
            os.path.abspath(str(self.model_name)),
            str(self.device),
            bool(self.device == "cuda" and self.use_fp16),
        )

    def load_model(self) -> None:
        if self._model is not None and self._processor is not None:
            logger.debug("DINO_MODEL_LOAD_SKIP_ALREADY_LOADED")
            return
        lock = getattr(self, "_model_load_lock", None)
        if lock is None:
            self._model_load_lock = threading.Lock()
            lock = self._model_load_lock
        assert lock is not None
        with lock:
            if self._model is not None and self._processor is not None:
                logger.debug("DINO_MODEL_LOAD_SKIP_ALREADY_LOADED_LOCKED")
                return
            cache_key = self._cache_key()
            with DINOEmbedder._shared_lock:
                if (
                    DINOEmbedder._shared_model is not None
                    and DINOEmbedder._shared_processor is not None
                    and DINOEmbedder._shared_model_key == cache_key
                ):
                    self._model = DINOEmbedder._shared_model
                    self._processor = DINOEmbedder._shared_processor
                    self._using_fp16 = bool(DINOEmbedder._shared_using_fp16)
                    logger.debug(
                        "DINO_MODEL_REUSE_SHARED model_name=%s device=%s fp16=%s",
                        self.model_name,
                        self.device,
                        self._using_fp16,
                    )
                    return
            logger.debug(
                "DINO_MODEL_LOAD_START model_name=%s device=%s",
                self.model_name,
                self.device,
            )
            from transformers import AutoImageProcessor, AutoModel  # type: ignore
            import torch  # type: ignore

            local_model_path = self._validate_local_model_path()
            logger.info("DINO_MODEL_LOAD_LOCAL path=%s", local_model_path)
            try:
                self._processor = AutoImageProcessor.from_pretrained(local_model_path, local_files_only=True)
                self._model = AutoModel.from_pretrained(local_model_path, local_files_only=True)
            except Exception as exc:
                logger.error("DINO_MODEL_LOAD_FAILED_LOCAL path=%s error=%s", local_model_path, exc)
                raise RuntimeError(
                    f"Failed to load local DINO model from {local_model_path}. "
                    "Verify the local model files are present and readable."
                ) from exc
            if self.device:
                self._model.to(self.device)
            if self.device == "cuda" and self.use_fp16:
                try:
                    self._model.half()
                    self._using_fp16 = True
                except Exception:
                    self._using_fp16 = False
                    logger.warning("DINO_MODEL_HALF_FAILED_FALLBACK_FP32")
            else:
                self._using_fp16 = False
            self._model.eval()
            with DINOEmbedder._shared_lock:
                DINOEmbedder._shared_model = self._model
                DINOEmbedder._shared_processor = self._processor
                DINOEmbedder._shared_model_key = cache_key
                DINOEmbedder._shared_using_fp16 = bool(self._using_fp16)
            logger.debug(
                "DINO_MODEL_LOAD_DONE model_name=%s device=%s fp16=%s",
                self.model_name,
                self.device,
                self._using_fp16,
            )

    def _projection(self, in_dim: int) -> np.ndarray:
        if self._proj is None or self._proj.shape[0] != in_dim:
            rng = np.random.default_rng(self.projection_seed)
            # Random Gaussian projection, scaled.
            proj = rng.normal(size=(in_dim, self.projection_dim)).astype(np.float32)
            proj /= np.sqrt(in_dim)
            self._proj = proj
        return self._proj

    def _prepare_embedding_image(self, image: Image.Image) -> Image.Image:
        if not isinstance(image, Image.Image):
            return image
        target = max(32, int(getattr(self, "input_size", 224)))
        w, h = image.size
        if w <= 0 or h <= 0:
            return image

        scale = float(target) / float(min(w, h))
        new_w = max(target, int(round(w * scale)))
        new_h = max(target, int(round(h * scale)))
        resized = image.resize((new_w, new_h), Image.BILINEAR)

        left = max(0, int(round((new_w - target) / 2.0)))
        top = max(0, int(round((new_h - target) / 2.0)))
        right = min(new_w, left + target)
        bottom = min(new_h, top + target)
        return resized.crop((left, top, right, bottom))

    def embed_768(self, image: Image.Image) -> np.ndarray:
        self.load_model()
        assert self._processor is not None and self._model is not None

        import torch  # type: ignore

        prepared_image = self._prepare_embedding_image(image)
        inputs = self._processor(images=prepared_image, return_tensors="pt")
        if self.device:
            inputs = {k: v.to(self.device) for k, v in inputs.items()}

        use_amp_cuda = bool(
            self.device == "cuda"
            and torch.cuda.is_available()
            and bool(getattr(self, "enable_amp", True))
        )
        with torch.no_grad():
            with gpu_inference_guard("forward", "dino"):
                with torch.autocast(
                    device_type="cuda",
                    dtype=torch.float16,
                    enabled=use_amp_cuda,
                ):
                    outputs = self._model(**inputs)
            # DINOv2 returns last_hidden_state: [B, N, D]
            # Use CLS token (index 0).
            vec = outputs.last_hidden_state[:, 0, :].detach().cpu().numpy()[0]
        return vec.astype(np.float32)

    def project_128(self, vec_768: np.ndarray) -> np.ndarray:
        proj = self._projection(vec_768.shape[0])
        v128 = vec_768 @ proj
        return v128.astype(np.float32)

    def embed_both(self, image: Image.Image) -> Tuple[np.ndarray, np.ndarray]:
        vec_768 = self.embed_768(image)
        vec_128 = self.project_128(vec_768)
        return vec_768, vec_128

    def embed_128(self, image: Image.Image) -> np.ndarray:
        v = self.embed_768(image)
        return self.project_128(v)

    @staticmethod
    def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
        # normalize for cosine similarity (this is mathematical normalization, not "logic shortcuts")
        na = np.linalg.norm(a) + 1e-12
        nb = np.linalg.norm(b) + 1e-12
        return float(np.dot(a, b) / (na * nb))
