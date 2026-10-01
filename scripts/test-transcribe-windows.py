"""Bounded transcription checks; no FFmpeg, Whisper, downloads, or media decoding.

Run with: python scripts/test-transcribe-windows.py
"""

import contextlib
import copy
import importlib.util
import io
import json
import math
import subprocess
import tempfile
import unittest
import wave
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location(
    "transcribe_local", Path(__file__).with_name("transcribe-local.py")
)
transcriber = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(transcriber)


def speech(*words):
    return SimpleNamespace(
        text="".join(text for _, _, text in words),
        words=[SimpleNamespace(start=start, end=end, word=text) for start, end, text in words],
        avg_logprob=-0.25,
        no_speech_prob=0.01,
    )


def record(*words):
    return {
        "words": [{"start": start, "end": end, "text": text} for start, end, text in words],
        "avgLogprob": -0.25,
        "noSpeechProbability": 0.01,
    }


class TranscriptionHarness:
    """A tiny source and fake decoder/model with real checkpoints and cleanup."""

    def __init__(self, root, duration):
        self.root = Path(root)
        self.source = self.root / "episode.mp4"
        self.source.write_bytes(b"source placeholder")
        self.output = self.root / "result.json"
        self.model_dir = self.root / "model"
        self.model_dir.mkdir()
        (self.model_dir / "model.bin").write_bytes(b"model placeholder")
        self.duration = duration
        self.extractions = []
        self.model_calls = []
        self.loads = 0
        self.fail_extract = None
        self.fail_inference = None
        self.on_load = None
        self.on_inference = None
        self.empty_audio = False
        self.statuses = io.StringIO()
        self.words = []
        for index in range(math.ceil(duration / transcriber.WINDOW_SECONDS)):
            start = index * transcriber.WINDOW_SECONDS
            available = min(duration - start, transcriber.WINDOW_SECONDS)
            self.words.append((start + min(1, available / 4), start + min(2, available / 2), f" word-{index}"))

    def load(self, model_dir):
        assert model_dir == self.model_dir
        self.loads += 1
        if self.on_load:
            self.on_load()
        return self

    def extract(self, source, destination, start, end):
        assert source == self.source
        assert end > start
        assert end - start <= transcriber.WINDOW_SECONDS + 2 * transcriber.CONTEXT_SECONDS
        assert all(not previous[0].exists() for previous in self.extractions), "audio windows overlap in lifetime"
        self.extractions.append((destination, start, end))
        destination.write_bytes(b"bounded fake WAV")
        if len(self.extractions) == self.fail_extract:
            raise RuntimeError("fake extraction failure")
        return not self.empty_audio

    def transcribe(self, audio_path, **options):
        audio_path = Path(audio_path)
        assert audio_path.is_file()
        assert audio_path != self.source
        assert options == transcriber.TRANSCRIPTION_OPTIONS
        assert options["word_timestamps"] is True
        self.model_calls.append(audio_path)
        _, offset, stop = self.extractions[-1]
        call = len(self.model_calls)

        def generate():
            assert audio_path.is_file(), "window was removed before the lazy model finished"
            if self.on_inference:
                self.on_inference()
            if call == self.fail_inference:
                raise RuntimeError("fake inference failure")
            local = [(left - offset, right - offset, text) for left, right, text in self.words if offset <= left and right <= stop]
            if local:
                yield speech(*local)

        return generate(), SimpleNamespace(language="en", language_probability=0.95)

    def run(self):
        with (
            patch.object(transcriber, "audio_duration", return_value=self.duration),
            patch.object(transcriber, "load_model", side_effect=self.load),
            patch.object(transcriber, "extract_window", side_effect=self.extract),
            contextlib.redirect_stderr(self.statuses),
        ):
            return transcriber.transcribe(self.source, self.output, self.model_dir)

    def checkpoints(self):
        return sorted(self.root.glob("result.json.windows/*/*.json"))


