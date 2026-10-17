// Capture real app screens with an isolated, fictional reading history.
// Start the mobile development server on port 4183 before running this script.
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const { chromium, expect } = createRequire(new URL('../apps/mobile/package.json', import.meta.url))('@playwright/test');
const directory = new URL('../docs/screenshots/', import.meta.url);
const covers = JSON.parse(await readFile(new URL('covers/catalog.json', directory), 'utf8'));
const books = await Promise.all(covers.map(async (cover, index) => ({
  id: `reading-story-${cover.id}`, title: cover.title, authors: [cover.author],
  thumbnail: `data:image/svg+xml;base64,${(await readFile(new URL(`covers/${cover.id}.svg`, directory))).toString('base64')}`,
  format: index % 2 ? 'audiobook' : 'ebook',
  pageCount: 280 + index * 24, currentPage: 0, progress: 0, rating: 5, notes: '',
  shelf: 'reading', addedAt: '2026-07-01T10:00:00Z', lastUpdatedAt: '2026-07-01T10:00:00Z',
})));
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light', reducedMotion: 'reduce' });
  // Never load external covers, metadata, or a user's browser profile.
  await context.route(/^https?:\/\/(?!127\.0\.0\.1:4183(?:\/|$))/, route => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.setFixedTime(new Date('2026-10-17T12:00:00Z'));
  await page.addInitScript(() => localStorage.setItem('wovenleaf.language.v1', 'en'));
  await page.goto('http://127.0.0.1:4183/');
  await page.getByRole('button', { name: 'Stats', exact: true }).waitFor();
  await page.evaluate(async seed => {
    const r = await (await import('/src/storage/runtime.ts')).getStorageRuntime();
    const { readingEventSchema } = await import('/src/domain/catalog/index.ts');
    for (const [i, book] of seed.entries()) {
      const month = i < 3 ? '09' : '10';
      await r.library.save(book);
      await r.library.saveManual(book, { ...book, shelf: 'finished', progress: 100,
        currentPage: book.pageCount, finishedAt: `2026-${month}-16T12:00:00Z` }, { id: `story-finish-${i}` });
      const current = (await r.library.list()).find(row => row.id === book.id);
      const events = [];
      for (const day of [1, 3, 5, 7, 9, 11, 13, 15]) {
        const minutes = 12 + (day * 7 + i * 11) % 36;
        const audio = book.format === 'audiobook';
        const slices = audio ? 1 : minutes * 2;
        for (let slice = 0; slice < slices; slice++) {
          const start = Date.parse(`2026-${month}-${String(day).padStart(2, '0')}T${i % 2 ? '18' : '10'}:00:00Z`) + slice * 30_000;
          const end = start + (audio ? minutes * 60_000 : 30_000);
          const stamp = new Date(end).toISOString();
          events.push(readingEventSchema.parse({ id: `reading-event:story-${i}-${day}-${slice}`,
            editionId: current.readingEditionId, kind: 'session', sessionId: `reading-session:story-${i}-${day}-${slice}`,
            startedAt: new Date(start).toISOString(), endedAt: stamp, activeDurationMs: end - start,
            ...(!audio ? { activeCapture: { kind: 'epub-foreground', version: 1, captureId: `story:${i}:${day}`,
              intervalIndex: slice, startReason: slice ? 'checkpoint' : 'open', endReason: slice === slices - 1 ? 'close' : 'checkpoint' } } : {}),
            source: { kind: 'local', method: audio ? 'audio-player' : 'epub-reader' }, deviceId: 'reading-device:fictional-demo',
            observedAt: stamp, recordedAt: stamp, effectiveAt: stamp, timeConfidence: 1 }));
        }
      }
      await r.readingLedger.append({ events });
    }
    const period = { year: 2026, quarter: 3 };
    const { reviewArtwork } = await import('/src/reviews/presentation.ts');
    await r.reviewKeepsakes.open(period, reviewArtwork);
    await r.reviewKeepsakes.setIdentity(period, { status: 'chosen', genre: 'fantasy' });
    await r.reviewKeepsakes.complete(period);
  }, books);
  await page.reload();
  const capture = async name => {
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map(image => image.decode().catch(() => {})));
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    await page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, directory)), animations: 'disabled' });
  };
  await page.getByRole('button', { name: 'Stats', exact: true }).click();
  await expect(page.locator('.stats-chart-bars button')).toHaveCount(17);
  await capture('reading-stats');
  await page.locator('.stats-rhythm').scrollIntoViewIfNeeded();
  await capture('reading-rhythm');
  await page.getByRole('button', { name: 'Reviews', exact: true }).click();
  await page.getByRole('button', { name: /July–September 2026.*View keepsake/ }).click();
  await expect(page.getByRole('heading', { name: 'The Worldwanderer', exact: true })).toBeVisible();
  await capture('quarterly-review');
  expect(errors).toEqual([]);
  await context.close();
} finally {
  await browser.close();
}
console.log('Captured reading stats and quarterly review using fictional local history and CC0 demo covers.');
