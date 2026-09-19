"""Create a mono WWV station identifier with embedded radio ticks removed.

Requirements: numpy, soundfile. The original MP3 is never modified.
The app synthesizes the missing pulses on its own exact audio sample clock.
"""
from pathlib import Path
import hashlib
import json

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / "public" / "audio" / "wwv"


def read_mono(path):
    data, sample_rate = sf.read(path)
    return (data.mean(axis=1) if data.ndim == 2 else data), sample_rate


if __name__ == "__main__":
    source, sample_rate = read_mono(DEST / "v_ident_better.mp3")
    # Measured by cross-correlating the original recording with a 5 ms / 1 kHz
    # marker. The ID begins just after second 1; compensate the recording cut.
    padding_frames = 753
    clean = np.pad(source, (padding_frames, 0))
    # Recording seconds 1..33 correspond to broadcast seconds 2..34. Second
    # 29's omitted tick is recording second 28. Restore the specified protected
    # zones, using 1 ms ramps around the zero region to avoid edit clicks.
    ramp_frames = round(.001 * sample_rate)
    for second in range(1, 34):
        if second == 28:
            continue
        start = round((second - .010) * sample_rate)
        end = round((second + .030) * sample_rate)
        clean[start - ramp_frames:start] *= np.linspace(1, 0, ramp_frames)
        clean[start:end] = 0
        clean[end:end + ramp_frames] *= np.linspace(0, 1, ramp_frames)
    # A shared source corpus gain is used at playback; match this quieter radio
    # recording once to the telephone phrase corpus, with a conservative cap.
    speech_stats = []
    manifest = json.loads((DEST / "manifest.json").read_text())
    for clip_id, entry in manifest["clips"].items():
        if "ident" in clip_id:
            continue
        data, sr = read_mono(DEST / f"{clip_id}.mp3")
        entry.update({"decodedDurationSeconds": len(data) / sr,
                      "sampleRate": sr,
                      "monoPeak": float(np.max(np.abs(data))),
                      "monoRms": float(np.sqrt(np.mean(data * data)))})
        speech_stats.append((entry["monoPeak"], entry["monoRms"]))
    source_rms = float(np.sqrt(np.mean(clean * clean)))
    gain = min(float(np.median([rms for _, rms in speech_stats])) / source_rms,
               .85 / np.max(np.abs(clean)))
    clean *= gain
    target = DEST / "v_ident_clean.wav"
    sf.write(target, clean, sample_rate, subtype="PCM_16")
    manifest["clips"]["v_ident_better"].update({
        "decodedDurationSeconds": len(source) / sample_rate,
        "sampleRate": sample_rate,
        "monoPeak": float(np.max(np.abs(source))),
        "monoRms": float(np.sqrt(np.mean(source * source))),
        "containsEmbeddedTicks": True,
    })
    manifest["clips"]["v_ident_clean"] = {
        "url": "/audio/wwv/v_ident_clean.wav",
        "bytes": target.stat().st_size,
        "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
        "decodedDurationSeconds": len(clean) / sample_rate,
        "sampleRate": sample_rate,
        "monoPeak": float(np.max(np.abs(clean))),
        "monoRms": float(np.sqrt(np.mean(clean * clean))),
        "derivedFrom": "v_ident_better",
        "leadingPaddingSeconds": padding_frames / sample_rate,
        "gainApplied": gain,
        "containsEmbeddedTicks": False,
        "broadcastStartSecond": 1,
    }
    manifest["commonSpeechPeak"] = max(peak for peak, _ in speech_stats)
    manifest["commonGainFor75PercentModulation"] = .75 / manifest["commonSpeechPeak"]
    (DEST / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    voice_map = {clip_id: entry["url"] for clip_id, entry in manifest["clips"].items()
                 if clip_id != "v_ident_better"}
    (DEST / "voice-map.json").write_text(json.dumps(voice_map, indent=2) + "\n")
    print(json.dumps(manifest["clips"]["v_ident_clean"], indent=2))
