import sys
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock


# Patch service imports before importing MultiViewPipeline to avoid heavy deps in unit tests.
mock_yolo_module = MagicMock()
mock_florence_module = MagicMock()
mock_dino_module = MagicMock()

mock_yolo_module.YoloService = MagicMock()
mock_florence_module.FlorenceService = MagicMock()
mock_dino_module.DINOEmbedder = MagicMock()

patched_modules = {
    "app.services.yolo_service": mock_yolo_module,
    "app.services.florence_service": mock_florence_module,
    "app.services.dino_embedder": mock_dino_module,
}
original_modules = {name: sys.modules.get(name) for name in patched_modules}

for name, module in patched_modules.items():
    sys.modules[name] = module

from app.services.pp2_multiview_pipeline import MultiViewPipeline

# Restore module table so unrelated tests use real implementations.
for name, module in original_modules.items():
    if module is None:
        del sys.modules[name]
    else:
        sys.modules[name] = module


class TestMultiViewPipelineNormalization(unittest.TestCase):
    def setUp(self):
        self.pipeline = MultiViewPipeline(
            yolo=MagicMock(),
            florence=MagicMock(),
            dino=MagicMock(),
            verifier=MagicMock(),
            fusion=MagicMock(),
            faiss=MagicMock(),
        )

    def test_normalize_list_grounded_features(self):
        payload = {
            "caption": "sample",
            "ocr_text": "text",
            "grounded_features": ["logo", 123, None, " "],
            "grounded_defects": ["scratch"],
            "grounded_attachments": ["key ring"],
            "color_vqa": "black",
            "key_count": 2,
        }

        normalized = self.pipeline._normalize_extraction_payload(payload)
        grounded = normalized["grounded_features"]

        self.assertIsInstance(grounded, dict)
        self.assertEqual(grounded["features"], ["logo", "123"])
        self.assertEqual(grounded["defects"], ["scratch"])
        self.assertEqual(grounded["attachments"], ["key ring"])
        self.assertEqual(grounded["color"], "black")
        self.assertEqual(grounded["key_count"], 2)

    def test_normalize_dict_grounded_features_preserves_existing_color(self):
        payload = {
            "caption": "sample",
            "grounded_features": {
                "brand": "Acme",
                "color": "brown",
                "defects": ["scratch"],
            },
            "grounded_defects": ["dent"],
            "grounded_attachments": ["lanyard"],
            "color_vqa": "black",
            "key_count": 1,
        }

        normalized = self.pipeline._normalize_extraction_payload(payload)
        grounded = normalized["grounded_features"]

        self.assertEqual(grounded["brand"], "Acme")
        self.assertEqual(grounded["color"], "brown")
        self.assertEqual(grounded["defects"], ["scratch", "dent"])
        self.assertEqual(grounded["attachments"], ["lanyard"])
        self.assertEqual(grounded["key_count"], 1)

    def test_normalize_invalid_grounded_features_fallback(self):
        payload = {
            "caption": "sample",
            "grounded_features": "logo",
        }

        normalized = self.pipeline._normalize_extraction_payload(payload)
        grounded = normalized["grounded_features"]

        self.assertIsInstance(grounded, dict)
        self.assertEqual(grounded, {})

    def test_ocr_prefers_ocr_text_over_ocr(self):
        payload = {
            "caption": "sample",
            "ocr_text": "preferred",
            "ocr": "fallback",
            "grounded_features": {},
        }

        normalized = self.pipeline._normalize_extraction_payload(payload)
        self.assertEqual(normalized["ocr_text"], "preferred")

    def test_ocr_fallback_to_ocr_and_list_join(self):
        payload = {
            "caption": "sample",
            "ocr": ["AB", "123"],
            "grounded_features": {},
        }

        normalized = self.pipeline._normalize_extraction_payload(payload)
        self.assertEqual(normalized["ocr_text"], "AB 123")


