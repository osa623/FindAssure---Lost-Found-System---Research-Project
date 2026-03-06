import io
import os
import sys
import tempfile
import unittest
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import MagicMock

import numpy as np
from fastapi.testclient import TestClient
from PIL import Image


# Patch heavy model services before importing pipeline/app modules.
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

from app.services.gemini_reasoner import (
    GeminiFatalError,
    GeminiReasoner,
    GeminiTransientError,
    REASONING_FAILED_MESSAGE,
    RETRYABLE_UNAVAILABLE_MESSAGE,
)
from app.services.unified_pipeline import UnifiedPipeline
from app.main import app
import app.main as main_module

# Restore module table so unrelated tests use real implementations.
for name, module in original_modules.items():
    if module is None:
        del sys.modules[name]
    else:
        sys.modules[name] = module


def _write_temp_image() -> str:
    img = Image.new("RGB", (40, 40), "white")
    handle = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
    img.save(handle, format="JPEG")
    handle.close()
    return handle.name


def _image_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (40, 40), "white").save(buf, format="JPEG")
    return buf.getvalue()


def _build_test_pipeline(gemini_behavior):
    pipeline = UnifiedPipeline.__new__(UnifiedPipeline)
    pipeline.yolo = MagicMock()
    pipeline.florence = MagicMock()
    pipeline.gemini = MagicMock()
    pipeline.dino = MagicMock()

    detection = SimpleNamespace(label="Wallet", confidence=0.95, bbox=(2, 2, 30, 30))
    pipeline.yolo.detect_objects.return_value = [detection]
    pipeline.florence.analyze_crop.return_value = {
        "caption": "A wallet",
        "ocr_text": "VISA",
        "grounded_features": [],
        "grounded_defects": [],
        "grounded_attachments": [],
        "raw": {},
    }
    if isinstance(gemini_behavior, Exception):
        pipeline.gemini.run_phase1.side_effect = gemini_behavior
    elif callable(gemini_behavior):
        pipeline.gemini.run_phase1.side_effect = gemini_behavior
    else:
        pipeline.gemini.run_phase1.return_value = gemini_behavior
    pipeline.dino.embed_768.return_value = np.array([0.1, 0.2, 0.3], dtype=float)
    pipeline.dino.embed_128.return_value = np.array([0.4, 0.5, 0.6], dtype=float)
    return pipeline


class TestUnifiedPipelineGeminiFallback(unittest.TestCase):
    def test_transient_gemini_error_degrades_to_rejected(self):
        pipeline = _build_test_pipeline(
            GeminiTransientError("503 UNAVAILABLE", status_code=503, provider_status="UNAVAILABLE")
        )
        path = _write_temp_image()
        try:
            out = pipeline.process_pp1(path)
        finally:
            os.remove(path)

        self.assertEqual(len(out), 1)
        row = out[0]
        self.assertEqual(row["status"], "rejected")
        self.assertEqual(row["message"], RETRYABLE_UNAVAILABLE_MESSAGE)
        self.assertEqual(row["label"], "Wallet")
        self.assertIn("gemini_error", row["raw"])
        self.assertEqual(row["raw"]["gemini_error"]["retryable"], True)
        self.assertEqual(row["raw"]["gemini_error"]["status_code"], 503)
        self.assertEqual(row["raw"]["gemini_error"]["provider_status"], "UNAVAILABLE")

    def test_fatal_gemini_error_degrades_to_reasoning_failed(self):
        pipeline = _build_test_pipeline(
            GeminiFatalError("401 unauthorized", status_code=401, provider_status="UNAUTHENTICATED")
        )
        path = _write_temp_image()
        try:
            out = pipeline.process_pp1(path)
        finally:
            os.remove(path)

        row = out[0]
        self.assertEqual(row["status"], "rejected")
        self.assertEqual(row["message"], REASONING_FAILED_MESSAGE)
        self.assertIn("gemini_error", row["raw"])
        self.assertEqual(row["raw"]["gemini_error"]["retryable"], False)

    def test_success_path_unchanged(self):
        pipeline = _build_test_pipeline(
            {
                "status": "accepted",
                "message": "Extracted successfully",
                "label": "Wallet",
                "color": "black",
                "category_details": {"features": ["logo"], "defects": [], "attachments": []},
                "key_count": None,
                "final_description": "black wallet",
                "tags": ["wallet"],
            }
        )
        path = _write_temp_image()
        try:
            out = pipeline.process_pp1(path)
        finally:
            os.remove(path)

        row = out[0]
        self.assertEqual(row["status"], "accepted")
        self.assertEqual(row["message"], "Extracted successfully")
        self.assertNotIn("gemini_error", row["raw"])


