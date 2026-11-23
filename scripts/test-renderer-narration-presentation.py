"""Exercise the shipped narration protocol using isolated stdlib-only fixtures."""
import ast
import hashlib
from html import unescape
import json
import math
import os
from pathlib import Path
import re
import subprocess
import struct
import tempfile
import wave
from datetime import timedelta
from types import SimpleNamespace
import unittest
from unittest.mock import patch

source_patch = (Path(__file__).resolve().parent.parent / "integrations" / "moneyprinterturbo-local.patch").read_text(encoding="utf-8")
lines, selected = [], False
for line in source_patch.splitlines():
    if line.startswith("diff --git "):
        selected = line == "diff --git a/app/services/phoenix_storyboard.py b/app/services/phoenix_storyboard.py"
    elif selected and line.startswith("+") and not line.startswith("+++"):
        lines.append(line[1:])
source = ast.parse("\n".join(lines))
names = {"words", "edge_caption_cues", "save_caption_cues", "subtitle_cues", "audio_speech_spans", "measured_narration_cues",
         "save_narration_captions", "licensed_narration_bed", "configure_narration_presentation", "align_beats"}
functions = [node for node in source.body if isinstance(node, ast.FunctionDef) and node.name in names]
assert {node.name for node in functions} == names
namespace = dict(hashlib=hashlib, unescape=unescape, json=json, math=math, os=os, Path=Path, re=re, subprocess=subprocess, tempfile=tempfile)
exec(compile(ast.Module(body=functions, type_ignores=[]), "shipped-narration-protocol", "exec"), namespace)
renderer = SimpleNamespace(**{name: namespace[name] for name in names})

def cue(text, start, end):
    return SimpleNamespace(content=text, start=timedelta(seconds=start), end=timedelta(seconds=end))

