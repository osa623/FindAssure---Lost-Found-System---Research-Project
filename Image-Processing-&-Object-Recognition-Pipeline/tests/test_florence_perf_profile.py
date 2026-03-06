import unittest
from unittest.mock import MagicMock

from PIL import Image

from app.services.florence_service import FlorenceService


class TestFlorencePerfProfile(unittest.TestCase):
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
