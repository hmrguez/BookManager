// Isolated world in the audio frame: read only its displayed whole-book label.
// Never read BIF, player URLs, book text, account storage or playback controls.
(() => {
  if (parent === window || !WovenleafLibby.playerOrigin(location.origin)) return;
  function capture() {
    if (document.visibilityState !== 'visible') return;
    const labels = [...document.querySelectorAll('.timeline-percent-visual')].filter(WovenleafLibby.visible);
    if (labels.length !== 1) return;
    const percent = WovenleafLibby.percentLabel(labels[0].textContent);
    if (percent === null) return;
    const title = document.title.trim();
    if (!title || title.length > 500) return;
    parent.postMessage({ type: 'wovenleaf-player-percent', title, percent }, 'https://libbyapp.com');
  }
  // Throttle instead of trailing debounce: playback continuously changes the DOM.
  let timer;
  const schedule = () => { if (!timer) timer = setTimeout(() => { timer = undefined; capture(); }, 500); };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
  document.addEventListener('visibilitychange', schedule);
  setInterval(capture, 5000);
  schedule();
})();
