#!/usr/bin/env python3
"""Fail on uncleared media, stale provenance, or proprietary scanner dependencies."""
from pathlib import Path
import hashlib,json,re,subprocess,sys
root=Path(__file__).resolve().parents[1]
media={'.png','.jpg','.jpeg','.webp','.gif','.svg','.ico','.pdf','.wav','.mp3','.m4b','.mp4','.woff','.woff2','.ttf','.otf'}
manifest=json.loads((root/'ASSET_LICENSES.json').read_text())['assets']
tracked=subprocess.check_output(['git','ls-files'],cwd=root,text=True).splitlines();errors=[]
for name in tracked:
 p=root/name
 if not p.exists():continue
 if p.suffix.lower() in media:
  entry=manifest.get(name)
  if not entry:errors.append('No redistribution provenance: '+name);continue
  if hashlib.sha256(p.read_bytes()).hexdigest()!=entry['sha256']:errors.append('Asset changed without provenance review: '+name)
for name,entry in manifest.items():
 if not (root/name).is_file():errors.append('Missing licensed asset: '+name)
for name in ['apps/mobile/package.json','apps/mobile/bun.lock','apps/mobile/android/app/build.gradle','apps/mobile/android/capacitor.settings.gradle','apps/mobile/ios/App/CapApp-SPM/Package.swift','apps/mobile/ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved']:
 s=(root/name).read_text()
 if re.search(r'(?i)@capacitor/barcode-scanner|com\.google\.mlkit|com\.google\.android\.gms|ionbarcode|OSBarcodeLib',s):errors.append('Prohibited scanner dependency: '+name)
sys.path.insert(0,str(root/'scripts/licenses'))
from inputs import fingerprints
inventory=json.loads((root/'third_party/inventory.json').read_text())
if inventory.get('inputs')!=fingerprints(root):errors.append('Dependency inputs changed: regenerate third-party notices/inventory')
for row in inventory['dependencies']:
 if re.search(r'(?i)mlkit|play-services|ionbarcode|OSBarcodeLib',row['name']):errors.append('Prohibited resolved module: '+row['name'])
for app in ['apps/mobile','apps/landing']:
 if (root/app/'public/licenses/NOTICES.txt').read_bytes()!=(root/'third_party/NOTICES.txt').read_bytes():errors.append('Stale bundled notices: '+app)
# The shipped patched native source must match the version offered to recipients.
source=root/'apps/mobile/node_modules/@capgo/capacitor-share-target'
if source.exists():
 for name in ['android/src/main/java/app/capgo/sharetarget/CapacitorShareTargetPlugin.java','ios/Sources/CapacitorShareTargetPlugin/CapacitorShareTargetPlugin.swift']:
  if (source/name).read_bytes()!=(root/'third_party/capacitor-share-target'/name).read_bytes():errors.append('MPL source differs from build dependency: '+name)
if errors:
 print('\n'.join(errors));sys.exit(1)
print(f'Public source checks passed: {len(manifest)} licensed assets; {len(inventory["dependencies"])} inventoried dependencies; matching bundled notices.')
