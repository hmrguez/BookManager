from pathlib import Path
import hashlib,json,re

def fingerprints(root: Path):
    names=['scripts/licenses/generate.py','scripts/licenses/inputs.py','LICENSE','apps/mobile/package.json','apps/mobile/bun.lock','apps/landing/package.json','apps/landing/bun.lock',
           'apps/mobile/android/app/build.gradle','apps/mobile/android/variables.gradle','apps/mobile/android/capacitor.settings.gradle',
           'apps/mobile/ios/App/CapApp-SPM/Package.swift','apps/mobile/ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved',
           'apps/mobile/patches/@capgo%2Fcapacitor-share-target@8.0.49.patch','apps/mobile/patches/@capacitor-community%2Fsqlite@8.1.1.patch']
    names += [str(p.relative_to(root)) for p in sorted((root/'third_party/licenses').glob('*.txt'))]
    result={}
    for name in names:
        text=(root/name).read_text()
        if name.endswith('/package.json'):
            text=json.dumps(json.loads(text).get('dependencies',{}),sort_keys=True)
        elif name.endswith('Package.resolved'):
            text=json.dumps(json.loads(text)['pins'],sort_keys=True)
        elif name.endswith('app/build.gradle'):
            # App release numbers do not change the dependency graph.
            text=re.sub(r'^\s*version(?:Code|Name)\s+.*$', '',text,flags=re.M)
        result[name]=hashlib.sha256(text.encode()).hexdigest()
    return result
