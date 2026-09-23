// Safari's app-group consent handshake, using the actual background script and a bounded native fixture.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
let listener, appEnabled = false, deliveries = 0, probes = 0;
const data = {};
const storage = {
  async get(key) { return { [key]: data[key] }; },
  async set(value) { Object.assign(data, value); },
  async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; },
};
const api = {
  storage: { local: storage, session: storage },
  runtime: {
    id: 'safari-fixture', getURL: path => `safari-web-extension://fixture/${path}`, getManifest: () => ({ permissions: ['storage', 'nativeMessaging'] }),
    onMessage: { addListener(callback) { listener = callback; } },
    async sendNativeMessage(_, message) {
      if (message.type === 'connection-status') { probes++; return { enabled: appEnabled }; }
      assert.equal(appEnabled, true); assert.ok(message.snapshot); deliveries++; return { ok: true };
    },
  },
};
const context = vm.createContext({ browser: api, URL, TextEncoder, console });
vm.runInContext(await readFile(new URL('./src/common.js', import.meta.url), 'utf8'), context);
vm.runInContext(await readFile(new URL('./src/background.js', import.meta.url), 'utf8'), context);
const snapshot = { kind: 'wovenleaf-libby', version: 1, id: crypto.randomUUID(), capturedAt: new Date().toISOString(), observations: [], emptyShelf: true };
const capture = (url = 'https://libbyapp.com/shelf') => new Promise(resolve => listener({ type: 'capture', path: '/shelf', snapshot }, { id: api.runtime.id, frameId: 0, url }, resolve));
assert.equal((await capture()).ok, false); assert.equal(deliveries, 0);
appEnabled = true;
assert.equal((await capture()).transport, 'native'); assert.equal(data.enabled, true); assert.equal(deliveries, 1);
data.enabled = false;
const before = probes;
assert.equal((await capture()).ok, false); assert.equal(probes, before); // Explicit browser opt-out is respected.
assert.equal((await capture('https://evil.example/shelf')).ok, false);
console.log('PASS: Safari first capture follows native app consent, delivers an explicit empty shelf, respects browser opt-out and rejects foreign pages.');
