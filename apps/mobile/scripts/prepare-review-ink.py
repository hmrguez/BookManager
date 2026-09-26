"""Derive themeable alpha masks from accepted artwork, without redrawing pixels.
Run with Python + Pillow from any directory. Originals remain untouched.
"""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1] / 'public' / 'reviews'
for source in sorted((root / 'concepts').glob('*-artwork.png')):
    luminance = Image.open(source).convert('L')
    # Paper varies from 245–251. Discard its faint texture; retain continuous
    # antialiasing and engraved shading below 240, without a binary threshold.
    alpha = luminance.point(lambda value: round(max(0, 240 - value) * 255 / 240))
    ink = Image.new('RGBA', luminance.size, (0, 0, 0, 0))
    ink.putalpha(alpha)
    destination = root / 'ink-v1' / source.name
    ink.save(destination, optimize=True)
    assert alpha.getextrema()[0] == 0 and alpha.getextrema()[1] > 200
    print(f'{destination.name}: {destination.stat().st_size:,} bytes')