class TestHintScoringNegativeKeywords(unittest.TestCase):
    """Tests for the negative-keyword penalty in _infer_canonical_hint_with_signals."""

    def setUp(self):
        self.pipeline = MultiViewPipeline(
            yolo=MagicMock(),
            florence=MagicMock(),
            dino=MagicMock(),
            verifier=MagicMock(),
            fusion=MagicMock(),
            faiss=MagicMock(),
        )

    def test_helmet_beats_smartphone_with_hallucinated_features(self):
        """Exact scenario from the bug: caption says 'helmet', OCR says 'HELMET',
        but grounding hallucinates smartphone features (camera, home button, screen).
        With negative keywords + reduced feature weight, Helmet should win."""
        hint, signals = self.pipeline._infer_canonical_hint_with_signals(
            caption="The helmet has a screw attached on the right side and surface scratches",
            ocr_text="H.H.CO . HELMET . 2024 . SAFETY FIRST",
            grounded_features={
                "features": ["camera module", "home button"],
                "defects": ["screen scratches"],
            },
        )
        self.assertEqual(hint, "Helmet")
        self.assertTrue(signals["caption_hit"])
        self.assertTrue(signals["ocr_hit"])

    def test_smartphone_negative_penalty_from_helmet_caption(self):
        """When caption contains 'helmet', Smart Phone score gets penalized via
        its negative keyword list (which now includes 'helmet')."""
        hint, signals = self.pipeline._infer_canonical_hint_with_signals(
            caption="a blue helmet on a table",
            ocr_text="",
            grounded_features={},
        )
        # 'helmet' in caption → Helmet gets +1, Smart Phone gets negative penalty
        self.assertEqual(hint, "Helmet")

    def test_smartphone_wins_when_evidence_is_genuine(self):
        """Smart Phone should still win when evidence genuinely points to a phone."""
        hint, signals = self.pipeline._infer_canonical_hint_with_signals(
            caption="a black smartphone with a cracked screen",
            ocr_text="SAMSUNG GALAXY",
            grounded_features={"features": ["camera module", "home button"]},
        )
        self.assertEqual(hint, "Smart Phone")
        self.assertTrue(signals["caption_hit"])

    def test_feature_weight_reduced(self):
        """Feature-only evidence should not overpower caption evidence
        because feature weight is now 1 (not 2)."""
        hint, _ = self.pipeline._infer_canonical_hint_with_signals(
            caption="a helmet on a shelf",
            ocr_text="",
            grounded_features={"features": ["camera module", "home button", "screen"]},
        )
        # caption: helmet=+1; features: phone-related keywords score at weight 1 each
        # But Smart Phone now has negative penalty from "helmet" in caption (-2)
        self.assertEqual(hint, "Helmet")

    def test_no_evidence_returns_none(self):
        """When there's no recognizable evidence, hint should be None."""
        hint, signals = self.pipeline._infer_canonical_hint_with_signals(
            caption="a random object on a desk",
            ocr_text="",
            grounded_features={},
        )
        self.assertIsNone(hint)
        self.assertFalse(signals["caption_hit"])

    def test_hard_hat_triggers_helmet_hint(self):
        """Caption 'hard hat' should produce a Helmet hint now that
        'hard hat' is in CATEGORY_KEYWORDS["Helmet"]."""
        hint, signals = self.pipeline._infer_canonical_hint_with_signals(
            caption="A blue hard hat with the name Allianz on it",
            ocr_text="",
            grounded_features={},
        )
        self.assertEqual(hint, "Helmet")
        self.assertTrue(signals["caption_hit"])

    def test_safety_helmet_triggers_helmet_hint(self):
        """'safety helmet' alias should also produce a Helmet hint."""
        hint, signals = self.pipeline._infer_canonical_hint_with_signals(
            caption="a yellow safety helmet on a table",
            ocr_text="",
            grounded_features={},
        )
        self.assertEqual(hint, "Helmet")

    def test_hat_negative_no_longer_blocks_hard_hat(self):
        """The generic 'hat' negative keyword was replaced with specific
        hat variants, so 'hard hat' should NOT receive a negative penalty."""
        hint, signals = self.pipeline._infer_canonical_hint_with_signals(
            caption="a blue hard hat on a shelf",
            ocr_text="HELMET SAFETY FIRST",
            grounded_features={},
        )
        self.assertEqual(hint, "Helmet")
        self.assertTrue(signals["ocr_hit"])


