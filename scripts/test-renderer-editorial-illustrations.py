"""Inspect the shipped original renderer with existing Pillow, without provider imports."""
import hashlib
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


def shipped_renderer():
    fixture = Path(__file__).with_name("test-renderer-news-policy.py")
    spec = importlib.util.spec_from_file_location("news_policy_fixture", fixture)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    namespace = {"__name__": "shipped_editorial_renderer"}
    # This module imports stdlib only; media/provider imports live inside their own functions.
    exec(compile(module.added_source("app/services/phoenix_storyboard.py"), "shipped-editorial-renderer", "exec"), namespace)
    return namespace


class TestEditorialIllustrations(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.renderer = shipped_renderer()

    def test_every_original_subject_renders_a_detailed_disclosed_rgb_image_at_both_aspects(self):
        from PIL import Image
        with tempfile.TemporaryDirectory(prefix="phoenix-editorial-image-test-") as directory:
            fingerprints = set()
            for subject in sorted(self.renderer["_EDITORIAL_SUBJECTS"]):
                for size in ((360, 640), (640, 360)):
                    filename = Path(directory) / f"{subject}-{size[0]}.png"
                    self.renderer["render_editorial_illustration"]({"kind": "editorial-2d-v1", "subject": subject, "label": "Illustration"}, "Synthetic neutral verification sentence.", filename, size)
                    with Image.open(filename) as image:
                        self.assertEqual(image.size, size)
                        self.assertEqual(image.mode, "RGB")
                        self.assertGreater(len(image.getcolors(size[0]*size[1]) or []), 70)
                        self.assertGreater(len(set(image.crop((20, 15, 170, 60)).getdata())), 10, "Visible Illustration disclosure contains type, not a blank badge")
                    fingerprints.add(hashlib.sha256(filename.read_bytes()).hexdigest())
            self.assertEqual(len(fingerprints), 18, "Each subject and aspect has its own original composition")

    def test_exact_metadata_rejects_fabricated_images_prompts_and_unlabelled_depictions(self):
        valid = {"kind": "editorial-2d-v1", "subject": "legal", "label": "Illustration"}
        self.assertEqual(self.renderer["editorial_illustration"](valid), valid)
        for value in ({**valid, "prompt": "fake event photograph"}, {**valid, "subject": "people"}, {**valid, "label": "News footage"}, None):
            with self.assertRaisesRegex(ValueError, "Invalid original editorial"):
                self.renderer["editorial_illustration"](value)

    def test_video_proof_rejects_laptop_and_unsafe_output_before_media_imports(self):
        script = Path(__file__).with_name("verify-news-illustrations.py")
        with tempfile.TemporaryDirectory(prefix="phoenix-news-quality-guard-") as existing:
            cases = [({}, "only on an isolated CI runner"),
                     ({"CI": "true", "PHOENIX_NEWS_PROOF_DIR": "relative"}, "absolute isolated"),
                     ({"CI": "true", "PHOENIX_NEWS_PROOF_DIR": existing}, "must be new and outside"),
                     ({"CI": "true", "PHOENIX_NEWS_PROOF_DIR": str(script.parent.parent / "phoenix-news-quality-guard")}, "must be new and outside")]
            for changes, message in cases:
                environment = {key: value for key, value in os.environ.items() if key not in ("CI", "PHOENIX_NEWS_PROOF_DIR")}
                result = subprocess.run([sys.executable, "-B", str(script)], env={**environment, **changes}, capture_output=True, text=True, timeout=10)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(message, result.stderr)
                self.assertNotIn("ModuleNotFoundError", result.stderr, "Path/CI guards run before media package imports")


if __name__ == "__main__":
    unittest.main(verbosity=2)
