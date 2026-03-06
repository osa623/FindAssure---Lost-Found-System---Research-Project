import unittest
from typing import Dict, Any, List, Optional

from pydantic import ValidationError

from app.schemas.pp2_schemas import (
    PP2Response,
    PP2PerViewResult,
    PP2PerViewDetection,
    PP2PerViewExtraction,
    PP2PerViewEmbedding,
    PP2VerificationResult,
)


def _identity_matrix(n: int) -> List[List[float]]:
    return [[1.0 if i == j else 0.9 for j in range(n)] for i in range(n)]


def _view(index: int) -> PP2PerViewResult:
    return PP2PerViewResult(
        view_index=index,
        filename=f"view_{index}.jpg",
        detection=PP2PerViewDetection(bbox=(0, 0, 10, 10), cls_name="Wallet", confidence=0.9),
        extraction=PP2PerViewExtraction(caption="sample", ocr_text="", grounded_features={}),
        embedding=PP2PerViewEmbedding(dim=4, vector_preview=[0.1, 0.2, 0.3, 0.4], vector_id=f"v{index}"),
        quality_score=1.0,
    )


def _verification(
    n: int,
    geometric_scores: Dict[str, Any],
    used_views: Optional[List[int]] = None,
    dropped_views: Optional[List[Dict[str, Any]]] = None,
    mode: Optional[str] = None,
) -> PP2VerificationResult:
    payload: Dict[str, Any] = {
        "cosine_sim_matrix": _identity_matrix(n),
        "faiss_sim_matrix": _identity_matrix(n),
        "geometric_scores": geometric_scores,
        "passed": True,
        "failure_reasons": [],
        "used_views": used_views or [],
        "dropped_views": dropped_views or [],
    }
    if mode is not None:
        payload["mode"] = mode
    return PP2VerificationResult(**payload)