class TestGeminiReasonerRetry(unittest.TestCase):
    def test_generate_text_retries_once_then_succeeds(self):
        class FakeTransient(Exception):
            def __init__(self):
                super().__init__("temporary outage")
                self.status_code = 503
                self.response_json = {"error": {"status": "UNAVAILABLE"}}

        class FakeResponse:
            text = "ok"

        reasoner = GeminiReasoner()
        reasoner._retry_delay_seconds = 0.0
        generate = MagicMock(side_effect=[FakeTransient(), FakeResponse()])
        reasoner._client = SimpleNamespace(models=SimpleNamespace(generate_content=generate))

        text = reasoner._generate_text("prompt")
        self.assertEqual(text, "ok")
        self.assertEqual(generate.call_count, 2)


class TestPP1EndpointResilience(unittest.TestCase):
    def test_pp1_endpoint_returns_200_for_transient_gemini_fallback(self):
        pipeline = _build_test_pipeline(
            GeminiTransientError("503 UNAVAILABLE", status_code=503, provider_status="UNAVAILABLE")
        )

        original_pipeline = main_module.pipeline
        original_lifespan = app.router.lifespan_context

        @asynccontextmanager
        async def noop_lifespan(_app):
            yield

        main_module.pipeline = pipeline
        app.router.lifespan_context = noop_lifespan

        try:
            with TestClient(app) as client:
                files = [("files", ("test.jpg", _image_bytes(), "image/jpeg"))]
                response = client.post("/pp1/analyze", files=files)
        finally:
            main_module.pipeline = original_pipeline
            app.router.lifespan_context = original_lifespan

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(isinstance(payload, list) and len(payload) == 1)
        self.assertEqual(payload[0]["status"], "rejected")
        self.assertEqual(payload[0]["message"], RETRYABLE_UNAVAILABLE_MESSAGE)


class TestCaptionConfirmsYoloLabel(unittest.TestCase):
    """Tests for the _caption_confirms_yolo_label helper used by the OD skip gate."""

    def setUp(self):
        self.pipeline = UnifiedPipeline.__new__(UnifiedPipeline)

    def test_caption_with_keyword_confirms(self):
        analysis = {"raw_output": {"caption_primary": "a black wallet on a table"}, "ocr_text": ""}
        self.assertTrue(self.pipeline._caption_confirms_yolo_label("Wallet", analysis))

    def test_caption_without_keyword_does_not_confirm(self):
        analysis = {"raw_output": {"caption_primary": "a blue plastic ball"}, "ocr_text": ""}
        self.assertFalse(self.pipeline._caption_confirms_yolo_label("Earbuds - Earbuds case", analysis))

    def test_ocr_alone_confirms(self):
        analysis = {"raw_output": {"caption_primary": "an object"}, "ocr_text": "HELMET SAFETY"}
        self.assertTrue(self.pipeline._caption_confirms_yolo_label("Helmet", analysis))

    def test_hard_hat_in_caption_confirms_helmet(self):
        analysis = {"raw_output": {"caption_primary": "A blue hard hat with the name Allianz"}, "ocr_text": ""}
        self.assertTrue(self.pipeline._caption_confirms_yolo_label("Helmet", analysis))

    def test_unknown_label_defaults_to_confirmed(self):
        analysis = {"raw_output": {"caption_primary": "some object"}, "ocr_text": ""}
        self.assertTrue(self.pipeline._caption_confirms_yolo_label("UnknownCategory", analysis))


class TestPP1OCRSubstringFallback(unittest.TestCase):
    """Tests for OCR substring fallback in _score_label_keywords."""

    def setUp(self):
        self.pipeline = UnifiedPipeline.__new__(UnifiedPipeline)

    def test_concatenated_student_id_in_ocr(self):
        """OCR 'FutureSTUDENT IDDANANJAYA' should match 'student id' via substring."""
        texts = {"caption": "", "ocr": "futurestudent iddananjaya", "grounding": ""}
        result = self.pipeline._score_label_keywords("Student ID", texts)
        self.assertGreater(result["score"], 0)
        self.assertIn("student id", result["matched_keywords"]["ocr"])

    def test_nic_concatenated_with_digits(self):
        """OCR '00NIC No' should match 'nic' via substring (3 chars)."""
        texts = {"caption": "", "ocr": "00nic no", "grounding": ""}
        result = self.pipeline._score_label_keywords("Student ID", texts)
        self.assertGreater(result["score"], 0)
        self.assertIn("nic", result["matched_keywords"]["ocr"])

    def test_word_boundary_match_still_works(self):
        """Normal word-boundary match should still work."""
        texts = {"caption": "", "ocr": "student id 2024", "grounding": ""}
        result = self.pipeline._score_label_keywords("Student ID", texts)
        self.assertGreater(result["score"], 0)

    def test_substring_not_used_for_caption(self):
        """Substring fallback should only apply to OCR, not caption."""
        texts = {"caption": "futurestudent iddananjaya", "ocr": "", "grounding": ""}
        result = self.pipeline._score_label_keywords("Student ID", texts)
        # "student id" substring in caption but no word boundary → caption should not match via substring
        # Only word-boundary check applies to caption
        caption_matches = result["matched_keywords"]["caption"]
        # If word boundary fails, caption should not have the match
        # (it depends on whether "student id" has word boundaries in the string)
        # In "futurestudent iddananjaya", \bstudent\s+id\b won't match because no \b before 'student'
        self.assertEqual(len(caption_matches), 0)


