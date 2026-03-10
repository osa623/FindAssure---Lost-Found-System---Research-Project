import unittest
import numpy as np

from app.schemas.pp2_schemas import (
    PP2PerViewResult,
    PP2PerViewDetection,
    PP2PerViewExtraction,
    PP2PerViewEmbedding,
)
from app.services.pp2_fusion_service import MultiViewFusionService


def _view_result(
    view_index: int,
    ocr_text: str,
    quality_score: float,
    confidence: float,
    cls_name: str = "Wallet",
    grounded_features=None,
    caption: str = None,
    detailed_description: str = None,
) -> PP2PerViewResult:
    if grounded_features is None:
        grounded_features = {"color": "black"}
    return PP2PerViewResult(
        view_index=view_index,
        filename=f"view_{view_index}.jpg",
        detection=PP2PerViewDetection(
            bbox=(0.0, 0.0, 10.0, 10.0),
            cls_name=cls_name,
            confidence=confidence,
        ),
        extraction=PP2PerViewExtraction(
            caption=caption if caption is not None else f"caption_{view_index}",
            detailed_description=detailed_description,
            ocr_text=ocr_text,
            grounded_features=grounded_features,
            extraction_confidence=1.0,
        ),
        embedding=PP2PerViewEmbedding(
            dim=16,
            vector_preview=[0.1] * 8,
            vector_id=f"vec_{view_index}",
        ),
        quality_score=quality_score,
    )


