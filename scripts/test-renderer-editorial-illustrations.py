"""Inspect the shipped original renderer with existing Pillow, without provider imports."""
import hashlib
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


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

    def test_verified_reference_photo_fits_and_has_a_visible_label_in_the_rendered_frame(self):
        from PIL import Image
        name = "Mallard_drake_preening_(158415201).jpg"
        still = {"id": 73646009, "title": "Mallard drake preening", "width": 960, "height": 643,
                 "url": f"https://upload.wikimedia.org/wikipedia/commons/thumb/0/0e/{name}/960px-{name}",
                 "sourcePage": f"https://commons.wikimedia.org/wiki/File:{name}", "creator": "Sample photographer", "licence": "CC0 1.0"}
        self.assertEqual(self.renderer["approved_wikimedia_still"](still), still)
        with self.assertRaises(ValueError):
            self.renderer["approved_wikimedia_still"]({**still, "width": 800})
        with tempfile.TemporaryDirectory(prefix="phoenix-reference-frame-") as directory:
            root = Path(directory)
            source, output, frame = root / "photo.jpg", root / "video.mp4", root / "frame.png"
            Image.new("RGB", (960, 643), "#45855A").save(source)
            resolution = (360, 640)
            labelled = self.renderer["compose_reference_photo"](str(source), resolution)
            shot = {"still": still, "visualLabel": "Reference photo", "path": labelled,
                    "start": 0, "end": .5, "sourceStart": 0, "playbackRate": 1}
            ffmpeg = subprocess.check_output(["node", "-p", "require('@ffmpeg-installer/ffmpeg').path"],
                                            cwd=Path(__file__).resolve().parent.parent, text=True, timeout=10).strip()
            with patch.dict(self.renderer, {"_shot_cache_directory": lambda: root / "cache"}):
                self.renderer["render_timeline"]([shot], output, resolution, ffmpeg)
            subprocess.run([ffmpeg, "-v", "error", "-i", str(output), "-frames:v", "1", str(frame)], check=True, capture_output=True, timeout=15)
            with Image.open(frame) as image:
                self.assertEqual(image.size, resolution)
                self.assertGreater(sum(all(channel > 190 for channel in pixel) for pixel in image.crop((0, 0, 180, 70)).convert("RGB").getdata()), 20)
                red, green, blue = image.convert("RGB").getpixel((180, 320))
                self.assertGreater(green, max(red, blue) + 30)

    def test_concat_resolves_existing_shots_beside_a_forward_slash_manifest(self):
        with tempfile.TemporaryDirectory(prefix="phoenix-editorial-concat-test-") as temporary:
            root = Path(temporary)
            source, encoder = root / "original.png", root / "encoder-fixture"
            source.write_bytes(b"fixture original image")
            encoder.write_bytes(b"fixture encoder identity")
            concatenated = []
            def render(arguments, **_kwargs):
                destination = Path(arguments[-1])
                if "-frames:v" in arguments:
                    frames = int(arguments[arguments.index("-frames:v") + 1])
                    destination.write_bytes(b"fixture encoded frames")
                    return subprocess.CompletedProcess(arguments, 0, stdout=f"frame={frames}\n".encode(), stderr=b"")
                manifest = arguments[arguments.index("-i") + 1]
                self.assertNotIn("\\", manifest, "Windows FFmpeg resolves relative concat entries only with a forward-slash manifest URL")
                manifest = Path(manifest)
                self.assertEqual(manifest.read_text(encoding="utf-8"), "file 'shot-000.mp4'\n")
                self.assertTrue((manifest.parent / "shot-000.mp4").is_file(), "Rendered shots remain beside the manifest until concatenation")
                concatenated.append(True)
                destination.write_bytes(b"fixture combined video")
                return subprocess.CompletedProcess(arguments, 0, stdout=b"", stderr=b"")
            shot = {"start": 0, "end": 2/30, "sourceStart": 0, "path": str(source), "playbackRate": 1,
                    "illustration": {"kind": "editorial-2d-v1", "subject": "documents", "label": "Illustration"}}
            with patch.dict(self.renderer, {"_shot_cache_directory": lambda: root / "cache"}), patch.object(self.renderer["subprocess"], "run", side_effect=render):
                self.renderer["render_timeline"]([shot], str(root / "result.mp4"), (64, 64), str(encoder))
            self.assertEqual(concatenated, [True])

    def test_video_proof_rejects_laptop_and_unsafe_output_before_media_imports(self):
        script = Path(__file__).with_name("verify-news-illustrations.py")
        with tempfile.TemporaryDirectory(prefix="phoenix-news-guard-test-") as temporary:
            existing = Path(temporary) / "phoenix-news-quality-existing"
            existing.mkdir()
            cases = [({}, "only on an isolated CI runner"),
                     ({"CI": "true", "PHOENIX_NEWS_PROOF_DIR": "relative"}, "absolute isolated"),
                     ({"CI": "true", "PHOENIX_NEWS_PROOF_DIR": str(existing)}, "must be new and outside"),
                     ({"CI": "true", "PHOENIX_NEWS_PROOF_DIR": str(script.parent.parent / "phoenix-news-quality-guard")}, "must be new and outside")]
            for changes, message in cases:
                environment = {key: value for key, value in os.environ.items() if key not in ("CI", "PHOENIX_NEWS_PROOF_DIR")}
                result = subprocess.run([sys.executable, "-B", str(script)], env={**environment, **changes}, capture_output=True, text=True, timeout=10)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(message, result.stderr)
                self.assertNotIn("ModuleNotFoundError", result.stderr, "Path/CI guards run before media package imports")


if __name__ == "__main__":
    unittest.main(verbosity=2)
