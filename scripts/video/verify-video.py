"""Validate the exported demo's streams, frame count, audio, and fast-start layout."""
from pathlib import Path
import json
import subprocess

import imageio_ffmpeg
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
VIDEO = ROOT / "docs/media/wwv-demo.mp4"
ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
reader = imageio_ffmpeg.read_frames(str(VIDEO))
metadata = next(reader)
reader.close()
assert metadata["size"] == (1920, 1080), metadata
assert abs(metadata["fps"] - 30) < 0.01, metadata
assert abs(metadata["duration"] - 20) < 0.01, metadata

decode = subprocess.run(
    [ffmpeg, "-v", "error", "-nostats", "-i", str(VIDEO), "-map", "0:v:0",
     "-f", "null", "-", "-progress", "pipe:1"],
    capture_output=True, text=True, check=True, creationflags=subprocess.CREATE_NO_WINDOW,
)
frame_counts = [int(line.split("=", 1)[1]) for line in decode.stdout.splitlines() if line.startswith("frame=")]
assert frame_counts and frame_counts[-1] == 600, decode.stdout
audio = subprocess.run(
    [ffmpeg, "-v", "error", "-i", str(VIDEO), "-map", "0:a:0", "-f", "f32le", "-ac", "1", "-ar", "48000", "pipe:1"],
    capture_output=True, check=True, creationflags=subprocess.CREATE_NO_WINDOW,
)
samples = np.frombuffer(audio.stdout, dtype="<f4")
assert 960000 <= len(samples) <= 961024, len(samples)  # AAC may expose one final padded packet.
assert np.isfinite(samples).all() and np.max(np.abs(samples)) < 1
assert np.sqrt(np.mean(samples * samples)) > 0.01, "Unexpected silent soundtrack"
blob = VIDEO.read_bytes()
moov, mdat = blob.find(b"moov"), blob.find(b"mdat")
assert 0 < moov < mdat, "MP4 metadata must precede media for fast-start playback"
report = {
    "video": str(VIDEO), "durationSeconds": metadata["duration"], "resolution": list(metadata["size"]),
    "fps": metadata["fps"], "decodedFrames": frame_counts[-1], "bytes": len(blob),
    "decodedAudioSampleRate": 48000, "decodedAudioSamples": len(samples),
    "decodedAudioPeak": float(np.max(np.abs(samples))), "fastStart": True,
    "fullDecodeErrors": decode.stderr.strip(),
}
target = ROOT / "artifacts/video-work/verification.json"
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps(report, indent=2))