class TestPP2FusionOCRCleaning(unittest.TestCase):
    def setUp(self):
        self.service = MultiViewFusionService()
        self.vectors = [np.array([1.0, 0.0]), np.array([1.0, 0.0]), np.array([1.0, 0.0])]
        self.item_id = "item-123"

    def test_compute_fused_vector_returns_unit_norm(self):
        vectors = [
            np.array([1.0, 2.0, 3.0], dtype=np.float32),
            np.array([2.0, 1.0, 0.5], dtype=np.float32),
            np.array([0.5, 1.5, 2.5], dtype=np.float32),
        ]
        fused = self.service.compute_fused_vector(vectors)
        self.assertEqual(fused.dtype, np.float32)
        self.assertAlmostEqual(float(np.linalg.norm(fused)), 1.0, places=6)

    def test_compute_fused_vector_matches_expected_for_normalized_inputs(self):
        vectors = [
            np.array([1.0, 0.0], dtype=np.float32),
            np.array([0.0, 1.0], dtype=np.float32),
            np.array([1.0, 1.0], dtype=np.float32) / np.sqrt(2.0),
        ]
        expected = np.mean(np.stack(vectors, axis=0), axis=0)
        expected = expected / (np.linalg.norm(expected) + 1e-9)
        fused = self.service.compute_fused_vector(vectors)
        np.testing.assert_allclose(fused, expected.astype(np.float32), rtol=1e-6, atol=1e-6)

    def test_drop_urls_keep_stable_brand_tokens(self):
        per_view = [
            _view_result(0, "BAELLERRY WWW.MAINEMEMORY.NET", quality_score=0.95, confidence=0.90),
            _view_result(1, "BAELLERRY HTTPS://EXAMPLE.COM", quality_score=0.85, confidence=0.89),
            _view_result(2, "LARELLERRY", quality_score=0.80, confidence=0.88),
        ]

        fused = self.service.fuse(per_view, self.vectors, item_id=self.item_id)

        self.assertIn("BAELLERRY", fused.merged_ocr_tokens)
        self.assertNotIn("WWW.MAINEMEMORY.NET", fused.merged_ocr_tokens)
        self.assertNotIn("HTTPS://EXAMPLE.COM", fused.merged_ocr_tokens)
        self.assertIn("WWW.MAINEMEMORY.NET", fused.attributes["ocr_rejected"])
        self.assertIn("HTTPS://EXAMPLE.COM", fused.attributes["ocr_rejected"])
        self.assertEqual(fused.fused_embedding_id, f"{self.item_id}_fused")

    def test_split_composite_tokens_and_keep_brand_like_parts(self):
        per_view = [
            _view_result(0, "BAELLERRY/LARELLERRY-ish", quality_score=0.95, confidence=0.95),
            _view_result(1, "BAELLERRY", quality_score=0.90, confidence=0.94),
            _view_result(2, "RANDOM", quality_score=0.85, confidence=0.93),
        ]

        fused = self.service.fuse(per_view, self.vectors, item_id=self.item_id)

        self.assertIn("BAELLERRY", fused.merged_ocr_tokens)
        self.assertIn("LARELLERRY", fused.merged_ocr_tokens)  # best-view brand-like singleton keep
        self.assertNotIn("ISH", fused.merged_ocr_tokens)  # short fragment is not retained in final merged list

    def test_reject_high_non_letter_ratio_token(self):
        per_view = [
            _view_result(0, "A1B2C3!!!", quality_score=0.95, confidence=0.95),
            _view_result(1, "BRANDX", quality_score=0.90, confidence=0.90),
            _view_result(2, "BRANDX", quality_score=0.85, confidence=0.85),
        ]

        fused = self.service.fuse(per_view, self.vectors, item_id=self.item_id)

        self.assertNotIn("A1B2C3", fused.merged_ocr_tokens)
        self.assertIn("A1B2C3", fused.attributes["ocr_rejected"])
        self.assertIn("BRANDX", fused.merged_ocr_tokens)

    def test_best_view_singleton_brand_like_is_kept(self):
        per_view = [
            _view_result(0, "LARELLERRY", quality_score=0.99, confidence=0.99),
            _view_result(1, "NOISE", quality_score=0.80, confidence=0.80),
            _view_result(2, "OTHER", quality_score=0.70, confidence=0.70),
        ]

        fused = self.service.fuse(per_view, self.vectors, item_id=self.item_id)
        self.assertIn("LARELLERRY", fused.merged_ocr_tokens)

    def test_ocr_rejected_always_present_and_sorted(self):
        per_view = [
            _view_result(0, "HTTPS://SITE.COM", quality_score=0.90, confidence=0.90),
            _view_result(1, "A1B2C3!!!", quality_score=0.89, confidence=0.89),
            _view_result(2, "BRAND BRAND", quality_score=0.88, confidence=0.88),
        ]

        fused = self.service.fuse(per_view, self.vectors, item_id=self.item_id)
        self.assertIn("ocr_rejected", fused.attributes)
        self.assertEqual(fused.attributes["ocr_rejected"], sorted(fused.attributes["ocr_rejected"]))

    def test_cluster_tokens_fuzzy_merges_near_match_brand_variants(self):
        clusters = self.service._cluster_tokens_fuzzy(
            tokens_per_view=[[], ["LISELLEERRY"], ["HALLEBERRY"]],
            threshold=0.82,
        )

        self.assertEqual(len(clusters), 1)
        self.assertCountEqual(clusters[0], ["LISELLEERRY", "HALLEBERRY"])

    def test_fuse_keeps_non_empty_ocr_for_near_match_cluster(self):
        per_view = [
            _view_result(0, "-", quality_score=0.99, confidence=0.99),
            _view_result(1, "LISELLEERRY", quality_score=0.90, confidence=0.90),
            _view_result(2, "HALLEBERRY", quality_score=0.89, confidence=0.89),
        ]

        fused = self.service.fuse(per_view, self.vectors, item_id=self.item_id)
        self.assertEqual(fused.merged_ocr_tokens, ["LISELLEERRY"])

    def test_url_like_tokens_remain_rejected_under_fuzzy_merge(self):
        per_view = [
            _view_result(0, "WWW.EXAMPLE.COM", quality_score=0.95, confidence=0.95),
            _view_result(1, "WWW.EXAMPLE.COM", quality_score=0.90, confidence=0.90),
            _view_result(2, "-", quality_score=0.85, confidence=0.85),
        ]

        fused = self.service.fuse(per_view, self.vectors, item_id=self.item_id)

        self.assertEqual(fused.merged_ocr_tokens, [])
        self.assertIn("WWW.EXAMPLE.COM", fused.attributes["ocr_rejected"])

    def test_two_supported_brand_clusters_return_two_tokens_max(self):
        per_view = [
            _view_result(0, "BRANDX MEGACO", quality_score=0.98, confidence=0.98),
            _view_result(1, "BRANDX", quality_score=0.90, confidence=0.90),
            _view_result(2, "MEGACO", quality_score=0.89, confidence=0.89),
        ]

        fused = self.service.fuse(per_view, self.vectors, item_id=self.item_id)

        self.assertEqual(len(fused.merged_ocr_tokens), 2)
        self.assertCountEqual(fused.merged_ocr_tokens, ["BRANDX", "MEGACO"])

    def test_student_id_bypasses_ocr_cleaning_filters(self):
        per_view = [
            _view_result(0, "199912345678 NIC-7788", quality_score=0.98, confidence=0.98, cls_name="Student ID"),
            _view_result(1, "199912345678 NIC-7788", quality_score=0.95, confidence=0.95, cls_name="Student ID"),
            _view_result(2, "199912345678", quality_score=0.90, confidence=0.90, cls_name="Student ID"),
        ]

        fused = self.service.fuse(per_view, self.vectors, item_id=self.item_id)

        self.assertIn("199912345678", fused.merged_ocr_tokens)
        self.assertIn("NIC-7788", fused.merged_ocr_tokens)
        self.assertNotIn("NIC-7788", fused.attributes["ocr_rejected"])

    def test_excludes_outlier_view_category_specific_fields(self):
        per_view = [
            _view_result(
                0,
                "WALLET",
                quality_score=0.95,
                confidence=0.98,
                cls_name="Wallet",
                grounded_features={
                    "color": "black",
                    "defects": ["scratch"],
                    "features": "zipper",
                    "attachments": "strap",
                },
                caption="wallet front",
            ),
            _view_result(
                1,
                "WALLET",
                quality_score=0.93,
                confidence=0.97,
                cls_name="Wallet",
                grounded_features={
                    "color": "black",
                    "defects": ["scuff"],
                    "features": "logo",
                    "attachments": "chain",
                },
                caption="wallet side",
            ),
            _view_result(
                2,
                "KEY",
                quality_score=0.85,
                confidence=0.96,
                cls_name="Key",
                grounded_features={
                    "color": "silver",
                    "defects": ["bent key"],
                    "features": "teeth",
                    "attachments": "ring",
                },
                caption="key outlier",
            ),
        ]

        view_meta_by_index = {
            0: {"final_label": "Wallet", "label_outlier": False},
            1: {"final_label": "Wallet", "label_outlier": False},
            2: {"final_label": "Key", "label_outlier": True},
        }

        fused = self.service.fuse(per_view, self.vectors, item_id=self.item_id, view_meta_by_index=view_meta_by_index)

        self.assertEqual(fused.category, "Wallet")
        self.assertNotIn("bent key", fused.defects)
        self.assertNotIn("scratch", fused.defects)
        self.assertNotIn("teeth", str(fused.attributes.get("features", "")))
        self.assertNotIn("ring", str(fused.attributes.get("attachments", "")))
        self.assertIn("view_2", fused.attributes["captions"])
        self.assertIn("category_specific_exclusions", fused.attributes["conflicts"])

    def test_excludes_label_mismatch_without_outlier_flag(self):
        per_view = [
            _view_result(
                0,
                "WALLET",
                quality_score=0.97,
                confidence=0.99,
                cls_name="Wallet",
                grounded_features={"color": "black", "defects": ["corner wear"]},
            ),
            _view_result(
                1,
                "WALLET",
                quality_score=0.90,
                confidence=0.95,
                cls_name="Wallet",
                grounded_features={"color": "black", "defects": ["scratch"]},
            ),
            _view_result(
                2,
                "KEY",
                quality_score=0.88,
                confidence=0.94,
                cls_name="Key",
                grounded_features={"color": "silver", "defects": ["bent key"]},
            ),
        ]

        view_meta_by_index = {
            0: {"final_label": "Wallet", "label_outlier": False},
            1: {"final_label": "Wallet", "label_outlier": False},
            2: {"final_label": "Key", "label_outlier": False},
        }

        fused = self.service.fuse(per_view, self.vectors, item_id=self.item_id, view_meta_by_index=view_meta_by_index)
        self.assertNotIn("bent key", fused.defects)
        self.assertIn("category_specific_exclusions", fused.attributes["conflicts"])

    def test_no_exclusion_note_when_all_views_aligned(self):
        per_view = [
            _view_result(
                0,
                "WALLET",
                quality_score=0.93,
                confidence=0.95,
                cls_name="Wallet",
                grounded_features={"color": "black", "defects": ["scratch"]},
            ),
            _view_result(
                1,
                "WALLET",
                quality_score=0.92,
                confidence=0.94,
                cls_name="Wallet",
                grounded_features={"color": "black", "defects": ["scuff"]},
            ),
            _view_result(
                2,
                "WALLET",
                quality_score=0.91,
                confidence=0.93,
                cls_name="Wallet",
                grounded_features={"color": "black", "defects": ["dent"]},
            ),
        ]
        view_meta_by_index = {
            0: {"final_label": "Wallet", "label_outlier": False},
            1: {"final_label": "Wallet", "label_outlier": False},
            2: {"final_label": "Wallet", "label_outlier": False},
        }

        fused = self.service.fuse(per_view, self.vectors, item_id=self.item_id, view_meta_by_index=view_meta_by_index)
        self.assertNotIn("category_specific_exclusions", fused.attributes["conflicts"])

    def test_backward_compat_without_view_meta(self):
        per_view = [
            _view_result(0, "WALLET", quality_score=0.93, confidence=0.95, cls_name="Wallet"),
            _view_result(1, "WALLET", quality_score=0.92, confidence=0.94, cls_name="Wallet"),
            _view_result(2, "WALLET", quality_score=0.91, confidence=0.93, cls_name="Wallet"),
        ]

        fused = self.service.fuse(per_view, self.vectors, item_id=self.item_id)
        self.assertEqual(fused.category, "Wallet")
        self.assertIsInstance(fused.merged_ocr_tokens, list)

    def test_conservative_caption_blocks_hallucinated_best_view_terms(self):
        per_view = [
            _view_result(
                0,
                "WALLET",
                quality_score=0.99,
                confidence=0.99,
                cls_name="Wallet",
                grounded_features={"color": "black", "defects": ["scratch"]},
                caption="A black wallet with zipper and cord",
            ),
            _view_result(
                1,
                "BRANDX",
                quality_score=0.90,
                confidence=0.95,
                cls_name="Wallet",
                grounded_features={
                    "color": "black",
                    "features": ["logo", "strap"],
                },
                caption="wallet side",
            ),
            _view_result(
                2,
                "WALLET",
                quality_score=0.89,
                confidence=0.94,
                cls_name="Wallet",
                grounded_features={"color": "black"},
                caption="wallet back",
            ),
        ]

        fused = self.service.fuse(per_view, self.vectors, item_id=self.item_id)

        self.assertNotIn("zipper", fused.caption.lower())
        self.assertIn("black wallet", fused.caption.lower())
        self.assertIn("logo", fused.caption.lower())
        self.assertIn("strap", fused.caption.lower())
        self.assertIn("view_0", fused.attributes["captions"])
        self.assertIn("zipper", fused.attributes["captions"]["view_0"].lower())

    def test_balanced_snippet_enrichment_when_conservative_evidence_is_sparse(self):
        per_view = [
            _view_result(
                0,
                "BAELEBERRY",
                quality_score=0.99,
                confidence=0.99,
                cls_name="Wallet",
                grounded_features={"color": "black"},
                caption="A black wallet with a stitched rectangular logo on the front panel.",
            ),
            _view_result(
                1,
                "0",
                quality_score=0.92,
                confidence=0.95,
                cls_name="Wallet",
                grounded_features={"color": "black"},
                caption="",
            ),
        ]

        fused = self.service.fuse(per_view, self.vectors[:2], item_id=self.item_id, used_view_indices=[0, 1])

        self.assertIn("It has a stitched rectangular logo on the front panel.", fused.caption)
        self.assertEqual(fused.attributes.get("caption_enrichment_mode"), "conservative_plus_caption_snippet")
        snippets_used = fused.attributes.get("caption_snippets_used", [])
        self.assertEqual(len(snippets_used), 1)
        self.assertIn("stitched rectangular logo", snippets_used[0].lower())

    def test_balanced_snippet_enrichment_skips_conflicting_single_view_snippets(self):
        per_view = [
            _view_result(
                0,
                "BRANDX",
                quality_score=0.99,
                confidence=0.99,
                cls_name="Wallet",
                grounded_features={"color": "black"},
                caption="A black wallet with diagonal stitch lines and a side clasp.",
            ),
            _view_result(
                1,
                "BRANDX",
                quality_score=0.98,
                confidence=0.98,
                cls_name="Wallet",
                grounded_features={"color": "black"},
                caption="A smooth wallet with rounded corners and a metal badge.",
            ),
        ]

        fused = self.service.fuse(per_view, self.vectors[:2], item_id=self.item_id, used_view_indices=[0, 1])

        self.assertNotIn("Visible details:", fused.caption)
        self.assertEqual(fused.attributes.get("caption_enrichment_mode"), "conservative_only")
        self.assertEqual(fused.attributes.get("caption_snippets_used"), [])

    def test_caption_prioritizes_used_view_indices_for_evidence(self):
        per_view = [
            _view_result(
                0,
                "R",
                quality_score=0.95,
                confidence=0.98,
                cls_name="Earbuds - Earbuds case",
                grounded_features={"color": "dark gray", "features": ["logo"]},
            ),
            _view_result(
                1,
                "R",
                quality_score=0.94,
                confidence=0.97,
                cls_name="Earbuds - Earbuds case",
                grounded_features={"color": "dark gray", "features": ["indicator light"]},
            ),
            _view_result(
                2,
                "ZIPPER",
                quality_score=0.93,
                confidence=0.96,
                cls_name="Earbuds - Earbuds case",
                grounded_features={"color": "dark gray", "features": ["zipper"]},
            ),
        ]

        fused = self.service.fuse(per_view, self.vectors, item_id=self.item_id, used_view_indices=[0, 1])
        caption_lower = fused.caption.lower()
        self.assertIn("earbuds", caption_lower)
        self.assertIn("logo", caption_lower)
        self.assertIn("indicator light", caption_lower)
        self.assertNotIn("zipper", caption_lower)

    def test_detailed_description_prefers_best_view_detail_over_short_caption(self):
        per_view = [
            _view_result(
                0,
                "BAELLERRY GENUINE LEATHER",
                quality_score=0.99,
                confidence=0.98,
                cls_name="Wallet",
                grounded_features={
                    "color": "brown",
                    "features": ["logo", "coin pouch", "zipper"],
                    "attachments": ["strap attached"],
                    "defects": ["scuff marks"],
                },
                caption="wallet front",
                detailed_description="A brown leather wallet with a front logo, zipper coin pouch, and visible edge wear.",
            ),
            _view_result(
                1,
                "BAELLERRY",
                quality_score=0.95,
                confidence=0.96,
                cls_name="Wallet",
                grounded_features={
                    "color": "brown",
                    "features": ["logo", "coin pouch", "zipper"],
                },
                caption="wallet back",
            ),
        ]

        fused = self.service.fuse(per_view, self.vectors[:2], item_id=self.item_id, used_view_indices=[0, 1])

        self.assertIn("brown leather wallet", fused.detailed_description.lower())
        self.assertIn("zipper coin pouch", fused.detailed_description.lower())
        self.assertIn("baellerry", fused.detailed_description.lower())
        self.assertNotEqual(fused.detailed_description.lower().strip(), "wallet front")

    def test_detailed_description_removes_person_holding_context(self):
        per_view = [
            _view_result(
                0,
                "ACTIVE ENERATION",
                quality_score=0.99,
                confidence=0.98,
                cls_name="Helmet",
                grounded_features={"color": "black", "features": ["clear visor", "logo"]},
                caption="A person is holding a black helmet with a clear visor.",
                detailed_description="A person is holding a black helmet with a clear visor and white writing.",
            ),
            _view_result(
                1,
                "ACTIVE ENERATION",
                quality_score=0.95,
                confidence=0.96,
                cls_name="Helmet",
                grounded_features={"color": "black", "features": ["logo"]},
                caption="The helmet has white writing under the visor.",
            ),
        ]

        fused = self.service.fuse(per_view, self.vectors[:2], item_id=self.item_id, used_view_indices=[0, 1])

        self.assertNotIn("person", fused.detailed_description.lower())
        self.assertNotIn("holding", fused.detailed_description.lower())
        self.assertIn("black helmet", fused.detailed_description.lower())

    def test_multi_angle_fusion_keeps_features_from_other_views(self):
        per_view = [
            _view_result(
                0,
                "BAELLERRY",
                quality_score=0.99,
                confidence=0.98,
                cls_name="Wallet",
                grounded_features={"color": "brown", "features": ["logo", "button clasp"]},
                caption="A brown wallet with a stitched logo and button clasp.",
                detailed_description="A brown leather wallet with a stitched logo on the front.",
            ),
            _view_result(
                1,
                "BAELLERRY",
                quality_score=0.96,
                confidence=0.97,
                cls_name="Wallet",
                grounded_features={"color": "brown", "features": ["coin pouch", "zipper"]},
                caption="The inside view shows a coin pouch and zipper compartment.",
                detailed_description="The inside view shows a coin pouch and zipper compartment.",
            ),
        ]

        fused = self.service.fuse(per_view, self.vectors[:2], item_id=self.item_id, used_view_indices=[0, 1])

        self.assertIn("button clasp", fused.detailed_description.lower())
        self.assertIn("coin pouch", fused.detailed_description.lower())
        self.assertIn("zipper", fused.detailed_description.lower())
        self.assertNotIn("notable details:", fused.detailed_description.lower())
        self.assertNotIn("other angles show", fused.detailed_description.lower())
        self.assertNotIn("visible text reads", fused.detailed_description.lower())
        self.assertNotIn("visible wear includes", fused.detailed_description.lower())

    def test_multi_angle_fusion_keeps_defects_from_other_views(self):
        per_view = [
            _view_result(
                0,
                "BAELLERRY",
                quality_score=0.99,
                confidence=0.98,
                cls_name="Wallet",
                grounded_features={"color": "brown", "features": ["logo"], "defects": ["edge wear"]},
                caption="A brown wallet with a stitched logo.",
                detailed_description="A brown leather wallet with a stitched logo on the front.",
            ),
            _view_result(
                1,
                "BAELLERRY",
                quality_score=0.96,
                confidence=0.97,
                cls_name="Wallet",
                grounded_features={"color": "brown", "defects": ["scuff marks"]},
                caption="The back side has scuff marks near the corner.",
                detailed_description="The back side has scuff marks near the corner.",
            ),
        ]

        fused = self.service.fuse(per_view, self.vectors[:2], item_id=self.item_id, used_view_indices=[0, 1])

        self.assertIn("edge wear", fused.detailed_description.lower())
        self.assertIn("scuff marks", fused.detailed_description.lower())
        self.assertIn("other_angle_defect_fusion", fused.description_filters_applied)

    def test_detailed_description_removes_scene_remnants(self):
        per_view = [
            _view_result(
                0,
                "BAELLERRY",
                quality_score=0.99,
                confidence=0.98,
                cls_name="Wallet",
                grounded_features={"color": "brown", "features": ["logo"]},
                caption="A brown wallet is sitting on a wooden table.",
                detailed_description="A brown leather wallet is sitting on a wooden table with a stitched logo.",
            ),
            _view_result(
                1,
                "BAELLERRY",
                quality_score=0.95,
                confidence=0.96,
                cls_name="Wallet",
                grounded_features={"color": "brown", "features": ["card slots"]},
                caption="The inside view shows card slots.",
                detailed_description="The inside view shows card slots.",
            ),
        ]

        fused = self.service.fuse(per_view, self.vectors[:2], item_id=self.item_id, used_view_indices=[0, 1])

        self.assertNotIn("sitting on", fused.detailed_description.lower())
        self.assertNotIn("is sitting", fused.detailed_description.lower())
        self.assertIn("card slots", fused.detailed_description.lower())

    def test_defect_consensus_excludes_single_view_defect(self):
        per_view = [
            _view_result(
                0,
                "WALLET",
                quality_score=0.95,
                confidence=0.97,
                cls_name="Wallet",
                grounded_features={"color": "black", "defects": ["scratch"]},
            ),
            _view_result(
                1,
                "WALLET",
                quality_score=0.94,
                confidence=0.96,
                cls_name="Wallet",
                grounded_features={"color": "black", "defects": []},
            ),
            _view_result(
                2,
                "WALLET",
                quality_score=0.93,
                confidence=0.95,
                cls_name="Wallet",
                grounded_features={"color": "black", "defects": []},
            ),
        ]

        fused = self.service.fuse(per_view, self.vectors, item_id=self.item_id)
        self.assertNotIn("scratch", fused.defects)

    def test_defect_consensus_includes_two_view_defect(self):
        per_view = [
            _view_result(
                0,
                "WALLET",
                quality_score=0.95,
                confidence=0.97,
                cls_name="Wallet",
                grounded_features={"color": "black", "defects": ["scratch"]},
            ),
            _view_result(
                1,
                "WALLET",
                quality_score=0.94,
                confidence=0.96,
                cls_name="Wallet",
                grounded_features={"color": "black", "defects": ["scratch"]},
            ),
            _view_result(
                2,
                "WALLET",
                quality_score=0.93,
                confidence=0.95,
                cls_name="Wallet",
                grounded_features={"color": "black", "defects": []},
            ),
        ]

        fused = self.service.fuse(per_view, self.vectors, item_id=self.item_id)
        self.assertIn("scratch", fused.defects)

    def test_single_eligible_view_suppresses_defects_with_conflict_note(self):
        per_view = [
            _view_result(
                0,
                "WALLET",
                quality_score=0.96,
                confidence=0.98,
                cls_name="Wallet",
                grounded_features={"color": "black", "defects": ["scratch"]},
            ),
            _view_result(
                1,
                "KEY",
                quality_score=0.90,
                confidence=0.95,
                cls_name="Key",
                grounded_features={"color": "silver", "defects": ["bent key"]},
            ),
            _view_result(
                2,
                "KEY",
                quality_score=0.89,
                confidence=0.94,
                cls_name="Key",
                grounded_features={"color": "silver", "defects": ["broken ring"]},
            ),
        ]
        view_meta_by_index = {
            0: {"final_label": "Wallet", "label_outlier": False},
            1: {"final_label": "Key", "label_outlier": False},
            2: {"final_label": "Key", "label_outlier": True},
        }

        fused = self.service.fuse(per_view, self.vectors, item_id=self.item_id, view_meta_by_index=view_meta_by_index)

        self.assertEqual(fused.defects, [])
        self.assertEqual(
            fused.attributes["conflicts"].get("defects"),
            "Consensus-based; single-view defects suppressed",
        )


