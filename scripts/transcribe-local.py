import argparse
import hashlib
import importlib.metadata
import importlib.util
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import wave
from pathlib import Path
from typing import Any


MODEL_NAME = os.environ.get("PHOENIX_WHISPER_MODEL", "base").strip() or "base"
WINDOW_SECONDS = 300.0
CONTEXT_SECONDS = 5.0
TRANSCRIPTION_OPTIONS = {
    "beam_size": 3,
    "vad_filter": True,
    "vad_parameters": {"min_silence_duration_ms": 500},
    "word_timestamps": True,
}


def model_marker(model_dir: Path) -> Path:
    safe_name = "".join(character if character.isalnum() else "-" for character in MODEL_NAME)
    return model_dir / f".phoenix-{safe_name}-ready"


def local_cpu_threads() -> int:
    try:
        return max(1, min(2, int(os.environ.get("PHOENIX_TRANSCRIBE_THREADS", "2"))))
    except ValueError:
        return 2


def model_is_cached(model_dir: Path) -> bool:
    """A usable faster-whisper snapshot contains a non-empty CTranslate2 model.bin."""
    if not model_dir.exists() or not model_marker(model_dir).is_file():
        return False
    try:
        return any(
            candidate.is_file() and candidate.stat().st_size > 0
            for candidate in model_dir.rglob("model.bin")
        )
    except OSError:
        return False


def preflight(model_dir: Path) -> int:
    installed = False
    import_error = ""
    if importlib.util.find_spec("faster_whisper") is not None:
        try:
            import faster_whisper  # noqa: F401

            installed = True
        except Exception as error:
            import_error = str(error)
    cached = model_is_cached(model_dir)
    detail = (
        "faster-whisper is installed."
        if installed
        else (
            f"faster-whisper was found but could not be imported: {import_error}"
            if import_error
            else "faster-whisper is not installed in this Python environment."
        )
    )
    print(
        json.dumps(
            {
                "python": True,
                "fasterWhisper": installed,
                "model": MODEL_NAME,
                "modelCached": cached,
                "detail": detail,
            }
        )
    )
    return 0


def status(value: str) -> None:
    print(f"PHOENIX_STATUS:{value}", file=sys.stderr, flush=True)


def progress(value: int) -> None:
    print(f"PHOENIX_PROGRESS:{max(0, min(100, value))}", file=sys.stderr, flush=True)


def load_model(model_dir: Path):
    cpu_threads = local_cpu_threads()
    # CTranslate2 and its math libraries otherwise try to occupy every core.
    # Set these before importing faster-whisper so the limits are inherited.
    os.environ.setdefault("OMP_NUM_THREADS", str(cpu_threads))
    os.environ.setdefault("MKL_NUM_THREADS", str(cpu_threads))
    try:
        from faster_whisper import WhisperModel
    except ImportError as error:
        raise RuntimeError(
            "faster-whisper is not installed in the configured Python environment."
        ) from error

    model_dir.mkdir(parents=True, exist_ok=True)
    if not model_is_cached(model_dir):
        status("first-model-download")
    else:
        status("model-loading")
    model = WhisperModel(
        MODEL_NAME,
        device="cpu",
        compute_type="int8",
        cpu_threads=cpu_threads,
        num_workers=1,
        download_root=str(model_dir),
    )
    marker = model_marker(model_dir)
    marker_temporary = marker.with_name(f"{marker.name}.{os.getpid()}.tmp")
    marker_temporary.write_text("ready\n", encoding="utf-8")
    marker_temporary.replace(marker)
    status("model-ready")
    return model


def audio_duration(input_path: Path) -> float:
    # Container metadata only: passing the episode itself to Whisper decodes its
    # entire audio into RAM, even when clip_timestamps is supplied.
    import av

    with av.open(str(input_path), mode="r", metadata_errors="ignore") as container:
        if not container.streams.audio:
            raise RuntimeError("The source has no audio stream to transcribe.")
        stream = container.streams.audio[0]
        value = (
            float(stream.duration * stream.time_base)
            if stream.duration is not None and stream.time_base is not None
            else float(container.duration or 0) / av.time_base
        )
    if not math.isfinite(value) or value <= 0:
        raise RuntimeError("Cannot determine a finite source audio duration for bounded transcription.")
    return value


