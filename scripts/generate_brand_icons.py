#!/usr/bin/env python3
"""Build PWA icons ONLY from the GI official raster logo already in this repository.

Never redraw the emblem. Keep the central eye and all lettering intact.
All outputs are derived files; logo.png remains the unmodified source of truth.
"""
from pathlib import Path
import hashlib
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "logo.png"
EXPECTED_SHA256 = "6e6662087b4d9ebcbded51d18ae81244511b22b88e427c192b617c4f97072e50"

if hashlib.sha256(SOURCE.read_bytes()).hexdigest() != EXPECTED_SHA256:
    raise SystemExit("Official GI logo.png source mismatch; refuse to generate icons.")

logo = Image.open(SOURCE).convert("RGBA")
if logo.size != (1198, 1204):
    raise SystemExit(f"Unexpected official logo dimensions: {logo.size}")

def make_icon(size: int, proportion: float, output: str) -> None:
    """Contain original emblem on an uncluttered white icon canvas."""
    canvas = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    avail = round(size * proportion)
    ratio = min(avail / logo.width, avail / logo.height)
    new_size = (max(1, round(logo.width * ratio)), max(1, round(logo.height * ratio)))
    foreground = logo.resize(new_size, Image.Resampling.LANCZOS)
    canvas.alpha_composite(foreground, ((size-new_size[0])//2, (size-new_size[1])//2))
    canvas.convert("RGB").save(ROOT / output, "PNG", optimize=True)
    print(f"{output}: {size}x{size}, official GI emblem, {int(proportion*100)}% safe area")

make_icon(192, 0.90, "icon-192.png")
make_icon(512, 0.90, "icon-512.png")
# Android maskable icons need the emblem entirely inside the center safe circle.
make_icon(192, 0.72, "icon-192-maskable.png")
make_icon(512, 0.72, "icon-512-maskable.png")
make_icon(180, 0.87, "apple-touch-icon.png")
make_icon(64, 0.90, "favicon-64.png")
