import re
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from app.domain.category_specs import CATEGORY_SPECS, canonicalize_label
from app.domain.color_utils import extract_color_from_text, normalize_color

ANALYTICS_VERSION = "founder-prefill-v1"

_TOKEN_RE = re.compile(r"[a-z0-9]+")


def _normalize_text(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(_TOKEN_RE.findall(value.lower()))


def _tokenize(value: Any) -> List[str]:
    normalized = _normalize_text(value)
    return normalized.split() if normalized else []


def _levenshtein_distance(left: str, right: str) -> int:
    if left == right:
        return 0
    if not left:
        return len(right)
    if not right:
        return len(left)

    prev = list(range(len(right) + 1))
    for i, left_char in enumerate(left, start=1):
        curr = [i]
        for j, right_char in enumerate(right, start=1):
            insert_cost = curr[j - 1] + 1
            delete_cost = prev[j] + 1
            replace_cost = prev[j - 1] + (0 if left_char == right_char else 1)
            curr.append(min(insert_cost, delete_cost, replace_cost))
        prev = curr
    return prev[-1]


def _normalized_levenshtein_pct(left: str, right: str) -> Optional[float]:
    if not left and not right:
        return 0.0
    if not left or not right:
        return 100.0
    max_len = max(len(left), len(right))
    if max_len <= 0:
        return 0.0
    return (_levenshtein_distance(left, right) / max_len) * 100.0


def _token_jaccard_change_pct(left_tokens: Sequence[str], right_tokens: Sequence[str]) -> Optional[float]:
    left_set = set(left_tokens)
    right_set = set(right_tokens)
    if not left_set and not right_set:
        return 0.0
    union = left_set.union(right_set)
    if not union:
        return 0.0
    intersection = left_set.intersection(right_set)
    return (1.0 - (len(intersection) / len(union))) * 100.0


def _round_metric(value: Optional[float]) -> Optional[float]:
    if value is None:
        return None
    return round(float(value), 2)


def _normalize_category(value: Any) -> Optional[str]:
    if not isinstance(value, str) or not value.strip():
        return None
    canonical = canonicalize_label(value)
    return canonical or value.strip()


def _flatten_strings(value: Any) -> List[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        out: List[str] = []
        for key, child in value.items():
            out.append(str(key))
            out.extend(_flatten_strings(child))
        return out
    if isinstance(value, (list, tuple, set)):
        out = []
        for child in value:
            out.extend(_flatten_strings(child))
        return out
    if isinstance(value, (int, float, bool)):
        return [str(value)]
    return []


def _contains_phrase(text: str, phrase: str) -> bool:
    if not text or not phrase:
        return False
    return f" {phrase} " in f" {text} "


def _extract_vocab_matches(texts: Iterable[str], vocabulary: Sequence[str]) -> List[str]:
    normalized_texts = [_normalize_text(text) for text in texts if _normalize_text(text)]
    matches: List[str] = []
    for term in vocabulary:
        normalized_term = _normalize_text(term)
        if not normalized_term:
            continue
        if any(_contains_phrase(text, normalized_term) for text in normalized_texts):
            matches.append(term)
    return sorted(set(matches))


def _normalize_phrase_list(values: Iterable[Any]) -> List[str]:
    normalized: List[str] = []
    for value in values:
        if not isinstance(value, str):
            continue
        item = value.strip()
        if item:
            normalized.append(item)
    return sorted(set(normalized))


def _collect_pp2_texts(analysis_evidence: Dict[str, Any]) -> Tuple[List[str], List[str], List[str]]:
    fused = analysis_evidence.get("fused") if isinstance(analysis_evidence, dict) else {}
    per_view = analysis_evidence.get("per_view") if isinstance(analysis_evidence, dict) else []
    if not isinstance(fused, dict):
        fused = {}
    if not isinstance(per_view, list):
        per_view = []

    direct_texts = [
        fused.get("caption"),
        fused.get("detailed_description"),
    ]
    structured_texts = _flatten_strings(fused.get("attributes"))
    structured_texts.extend(_flatten_strings(fused.get("description_evidence_used")))
    structured_texts.extend(_flatten_strings(fused.get("defects")))

    grounded_texts: List[str] = []
    for view in per_view:
        if not isinstance(view, dict):
            continue
        extraction = view.get("extraction") if isinstance(view.get("extraction"), dict) else {}
        direct_texts.append(extraction.get("caption"))
        direct_texts.append(extraction.get("ocr_text"))
        grounded_texts.extend(_flatten_strings(extraction.get("grounded_features")))

    return _normalize_phrase_list(direct_texts), _normalize_phrase_list(structured_texts), _normalize_phrase_list(grounded_texts)


def _collect_pp1_texts(analysis_evidence: Dict[str, Any]) -> Tuple[List[str], List[str], List[str]]:
    pp1 = analysis_evidence.get("pp1") if isinstance(analysis_evidence, dict) else {}
    if not isinstance(pp1, dict):
        return [], [], []
    direct_texts = [
        pp1.get("final_description"),
        pp1.get("detailed_description"),
        pp1.get("ocr_text"),
    ]
    category_details = pp1.get("category_details") if isinstance(pp1.get("category_details"), dict) else {}
    structured_texts = _flatten_strings(category_details)
    raw_texts = _flatten_strings(pp1.get("raw"))
    return _normalize_phrase_list(direct_texts), _normalize_phrase_list(structured_texts), _normalize_phrase_list(raw_texts)


def _collect_side_evidence(
    *,
    category: Optional[str],
    description: Optional[str],
    explicit_color: Optional[str],
    analysis_mode: Optional[str],
    analysis_evidence: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    normalized_category = _normalize_category(category)
    spec = CATEGORY_SPECS.get(normalized_category or "", {})
    feature_vocab = spec.get("features", [])
    defect_vocab = spec.get("defects", [])
    attachment_vocab = spec.get("attachments", [])

    direct_texts = [description] if description else []
    structured_texts: List[str] = []
    extra_texts: List[str] = []
    if isinstance(analysis_evidence, dict):
        if analysis_mode == "pp2":
            collected = _collect_pp2_texts(analysis_evidence)
        else:
            collected = _collect_pp1_texts(analysis_evidence)
        direct_texts.extend(collected[0])
        structured_texts.extend(collected[1])
        extra_texts.extend(collected[2])

    all_texts = _normalize_phrase_list(direct_texts + structured_texts + extra_texts)
    detected_color = normalize_color(explicit_color or "") or normalize_color(extract_color_from_text(" ".join(all_texts)) or "")
    final_color = detected_color or None

    features = _extract_vocab_matches(all_texts, feature_vocab)
    defects = _extract_vocab_matches(all_texts, defect_vocab)
    attachments = _extract_vocab_matches(all_texts, attachment_vocab)

    return {
      "normalizedCategory": normalized_category,
      "normalizedDescription": _normalize_text(description),
      "tokens": sorted(set(_tokenize(description))),
      "color": final_color,
      "features": features,
      "defects": defects,
      "attachments": attachments,
      "texts": all_texts,
    }


def _overlap_pct(left: Sequence[str], right: Sequence[str]) -> Optional[float]:
    left_set = set(left)
    right_set = set(right)
    union = left_set.union(right_set)
    if not union:
        return None
    return (len(left_set.intersection(right_set)) / len(union)) * 100.0


def _difference(left: Sequence[str], right: Sequence[str]) -> List[str]:
    return sorted(set(left).difference(set(right)))


def _compute_overall_change(scores: Dict[str, Optional[float]]) -> Optional[float]:
    weights = {
        "categoryChangePct": 20.0,
        "descriptionEditPct": 20.0,
        "tokenChangePct": 10.0,
        "colorChangePct": 10.0,
        "featureChangePct": 25.0,
        "defectChangePct": 10.0,
        "attachmentChangePct": 5.0,
    }

    numerator = 0.0
    denominator = 0.0
    for key, weight in weights.items():
        value = scores.get(key)
        if value is None:
            continue
        numerator += value * weight
        denominator += weight

    if denominator <= 0:
        return None
    return numerator / denominator


def _matrix_pairs(matrix: Any) -> List[Tuple[Tuple[int, int], float]]:
    if not isinstance(matrix, list):
        return []
    pairs: List[Tuple[Tuple[int, int], float]] = []
    for i, row in enumerate(matrix):
        if not isinstance(row, list):
            continue
        for j, value in enumerate(row):
            if j <= i or not isinstance(value, (int, float)):
                continue
            pairs.append(((i, j), float(value)))
    return pairs


def _extract_multiview_verification(analysis_mode: Optional[str], analysis_evidence: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if analysis_mode != "pp2" or not isinstance(analysis_evidence, dict):
        return None
    verification = analysis_evidence.get("verification")
    if not isinstance(verification, dict):
        return None

    geometric_scores = verification.get("geometric_scores") if isinstance(verification.get("geometric_scores"), dict) else {}
    pair_strength_by_pair: Dict[str, str] = {}
    strong_count = 0
    near_miss_count = 0
    weak_count = 0
    for pair_key, info in geometric_scores.items():
        if not isinstance(info, dict):
            continue
        strength = str(info.get("pair_strength") or "").strip()
        if strength:
            pair_strength_by_pair[str(pair_key)] = strength
        lowered = strength.lower()
        if lowered == "strong":
            strong_count += 1
        elif lowered == "near_miss":
            near_miss_count += 1
        elif lowered == "weak":
            weak_count += 1

    cosine_pairs = _matrix_pairs(verification.get("cosine_sim_matrix"))
    faiss_pairs = _matrix_pairs(verification.get("faiss_sim_matrix"))
    cosine_by_pair = {f"{i}-{j}": score for (i, j), score in cosine_pairs}
    faiss_by_pair = {f"{i}-{j}": score for (i, j), score in faiss_pairs}
    pair_candidates = sorted(set(cosine_by_pair.keys()).union(faiss_by_pair.keys()))

    best_pair = None
    best_pair_score = None
    for pair_key in pair_candidates:
        score_parts = []
        if pair_key in cosine_by_pair:
            score_parts.append(cosine_by_pair[pair_key])
        if pair_key in faiss_by_pair:
            score_parts.append(faiss_by_pair[pair_key])
        if not score_parts:
            continue
        pair_score = sum(score_parts) / len(score_parts)
        if best_pair_score is None or pair_score > best_pair_score:
            best_pair_score = pair_score
            best_pair = pair_key

    used_views = verification.get("used_views") if isinstance(verification.get("used_views"), list) else []
    dropped_views = verification.get("dropped_views") if isinstance(verification.get("dropped_views"), list) else []
    normalized_dropped = [
        {
            "viewIndex": item.get("view_index"),
            "reason": item.get("reason"),
        }
        for item in dropped_views
        if isinstance(item, dict)
    ]

    return {
        "available": True,
        "mode": verification.get("mode"),
        "passed": bool(verification.get("passed")),
        "usedViews": [int(value) for value in used_views if isinstance(value, int)],
        "droppedViews": normalized_dropped,
        "failureReasons": [str(value) for value in verification.get("failure_reasons", []) if isinstance(value, str)],
        "strongPairCount": strong_count,
        "nearMissPairCount": near_miss_count,
        "weakPairCount": weak_count,
        "pairStrengthByPair": pair_strength_by_pair,
        "averageCosine": _round_metric(sum(score for _, score in cosine_pairs) / len(cosine_pairs)) if cosine_pairs else None,
        "averageFaiss": _round_metric(sum(score for _, score in faiss_pairs) / len(faiss_pairs)) if faiss_pairs else None,
        "bestPair": best_pair,
        "bestPairReason": "used_views" if len(used_views) == 2 else ("highest_mean_similarity" if best_pair else None),
    }


def compute_founder_prefill_analytics(payload: Dict[str, Any]) -> Dict[str, Any]:
    analysis_mode = payload.get("analysisMode")
    predicted_category = payload.get("predictedCategory")
    predicted_description = payload.get("predictedDescription")
    predicted_color = payload.get("predictedColor")
    final_category = payload.get("finalCategory")
    final_description = payload.get("finalDescription")
    analysis_evidence = payload.get("analysisEvidence") if isinstance(payload.get("analysisEvidence"), dict) else None

    predicted_side = _collect_side_evidence(
        category=predicted_category,
        description=predicted_description,
        explicit_color=predicted_color,
        analysis_mode=analysis_mode,
        analysis_evidence=analysis_evidence,
    )
    final_side = _collect_side_evidence(
        category=final_category,
        description=final_description,
        explicit_color=None,
        analysis_mode=None,
        analysis_evidence=None,
    )

    predicted_category_norm = predicted_side["normalizedCategory"]
    final_category_norm = final_side["normalizedCategory"]
    if predicted_category_norm and final_category_norm:
        category_change_pct: Optional[float] = 0.0 if predicted_category_norm == final_category_norm else 100.0
    else:
        category_change_pct = None

    description_edit_pct = _normalized_levenshtein_pct(
        str(predicted_side["normalizedDescription"]),
        str(final_side["normalizedDescription"]),
    )
    token_change_pct = _token_jaccard_change_pct(predicted_side["tokens"], final_side["tokens"])

    predicted_color_norm = predicted_side["color"]
    final_color_norm = final_side["color"]
    if predicted_color_norm or final_color_norm:
        color_change_pct: Optional[float] = 0.0 if predicted_color_norm == final_color_norm else 100.0
    else:
        color_change_pct = None

    feature_overlap_pct = _overlap_pct(predicted_side["features"], final_side["features"])
    defect_overlap_pct = _overlap_pct(predicted_side["defects"], final_side["defects"])
    attachment_overlap_pct = _overlap_pct(predicted_side["attachments"], final_side["attachments"])

    predicted_evidence_terms = set(predicted_side["features"]) | set(predicted_side["defects"]) | set(predicted_side["attachments"])
    if predicted_color_norm:
        predicted_evidence_terms.add(predicted_color_norm)
    final_evidence_terms = set(final_side["features"]) | set(final_side["defects"]) | set(final_side["attachments"])
    if final_color_norm:
        final_evidence_terms.add(final_color_norm)
    evidence_coverage_pct = (
        (len(predicted_evidence_terms.intersection(final_evidence_terms)) / len(predicted_evidence_terms)) * 100.0
        if predicted_evidence_terms
        else None
    )

    score_components = {
        "categoryChangePct": category_change_pct,
        "descriptionEditPct": description_edit_pct,
        "tokenChangePct": token_change_pct,
        "colorChangePct": color_change_pct,
        "featureChangePct": None if feature_overlap_pct is None else 100.0 - feature_overlap_pct,
        "defectChangePct": None if defect_overlap_pct is None else 100.0 - defect_overlap_pct,
        "attachmentChangePct": None if attachment_overlap_pct is None else 100.0 - attachment_overlap_pct,
    }
    overall_change_pct = _compute_overall_change(score_components)

    changed_dimensions = [
        name
        for name, value in (
            ("category", category_change_pct),
            ("description", description_edit_pct),
            ("tokens", token_change_pct),
            ("color", color_change_pct),
            ("features", score_components["featureChangePct"]),
            ("defects", score_components["defectChangePct"]),
            ("attachments", score_components["attachmentChangePct"]),
        )
        if value is not None and value > 0
    ]

    multiview_verification = _extract_multiview_verification(analysis_mode, analysis_evidence)

    return {
        "pipelineAnalyticsVersion": ANALYTICS_VERSION,
        "finalExtractedColor": final_color_norm,
        "changeMetrics": {
            "overallChangePct": _round_metric(overall_change_pct),
            "categoryChangePct": _round_metric(category_change_pct),
            "descriptionEditPct": _round_metric(description_edit_pct),
            "tokenChangePct": _round_metric(token_change_pct),
            "descriptionLengthDelta": len(_tokenize(final_description)) - len(_tokenize(predicted_description)),
            "colorChanged": bool(color_change_pct and color_change_pct > 0),
            "colorChangePct": _round_metric(color_change_pct),
            "featureOverlapPct": _round_metric(feature_overlap_pct),
            "addedFeatures": _difference(final_side["features"], predicted_side["features"]),
            "removedFeatures": _difference(predicted_side["features"], final_side["features"]),
            "defectOverlapPct": _round_metric(defect_overlap_pct),
            "addedDefects": _difference(final_side["defects"], predicted_side["defects"]),
            "removedDefects": _difference(predicted_side["defects"], final_side["defects"]),
            "attachmentOverlapPct": _round_metric(attachment_overlap_pct),
            "addedAttachments": _difference(final_side["attachments"], predicted_side["attachments"]),
            "removedAttachments": _difference(predicted_side["attachments"], final_side["attachments"]),
            "evidenceCoveragePct": _round_metric(evidence_coverage_pct),
            "changedDimensions": changed_dimensions,
        },
        "comparisonEvidence": {
            "analysisMode": analysis_mode,
            "predicted": predicted_side,
            "final": final_side,
        },
        "multiviewVerification": multiview_verification,
    }
