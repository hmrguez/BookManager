// Isolated world in a reader/player frame: read its whole-book progress control.
// Never read BIF, player URLs, book text, account storage or playback controls.
(() => {
  const format = WovenleafLibby.playerFormat(location.origin);
  if (parent === window || !format) return;
  function capture() {
    if (document.visibilityState !== 'visible') return;
    let percent;
    if (format === 'ebook') {
      // Libby updates this control on committed page changes even with the
      // navigation controls hidden. Page numbers and seeker previews are not
      // whole-book progress. Read the declared percent, never pixel geometry.
      const bars = document.querySelectorAll('.place-line > .place-line-read');
      if (bars.length !== 1) return;
      percent = WovenleafLibby.percentLabel(bars[0].style.width);
    } else {
      const labels = [...document.querySelectorAll('.timeline-percent-visual')].filter(WovenleafLibby.visible);
      if (labels.length !== 1) return;
      percent = WovenleafLibby.percentLabel(labels[0].textContent);
    }
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
