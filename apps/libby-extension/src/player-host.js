// Bind a frame's percentage to the loan currently open in this Libby tab.
(() => {
  let latest;
  function active() {
    if (document.visibilityState !== 'visible') return null;
    const titleId = /^\/open\/loan\/[^/]+\/(\d{1,20})\/?$/.exec(location.pathname)?.[1];
    if (!titleId) return null; // Samples, magazines and other routes never count.
    const frames = [...document.querySelectorAll('.bifocal-frame.is-revealed iframe')].filter(WovenleafLibby.visible);
    if (frames.length !== 1 || !WovenleafLibby.playerOrigin(frames[0].src)) return null;
    return { titleId, frame: frames[0] };
  }
  addEventListener('message', event => {
    const value = event.data;
    if (!value || value.type !== 'wovenleaf-player-percent' || Object.keys(value).some(key => !['type', 'title', 'percent'].includes(key)) ||
        typeof value.title !== 'string' || !value.title.trim() || value.title.length > 500 ||
        typeof value.percent !== 'number' || !Number.isFinite(value.percent) || value.percent < 0 || value.percent > 100) return;
    const current = active();
    if (!current || event.source !== current.frame.contentWindow || event.origin !== new URL(current.frame.src).origin) return;
    latest = { ...current, title: value.title, percent: value.percent, receivedAt: Date.now() };
    dispatchEvent(new Event('wovenleaf-player-change'));
  });
  globalThis.readWovenleafPlayer = () => {
    const current = active();
    if (!current || !latest || latest.frame !== current.frame || latest.titleId !== current.titleId || Date.now() - latest.receivedAt > 10000) return null;
    return { titleId: current.titleId, title: latest.title, percent: latest.percent };
  };
})();