def ffmpeg_executable() -> str:
    configured = os.environ.get("PHOENIX_FFMPEG_PATH", "").strip()
    if configured:
        return configured
    platform_name = "win32-x64" if sys.platform == "win32" else ("darwin-arm64" if sys.platform == "darwin" and os.uname().machine == "arm64" else f"{sys.platform}-x64")
    bundled = Path(__file__).resolve().parent.parent / "node_modules" / "@ffmpeg-installer" / platform_name / ("ffmpeg.exe" if sys.platform == "win32" else "ffmpeg")
    if bundled.is_file():
        return str(bundled)
    installed = shutil.which("ffmpeg")
    if not installed:
        raise RuntimeError("FFmpeg is required to extract bounded transcription audio. Configure PHOENIX_FFMPEG_PATH.")
    return installed


def extract_window(input_path: Path, output_path: Path, start: float, end: float) -> bool:
    length = end - start
    arguments = [
        ffmpeg_executable(), "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
        "-threads", "1", "-ss", f"{start:.6f}", "-t", f"{length:.6f}", "-i", str(input_path),
        "-map", "0:a:0", "-vn", "-sn", "-dn", "-filter_threads", "1",
        "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-threads", "1", str(output_path),
    ]
    flags = (subprocess.CREATE_NO_WINDOW | subprocess.BELOW_NORMAL_PRIORITY_CLASS) if sys.platform == "win32" else 0
    # Decoder output and diagnostics stay on disk. One window is at most 310s.
    with tempfile.TemporaryFile() as diagnostic:
        result = subprocess.run(arguments, stdout=subprocess.DEVNULL, stderr=diagnostic,
                                timeout=max(60, math.ceil(length * 2)), creationflags=flags, check=False)
        if result.returncode:
            diagnostic.seek(0, os.SEEK_END)
            diagnostic.seek(max(0, diagnostic.tell() - 2400))
            detail = diagnostic.read().decode("utf-8", errors="replace").strip()
            raise RuntimeError(f"Audio window {start:.1f}–{end:.1f}s could not be decoded: {detail or result.returncode}")
    with wave.open(str(output_path), "rb") as audio:
        if audio.getnchannels() != 1 or audio.getframerate() != 16000 or audio.getsampwidth() != 2:
            raise RuntimeError("The extracted audio window has an unexpected format.")
        if audio.getnframes() > math.ceil((length + 1) * 16000):
            raise RuntimeError("The audio decoder exceeded its bounded window.")
        return audio.getnframes() > 0


def transcription_identity(input_path: Path, model_dir: Path, duration: float) -> dict[str, Any]:
    source = input_path.resolve()
    stats = source.stat()
    try:
        package_version = importlib.metadata.version("faster-whisper")
    except importlib.metadata.PackageNotFoundError:
        package_version = "unavailable"
    snapshots = []
    for candidate in sorted(model_dir.glob("**/model.bin")):
        stat = candidate.stat()
        snapshots.append([str(candidate.relative_to(model_dir)), stat.st_size, stat.st_mtime_ns])
    return {
        "version": 2, "source": str(source), "size": stats.st_size, "mtimeNs": stats.st_mtime_ns,
        "duration": duration, "model": MODEL_NAME, "modelDirectory": str(model_dir.resolve()),
        "snapshots": snapshots, "engineVersion": package_version,
        "device": "cpu", "computeType": "int8", "threads": local_cpu_threads(),
        "windowSeconds": WINDOW_SECONDS, "contextSeconds": CONTEXT_SECONDS,
        "options": TRANSCRIPTION_OPTIONS,
    }


