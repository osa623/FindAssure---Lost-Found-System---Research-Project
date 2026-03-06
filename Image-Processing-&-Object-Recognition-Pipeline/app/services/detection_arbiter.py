"""
Detection Arbiter – stateless comparison between YOLO and Florence OD results.

Used by both PP1 (UnifiedPipeline) and PP2 (MultiViewPipeline) to decide
whether to replace YOLO's top-1 detection with a Florence OD detection.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Tuple

from app.config.settings import settings
from app.domain.label_keywords import CATEGORY_KEYWORDS

logger = logging.getLogger(__name__)

# ── Keyword map used to score caption/OCR evidence ──────────────────────────
# Now imported from the shared label_keywords module to stay in sync with
# PP1 reranking, PP2 hint inference, and Florence strong-label derivation.
LABEL_EVIDENCE_KEYWORDS: Dict[str, List[str]] = CATEGORY_KEYWORDS


@dataclass
class ArbiterResult:
    """Outcome of the YOLO-vs-Florence arbitration."""
    triggered: bool
    reason: str                        # why fallback was (or was not) triggered
    winner_source: str                 # "yolo" | "florence" | "unchanged"
    final_label: str
    final_confidence: float
    final_bbox: Tuple[int, int, int, int]
    florence_detections: List[Dict[str, Any]] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)


# ── Trigger logic ────────────────────────────────────────────────────────────

def should_run_florence_od() -> Tuple[bool, str]:
    """
    Decide whether the Florence OD fallback should run.

    Always returns True when enabled so that every submission is
    cross-validated by Florence detection.
    """
    if not getattr(settings, "FLORENCE_OD_FALLBACK_ENABLED", True):
        return False, "fallback_disabled"
    return True, "always"


# ── IoU helper ───────────────────────────────────────────────────────────────

def _iou(box_a: Tuple[int, int, int, int], box_b: Tuple[int, int, int, int]) -> float:
    x1 = max(box_a[0], box_b[0])
    y1 = max(box_a[1], box_b[1])
    x2 = min(box_a[2], box_b[2])
    y2 = min(box_a[3], box_b[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    if inter == 0:
        return 0.0
    area_a = max(0, box_a[2] - box_a[0]) * max(0, box_a[3] - box_a[1])
    area_b = max(0, box_b[2] - box_b[0]) * max(0, box_b[3] - box_b[1])
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


# ── Evidence scoring ─────────────────────────────────────────────────────────

def _text_has_keyword(text: str, keyword: str) -> bool:
    if not text or not keyword:
        return False
    phrase = keyword.strip().lower()
    pattern = r"\b" + re.escape(phrase).replace(r"\ ", r"\s+") + r"\b"
    return re.search(pattern, text, re.IGNORECASE) is not None


def _evidence_score(label: str, caption: str, ocr_text: str) -> float:
    """Score 0.0–1.0 based on how many keywords for *label* appear in caption/OCR."""
    keywords = LABEL_EVIDENCE_KEYWORDS.get(label, [])
    if not keywords:
        return 0.0
    combined = (caption + " " + ocr_text).lower()
    hits = sum(1 for kw in keywords if _text_has_keyword(combined, kw))
    return min(1.0, hits / max(1, len(keywords)))


# ── Main arbitration ─────────────────────────────────────────────────────────

def arbitrate(
    yolo_detections: List[Any],
    florence_detections: List[Any],
    florence_analysis: Dict[str, Any],
) -> ArbiterResult:
    """
    Compare YOLO and Florence OD detections for the same image and pick the
    best final detection.  Strategy:
      - Match by IoU (>0.3)
      - For matched pairs: prefer Florence label (backed by caption/OCR evidence)
        but keep YOLO bbox (tighter).
      - For unmatched Florence-only detections with strong evidence, prefer Florence.
      - For unmatched YOLO-only detections, keep YOLO.
    """
    iou_threshold = 0.3

    if not florence_detections:
        # Nothing from Florence — keep YOLO as-is
        top1 = yolo_detections[0] if yolo_detections else None
        return ArbiterResult(
            triggered=True,
            reason="no_florence_detections",
            winner_source="yolo",
            final_label=str(getattr(top1, "label", "unknown")) if top1 else "unknown",
            final_confidence=float(getattr(top1, "confidence", 0.0)) if top1 else 0.0,
            final_bbox=tuple(getattr(top1, "bbox", (0, 0, 0, 0))) if top1 else (0, 0, 0, 0),
            florence_detections=[],
            metadata={"match_type": "no_florence_detections"},
        )

    # Serialize Florence detections for metadata
    florence_det_dicts = []
    for fd in florence_detections:
        florence_det_dicts.append({
            "label": str(getattr(fd, "label", "")),
            "confidence": float(getattr(fd, "confidence", 0.0)),
            "bbox": tuple(getattr(fd, "bbox", (0, 0, 0, 0))),
            "caption": str(getattr(fd, "caption", "")),
            "ocr_text": str(getattr(fd, "ocr_text", "")),
        })

    yolo_top1 = yolo_detections[0] if yolo_detections else None
    yolo_label = str(getattr(yolo_top1, "label", "unknown")) if yolo_top1 else "unknown"
    yolo_conf = float(getattr(yolo_top1, "confidence", 0.0)) if yolo_top1 else 0.0
    yolo_bbox = tuple(getattr(yolo_top1, "bbox", (0, 0, 0, 0))) if yolo_top1 else (0, 0, 0, 0)

    # Score each Florence detection by caption/OCR evidence
    best_florence = None
    best_florence_score = -1.0
    for fd in florence_detections:
        fl_label = str(getattr(fd, "label", ""))
        fl_caption = str(getattr(fd, "caption", ""))
        fl_ocr = str(getattr(fd, "ocr_text", ""))
        score = _evidence_score(fl_label, fl_caption, fl_ocr)
        if score > best_florence_score:
            best_florence_score = score
            best_florence = fd

    if best_florence is None:
        return ArbiterResult(
            triggered=True,
            reason="florence_scoring_failed",
            winner_source="yolo",
            final_label=yolo_label,
            final_confidence=yolo_conf,
            final_bbox=yolo_bbox,
            florence_detections=florence_det_dicts,
            metadata={"match_type": "florence_scoring_failed"},
        )

    fl_label = str(getattr(best_florence, "label", ""))
    fl_bbox = tuple(getattr(best_florence, "bbox", (0, 0, 0, 0)))
    fl_caption = str(getattr(best_florence, "caption", ""))
    fl_ocr = str(getattr(best_florence, "ocr_text", ""))

    # Score YOLO label evidence from Florence's existing crop analysis
    yolo_evidence = _evidence_score(
        yolo_label,
        str(florence_analysis.get("caption", "")),
        str(florence_analysis.get("ocr_text", "")),
    )

    # IoU match between YOLO top-1 and best Florence detection
    iou_val = _iou(yolo_bbox, fl_bbox) if yolo_top1 else 0.0
    matched = iou_val >= iou_threshold

    # Decision logic
    if matched:
        # Same region detected by both — choose label with stronger evidence
        if best_florence_score > yolo_evidence:
            return ArbiterResult(
                triggered=True,
                reason="matched_florence_label_stronger",
                winner_source="florence",
                final_label=fl_label,
                final_confidence=yolo_conf,   # keep YOLO confidence as proxy
                final_bbox=yolo_bbox,          # keep YOLO bbox (tighter)
                florence_detections=florence_det_dicts,
                metadata={
                    "match_type": "iou_matched",
                    "iou": round(iou_val, 4),
                    "florence_evidence_score": round(best_florence_score, 4),
                    "yolo_evidence_score": round(yolo_evidence, 4),
                    "yolo_label": yolo_label,
                    "florence_label": fl_label,
                },
            )
        else:
            return ArbiterResult(
                triggered=True,
                reason="matched_yolo_label_equal_or_stronger",
                winner_source="yolo",
                final_label=yolo_label,
                final_confidence=yolo_conf,
                final_bbox=yolo_bbox,
                florence_detections=florence_det_dicts,
                metadata={
                    "match_type": "iou_matched",
                    "iou": round(iou_val, 4),
                    "florence_evidence_score": round(best_florence_score, 4),
                    "yolo_evidence_score": round(yolo_evidence, 4),
                },
            )
    else:
        # Different regions — Florence found something YOLO didn't overlap with
        if best_florence_score >= 0.2:
            # Florence has decent evidence for its own detection
            # Use Florence label but prefer YOLO bbox if YOLO had a detection
            chosen_bbox = yolo_bbox if yolo_top1 else fl_bbox
            return ArbiterResult(
                triggered=True,
                reason="unmatched_florence_has_evidence",
                winner_source="florence",
                final_label=fl_label,
                final_confidence=yolo_conf if yolo_top1 else float(getattr(best_florence, "confidence", 0.9)),
                final_bbox=chosen_bbox,
                florence_detections=florence_det_dicts,
                metadata={
                    "match_type": "no_iou_match",
                    "iou": round(iou_val, 4),
                    "florence_evidence_score": round(best_florence_score, 4),
                    "yolo_evidence_score": round(yolo_evidence, 4),
                    "yolo_label": yolo_label,
                    "florence_label": fl_label,
                },
            )
        else:
            # Florence evidence is weak — stick with YOLO
            return ArbiterResult(
                triggered=True,
                reason="unmatched_florence_weak_evidence",
                winner_source="yolo",
                final_label=yolo_label,
                final_confidence=yolo_conf,
                final_bbox=yolo_bbox,
                florence_detections=florence_det_dicts,
                metadata={
                    "match_type": "no_iou_match",
                    "iou": round(iou_val, 4),
                    "florence_evidence_score": round(best_florence_score, 4),
                    "yolo_evidence_score": round(yolo_evidence, 4),
                },
            )