class TestCaptionColorFallback(unittest.TestCase):
    """Fix 3: when grounded_features has no color, fusion should
    extract color from caption text."""

    def setUp(self):
        self.service = MultiViewFusionService()
        self.vectors = [np.array([1.0, 0.0]), np.array([1.0, 0.0])]
        self.item_id = "color-fallback-test"

    def test_color_extracted_from_caption_when_grounded_missing(self):
        v0 = _view_result(0, "Baeleberry", 0.9, 0.97, "Wallet",
                          grounded_features={}, caption="A black leather wallet on a table")
        v1 = _view_result(1, "0", 0.8, 0.95, "Wallet",
                          grounded_features={}, caption="")
        per_view = [v0, v1]
        fused = self.service.fuse(per_view, self.vectors, item_id=self.item_id)
        self.assertIsNotNone(fused.color)
        self.assertNotEqual(fused.color, "Unknown")
        self.assertIn("black", fused.color.lower())

    def test_grounded_color_takes_precedence(self):
        v0 = _view_result(0, "text", 0.9, 0.97, "Wallet",
                          grounded_features={"color": "red"}, caption="A black wallet")
        v1 = _view_result(1, "ocr", 0.8, 0.95, "Wallet",
                          grounded_features={"color": "red"}, caption="")
        per_view = [v0, v1]
        fused = self.service.fuse(per_view, self.vectors, item_id=self.item_id)
        self.assertEqual(fused.color.lower(), "red")

    def test_no_color_anywhere_stays_none(self):
        v0 = _view_result(0, "text", 0.9, 0.97, "Wallet",
                          grounded_features={}, caption="A wallet on a table")
        v1 = _view_result(1, "ocr", 0.8, 0.95, "Wallet",
                          grounded_features={}, caption="")
        per_view = [v0, v1]
        fused = self.service.fuse(per_view, self.vectors, item_id=self.item_id)
        # Color may be None or empty — but should not fabricate one
        color = (fused.color or "").strip()
        self.assertIn(color, ["", "Unknown", None])


