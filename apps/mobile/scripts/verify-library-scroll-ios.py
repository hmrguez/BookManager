"""Verify production shelf scrolling inside an isolated, booted iOS simulator.

Run `bun run build` first. This copies the existing native build and current web
assets into a temporary bundle; it never resets or uninstalls an existing app.
The native bootstrap rejects libraries containing anything except its fixture.
"""
import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--device', required=True, help='Dedicated, booted simulator UUID')
parser.add_argument('--view', choices=['list', 'grid'], required=True)
parser.add_argument('--output', required=True, type=Path)
args = parser.parse_args()
mobile = Path(__file__).resolve().parent.parent
app = mobile / 'ios/DerivedData/Build/Products/Debug-iphonesimulator/Wovenleaf.app'
app_id = 'com.hmrguez.wovenleaf'

def simctl(*arguments, check=True):
    return subprocess.run(['xcrun', 'simctl', *arguments], check=check, capture_output=True, text=True, timeout=30)

with tempfile.TemporaryDirectory(prefix='wovenleaf-scroll-') as directory:
    bundle = Path(directory) / 'Wovenleaf.app'
    shutil.copytree(app, bundle)
    public = bundle / 'public'
    shutil.rmtree(public)
    shutil.copytree(mobile / 'dist', public)
    subprocess.run([
        'bun', 'build', str(mobile / 'scripts/verify-library-scroll-native.ts'), '--target', 'browser',
        '--format', 'esm', '--production', '--define',
        'import.meta.env={"DEV":false,"PROD":true,"MODE":"production","BASE_URL":"/"}',
        '--outdir', str(public),
    ], check=True, cwd=mobile)
    index = public / 'index.html'
    html = index.read_text()
    pattern = r'<script type="module"[^>]*src="([^"]+)"[^>]*></script>'
    entry = re.search(pattern, html)
    if not entry:
        raise RuntimeError('Production app entry was not found')
    (public / 'library-scroll-fixture.json').write_text(json.dumps({'view': args.view, 'entry': entry[1]}))
    index.write_text(re.sub(pattern, '<script type="module" src="/verify-library-scroll-native.js"></script>', html, count=1))
    simctl('terminate', args.device, app_id, check=False)
    simctl('install', args.device, str(bundle))
    container = Path(simctl('get_app_container', args.device, app_id, 'data').stdout.strip())
    result_path = container / 'Library/Caches/library-scroll-verification.json'
    result_path.unlink(missing_ok=True)
    simctl('launch', args.device, app_id)
    start = time.monotonic()
    while time.monotonic() - start < 60:
        if result_path.exists():
            try:
                result = json.loads(result_path.read_text())
            except json.JSONDecodeError:
                time.sleep(.05)
                continue
            if result.get('view') == args.view and result.get('stage') == 'complete':
                args.output.parent.mkdir(parents=True, exist_ok=True)
                args.output.write_text(json.dumps(result, indent=2) + '\n')
                print(json.dumps({key: value for key, value in result.items() if key != 'samples'}))
                raise SystemExit(0 if result['passed'] else 1)
            if result.get('stage') == 'error':
                print(json.dumps(result))
                raise SystemExit(1)
        time.sleep(.05)
    raise SystemExit('Timed out waiting for the native scroll verification')
