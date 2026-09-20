if (typeof importScripts === 'function') importScripts('common.js', 'local.js');
(() => {
  const { api, valid } = WovenleafLibby;
  const cache = api.storage.session ?? api.storage.local;
  let tail = Promise.resolve();
  const isPopup = sender => sender.id === api.runtime.id && sender.url === api.runtime.getURL('popup.html');
  async function latest() {
    const { snapshot } = await cache.get('snapshot');
    if (!valid(snapshot) || Date.now() - Date.parse(snapshot.capturedAt) > 86400000) { await cache.remove('snapshot'); return null; }
    return snapshot;
  }
  async function deliver(snapshot) {
    if (!api.runtime.getManifest().permissions.includes('nativeMessaging')) return WovenleafLocal.deliver(snapshot);
    try {
      const result = await api.runtime.sendNativeMessage('com.hmrguez.wovenleaf.LibbyExtension', { snapshot });
      return result?.ok ? { ok: true, transport: 'native' } : { ok: true, transport: 'pending', message: result?.message ?? 'Enable Libby in Wovenleaf, then capture again.' };
    } catch { return { ok: true, transport: 'pending', message: 'Open Wovenleaf and enable Libby, then capture again.' }; }
  }
  async function handle(message, sender) {
    if (message?.type === 'capture') {
      let origin; try { origin = new URL(sender.url).origin; } catch { return { ok: false }; }
      // sender.url can retain the original SPA route; origin and observed route are checked separately.
      if (sender.id !== api.runtime.id || sender.frameId !== 0 || origin !== 'https://libbyapp.com' ||
          !/^\/shelf(?:\/loans)?\/?$/.test(message.path ?? '') || !valid(message.snapshot)) return { ok: false };
      const { enabled } = await api.storage.local.get('enabled');
      if (!enabled) return { ok: false, message: 'Enable capture in the Wovenleaf companion first.' };
      await cache.set({ snapshot: message.snapshot });
      return deliver(message.snapshot);
    }
    if (!isPopup(sender)) return { ok: false };
    if (message?.type === 'status') return { ...await api.storage.local.get('enabled'), snapshot: await latest(), paired: typeof WovenleafLocal !== 'undefined' && await WovenleafLocal.paired() };
    if (message?.type === 'pair' && typeof WovenleafLocal !== 'undefined') {
      await WovenleafLocal.pair(message.code);
      const snapshot = await latest(); return snapshot ? deliver(snapshot) : { ok: true, message: 'Connected. Return to your Libby Shelf to capture automatically.' };
    }
    if (message?.type === 'forget' && typeof WovenleafLocal !== 'undefined') { await WovenleafLocal.forget(); return { ok: true }; }
    if (message?.type === 'enable' && typeof message.enabled === 'boolean') {
      await api.storage.local.set({ enabled: message.enabled });
      if (!message.enabled) await cache.remove('snapshot');
      return { ok: true };
    }
    if (message?.type === 'retry') {
      const snapshot = await latest(); return snapshot ? deliver(snapshot) : { ok: false, message: 'Capture your shelf first.' };
    }
    return { ok: false };
  }
  api.runtime.onMessage.addListener((message, sender, reply) => {
    const work = tail.then(() => handle(message, sender));
    tail = work.catch(() => undefined);
    work.then(reply, () => reply({ ok: false, message: 'Progress could not be saved. Try again.' }));
    return true;
  });
})();