class TestMultiAngleCaptionFusion(unittest.TestCase):
    """Verify that multi-angle captions from different views are merged
    into the fused detailed_description."""

    def setUp(self):
        self.service = MultiViewFusionService()
        self.vectors = [np.array([1.0, 0.0]), np.array([1.0, 0.0])]
        self.item_id = "multi-angle-test"

    def test_different_angle_captions_merged_into_detailed_description(self):
        """When views describe different aspects (front with logo vs back
        with card slots), the fused detailed_description should contain
        information from both angles."""
        v0 = _view_result(
            0,
            "BAELLERRY",
            quality_score=0.99,
            confidence=0.98,
            cls_name="Wallet",
            grounded_features={"color": "brown", "features": ["logo"]},
            caption="A brown wallet with a stitched rectangular logo on the front panel",
            detailed_description="A brown leather wallet with a stitched rectangular logo on the front panel.",
        )
        v1 = _view_result(
            1,
            "BAELLERRY",
            quality_score=0.90,
            confidence=0.95,
            cls_name="Wallet",
            grounded_features={"color": "brown", "features": ["card slots"]},
            caption="A brown wallet with multiple card slots and a coin pouch on the inside",
            detailed_description="A brown wallet with multiple card slots and a coin pouch on the inside.",
        )
        per_view = [v0, v1]
        fused = self.service.fuse(per_view, self.vectors, item_id=self.item_id, used_view_indices=[0, 1])

        desc_lower = fused.detailed_description.lower()
        # Best-view (v0) content should be in the description
        self.assertIn("logo", desc_lower)
        # Other-view (v1) content should also be merged in
        self.assertIn("card slots", desc_lower)
        # Multi-angle evidence should be tracked
        self.assertIn("multi_angle_views", fused.description_evidence_used.get("detailed", []))
        self.assertEqual(fused.detailed_description_source, "multi_angle_evidence_composer")

    def test_single_view_no_multi_angle_merging(self):
        """With only one scope view, no multi-angle fusion should occur."""
        v0 = _view_result(
            0,
            "BRANDX",
            quality_score=0.99,
            confidence=0.98,
            cls_name="Wallet",
            grounded_features={"color": "black"},
            caption="A black wallet with zipper closure",
            detailed_description="A black wallet with zipper closure.",
        )
        v1 = _view_result(
            1,
            "BRANDX",
            quality_score=0.90,
            confidence=0.95,
            cls_name="Wallet",
            grounded_features={"color": "black"},
            caption="",
        )
        per_view = [v0, v1]
        fused = self.service.fuse(per_view, self.vectors, item_id=self.item_id, used_view_indices=[0, 1])

        # No multi-angle evidence when second view has empty caption
        self.assertEqual(fused.attributes.get("multi_angle_phrases_used", []), [])
        self.assertEqual(fused.detailed_description_source, "best_view_evidence_composer")

    def test_duplicate_angle_info_not_repeated(self):
        """When both views say the same thing, the multi-angle merger should
        not add redundant phrases."""
        v0 = _view_result(
            0,
            "BRAND",
            quality_score=0.99,
            confidence=0.98,
            cls_name="Wallet",
            grounded_features={"color": "black"},
            caption="A black wallet with zipper",
            detailed_description="A black wallet with zipper.",
        )
        v1 = _view_result(
            1,
            "BRAND",
            quality_score=0.90,
            confidence=0.95,
            cls_name="Wallet",
            grounded_features={"color": "black"},
            caption="A black wallet with zipper",
            detailed_description="A black wallet with zipper.",
        )
        per_view = [v0, v1]
        fused = self.service.fuse(per_view, self.vectors, item_id=self.item_id, used_view_indices=[0, 1])

        # Multi-angle phrases should be empty since both views say the same thing
        self.assertEqual(fused.attributes.get("multi_angle_phrases_used", []), [])


