import argparse
import importlib.util
import json
import os
import sys
from pathlib import Path
from typing import Any


MODEL_NAME = os.environ.get("PHOENIX_WHISPER_MODEL", "base").strip() or "base"


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


def transcribe(input_path: Path, output_path: Path, model_dir: Path) -> int:
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
    segments, info = model.transcribe(
        str(input_path),
        beam_size=3,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
        word_timestamps=False,
    )
    duration = max(float(getattr(info, "duration", 0.0) or 0.0), 0.001)
    payload_segments: list[dict[str, Any]] = []
    last_progress = -1
    for item in segments:
        text = item.text.strip()
        if text:
            payload_segments.append(
                {
                    "start": round(item.start, 3),
                    "end": round(item.end, 3),
                    "text": text,
                    "avgLogprob": round(float(getattr(item, "avg_logprob", 0.0)), 4),
                    "noSpeechProbability": round(
                        float(getattr(item, "no_speech_prob", 0.0)), 4
                    ),
                }
            )
        current_progress = int(min(100.0, max(0.0, item.end / duration * 100.0)))
        if current_progress >= last_progress + 2:
            progress(current_progress)
            last_progress = current_progress

    payload = {
        "complete": True,
        "model": MODEL_NAME,
        "language": info.language,
        "probability": info.language_probability,
        "duration": duration,
        "segments": payload_segments,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = output_path.with_name(f"{output_path.name}.{os.getpid()}.tmp")
    try:
        temporary.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        temporary.replace(output_path)
    finally:
        temporary.unlink(missing_ok=True)
    progress(100)
    status("complete")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--input")
    parser.add_argument("--output")
    parser.add_argument("--model-dir", required=True)
    args = parser.parse_args()

    model_dir = Path(args.model_dir)
    if args.check:
        return preflight(model_dir)
    if not args.input or not args.output:
        parser.error("--input and --output are required unless --check is used")
    return transcribe(Path(args.input), Path(args.output), model_dir)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # A concise final line is surfaced in the job UI.
        print(f"Local transcription failed: {error}", file=sys.stderr)
        raise SystemExit(1)