class TestHintStrongOverrideBroadened(unittest.TestCase):
    """Verify that hint_strong_override fires regardless of YOLO fallback strategy."""

    def setUp(self):
        self.pipeline = MultiViewPipeline(
            yolo=MagicMock(),
            florence=MagicMock(),
            dino=MagicMock(),
            verifier=MagicMock(),
            fusion=MagicMock(),
            faiss=MagicMock(),
        )

    def test_dual_signal_overrides_non_strict_majority(self):
        """When YOLO gives a non-strict-majority result but one view has
        both caption AND OCR for a different label, hint_strong_override
        should fire (previously required strict_majority)."""
        # 2 views: YOLO says Earbuds for view0, Smart Phone for view1
        per_view_detections = [
            [SimpleNamespace(label="Earbuds - Earbuds case", confidence=0.97)],
            [SimpleNamespace(label="Smart Phone", confidence=0.94)],
        ]
        # View 0 has Helmet hint with both caption and OCR signals
        canonical_hints = ["Helmet", None]
        hint_signals = [
            {"caption_hit": True, "ocr_hit": True, "feature_hit": False},
            {"caption_hit": False, "ocr_hit": False, "feature_hit": False},
        ]
        label, strategy, votes = self.pipeline._choose_consensus_label_with_hints(
            per_view_detections, canonical_hints, hint_signals,
        )
        self.assertEqual(label, "Helmet")
        self.assertEqual(strategy, "hint_strong_override")

    def test_dual_signal_overrides_strict_majority(self):
        """Original behaviour preserved: hint_strong_override still fires
        when YOLO has strict_majority."""
        per_view_detections = [
            [SimpleNamespace(label="Earbuds - Earbuds case", confidence=0.97)],
            [SimpleNamespace(label="Earbuds - Earbuds case", confidence=0.90)],
        ]
        canonical_hints = ["Helmet", None]
        hint_signals = [
            {"caption_hit": True, "ocr_hit": True, "feature_hit": False},
            {"caption_hit": False, "ocr_hit": False, "feature_hit": False},
        ]
        label, strategy, votes = self.pipeline._choose_consensus_label_with_hints(
            per_view_detections, canonical_hints, hint_signals,
        )
        self.assertEqual(label, "Helmet")
        self.assertEqual(strategy, "hint_strong_override")


class TestWeakTextEvidenceEmptyCaption(unittest.TestCase):
    """Fix 1: empty caption should always count as weak,
    regardless of OCR content."""

    def setUp(self):
        self.pipeline = MultiViewPipeline(
            yolo=MagicMock(),
            florence=MagicMock(),
            dino=MagicMock(),
            verifier=MagicMock(),
            fusion=MagicMock(),
            faiss=MagicMock(),
        )

    def test_empty_caption_rich_ocr_is_weak(self):
        """Empty caption + multi-char OCR (brand name) must be weak."""
        result = MultiViewPipeline._is_weak_text_evidence("", "Baeleberry")
        self.assertTrue(result)

    def test_empty_caption_empty_ocr_is_weak(self):
        result = MultiViewPipeline._is_weak_text_evidence("", "")
        self.assertTrue(result)

    def test_empty_caption_single_char_ocr_is_weak(self):
        result = MultiViewPipeline._is_weak_text_evidence("", "0")
        self.assertTrue(result)

    def test_nonempty_caption_rich_ocr_not_weak(self):
        """When caption has enough words AND OCR is rich, not weak."""
        result = MultiViewPipeline._is_weak_text_evidence(
            "A black leather wallet sitting on a table", "Baeleberry"
        )
        self.assertFalse(result)

    def test_short_caption_weak_ocr_still_weak(self):
        """Short caption (below threshold) + weak OCR = still weak."""
        result = MultiViewPipeline._is_weak_text_evidence("wallet", "")
        self.assertTrue(result)


class TestOCRSubstringFallback(unittest.TestCase):
    """Tests for the OCR substring fallback in _infer_canonical_hint_with_signals.
    When word-boundary regex fails (OCR concatenation), a plain substring
    check is used for keywords >= 3 chars."""

    def setUp(self):
        self.pipeline = MultiViewPipeline(
            yolo=MagicMock(),
            florence=MagicMock(),
            dino=MagicMock(),
            verifier=MagicMock(),
            fusion=MagicMock(),
            faiss=MagicMock(),
        )

    def test_student_id_from_concatenated_ocr(self):
        """OCR 'FutureSTUDENT IDDANANJAYA' has 'student id' concatenated —
        word boundary fails but substring fallback should match."""
        hint, signals = self.pipeline._infer_canonical_hint_with_signals(
            caption="",
            ocr_text="FutureSTUDENT IDDANANJAYA",
            grounded_features={},
        )
        self.assertEqual(hint, "Student ID")
        self.assertTrue(signals["ocr_hit"])

    def test_nic_from_concatenated_ocr(self):
        """OCR '00NIC No' has 'nic' concatenated with digits —
        substring fallback should match."""
        hint, signals = self.pipeline._infer_canonical_hint_with_signals(
            caption="",
            ocr_text="00NIC No",
            grounded_features={},
        )
        self.assertEqual(hint, "Student ID")
        self.assertTrue(signals["ocr_hit"])

    def test_identity_card_from_concatenated_ocr(self):
        """OCR 'NATIONAL IDENTITY CARDcoma' has concatenated 'card' —
        substring should still match 'identity card'."""
        hint, signals = self.pipeline._infer_canonical_hint_with_signals(
            caption="",
            ocr_text="NATIONAL IDENTITY CARDcoma",
            grounded_features={},
        )
        self.assertEqual(hint, "Student ID")
        self.assertTrue(signals["ocr_hit"])

    def test_short_keyword_not_substring_matched(self):
        """Keywords shorter than 3 chars should NOT use substring fallback
        to avoid false positives."""
        # "id" is only 2 chars — should not trigger substring fallback
        hint, _ = self.pipeline._infer_canonical_hint_with_signals(
            caption="",
            ocr_text="ABIDEFG",
            grounded_features={},
        )
        # Should not match Student ID from "id" substring in "ABIDEFG"
        self.assertNotEqual(hint, "Student ID")

    def test_word_boundary_still_preferred(self):
        """When word-boundary regex matches, it should still work correctly."""
        hint, signals = self.pipeline._infer_canonical_hint_with_signals(
            caption="",
            ocr_text="STUDENT ID 2024",
            grounded_features={},
        )
        self.assertEqual(hint, "Student ID")
        self.assertTrue(signals["ocr_hit"])


