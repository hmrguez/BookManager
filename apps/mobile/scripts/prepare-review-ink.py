"""Reproduce approved original-pixel ink masks; --check verifies without writing.
Python 3 + Pillow. The fixed v1 luminance transform never regenerates artwork.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
from PIL import Image

check = argparse.ArgumentParser()
check.add_argument('--check', action='store_true')
checking = check.parse_args().check
repo = Path(__file__).resolve().parents[3]
root = repo / 'apps/mobile/public/reviews'
crops = repo / 'docs/design/quarterly-review-concepts/cropped'
manifest = json.loads((crops / 'manifest.json').read_text())
records = []
sha = lambda data: hashlib.sha256(data).hexdigest()
for name, entry in manifest.items():
    original_path = crops.parent / entry['source']
    with Image.open(original_path) as original:
        for kind in ('artwork', 'badge'):
            info = entry['crops'][kind]
            source = crops / info['file']
            with Image.open(source) as image:
                image.load()
                assert image.tobytes() == original.crop(info['box']).tobytes(), source
                if kind == 'artwork':
                    assert source.read_bytes() == (root / 'concepts' / source.name).read_bytes()
                luminance = image.convert('L')
                alpha = luminance.point(lambda value: round(max(0, 240 - value) * 255 / 240))
                ink = Image.new('RGBA', image.size, (0, 0, 0, 0))
                ink.putalpha(alpha)
                output = root / 'ink-v1' / source.name
                data = io.BytesIO()
                ink.save(data, format='PNG', optimize=True)
                if checking:
                    with Image.open(output) as actual:
                        actual.load()
                        assert actual.mode == 'RGBA' and actual.size == ink.size
                        assert actual.tobytes() == ink.tobytes(), output
                else:
                    output.parent.mkdir(parents=True, exist_ok=True)
                    output.write_bytes(data.getvalue())
                assert alpha.getextrema()[0] == 0 and alpha.getextrema()[1] > 200
                assert len(set(alpha.tobytes())) > 100, 'Lost continuous engraved shading'
                records.append(dict(pathway=name, kind=kind, source=str(source.relative_to(repo)),
                    original=str(original_path.relative_to(repo)), originalSha256=sha(original_path.read_bytes()),
                    sourceSha256=sha(source.read_bytes()), crop=info['box'], size=list(ink.size),
                    output=str(output.relative_to(root)), outputSha256=sha(output.read_bytes()),
                    decodedSha256=sha(ink.tobytes()), bytes=output.stat().st_size))
result = dict(version='original-ink-v1', alpha='round(max(0, 240 - Pillow L) * 255 / 240)', assets=records)
manifest_path = root / 'ink-v1/manifest.json'
if checking:
    assert json.loads(manifest_path.read_text()) == result, 'Manifest differs; review asset changes'
else:
    manifest_path.write_text(json.dumps(result, indent=2) + '\n')
print(f'{"Verified" if checking else "Prepared"} {len(records)} original-derived PNGs; {sum(r["bytes"] for r in records):,} bytes')
