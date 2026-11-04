"""Exercise the shipped offline adapter without importing models or providers."""
import copy
import math
from pathlib import Path
import unittest
from unittest.mock import patch


def shipped_source():
    patch = (Path(__file__).resolve().parent.parent / "integrations/moneyprinterturbo-local.patch").read_text(encoding="utf-8")
    lines, selected = [], False
    for line in patch.splitlines():
        if line.startswith("diff --git "):
            selected = line == "diff --git a/app/services/phoenix_local_voice.py b/app/services/phoenix_local_voice.py"
        elif selected and line.startswith("+") and not line.startswith("+++"):
            lines.append(line[1:])
    if not lines:
        raise AssertionError("The offline speech adapter was not shipped.")
    namespace = {"__name__": "phoenix_local_voice_test"}
    exec(compile("\n".join(lines), "shipped-local-voice.py", "exec"), namespace)
    return namespace


class TestLocalVoice(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.adapter = shipped_source()

    def test_actual_words_use_recorded_onsets_and_pcm_end(self):
        timing = {"version": 1, "source": "windows-speech-events", "words": [
            {"text": "Thread", "seconds": .2}, {"text": "the", "seconds": .7}, {"text": "needle.", "seconds": .85}]}
        before = copy.deepcopy(timing)
        cues = self.adapter["measured_words"]("Thread the needle.", timing, 1.7)
        self.assertEqual(cues, [{"text": "Thread", "start": .2, "end": .7}, {"text": "the", "start": .7, "end": .85}, {"text": "needle.", "start": .85, "end": 1.7}])
        self.assertEqual(timing, before)

    def test_incomplete_changed_or_invented_words_are_not_caption_success(self):
        for spoken in ("Thread", "Needle", "Thread a needle", "Thread the needle now"):
            timing = {"version": 1, "source": "windows-speech-events", "words": [{"text": spoken, "seconds": .1}]}
            with self.assertRaises(ValueError):
                self.adapter["measured_words"]("Thread the needle.", timing, 2)

    def test_duplicate_expanded_number_keeps_first_onset_and_following_boundary(self):
        # SAPI reports UTF-16 offsets. The emoji before the first number uses two units.
        text = "🚆 Wait 24 hours or 24 minutes."
        words = [
            {"text": "Wait", "seconds": .2, "characterPosition": 3},
            {"text": "24", "seconds": .8, "characterPosition": 8},
            {"text": "24", "seconds": 1.1, "characterPosition": 8},
            {"text": "hours", "seconds": 1.4, "characterPosition": 11},
            {"text": "or", "seconds": 1.8, "characterPosition": 17},
            {"text": "24", "seconds": 2, "characterPosition": 20},
            {"text": "minutes", "seconds": 2.7, "characterPosition": 23},
        ]
        timing = {"version": 1, "source": "windows-speech-events", "words": words}
        before = copy.deepcopy(timing)
        cues = self.adapter["measured_words"](text, timing, 3.5)
        self.assertEqual([cue["text"] for cue in cues], ["Wait", "24", "hours", "or", "24", "minutes"])
        self.assertEqual(cues[1], {"text": "24", "start": .8, "end": 1.4})
        self.assertEqual(cues[4], {"text": "24", "start": 2, "end": 2.7})
        self.assertEqual(timing, before)

        # Duplicate text with a different, unproven source position must fail.
        words[2]["characterPosition"] = 20
        with self.assertRaisesRegex(ValueError, "complete narration"):
            self.adapter["measured_words"](text, timing, 3.5)
        words[1]["characterPosition"] = words[2]["characterPosition"] = 7
        with self.assertRaisesRegex(ValueError, "complete narration"):
            self.adapter["measured_words"](text, timing, 3.5)
        words[1]["characterPosition"] = words[2]["characterPosition"] = 8
        words[2]["seconds"] = .7
        with self.assertRaisesRegex(ValueError, "actual recording"):
            self.adapter["measured_words"](text, timing, 3.5)

    def test_malformed_unbounded_and_wrong_clock_evidence_is_rejected(self):
        valid = {"version": 1, "source": "windows-speech-events", "words": [{"text": "Thread", "seconds": .1}]}
        for changed in ({"source": "estimated"}, {"version": 2}, {"words": []}, {"words": [None]},
                        {"words": [{"text": "Thread", "seconds": -1}]}, {"words": [{"text": "Thread", "seconds": math.nan}]},
                        {"words": [{"text": "Thread", "seconds": 3}]}):
            with self.assertRaises(ValueError):
                self.adapter["measured_words"]("Thread", {**valid, **changed}, 2)
        for seconds in (0, -1, math.inf, 901):
            with self.assertRaises(ValueError):
                self.adapter["measured_words"]("Thread", valid, seconds)

    def test_local_adapter_has_no_network_or_model_import_and_uses_fixed_script(self):
        source = self.adapter["synthesize"].__code__.co_names
        self.assertNotIn("requests", source)
        self.assertNotIn("edge_tts", source)
        self.assertNotIn("onnxruntime", source)
        root = Path(__file__).resolve().parent.parent
        generation = (root / "src/lib/generation.ts").read_text(encoding="utf-8")
        self.assertNotIn('prepared.voice === "local-windows-voice" ? "en-US-JennyNeural-Female"', generation)
        self.assertIn("voice_name: prepared.voice", generation)
        self.assertIn("phoenix_local_voice_protocol:", generation)
        launcher = (root / "scripts/start-phoenix.ps1").read_text(encoding="utf-8")
        self.assertIn("$env:PHOENIX_STUDIO_ROOT = $phoenixRoot", launcher)

    def test_other_languages_do_not_silently_become_english(self):
        with patch.object(self.adapter["os"], "name", "nt"):
            with self.assertRaisesRegex(ValueError, "substitute English"):
                self.adapter["synthesize"]("Une phrase.", "not-created.wav", 1.0, "French")


if __name__ == "__main__":
    unittest.main(verbosity=2)
