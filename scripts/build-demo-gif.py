#!/usr/bin/env python3
"""Build 3-beat demo GIF: broken UI → highlight → NOT SAFE TO SHIP."""

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
RED = (248, 113, 113)
CYAN = (103, 232, 249)
DIM = (107, 114, 128)
WHITE = (255, 255, 255)

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

def load_and_fit(path):
    img = Image.open(path).convert("RGB")
    ratio = min(WIDTH / img.width, HEIGHT / img.height)
    new_w = int(img.width * ratio)
    new_h = int(img.height * ratio)
    img = img.resize((new_w, new_h), Image.LANCZOS)
    canvas = Image.new("RGB", (WIDTH, HEIGHT), BG_COLOR)
    canvas.paste(img, ((WIDTH - new_w) // 2, (HEIGHT - new_h) // 2))
    return canvas

def make_verdict_frame():
    img = Image.new("RGB", (WIDTH, HEIGHT), BG_COLOR)
    draw = ImageDraw.Draw(img)

    font_title = get_font(14)
    font_big = get_font(48)
    font_detail = get_font(18)
    font_sm = get_font(14)

    # Window chrome
    draw.rounded_rectangle([20, 15, WIDTH - 20, 55], radius=8, fill=(31, 41, 55))
    for i, color in enumerate([(239, 68, 68), (250, 204, 21), (74, 222, 128)]):
        draw.ellipse([35 + i * 22, 27, 49 + i * 22, 41], fill=color)
    draw.text((WIDTH // 2, 35), "ShipGuard — Verdict", fill=DIM, font=font_title, anchor="mm")

    # Horizontal rule
    y_start = 200
    draw.line([(100, y_start), (WIDTH - 100, y_start)], fill=(55, 65, 81), width=2)

    # Main verdict
    draw.text((WIDTH // 2, y_start + 80), "NOT SAFE TO SHIP", fill=RED, font=font_big, anchor="mm")

    # Red underline accent
    text_bbox = draw.textbbox((WIDTH // 2, y_start + 80), "NOT SAFE TO SHIP", font=font_big, anchor="mm")
    draw.line([(text_bbox[0], text_bbox[3] + 8), (text_bbox[2], text_bbox[3] + 8)], fill=RED, width=3)

    # Details
    details = [
        "1 visual regression detected",
        "Button layout broken on mobile viewport",
        "Risk Score: 72/100",
    ]
    y = y_start + 150
    for line in details:
        draw.text((WIDTH // 2, y), line, fill=DIM, font=font_detail, anchor="mm")
        y += 32

    # Bottom rule
    draw.line([(100, y + 20), (WIDTH - 100, y + 20)], fill=(55, 65, 81), width=2)

    # CTA
    draw.text((WIDTH // 2, y + 60), "→  /sg-visual-fix  to auto-fix from annotations", fill=CYAN, font=font_sm, anchor="mm")

    return img


# === 3 BEATS ===

# Beat 1: Visual test grid showing FAIL badge
frame1 = load_and_fit(SCREENSHOTS / "visual-tests-grid.png")

# Beat 2: Annotation highlighting the broken UI with zone + note
frame2 = load_and_fit(SCREENSHOTS / "annotation-with-note.png")

# Beat 3: Verdict
frame3 = make_verdict_frame()

# === Assemble ===
frames = [frame1, frame2, frame3]
durations = [2500, 3000, 3000]

# GIF
frames[0].save(
    OUT,
    save_all=True,
    append_images=frames[1:],
    duration=durations,
    loop=0,
    optimize=True,
)
print(f"GIF: {OUT} ({OUT.stat().st_size // 1024} KB)")

# MP4
frame_dir = REPO / "scripts" / "_demo_frames"
frame_dir.mkdir(exist_ok=True)
for i, f in enumerate(frames):
    f.save(frame_dir / f"frame_{i:02d}.png")

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
        "-vf", "scale=1200:674:flags=lanczos,format=yuv420p",
        "-c:v", "libx264", "-preset", "slow", "-crf", "18",
        str(OUT_MP4),
    ],
    capture_output=True, text=True,
    cwd=str(frame_dir),
)
if result.returncode == 0:
    print(f"MP4: {OUT_MP4} ({OUT_MP4.stat().st_size // 1024} KB)")
else:
    print(f"MP4 failed: {result.stderr[:200]}")

# Cleanup
import shutil
shutil.rmtree(frame_dir)

print(f"\n{len(frames)} frames, {sum(durations) / 1000:.1f}s total")
