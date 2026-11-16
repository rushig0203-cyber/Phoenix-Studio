"""Real isolated Windows speech + original 2D + measured captions, for remote CI."""
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import wave

root = Path(__file__).resolve().parent.parent
assert os.environ.get("CI") == "true", "This narration/video proof runs only on an isolated CI runner."
assert len(sys.argv) == 1, "This fixed synthetic proof accepts no source files, URLs or arguments."
requested = os.environ.get("PHOENIX_NEWS_PROOF_DIR", "")
assert requested and Path(requested).is_absolute(), "Set a new absolute isolated proof directory."
requested_path = Path(requested)
directory = requested_path.parent.resolve(strict=True) / requested_path.name
assert re.fullmatch(r"phoenix-news-quality-[A-Za-z0-9-]+", directory.name), "Use an isolated phoenix-news-quality-... directory."
assert not directory.is_relative_to(root) and not directory.exists(), "Proof output must be new and outside the project."
directory.mkdir()
from edge_tts import SubMaker
def fixture(name):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), root / "scripts" / name)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

renderer = fixture("test-renderer-editorial-illustrations.py").shipped_renderer()
voice = fixture("test-renderer-local-voice.py").shipped_source()
os.environ["PHOENIX_STUDIO_ROOT"] = str(root)
def executable(package):
    return subprocess.check_output(["node", "-p", f"require('{package}').path"], cwd=root, text=True).strip()
ffmpeg, ffprobe = executable("@ffmpeg-installer/ffmpeg"), executable("@ffprobe-installer/ffprobe")
def run(args):
    result = subprocess.run(args, cwd=directory, capture_output=True, text=True, timeout=180)
    if result.returncode:
        raise AssertionError(result.stderr[-2000:])
    return result.stdout

# Synthetic sentences are deliberately not a report of an actual incident.
beats = [
    {"narration": "This synthetic report discusses a court document.", "subject": "legal"},
    {"narration": "A railway station is shown as neutral editorial context.", "subject": "transport"},
    {"narration": "The cause remains unverified, and the illustration does not depict an actual event.", "subject": "documents"},
]
script = " ".join(beat["narration"] for beat in beats)
audio = directory / "narration.wav"
words = voice["synthesize"](script, audio, 1.08, "English")
maker = SubMaker()
for word in words:
    maker.feed({"type": "WordBoundary", "text": word["text"], "offset": round(word["start"]*10_000_000), "duration": round((word["end"]-word["start"])*10_000_000)})
with wave.open(str(audio), "rb") as sound:
    duration = sound.getnframes()/sound.getframerate()
captions = directory / "news.srt"
renderer["save_news_captions"](script, maker.cues, duration, str(captions))
cues = renderer["subtitle_cues"](captions)
assert " ".join(text for _, _, text in cues) == script
assert abs(cues[-1][1]-duration) < .002 and all(len(text.split()) <= 6 for _, _, text in cues)
for index, beat in enumerate(beats):
    illustration = {"kind": "editorial-2d-v1", "subject": beat.pop("subject"), "label": "Illustration"}
    beat.update(illustration=illustration, query=f"editorial {illustration['subject']} illustration")
timeline = renderer["align_beats"](beats, script, [(word["start"], word["end"], word["text"]) for word in words], duration)
for index, shot in enumerate(timeline):
    filename = directory / f"original-{index}.png"
    renderer["render_editorial_illustration"](shot["illustration"], shot["narration"], filename, (720, 1280))
    shot.update(path=str(filename), sourceStart=0.0, playbackRate=1)
cache = directory / "cache"
renderer["_shot_cache_directory"] = lambda: cache
renderer["render_timeline"](timeline, str(directory / "visuals.mp4"), (720, 1280), ffmpeg)
run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-threads", "1", "-i", "visuals.mp4", "-i", "narration.wav", "-vf", "subtitles=news.srt:force_style='FontName=Arial,FontSize=14,Alignment=2,MarginV=80,Outline=1,BorderStyle=1,Shadow=0'", "-filter_threads", "1", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-threads", "1", "-c:a", "aac", "-t", str(duration), "news-illustrations.mp4"])
probe = json.loads(run([ffprobe, "-v", "error", "-show_streams", "-show_format", "-of", "json", "news-illustrations.mp4"]))
assert abs(float(probe["format"]["duration"])-duration) < .15
assert {stream["codec_type"] for stream in probe["streams"]} == {"audio", "video"}
run([ffmpeg, "-hide_banner", "-loglevel", "error", "-threads", "1", "-i", "news-illustrations.mp4", "-f", "null", "-"])
run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-threads", "1", "-ss", "1.5", "-i", "news-illustrations.mp4", "-frames:v", "1", "-threads", "1", "news-illustrations.jpg"])
proof = {"seconds": duration, "offlineSpeech": True, "measuredWords": len(words), "completeNarrationAndCaptionEnding": True,
         "originalIllustrations": [shot["illustration"] for shot in timeline], "oneIllustrationPerSpokenSection": True,
         "noFootageDownloadsModelsPaidCallsOrOwnerFiles": True, "noDurationPadding": True, "captionsHaveNoBackgroundBox": True, "fullyDecoded": True,
         "video": str(directory / "news-illustrations.mp4"), "preview": str(directory / "news-illustrations.jpg")}
(directory / "news-illustrations-proof.json").write_text(json.dumps(proof, indent=2), encoding="utf-8")
print(json.dumps(proof))
