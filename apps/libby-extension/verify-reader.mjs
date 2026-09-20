// Installed MV3, cross-origin reader DOM and same-ID audiobook/ebook loans.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import './build.mjs';
const { chromium, expect } = createRequire(new URL('../mobile/package.json', import.meta.url))('@playwright/test');
const extension = fileURLToPath(new URL('./dist/chromium', import.meta.url));
const profile = await mkdtemp(join(tmpdir(), 'wovenleaf-libby-reader-'));
let context;
try {
  context = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium', args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  await context.route('https://libbyapp.com/**', route => route.fulfill({ contentType: 'text/html', body: ['book', 'audiobook'].map(format => `<article class="title-tile data-tile-class_loan data-title_111 data-title-tile-format_${format}"><b class="title-tile-title">Book One</b><span class="title-tile-author">A. Reader</span><a class="title-tile-journey-percent" href="/shelf/journey/111"><span data-access="visual">1%</span></a></article>`).join('') }));
  for (const domain of ['libbyapp', 'overdrive']) await context.route(`https://fixture.read.${domain}.com/**`, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Book One</title><div class="fast-pager" style="display:none"><div class="place-line"><div class="place-line-read" style="width:20%"></div></div></div><div class="pages-bar"><span class="place-phrase-visual">pg. 86</span><span>of 400</span></div><span class="timeline-percent-visual">99%</span><span>Chapter 80%</span>' }));
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true }));
  const page = await context.newPage(); await page.goto('https://libbyapp.com/shelf');
  const snapshot = () => worker.evaluate(async () => (await chrome.storage.session.get('snapshot')).snapshot);
  await expect.poll(async () => (await snapshot())?.observations.length).toBe(2);
  const openReader = async origin => {
    await page.evaluate(origin => {
      history.pushState({}, '', '/open/loan/private-card-never-forwarded/111');
      document.querySelector('.bifocal-frame')?.remove();
      const host = document.createElement('div'); host.className = 'bifocal-frame is-revealed';
      const frame = document.createElement('iframe'); frame.src = origin; host.append(frame); document.body.append(host);
    }, origin);
    await expect.poll(() => page.frames().some(frame => frame.url().startsWith(origin))).toBe(true);
    return page.frames().find(frame => frame.url().startsWith(origin));
  };
  let frame = await openReader('https://fixture.read.libbyapp.com');
  const percent = async () => (await snapshot())?.observations[0].percent;
  await expect.poll(percent).toBe(20);
  assert.equal((await snapshot()).observations.length, 1);
  assert.equal((await snapshot()).observations[0].format, 'ebook');
  assert.equal(await frame.evaluate(() => typeof WovenleafLibby), 'undefined');
  // Page count, percentage label rounding and navigation previews don't replace
  // the committed whole-book bar; hidden controls still receive page changes.
  await frame.evaluate(() => { document.querySelector('.pages-bar').classList.add('is-percent'); document.querySelector('.place-phrase-visual').textContent = '21%'; });
  await page.waitForTimeout(1200); assert.equal(await percent(), 20);
  await frame.locator('.place-line-read').evaluate(el => el.style.width = '23%');
  await expect.poll(percent).toBe(23);
  await frame.locator('.fast-pager').evaluate(el => el.style.display = 'block');
  await page.waitForTimeout(1200); assert.equal(await percent(), 23);
  // Unknown/ambiguous bars are never converted to zero or inferred from pages.
  for (const mode of ['missing', 'pixels', 'invalid', 'duplicate']) {
    await frame.evaluate(mode => {
      document.querySelector('.duplicate')?.remove();
      const bar = document.querySelector('.place-line-read');
      bar.style.width = mode === 'missing' ? '' : mode === 'pixels' ? '85px' : mode === 'invalid' ? '101%' : '90%';
      if (mode === 'duplicate') { const copy = bar.parentElement.cloneNode(true); copy.classList.add('duplicate'); document.body.append(copy); }
    }, mode);
    await page.waitForTimeout(1200); assert.equal(await percent(), 23);
  }
  await frame.evaluate(() => { document.querySelector('.duplicate').remove(); document.querySelector('.place-line-read').style.width = '24%'; document.title = 'Different Book'; });
  await page.waitForTimeout(1200); assert.equal(await percent(), 23);
  await frame.evaluate(() => { document.title = 'Book One'; });
  await expect.poll(percent).toBe(24);
  await page.locator('iframe').evaluate(el => el.style.display = 'none');
  await frame.locator('.place-line-read').evaluate(el => el.style.width = '25%');
  await page.waitForTimeout(1200); assert.equal(await percent(), 24);
  await page.locator('iframe').evaluate(el => el.style.display = '');
  await expect.poll(percent, { timeout: 10000 }).toBe(25);
  await page.evaluate(() => history.pushState({}, '', '/open/sample/library/111'));
  await frame.locator('.place-line-read').evaluate(el => el.style.width = '90%');
  await page.waitForTimeout(1200); assert.equal(await percent(), 25);
  // Returning to stale Shelf must preserve ebook 25, retaining the audio loan.
  await page.evaluate(() => { history.pushState({}, '', '/shelf'); document.querySelector('.bifocal-frame').classList.remove('is-revealed'); });
  await expect.poll(async () => (await snapshot())?.observations[0].format).toBe('audiobook');
  assert.equal((await snapshot()).observations.length, 1);
  assert.equal(await percent(), 1);
  const remembered = await worker.evaluate(async () => (await chrome.storage.session.get('loans')).loans);
  assert.equal(remembered.find(entry => entry.observation.format === 'ebook').playerPercent, 25);
  assert.equal(remembered.find(entry => entry.observation.format === 'audiobook').playerPercent, undefined);
  // Public OverDrive reader host also works. Deliberate rewind is forwarded.
  frame = await openReader('https://fixture.read.overdrive.com');
  await expect.poll(percent).toBe(20);
  await frame.locator('.place-line-read').evaluate(el => el.style.width = '0%');
  await expect.poll(percent).toBe(0);
  const stored = JSON.stringify(await worker.evaluate(() => chrome.storage.session.get(null)));
  assert.equal(stored.includes('private-card-never-forwarded'), false);
  assert.equal(stored.includes('.read.'), false);
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
  await popup.getByRole('checkbox').uncheck();
  await expect.poll(() => worker.evaluate(async () => Object.keys(await chrome.storage.session.get(null)).length)).toBe(0);
  console.log('PASS: reader 1→20→23→24→25, hidden controls, page/percent modes, invalid/ambiguous bars, wrong title/hidden frame/sample, format isolation, stale Shelf, both reader hosts, rewind/zero, no card/URL retention and opt-out.');
} finally { await context?.close(); await rm(profile, { recursive: true, force: true }); }