class TestBackgroundSuppression(unittest.TestCase):
    """Verify that background/furniture sentences are stripped from the
    detailed description by the enhanced sanitiser."""

    def setUp(self):
        self.service = MultiViewFusionService()
        self.vectors = [np.array([1.0, 0.0]), np.array([1.0, 0.0])]
        self.item_id = "bg-test"

    def test_table_under_object_dropped_from_description(self):
        """The exact user-reported issue: 'a white table under the helmet'
        must NOT appear in the fused detailed_description."""
        per_view = [
            _view_result(
                0,
                "ACTIVE ENERATION",
                quality_score=0.99,
                confidence=0.98,
                cls_name="Helmet",
                grounded_features={"color": "black", "features": ["clear visor"]},
                caption="a black helmet with a clear visor.",
                detailed_description=(
                    "a black helmet with a clear visor. "
                    "The helmet has white writing on it. "
                    "a white table under the helmet."
                ),
            ),
            _view_result(
                1,
                "ACTIVE ENERATION",
                quality_score=0.90,
                confidence=0.95,
                cls_name="Helmet",
                grounded_features={"color": "black", "features": ["logo"]},
                caption="a black helmet with a logo.",
            ),
        ]
        fused = self.service.fuse(
            per_view, self.vectors, item_id=self.item_id, used_view_indices=[0, 1]
        )
        desc = fused.detailed_description.lower()
        self.assertNotIn("table", desc)
        self.assertIn("black helmet", desc)
        self.assertIn("clear visor", desc)

    def test_desk_near_object_dropped(self):
        per_view = [
            _view_result(
                0,
                "",
                quality_score=0.99,
                confidence=0.98,
                cls_name="Wallet",
                grounded_features={"color": "brown", "features": ["logo"]},
                caption="a brown wallet with a logo.",
                detailed_description="a brown wallet with a logo on a wooden desk near the window.",
            ),
            _view_result(
                1, "", quality_score=0.90, confidence=0.95, cls_name="Wallet",
                grounded_features={"color": "brown"},
                caption="a brown wallet.",
            ),
        ]
        fused = self.service.fuse(
            per_view, self.vectors, item_id=self.item_id, used_view_indices=[0, 1]
        )
        desc = fused.detailed_description.lower()
        self.assertNotIn("desk", desc)
        self.assertIn("brown", desc)

    def test_floor_surface_dropped(self):
        per_view = [
            _view_result(
                0,
                "",
                quality_score=0.99,
                confidence=0.98,
                cls_name="Bag",
                grounded_features={"color": "red", "features": ["zipper"]},
                caption="a red bag with a zipper.",
                detailed_description="a red bag with a zipper. a tiled floor beneath the bag.",
            ),
            _view_result(
                1, "", quality_score=0.90, confidence=0.95, cls_name="Bag",
                grounded_features={"color": "red"},
                caption="a red bag.",
            ),
        ]
        fused = self.service.fuse(
            per_view, self.vectors, item_id=self.item_id, used_view_indices=[0, 1]
        )
        desc = fused.detailed_description.lower()
        self.assertNotIn("floor", desc)
        self.assertIn("red", desc)
        self.assertIn("zipper", desc)