class OwnershipTests(unittest.TestCase):
    def test_half_open_boundary_owns_each_word_once(self):
        absolute = [(298, 299, " before"), (299.5, 300.5, " boundary"), (301, 302, " after")]
        left = transcriber.owned_segments([speech(*absolute)], 0, 0, 300, 600)
        shifted = [(start - 295, end - 295, text) for start, end, text in absolute]
        right = transcriber.owned_segments([speech(*shifted)], 295, 300, 600, 600)
        self.assertEqual([word["text"] for part in left for word in part["words"]], [" before"])
        self.assertEqual([word["text"] for part in right for word in part["words"]], [" boundary", " after"])
        result = transcriber.assemble_segments([
            {"start": 0, "end": 300, "segments": left},
            {"start": 300, "end": 600, "segments": right},
        ])
        self.assertEqual([part["text"] for part in result], ["before", "boundary after"])
        self.assertEqual(result[1]["start"], 300)
        self.assertEqual(result[1]["end"], 302)

    def test_boundary_dedup_preserves_later_intentional_repetition(self):
        windows = [
            {"start": 0, "end": 300, "segments": [record((299.3, 300.1, " Yes,"))]},
            {"start": 300, "end": 600, "segments": [record((299.6, 300.4, " yes"), (301, 302, " yes!"))]},
        ]
        before = copy.deepcopy(windows)
        result = transcriber.assemble_segments(windows)
        self.assertEqual([part["text"] for part in result], ["Yes,", "yes!"])
        self.assertEqual(result[1]["start"], 301)
        self.assertEqual(windows, before, "assembly mutated a reusable checkpoint")

    def test_invalid_or_missing_word_times_fail(self):
        for left, right in [(-1, 1), (2, 1), (0, float("nan")), (0, float("inf")), (99, 102)]:
            with self.subTest(left=left, right=right), self.assertRaisesRegex(RuntimeError, "invalid word timestamps"):
                transcriber.owned_segments([speech((left, right, " bad"))], 0, 0, 100, 100)
        with self.assertRaisesRegex(RuntimeError, "without word timing"):
            transcriber.owned_segments([SimpleNamespace(text="speech", words=None)], 0, 0, 100, 100)


