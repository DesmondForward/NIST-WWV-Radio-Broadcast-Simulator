"""Fetch the unmodified WWV voice corpus from its pinned MIT upstream revision.

Run with Python 3.12; mutagen is optional (used only for metadata inspection).
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import urlopen
import hashlib
import json

REVISION = "ba716d2f7ce34002c54ffcb45fbf757551955e43"
ROOT = f"https://raw.githubusercontent.com/kalafut/wwv/{REVISION}/"
DEST = Path(__file__).resolve().parents[2] / "public" / "audio" / "wwv"
IDS = [f"v_{i}" for i in range(60)] + [
    "v_at_the_tone", "v_hour", "v_hours", "v_minute", "v_minutes", "v_utc",
    "v_ident_better",
]


def fetch(clip_id):
    data = urlopen(ROOT + f"voice_clips/{clip_id}.mp3", timeout=30).read()
    destination = DEST / f"{clip_id}.mp3"
    destination.write_bytes(data)
    return clip_id, {
        "url": f"/audio/wwv/{clip_id}.mp3",
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
    }


if __name__ == "__main__":
    DEST.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=8) as pool:
        entries = dict(pool.map(fetch, IDS))
    (DEST / "LICENSE-MIT.txt").write_bytes(urlopen(ROOT + "LICENSE").read())
    layout_text = urlopen(ROOT + "src/sprite_layout.js").read().decode()
    layout = json.loads(layout_text[layout_text.index("{"):])
    for clip_id, entry in entries.items():
        if clip_id in layout["sprite"]:
            entry["sourceDecodedDurationSeconds"] = layout["sprite"][clip_id][1] / 1000
    manifest = {
        "station": "WWV",
        "source": "https://github.com/kalafut/wwv",
        "revision": REVISION,
        "license": "MIT; see LICENSE-MIT.txt and SOURCES.md",
        "clips": entries,
    }
    (DEST / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Downloaded {len(entries)} MP3 files, {sum(v['bytes'] for v in entries.values()):,} bytes")
