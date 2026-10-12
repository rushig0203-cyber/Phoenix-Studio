"""Run shipped news-policy regressions with stdlib only, without backend imports."""

import ast
import math
import os
import re
import sys
import unittest
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import patch
from urllib.parse import unquote, urlparse


def added_source(filename):
    source_patch = (Path(__file__).resolve().parent.parent / "integrations" / "moneyprinterturbo-local.patch").read_text(encoding="utf-8")
    lines, selected = [], False
    for line in source_patch.splitlines():
        if line.startswith("diff --git "):
            selected = line == f"diff --git a/{filename} b/{filename}"
        elif selected and line.startswith("+") and not line.startswith("+++"):
            lines.append(line[1:])
    if not lines:
        raise AssertionError(f"Missing shipped backend source: {filename}")
    return "\n".join(lines) + "\n"


def unexpected(*_args, **_kwargs):
    raise AssertionError("Unmocked renderer I/O is forbidden in this test")


class VideoParams:
    """Only the data shape used by the extracted timeline logic, not Pydantic."""

    def __init__(self, **values):
        self.__dict__.update(video_source="pexels", video_count=1, video_aspect="9:16", phoenix_news_visual_policy=None)
        self.__dict__.update(values)
        self.phoenix_storyboard = [SimpleNamespace(model_dump=lambda beat=beat: dict(beat)) for beat in values["phoenix_storyboard"]]


names = {"words", "align_beats", "_supplement_metadata_matches", "prepare_timeline"}
source = ast.parse(added_source("app/services/phoenix_storyboard.py"))
functions = [node for node in source.body if isinstance(node, ast.FunctionDef) and node.name in names]
assert {node.name for node in functions} == names
fps = next(node for node in source.body if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "_OUTPUT_FPS" for target in node.targets))
storyboard = ModuleType("app.services.phoenix_storyboard")
storyboard.__dict__.update(math=math, os=os, re=re, unquote=unquote, urlparse=urlparse, subtitle_cues=unexpected, approved_pexels_asset=unexpected, download_stock_video=unexpected)
exec(compile(ast.Module(body=[fps, *functions], type_ignores=[]), "shipped-news-timeline", "exec"), storyboard.__dict__)

# Timeline imports resolve exclusively to these tiny test doubles. The extracted
# function's globals belong to the module so its real test mocks patch them.
modules = {name: ModuleType(name) for name in ("app", "app.config", "app.models", "app.models.schema", "app.services", "app.services.material", "app.services.task_artifacts", "app.utils")}
modules["app.config"].config = SimpleNamespace(app={})
modules["app.models.schema"].VideoParams = VideoParams
modules["app.models.schema"].MaterialInfo = SimpleNamespace
material = modules["app.services.material"]
material.search_videos_pexels = unexpected
material.search_videos_pixabay = unexpected
material._search_videos_with_cache = unexpected
material._material_source_record = lambda candidate, _filename: dict(candidate.source_info or {})
modules["app.services.task_artifacts"].patch_script_data = unexpected
modules["app.utils"].utils = SimpleNamespace(task_dir=unexpected)
modules["app.services"].material = material
modules["app.services"].task_artifacts = modules["app.services.task_artifacts"]
modules["app.services"].phoenix_storyboard = storyboard
modules["app"].services = modules["app.services"]
modules["app"].models = modules["app.models"]
modules["app.models"].schema = modules["app.models.schema"]

# Execute the same regression methods shipped to MoneyPrinterTurbo, rather than
# duplicating assertions against a rewritten imitation of its implementation.
tests = ast.parse(added_source("test/services/test_phoenix_storyboard.py"))
test_class = next(node for node in tests.body if isinstance(node, ast.ClassDef) and node.name == "TestPhoenixStoryboard")
selected = {
    "test_news_shortfall_never_searches_unverified_swimming_river_stock",
    "test_news_requires_every_approved_asset_before_fetching_any_footage",
    "test_news_with_sufficient_approved_footage_keeps_one_native_speed_asset",
    "test_small_measured_shortfall_adds_distinct_same_query_footage_at_native_speed",
}
test_class.body = [node for node in test_class.body if isinstance(node, ast.FunctionDef) and node.name in selected]
assert {node.name for node in test_class.body} == selected
exec(compile(ast.Module(body=[test_class], type_ignores=[]), "shipped-news-tests", "exec"), globals())


if __name__ == "__main__":
    with patch.dict(sys.modules, modules):
        unittest.main(verbosity=2)