class TestPP2Schemas(unittest.TestCase):
    def test_verification_mode_default_and_explicit_values(self):
        default_mode = _verification(2, {"0-1": {"passed": True}})
        self.assertEqual(default_mode.mode, "unsupported")

        explicit_two = _verification(2, {"0-1": {"passed": True}}, mode="two_view")
        self.assertEqual(explicit_two.mode, "two_view")

        explicit_three = _verification(3, {"0-1": {}, "0-2": {}, "1-2": {}}, mode="three_view")
        self.assertEqual(explicit_three.mode, "three_view")

        with self.assertRaises(ValidationError):
            _verification(2, {"0-1": {"passed": True}}, mode="invalid_mode")

    def test_per_view_accepts_two_and_three(self):
        two_view_response = PP2Response(
            item_id="test-id",
            per_view=[_view(0), _view(1)],
            verification=_verification(2, {"0-1": {"passed": True}}),
            fused=None,
            faiss_ids=[101, 102, 103],
            stored=False,
            cache_key=None,
        )
        self.assertEqual(two_view_response.faiss_ids, [101, 102, 103])
        PP2Response(
            item_id="test-id",
            per_view=[_view(0), _view(1), _view(2)],
            verification=_verification(3, {"0-1": {}, "0-2": {}, "1-2": {}}),
            fused=None,
            stored=False,
            cache_key=None,
        )

    def test_response_accepts_resolved_label(self):
        response = PP2Response(
            item_id="test-id",
            per_view=[_view(0), _view(1)],
            verification=_verification(2, {"0-1": {"passed": True}}),
            fused=None,
            resolved_label="Helmet",
            stored=False,
            cache_key=None,
        )
        self.assertEqual(response.resolved_label, "Helmet")

    def test_per_view_rejects_one_and_four(self):
        with self.assertRaises(ValidationError):
            PP2Response(
                item_id="test-id",
                per_view=[_view(0)],
                verification=_verification(2, {"0-1": {"passed": True}}),
                fused=None,
                stored=False,
                cache_key=None,
            )

        with self.assertRaises(ValidationError):
            PP2Response(
                item_id="test-id",
                per_view=[_view(0), _view(1), _view(2), _view(3)],
                verification=_verification(3, {"0-1": {}, "0-2": {}, "1-2": {}}),
                fused=None,
                stored=False,
                cache_key=None,
            )

    def test_matrix_accepts_2x2_and_3x3(self):
        PP2VerificationResult(
            cosine_sim_matrix=_identity_matrix(2),
            faiss_sim_matrix=_identity_matrix(2),
            geometric_scores={"0-1": {}},
            passed=True,
            failure_reasons=[],
        )
        PP2VerificationResult(
            cosine_sim_matrix=_identity_matrix(3),
            faiss_sim_matrix=_identity_matrix(3),
            geometric_scores={"0-1": {}, "0-2": {}, "1-2": {}},
            passed=True,
            failure_reasons=[],
        )

    def test_matrix_rejects_non_square(self):
        with self.assertRaises(ValidationError):
            PP2VerificationResult(
                cosine_sim_matrix=[[1.0, 0.9], [0.9, 1.0], [0.9, 0.9]],
                faiss_sim_matrix=_identity_matrix(2),
                geometric_scores={"0-1": {}},
                passed=True,
                failure_reasons=[],
            )

        with self.assertRaises(ValidationError):
            PP2VerificationResult(
                cosine_sim_matrix=_identity_matrix(2),
                faiss_sim_matrix=[[1.0, 0.9], [0.9]],
                geometric_scores={"0-1": {}},
                passed=True,
                failure_reasons=[],
            )

    def test_response_rejects_matrix_view_count_mismatch(self):
        with self.assertRaises(ValidationError):
            PP2Response(
                item_id="test-id",
                per_view=[_view(0), _view(1)],
                verification=_verification(3, {"0-1": {}, "0-2": {}, "1-2": {}}),
                fused=None,
                stored=False,
                cache_key=None,
            )

    def test_geometric_keys_must_match_existing_pairs(self):
        PP2Response(
            item_id="test-id",
            per_view=[_view(0), _view(1)],
            verification=_verification(2, {"0-1": {"passed": True}}),
            fused=None,
            stored=False,
            cache_key=None,
        )

        with self.assertRaises(ValidationError):
            PP2Response(
                item_id="test-id",
                per_view=[_view(0), _view(1)],
                verification=_verification(2, {"0-2": {"passed": True}}),
                fused=None,
                stored=False,
                cache_key=None,
            )

    def test_geometric_scores_accept_enriched_pair_payload(self):
        PP2Response(
            item_id="test-id",
            per_view=[_view(0), _view(1)],
            verification=_verification(
                2,
                {
                    "0-1": {
                        "passed": True,
                        "best_similarity_path": "center/full",
                        "multi_crop_helped": True,
                        "selected_cosine": 0.91,
                        "selected_faiss": 0.90,
                        "full_full_cosine": 0.82,
                        "full_full_faiss": 0.81,
                        "pair_strength": "strong",
                    }
                },
            ),
            fused=None,
            stored=False,
            cache_key=None,
        )

        with self.assertRaises(ValidationError):
            PP2Response(
                item_id="test-id",
                per_view=[_view(0), _view(1)],
                verification=_verification(2, {"not-a-pair": {"passed": True}}),
                fused=None,
                stored=False,
                cache_key=None,
            )

    def test_extraction_raw_is_optional_and_accepts_metadata(self):
        with_raw = PP2PerViewResult(
            view_index=0,
            filename="view_0.jpg",
            detection=PP2PerViewDetection(bbox=(0, 0, 10, 10), cls_name="Wallet", confidence=0.9),
            extraction=PP2PerViewExtraction(
                caption="sample",
                ocr_text="TXT",
                grounded_features={},
                extraction_confidence=0.4,
                raw={
                    "timings": {"lite_ms": 12.1, "lite_total_ms": 32.0},
                    "lite": {"status": "success", "lite_nonempty": True},
                },
            ),
            embedding=PP2PerViewEmbedding(dim=4, vector_preview=[0.1, 0.2, 0.3, 0.4], vector_id="v0"),
            quality_score=1.0,
        )
        without_raw = _view(1)

        PP2Response(
            item_id="test-id",
            per_view=[with_raw, without_raw],
            verification=_verification(2, {"0-1": {"passed": True}}),
            fused=None,
            stored=False,
            cache_key=None,
        )

    def test_detection_optional_consensus_metadata_is_supported(self):
        with_detection_meta = PP2PerViewResult(
            view_index=0,
            filename="view_0.jpg",
            detection=PP2PerViewDetection(
                bbox=(0, 0, 10, 10),
                cls_name="Wallet",
                confidence=0.9,
                selected_by="consensus_match",
                outlier_view=False,
                candidates=[
                    {
                        "raw_label": "wallet",
                        "canonical_label": "Wallet",
                        "confidence": 0.9,
                        "bbox": (0.0, 0.0, 10.0, 10.0),
                    },
                    {
                        "raw_label": "billfold",
                        "canonical_label": "Wallet",
                        "confidence": 0.7,
                        "bbox": (1.0, 1.0, 9.0, 9.0),
                    },
                ],
            ),
            extraction=PP2PerViewExtraction(caption="sample", ocr_text="", grounded_features={}),
            embedding=PP2PerViewEmbedding(dim=4, vector_preview=[0.1, 0.2, 0.3, 0.4], vector_id="v0"),
            quality_score=1.0,
        )
        without_detection_meta = _view(1)

        PP2Response(
            item_id="test-id",
            per_view=[with_detection_meta, without_detection_meta],
            verification=_verification(2, {"0-1": {"passed": True}}),
            fused=None,
            stored=False,
            cache_key=None,
        )

    def test_verification_accepts_used_and_dropped_views(self):
        PP2Response(
            item_id="test-id",
            per_view=[_view(0), _view(1), _view(2)],
            verification=_verification(
                3,
                {"0-1": {}, "0-2": {}, "1-2": {}},
                used_views=[0, 1],
                dropped_views=[{"view_index": 2, "reason": "not_best_pair_lower_similarity"}],
            ),
            fused=None,
            stored=False,
            cache_key=None,
        )

    def test_verification_rejects_overlap_between_used_and_dropped(self):
        with self.assertRaises(ValidationError):
            PP2Response(
                item_id="test-id",
                per_view=[_view(0), _view(1), _view(2)],
                verification=_verification(
                    3,
                    {"0-1": {}, "0-2": {}, "1-2": {}},
                    used_views=[0, 1],
                    dropped_views=[{"view_index": 1, "reason": "bad"}],
                ),
                fused=None,
                stored=False,
                cache_key=None,
            )

    def test_verification_rejects_out_of_range_dropped_view(self):
        with self.assertRaises(ValidationError):
            PP2Response(
                item_id="test-id",
                per_view=[_view(0), _view(1), _view(2)],
                verification=_verification(
                    3,
                    {"0-1": {}, "0-2": {}, "1-2": {}},
                    used_views=[0, 1],
                    dropped_views=[{"view_index": 4, "reason": "bad"}],
                ),
                fused=None,
                stored=False,
                cache_key=None,
            )


if __name__ == "__main__":
    unittest.main()