class TestMeasuredNarration(unittest.TestCase):
    def test_real_single_thread_decoder_keeps_measured_pcm_pauses_and_ending(self):
        project = Path(__file__).resolve().parent.parent
        executable = project / 'node_modules' / '@ffmpeg-installer' / 'win32-x64' / 'ffmpeg.exe'
        if not executable.is_file():
            self.skipTest('The bundled Windows FFmpeg is unavailable on this host')
        with tempfile.TemporaryDirectory(prefix='phoenix-narration-pcm-') as temporary:
            filename = Path(temporary) / 'synthetic.wav'
            rate = 16000
            with wave.open(str(filename), 'wb') as recording:
                recording.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
                recording.writeframes(b''.join(struct.pack('<h', int(9000 * math.sin(2 * math.pi * 220 * index / rate))
                    if .25 <= index / rate < .65 or .95 <= index / rate < 1.35 else 0) for index in range(int(rate * 1.6))))
            spans = renderer.audio_speech_spans(filename, 1.6, executable)
            self.assertEqual(len(spans), 2)
            for actual, expected in zip([number for span in spans for number in span], [.25, .65, .95, 1.35]):
                self.assertAlmostEqual(actual, expected, delta=.01)
            native = renderer.measured_narration_cues('Hello. Goodbye.', [cue('Hello', .2, .95), cue('Goodbye', .95, 1.6)], 1.6, spans)
            self.assertAlmostEqual(native[0][0], .25, delta=.01)
            self.assertAlmostEqual(native[0][1], .65, delta=.01)
            self.assertAlmostEqual(native[-1][1], 1.35, delta=.01)

    def test_native_word_boundaries_and_actual_pauses_drive_captions_and_scenes(self):
        script = "Open curtains. Pour water."
        observed = [cue("Open", .2, .6), cue("curtains", .6, 2), cue("Pour", 2, 2.3), cue("water", 2.3, 3.6)]
        native = renderer.measured_narration_cues(script, observed, 3.6, [(.2, 1.4), (2, 3)])
        self.assertEqual(native, [(.2, .6, "Open"), (.6, 1.4, "curtains."), (2, 2.3, "Pour"), (2.3, 3, "water.")])
        with tempfile.TemporaryDirectory(prefix="phoenix-narration-cues-") as temporary:
            filename = str(Path(temporary) / "subtitle.srt")
            renderer.save_narration_captions(script, native, filename)
            self.assertEqual(renderer.subtitle_cues(filename), [(.2, 1.4, "Open curtains."), (2, 3, "Pour water.")])
        beats = renderer.align_beats([{"narration": "Open curtains."}, {"narration": "Pour water."}], script, native, 3.6, strict=True)
        self.assertEqual([(beat["start"], beat["end"]) for beat in beats], [(0, 2), (2, 3.6)])
        self.assertTrue(all(beat["timing"] == "subtitle-boundary" for beat in beats))

    def test_leading_silence_long_pause_and_actual_ending_are_measured_without_a_model(self):
        diagnostic = "silence_start: 0\nsilence_end: 0.5\nsilence_start: 1.8\nsilence_end: 2.3\nsilence_start: 3.6\nsilence_end: 4.0\n"
        with patch.object(subprocess, "run", return_value=SimpleNamespace(returncode=0, stderr=diagnostic)) as run:
            spans = renderer.audio_speech_spans("fixture.wav", 4, "fixture-ffmpeg")
        self.assertEqual(spans, [(0.5, 1.8), (2.3, 3.6)])
        args = run.call_args.args[0]
        self.assertEqual(args[args.index("-threads") + 1], "1")
        self.assertIn("silencedetect=noise=-45dB:duration=0.18", args)
        self.assertEqual(run.call_args.kwargs["timeout"], 180)
        native = renderer.measured_narration_cues("Hello. Goodbye.", [cue("Hello", .4, 2), cue("Goodbye", 2.3, 4)], 4, spans)
        self.assertEqual(native, [(.5, 1.8, "Hello."), (2.3, 3.6, "Goodbye.")])

    def test_silent_recording_or_unproven_phrase_cannot_be_caption_success(self):
        with patch.object(subprocess, "run", return_value=SimpleNamespace(returncode=0, stderr="silence_start: 0\nsilence_end: 4\n")):
            with self.assertRaisesRegex(ValueError, "no measured audible speech"):
                renderer.audio_speech_spans("silent.wav", 4, "fixture")
        with self.assertRaisesRegex(ValueError, "crosses a measured pause"):
            renderer.measured_narration_cues("Hello goodbye.", [cue("Hello goodbye", .5, 3.6)], 4, [(.5, 1.8), (2.3, 3.6)])
        with self.assertRaisesRegex(ValueError, "exactly match"):
            renderer.measured_narration_cues("Hello goodbye.", [cue("Hello", .5, 1.8)], 4, [(.5, 1.8)])

    def test_scene_boundary_inside_provider_phrase_fails_without_interpolation(self):
        beats = [{"narration": "Open curtains."}, {"narration": "Pour water."}]
        native = [(.2, 2.3, "Open curtains. Pour"), (2.3, 3, "water.")]
        with self.assertRaisesRegex(ValueError, "no scene timing was interpolated"):
            renderer.align_beats(beats, "Open curtains. Pour water.", native, 3.6, strict=True)
        legacy = renderer.align_beats(beats, "Open curtains. Pour water.", native, 3.6)
        self.assertEqual(legacy[0]["timing"], "within-caption-estimate")

    def test_readable_phrases_keep_qualifications_and_last_spoken_word(self):
        script = "Officials reported an incident. The operator denied responsibility and the cause remains unverified."
        native = [(round(index * .4, 3), round(index * .4 + .35, 3), token) for index, token in enumerate(script.split())]
        with tempfile.TemporaryDirectory(prefix="phoenix-narration-cues-") as temporary:
            filename = str(Path(temporary) / "subtitle.srt")
            renderer.save_narration_captions(script, native, filename)
            captions = renderer.subtitle_cues(filename)
            self.assertEqual(" ".join(text for _, _, text in captions), script)
            self.assertTrue(all(len(text.split()) <= 6 and len(text) <= 42 for _, _, text in captions))
            self.assertEqual(captions[-1][1], native[-1][1])
            prior = Path(filename).read_text(encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "too long"):
                renderer.save_narration_captions(script, [(0, 5, script)], filename)
            self.assertEqual(Path(filename).read_text(encoding="utf-8"), prior)

    def test_caption_phrases_cannot_anticipate_the_next_reviewed_visual_scene(self):
        scenes = ['Open the curtains slowly', 'and pour cool water.']
        script = ' '.join(scenes)
        native = [(round(index * .4, 3), round(index * .4 + .35, 3), token) for index, token in enumerate(script.split())]
        with tempfile.TemporaryDirectory(prefix='phoenix-narration-cues-') as temporary:
            filename = str(Path(temporary) / 'subtitle.srt')
            renderer.save_narration_captions(script, native, filename, scene_narration=scenes)
            self.assertEqual([text for _, _, text in renderer.subtitle_cues(filename)], scenes)
            with self.assertRaisesRegex(ValueError, 'inside a provider phrase'):
                renderer.save_narration_captions(script, [(0, 2, 'Open the curtains slowly and'), (2, 3.2, 'pour cool water.')], filename, scene_narration=scenes)

    def test_only_new_protocol_bypasses_transcription_and_reuses_one_timeline(self):
        self.assertIn('phoenix_narration_protocol: Optional[Literal["measured-speech-v1"]]', source_patch)
        self.assertIn('+    if getattr(params, "phoenix_narration_protocol", None) == "measured-speech-v1":', source_patch)
        self.assertIn('+            audio_duration = measured_audio_duration', source_patch)
        self.assertIn('+                **({"measured_cues": measured_speech_cues} if measured_speech_cues is not None else {}),', source_patch)
        self.assertIn('+            if measured_speech_cues is None and getattr(params, "phoenix_news_caption_style", None)', source_patch)

