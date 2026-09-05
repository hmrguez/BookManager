import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = root + 'branding/marketing/infographics/';
await mkdir(output, { recursive: true });
const logo = (
  await readFile(root + 'branding/source/wovenleaf-mark-color.svg')
).toString('base64');
const pages = [
  {
    name: '01-track',
    title: ['Less organizing.', 'More reading.'],
    section: '01 / TRACK',
    shot: '01-library.jpg',
    sub: ['A fast, simple book tracker.', 'A little order. A lot more story.'],
    steps: [
      ['01', 'Save the possibilities.', 'Keep your to-be-read list close.'],
      ['02', 'Know what comes next.', 'Put your next books in order.'],
      ['03', 'Remember the journey.', 'Track progress. Rate your favorites.'],
    ],
    footer: 'TRACK YOUR BOOKS · READ YOUR EPUBS · PLAY YOUR AUDIOBOOKS',
  },
  {
    name: '02-read',
    title: ['Your EPUBs.', 'Right at home.'],
    section: '02 / READ',
    shot: '02-epub.jpg',
    sub: ['Your books and your reading,', 'together in one quiet place.'],
    steps: [
      ['01', 'Bring your own EPUB.', 'Attach a file to its book.'],
      ['02', 'Settle into the story.', 'Open the reader on iOS or Android.'],
      ['03', 'Keep it personal.', 'Your file stays on your device.'],
    ],
    footer: 'ONE LIBRARY. A WHOLE WORLD TO READ.',
  },
  {
    name: '03-listen',
    title: ['Hands busy.', 'Story on.'],
    section: '03 / LISTEN',
    shot: '03-audiobook.jpg',
    dark: true,
    sub: ['An audiobook player,', 'already at home in your library.'],
    steps: [
      ['01', 'Bring the story along.', 'Add M4B or ordered MP3 files.'],
      ['02', 'Find your own pace.', 'Adjust speed. Set a sleep timer.'],
      ['03', 'Keep a thought.', 'Save a bookmark or a private note.'],
    ],
    footer: 'TRACK. READ. LISTEN. ONE SIMPLE PLACE.',
  },
];
const escape = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
for (const page of pages) {
  const bg = page.dark ? '#304432' : '#f5f1e7',
    ink = page.dark ? '#f5f1e7' : '#282d25',
    muted = page.dark ? '#c0ccba' : '#66705f',
    accent = page.dark ? '#d0d8bc' : '#43593e',
    line = page.dark ? '#64745b' : '#c6cdbb';
  const screenshot = (
    await readFile(root + 'branding/marketing/screenshots/' + page.shot)
  ).toString('base64');
  const texts = (lines, x, y, size, gap, fill, font = 'Georgia') =>
    lines
      .map(
        (t, i) =>
          `<text x="${x}" y="${y + i * gap}" font-family="${font}" font-size="${size}" fill="${fill}">${escape(t)}</text>`,
      )
      .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1080" height="1350" viewBox="0 0 1080 1350"><defs><clipPath id="screen"><rect x="596" y="370" width="390" height="844" rx="18"/></clipPath></defs><rect width="1080" height="1350" fill="${bg}"/><image x="68" y="56" width="44" height="44" xlink:href="data:image/svg+xml;base64,${logo}"/><text x="123" y="89" font-family="Georgia" font-size="35" fill="${ink}">Wovenleaf</text><text x="988" y="84" text-anchor="end" font-family="Helvetica" letter-spacing="3" font-size="15" fill="${muted}">${page.section}</text><path d="M68 121H1012" stroke="${line}"/>${texts(page.title, 68, 226, 76, 87, ink)}<text x="68" y="382" font-family="Helvetica" font-size="12" letter-spacing="3" fill="${muted}">YOUR WHOLE READING LIFE</text>${texts(page.sub, 68, 434, 25, 37, muted, 'Helvetica')}<rect x="588" y="362" width="406" height="860" rx="26" fill="${page.dark ? '#152719' : '#e0e3d6'}"/><rect x="583" y="357" width="406" height="860" rx="26" fill="none" stroke="${line}"/><image x="596" y="370" width="390" height="844" clip-path="url(#screen)" xlink:href="data:image/jpeg;base64,${screenshot}"/>${page.steps
    .map((s, i) => {
      const y = 590 + i * 170;
      return `<circle cx="88" cy="${y - 8}" r="20" stroke="${line}" fill="none"/><text x="88" y="${y - 3}" text-anchor="middle" font-size="13" font-family="Helvetica" fill="${accent}">${s[0]}</text><text x="68" y="${y + 43}" font-family="Georgia" font-size="28" fill="${ink}">${escape(s[1])}</text><text x="68" y="${y + 79}" font-family="Helvetica" font-size="19" fill="${muted}">${escape(s[2])}</text>`;
    })
    .join(
      '',
    )}<text x="68" y="1158" font-family="Georgia" font-style="italic" font-size="26" fill="${accent}">All your reading.</text><text x="68" y="1194" font-family="Georgia" font-style="italic" font-size="26" fill="${accent}">One quiet place.</text><path d="M68 1260H1012" stroke="${line}"/><text x="68" y="1304" font-family="Helvetica" font-size="12" letter-spacing="1.7" fill="${muted}">${page.footer}</text><text x="1012" y="1304" text-anchor="end" font-family="Helvetica" font-size="14" fill="${muted}">${page.section.slice(0, 2)} / 03</text></svg>`;
  await writeFile(output + page.name + '.svg', svg);
  await sharp(Buffer.from(svg))
    .png()
    .toFile(output + page.name + '.png');
  await writeFile(
    root + 'apps/landing/public/marketing/' + page.name + '.png',
    await readFile(output + page.name + '.png'),
  );
  console.log(page.name);
}

const thumbnails = await Promise.all(
  pages.map(async (page, index) => ({
    input: await sharp(output + page.name + '.png')
      .resize(360, 450)
      .toBuffer(),
    left: index * 360,
    top: 0,
  })),
);
await sharp({
  create: { width: 1080, height: 450, channels: 3, background: '#f5f1e7' },
})
  .composite(thumbnails)
  .png()
  .toFile(output + 'campaign-preview.png');