def identity_key(identity: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(identity, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def atomic_json(destination: Path, payload: dict[str, Any]) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f"{destination.name}.{os.getpid()}.tmp")
    try:
        temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


def owned_segments(segments, offset: float, owner_start: float, owner_end: float, duration: float, on_progress=None):
    result = []
    for item in segments:
        words = getattr(item, "words", None)
        if item.text.strip() and not words:
            raise RuntimeError("Whisper returned speech without word timing; the window cannot be joined safely.")
        owned = []
        for word in words or []:
            start, end = offset + float(word.start), offset + float(word.end)
            if not math.isfinite(start) or not math.isfinite(end) or start < 0 or end < start or end > duration + 1:
                raise RuntimeError("Whisper returned invalid word timestamps.")
            midpoint = (start + end) / 2
            # Half-open ownership prevents context words from being emitted twice.
            if owner_start <= midpoint < owner_end and str(word.word).strip():
                owned.append({"start": start, "end": end, "text": str(word.word)})
        if owned:
            result.append({
                "words": owned,
                "avgLogprob": round(float(getattr(item, "avg_logprob", 0.0)), 4),
                "noSpeechProbability": round(float(getattr(item, "no_speech_prob", 0.0)), 4),
            })
            if on_progress is not None:
                on_progress(min(owner_end, owned[-1]["end"]))
    return result


def cached_window(filename: Path, key: str, start: float, end: float):
    try:
        value = json.loads(filename.read_text(encoding="utf-8"))
        if value.get("identity") != key or value.get("complete") is not True or value.get("start") != start or value.get("end") != end:
            return None
        if not isinstance(value.get("segments"), list) or not isinstance(value.get("language"), str):
            return None
        if not math.isfinite(value["probability"]) or not 0 <= value["probability"] <= 1:
            return None
        previous = max(0, start - CONTEXT_SECONDS)
        for segment in value["segments"]:
            if not isinstance(segment["words"], list) or not segment["words"]:
                return None
            if not math.isfinite(segment["avgLogprob"]) or not math.isfinite(segment["noSpeechProbability"]) or not 0 <= segment["noSpeechProbability"] <= 1:
                return None
            for word in segment["words"]:
                left, right = word["start"], word["end"]
                if not all(math.isfinite(number) for number in [left, right]) or left < previous or right < left or right > end + CONTEXT_SECONDS + 1 or not start <= (left + right) / 2 < end or not isinstance(word["text"], str) or not word["text"].strip():
                    return None
                previous = left
        return value
    except (OSError, ValueError, TypeError, KeyError, AttributeError, OverflowError):
        return None


def same_boundary_word(left, right) -> bool:
    # A repeated word is only removed when both decodes put it at substantially
    # the same audio time. Text equality alone would erase intentional repetition.
    normalise = lambda text: re.sub(r"[^\w]", "", text, flags=re.UNICODE).casefold()
    if not normalise(left["text"]) or normalise(left["text"]) != normalise(right["text"]):
        return False
    overlap = min(left["end"], right["end"]) - max(left["start"], right["start"])
    shorter = min(left["end"] - left["start"], right["end"] - right["start"])
    return shorter > 0 and overlap >= shorter * 0.5


def assemble_segments(windows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result = []
    previous_words = []
    for window in windows:
        records = [dict(segment, words=list(segment["words"])) for segment in window["segments"]]
        leading = [word for record in records for word in record["words"]][:12]
        duplicate_count = 0
        for count in range(1, min(len(previous_words), len(leading)) + 1):
            if all(same_boundary_word(left, right) for left, right in zip(previous_words[-count:], leading[:count])):
                duplicate_count = count
        for record in records:
            words = record["words"]
            skipped = min(duplicate_count, len(words))
            duplicate_count -= skipped
            words = words[skipped:]
            if not words:
                continue
            start = max(window["start"], words[0]["start"])
            end = min(window["end"], words[-1]["end"])
            if end <= start:
                raise RuntimeError("A speech window produced an empty owned caption interval.")
            text = "".join(word["text"] for word in words).strip()
            result.append({"start": round(start, 3), "end": round(end, 3), "text": text,
                           "avgLogprob": record["avgLogprob"], "noSpeechProbability": record["noSpeechProbability"]})
            previous_words = (previous_words + words)[-12:]
    return result


def transcribe(input_path: Path, output_path: Path, model_dir: Path, duration_limit: float | None = None) -> int:
    duration = audio_duration(input_path)
    if duration_limit is not None:
        if not math.isfinite(duration_limit) or duration_limit <= 0:
            raise RuntimeError("Invalid transcription duration limit.")
        duration = min(duration, duration_limit)
    identity = transcription_identity(input_path, model_dir, duration)
    key = identity_key(identity)
    checkpoint_root = output_path.parent / f"{output_path.name}.windows"
    model = None
    windows = []
    last_progress = -1

    def report_progress(seconds):
        nonlocal last_progress
        value = min(99, int(seconds / duration * 100))
        if value >= last_progress + 2:
            progress(value)
            last_progress = value

    window_count = math.ceil(duration / WINDOW_SECONDS)
    for index in range(window_count):
        start, end = index * WINDOW_SECONDS, min(duration, (index + 1) * WINDOW_SECONDS)
        checkpoint = checkpoint_root / key / f"{index:06d}.json"
        saved = cached_window(checkpoint, key, start, end)
        if saved is None:
            if model is None:
                model = load_model(model_dir)
                # A first download changes the snapshot inventory. Do not mix
                # cached windows if the model changed while this job was starting.
                loaded_identity = transcription_identity(input_path, model_dir, duration)
                if any(loaded_identity[field] != identity[field] for field in ("source", "size", "mtimeNs", "duration")):
                    raise RuntimeError("The source changed while the transcription model was loading; retry with consistent input.")
                loaded_key = identity_key(loaded_identity)
                if loaded_key != key:
                    if windows:
                        raise RuntimeError("The transcription model or source changed; retry to use consistent checkpoints.")
                    identity, key = loaded_identity, loaded_key
                    checkpoint = checkpoint_root / key / f"{index:06d}.json"
            offset, stop = max(0, start - CONTEXT_SECONDS), min(duration, end + CONTEXT_SECONDS)
            status(f"window-{index + 1}-of-{window_count}")
            checkpoint.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.TemporaryDirectory(prefix=f"audio-{index:06d}-", dir=checkpoint.parent) as temporary:
                audio_path = Path(temporary) / "window.wav"
                if extract_window(input_path, audio_path, offset, stop):
                    segments, info = model.transcribe(str(audio_path), **TRANSCRIPTION_OPTIONS)
                    owned = owned_segments(segments, offset, start, end, duration, report_progress)
                    language, probability = str(info.language), float(info.language_probability)
                else:
                    owned, language, probability = [], "und", 0.0
            saved = {"complete": True, "identity": key, "start": start, "end": end,
                     "language": language, "probability": probability, "segments": owned}
            atomic_json(checkpoint, saved)
            if cached_window(checkpoint, key, start, end) is None:
                raise RuntimeError(f"Transcription window {index + 1} failed checkpoint validation.")
        else:
            status(f"reusing-window-{index + 1}-of-{window_count}")
        windows.append(saved)
        report_progress(end)
    if identity_key(transcription_identity(input_path, model_dir, duration)) != key:
        raise RuntimeError("The source or transcription model changed during transcription; retry with consistent input.")
    spoken = [window for window in windows if window["segments"]]
    language_window = max(spoken or windows, key=lambda window: window["probability"])

    payload = {
        "complete": True,
        "model": MODEL_NAME,
        "language": language_window["language"],
        "probability": language_window["probability"],
        "duration": duration,
        "segments": assemble_segments(windows),
        "windowed": {"version": 2, "identity": key, "windowSeconds": WINDOW_SECONDS, "contextSeconds": CONTEXT_SECONDS, "windows": window_count},
    }
    atomic_json(output_path, payload)
    progress(100)
    status("complete")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--input")
    parser.add_argument("--output")
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--duration", type=float)
    args = parser.parse_args()

    model_dir = Path(args.model_dir)
    if args.check:
        return preflight(model_dir)
    if not args.input or not args.output:
        parser.error("--input and --output are required unless --check is used")
    return transcribe(Path(args.input), Path(args.output), model_dir, args.duration)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # A concise final line is surfaced in the job UI.
        print(f"Local transcription failed: {error}", file=sys.stderr)
        raise SystemExit(1)
