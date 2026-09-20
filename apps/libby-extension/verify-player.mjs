// Real MV3 content scripts in synthetic cross-origin Libby/player fixtures.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import './build.mjs';
const require = createRequire(new URL('../mobile/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const extension = fileURLToPath(new URL('./dist/chromium', import.meta.url));
const profile = await mkdtemp(join(tmpdir(), 'wovenleaf-libby-player-'));
const origin = 'https://fixture.listen.overdrive.com';
let context;
try {
  context = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium', args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  await context.route('https://libbyapp.com/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><body>
    <article class="title-tile data-tile-class_loan data-title_111 data-title-tile-format_audiobook"><b class="title-tile-title">Book One</b><span class="title-tile-author">A. Reader</span><a class="title-tile-journey-percent" href="/shelf/journey/111"><span data-access="visual">0%</span></a></article></body>` }));
  await context.route(`${origin}/**`, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Book One</title><body><span class="timeline-percent-visual">5%</span><span>Chapter 70%</span><span>Downloaded 100%</span></body>' }));
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true }));
  const page = await context.newPage(); await page.goto('https://libbyapp.com/shelf');
  const snapshot = () => worker.evaluate(async () => (await chrome.storage.session.get('snapshot')).snapshot);
  const percent = async () => (await snapshot())?.observations[0].percent;
  await expect.poll(percent).toBe(0);
  await page.evaluate(origin => {
    history.pushState({}, '', '/open/loan/private-card-never-forwarded/111');
    const host = document.createElement('div'); host.className = 'bifocal-frame is-revealed';
    const frame = document.createElement('iframe'); frame.src = origin; host.append(frame); document.body.append(host);
  }, origin);
  await expect.poll(percent).toBe(5);
  const frame = page.frames().find(frame => frame.url().startsWith(origin));
  assert.ok(frame);
  assert.equal(await frame.evaluate(() => typeof WovenleafLibby), 'undefined');
  await frame.locator('.timeline-percent-visual').evaluate(el => el.textContent = '12%');
  await expect.poll(percent).toBe(12);
  // A stale Shelf must neither regress progress nor replace the last useful snapshot.
  const last = await snapshot();
  await page.evaluate(() => { history.pushState({}, '', '/shelf'); document.querySelector('.bifocal-frame').classList.remove('is-revealed'); });
  await page.waitForTimeout(1200); assert.equal((await snapshot()).id, last.id);
  await page.locator('[data-access="visual"]').evaluate(el => el.textContent = '12%');
  await expect.poll(async () => (await snapshot())?.id).not.toBe(last.id);
  // Samples and other frames cannot update a loan, even with a plausible percentage.
  await page.evaluate(() => { history.pushState({}, '', '/open/sample/library/111'); document.querySelector('.bifocal-frame').classList.add('is-revealed'); });
  await frame.locator('.timeline-percent-visual').evaluate(el => el.textContent = '80%');
  await page.waitForTimeout(1200); assert.equal(await percent(), 12);
  await page.evaluate(() => history.pushState({}, '', '/open/loan/private-card-never-forwarded/111'));
  await frame.evaluate(() => { document.title = 'Previous Book'; document.querySelector('.timeline-percent-visual').textContent = '60%'; });
  await page.waitForTimeout(1200); assert.equal(await percent(), 12);
  await frame.evaluate(() => { document.title = 'Book\u00a0One'; document.querySelector('.timeline-percent-visual').textContent = '15%'; });
  await expect.poll(percent).toBe(15);
  // Clocks and playback animations keep changing while the percentage is stable.
  await page.evaluate(() => { window.animation = setInterval(() => document.body.className = `tick-${Date.now()}`, 50); });
  await frame.evaluate(() => {
    const clock = document.createElement('span'); document.body.append(clock);
    window.animation = setInterval(() => clock.textContent = String(Date.now()), 50);
    document.querySelector('.timeline-percent-visual').textContent = '16%';
  });
  await expect.poll(percent).toBe(16);
  await page.evaluate(() => clearInterval(window.animation));
  await frame.evaluate(() => { clearInterval(window.animation); document.querySelector('.timeline-percent-visual').textContent = '15%'; });
  await expect.poll(percent).toBe(15);
  // Missing/duplicate/hidden labels are unknown, not zero.
  for (const mode of ['missing', 'hidden', 'duplicate']) {
    await frame.evaluate(mode => {
      document.querySelectorAll('.duplicate').forEach(el => el.remove());
      const el = document.querySelector('.timeline-percent-visual'); el.style.display = ''; el.textContent = '99%';
      if (mode === 'missing') el.textContent = 'Unknown';
      if (mode === 'hidden') el.style.display = 'none';
      if (mode === 'duplicate') { const copy = el.cloneNode(true); copy.classList.add('duplicate'); document.body.append(copy); }
    }, mode);
    await page.waitForTimeout(1200); assert.equal(await percent(), 15);
  }
  await page.evaluate(() => window.postMessage({ type: 'wovenleaf-player-percent', title: 'Book One', percent: 99 }, '*'));
  await page.waitForTimeout(700); assert.equal(await percent(), 15);
  // Rewinding in the actual player is forwarded for Wovenleaf's existing review flow.
  await frame.evaluate(() => { document.querySelector('.duplicate')?.remove(); document.querySelector('.timeline-percent-visual').textContent = '6%'; });
  await expect.poll(percent).toBe(6);
  const stored = await worker.evaluate(() => chrome.storage.session.get(null));
  assert.equal(JSON.stringify(stored).includes('private-card-never-forwarded'), false);
  assert.equal(JSON.stringify(stored).includes('listen.overdrive.com'), false);
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
  await popup.getByRole('checkbox').uncheck();
  await expect.poll(() => worker.evaluate(async () => Object.keys(await chrome.storage.session.get(null)).length)).toBe(0);
  console.log('PASS: cross-origin player 0→5→12→15, stale Shelf, sample/identity/source boundaries, missing/hidden/duplicate labels, rewind review, no card/URL retention, and erase on pause.');
} finally { await context?.close(); await rm(profile, { recursive: true, force: true }); }
