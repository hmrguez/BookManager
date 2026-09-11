import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(root + 'apps/landing/package.json');
const sharp = require('sharp');
const output = root + 'branding/google-play/export/';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sources = [
  ['screenshots', 'screenshot-01-library.jpg', 'apps/landing/public/screenshots/library.jpg', 'Library and shelves. Web capture; visible desktop shortcut and scrollbar. Taller than Play’s 2:1 limit.'],
  ['screenshots', 'screenshot-02-reader.jpg', 'apps/landing/public/screenshots/reader.jpg', 'Native EPUB reader, user-supplied capture. Visible iOS home indicator; taller than Play’s 2:1 limit.'],
  ['screenshots', 'screenshot-03-audiobook.jpg', 'apps/landing/public/screenshots/audiobook.jpg', 'Production player UI with static marketing fixture data, not evidence of playback. Taller than Play’s 2:1 limit.'],
  ['campaign', 'campaign-01-track.png', 'apps/landing/public/marketing/01-track.png', 'Existing Track campaign artwork; PNG contains an alpha channel.'],
  ['campaign', 'campaign-02-read.png', 'apps/landing/public/marketing/02-read.png', 'Existing Read campaign artwork; includes the supplied reader capture; PNG contains an alpha channel.'],
  ['campaign', 'campaign-03-listen.png', 'apps/landing/public/marketing/03-listen.png', 'Existing Listen campaign artwork; uses the static player fixture; PNG contains an alpha channel.'],
  ['editable campaign', 'campaign-01-track.svg', 'branding/marketing/infographics/01-track.svg', 'Editable vector composition with embedded screenshot.'],
  ['editable campaign', 'campaign-02-read.svg', 'branding/marketing/infographics/02-read.svg', 'Editable vector composition with embedded screenshot.'],
  ['editable campaign', 'campaign-03-listen.svg', 'branding/marketing/infographics/03-listen.svg', 'Editable vector composition with embedded screenshot.'],
  ['logos', 'wovenleaf-logo.svg', 'apps/landing/public/mark.svg', 'Landing page logo and favicon; same bytes as the canonical SVG master.'],
  ['logos', 'wovenleaf-logo-2048.png', 'branding/source/wovenleaf-mark-color-2048px.png', 'Canonical high-resolution raster logo.'],
  ['logos', 'wovenleaf-wordmark.svg', 'branding/final/wovenleaf-lockup-horizontal.svg', 'Approved horizontal leaf-and-wordmark lockup.'],
  ['logos', 'wovenleaf-wordmark-1024.png', 'branding/final/png/wovenleaf-lockup-horizontal-1024px.png', 'Transparent horizontal lockup export.'],
  ['logos', 'wovenleaf-logo-monochrome.svg', 'branding/final/wovenleaf-mark-monochrome.svg', 'Single-color logo.'],
  ['logos', 'wovenleaf-logo-reversed.svg', 'branding/final/wovenleaf-mark-reversed.svg', 'Logo for dark backgrounds.'],
  ['logos', 'wovenleaf-logo-small.svg', 'branding/final/wovenleaf-mark-small.svg', 'Simplified approved logo for small sizes.'],
  ['store icons', 'app-store-icon-1024.png', 'branding/final/platform/store/app-store-icon-1024.png', 'Existing Apple App Store icon.'],
  ['store icons', 'google-play-icon-original-512.png', 'branding/final/platform/store/google-play-icon-512.png', 'Original RGB store icon. Use the 32-bit google-play-icon-512.png export for Play Console.'],
  ['platform marks', 'platform-apple.svg', 'apps/landing/public/store-logos/apple.svg', 'Apple mark from the landing download link; not the Wovenleaf app icon.'],
  ['platform marks', 'platform-google-play.svg', 'apps/landing/public/store-logos/google-play.svg', 'Google Play mark from the landing download link; do not use as the app icon or add it to the feature graphic.'],
];

await mkdir(output, { recursive: true });
const inventory = [];
for (const [group, name, source, note] of sources) {
  await copyFile(root + source, output + name);
  const original = await readFile(root + source);
  const copied = await readFile(output + name);
  if (hash(original) !== hash(copied)) throw new Error('Copy changed: ' + source);
  const meta = await sharp(copied).metadata();
  inventory.push({ group, file: name, source, width: meta.width, height: meta.height,
    format: meta.format, hasAlpha: meta.hasAlpha, bytes: copied.length,
    sha256: hash(copied), copiedWithoutChanges: true, note });
}

// Change the PNG container to the 32-bit format Play requires, preserving RGBA pixels.
await sharp(output + 'google-play-icon-original-512.png').ensureAlpha().png()
  .toFile(output + 'google-play-icon-512.png');
const originalIconPixels = await sharp(output + 'google-play-icon-original-512.png').ensureAlpha().raw().toBuffer();
const exportedIconPixels = await sharp(output + 'google-play-icon-512.png').raw().toBuffer();
if (!originalIconPixels.equals(exportedIconPixels)) throw new Error('Icon pixels changed');

