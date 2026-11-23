"""Isolated public-footage + real local-narration mini-document proof.

Runs only on a disposable Windows CI worker. Uses two fixed Pexels clips, the
shipped MoneyPrinterTurbo storyboard helpers and Phoenix's offline SAPI adapter.
No owner media, saved jobs, model provider, posting provider or publication.
"""
import importlib.util
import ctypes
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import urllib.request
import wave
from datetime import timedelta
from types import SimpleNamespace

project = Path(__file__).resolve().parent.parent
assert os.environ.get("CI") == "true", "This proof runs only on an isolated CI runner."
assert len(sys.argv) == 1, "The fixed proof accepts no URLs, scripts or other arguments."
assert os.name == "nt", "Real local Windows speech requires a Windows CI runner."
requested = os.environ.get("PHOENIX_NATURE_PROOF_DIR", "")
assert requested and Path(requested).is_absolute(), "Set a new absolute proof directory outside the project."
requested_path = Path(requested)
directory = requested_path.parent.resolve(strict=True) / requested_path.name
assert re.fullmatch(r"phoenix-nature-mini-doc-[A-Za-z0-9-]+", directory.name), "Use phoenix-nature-mini-doc-... for the proof directory."
assert not directory.is_relative_to(project) and not directory.exists(), "Proof output must be new and outside the project."


def fixture(name):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), project / "scripts" / name)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# These existing fixtures extract the exact additions from the shipped patch;
# no alternate renderer or narration implementation is copied into this proof.
renderer = fixture("test-renderer-editorial-illustrations.py").shipped_renderer()
voice = fixture("test-renderer-local-voice.py").shipped_source()
os.environ["PHOENIX_STUDIO_ROOT"] = str(project)


def executable(package):
    value = subprocess.check_output(["node", "-p", f"require('{package}').path"], cwd=project, text=True).strip()
    path = Path(value).resolve(strict=True)
    assert path.is_file()
    return str(path)


ffmpeg = executable("@ffmpeg-installer/ffmpeg")
ffprobe = executable("@ffprobe-installer/ffprobe")


def run(args, cwd=directory, timeout=240):
    result = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise AssertionError(result.stderr[-2500:])
    return result.stdout


def probe(filename):
    data = json.loads(run([ffprobe, "-v", "error", "-show_streams", "-show_format", "-of", "json", str(filename)]))
    streams = data.get("streams", [])
    video = next((stream for stream in streams if stream.get("codec_type") == "video"), None)
    audio = next((stream for stream in streams if stream.get("codec_type") == "audio"), None)
    assert video is not None
    return {"duration": float(data["format"]["duration"]), "width": int(video["width"]),
            "height": int(video["height"]), "hasAudio": audio is not None,
            "streams": sorted(stream.get("codec_type") for stream in streams)}


def available_memory_mib():
    from ctypes import c_ulong, c_ulonglong
    status_type = type("MEMORYSTATUSEX", (ctypes.Structure,), {"_fields_": [
        ("dwLength", c_ulong), ("dwMemoryLoad", c_ulong), ("ullTotalPhys", c_ulonglong),
        ("ullAvailPhys", c_ulonglong), ("ullTotalPageFile", c_ulonglong), ("ullAvailPageFile", c_ulonglong),
        ("ullTotalVirtual", c_ulonglong), ("ullAvailVirtual", c_ulonglong), ("ullAvailExtendedVirtual", c_ulonglong)]})
    status = status_type()
    status.dwLength = ctypes.sizeof(status)
    if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
        return 0
    return status.ullAvailPhys // (1024 * 1024)


fixtures = [
    {"assetId": 36918287, "sourcePage": "https://www.pexels.com/video/man-strolling-in-lush-green-park-with-blossoming-trees-36918287/",
     "url": "https://videos.pexels.com/video-files/36918287/15639615_720_1280_60fps.mp4"},
    {"assetId": 38687742, "sourcePage": "https://www.pexels.com/video/peaceful-park-path-with-green-trees-38687742/",
     "url": "https://videos.pexels.com/video-files/38687742/16433318_720_1280_60fps.mp4"},
]
beats = [
    {"query": "park blossoming trees",
     "narration": "Blossoming trees frame the path through this green park."},
    {"query": "park path green trees",
     "narration": "Along another stretch, green branches frame the path. The trees give the walk its sense of shelter."},
]
script = " ".join(beat["narration"] for beat in beats)


def download_public_clip(fixture, destination):
    from urllib.parse import urlparse
    url = urlparse(fixture["url"])
    assert url.scheme == "https" and url.hostname == "videos.pexels.com" and not url.username and not url.password
    request = urllib.request.Request(fixture["url"], headers={"User-Agent": "PhoenixStudio isolated verification/1.0"})
    temporary = destination.with_suffix(".partial")
    received = 0
    try:
        with urllib.request.urlopen(request, timeout=90) as response, temporary.open("xb") as output:
            final = urlparse(response.geturl())
            assert final.scheme == "https" and final.hostname == "videos.pexels.com"
            assert response.status == 200 and response.headers.get_content_type().startswith("video/")
            declared = response.headers.get("Content-Length")
            assert not declared or int(declared) <= 40 * 1024 * 1024, "Public clip exceeds its per-file byte cap."
            while True:
                chunk = response.read(64 * 1024)
                if not chunk:
                    break
                received += len(chunk)
                assert received <= 40 * 1024 * 1024, "Public clip exceeds its per-file byte cap."
                output.write(chunk)
        assert received > 0
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
    media = probe(destination)
    assert media["width"] == 720 and media["height"] == 1280 and media["duration"] > 4
    return {**media, "bytes": received}