class WindowTests(unittest.TestCase):
    def test_short_exact_boundary_and_long_sources_stay_sequential_and_bounded(self):
        for duration in [0.2, 12.5, 300, 300.2, 3612]:
            with self.subTest(duration=duration), tempfile.TemporaryDirectory() as root:
                harness = TranscriptionHarness(root, duration)
                self.assertEqual(harness.run(), 0)
                count = math.ceil(duration / 300)
                self.assertEqual(harness.loads, 1)
                self.assertEqual(len(harness.model_calls), count)
                self.assertEqual(len(harness.checkpoints()), count)
                expected = [(max(0, index * 300 - 5), min(duration, (index + 1) * 300 + 5)) for index in range(count)]
                self.assertEqual([(start, end) for _, start, end in harness.extractions], expected)
                self.assertTrue(all(not path.parent.exists() for path, _, _ in harness.extractions))
                payload = json.loads(harness.output.read_text(encoding="utf-8"))
                self.assertTrue(payload["complete"])
                self.assertEqual(payload["model"], transcriber.MODEL_NAME)
                self.assertEqual(payload["language"], "en")
                self.assertEqual(payload["probability"], 0.95)
                self.assertEqual(payload["duration"], duration)
                self.assertEqual(payload["windowed"]["windows"], count)
                self.assertEqual([part["text"] for part in payload["segments"]], [f"word-{index}" for index in range(count)])
                self.assertEqual(set(payload["segments"][0]), {"start", "end", "text", "avgLogprob", "noSpeechProbability"})
                self.assertTrue(harness.statuses.getvalue().endswith("PHOENIX_PROGRESS:100\nPHOENIX_STATUS:complete\n"))

    def test_completed_cache_skips_model_and_audio(self):
        with tempfile.TemporaryDirectory() as root:
            harness = TranscriptionHarness(root, 612)
            harness.run()
            before = harness.output.read_bytes()
            harness.run()
            self.assertEqual(harness.loads, 1)
            self.assertEqual(len(harness.extractions), 3)
            self.assertEqual(harness.output.read_bytes(), before)
            self.assertIn("PHOENIX_STATUS:reusing-window-3-of-3", harness.statuses.getvalue())

    def test_interrupted_window_is_cleaned_and_resume_only_decodes_missing_windows(self):
        for failure in ["fail_extract", "fail_inference"]:
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as root:
                harness = TranscriptionHarness(root, 612)
                setattr(harness, failure, 2)
                with self.assertRaisesRegex(RuntimeError, "fake .* failure"):
                    harness.run()
                self.assertFalse(harness.output.exists())
                self.assertEqual(len(harness.checkpoints()), 1)
                checkpoint = harness.checkpoints()[0]
                first_bytes = checkpoint.read_bytes()
                self.assertTrue(all(not path.parent.exists() for path, _, _ in harness.extractions))
                setattr(harness, failure, None)
                harness.run()
                self.assertEqual([(start, end) for _, start, end in harness.extractions], [(0, 305), (295, 605), (295, 605), (595, 612)])
                self.assertEqual(checkpoint.read_bytes(), first_bytes)
                self.assertEqual(len(harness.checkpoints()), 3)

    def test_corrupt_checkpoint_is_recomputed_without_discarding_other_windows(self):
        with tempfile.TemporaryDirectory() as root:
            harness = TranscriptionHarness(root, 612)
            harness.run()
            checkpoints = harness.checkpoints()
            first_bytes = checkpoints[0].read_bytes()
            checkpoints[1].write_text("{interrupted", encoding="utf-8")
            harness.run()
            self.assertEqual(len(harness.extractions), 4)
            self.assertEqual(harness.extractions[-1][1:], (295, 605))
            self.assertEqual(checkpoints[0].read_bytes(), first_bytes)

    def test_source_model_and_configuration_changes_invalidate_cache(self):
        for change in ["source", "model", "options"]:
            with self.subTest(change=change), tempfile.TemporaryDirectory() as root:
                harness = TranscriptionHarness(root, 12)
                harness.run()
                initial = json.loads(harness.output.read_text(encoding="utf-8"))["windowed"]["identity"]
                with contextlib.ExitStack() as stack:
                    if change == "source":
                        harness.source.write_bytes(b"changed source and size")
                    elif change == "model":
                        (harness.model_dir / "model.bin").write_bytes(b"changed model and size")
                    else:
                        stack.enter_context(patch.dict(transcriber.TRANSCRIPTION_OPTIONS, {"beam_size": 4}))
                    harness.run()
                final = json.loads(harness.output.read_text(encoding="utf-8"))["windowed"]["identity"]
                self.assertNotEqual(initial, final)
                self.assertEqual(harness.loads, 2)
                self.assertEqual(len(harness.extractions), 2)

    def test_initial_model_download_uses_new_snapshot_identity(self):
        with tempfile.TemporaryDirectory() as root:
            harness = TranscriptionHarness(root, 12)
            (harness.model_dir / "model.bin").unlink()
            harness.on_load = lambda: (harness.model_dir / "model.bin").write_bytes(b"downloaded placeholder")
            harness.run()
            harness.run()
            self.assertEqual(harness.loads, 1)
            self.assertEqual(len(harness.checkpoints()), 1)
            self.assertEqual(len(harness.extractions), 1)

    def test_source_change_during_decode_does_not_replace_final_output(self):
        with tempfile.TemporaryDirectory() as root:
            harness = TranscriptionHarness(root, 12)
            harness.output.write_bytes(b"previous result")
            harness.on_inference = lambda: harness.source.write_bytes(b"new source with different size")
            with self.assertRaisesRegex(RuntimeError, "changed during transcription"):
                harness.run()
            self.assertEqual(harness.output.read_bytes(), b"previous result")
            self.assertTrue(all(not path.parent.exists() for path, _, _ in harness.extractions))

    def test_source_change_during_model_loading_is_not_accepted_with_stale_duration(self):
        with tempfile.TemporaryDirectory() as root:
            harness = TranscriptionHarness(root, 12)
            harness.on_load = lambda: harness.source.write_bytes(b"new source with different size")
            with self.assertRaisesRegex(RuntimeError, "source changed while"):
                harness.run()
            self.assertEqual(harness.extractions, [])
            self.assertFalse(harness.output.exists())

    def test_model_change_after_reusing_windows_cannot_mix_checkpoints(self):
        with tempfile.TemporaryDirectory() as root:
            harness = TranscriptionHarness(root, 612)
            harness.fail_extract = 2
            with self.assertRaisesRegex(RuntimeError, "fake extraction failure"):
                harness.run()
            harness.fail_extract = None
            harness.on_load = lambda: (harness.model_dir / "model.bin").write_bytes(b"changed model and size")
            with self.assertRaisesRegex(RuntimeError, "model or source changed"):
                harness.run()
            self.assertEqual(len(harness.extractions), 2)
            self.assertFalse(harness.output.exists())

    def test_empty_audio_is_checkpointed_without_inference(self):
        with tempfile.TemporaryDirectory() as root:
            harness = TranscriptionHarness(root, 12)
            harness.empty_audio = True
            harness.run()
            harness.run()
            payload = json.loads(harness.output.read_text(encoding="utf-8"))
            self.assertEqual(payload["segments"], [])
            self.assertEqual(payload["language"], "und")
            self.assertEqual(payload["probability"], 0)
            self.assertEqual(harness.model_calls, [])
            self.assertEqual(len(harness.extractions), 1)