for (const [file, note] of [
  ['google-play-icon-512.png', 'Play Console app icon: verified 512 × 512, 32-bit RGBA PNG, under 1 MB. Visual pixels match the original icon.'],
  ['feature-graphic-1024x500.png', 'New AI-composited promotional graphic based on the supplied assets. Verified 1024 × 500, 24-bit RGB PNG with no alpha. This is marketing artwork, not a raw app screenshot.'],
]) {
  if (file.startsWith('feature')) {
    await copyFile(root + 'branding/google-play/' + file, output + file);
  }
  const bytes = await readFile(output + file);
  const meta = await sharp(bytes).metadata();
  const icon = file.startsWith('google');
  if (meta.width !== (icon ? 512 : 1024) || meta.height !== (icon ? 512 : 500)
    || meta.hasAlpha !== icon || meta.channels !== (icon ? 4 : 3)
    || (icon && bytes.length > 1024 * 1024)) throw new Error('Invalid Play asset: ' + file);
  inventory.unshift({ group: 'Play upload', file, width: meta.width, height: meta.height,
    format: meta.format, hasAlpha: meta.hasAlpha, bytes: bytes.length, sha256: hash(bytes), note });
}

await copyFile(root + 'branding/google-play/feature-graphic-prompt.txt', output + 'feature-graphic-prompt.txt');
await copyFile(root + 'apps/landing/public/store-logos/README.md', output + 'platform-marks-sources.md');
await writeFile(output + 'asset-manifest.json', JSON.stringify({ checked: '2026-09-11', assets: inventory }, null, 2) + '\n');

const sections = [...new Set(inventory.map((asset) => asset.group))].map((group) => {
  const rows = inventory.filter((asset) => asset.group === group).map((asset) =>
    `| [${asset.file}](${asset.file}) | ${asset.width} × ${asset.height}${asset.format === 'svg' ? ' viewBox / scalable' : ''} | ${asset.note} |`);
  return `## ${group}\n\n| File | Dimensions | Use / source notes |\n| --- | --- | --- |\n${rows.join('\n')}`;
});

await writeFile(output + '00-START-HERE.md', `# Wovenleaf — Google Play assets

Prepared 11 September 2026 from the landing app and approved branding files. The live landing page was checked at https://wovenleaf.app/.

## Upload fields

- **App icon:** [google-play-icon-512.png](google-play-icon-512.png).
- **Feature graphic:** [feature-graphic-1024x500.png](feature-graphic-1024x500.png).
- **Feature graphic alt text:** “Wovenleaf brings a book library, EPUB reader and audiobook player together. All your reading. One quiet place.”
- **Phone screenshots:** the three originals are included byte-for-byte. They are source material, not a verified Android upload set; see the notes below.

A feature graphic is a wide promotional image used on Google Play discovery surfaces and as the preview-video cover when a video exists. Google requires 1024 × 500 pixels, JPEG or 24-bit PNG without alpha. Keep important content away from edges and do not include store badges or promotional price/ranking claims.

## Screenshot notes

The original library (390 × 844), reader (973 × 2048), and player (376 × 844) images all exceed Google’s maximum 2:1 long-to-short ratio. The library is a web capture with a scrollbar and desktop shortcut; the reader shows an iOS home indicator. The audiobook image uses a documented static marketing fixture. Copies here retain the originals exactly. Capture the current Android build for an unambiguous Android screenshot set, or prepare accurately framed promotional screenshots from suitable Android captures. Padding alone would not resolve the platform/provenance differences.

The three existing 1080 × 1350 campaign PNGs fit the basic aspect-ratio range, but contain alpha channels and retain their original screenshot provenance. They are copied as source artwork, not certified as publication-ready screenshots. Their editable SVGs are included.

## Inventory scope

This package indexes every screenshot, campaign PNG, and icon file under apps/landing/public (nine image files), and includes the associated campaign SVGs plus the main approved logo variants and store icons. Native Android density variants, splash screens, and internal QA evidence are outside the landing asset set and are not duplicated here.

The landing logo is also used as the favicon and on legal pages; those are repeated uses of the same file. Screenshots under branding/marketing/screenshots and campaign PNGs under branding/marketing/infographics are source counterparts; only one copy of each landing asset is included. Exact original paths, dimensions, sizes, and SHA-256 hashes are in [asset-manifest.json](asset-manifest.json).

${sections.join('\n\n')}

## Provenance and editing

The feature graphic was made with the built-in image generation tool using the three existing screenshots and approved horizontal lockup. [The exact prompt](feature-graphic-prompt.txt) is included. It is AI-composited promotional art; use the original screenshot files when you need an unchanged capture. The export was normalized to Google’s exact size and opaque RGB PNG format.

Book covers remain the property of their respective rights holders. The player’s Pride and Prejudice cover is original project artwork; its fixture details are documented in branding/marketing/README.md. The existing Canva campaign is https://www.canva.com/design/DAHUU_EqUyQ/vsVhApN-YGWeehPXHvpRvQ/edit . No Canva design was changed in this task.

Apple and Google Play platform marks are included because they occur in the landing app; see [their source notes](platform-marks-sources.md). They are not Wovenleaf logos.

Google’s current requirements: https://support.google.com/googleplay/android-developer/answer/9866151?hl=en
`);

console.log(JSON.stringify({ directory: output, imageCount: inventory.length, verifiedOriginalCopies: sources.length }, null, 2));