class TestHintOverrideNoConsensus(unittest.TestCase):
    """Tests for hint_override firing when YOLO has no_consensus
    (all detections below confidence floor)."""

    def setUp(self):
        self.pipeline = MultiViewPipeline(
            yolo=MagicMock(),
            florence=MagicMock(),
            dino=MagicMock(),
            verifier=MagicMock(),
            fusion=MagicMock(),
            faiss=MagicMock(),
        )

    def test_hint_override_with_no_consensus(self):
        """When YOLO returns no viable detections (no_consensus) but
        Florence hints exist, hint_override should fire."""
        # Empty per_view_detections → _choose_consensus_label returns (None, "no_consensus")
        per_view_detections = [[], []]
        canonical_hints = ["Student ID", None]
        hint_signals = [
            {"caption_hit": True, "ocr_hit": False, "feature_hit": False},
            {"caption_hit": False, "ocr_hit": False, "feature_hit": False},
        ]
        label, strategy, votes = self.pipeline._choose_consensus_label_with_hints(
            per_view_detections, canonical_hints, hint_signals,
        )
        self.assertEqual(label, "Student ID")
        self.assertEqual(strategy, "hint_override")

    def test_hint_override_with_no_consensus_multiple_hints(self):
        """When both views have the same hint and no YOLO detections,
        hint_majority should fire (>= 2 votes)."""
        per_view_detections = [[], []]
        canonical_hints = ["Student ID", "Student ID"]
        hint_signals = [
            {"caption_hit": True, "ocr_hit": True, "feature_hit": False},
            {"caption_hit": True, "ocr_hit": True, "feature_hit": False},
        ]
        label, strategy, votes = self.pipeline._choose_consensus_label_with_hints(
            per_view_detections, canonical_hints, hint_signals,
        )
        self.assertEqual(label, "Student ID")
        self.assertEqual(strategy, "hint_majority")

    def test_coverage_conf_fallback_still_allows_override(self):
        """The existing coverage_conf_fallback hint_override path
        must still work after the change."""
        per_view_detections = [
            [SimpleNamespace(label="Wallet", confidence=0.50)],
            [SimpleNamespace(label="Smart Phone", confidence=0.45)],
        ]
        canonical_hints = ["Student ID", None]
        hint_signals = [
            {"caption_hit": True, "ocr_hit": False, "feature_hit": False},
            {"caption_hit": False, "ocr_hit": False, "feature_hit": False},
        ]
        label, strategy, votes = self.pipeline._choose_consensus_label_with_hints(
            per_view_detections, canonical_hints, hint_signals,
        )
        self.assertEqual(label, "Student ID")
        self.assertEqual(strategy, "hint_override")

    def test_strict_majority_blocks_single_hint_override(self):
        """When YOLO has strict_majority, a single hint without dual
        caption+ocr signals should NOT override (only hint_strong_override
        or hint_majority can override strict_majority)."""
        per_view_detections = [
            [SimpleNamespace(label="Wallet", confidence=0.90)],
            [SimpleNamespace(label="Wallet", confidence=0.85)],
        ]
        canonical_hints = ["Student ID", None]
        hint_signals = [
            {"caption_hit": True, "ocr_hit": False, "feature_hit": False},
            {"caption_hit": False, "ocr_hit": False, "feature_hit": False},
        ]
        label, strategy, votes = self.pipeline._choose_consensus_label_with_hints(
            per_view_detections, canonical_hints, hint_signals,
        )
        # Single caption-only hint should not override strict_majority
        self.assertEqual(label, "Wallet")
        self.assertEqual(strategy, "strict_majority")