class CheckpointTests(unittest.TestCase):
    def test_invalid_cache_payloads_are_rejected(self):
        valid = {"identity": "key", "complete": True, "start": 0, "end": 300, "language": "en", "probability": 0.95,
                 "segments": [record((1, 2, " first"), (3, 4, " second"))]}
        mutations = [
            lambda value: value.update(identity="old"),
            lambda value: value.update(complete=False),
            lambda value: value.update(start=5),
            lambda value: value.update(end=301),
            lambda value: value.update(segments=None),
            lambda value: value.update(language=None),
            lambda value: value.update(probability=float("nan")),
            lambda value: value.update(probability=1.1),
            lambda value: value.update(probability=10 ** 400),
            lambda value: value["segments"][0].update(words=[]),
            lambda value: value["segments"][0].update(avgLogprob=float("inf")),
            lambda value: value["segments"][0].update(noSpeechProbability=1.1),
            lambda value: value["segments"][0]["words"][0].update(text=" "),
            lambda value: value["segments"][0]["words"][0].update(start=-1, end=1),
            lambda value: value["segments"][0]["words"][0].update(start=2, end=1),
            lambda value: value["segments"][0]["words"][0].update(start=0, end=599),
            lambda value: value["segments"][0]["words"][1].update(start=0, end=1),
            lambda value: value["segments"][0]["words"][1].update(start=299, end=301),
        ]
        with tempfile.TemporaryDirectory() as root:
            filename = Path(root) / "checkpoint.json"
            filename.write_text(json.dumps(valid), encoding="utf-8")
            self.assertEqual(transcriber.cached_window(filename, "key", 0, 300), valid)
            for index, mutate in enumerate(mutations):
                with self.subTest(case=index):
                    invalid = copy.deepcopy(valid)
                    mutate(invalid)
                    filename.write_text(json.dumps(invalid), encoding="utf-8")
                    self.assertIsNone(transcriber.cached_window(filename, "key", 0, 300))
            for invalid in ["{", "null", "[]", '"text"']:
                filename.write_text(invalid, encoding="utf-8")
                self.assertIsNone(transcriber.cached_window(filename, "key", 0, 300))

    def test_atomic_write_failure_preserves_previous_output_and_cleans_temporary_file(self):
        with tempfile.TemporaryDirectory() as root:
            filename = Path(root) / "result.json"
            filename.write_bytes(b"previous result")
            with patch.object(Path, "replace", side_effect=OSError("fake replacement failure")):
                with self.assertRaisesRegex(OSError, "fake replacement failure"):
                    transcriber.atomic_json(filename, {"complete": True})
            self.assertEqual(filename.read_bytes(), b"previous result")
            self.assertEqual(list(Path(root).iterdir()), [filename])


class ExtractionTests(unittest.TestCase):
    def test_ffmpeg_command_uses_bounded_audio_and_disk_diagnostics(self):
        with tempfile.TemporaryDirectory() as root:
            source, output = Path(root) / "source.mp4", Path(root) / "window.wav"

            def run(arguments, **options):
                self.assertEqual(arguments[0], "fake-ffmpeg")
                self.assertEqual(arguments[arguments.index("-ss") + 1], "295.000000")
                self.assertEqual(arguments[arguments.index("-t") + 1], "310.000000")
                self.assertEqual(arguments[arguments.index("-i") + 1], str(source))
                self.assertEqual(arguments[arguments.index("-map") + 1], "0:a:0")
                self.assertEqual(options["timeout"], 620)
                self.assertEqual(options["stdout"], subprocess.DEVNULL)
                self.assertTrue(hasattr(options["stderr"], "fileno"))
                with wave.open(str(output), "wb") as audio:
                    audio.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
                    audio.writeframes(b"\0\0" * 16)
                return SimpleNamespace(returncode=0)

            with patch.object(transcriber, "ffmpeg_executable", return_value="fake-ffmpeg"), patch.object(transcriber.subprocess, "run", side_effect=run):
                self.assertTrue(transcriber.extract_window(source, output, 295, 605))

    def test_decoder_errors_are_concise(self):
        def run(arguments, **options):
            options["stderr"].write(b"x" * 6000 + b" decoder failed")
            return SimpleNamespace(returncode=1)

        with patch.object(transcriber, "ffmpeg_executable", return_value="fake-ffmpeg"), patch.object(transcriber.subprocess, "run", side_effect=run):
            with self.assertRaises(RuntimeError) as raised:
                transcriber.extract_window(Path("source.mp4"), Path("window.wav"), 0, 10)
        self.assertIn("decoder failed", str(raised.exception))
        self.assertLess(len(str(raised.exception)), 2500)

    def test_excess_audio_is_rejected(self):
        fake_audio = SimpleNamespace(getnchannels=lambda: 1, getframerate=lambda: 16000, getsampwidth=lambda: 2, getnframes=lambda: 12 * 16000)
        with (
            patch.object(transcriber, "ffmpeg_executable", return_value="fake-ffmpeg"),
            patch.object(transcriber.subprocess, "run", return_value=SimpleNamespace(returncode=0)),
            patch.object(transcriber.wave, "open", return_value=contextlib.nullcontext(fake_audio)),
        ):
            with self.assertRaisesRegex(RuntimeError, "exceeded its bounded window"):
                transcriber.extract_window(Path("source.mp4"), Path("window.wav"), 0, 10)


if __name__ == "__main__":
    unittest.main(verbosity=2)
