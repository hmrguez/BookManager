(() => {
  const api = WovenleafLibby.api;
  let signature = '', timer, pending, inFlight;
  async function capture(force = false) {
    if (inFlight) return inFlight.catch(() => ({ ok: false, message: 'Reopen the companion and refresh your shelf.' }));
    const player = readWovenleafPlayer();
    let snapshot = player ? { ...player, id: crypto.randomUUID(), capturedAt: new Date().toISOString() } : readWovenleafShelf();
    if (!snapshot) return { ok: false, message: 'Open your Libby Shelf or audiobook player and wait for its progress label.' };
    const next = JSON.stringify(player ?? snapshot.observations);
    if (!force && !pending && signature === next) return { ok: true };
    // Retain the ID across retries so a lost receipt cannot fill the native inbox.
    if (pending?.signature === next && Date.now() - Date.parse(pending.snapshot.capturedAt) < 86400000) snapshot = pending.snapshot;
    pending = { signature: next, snapshot };
    try {
      // The loan path contains a card identifier. Never send or store it.
      inFlight = api.runtime.sendMessage(player ? { type: 'player-capture', position: snapshot } : { type: 'capture', path: location.pathname, snapshot });
      const result = await inFlight;
      if (result?.ok && result.transport !== 'pending') { signature = next; pending = undefined; }
      return result;
    } catch { return { ok: false, message: 'Reopen the companion and refresh your shelf.' }; }
    finally { inFlight = undefined; }
  }
  // Continuous playback/animation mutations must not postpone capture forever.
  const schedule = () => { if (!timer) timer = setTimeout(() => { timer = undefined; void capture(); }, 500); };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'src', 'srcset', 'data-cover-id'] });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { signature = ''; schedule(); } });
  addEventListener('popstate', schedule);
  addEventListener('wovenleaf-player-change', schedule);
  setInterval(schedule, 5000); // SPA route changes can precede any visible DOM mutation.
  api.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== api.runtime.id || message?.type !== 'capture-now') return false;
    capture(true).then(reply); return true;
  });
  schedule();
})();