class TestLicensedNarrationBed(unittest.TestCase):
    def fixture(self, temporary):
        root = Path(temporary)
        library = root / "assets" / "music" / "lofi-cc0-v1"
        library.mkdir(parents=True)
        audio = b"synthetic licensed music fixture"
        (library / "quiet-test.m4a").write_bytes(audio)
        manifest = {"library": "cc0-lofi-v1", "licence": "CC0-1.0", "recordings": [{"id": "quiet-test", "filename": "quiet-test.m4a",
            "bytes": len(audio), "sha256": hashlib.sha256(audio).hexdigest(), "style": "quiet-instrumental", "durationSeconds": 60}]}
        (library / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        return root, library, manifest, {"library": "cc0-lofi-v1", "trackId": "quiet-test", "offsetSeconds": 2.5}

    def test_selected_verified_quiet_asset_is_staged_at_low_volume(self):
        with tempfile.TemporaryDirectory(prefix="phoenix-narration-bed-") as temporary:
            root, library, _, selection = self.fixture(temporary)
            def prepare(args, **options):
                self.assertEqual(options["timeout"], 180)
                self.assertEqual(Path(args[args.index("-i") + 1]).resolve(), (library / "quiet-test.m4a").resolve())
                self.assertEqual(args[args.index("-ss") + 1], "2.5")
                self.assertEqual(args[args.index("-t") + 1], "5.6")
                self.assertEqual(args[args.index("-threads") + 1], "1")
                Path(args[-1]).write_bytes(b"prepared fixture")
                return SimpleNamespace(returncode=0)
            params = SimpleNamespace(video_aspect="9:16", phoenix_music_bed=SimpleNamespace(model_dump=lambda: selection))
            with patch.dict(os.environ, {"PHOENIX_STUDIO_ROOT": str(root)}), patch.object(subprocess, "run", side_effect=prepare) as run:
                renderer.configure_narration_presentation(params, root, 5.6, "fixture-ffmpeg")
            self.assertEqual(run.call_count, 1)
            self.assertEqual(params.bgm_volume, .04); self.assertEqual(params.bgm_type, "custom")
            self.assertFalse(params.text_background_color); self.assertEqual(params.custom_position, 78)
            self.assertEqual(params.voice_volume, 1); self.assertEqual(params.font_size, 34)

    def test_absent_music_is_clean_voice_and_news_cannot_enable_a_bed(self):
        params = SimpleNamespace(video_aspect="16:9", bgm_type="random", bgm_volume=1, voice_rate=1.08)
        with patch.object(subprocess, "run", side_effect=AssertionError("No music process may run")):
            renderer.configure_narration_presentation(params, "fixture", 8, "fixture")
        self.assertEqual(params.bgm_type, ""); self.assertEqual(params.bgm_volume, 0); self.assertEqual(params.font_size, 28)
        self.assertEqual(params.voice_rate, 1.08)
        params.phoenix_music_bed = SimpleNamespace(model_dump=lambda: {})
        params.phoenix_news_visual_policy = "context-stock-or-editorial-2d-v2"
        with self.assertRaisesRegex(ValueError, "News retains clean narration"):
            renderer.configure_narration_presentation(params, "fixture", 8, "fixture")

    def test_invalid_licence_style_hash_or_arbitrary_path_never_substitutes_music(self):
        with tempfile.TemporaryDirectory(prefix="phoenix-narration-bed-") as temporary:
            root, library, manifest, selection = self.fixture(temporary)
            with patch.dict(os.environ, {"PHOENIX_STUDIO_ROOT": str(root)}), patch.object(subprocess, "run", side_effect=AssertionError("No invalid music may be decoded")):
                for change in ({"library": "other"}, {"trackId": "../private"}, {"offsetSeconds": -1}, {"filename": "private.wav"}):
                    with self.assertRaises(ValueError):
                        renderer.licensed_narration_bed({**selection, **change}, root, 6, "fixture")
                for field, value in (("style", "energetic"), ("sha256", "0" * 64), ("filename", "../quiet-test.m4a")):
                    saved = manifest["recordings"][0][field]
                    manifest["recordings"][0][field] = value
                    (library / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
                    with self.assertRaises(ValueError):
                        renderer.licensed_narration_bed(selection, root, 6, "fixture")
                    manifest["recordings"][0][field] = saved
                manifest["licence"] = "unknown"
                (library / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
                with self.assertRaises(ValueError):
                    renderer.licensed_narration_bed(selection, root, 6, "fixture")

if __name__ == "__main__":
    unittest.main(verbosity=2)
