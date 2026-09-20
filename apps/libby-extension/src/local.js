// This key can only encrypt/decrypt this phone's capture inbox. No Libby credential.
(() => {
  const origin = `chrome-extension://${WovenleafLibby.api.runtime.id}`;
  const encoder = new TextEncoder();
  const bytes = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));
  const base64 = value => { let text = ''; for (const byte of new Uint8Array(value)) text += String.fromCharCode(byte); return btoa(text); };
  async function storage(mode, action) {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('wovenleaf-local-connection', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('connection');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error('Connection storage is unavailable.'));
    });
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('connection', mode); const request = action(tx.objectStore('connection'));
        tx.oncomplete = () => resolve(request?.result); tx.onerror = tx.onabort = () => reject(new Error('Connection could not be saved.'));
      });
    } finally { db.close(); }
  }
  const readKey = () => storage('readonly', store => store.get('key'));
  async function exchange(route, key, value) {
    const aad = response => encoder.encode(`wovenleaf-libby/v1${route}|${origin}|${response ? 'response' : 'request'}`);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(false) }, key, encoder.encode(JSON.stringify(value)));
    const response = await fetch(`http://127.0.0.1:43187${route}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit', redirect: 'error', cache: 'no-store',
      body: JSON.stringify({ iv: base64(iv), data: base64(data) }), signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) throw new Error('Open Wovenleaf and check the Libby connection. Reconnect this browser if needed.');
    const text = await response.text(); if (text.length > 4096) throw new Error('Invalid connection response.');
    const envelope = JSON.parse(text);
    if (typeof envelope.iv !== 'string' || typeof envelope.data !== 'string') throw new Error('Invalid connection response.');
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(envelope.iv), additionalData: aad(true) }, key, bytes(envelope.data));
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain));
  }
  globalThis.WovenleafLocal = Object.freeze({
    paired: async () => !!await readKey(),
    forget: () => storage('readwrite', store => store.delete('key')),
    async pair(code) {
      if (!/^[0-9a-f]{32}$/i.test(code)) throw new Error('Enter the connection code from Wovenleaf Settings.');
      const bootstrap = await crypto.subtle.importKey('raw', Uint8Array.from(code.match(/../g), hex => parseInt(hex, 16)), 'AES-GCM', false, ['encrypt', 'decrypt']);
      const challenge = crypto.randomUUID(); const response = await exchange('/v1/pair', bootstrap, { challenge });
      if (response.challenge !== challenge || typeof response.key !== 'string' || bytes(response.key).length !== 32) throw new Error('Invalid pairing response.');
      const key = await crypto.subtle.importKey('raw', bytes(response.key), 'AES-GCM', false, ['encrypt', 'decrypt']);
      await storage('readwrite', store => store.put(key, 'key'));
    },
    async deliver(snapshot) {
      const key = await readKey();
      if (!key) return { ok: true, transport: 'share', message: 'Connect this browser to Wovenleaf once for automatic delivery.' };
      try {
        const response = await exchange('/v1/capture', key, snapshot);
        if (response.id !== snapshot.id) throw new Error('Invalid receipt.');
        return response.ok ? { ok: true, transport: 'local', message: 'Saved automatically. Your Reading shelf updates when Wovenleaf opens.' }
          : { ok: true, transport: 'pending', message: 'Open Wovenleaf to receive saved captures, then return to this shelf.' };
      } catch { return { ok: true, transport: 'pending', message: 'Waiting for Wovenleaf’s local connection. Open Wovenleaf, then return to this shelf to retry automatically.' }; }
    },
  });
})();
