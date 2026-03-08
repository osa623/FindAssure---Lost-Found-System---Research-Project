import unittest
from contextlib import contextmanager
from unittest.mock import MagicMock

from PIL import Image

import app.services.florence_service as florence_service_module
from app.services.florence_service import FlorenceService


class TestFlorencePerfProfile(unittest.TestCase):
    def test_run_task_fast_profile_disables_early_stopping_for_single_beam(self):
        svc = FlorenceService.__new__(FlorenceService)
        svc.perf_profile = "fast"
        svc.fast_max_new_tokens = 96
        svc.fast_num_beams = 1
        svc.max_new_tokens = 512
        svc.device = ""
        svc.enable_amp = False
        svc.load_model = lambda: None
        svc._processor = MagicMock()
        svc._processor.return_value = {"pixel_values": object()}
        svc._processor.batch_decode = MagicMock(return_value=["decoded"])
        svc._processor.post_process_generation = MagicMock(return_value={"<OCR>": {"text": "decoded"}})
        svc._model = MagicMock()
        svc._model.generate = MagicMock(return_value=[[1, 2, 3]])

        @contextmanager
        def _guard(_op_name, _component):
            yield

        crop = Image.new("RGB", (64, 64), "white")
        with unittest.mock.patch.object(florence_service_module, "gpu_inference_guard", new=_guard):
            svc._run_task(crop, "<OCR>", profile="fast")

        kwargs = svc._model.generate.call_args.kwargs
        self.assertEqual(kwargs["num_beams"], 1)
        self.assertFalse(kwargs["early_stopping"])

    def test_run_task_balanced_profile_keeps_beam_early_stopping(self):
        svc = FlorenceService.__new__(FlorenceService)
        svc.perf_profile = "balanced"
        svc.fast_max_new_tokens = 96
        svc.fast_num_beams = 1
        svc.max_new_tokens = 512
        svc.device = ""
        svc.enable_amp = False
        svc.load_model = lambda: None
        svc._processor = MagicMock()
        svc._processor.return_value = {"pixel_values": object()}
        svc._processor.batch_decode = MagicMock(return_value=["decoded"])
        svc._processor.post_process_generation = MagicMock(return_value={"<OCR>": {"text": "decoded"}})
        svc._model = MagicMock()
        svc._model.generate = MagicMock(return_value=[[1, 2, 3]])

        @contextmanager
        def _guard(_op_name, _component):
            yield

        crop = Image.new("RGB", (64, 64), "white")
        with unittest.mock.patch.object(florence_service_module, "gpu_inference_guard", new=_guard):
            svc._run_task(crop, "<OCR>", profile="balanced")

        kwargs = svc._model.generate.call_args.kwargs
        self.assertEqual(kwargs["num_beams"], 3)
        self.assertTrue(kwargs["early_stopping"])

    def test_fast_profile_skips_defects_and_attachments(self):
        svc = FlorenceService.__new__(FlorenceService)
        svc.perf_profile = "fast"
        svc.fast_max_new_tokens = 96
        svc.fast_num_beams = 1
        svc.max_new_tokens = 512

        svc.caption = MagicMock(return_value="A black wallet with logo.")
        svc.ocr = MagicMock(return_value="VISA")
        svc.vqa = MagicMock(return_value="black")
        svc.ground_phrases = MagicMock(
            return_value={"<CAPTION_TO_PHRASE_GROUNDING>": {"labels": ["logo"]}}
        )

        crop = Image.new("RGB", (64, 64), "white")
        out = svc.analyze_crop(crop, canonical_label="Wallet", profile="fast")

        self.assertIsInstance(out, dict)
        self.assertIn("grounded_features", out)
        self.assertEqual(out.get("grounded_defects"), [])
        self.assertEqual(out.get("grounded_attachments"), [])
        self.assertEqual(out.get("raw", {}).get("defects_vqa"), "None")
        self.assertGreaterEqual(svc.ground_phrases.call_count, 1)
        self.assertEqual(svc.vqa.call_count, 1)


if __name__ == "__main__":
    unittest.main()