class TestColorPrefixInDescription(unittest.TestCase):
    """Verify that the detailed description always opens with the item colour
    when colour is known but absent from the Florence caption."""

    def setUp(self):
        self.service = MultiViewFusionService()
        self.vectors = [np.array([1.0, 0.0]), np.array([1.0, 0.0])]
        self.item_id = "color-test"

    def test_color_prepended_when_missing_from_caption(self):
        per_view = [
            _view_result(
                0,
                "",
                quality_score=0.99,
                confidence=0.98,
                cls_name="Wallet",
                grounded_features={"color": "blue", "features": ["logo"]},
                caption="a small wallet with a stitched logo.",
                detailed_description="A small wallet with a stitched logo.",
            ),
            _view_result(
                1, "", quality_score=0.90, confidence=0.95, cls_name="Wallet",
                grounded_features={"color": "blue"},
                caption="a wallet.",
            ),
        ]
        fused = self.service.fuse(
            per_view, self.vectors, item_id=self.item_id, used_view_indices=[0, 1]
        )
        desc = fused.detailed_description.lower()
        # "blue" must appear because grounded colour is known
        self.assertIn("blue", desc)

    def test_no_prefix_when_color_already_present(self):
        per_view = [
            _view_result(
                0,
                "",
                quality_score=0.99,
                confidence=0.98,
                cls_name="Wallet",
                grounded_features={"color": "brown", "features": ["logo"]},
                caption="a brown wallet with a stitched logo.",
                detailed_description="A brown leather wallet with a stitched logo.",
            ),
            _view_result(
                1, "", quality_score=0.90, confidence=0.95, cls_name="Wallet",
                grounded_features={"color": "brown"},
                caption="a brown wallet.",
            ),
        ]
        fused = self.service.fuse(
            per_view, self.vectors, item_id=self.item_id, used_view_indices=[0, 1]
        )
        desc = fused.detailed_description
        # Should NOT start with a redundant "A brown wallet." prefix
        self.assertFalse(
            desc.lower().startswith("a brown wallet. a brown"),
            f"Redundant colour prefix detected: {desc!r}",
        )


