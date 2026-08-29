#!/usr/bin/env python3
"""Build 7-frame demo GIF: terminal → monitor → audit → bugs → visual → annotation → verdict."""

from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import subprocess, shutil

REPO = Path(__file__).resolve().parents[1]
SCREENSHOTS = REPO / "docs" / "screenshots"
OUT = REPO / "docs" / "screenshots" / "demo.gif"
OUT_MP4 = REPO / "docs" / "screenshots" / "demo.mp4"

WIDTH = 1200
HEIGHT = 675
BG = (17, 24, 39)
TEXT = (229, 231, 235)
GREEN = (74, 222, 128)
RED = (248, 113, 113)
YELLOW = (250, 204, 21)
CYAN = (103, 232, 249)
DIM = (107, 114, 128)


def get_font(size=18):
    for p in [
        "/System/Library/Fonts/SFMono-Regular.otf",
        "/System/Library/Fonts/Menlo.ttc",
        "/System/Library/Fonts/Monaco.dfont",
    ]:
        try:
            return ImageFont.truetype(p, size)
        except (OSError, IOError):
            continue
    return ImageFont.load_default()


def make_terminal(lines, title="Claude Code — ShipGuard"):
    img = Image.new("RGB", (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(img)
    font = get_font(20)
    font_sm = get_font(14)

    draw.rounded_rectangle([20, 15, WIDTH - 20, 55], radius=8, fill=(31, 41, 55))
    for i, c in enumerate([(239, 68, 68), (250, 204, 21), (74, 222, 128)]):
        draw.ellipse([35 + i * 22, 27, 49 + i * 22, 41], fill=c)
    draw.text((WIDTH // 2, 35), title, fill=DIM, font=font_sm, anchor="mm")

    y = 80
    for line in lines:
        txt, color = line if isinstance(line, tuple) else (line, TEXT)
        draw.text((40, y), txt, fill=color, font=font)
        y += 32
    return img


def load_and_fit(path):
    img = Image.open(path).convert("RGB")
    ratio = min(WIDTH / img.width, HEIGHT / img.height)
    nw, nh = int(img.width * ratio), int(img.height * ratio)
    img = img.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("RGB", (WIDTH, HEIGHT), BG)
    canvas.paste(img, ((WIDTH - nw) // 2, (HEIGHT - nh) // 2))
    return canvas


def add_label(img, text, color=CYAN):
    draw = ImageDraw.Draw(img)
    font = get_font(16)
    x, y = WIDTH - 20, HEIGHT - 20

    bbox = draw.textbbox((x, y), text, font=font, anchor="rb")
    pad = 8
    overlay = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    ov_draw = ImageDraw.Draw(overlay)
    ov_draw.rounded_rectangle(
        [bbox[0] - pad, bbox[1] - pad, bbox[2] + pad, bbox[3] + pad],
        radius=6, fill=(0, 0, 0, 180)
    )
    img.paste(Image.alpha_composite(
        img.convert("RGBA"),
        overlay
    ).convert("RGB"))

    draw = ImageDraw.Draw(img)
    draw.text((x, y), text, fill=color, font=font, anchor="rb")
    return img


# === FRAME 1: Terminal ===
frame1 = make_terminal([
    ("$ claude", DIM),
    ("", TEXT),
    ("> /sg-code-audit deep", GREEN),
    ("", TEXT),
    ("🔍 Scanning codebase... 1,758 files found", TEXT),
    ("📦 Splitting into 25 zones (non-overlapping)", TEXT),
    ("🚀 Dispatching 25 parallel agents...", CYAN),
    ("", TEXT),
    ("   Round 1 — Surface patterns (null refs, missing guards)", DIM),
    ("   Round 2 — Runtime behavior (race conditions, auth gaps)", DIM),
    ("", TEXT),
    ("⏱️  Estimated: ~6 min | ~$3 | Model: auto (Haiku R1, Opus R2)", YELLOW),
])

# === FRAME 2: Monitor Gantt ===
frame2 = load_and_fit(SCREENSHOTS / "monitor-tab-gantt.png")
add_label(frame2, "Live agent monitoring — 5 zones, real-time progress", GREEN)

# === FRAME 3: Code Audit overview ===
frame3 = load_and_fit(SCREENSHOTS / "code-audit-dark.png")
add_label(frame3, "234 bugs found — 19 critical, 128 high", RED)

# === FRAME 4: Critical bugs list ===
frame4 = load_and_fit(SCREENSHOTS / "bugs-critical.png")
add_label(frame4, "Every bug traced to exact file:line — auto-fixed where possible", YELLOW)

# === FRAME 5: Visual tests grid ===
frame5 = load_and_fit(SCREENSHOTS / "visual-tests-grid.png")
add_label(frame5, "50 routes tested — screenshots captured automatically", CYAN)

# === FRAME 6: Annotations ===
frame6 = load_and_fit(SCREENSHOTS / "annotation-with-note.png")
add_label(frame6, "Annotate bugs on screenshots → AI traces to source → auto-fix", GREEN)

# === FRAME 7: Verdict ===
frame7 = make_terminal([
    ("", TEXT),
    ("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━", DIM),
    ("", TEXT),
    ("  SHIPGUARD AUDIT COMPLETE", CYAN),
    ("", TEXT),
    ("  234 bugs found  ·  114 auto-fixed  ·  19 critical remain", TEXT),
    ("  50 visual tests  ·  2 annotations  ·  35 impacted routes", TEXT),
    ("", TEXT),
    ("  Risk Score: 72/100", RED),
    ("", TEXT),
    ("  ❌  NOT SAFE TO SHIP", RED),
    ("", TEXT),
    ("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━", DIM),
    ("", TEXT),
    ("  → /sg-visual-fix to fix annotated issues", GREEN),
], title="ShipGuard — Verdict")


# === Assemble ===
frames = [frame1, frame2, frame3, frame4, frame5, frame6, frame7]
durations = [2500, 2000, 2000, 2500, 2000, 2500, 3000]

# GIF
frames[0].save(
    OUT, save_all=True, append_images=frames[1:],
    duration=durations, loop=0, optimize=True,
)
print(f"GIF: {OUT} ({OUT.stat().st_size // 1024} KB)")

# MP4
frame_dir = REPO / "scripts" / "_demo_frames"
frame_dir.mkdir(exist_ok=True)
for i, f in enumerate(frames):
    f.save(frame_dir / f"frame_{i:02d}.png")

concat = frame_dir / "concat.txt"
with open(concat, "w") as f:
    for i, dur in enumerate(durations):
        f.write(f"file 'frame_{i:02d}.png'\nduration {dur / 1000:.1f}\n")
    f.write(f"file 'frame_{len(durations)-1:02d}.png'\n")

r = subprocess.run(
    ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat),
     "-vf", "scale=1200:674:flags=lanczos,format=yuv420p",
     "-c:v", "libx264", "-preset", "slow", "-crf", "18", str(OUT_MP4)],
    capture_output=True, text=True, cwd=str(frame_dir),
)
if r.returncode == 0:
    print(f"MP4: {OUT_MP4} ({OUT_MP4.stat().st_size // 1024} KB)")
else:
    print(f"MP4 failed: {r.stderr[:300]}")

shutil.rmtree(frame_dir)
print(f"\n{len(frames)} frames, {sum(durations) / 1000:.1f}s total")
