"""Shared bounding-box helpers used across PP1, PP2 and search."""

from typing import Tuple


def clip_bbox(
    bbox: Tuple[int, int, int, int],
    width: int,
    height: int,
) -> Tuple[int, int, int, int]:
    """Clamp a (x1, y1, x2, y2) box to [0, width) x [0, height)."""
    x1, y1, x2, y2 = bbox
    x1 = max(0, min(width, int(x1)))
    y1 = max(0, min(height, int(y1)))
    x2 = max(0, min(width, int(x2)))
    y2 = max(0, min(height, int(y2)))
    return x1, y1, x2, y2
