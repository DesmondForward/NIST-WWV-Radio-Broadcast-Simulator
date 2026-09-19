"""Compose the 20-second WWV application showcase from real browser frames.

Run from any directory with Python 3, Pillow, NumPy, and imageio-ffmpeg:
    python scripts/video/compose-video.py

The companion capture and audio scripts provide 600 synchronized source frames
and the original application audio. This compositor only adds camera movement,
titles, a visible pointer, and framing; it does not alter the application UI.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import subprocess
import time

import imageio_ffmpeg
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / "artifacts" / "video-work"
OUTPUT = ROOT / "docs" / "media"
WIDTH, HEIGHT, FPS, COUNT = 1920, 1080, 30, 600
AMBER = (234, 178, 119)
WHITE = (234, 239, 231)
MUTED = (134, 155, 142)
CARD = (68, 122, 1852, 950)
CARD_W, CARD_H = CARD[2] - CARD[0], CARD[3] - CARD[1]
ASPECT = CARD_W / CARD_H
FONT_DIR = Path("C:/Windows/Fonts")
FONT = ImageFont.truetype(str(FONT_DIR / "segoeui.ttf"), 26)
FONT_BOLD = ImageFont.truetype(str(FONT_DIR / "seguisb.ttf"), 31)
BRAND_FONT = ImageFont.truetype(str(FONT_DIR / "seguisb.ttf"), 34)
MONO = ImageFont.truetype(str(FONT_DIR / "consola.ttf"), 16)
SMALL_MONO = ImageFont.truetype(str(FONT_DIR / "consola.ttf"), 14)


def ease(x: float) -> float:
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def blend(a: float, b: float, x: float) -> float:
    return a + (b - a) * x


def camera(t: float) -> tuple[float, float, float, float]:
    """Continuous camera moves with quiet holds during spoken time and clicks."""
    keys = [
        (0.0, 720, 469, 1440),
        (2.5, 720, 469, 1440),
        (4.4, 533, 534, 1012),
        (10.9, 533, 534, 995),
        (12.85, 533, 534, 995),
        (14.6, 1148, 577, 580),
        (17.6, 1148, 577, 574),
        (19.15, 720, 469, 1440),
        (20.0, 720, 469, 1440),
    ]
    for first, second in zip(keys, keys[1:]):
        if first[0] <= t <= second[0]:
            amount = ease((t - first[0]) / (second[0] - first[0]))
            cx, cy, cw = [blend(first[i], second[i], amount) for i in range(1, 4)]
            ch = cw / ASPECT
            return cx - cw / 2, cy - ch / 2, cx + cw / 2, cy + ch / 2
    raise ValueError(t)


def create_background() -> Image.Image:
    y, x = np.mgrid[0:HEIGHT, 0:WIDTH]
    glow = np.exp(-(((x - 900) / 1100) ** 2 + ((y - 430) / 700) ** 2))
    lower_glow = np.exp(-(((x - 190) / 750) ** 2 + ((y - 1050) / 550) ** 2))
    colors = [11 + 8 * glow + 3 * lower_glow, 16 + 10 * glow, 15 + 9 * glow]
    bg = Image.fromarray(np.stack(colors, axis=2).astype(np.uint8), "RGB")
    draw = ImageDraw.Draw(bg)
    for xx in range(0, WIDTH, 60):
        draw.line((xx, 0, xx, HEIGHT), fill=(24, 32, 29), width=1)
    for yy in range(0, HEIGHT, 60):
        draw.line((0, yy, WIDTH, yy), fill=(24, 32, 29), width=1)
    tint = Image.new("RGBA", bg.size)
    tint_draw = ImageDraw.Draw(tint)
    tint_draw.rectangle((0, 0, WIDTH, HEIGHT), fill=(9, 14, 12, 135))
    bg = Image.alpha_composite(bg.convert("RGBA"), tint)
    shadow = Image.new("RGBA", bg.size)
    ImageDraw.Draw(shadow).rounded_rectangle(
        (CARD[0] - 12, CARD[1] + 20, CARD[2] + 12, CARD[3] + 36),
        radius=28, fill=(0, 0, 0, 170),
    )
    bg = Image.alpha_composite(bg, shadow.filter(ImageFilter.GaussianBlur(26)))
    return bg.convert("RGB")


BACKGROUND = create_background()
MASK = Image.new("L", (CARD_W, CARD_H))
ImageDraw.Draw(MASK).rounded_rectangle((0, 0, CARD_W - 1, CARD_H - 1), radius=15, fill=255)


def spaced_text(draw: ImageDraw.ImageDraw, xy, value, font, fill, tracking=3):
    xx, yy = xy
    for ch in value:
        draw.text((xx, yy), ch, font=font, fill=fill)
        xx += draw.textlength(ch, font=font) + tracking


def broadcast_icon(draw, x, y, scale=1.0, fill=AMBER):
    # A small radio pulse mark drawn as vector lines, separate from the app UI.
    pts = [(0, 17), (8, 17), (13, 7), (19, 28), (25, 0), (31, 17), (41, 17)]
    draw.line([(x + xx * scale, y + yy * scale) for xx, yy in pts], fill=fill, width=3)


def pointer_layer(t: float, bounds, switch_center: tuple[float, float]) -> Image.Image:
    layer = Image.new("RGBA", (WIDTH, HEIGHT))
    if not 14.7 <= t <= 18.2:
        return layer
    draw = ImageDraw.Draw(layer)
    left, top, right, bottom = bounds
    sx, sy = switch_center
    px = CARD[0] + (sx - left) / (right - left) * CARD_W
    py = CARD[1] + (sy - top) / (bottom - top) * CARD_H
    if t < 15.4:
        motion = ease((t - 14.7) / 0.7)
        px += blend(-180, 0, motion)
        py += blend(140, 0, motion)
    elif t > 17.5:
        motion = ease((t - 17.5) / 0.7)
        px += blend(0, 140, motion)
        py += blend(0, 90, motion)
    opacity = int(255 * min(ease((t - 14.7) / 0.18), ease((18.2 - t) / 0.3)))
    for click_time in (15.6, 17.2):
        age = t - click_time
        if 0 <= age <= 0.65:
            radius = 15 + 58 * ease(age / 0.65)
            alpha = int(180 * (1 - age / 0.65))
            draw.ellipse((px - radius, py - radius, px + radius, py + radius),
                         outline=(*AMBER, alpha), width=3)
    points = [(0, 0), (1, 34), (10, 25), (18, 42), (25, 38), (17, 21), (31, 20)]
    coords = [(px + x, py + y) for x, y in points]
    draw.polygon([(x + 2, y + 3) for x, y in coords], fill=(0, 0, 0, int(opacity * 0.45)))
    draw.polygon(coords, fill=(238, 241, 231, opacity), outline=(22, 30, 25, opacity), width=2)
    return layer


CHAPTERS = [
    (0, 4.25, "01  /  THE SIGNAL", "Every second. Right on time."),
    (4.25, 10.95, "02  /  THE VOICE", "The familiar WWV time announcement."),
    (10.95, 13.85, "03  /  THE MOMENT", "12:35 UTC. The minute begins."),
    (13.85, 18.2, "04  /  YOUR MIX", "Hear every layer. Make it your own."),
    (18.2, 20.01, "WWV RADIO SIMULATOR", "A familiar signal. A new way to listen."),
]


def add_frame_graphics(frame: Image.Image, t: float) -> Image.Image:
    overlay = Image.new("RGBA", (WIDTH, HEIGHT))
    draw = ImageDraw.Draw(overlay)
    broadcast_icon(draw, 73, 54)
    draw.text((136, 35), "WWV", font=BRAND_FONT, fill=(*WHITE, 255))
    draw.line((230, 45, 230, 81), fill=(68, 83, 72, 255), width=1)
    spaced_text(draw, (254, 49), "TIME & FREQUENCY", MONO, (*AMBER, 255), 3)
    spaced_text(draw, (1535, 49), "WEB RADIO SIMULATOR", SMALL_MONO, (*MUTED, 255), 1.5)
    draw.rounded_rectangle(CARD, radius=15, outline=(102, 126, 108, 100), width=1)
    # The subtle lower-edge accent grows with the 20-second piece.
    draw.line((68, 1060, 1852, 1060), fill=(51, 65, 55, 255), width=1)
    draw.line((68, 1060, 68 + 1784 * min(1, t / 20), 1060), fill=(*AMBER, 255), width=2)
    for start, end, label, title in CHAPTERS:
        if start <= t < end:
            if label == "03  /  THE MOMENT" and t < 12:
                title = "Listen for the minute marker."
            alpha = min(ease((t - start) / 0.25), ease((end - t) / 0.2))
            # Opening begins already legible instead of hiding the first title.
            if start == 0:
                alpha = min(1, ease((end - t) / 0.2))
            yshift = 8 * (1 - alpha)
            draw.text((74, 973 + yshift), label, font=SMALL_MONO, fill=(*AMBER, int(255 * alpha)))
            draw.text((74, 997 + yshift), title, font=FONT_BOLD, fill=(*WHITE, int(255 * alpha)))
            break
    # Headphones are suggested by the tiny on-screen audio indicator.
    amplitudes = (5, 12, 20, 11, 17, 8)
    for i, base in enumerate(amplitudes):
        amp = base * (0.6 + 0.4 * math.sin(t * 4 + i * 0.8) ** 2)
        x = 1641 + i * 7
        draw.line((x, 1014 - amp / 2, x, 1014 + amp / 2), fill=(*AMBER, 230), width=2)
    draw.text((1704, 1004), "SOUND ON", font=MONO, fill=(*MUTED, 255))
    frame = Image.alpha_composite(frame.convert("RGBA"), overlay).convert("RGB")
    # A brief fade matches the companion audio's 300 ms ramps.
    fade = min(ease(t / 0.3), ease((20 - t) / 0.3))
    if fade < 1:
        frame = Image.blend(Image.new("RGB", frame.size, (9, 14, 12)), frame, fade)
    return frame


def compose(index: int, source: Image.Image, switch_center: tuple[float, float]) -> Image.Image:
    t = index / FPS
    bounds = camera(t)
    view = source.convert("RGB").transform((CARD_W, CARD_H), Image.Transform.EXTENT,
                                           bounds, Image.Resampling.BICUBIC)
    frame = BACKGROUND.copy()
    frame.paste(view, CARD[:2], MASK)
    frame = Image.alpha_composite(frame.convert("RGBA"), pointer_layer(t, bounds, switch_center))
    return add_frame_graphics(frame.convert("RGB"), t)


def contact_sheet(frames: list[tuple[int, Image.Image]], target: Path):
    thumb_w, thumb_h = 640, 360
    sheet = Image.new("RGB", (thumb_w * 3, (thumb_h + 38) * math.ceil(len(frames) / 3)), (14, 20, 17))
    draw = ImageDraw.Draw(sheet)
    for j, (index, frame) in enumerate(frames):
        x, y = (j % 3) * thumb_w, (j // 3) * (thumb_h + 38)
        sheet.paste(frame.resize((thumb_w, thumb_h), Image.Resampling.LANCZOS), (x, y))
        draw.text((x + 14, y + thumb_h + 6), f"{index / FPS:05.2f} s", font=MONO, fill=WHITE)
    sheet.save(target, quality=92)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frames", type=Path, default=WORK / "frames")
    parser.add_argument("--audio", type=Path, default=WORK / "demo-audio.wav")
    parser.add_argument("--output", type=Path, default=OUTPUT / "wwv-demo.mp4")
    parser.add_argument("--switch-x", type=float, default=1346)
    parser.add_argument("--switch-y", type=float, default=554.328)
    parser.add_argument("--preview", action="store_true", help="Render only a contact sheet and poster.")
    parser.add_argument("--crf", default="19")
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    WORK.mkdir(parents=True, exist_ok=True)
    sample_indices = (24, 45, 165, 228, 360, 435, 480, 518, 555)
    indices = sample_indices if args.preview else range(COUNT)
    missing = [i for i in indices if not (args.frames / f"frame-{i:04d}.jpg").is_file()]
    if missing:
        raise SystemExit(f"Missing {len(missing)} capture frames; first: frame-{missing[0]:04d}.jpg")
    process = None
    log_handle = None
    if not args.preview:
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        command = [ffmpeg, "-y", "-hide_banner", "-f", "rawvideo", "-vcodec", "rawvideo",
                   "-s", f"{WIDTH}x{HEIGHT}", "-pix_fmt", "rgb24", "-r", str(FPS), "-i", "-",
                   "-i", str(args.audio), "-map", "0:v:0", "-map", "1:a:0",
                   "-c:v", "libx264", "-preset", "slow", "-crf", args.crf,
                   "-profile:v", "high", "-level", "4.1", "-pix_fmt", "yuv420p",
                   "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
                   "-t", "20", "-movflags", "+faststart", "-metadata", "title=WWV — The sound of time",
                   "-metadata", "comment=Independent WWV broadcast simulator; captured application interface and application-generated audio.",
                   str(args.output)]
        log_handle = (WORK / "encode.log").open("w", encoding="utf-8")
        process = subprocess.Popen(command, stdin=subprocess.PIPE, stderr=log_handle)
    started = time.monotonic()
    samples = []
    try:
        for index in indices:
            with Image.open(args.frames / f"frame-{index:04d}.jpg") as source:
                frame = compose(index, source, (args.switch_x, args.switch_y))
            if index in sample_indices:
                samples.append((index, frame.copy()))
            if index == 45:
                frame.save(args.output.with_name("wwv-demo-poster.jpg"), quality=94, subsampling=0)
            if process:
                process.stdin.write(frame.tobytes())
            if index % 60 == 0:
                print(f"Composed {index}/{COUNT} frames ({time.monotonic() - started:.1f}s)", flush=True)
    finally:
        if process:
            process.stdin.close()
            result = process.wait()
            log_handle.close()
            if result:
                raise SystemExit(f"FFmpeg failed with {result}; see {WORK / 'encode.log'}")
    contact_sheet(samples, WORK / "video-contact-sheet.jpg")
    if process:
        result = {
            "path": str(args.output), "durationSeconds": COUNT / FPS, "frames": COUNT,
            "width": WIDTH, "height": HEIGHT, "fps": FPS, "bytes": args.output.stat().st_size,
            "encodeSeconds": round(time.monotonic() - started, 2),
            "sourceFrames": str(args.frames), "sourceAudio": str(args.audio),
            "switchCenter": [args.switch_x, args.switch_y], "clickTimes": [15.6, 17.2],
            "audio": "Application-generated signal; no added music or sound effects.",
        }
        (WORK / "compose-report.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
        print(json.dumps(result, indent=2), flush=True)
    else:
        print(f"Preview: {WORK / 'video-contact-sheet.jpg'}", flush=True)


if __name__ == "__main__":
    main()
