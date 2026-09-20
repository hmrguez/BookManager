(() => {
  const api = WovenleafLibby.api;
  let signature = '', timer;
  async function capture(force = false) {
    const snapshot = readWovenleafShelf();
    if (!snapshot) return { ok: false, message: 'Open your Libby Shelf and wait for its progress labels.' };
    const next = JSON.stringify(snapshot.observations);
    if (!force && signature === next) return { ok: true };
    try {
      const result = await api.runtime.sendMessage({ type: 'capture', path: location.pathname, snapshot });
      if (result?.ok) signature = next;
      return result;
    } catch { return { ok: false, message: 'Reopen the companion and refresh your shelf.' }; }
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
