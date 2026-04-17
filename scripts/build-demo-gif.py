#!/usr/bin/env python3
"""Build demo GIF from real ShipGuard screenshots + terminal frames."""

from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import subprocess

REPO = Path("/Users/macstudio/agentic-visual-debugger")
SCREENSHOTS = REPO / "docs" / "screenshots"
OUT = REPO / "docs" / "screenshots" / "demo.gif"
OUT_MP4 = REPO / "docs" / "screenshots" / "demo.mp4"

WIDTH = 1200
HEIGHT = 675
BG_COLOR = (17, 24, 39)
TEXT_COLOR = (229, 231, 235)
GREEN = (74, 222, 128)
RED = (248, 113, 113)
YELLOW = (250, 204, 21)
CYAN = (103, 232, 249)
DIM = (107, 114, 128)

def get_font(size=18):
    for path in [
        "/System/Library/Fonts/SFMono-Regular.otf",
        "/System/Library/Fonts/Menlo.ttc",
        "/System/Library/Fonts/Monaco.dfont",
    ]:
        try:
            return ImageFont.truetype(path, size)
        except (OSError, IOError):
            continue
    return ImageFont.load_default()

def make_terminal_frame(lines, title="Terminal"):
    """Create a terminal-style frame with colored text lines."""
    img = Image.new("RGB", (WIDTH, HEIGHT), BG_COLOR)
    draw = ImageDraw.Draw(img)

    font = get_font(20)
    font_sm = get_font(14)
    font_lg = get_font(28)

    # Window chrome
    draw.rounded_rectangle([20, 15, WIDTH - 20, 55], radius=8, fill=(31, 41, 55))
    for i, color in enumerate([(239, 68, 68), (250, 204, 21), (74, 222, 128)]):
        draw.ellipse([35 + i * 22, 27, 49 + i * 22, 41], fill=color)
    draw.text((WIDTH // 2, 35), title, fill=DIM, font=font_sm, anchor="mm")

    y = 80
    for line in lines:
        if isinstance(line, tuple):
            text, color = line
        else:
            text, color = line, TEXT_COLOR
        draw.text((40, y), text, fill=color, font=font)
        y += 32

    return img

def load_and_fit(path):
    """Load screenshot and fit to standard size with padding."""
    img = Image.open(path).convert("RGB")
    ratio = min(WIDTH / img.width, HEIGHT / img.height)
    new_w = int(img.width * ratio)
    new_h = int(img.height * ratio)
    img = img.resize((new_w, new_h), Image.LANCZOS)

    canvas = Image.new("RGB", (WIDTH, HEIGHT), BG_COLOR)
    x = (WIDTH - new_w) // 2
    y = (HEIGHT - new_h) // 2
    canvas.paste(img, (x, y))
    return canvas

def add_label(img, text, position="bottom-right", color=None):
    """Add a subtle label overlay."""
    draw = ImageDraw.Draw(img)
    font = get_font(16)
    if color is None:
        color = CYAN

    if position == "bottom-right":
        x, y = WIDTH - 30, HEIGHT - 30
        anchor = "rb"
    elif position == "top-left":
        x, y = 30, 20
        anchor = "lt"
    else:
        x, y = WIDTH // 2, HEIGHT - 25
        anchor = "mb"

    bbox = draw.textbbox((x, y), text, font=font, anchor=anchor)
    pad = 6
    draw.rounded_rectangle(
        [bbox[0] - pad, bbox[1] - pad, bbox[2] + pad, bbox[3] + pad],
        radius=4, fill=(0, 0, 0, 180)
    )
    draw.text((x, y), text, fill=color, font=font, anchor=anchor)
    return img


# === FRAME 1: Terminal - launch audit ===
frame1 = make_terminal_frame([
    ("$ claude", DIM),
    ("", TEXT_COLOR),
    ("> /sg-code-audit deep", GREEN),
    ("", TEXT_COLOR),
    ("🔍 Scanning codebase... 1,758 files found", TEXT_COLOR),
    ("📦 Splitting into 25 zones (non-overlapping)", TEXT_COLOR),
    ("🚀 Dispatching 25 parallel agents...", CYAN),
    ("", TEXT_COLOR),
    ("   Round 1 — Surface patterns (null refs, missing guards)", DIM),
    ("   Round 2 — Runtime behavior (race conditions, auth gaps)", DIM),
    ("", TEXT_COLOR),
    ("⏱️  Estimated: ~6 min | ~$3 | Model: auto (Haiku R1, Opus R2)", YELLOW),
], title="Claude Code — ShipGuard")

# === FRAME 2: Monitor Gantt (real screenshot) ===
frame2 = load_and_fit(SCREENSHOTS / "monitor-tab-gantt.png")
add_label(frame2, "Live agent monitoring — 5 zones, real-time progress", color=GREEN)

# === FRAME 3: Code Audit overview (real screenshot) ===
frame3 = load_and_fit(SCREENSHOTS / "code-audit-dark.png")
add_label(frame3, "234 bugs found — 19 critical, 128 high", color=RED)

# === FRAME 4: Critical bugs list (real screenshot) ===
frame4 = load_and_fit(SCREENSHOTS / "bugs-critical.png")
add_label(frame4, "Every bug traced to exact file:line — auto-fixed where possible", color=YELLOW)

# === FRAME 5: Visual tests grid (real screenshot) ===
frame5 = load_and_fit(SCREENSHOTS / "visual-tests.png")
add_label(frame5, "50 routes tested — screenshots captured automatically", color=CYAN)

# === FRAME 6: Smart annotations (real screenshot) ===
frame6 = load_and_fit(SCREENSHOTS / "smart-annotations.png")
add_label(frame6, "Annotate bugs on screenshots → AI traces to source → auto-fix", color=GREEN)

# === FRAME 7: Terminal - verdict ===
frame7 = make_terminal_frame([
    ("", TEXT_COLOR),
    ("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━", DIM),
    ("", TEXT_COLOR),
    ("  SHIPGUARD AUDIT COMPLETE", CYAN),
    ("", TEXT_COLOR),
    ("  234 bugs found  ·  114 auto-fixed  ·  19 critical remain", TEXT_COLOR),
    ("  50 visual tests  ·  2 annotations  ·  35 impacted routes", TEXT_COLOR),
    ("", TEXT_COLOR),
    ("  Risk Score: 72/100", RED),
    ("", TEXT_COLOR),
    ("  ❌  NOT SAFE TO SHIP", RED),
    ("", TEXT_COLOR),
    ("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━", DIM),
    ("", TEXT_COLOR),
    ("  → /sg-visual-fix to fix annotated issues", GREEN),
], title="Claude Code — ShipGuard")

# === Assemble GIF ===
frames = [frame1, frame2, frame3, frame4, frame5, frame6, frame7]
durations = [2500, 2000, 2000, 2500, 2000, 2500, 3000]

# Save individual frames for ffmpeg (higher quality mp4)
frame_dir = REPO / "scripts" / "_demo_frames"
frame_dir.mkdir(exist_ok=True)
for i, f in enumerate(frames):
    f.save(frame_dir / f"frame_{i:02d}.png")

# GIF
frames[0].save(
    OUT,
    save_all=True,
    append_images=frames[1:],
    duration=durations,
    loop=0,
    optimize=True,
)
print(f"✅ GIF saved: {OUT} ({OUT.stat().st_size // 1024} KB)")

# MP4 via ffmpeg (better quality for social)
concat_file = frame_dir / "concat.txt"
with open(concat_file, "w") as f:
    for i, dur in enumerate(durations):
        f.write(f"file 'frame_{i:02d}.png'\n")
        f.write(f"duration {dur / 1000:.1f}\n")
    f.write(f"file 'frame_{len(durations)-1:02d}.png'\n")

result = subprocess.run(
    [
        "ffmpeg", "-y", "-f", "concat", "-safe", "0",
        "-i", str(concat_file),
        "-vf", f"scale={WIDTH}:{HEIGHT}:flags=lanczos,format=yuv420p",
        "-c:v", "libx264", "-preset", "slow", "-crf", "18",
        str(OUT_MP4),
    ],
    capture_output=True, text=True
)
if result.returncode == 0:
    print(f"✅ MP4 saved: {OUT_MP4} ({OUT_MP4.stat().st_size // 1024} KB)")
else:
    print(f"⚠️  MP4 failed: {result.stderr[:200]}")

print(f"\nTotal duration: {sum(durations) / 1000:.1f}s ({len(frames)} frames)")
