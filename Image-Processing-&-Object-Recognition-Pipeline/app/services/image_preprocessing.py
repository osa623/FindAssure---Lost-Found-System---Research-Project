"""
Image preprocessing utilities for OCR and color extraction.

Applies contrast enhancement (CLAHE), sharpening, and optional
binarization to improve downstream OCR and color accuracy.
"""

from __future__ import annotations

import logging
from typing import Optional

import cv2
import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)


def pil_to_cv2(image: Image.Image) -> np.ndarray:
    """Convert PIL Image (RGB) to OpenCV BGR array."""
    rgb = np.array(image.convert("RGB"))
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)


def cv2_to_pil(bgr: np.ndarray) -> Image.Image:
    """Convert OpenCV BGR array to PIL Image (RGB)."""
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    return Image.fromarray(rgb)


def extract_dominant_colors_kmeans(
    image: Image.Image,
    *,
    k: int = 5,
    max_pixels: int = 10000,
) -> list[tuple[np.ndarray, float]]:
    """
    Extract k dominant colors from an image using K-Means clustering.

    Returns a list of (BGR centroid, proportion) tuples sorted by
    proportion descending.  The centroids are in BGR uint8.
    """
    bgr = pil_to_cv2(image)
    h, w = bgr.shape[:2]
    total = h * w

    # Downsample for speed if needed
    if total > max_pixels:
        scale = (max_pixels / total) ** 0.5
        bgr = cv2.resize(bgr, (max(1, int(w * scale)), max(1, int(h * scale))))

    pixels = bgr.reshape(-1, 3).astype(np.float32)

    criteria = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0)
    _, labels, centers = cv2.kmeans(pixels, k, None, criteria, 3, cv2.KMEANS_PP_CENTERS)

    labels_flat = labels.flatten()
    counts = np.bincount(labels_flat, minlength=k)
    proportions = counts / counts.sum()

    # Sort by proportion descending
    order = np.argsort(-proportions)
    results = []
    for idx in order:
        centroid = centers[idx].astype(np.uint8)
        results.append((centroid, float(proportions[idx])))
    return results


# Pre-defined canonical color centroids in LAB space for matching
_CANONICAL_LAB: Optional[dict[str, np.ndarray]] = None


def _build_canonical_lab() -> dict[str, np.ndarray]:
    """Build canonical color name → LAB centroid lookup (lazy, cached)."""
    global _CANONICAL_LAB
    if _CANONICAL_LAB is not None:
        return _CANONICAL_LAB

    # Representative BGR values for canonical colors
    bgr_map = {
        "black": (0, 0, 0),
        "white": (255, 255, 255),
        "red": (0, 0, 200),
        "blue": (200, 50, 0),
        "green": (0, 150, 0),
        "yellow": (0, 230, 230),
        "orange": (0, 130, 240),
        "purple": (150, 0, 150),
        "pink": (150, 100, 230),
        "brown": (30, 70, 130),
        "gray": (128, 128, 128),
        "silver": (192, 192, 192),
        "gold": (0, 180, 220),
        "beige": (180, 210, 230),
        "teal": (180, 150, 0),
    }
    lab_map: dict[str, np.ndarray] = {}
    for name, (b, g, r) in bgr_map.items():
        pixel = np.uint8([[[b, g, r]]])
        lab = cv2.cvtColor(pixel, cv2.COLOR_BGR2LAB)[0, 0].astype(np.float32)
        lab_map[name] = lab

    _CANONICAL_LAB = lab_map
    return _CANONICAL_LAB


def bgr_to_canonical_color(bgr: np.ndarray) -> tuple[str, float]:
    """
    Map a BGR centroid to the nearest canonical color name using
    CIE-LAB Euclidean distance.

    Returns (color_name, distance).
    """
    lab_map = _build_canonical_lab()
    pixel = np.uint8([[[int(bgr[0]), int(bgr[1]), int(bgr[2])]]])
    lab = cv2.cvtColor(pixel, cv2.COLOR_BGR2LAB)[0, 0].astype(np.float32)

    best_name = "unknown"
    best_dist = float("inf")
    for name, ref_lab in lab_map.items():
        dist = float(np.linalg.norm(lab - ref_lab))
        if dist < best_dist:
            best_dist = dist
            best_name = name
    return best_name, best_dist


def extract_pixel_dominant_color(
    image: Image.Image,
    *,
    k: int = 5,
    max_lab_distance: float = 60.0,
) -> Optional[str]:
    """
    Extract the dominant canonical color from an image using pixel analysis.

    Uses K-Means clustering on the image pixels, then maps the largest
    cluster centroid to the nearest canonical color in LAB space.

    Returns the canonical color name, or None if the match distance
    exceeds max_lab_distance.
    """
    try:
        clusters = extract_dominant_colors_kmeans(image, k=k)
        if not clusters:
            return None

        # Use the most dominant cluster
        centroid_bgr, proportion = clusters[0]
        color_name, dist = bgr_to_canonical_color(centroid_bgr)

        if dist > max_lab_distance:
            logger.debug(
                "Pixel color match too distant: %s dist=%.1f (max=%.1f)",
                color_name, dist, max_lab_distance,
            )
            return None

        return color_name
    except Exception:
        logger.debug("Pixel dominant color extraction failed", exc_info=True)
        return None