class TestHintTiebreakWithYOLOMatch(unittest.TestCase):
    """Tests for hint_tiebreak when hint matches a YOLO detection."""

    def setUp(self):
        self.pipeline = MultiViewPipeline(
            yolo=MagicMock(),
            florence=MagicMock(),
            dino=MagicMock(),
            verifier=MagicMock(),
            fusion=MagicMock(),
            faiss=MagicMock(),
        )

    def test_hint_tiebreak_when_hint_in_yolo_detections(self):
        """When YOLO has no strict majority but the hint label appears
        among YOLO detections, hint_tiebreak should fire."""
        per_view_detections = [
            [SimpleNamespace(label="Helmet", confidence=0.60)],
            [SimpleNamespace(label="Smart Phone", confidence=0.70)],
        ]
        canonical_hints = ["Helmet", None]
        hint_signals = [
            {"caption_hit": True, "ocr_hit": False, "feature_hit": False},
            {"caption_hit": False, "ocr_hit": False, "feature_hit": False},
        ]
        label, strategy, votes = self.pipeline._choose_consensus_label_with_hints(
            per_view_detections, canonical_hints, hint_signals,
        )
        self.assertEqual(label, "Helmet")
        self.assertEqual(strategy, "hint_tiebreak")


class TestODCaptionAdoptedRefinement(unittest.TestCase):
    """When OD caption is adopted (original extraction had empty caption),
    _needs_pass_caption_refinement should still treat the view as weak
    so Stage 2 detail runs."""

    def setUp(self):
        self.pipeline = MultiViewPipeline(
            yolo=MagicMock(),
            florence=MagicMock(),
            dino=MagicMock(),
            verifier=MagicMock(),
            fusion=MagicMock(),
            faiss=MagicMock(),
        )

    @staticmethod
    def _make_view(caption: str, ocr: str, raw: dict = None) -> SimpleNamespace:
        extraction = SimpleNamespace(
            caption=caption,
            ocr_text=ocr,
            grounded_features={},
            raw=raw or {},
        )
        return SimpleNamespace(extraction=extraction)

    def test_od_adopted_view_treated_as_weak(self):
        """View with OD-adopted caption should be treated as weak
        even though the current caption is rich."""
        views = [
            self._make_view("", "", raw={}),  # View 0: genuinely empty
            self._make_view(
                "A black leather wallet sitting on a brown table",
                "Baeleberry",
                raw={"od_caption_adopted": True},
            ),  # View 1: rich caption but was adopted from OD
        ]
        result = self.pipeline._needs_pass_caption_refinement(views, [0, 1])
        self.assertTrue(result, "Both views should be considered weak — Stage 2 should run")

    def test_genuine_rich_caption_blocks_refinement(self):
        """View with genuine (non-adopted) rich caption should block refinement."""
        views = [
            self._make_view("", "", raw={}),
            self._make_view(
                "A black leather wallet sitting on a brown table",
                "Baeleberry",
                raw={},  # No od_caption_adopted flag
            ),
        ]
        result = self.pipeline._needs_pass_caption_refinement(views, [0, 1])
        self.assertFalse(result, "Genuine rich caption should block Stage 2")

    def test_all_od_adopted_triggers_refinement(self):
        """When ALL views have OD-adopted captions, refinement should trigger."""
        views = [
            self._make_view("A wallet on a desk", "Brand", raw={"od_caption_adopted": True}),
            self._make_view("A leather wallet", "Logo", raw={"od_caption_adopted": True}),
        ]
        result = self.pipeline._needs_pass_caption_refinement(views, [0, 1])
        self.assertTrue(result)

    def test_mixed_od_adopted_and_genuine_weak(self):
        """OD-adopted view + genuinely weak view → all weak → refinement triggers."""
        views = [
            self._make_view("wallet", "", raw={}),  # genuinely weak (short caption, no OCR)
            self._make_view("A big item on a table", "X", raw={"od_caption_adopted": True}),
        ]
        result = self.pipeline._needs_pass_caption_refinement(views, [0, 1])
        self.assertTrue(result)


if __name__ == "__main__":
    unittest.main()