class TestOCRSurfacePhrasing(unittest.TestCase):
    """Verify that OCR text in the detailed description uses the new
    'visible on the surface' phrasing."""

    def setUp(self):
        self.service = MultiViewFusionService()
        self.vectors = [np.array([1.0, 0.0]), np.array([1.0, 0.0])]
        self.item_id = "ocr-phrasing-test"

    def test_ocr_text_uses_surface_phrasing(self):
        per_view = [
            _view_result(
                0,
                "ACTIVE GENERATION",
                quality_score=0.99,
                confidence=0.98,
                cls_name="Helmet",
                grounded_features={"color": "black", "features": ["visor"]},
                caption="a black helmet with a visor.",
                detailed_description="A black helmet with a clear visor.",
            ),
            _view_result(
                1,
                "ACTIVE GENERATION",
                quality_score=0.90,
                confidence=0.95,
                cls_name="Helmet",
                grounded_features={"color": "black"},
                caption="a black helmet.",
            ),
        ]
        fused = self.service.fuse(
            per_view, self.vectors, item_id=self.item_id, used_view_indices=[0, 1]
        )
        desc = fused.detailed_description
        self.assertIn('visible on the surface', desc.lower())
        self.assertNotIn('text on it reads', desc.lower())

    def test_ocr_token_appears_in_description(self):
        per_view = [
            _view_result(
                0,
                "BAELLERRY",
                quality_score=0.99,
                confidence=0.98,
                cls_name="Wallet",
                grounded_features={"color": "brown"},
                caption="a brown wallet.",
                detailed_description="A brown wallet.",
            ),
            _view_result(
                1,
                "BAELLERRY",
                quality_score=0.90,
                confidence=0.95,
                cls_name="Wallet",
                grounded_features={"color": "brown"},
                caption="a brown wallet.",
            ),
        ]
        fused = self.service.fuse(
            per_view, self.vectors, item_id=self.item_id, used_view_indices=[0, 1]
        )
        desc = fused.detailed_description.lower()
        self.assertIn("baellerry", desc)
        self.assertIn("visible on the surface", desc)


if __name__ == "__main__":
    unittest.main()
