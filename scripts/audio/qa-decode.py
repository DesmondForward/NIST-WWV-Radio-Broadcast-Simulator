"""Decode the shipped voice assets into temporary float fixtures for worklet QA."""
from pathlib import Path
import json
import tempfile

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[2]
TARGET = Path(tempfile.gettempdir()) / "wwv-audio-qa"
TARGET.mkdir(exist_ok=True)
clips = json.loads((ROOT / "public/audio/wwv/voice-map.json").read_text())
metadata = {}
for clip_id, url in clips.items():
    audio, rate = sf.read(ROOT / "public" / url.lstrip("/"))
    if audio.ndim == 2:
        audio = audio.mean(axis=1)
    filename = TARGET / f"{clip_id}.f32"
    np.asarray(audio, dtype="<f4").tofile(filename)
    metadata[clip_id] = {"sampleRate": rate, "path": str(filename)}
(TARGET / "clips.json").write_text(json.dumps(metadata))
print(TARGET / "clips.json")
