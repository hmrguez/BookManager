// Original fictional covers, generated without downloaded art, text or fonts.
import { createRequire } from 'node:module';
const require = createRequire(new URL('../apps/landing/package.json', import.meta.url));
const sharp = require('sharp');
for (let i = 1; i <= 4; i++) {
  const title = ['The Quiet Orchard', 'Notes from the Estuary', 'A Map of Morning', 'The Paper Garden'][i - 1];
  const color = ['#c5ccb9', '#cfc1ad', '#b8c6c8', '#c8bbc8'][i - 1];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="840"><rect width="600" height="840" fill="${color}"/><rect x="30" y="30" width="540" height="780" rx="4" fill="none" stroke="#434b3b"/><g fill="#30382d" font-family="Georgia,serif" text-anchor="middle"><text x="300" y="160" font-size="26">WOVENLEAF DEMO</text><text x="300" y="300" font-size="35">${title}</text></g><path d="M300 660V400M300 550Q170 520 180 430Q285 430 300 550ZM300 500Q420 490 420 400Q315 400 300 500M140 720H460" fill="none" stroke="#434b3b" stroke-width="4"/></svg>`;
  const bytes = await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
  const { writeFile } = await import('node:fs/promises');
  await writeFile(new URL(`../apps/mobile/tests/fixtures/original-cover-${i}.jpg`, import.meta.url), bytes);
  if (i === 1) await writeFile(new URL('../apps/mobile/tests/fixtures/original-cover.jpg', import.meta.url), bytes);
}
