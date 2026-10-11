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


names = {"words", "edge_caption_cues", "save_edge_captions", "subtitle_cues"}
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
    def test_real_edge_caption_recovery_is_only_for_missing_edge_storyboard_captions(self):
        patch = (Path(__file__).resolve().parent.parent / "integrations" / "moneyprinterturbo-local.patch").read_text(encoding="utf-8")
        self.assertIn('+            if not subtitle_path and params.subtitle_enabled and config.app.get("subtitle_provider", "edge").strip().lower() == "edge":', patch)
        self.assertIn('+                    getattr(sub_maker, "cues", None), measured_audio_duration,', patch)
        self.assertIn('+                task_id, params, subtitle_path, measured_audio_duration,', patch)


if __name__ == "__main__":
    unittest.main(verbosity=2)
