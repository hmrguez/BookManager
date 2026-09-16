"""Run the production importer and review UI against native SQLite, with a hard 30s cutoff.

Requires a booted disposable simulator, a built iOS app, and `bun run build` web assets.
Example: python3 scripts/benchmark-goodreads-ios.py --device UUID --csv /path/to/export.csv
Only the named simulator's Wovenleaf installation is reset. CSV contents stay in a temporary bundle.
"""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--device', required=True, help='Dedicated disposable simulator UUID')
parser.add_argument('--csv', required=True, type=Path)
parser.add_argument('--app', type=Path, default=Path('ios/DerivedData/Build/Products/Debug-iphonesimulator/Wovenleaf.app'))
args = parser.parse_args()
mobile = Path(__file__).resolve().parent.parent
app = args.app if args.app.is_absolute() else mobile / args.app
app_id = 'com.hmrguez.wovenleaf'

def simctl(*arguments, check=True):
    return subprocess.run(['xcrun', 'simctl', *arguments], check=check, capture_output=True, text=True, timeout=30)

with tempfile.TemporaryDirectory(prefix='wovenleaf-import-') as directory:
    bundle = Path(directory) / 'Wovenleaf.app'
    shutil.copytree(app, bundle)
    public = bundle / 'public'
    shutil.rmtree(public)
    shutil.copytree(mobile / 'dist', public)
    shutil.copyfile(args.csv, public / 'benchmark.csv')
    subprocess.run([
        'bun', 'build', str(mobile / 'scripts/benchmark-goodreads-native.tsx'), '--target', 'browser',
        '--format', 'esm', '--production',
        '--outdir', str(public),
    ], check=True, cwd=mobile)
    styles = list(public.glob('assets/*.css')) + list(public.glob('benchmark-goodreads-native.css'))
    links = ''.join(f'<link rel="stylesheet" href="/{path.relative_to(public)}">' for path in styles)
    (public / 'index.html').write_text('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' + links + '</head><body><div id="root"></div><script type="module" src="/benchmark-goodreads-native.js"></script></body></html>')
    simctl('terminate', args.device, app_id, check=False)
    simctl('uninstall', args.device, app_id, check=False)
    simctl('install', args.device, str(bundle))
    container = Path(simctl('get_app_container', args.device, app_id, 'data').stdout.strip())
    result_path = container / 'Library/Caches/import-benchmark.json'
    start = time.monotonic()
    simctl('launch', args.device, app_id)
    previous = ''
    while time.monotonic() - start < 30:
        if result_path.exists():
            value = result_path.read_text()
            if value != previous:
                print(value, flush=True)
                previous = value
                result = json.loads(value)
                if result['stage'] == 'error':
                    raise SystemExit(1)
                if result['stage'] == 'complete':
                    passed = result['totalMs'] < 10_000 and result['books'] == result['rows'] and result['historyRows'] == result['rows']
                    print('PASS: full import under 10 seconds' if passed else 'FAIL: import missed the target', flush=True)
                    raise SystemExit(0 if passed else 1)
        time.sleep(.05)
    simctl('terminate', args.device, app_id, check=False)
    print('TIMEOUT: simulator app terminated at 30 seconds', flush=True)
    raise SystemExit(124)
