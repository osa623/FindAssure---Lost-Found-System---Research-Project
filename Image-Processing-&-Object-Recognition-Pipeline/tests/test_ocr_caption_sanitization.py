"""Tests for OCR and caption sanitization fixes in florence_service."""
import unittest

from app.services.florence_service import (
    _normalize_ocr_text,
    _caption_mentions_person,
    _caption_mentions_scene,
    _sanitize_caption,
    _build_florence_description,
)


class TestNormalizeOcrText(unittest.TestCase):
    """Verify that model special tokens and XML/HTML tags are stripped."""

    def test_strips_closing_s_tag(self):
        self.assertEqual(_normalize_ocr_text("</s>ACTIVE ENERATION"), "ACTIVE ENERATION")

    def test_strips_closing_s_tag_with_space(self):
        self.assertEqual(_normalize_ocr_text("</ s>hacllerry"), "hacllerry")

    def test_strips_opening_s_tag(self):
        self.assertEqual(_normalize_ocr_text("<s>hello world"), "hello world")

    def test_strips_pad_tag(self):
        self.assertEqual(_normalize_ocr_text("<pad>some text<pad>"), "some text")

    def test_strips_mixed_tags(self):
        self.assertEqual(
            _normalize_ocr_text("</s>ACTIVE <pad>GENERATION</s>"),
            "ACTIVE GENERATION",
        )

    def test_preserves_normal_text(self):
        self.assertEqual(_normalize_ocr_text("BAELLERRY"), "BAELLERRY")

    def test_collapses_whitespace(self):
        self.assertEqual(_normalize_ocr_text("  hello   world  "), "hello world")

    def test_handles_none(self):
        self.assertEqual(_normalize_ocr_text(None), "")

    def test_handles_empty_string(self):
        self.assertEqual(_normalize_ocr_text(""), "")

    def test_strips_arbitrary_short_html_tag(self):
        self.assertEqual(_normalize_ocr_text("<br>text<br/>"), "text")


class TestCaptionMentionsPerson(unittest.TestCase):
    def test_detects_person(self):
        self.assertTrue(_caption_mentions_person("A person is holding a helmet"))

    def test_detects_holding(self):
        self.assertTrue(_caption_mentions_person("Someone is holding a wallet"))

    def test_detects_selfie(self):
        self.assertTrue(_caption_mentions_person("A selfie with a phone"))

    def test_clean_text_passes(self):
        self.assertFalse(_caption_mentions_person("A black helmet with a clear visor"))

    def test_empty_string(self):
        self.assertFalse(_caption_mentions_person(""))


class TestCaptionMentionsScene(unittest.TestCase):
    def test_detects_taking_picture(self):
        self.assertTrue(_caption_mentions_scene("The person is taking a picture of the helmet"))

    def test_detects_close_up(self):
        self.assertTrue(_caption_mentions_scene("A close-up of a wallet"))

    def test_detects_sitting_on_table(self):
        self.assertTrue(_caption_mentions_scene("A wallet sitting on a wooden table"))

    def test_detects_on_wooden_table(self):
        self.assertTrue(_caption_mentions_scene("The wallet is on a wooden table"))

    def test_detects_this_image(self):
        self.assertTrue(_caption_mentions_scene("This image shows a helmet"))

    def test_detects_can_be_seen(self):
        self.assertTrue(_caption_mentions_scene("A logo can be seen on the surface"))

    def test_clean_text_passes(self):
        self.assertFalse(_caption_mentions_scene("A black helmet with a clear visor and white writing"))

    def test_empty_string(self):
        self.assertFalse(_caption_mentions_scene(""))


class TestSanitizeCaption(unittest.TestCase):
    def test_removes_person_sentence(self):
        text = "A black helmet. A person is holding it. The helmet has a visor."
        cleaned, removed = _sanitize_caption(text)
        self.assertIn("A black helmet.", cleaned)
        self.assertIn("The helmet has a visor.", cleaned)
        self.assertNotIn("person", cleaned)
        self.assertEqual(len(removed), 1)

    def test_removes_scene_sentence(self):
        text = "A brown wallet. The wallet is sitting on a wooden table. It has a logo."
        cleaned, removed = _sanitize_caption(text)
        self.assertIn("A brown wallet.", cleaned)
        self.assertIn("It has a logo.", cleaned)
        self.assertNotIn("sitting on", cleaned)
        self.assertNotIn("is sitting", cleaned)

    def test_removes_taking_picture(self):
        text = "A helmet with text. The person is taking a picture of it."
        cleaned, removed = _sanitize_caption(text)
        self.assertNotIn("taking a picture", cleaned)

    def test_empty_input(self):
        cleaned, removed = _sanitize_caption("")
        self.assertEqual(cleaned, "")
        self.assertEqual(removed, [])

    def test_rewrites_holding_prefix_but_keeps_object_details(self):
        cleaned, removed = _sanitize_caption("A person is holding a black helmet with a clear visor.")
        self.assertIn("black helmet with a clear visor", cleaned.lower())
        self.assertNotIn("person", cleaned.lower())
        self.assertEqual(removed, [])


class TestBuildFlorenceDescription(unittest.TestCase):
    def test_uses_natural_follow_up_sentence(self):
        result = _build_florence_description(
            caption="A black helmet.",
            label="Helmet",
            color="black",
            ocr_text="ACTIVE GENERATION",
        )
        desc = result["final_description"]
        self.assertIn('The text "ACTIVE GENERATION" is visible on the surface.', desc)
        self.assertNotIn("Notable details:", desc)
        self.assertNotIn("visible details include", desc.lower())
        self.assertNotIn("visible text reads", desc.lower())

    def test_uses_visible_text_sentence(self):
        result = _build_florence_description(
            caption="A wallet.",
            label="Wallet",
            color="brown",
            ocr_text="BAELLERRY",
        )
        desc = result["final_description"]
        self.assertIn('The text "BAELLERRY" is visible on the surface.', desc)
        self.assertNotIn("Notable details:", desc)
        self.assertNotIn("visible text reads", desc.lower())

    def test_no_extras_when_already_in_caption(self):
        result = _build_florence_description(
            caption="A brown leather BAELLERRY wallet with a small pocket and silver button on the front side.",
            label="Wallet",
            color="brown",
            ocr_text="BAELLERRY",
        )
        desc = result["final_description"]
        # OCR text is already in caption, should not be duplicated
        self.assertNotIn("Notable details:", desc)


if __name__ == "__main__":
    unittest.main()
