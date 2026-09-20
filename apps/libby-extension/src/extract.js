(() => {
  globalThis.readWovenleafShelf = () => {
    if (!WovenleafLibby.shelf(location.href) || document.visibilityState !== 'visible') return null;
    const found = new Map(), ambiguous = new Set();
    for (const tile of document.querySelectorAll('.title-tile.data-tile-class_loan')) {
      const visible = el => !!el && (typeof el.checkVisibility !== 'function' || el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none' && getComputedStyle(el).opacity !== '0';
      const link = tile.querySelector('a.title-tile-journey-percent');
      if (!visible(tile) || !visible(link)) continue;
      const titleId = /^\/shelf\/journey\/(\d{1,20})$/.exec(link.getAttribute('href') ?? '')?.[1];
      const format = tile.classList.contains('data-title-tile-format_audiobook') ? 'audiobook'
        : tile.classList.contains('data-title-tile-format_ebook') ? 'ebook' : null;
      const label = link.querySelector('[data-access="visual"]')?.textContent?.trim() ?? '';
      const match = /^(\d{1,3}(?:[.,]\d+)?)\s*%$/.exec(label);
      const percent = match ? Number(match[1].replace(',', '.')) : NaN;
      const title = tile.querySelector('.title-tile-title')?.textContent?.trim().slice(0, 500);
      const author = tile.querySelector('.title-tile-author')?.textContent?.trim().slice(0, 500) ?? '';
      if (!titleId || !format || !title || !Number.isFinite(percent) || percent > 100 || !tile.classList.contains(`data-title_${titleId}`)) continue;
      const key = `${format}:${titleId}`;
      if (found.has(key)) { ambiguous.add(key); continue; }
      found.set(key, { titleId, format, title, author, percent });
    }
    const observations = [...found.entries()].filter(([key]) => !ambiguous.has(key)).slice(0, 100).map(([, value]) => value);
    if (!observations.length) return null;
    return { kind: 'wovenleaf-libby', version: 1, id: crypto.randomUUID(), capturedAt: new Date().toISOString(), observations };
  };
})();