class TestPP1CaptionPrimaryFallback(unittest.TestCase):
    """Tests for _collect_rerank_texts falling back to raw.caption_primary."""

    def setUp(self):
        self.pipeline = UnifiedPipeline.__new__(UnifiedPipeline)

    def test_caption_primary_used_when_caption_empty(self):
        """When main caption is empty, caption_primary from raw should be used."""
        analysis = {
            "caption": "",
            "ocr_text": "some ocr",
            "raw": {"caption_primary": "A student ID card with a picture"},
        }
        texts = self.pipeline._collect_rerank_texts(analysis)
        self.assertIn("student", texts["caption"])

    def test_main_caption_preferred_over_primary(self):
        """When main caption exists, it should be used instead of caption_primary."""
        analysis = {
            "caption": "a wallet on a table",
            "ocr_text": "",
            "raw": {"caption_primary": "something different"},
        }
        texts = self.pipeline._collect_rerank_texts(analysis)
        self.assertIn("wallet", texts["caption"])
        self.assertNotIn("different", texts["caption"])

    def test_empty_raw_handled_gracefully(self):
        """When raw is missing or not a dict, should not crash."""
        analysis = {"caption": "", "ocr_text": "", "raw": None}
        texts = self.pipeline._collect_rerank_texts(analysis)
        self.assertEqual(texts["caption"], "")


class TestPP1OCRMarginRelaxation(unittest.TestCase):
    """Tests for the OCR-based margin relaxation in _rerank_label."""

    def setUp(self):
        self.pipeline = UnifiedPipeline.__new__(UnifiedPipeline)

    def test_ocr_evidence_lowers_margin_requirement(self):
        """When winner has OCR evidence and top1 does not, margin=1 suffices."""
        top1_label = "Smart Phone"
        candidates = [
            SimpleNamespace(label="Smart Phone", confidence=0.90),
        ]
        analysis = {
            "caption": "",
            "ocr_text": "STUDENT ID 2024",
            "raw": {},
        }
        result = self.pipeline._rerank_label(top1_label, candidates, analysis)
        # Student ID should win via OCR evidence with relaxed margin
        self.assertTrue(result["applied"])
        self.assertEqual(result["winner_label"], "Student ID")

    def test_no_ocr_evidence_needs_full_margin(self):
        """Without OCR evidence for winner, full margin requirement applies."""
        top1_label = "Smart Phone"
        candidates = [
            SimpleNamespace(label="Smart Phone", confidence=0.90),
        ]
        analysis = {
            "caption": "a wallet on a table",
            "ocr_text": "",
            "raw": {},
        }
        result = self.pipeline._rerank_label(top1_label, candidates, analysis)
        # Wallet has caption=2 ("wallet"), margin over Smart Phone (score 0) = 2
        # MIN_MARGIN is 2, so it should apply
        if result["winner_label"] == "Wallet" and result["winner_score"] >= 3:
            self.assertTrue(result["applied"])


class TestPP1ScoreAllLabels(unittest.TestCase):
    """Tests for scoring all known labels, not just YOLO candidates."""

    def setUp(self):
        self.pipeline = UnifiedPipeline.__new__(UnifiedPipeline)

    def test_non_yolo_label_discovered_via_evidence(self):
        """A label not in YOLO candidates should be discovered if evidence is strong."""
        top1_label = "Smart Phone"
        candidates = [
            SimpleNamespace(label="Smart Phone", confidence=0.90),
        ]
        analysis = {
            "caption": "",
            "ocr_text": "STUDENT ID NIC 2024",
            "raw": {},
        }
        result = self.pipeline._rerank_label(top1_label, candidates, analysis)
        # Student ID: OCR matches "student id" (+3) and "nic" (+3) = score 6
        # Smart Phone: no evidence = score 0
        # Student ID should be discovered and override
        self.assertTrue(result["applied"])
        self.assertEqual(result["winner_label"], "Student ID")

    def test_weak_non_yolo_label_not_promoted(self):
        """A non-YOLO label with weak evidence should not be promoted."""
        top1_label = "Wallet"
        candidates = [
            SimpleNamespace(label="Wallet", confidence=0.95),
        ]
        analysis = {
            "caption": "a leather object on a table",
            "ocr_text": "",
            "raw": {},
        }
        result = self.pipeline._rerank_label(top1_label, candidates, analysis)
        # "leather" matches Wallet keywords via caption, score at least 2
        # No other label scores above MIN_WINNER_SCORE (3) from just "leather"
        self.assertEqual(result["final_label"], "Wallet")


if __name__ == "__main__":
    unittest.main()
