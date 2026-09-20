(() => {
  const api = WovenleafLibby.api;
  let signature = '', timer, pending, inFlight;
  async function capture(force = false) {
    if (inFlight) return inFlight.catch(() => ({ ok: false, message: 'Reopen the companion and refresh your shelf.' }));
    let snapshot = readWovenleafShelf();
    if (!snapshot) return { ok: false, message: 'Open your Libby Shelf and wait for its progress labels.' };
    const next = JSON.stringify(snapshot.observations);
    if (!force && signature === next) return { ok: true };
    // Retain the ID across retries so a lost receipt cannot fill the native inbox.
    if (pending && JSON.stringify(pending.observations) === next && Date.now() - Date.parse(pending.capturedAt) < 86400000) snapshot = pending;
    pending = snapshot;
    try {
      inFlight = api.runtime.sendMessage({ type: 'capture', path: location.pathname, snapshot });
      const result = await inFlight;
      if (result?.ok && result.transport !== 'pending') { signature = next; pending = undefined; }
      return result;
    } catch { return { ok: false, message: 'Reopen the companion and refresh your shelf.' }; }
    finally { inFlight = undefined; }
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => void capture(), 500); };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { signature = ''; schedule(); } });
  addEventListener('popstate', schedule);
  setInterval(schedule, 5000); // SPA route changes can precede any visible DOM mutation.
  api.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== api.runtime.id || message?.type !== 'capture-now') return false;
    capture(true).then(reply); return true;
  });
  schedule();
})();
