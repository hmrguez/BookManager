/* Shared isolated-world boundary. No Libby storage, credentials or reader content. */
(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  // Public cover assets only: no provider proxy, arbitrary host, query or credential.
  const coverPattern = /^https:\/\/(?:img[1-9][0-9]*\.od-cdn\.com|images\.contentreserve\.com)\/ImageType-[0-9]+\/[a-z0-9%_./~{}-]+\.(?:jpe?g|png|webp)$/i;
  const validCover = value => typeof value === 'string' && value.length <= 2048 && coverPattern.test(value);
  const coverURL = source => {
    try {
      let url = new URL(source, 'https://libbyapp.com');
      // Libby's rendered img may use its resize proxy. Retain only its public source.
      if ((url.origin === 'https://libbyapp.com' && url.pathname === '/covers/resize') ||
          (url.origin === 'https://ic.od-cdn.com' && url.pathname === '/resize')) {
        const source = url.searchParams.get('url'); if (!source) return;
        // Libby strips the CDN origin from ImageType paths before resizing.
        url = new URL(source, 'https://img1.od-cdn.com');
      }
      if (url.protocol === 'http:') url.protocol = 'https:';
      return validCover(url.href) ? url.href : undefined;
    } catch { return; }
  };
  const valid = (value) => {
    if (!value || new TextEncoder().encode(JSON.stringify(value)).byteLength > 131072 || value.kind !== 'wovenleaf-libby' || value.version !== 1 ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.id ?? '') ||
        !Number.isFinite(Date.parse(value.capturedAt)) || Date.parse(value.capturedAt) > Date.now() + 300000 ||
        !Array.isArray(value.observations) || !value.observations.length || value.observations.length > 100 ||
        Object.keys(value).some(k => !['kind', 'version', 'id', 'capturedAt', 'observations'].includes(k))) return false;
    const keys = new Set();
    return value.observations.every(o => {
      if (!o || typeof o.titleId !== 'string' || !/^\d{1,20}$/.test(o.titleId) || !['ebook', 'audiobook'].includes(o.format) ||
          typeof o.title !== 'string' || !o.title.trim() || o.title.length > 500 || typeof o.author !== 'string' || o.author.length > 500 ||
          typeof o.percent !== 'number' || !Number.isFinite(o.percent) || o.percent < 0 || o.percent > 100 ||
          (o.coverUrl !== undefined && !validCover(o.coverUrl)) ||
          Object.keys(o).some(k => !['titleId', 'format', 'title', 'author', 'percent', 'coverUrl'].includes(k))) return false;
      const key = `${o.format}:${o.titleId}`;
      if (keys.has(key)) return false;
      keys.add(key); return true;
    });
  };
  const visible = el => !!el && (typeof el.checkVisibility !== 'function' || el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none' && getComputedStyle(el).opacity !== '0';
  const percentLabel = text => {
    const match = /^(\d{1,3}(?:[.,]\d+)?)\s*%$/.exec(text?.trim() ?? '');
    const value = match ? Number(match[1].replace(',', '.')) : NaN;
    return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
  };
  const playerFormat = value => {
    try {
      const u = new URL(value);
      if (u.protocol !== 'https:' || u.port || u.username || u.password) return null;
      const kind = /^[a-z0-9-]+\.(listen|read)\.(?:overdrive|libbyapp)\.com$/.exec(u.hostname)?.[1];
      return kind === 'listen' ? 'audiobook' : kind === 'read' ? 'ebook' : null;
    } catch { return null; }
  };
  globalThis.WovenleafLibby = Object.freeze({ api, valid, coverURL, visible, percentLabel, playerFormat,
    shelf: url => { try { const u = new URL(url); return u.origin === 'https://libbyapp.com' && /^\/shelf(?:\/loans)?\/?$/.test(u.pathname); } catch { return false; } },
  });
})();
