// Real installed MV3 worker + a synthetic encrypted loopback peer. No account data.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes, webcrypto } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import './build.mjs';
const { chromium, expect } = createRequire(new URL('../mobile/package.json', import.meta.url))('@playwright/test');
const extension = fileURLToPath(new URL('./dist/chromium', import.meta.url));
const profile = await mkdtemp(join(tmpdir(), 'wovenleaf-local-test-'));
const bootstrap = randomBytes(16), session = randomBytes(32);
const importKey = raw => webcrypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
const keys = { '/v1/pair': await importKey(bootstrap), '/v1/capture': await importKey(session) };
const received = [];
let mode = 'ok', context, origin;
const server = createServer(async (req, res) => {
  try {
    assert.equal(req.headers.origin, origin);
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
    assert.equal(req.method, 'POST'); assert.equal(req.headers.cookie, undefined);
    let wire = ''; for await (const chunk of req) wire += chunk;
    assert.ok(!wire.includes('Fixture loan') && !wire.includes('observations'));
    const envelope = JSON.parse(wire);
    const aad = response => Buffer.from(`wovenleaf-libby/v1${req.url}|${origin}|${response ? 'response' : 'request'}`);
    const payload = JSON.parse(Buffer.from(await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(envelope.iv, 'base64'), additionalData: aad(false) }, keys[req.url], Buffer.from(envelope.data, 'base64'))).toString());
    if (req.url === '/v1/capture') received.push(payload);
    if (mode === 'unavailable') { res.writeHead(503).end(); return; }
    const reply = req.url === '/v1/pair' ? { challenge: payload.challenge, key: session.toString('base64') }
      : { id: mode === 'wrong-id' ? crypto.randomUUID() : payload.id, ok: mode !== 'full' };
    const iv = randomBytes(12);
    const data = Buffer.from(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(true) }, keys[req.url], Buffer.from(JSON.stringify(reply))));
    if (mode === 'tampered') data[0] ^= 1;
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ iv: iv.toString('base64'), data: data.toString('base64') }));
  } catch { res.writeHead(403).end(); }
});
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(43187, '127.0.0.1', resolve); });
  const launch = () => chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium', args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  context = await launch();
  let worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  origin = `chrome-extension://${new URL(worker.url()).host}`;
  let popup = await context.newPage(); await popup.goto(`${origin}/popup.html`);
  await popup.getByText('Connection help', { exact: true }).click();
  await popup.locator('#code').fill('invalid-code');
  await popup.getByRole('button', { name: 'Connect & enable capture', exact: true }).click();
  await expect(popup.locator('#status')).toContainText('Connection failed');
  await expect(popup.locator('#enabled')).not.toBeChecked();
  await popup.locator('#code').fill(bootstrap.toString('hex'));
  await popup.getByRole('button', { name: 'Connect & enable capture', exact: true }).click();
  await expect(popup.locator('#connection-status')).toContainText('Paired');
  await expect(popup.locator('#enabled')).toBeChecked();
  assert.equal(await worker.evaluate(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open('wovenleaf-local-connection'); r.onsuccess = () => resolve(r.result); });
    const key = await new Promise(resolve => { const r = db.transaction('connection').objectStore('connection').get('key'); r.onsuccess = () => resolve(r.result); }); db.close();
    return key.extractable;
  }), false);
  // The opaque CryptoKey survives a browser/worker restart, without re-pairing.
  await context.close(); context = await launch();
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  assert.equal(await worker.evaluate(() => WovenleafLocal.paired()), true);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true }));
  await context.route('https://libbyapp.com/**', route => route.fulfill({ contentType: 'text/html', body: '<article class="title-tile data-tile-class_loan data-title_123 data-title-tile-format_audiobook"><b class="title-tile-title">Fixture loan</b><span class="title-tile-author">Test Author</span><a class="title-tile-journey-percent" href="/shelf/journey/123"><span data-access="visual">5%</span></a></article>' }));
  const page = await context.newPage(); await page.goto('https://libbyapp.com/shelf');
  await expect.poll(() => received.length).toBe(1);
  assert.equal(received[0].observations[0].percent, 5);
  mode = 'unavailable';
  await page.locator('[data-access="visual"]').evaluate(el => el.textContent = '10%');
  await expect.poll(() => received.length).toBe(2);
  const pendingId = received[1].id;
  mode = 'ok';
  await expect.poll(() => received.length, { timeout: 10000 }).toBeGreaterThanOrEqual(3);
  assert.equal(received[2].id, pendingId); assert.equal(received[2].observations[0].percent, 10);
  // The active audio frame, rather than a Shelf mutation, now drives delivery.
  mode = 'unavailable';
  await context.route('https://fixture.listen.overdrive.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Fixture loan</title><span class="timeline-percent-visual">15%</span>' }));
  await page.evaluate(() => {
    history.pushState({}, '', '/open/loan/test-card/123');
    const host = document.createElement('div'); host.className = 'bifocal-frame is-revealed';
    const frame = document.createElement('iframe'); frame.src = 'https://fixture.listen.overdrive.com/'; host.append(frame); document.body.append(host);
  });
  await expect.poll(() => received.at(-1)?.observations[0].percent).toBe(15);
  const frame = page.frames().find(frame => frame.url().startsWith('https://fixture.listen.overdrive.com'));
  await frame.locator('.timeline-percent-visual').evaluate(el => el.textContent = '20%');
  await expect.poll(() => received.at(-1)?.observations[0].percent).toBe(20);
  const pendingPlayerId = received.at(-1).id;
  const waiting = await worker.evaluate(async () => (await chrome.storage.session.get('pendingCaptures')).pendingCaptures);
  assert.equal(waiting.length, 1); assert.equal(waiting[0].observations[0].percent, 20);
  await page.evaluate(() => { history.pushState({}, '', '/shelf'); document.querySelector('.bifocal-frame').classList.remove('is-revealed'); });
  mode = 'ok';
  await expect.poll(() => worker.evaluate(async () => (await chrome.storage.session.get('pendingCaptures')).pendingCaptures.length), { timeout: 10000 }).toBe(0);
  assert.equal(received.at(-1).id, pendingPlayerId); assert.equal(received.at(-1).observations[0].percent, 20);
  const playerCaptureCount = received.length;
  await page.waitForTimeout(1200);
  assert.equal(received.length, playerCaptureCount); // Shelf still says 10%.
  // A forged receipt, corrupt ciphertext and a full inbox never count as delivery.
  for (const failure of ['wrong-id', 'tampered', 'full']) {
    mode = failure;
    assert.equal((await worker.evaluate(snapshot => WovenleafLocal.deliver(snapshot), received[0])).transport, 'pending');
  }
  mode = 'ok'; popup = await context.newPage(); await popup.goto(`${origin}/popup.html`);
  await popup.getByRole('button', { name: 'Retry automatic delivery' }).click();
  await expect(popup.locator('#status')).toContainText('Saved automatically');
  await popup.getByRole('button', { name: 'Disconnect this browser' }).click();
  await expect.poll(() => worker.evaluate(() => WovenleafLocal.paired())).toBe(false);
  assert.equal((await worker.evaluate(snapshot => WovenleafLocal.deliver(snapshot), received[0])).transport, 'share');
  console.log('PASS: installed companion pairs, persists a nonextractable key, encrypts Shelf 5→10 and player 15→20, coalesces waiting player updates and delivers after returning to a stale Shelf, retries with stable IDs, rejects forged/full receipts, supports manual retry and erases its key on disconnect.');
} finally {
  await context?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(profile, { recursive: true, force: true });
}
