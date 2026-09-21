import { cp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
const JSZip = createRequire(new URL('../mobile/package.json', import.meta.url))('jszip');
const root = path.dirname(fileURLToPath(import.meta.url));
for (const platform of ['chromium', 'safari', 'firefox']) {
  const output = path.join(root, 'dist', platform);
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await cp(path.join(root, 'src'), output, { recursive: true });
  await cp(path.join(root, '../mobile/public/pwa-icon-192.png'), path.join(output, 'icon.png'));
  const manifest = JSON.parse(await readFile(path.join(root, `manifest.${platform}.json`), 'utf8'));
  await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  if (platform !== 'safari') {
    const zip = new JSZip();
    for (const file of (await readdir(output)).sort()) zip.file(file, await readFile(path.join(output, file)), { date: new Date('2026-01-01T00:00:00Z') });
    const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    await writeFile(path.join(root, 'dist', `wovenleaf-libby-${platform}.zip`), bytes);
    if (platform === 'chromium') {
      const assets = path.join(root, '../mobile/public/libby');
      await mkdir(assets, { recursive: true });
      await writeFile(path.join(assets, 'wovenleaf-libby-chromium.zip'), bytes);
    }
  }
}
console.log('Built Safari, Chromium and Firefox companions in apps/libby-extension/dist.');
