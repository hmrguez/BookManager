// Run with the mobile development server on http://127.0.0.1:4173.
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(new URL('../apps/mobile/package.json', import.meta.url))('@playwright/test');
const directory = new URL('../docs/screenshots/', import.meta.url);
const covers = JSON.parse(await readFile(new URL('covers/catalog.json', directory), 'utf8'));
const books = await Promise.all(covers.map(async (cover, index) => ({
  id: `readme-${cover.id}`, title: cover.title, authors: [cover.author],
  thumbnail: `data:image/svg+xml;base64,${(await readFile(new URL(`covers/${cover.id}.svg`, directory))).toString('base64')}`,
  pageCount: 280, currentPage: index === 2 ? 118 : index === 3 ? 280 : 0,
  progress: index === 2 ? 42 : index === 3 ? 100 : 0,
  rating: index === 3 ? 5 : 0, notes: '',
  shelf: ['tbr', 'next', 'reading', 'finished', 'tbr', 'tbr'][index],
  addedAt: '2026-09-01T10:00:00Z', lastUpdatedAt: '2026-09-01T10:00:00Z',
})));
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    locale: 'en-US', colorScheme: 'light', reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.addInitScript(seed => {
    if (localStorage.getItem('readme-seeded')) return;
    localStorage.setItem('wovenleaf.language.v1', 'en');
    localStorage.setItem('wovenleaf.library.v1', JSON.stringify(seed));
    localStorage.setItem('wovenleaf.library-view.v1', 'list');
    localStorage.setItem('readme-seeded', 'true');
  }, books.slice(0, 4));
  await page.goto('http://127.0.0.1:4173/');
  await page.locator('#shelf-tbr .book-row').first().waitFor();
  const capture = async name => {
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map(image => image.decode().catch(() => {})));
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    await page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, directory)), animations: 'disabled' });
  };
  await capture('library');
  await page.locator('[data-library-book="readme-morning-map"]').click();
  await page.getByRole('dialog', { name: 'Book details', exact: true }).waitFor();
  await capture('book-details');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  // Use the production repository to populate a cover-grid demo, without touching user storage.
  await page.evaluate(async seed => {
    const { getStorageRuntime } = await import('/src/storage/runtime.ts');
    const runtime = await getStorageRuntime();
    for (const book of seed) await runtime.library.save({ ...book, shelf: 'tbr', currentPage: 0, progress: 0, rating: 0 });
  }, books);
  await page.reload();
  await page.locator('#shelf-tbr .book-row').first().waitFor();
  await page.getByRole('button', { name: 'Grid view', exact: true }).click();
  await page.locator('#shelf-tbr .book-tile').first().waitFor();
  await capture('library-grid');
  await context.close();
} finally {
  await browser.close();
}
console.log('Captured library, book details, and cover grid with original CC0 covers.');
