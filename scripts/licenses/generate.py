#!/usr/bin/env python3
"""Inventory installed JS, resolved Android and pinned Swift dependencies and notices.
Requires frozen installs, Android release inventory, and resolved Swift checkouts.
No network is used. Missing native metadata or license texts fail the generation.
"""
from pathlib import Path
import argparse,json,re,zipfile,xml.etree.ElementTree as ET,subprocess,hashlib,shutil
from inputs import fingerprints
root=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser();parser.add_argument('--android',type=Path,required=True);parser.add_argument('--swift-checkouts',type=Path,required=True);args=parser.parse_args()
entries=[];texts={};errors=[]
def add_text(label,text):
 text=text.strip()
 if not text:return None
 digest=hashlib.sha256(text.encode()).hexdigest();texts.setdefault(digest,{'label':label,'text':text});return digest
def license_files(base):
 result=[]
 for p in sorted(base.iterdir()):
  if p.is_file() and re.match(r'(?i)^(licen[sc]e|copying|notice|copyright|authors)([.\-_]|$)',p.name):
   result.append(add_text(p.name,p.read_text(errors='replace')))
 return [v for v in result if v]
def resolve(start,name):
 for p in [start,*start.parents]:
  target=p/'node_modules'/name
  if (target/'package.json').exists():return target.resolve()
 return None
seen=set()
def npm(path):
 if path in seen:return
 seen.add(path);data=json.loads((path/'package.json').read_text());name=data['name'];version=data['version'];license=data.get('license')
 if isinstance(license,dict):license=license.get('type')
 if name=='jszip':license='MIT' # Explicit choice of the upstream dual-license option.
 refs=license_files(path)
 if not refs:
  for p in path.glob('README*'):
   text=p.read_text(errors='replace')
   section=re.search(r'(?is)#+ licen[sc]e\s*\n(.*)',text)
   if section and 'Permission is hereby granted' in section[1]: refs=[add_text('README license section',section[1])]
 repo=data.get('repository',{});repo=repo.get('url','') if isinstance(repo,dict) else repo
 if name.startswith('@rollup/rollup-') and version=='4.44.0':
  file=root/'third_party/licenses/rollup-4.44.0-LICENSE.txt'
  if file.exists(): refs.append(add_text(file.name,file.read_text()))
 if not license or not refs:errors.append(f'npm {name}@{version}: missing license declaration/text')
 entries.append({'ecosystem':'npm','name':name,'version':version,'license':license,'source':repo,'texts':refs})
 for dep in {**data.get('dependencies',{}),**data.get('optionalDependencies',{}),**data.get('peerDependencies',{})}:
  target=resolve(path,dep)
  if target:npm(target)
for app in ['apps/mobile','apps/landing']:
 path=root/app;data=json.loads((path/'package.json').read_text())
 for name in data.get('dependencies',{}):
  if name == 'astro': continue # Static-site build tool; not redistributed in the site.
  target=resolve(path,name)
  if not target:errors.append('Missing install: '+name)
  else:npm(target)
# Native Capacitor hosts are declared as development dependencies for the CLI,
# but their Android/iOS implementations are redistributed with the native app.
for name in ['@capacitor/android','@capacitor/ios']:
 target=resolve(root/'apps/mobile',name)
 if not target:errors.append('Missing native host install: '+name)
 else:npm(target)
