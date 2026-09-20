import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.dirname(fileURLToPath(import.meta.url));
for (const platform of ['chromium', 'safari']) {
  const output = path.join(root, 'dist', platform);
  await mkdir(output, { recursive: true });
  await cp(path.join(root, 'src'), output, { recursive: true });
  await cp(path.join(root, '../mobile/public/pwa-icon-192.png'), path.join(output, 'icon.png'));
  const manifest = JSON.parse(await readFile(path.join(root, `manifest.${platform}.json`), 'utf8'));
  await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}
console.log('Built Safari and Chromium companions in apps/libby-extension/dist.');
