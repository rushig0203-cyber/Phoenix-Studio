"""One bounded, offline VoiceStudio-engine narration. No server or GPU required."""
import argparse
import importlib.metadata
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import wave

REVISION = "724fb5abbf5502583fb520898d45929e62f02c0b"


def read_plan(filename):
    source = Path(filename)
    if source.stat().st_size > 128 * 1024:
        raise ValueError("Narration plan is too large")
    plan = json.loads(source.read_text(encoding="utf8"))
    captions = plan.get("captions")
    if plan.get("version") != 1 or plan.get("language") not in ("en", "hi"):
        raise ValueError("Invalid narration language or plan version")
    if not isinstance(captions, list) or not 1 <= len(captions) <= 250:
        raise ValueError("Invalid bounded narration phrases")
    if any(not isinstance(text, str) or not text.strip() or len(text) > 300 for text in captions):
        raise ValueError("Invalid narration phrase")
    if sum(map(len, captions)) > 14000:
        raise ValueError("Narration exceeds the local voice limit")
    return plan


def watch_parent(parent_pid):
    import psutil
    # Watch both Phoenix and the Windows venv redirector. PID identity checks
    # prevent a reused PID from keeping a cancelled voice worker alive.
    try:
        parents = [psutil.Process(parent_pid), psutil.Process(os.getppid())]
        while all(parent.is_running() and parent.status() != psutil.STATUS_ZOMBIE for parent in parents):
            time.sleep(.5)
    except psutil.Error:
        pass
    os._exit(3)


def synthesize(plan, model, output, timing):
    if Path(model).name != REVISION:
        raise ValueError("The approved pinned Supertonic-3 snapshot is required")
    if importlib.metadata.version("supertonic") != "1.3.1":
        raise ValueError("Expected VoiceStudio's verified supertonic 1.3.1 SDK")
    import numpy as np
    from supertonic import TTS

    tts = TTS(model="supertonic-3", model_dir=model, auto_download=False,
              intra_op_num_threads=1, inter_op_num_threads=1)
    style = tts.get_voice_style(voice_name="M1")
    destination = Path(output)
    fd, partial = tempfile.mkstemp(prefix=".voicestudio-", suffix=".wav", dir=destination.parent)
    os.close(fd)
    cues = []
    frames = 0
    try:
        with wave.open(partial, "wb") as writer:
            writer.setnchannels(1)
            writer.setsampwidth(2)
            writer.setframerate(44100)
            for index, text in enumerate(plan["captions"]):
                audio, _ = tts.synthesize(text=text, voice_style=style, lang=plan["language"],
                                          total_steps=8, speed=1.0, verbose=False)
                audio = np.asarray(audio, dtype=np.float32).reshape(-1)
                if not 2205 <= audio.size <= 44100 * 40 or not np.isfinite(audio).all():
                    raise ValueError("Voice engine returned invalid audio")
                if float(np.sqrt(np.mean(audio ** 2))) < .0001:
                    raise ValueError("Voice engine returned silent audio")
                start = frames / 44100
                frames += audio.size
                if frames > 44100 * 300:
                    raise ValueError("Narration exceeded 300 seconds")
                writer.writeframes((np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes())
                cues.append({"text": text, "start": start, "end": frames / 44100})
                if index + 1 < len(plan["captions"]):
                    pause = 3087  # 70 ms between short, independently measured phrases.
                    writer.writeframes(b"\0\0" * pause)
                    frames += pause
        record = {"source": "voicestudio-phrase-boundaries", "seconds": frames / 44100,
                  "voice": "M1", "language": plan["language"], "cues": cues}
        Path(timing).write_text(json.dumps(record, ensure_ascii=False), encoding="utf8")
        os.replace(partial, destination)
    finally:
        Path(partial).unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser()
    for name in ("plan", "output", "timing", "model"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--parent-pid", type=int)
    args = parser.parse_args()
    if args.parent_pid:
        threading.Thread(target=watch_parent, args=(args.parent_pid,), daemon=True).start()
    synthesize(read_plan(args.plan), args.model, args.output, args.timing)


if __name__ == "__main__":
    main()
