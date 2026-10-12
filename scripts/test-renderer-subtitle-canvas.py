"""Check the shipped source-canvas fix with stdlib only; no media/model imports."""

import ast
from pathlib import Path
from types import SimpleNamespace
import unittest


patch = (Path(__file__).resolve().parent.parent / "integrations" / "moneyprinterturbo-local.patch").read_text(encoding="utf-8")
lines, selected = [], False
for line in patch.splitlines():
    if line.startswith("diff --git "):
        selected = line == "diff --git a/app/services/video.py b/app/services/video.py"
    elif selected and line.startswith("+") and not line.startswith("+++"):
        lines.append(line[1:])
start = next(index for index, line in enumerate(lines) if line.startswith("def _subtitle_canvas_size("))
helper = []
for line in lines[start:]:
    if helper and (not line or not line.startswith(" ")):
        break
    helper.append(line)
namespace = {}
exec(compile(ast.parse("\n".join(helper)), "shipped-subtitle-canvas", "exec"), namespace)


class TestShippedSubtitleCanvas(unittest.TestCase):
    def test_bottom_caption_is_inside_actual_smaller_portrait_frame(self):
        width, height = namespace["_subtitle_canvas_size"](SimpleNamespace(size=(720, 1280)))
        caption_height = 128
        actual_y = height * 0.95 - caption_height
        self.assertEqual((width, height), (720, 1280))
        self.assertGreaterEqual(actual_y, 0)
        self.assertLess(actual_y + caption_height, 1280)
        self.assertGreater(1920 * 0.95 - caption_height, 1280, "The old nominal canvas places this subtitle off-screen")

    def test_landscape_and_invalid_decoded_dimensions(self):
        self.assertEqual(namespace["_subtitle_canvas_size"](SimpleNamespace(size=(1280, 720))), (1280, 720))
        for size in ((0, 1280), (720, -1)):
            with self.subTest(size=size), self.assertRaisesRegex(ValueError, "valid source video dimensions"):
                namespace["_subtitle_canvas_size"](SimpleNamespace(size=size))

    def test_shipped_renderer_uses_decoded_canvas_before_compositing(self):
        self.assertIn("+        video_width, video_height = _subtitle_canvas_size(source_video_clip)", patch)
        self.assertIn("+    def test_late_subtitle_uses_actual_source_canvas_not_nominal_aspect_size(self):", patch)
        self.assertIn('captured["ending"][-256:]', patch)


if __name__ == "__main__":
    unittest.main(verbosity=2)
