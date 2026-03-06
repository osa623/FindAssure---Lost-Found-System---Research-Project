import unittest
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

from PIL import Image

import app.services.florence_service as florence_service_module
from app.services.florence_service import FlorenceService


class TestFlorenceOcrFirstMode(unittest.TestCase):
    def _service(self) -> FlorenceService:
        svc = FlorenceService.__new__(FlorenceService)
        svc.perf_profile = "fast"
        svc.fast_max_new_tokens = 96
        svc.fast_num_beams = 1
        svc.max_new_tokens = 512
        return svc

    def test_ocr_first_fast_path_uses_ocr_only_when_available(self):
        svc = self._service()
        svc.ocr = MagicMock(return_value="H.H.CO.HELMET")
        svc.caption = MagicMock(return_value="A detailed helmet caption.")
        svc.vqa = MagicMock(return_value="blue")
        svc.ground_phrases = MagicMock(return_value={})

        crop = Image.new("RGB", (512, 512), "white")
        out = svc.analyze_ocr_first(crop, canonical_label="Helmet", fast=True)

        self.assertEqual(out.get("ocr_text"), "H.H.CO.HELMET")
        self.assertEqual(out.get("caption"), "")
        self.assertEqual(out.get("raw", {}).get("caption_source"), "ocr_first")
        self.assertFalse(out.get("raw", {}).get("ocr_first", {}).get("ran_caption"))
        self.assertEqual(out.get("grounded_features"), [])
        svc.caption.assert_not_called()
        svc.vqa.assert_not_called()
        svc.ground_phrases.assert_not_called()

    def test_ocr_first_applies_ocr_and_caption_max_side_caps(self):
        svc = self._service()
        svc.ocr = MagicMock(return_value="HELLO")
        svc.caption = MagicMock(return_value="Detailed caption")
        svc.vqa = MagicMock(return_value="black")
        svc.ground_phrases = MagicMock(return_value={"<CAPTION_TO_PHRASE_GROUNDING>": {"labels": []}})

        crop = Image.new("RGB", (1400, 900), "white")
        out = svc.analyze_ocr_first(crop, canonical_label="Wallet", fast=False)

        ocr_img = svc.ocr.call_args.args[0]
        caption_img = svc.caption.call_args.args[0]
        self.assertLessEqual(max(ocr_img.size), 512)
        self.assertLessEqual(max(caption_img.size), 640)
        self.assertEqual(out.get("raw", {}).get("ocr_first", {}).get("ocr_input_wh"), (1400, 900))
        self.assertEqual(out.get("raw", {}).get("ocr_first", {}).get("detail_input_wh"), (1400, 900))
        self.assertEqual(out.get("raw", {}).get("ocr_first", {}).get("ocr_resized_wh"), ocr_img.size)
        self.assertEqual(out.get("raw", {}).get("ocr_first", {}).get("detail_resized_wh"), caption_img.size)

    def test_ocr_timeout_returns_safe_payload(self):
        svc = self._service()
        svc.ocr = MagicMock(side_effect=[TimeoutError("ocr timeout"), TimeoutError("ocr timeout")])
        svc.caption = MagicMock(return_value="unused")
        svc.vqa = MagicMock(return_value="unused")
        svc.ground_phrases = MagicMock(return_value={})

        crop = Image.new("RGB", (512, 512), "white")
        out = svc.analyze_ocr_first(crop, canonical_label="Wallet", fast=True)

        self.assertEqual(out.get("caption"), "")
        self.assertEqual(out.get("ocr_text"), "")
        self.assertEqual(out.get("raw", {}).get("error", {}).get("type"), "timeout")
        self.assertEqual(out.get("raw", {}).get("error", {}).get("stage"), "ocr")
        self.assertEqual(out.get("raw", {}).get("ocr_first", {}).get("status"), "failed")
        self.assertEqual(out.get("raw", {}).get("florence", {}).get("status"), "failed")
        self.assertEqual(out.get("raw", {}).get("florence", {}).get("reason"), "timeout")
        self.assertTrue(out.get("raw", {}).get("florence", {}).get("recovery_attempted"))
        self.assertFalse(out.get("raw", {}).get("florence", {}).get("recovery_succeeded"))

    def test_ocr_timeout_recovery_returns_degraded_with_ocr(self):
        svc = self._service()
        svc.ocr = MagicMock(side_effect=[TimeoutError("ocr timeout"), "RECOVERED_TEXT"])
        svc.caption = MagicMock(return_value="unused")
        svc.vqa = MagicMock(return_value="unused")
        svc.ground_phrases = MagicMock(return_value={})

        crop = Image.new("RGB", (512, 512), "white")
        out = svc.analyze_ocr_first(crop, canonical_label="Wallet", fast=True)
        self.assertEqual(out.get("ocr_text"), "RECOVERED_TEXT")
        self.assertEqual(out.get("raw", {}).get("florence", {}).get("status"), "degraded")
        self.assertEqual(out.get("raw", {}).get("florence", {}).get("reason"), "timeout_recovered_ocr_only")
        self.assertTrue(out.get("raw", {}).get("florence", {}).get("recovery_succeeded"))

    def test_ocr_empty_triggers_detailed_caption(self):
        svc = self._service()
        svc.ocr = MagicMock(return_value="")
        svc.caption = MagicMock(return_value="A black leather wallet with zipper.")
        svc.vqa = MagicMock(return_value="unused")
        svc.ground_phrases = MagicMock(return_value={})

        crop = Image.new("RGB", (512, 512), "white")
        out = svc.analyze_ocr_first(crop, canonical_label="Wallet", fast=True)

        self.assertNotEqual(out.get("caption", ""), "")
        self.assertEqual(out.get("raw", {}).get("ocr_first", {}).get("needs_detail"), True)
        self.assertIn("ocr_empty", out.get("raw", {}).get("ocr_first", {}).get("detail_trigger", []))
        svc.caption.assert_called_once()

    def test_grounding_and_color_run_only_when_fast_false(self):
        svc = self._service()
        svc.ocr = MagicMock(return_value="HELMET")
        svc.caption = MagicMock(return_value="A matte blue motorcycle helmet with visor.")
        svc.vqa = MagicMock(return_value="blue")
        svc.ground_phrases = MagicMock(
            return_value={"<CAPTION_TO_PHRASE_GROUNDING>": {"labels": ["visor", "scratch"]}}
        )

        crop = Image.new("RGB", (512, 512), "white")
        out_detailed = svc.analyze_ocr_first(crop, canonical_label="Helmet", fast=False)

        self.assertEqual(out_detailed.get("color_vqa"), "blue")
        self.assertTrue(out_detailed.get("raw", {}).get("ocr_first", {}).get("ran_color_vqa"))
        self.assertTrue(out_detailed.get("raw", {}).get("ocr_first", {}).get("ran_grounding"))
        self.assertGreaterEqual(svc.ground_phrases.call_count, 2)

        svc.vqa.reset_mock()
        svc.ground_phrases.reset_mock()
        out_fast = svc.analyze_ocr_first(crop, canonical_label="Helmet", fast=True)
        self.assertIsNone(out_fast.get("color_vqa"))
        self.assertFalse(out_fast.get("raw", {}).get("ocr_first", {}).get("ran_color_vqa"))
        self.assertFalse(out_fast.get("raw", {}).get("ocr_first", {}).get("ran_grounding"))
        svc.ground_phrases.assert_not_called()

    def test_lite_mode_timeout_uses_florence_failure_contract(self):
        svc = self._service()
        svc._run_with_timeout = MagicMock(side_effect=TimeoutError("lite timeout"))
        svc._run_ocr_recovery_once = MagicMock(
            return_value=(
                "",
                {
                    "source": "ocr_recovery_384",
                    "status": "timeout",
                    "reason": "timeout",
                    "elapsed_ms": 4.0,
                    "recovered_nonempty": False,
                    "max_side": 384,
                },
            )
        )

        crop = Image.new("RGB", (512, 512), "white")
        out = svc.analyze_crop(crop, canonical_label="Wallet", profile="fast", mode="lite")
        self.assertEqual(out.get("caption"), "")
        self.assertEqual(out.get("ocr_text"), "")
        self.assertEqual(out.get("raw", {}).get("florence", {}).get("status"), "failed")
        self.assertEqual(out.get("raw", {}).get("florence", {}).get("reason"), "timeout")
        self.assertNotEqual(out.get("raw", {}).get("lite", {}).get("reason"), "timeout_hard_kill")

    def test_run_task_uses_gpu_guard_for_generate(self):
        svc = self._service()
        svc.device = ""
        svc.load_model = lambda: None
        svc._processor = MagicMock()
        svc._processor.return_value = {"pixel_values": object()}
        svc._processor.batch_decode = MagicMock(return_value=["decoded"])
        svc._processor.post_process_generation = MagicMock(
            return_value={"<OCR>": {"text": "decoded"}}
        )
        svc._model = MagicMock()
        svc._model.generate = MagicMock(return_value=[[1, 2, 3]])

        guard_calls = []

        @contextmanager
        def _guard(op_name, component):
            guard_calls.append((op_name, component))
            yield

        crop = Image.new("RGB", (64, 64), "white")
        with patch.object(florence_service_module, "gpu_inference_guard", new=_guard):
            out = svc._run_task(crop, "<OCR>")

        self.assertEqual(guard_calls, [("generate", "florence")])
        self.assertEqual(svc._model.generate.call_count, 1)
        self.assertIn("_raw_text", out)

    def test_run_task_enables_autocast_on_cuda(self):
        class _FakeTensor:
            def to(self, _device):
                return self

        svc = self._service()
        svc.device = "cuda"
        svc.enable_amp = True
        svc.load_model = lambda: None
        svc._processor = MagicMock()
        svc._processor.return_value = {"pixel_values": _FakeTensor()}
        svc._processor.batch_decode = MagicMock(return_value=["decoded"])
        svc._processor.post_process_generation = MagicMock(return_value={"<OCR>": {"text": "decoded"}})
        svc._model = MagicMock()
        svc._model.generate = MagicMock(return_value=[[1, 2, 3]])

        autocast_enabled_flags = []

        @contextmanager
        def _autocast(device_type=None, dtype=None, enabled=False):
            autocast_enabled_flags.append(bool(enabled))
            yield

        crop = Image.new("RGB", (64, 64), "white")
        with patch("torch.cuda.is_available", return_value=True), patch("torch.autocast", side_effect=_autocast):
            svc._run_task(crop, "<OCR>")

        self.assertTrue(autocast_enabled_flags)
        self.assertTrue(autocast_enabled_flags[-1])


if __name__ == "__main__":
    unittest.main()
