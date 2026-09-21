if (typeof importScripts === 'function') importScripts('common.js', 'local.js');
(() => {
  const { api, valid } = WovenleafLibby;
  const cache = api.storage.session ?? api.storage.local;
  let tail = Promise.resolve();
  const isPopup = sender => sender.id === api.runtime.id && sender.url === api.runtime.getURL('popup.html');
  const key = observation => `${observation.format}:${observation.titleId}`;
  async function loans() {
    const { loans = [] } = await cache.get('loans');
    const fresh = Array.isArray(loans) ? loans.filter(entry => Date.now() - Date.parse(entry.seenAt) < 86400000).slice(-100) : [];
    if (!Array.isArray(loans) || fresh.length !== loans.length) await cache.set({ loans: fresh });
    return fresh;
  }
  async function rememberShelf(snapshot) {
    const remembered = new Map((await loans()).map(entry => [key(entry.observation), entry]));
    const observations = [];
    for (const observation of snapshot.observations) {
      const identity = key(observation), previous = remembered.get(identity);
      // A late Shelf refresh is not evidence that the user rewound the player.
      const stale = previous?.playerPercent !== undefined && observation.percent < previous.playerPercent;
      remembered.delete(identity);
      remembered.set(identity, { ...previous, observation, seenAt: snapshot.capturedAt });
      if (!stale) observations.push(observation);
    }
    await cache.set({ loans: [...remembered.values()].slice(-100) });
    return { ...snapshot, observations };
  }
  async function playerSnapshot(position) {
    if (!position || typeof position.titleId !== 'string' || !/^\d{1,20}$/.test(position.titleId) || typeof position.title !== 'string' || !['ebook', 'audiobook'].includes(position.format) ||
        Object.keys(position).some(key => !['titleId', 'format', 'title', 'percent', 'id', 'capturedAt'].includes(key))) return null;
    const remembered = await loans();
    const entry = remembered.find(entry => key(entry.observation) === `${position.format}:${position.titleId}`);
    if (!entry) return null;
    // Reject a previous book's frame during an SPA switch, even on the same origin.
    const normalized = text => text.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('en');
    if (normalized(position.title) !== normalized(entry.observation.title)) return null;
    const snapshot = { kind: 'wovenleaf-libby', version: 1, id: position.id, capturedAt: position.capturedAt,
      observations: [{ ...entry.observation, percent: position.percent }] };
    if (!valid(snapshot)) return null;
    entry.playerPercent = position.percent;
    entry.seenAt = snapshot.capturedAt;
    await cache.set({ loans: remembered });
    return snapshot;
  }
  async function latest() {
    await loans();
    const { snapshot } = await cache.get('snapshot');
    if (!valid(snapshot) || Date.now() - Date.parse(snapshot.capturedAt) > 86400000) { await cache.remove('snapshot'); return null; }
    return snapshot;
  }
  async function queued() {
    const { pendingCaptures = [] } = await cache.get('pendingCaptures');
    const fresh = pendingCaptures.filter(snapshot => valid(snapshot) && Date.now() - Date.parse(snapshot.capturedAt) < 86400000).slice(-20);
    if (fresh.length !== pendingCaptures.length) await cache.set({ pendingCaptures: fresh });
    return fresh;
  }
  async function flush() {
    const pending = await queued();
    let result = { ok: true };
    while (pending.length) {
      result = await deliver(pending[0]);
      if (result.transport === 'pending' || result.transport === 'share' || !result.ok) return result;
      pending.shift();
      await cache.set({ pendingCaptures: pending });
    }
    return result;
  }
  async function enqueue(snapshot) {
    const identities = new Set(snapshot.observations.map(key));
    // Keep the newest position for a book while disconnected, without losing other loans.
    const superseded = old => old.id === snapshot.id || old.observations.every(observation => identities.has(key(observation)));
    let pending = (await queued()).filter(old => !superseded(old));
    if (pending.length >= 20) {
      await flush();
      pending = (await queued()).filter(old => !superseded(old));
      if (pending.length >= 20) return { ok: true, transport: 'pending', message: 'Open Wovenleaf to receive the waiting captures.' };
    }
    pending.push(snapshot);
    await cache.set({ snapshot, pendingCaptures: pending });
    return flush();
  }
  async function deliver(snapshot) {
    if (!api.runtime.getManifest().permissions.includes('nativeMessaging')) return WovenleafLocal.deliver(snapshot);
    try {
      const result = await api.runtime.sendNativeMessage('com.hmrguez.wovenleaf.LibbyExtension', { snapshot });
      return result?.ok ? { ok: true, transport: 'native' } : { ok: true, transport: 'pending', message: result?.message ?? 'Enable Libby in Wovenleaf, then capture again.' };
    } catch { return { ok: true, transport: 'pending', message: 'Open Wovenleaf and enable Libby, then capture again.' }; }
  }
  async function handle(message, sender) {
    if (message?.type === 'capture' || message?.type === 'player-capture') {
      let origin; try { origin = new URL(sender.url).origin; } catch { return { ok: false }; }
      // sender.url can retain the original SPA route; origin and observed route are checked separately.
      if (sender.id !== api.runtime.id || sender.frameId !== 0 || origin !== 'https://libbyapp.com') return { ok: false };
      const { enabled } = await api.storage.local.get('enabled');
      if (!enabled) return { ok: false, message: 'Enable capture in the Wovenleaf companion first.' };
      let snapshot;
      if (message.type === 'capture') {
        if (!/^\/shelf(?:\/loans)?\/?$/.test(message.path ?? '') || !valid(message.snapshot)) return { ok: false };
        snapshot = await rememberShelf(message.snapshot);
        // Retry a waiting player capture even after leaving it for a stale Shelf.
        if (!snapshot.observations.length) return flush();
      } else {
        snapshot = await playerSnapshot(message.position);
        if (!snapshot) return { ok: false, message: 'Visit your Libby Shelf once so the companion can identify this loan.' };
      }
      return enqueue(snapshot);
    }
    if (!isPopup(sender)) return { ok: false };
    if (message?.type === 'status') { await queued(); return { ...await api.storage.local.get('enabled'), snapshot: await latest(), paired: typeof WovenleafLocal !== 'undefined' && await WovenleafLocal.paired() }; }
    if (message?.type === 'pair' && typeof WovenleafLocal !== 'undefined') {
      await WovenleafLocal.pair(message.code);
      // The pairing button explicitly consents to capture as well as delivery.
      await api.storage.local.set({ enabled: true });
      if ((await queued()).length) return flush();
      const snapshot = await latest(); return snapshot ? deliver(snapshot) : { ok: true, message: 'Connected. Return to your Libby Shelf to capture automatically.' };
    }
    if (message?.type === 'forget' && typeof WovenleafLocal !== 'undefined') { await WovenleafLocal.forget(); return { ok: true }; }
    if (message?.type === 'enable' && typeof message.enabled === 'boolean') {
      await api.storage.local.set({ enabled: message.enabled });
      if (!message.enabled) await cache.remove(['snapshot', 'loans', 'pendingCaptures']);
      return { ok: true };
    }
    if (message?.type === 'retry') {
      if ((await queued()).length) return flush();
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