# Native dependency POM license metadata plus all license/NOTICE payloads carried by artifacts.
cache=Path.home()/'.gradle/caches/modules-2/files-2.1'
for row in json.loads(args.android.read_text()):
 group,name,version=row['group'],row['name'],row['version'];base=cache/group/name/version
 poms=list((root/'third_party/metadata/maven'/group/name/version).glob('*.pom')) or list(base.glob('*/*.pom'));licenses=[];source='';organization=''
 if poms:
  doc=ET.parse(poms[0]).getroot();ns={'m':'http://maven.apache.org/POM/4.0.0'}
  licenses=[el.text for el in doc.findall('m:licenses/m:license/m:name',ns) if el.text]
  source=doc.findtext('m:scm/m:url',default='',namespaces=ns) or doc.findtext('m:url',default='',namespaces=ns)
  organization=doc.findtext('m:organization/m:name',default='',namespaces=ns)
  parent=doc.find('m:parent',ns)
  while not licenses and parent is not None:
   groupId,artifactId,parentVersion=[parent.findtext('m:'+k,namespaces=ns) for k in ['groupId','artifactId','version']]
   candidates=list((root/'third_party/metadata/maven'/groupId/artifactId/parentVersion).glob('*.pom'))
   if not candidates:break
   inherited=ET.parse(candidates[0]).getroot()
   licenses=[el.text for el in inherited.findall('m:licenses/m:license/m:name',ns) if el.text]
   source=source or inherited.findtext('m:scm/m:url',default='',namespaces=ns)
   organization=organization or inherited.findtext('m:organization/m:name',default='',namespaces=ns)
   parent=inherited.find('m:parent',ns)
  if group=='net.zetetic' and name=='sqlcipher-android':
   # Its POM supplies only the license URL; use the exact release's community grant.
   license_path=root/'third_party/licenses/sqlcipher-android-4.17.0-LICENSE.txt'
   if license_path.exists(): licenses=['BSD-style SQLCipher Community Edition'];source='https://github.com/sqlcipher/sqlcipher-android/tree/v4.17.0'
 if group=='io.ionic.libs' and name=='ionfilesystem-android': licenses=['MIT']
 if not licenses:errors.append(f'Maven {group}:{name}:{version}: missing license metadata')
 refs=[]
 if group=='io.ionic.libs' and name=='ionfilesystem-android':
  license_path=root/'third_party/licenses/ionfilesystem-android-1.1.0-LICENSE.txt'
  if license_path.exists(): refs.append(add_text(license_path.name,license_path.read_text()))
  else: errors.append('Missing exact Ionic filesystem license')
 if group=='net.zetetic' and name=='sqlcipher-android':
  license_path=root/'third_party/licenses/sqlcipher-android-4.17.0-LICENSE.txt'
  if license_path.exists(): refs.append(add_text(license_path.name,license_path.read_text()))
 def archive_notices(data):
  import io
  with zipfile.ZipFile(io.BytesIO(data)) as arc:
   for f in arc.namelist():
    if re.search(r'(?i)(^|/)(licen[sc]e|notice|copying|copyright)([.\-_]|$)',f) and not f.endswith('/'):
     if arc.getinfo(f).file_size<500000:
      ref=add_text(f,arc.read(f).decode('utf8',errors='replace'))
      if ref:refs.append(ref)
    elif f=='classes.jar':archive_notices(arc.read(f))
 for artifact in sorted(base.glob('*/*')):
  if artifact.suffix in ['.aar','.jar'] and not artifact.name.endswith(('-sources.jar','-javadoc.jar')):
   archive_notices(artifact.read_bytes())
 entries.append({'ecosystem':'maven','name':f'{group}:{name}','version':version,'license':' AND '.join(licenses),'source':source,'organization':organization,'texts':sorted(set(refs))})
# Exact resolved Swift revisions: refuse to attribute a different checkout.
pins=json.loads((root/'apps/mobile/ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved').read_text())['pins']
for pin in pins:
 name=pin['identity'];path=args.swift_checkouts/name
 if not path.exists():
  matches=[p for p in args.swift_checkouts.iterdir() if p.name.lower()==name.lower()];path=matches[0] if matches else path
 if not path.exists():errors.append('Missing Swift checkout: '+name);continue
 revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=path,text=True).strip()
 if revision!=pin['state']['revision']:errors.append('Swift revision mismatch: '+name)
 refs=license_files(path)
 if not refs:errors.append('Missing Swift license: '+name)
 entries.append({'ecosystem':'swift','name':name,'version':pin['state'].get('version',revision),'revision':revision,'source':pin['location'],'texts':refs})
unique={}
for entry in entries:
 key=(entry['ecosystem'],entry['name'],entry['version'])
 if key in unique:unique[key]['texts']=sorted(set(unique[key]['texts']+entry['texts']))
 else:unique[key]=entry
entries=sorted(unique.values(),key=lambda v:(v['ecosystem'],v['name'],v['version']))
out=root/'third_party';out.mkdir(exist_ok=True)
(out/'inventory.json').write_text(json.dumps({'inputs':fingerprints(root),'dependencies':entries,'texts':texts},indent=2,ensure_ascii=False)+'\n')
if errors:
 print('\n'.join(errors));raise SystemExit(1)
# Android POMs often refer to a common Apache license without embedding a duplicate.
# Include exact SPDX license texts for those declarations as well as upstream notices.
standard=root/'third_party/licenses'
license_texts='\n\n'.join(p.read_text() for p in sorted(standard.glob('*.txt')))
notice='WOVENLEAF THIRD-PARTY NOTICES\n\n'+(root/'LICENSE').read_text()+'\nThird-party components retain their own licenses; see each entry and license text below.\nJSZip: MIT option selected. Modified Capgo share-target files remain MPL-2.0.\nCorresponding source: https://github.com/hmrguez/BookManager/tree/main/third_party/capacitor-share-target\n\n'
for entry in entries:
 notice+=f"{entry['ecosystem']}: {entry['name']} {entry['version']}\nLicense: {entry.get('license','see upstream license text')}\nSource: {entry['source'] or 'See upstream package metadata'}\n"
 if entry.get('organization'):notice+='Organization: '+entry['organization']+'\n'
 for ref in entry['texts']:notice+=texts[ref]['text']+'\n'
 notice+='\n'+'-'*72+'\n\n'
notice+='COMMON LICENSE TEXTS\n\n'+license_texts
(out/'NOTICES.txt').write_text(notice)
for app in ['apps/mobile','apps/landing']:
 dest=root/app/'public/licenses';dest.mkdir(parents=True,exist_ok=True)
 (dest/'NOTICES.txt').write_text(notice)
print(f'Generated notices for {len(entries)} resolved dependencies, {len(texts)} distinct upstream notice texts.')
