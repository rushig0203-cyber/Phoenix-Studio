"""Real Windows speech + actual SubMaker, synthetic text only; no API or model."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import wave
from edge_tts import SubMaker

root = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("voice_fixture", root / "scripts/test-renderer-local-voice.py")
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
adapter = fixture.shipped_source()
os.environ["PHOENIX_STUDIO_ROOT"] = str(root)
directory = Path(tempfile.mkdtemp(prefix="phoenix-local-speech-proof-"))
script = "A quiet path winds between green trees. Sunlight falls across the grass."
audio = directory / "narration.wav"
cues = adapter["synthesize"](script, audio, 1.0, "English")
maker = SubMaker()
for cue in cues:
    maker.feed({"type": "WordBoundary", "text": cue["text"], "offset": round(cue["start"] * 10_000_000),
                "duration": round((cue["end"] - cue["start"]) * 10_000_000)})
srt = maker.get_srt()
assert srt.strip() and "Sunlight" in srt and "grass" in srt
(directory / "captions.srt").write_text(srt, encoding="utf-8")
with wave.open(str(audio), "rb") as data:
    seconds = data.getnframes() / data.getframerate()
    assert data.getframerate() == 16000
assert 1 < seconds < 20 and len(cues) >= 12 and abs(cues[-1]["end"] - seconds) < .001
result = {"source": adapter["PROTOCOL"], "seconds": seconds, "measuredWords": len(cues),
          "firstWordSeconds": cues[0]["start"], "lastWordEndsAtPcmEnd": True, "actualSubMakerSrt": True,
          "networkOrModelUsed": False, "audio": str(audio), "captions": str(directory / "captions.srt")}
(directory / "proof.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
print(json.dumps(result))