if __name__ == "__main__":
    free_mib = available_memory_mib()
    assert free_mib >= 900, f"Nature mini-doc proof needs at least 900 MiB free; found {free_mib} MiB. No download or render started."
    directory.mkdir()
    with tempfile.TemporaryDirectory(prefix="phoenix-nature-public-", dir=directory) as temporary:
        sources = Path(temporary)
        downloaded = []
        aggregate = 0
        for index, fixture_item in enumerate(fixtures, 1):
            filename = sources / f"source-{index}.mp4"
            info = download_public_clip(fixture_item, filename)
            aggregate += info["bytes"]
            assert aggregate <= 80 * 1024 * 1024, "Public source downloads exceeded the aggregate byte cap."
            downloaded.append((fixture_item, filename, info))

        audio = directory / "narration.wav"
        observed = voice["synthesize"](script, audio, 1.0, "English")
        with wave.open(str(audio), "rb") as recording:
            audio_duration = recording.getnframes() / recording.getframerate()
        assert 2 < audio_duration < 60 and observed
        observed_cues = [SimpleNamespace(content=word["text"], start=timedelta(seconds=word["start"]),
                                         end=timedelta(seconds=word["end"])) for word in observed]
        speech_spans = renderer["audio_speech_spans"](audio, audio_duration, ffmpeg)
        measured = renderer["measured_narration_cues"](script, observed_cues, audio_duration, speech_spans)
        captions = directory / "captions.srt"
        renderer["save_narration_captions"](script, measured, str(captions), scene_narration=[beat["narration"] for beat in beats])
        assert " ".join(text for _, _, text in renderer["subtitle_cues"](captions)) == script

        timeline = renderer["align_beats"](beats, script, measured, audio_duration, strict=True)
        for index, shot in enumerate(timeline):
            fixture_item, filename, info = downloaded[index]
            source_start = 1.0
            source_end = source_start + (shot["end"] - shot["start"])
            assert source_end <= info["duration"] - 0.15, "Selected public footage does not cover the spoken section at native speed."
            shot.update(path=str(filename), sourceStart=source_start, sourcePage=fixture_item["sourcePage"],
                        playbackRate=1, assetId=fixture_item["assetId"])
        renderer["_shot_cache_directory"] = lambda: sources / "shot-cache"
        visuals = sources / "visuals.mp4"
        renderer["render_timeline"](timeline, str(visuals), (720, 1280), ffmpeg)

        clean = directory / "clean.mp4"
        run([ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-threads", "1", "-i", str(visuals),
             "-threads", "1", "-i", str(audio), "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac",
             "-b:a", "128k", "-shortest", "-movflags", "+faststart", str(clean)])
        final = directory / "final.mp4"
        run([ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-threads", "1", "-i", str(visuals),
             "-threads", "1", "-i", str(audio), "-vf",
             "subtitles=captions.srt:force_style='FontName=Arial,FontSize=14,Alignment=2,MarginV=80,Outline=1,BorderStyle=1,Shadow=0',setsar=1",
             "-filter_threads", "1", "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-preset", "veryfast",
             "-crf", "20", "-pix_fmt", "yuv420p", "-threads", "1", "-c:a", "aac", "-b:a", "128k",
             "-t", f"{audio_duration:.6f}", "-movflags", "+faststart", str(final)])

        clean_info, final_info = probe(clean), probe(final)
        assert clean_info["streams"] == ["audio", "video"] and final_info["streams"] == ["audio", "video"]
        assert clean_info["width"] == final_info["width"] == 720 and clean_info["height"] == final_info["height"] == 1280
        assert abs(final_info["duration"] - audio_duration) < 0.15 and abs(clean_info["duration"] - audio_duration) < 0.15
        for output in (clean, final):
            run([ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-threads", "1", "-i", str(output), "-f", "null", "-"])

        proof_shots = []
        for index, shot in enumerate(timeline):
            fixture_item = fixtures[index]
            proof_shots.append({"assetId": shot["assetId"], "query": shot["query"], "narration": shot["narration"],
                                "start": shot["start"], "end": shot["end"], "sourceStart": shot["sourceStart"],
                                "sourceEnd": shot["sourceStart"] + (shot["end"] - shot["start"]),
                                "timing": shot["timing"], "playbackRate": shot["playbackRate"],
                                "sourcePage": fixture_item["sourcePage"]})
        proof = {"recommendationId": "catalogue-8-0", "script": script, "shots": proof_shots,
                 "width": 720, "height": 1280, "duration": audio_duration,
                 "outputs": {filename.name: {"bytes": filename.stat().st_size for filename in (final, clean, captions, audio)},
                             "final": str(final), "clean": str(clean), "captions": str(captions), "narration": str(audio)},
                 "publicFootage": True, "narration": "Local Windows SAPI speech events; no online speech provider",
                 "timeline": "Shipped production audio_speech_spans, measured_narration_cues, align_beats(strict=True), save_narration_captions and render_timeline",
                 "fullyDecoded": True, "ownerFilesRead": 0, "ownerJobsRead": 0, "providerCalls": 0,
                 "licence": "https://www.pexels.com/license/",
                 "note": "Synthetic descriptive nature script; public clips and original local speech only. This media proof does not itself create a persisted Review or invoke posting analysis."}
        proof_path = directory / "proof.json"
        proof_path.write_text(json.dumps(proof, indent=2), encoding="utf-8")
        assert sorted(path.name for path in directory.iterdir()) == ["captions.srt", "clean.mp4", "final.mp4", "narration.wav", "proof.json"]
        print(json.dumps({"proof": str(proof_path), "duration": audio_duration, "shots": len(proof_shots),
                          "finalBytes": final.stat().st_size, "cleanBytes": clean.stat().st_size, "fullyDecoded": True}))
