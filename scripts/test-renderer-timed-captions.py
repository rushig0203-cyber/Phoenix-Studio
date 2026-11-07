"""Test the shipped backend patch with stdlib only: no backend/model/provider imports."""

import ast
import math
import os
import re
import tempfile
import unittest
from datetime import timedelta
from html import unescape
from pathlib import Path
from types import SimpleNamespace


def added_source(filename):
    patch = (Path(__file__).resolve().parent.parent / "integrations" / "moneyprinterturbo-local.patch").read_text(encoding="utf-8")
    lines, selected = [], False
    for line in patch.splitlines():
        if line.startswith("diff --git "):
            selected = line == f"diff --git a/{filename} b/{filename}"
        elif selected and line.startswith("+") and not line.startswith("+++"):
            lines.append(line[1:])
    if not lines:
        raise AssertionError(f"Missing shipped backend source: {filename}")
    return "\n".join(lines) + "\n"


names = {"words", "edge_caption_cues", "save_edge_captions", "subtitle_cues", "news_caption_lines", "save_news_captions"}
source = ast.parse(added_source("app/services/phoenix_storyboard.py"))
functions = [node for node in source.body if isinstance(node, ast.FunctionDef) and node.name in names]
assert {node.name for node in functions} == names
namespace = dict(math=math, os=os, re=re, tempfile=tempfile, unescape=unescape, Path=Path)
exec(compile(ast.Module(body=functions, type_ignores=[]), "shipped-caption-helpers", "exec"), namespace)
storyboard = SimpleNamespace(**{name: namespace[name] for name in names})

tests = ast.parse(added_source("test/services/test_phoenix_storyboard.py"))
test_class = next(node for node in tests.body if isinstance(node, ast.ClassDef) and node.name == "TestEdgeCaptionBoundaries")
exec(compile(ast.Module(body=[test_class], type_ignores=[]), "shipped-caption-tests", "exec"), globals())


class TestShippedCaptionIntegration(unittest.TestCase):
    def test_news_groups_keep_every_word_and_qualification_in_short_phrases(self):
        script = "Officials reported a breach. The operator denied responsibility, and the cause remains unverified."
        lines = storyboard.news_caption_lines(script)
        self.assertEqual(" ".join(lines), script)
        self.assertTrue(all(len(line.split()) <= 6 and len(line) <= 42 for line in lines))
        self.assertEqual(lines[0], "Officials reported a breach.")

    def test_news_groups_use_real_word_boundaries_through_last_spoken_word(self):
        script = "Officials reported a breach. The operator denied responsibility, and the cause remains unverified."
        tokens = script.split()
        observed = [SimpleNamespace(content=token, start=timedelta(seconds=index * .4), end=timedelta(seconds=(index + 1) * .4)) for index, token in enumerate(tokens)]
        with tempfile.TemporaryDirectory(prefix="phoenix-news-captions-") as directory:
            filename = str(Path(directory) / "news.srt")
            storyboard.save_news_captions(script, observed, len(tokens) * .4, filename)
            cues = storyboard.subtitle_cues(filename)
            self.assertEqual(" ".join(text for _, _, text in cues), script)
            self.assertEqual(cues[-1][1], len(tokens) * .4)
            self.assertTrue(all(start in [round(i * .4, 3) for i in range(len(tokens))] for start, _, _ in cues))
            with self.assertRaisesRegex(ValueError, "exactly match"):
                storyboard.save_news_captions(script, observed[:-1], len(tokens) * .4, filename)
            self.assertEqual(storyboard.subtitle_cues(filename), cues, "Invalid timing must not overwrite the valid captions")

    def test_news_render_groups_captions_after_preserving_the_full_shot_timeline(self):
        patch = (Path(__file__).resolve().parent.parent / "integrations" / "moneyprinterturbo-local.patch").read_text(encoding="utf-8")
        self.assertIn('+            if getattr(params, "phoenix_news_caption_style", None) == "measured-phrases-v1":', patch)
        self.assertLess(patch.index('storyboard_timeline, public_storyboard = phoenix_storyboard.prepare_timeline('), patch.index('+                subtitle_path = phoenix_storyboard.save_news_captions('))

    def test_real_edge_caption_recovery_is_only_for_missing_edge_storyboard_captions(self):
        patch = (Path(__file__).resolve().parent.parent / "integrations" / "moneyprinterturbo-local.patch").read_text(encoding="utf-8")
        self.assertIn('+            if not subtitle_path and params.subtitle_enabled and config.app.get("subtitle_provider", "edge").strip().lower() == "edge":', patch)
        self.assertIn('+                    getattr(sub_maker, "cues", None), measured_audio_duration,', patch)
        self.assertIn('+                task_id, params, subtitle_path, measured_audio_duration,', patch)


if __name__ == "__main__":
    unittest.main(verbosity=2)
