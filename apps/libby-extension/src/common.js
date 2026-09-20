/* Shared isolated-world boundary. No Libby storage, credentials or reader content. */
(() => {
  const api = globalThis.browser ?? globalThis.chrome;
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
          Object.keys(o).some(k => !['titleId', 'format', 'title', 'author', 'percent'].includes(k))) return false;
      const key = `${o.format}:${o.titleId}`;
      if (keys.has(key)) return false;
      keys.add(key); return true;
    });
  };
  globalThis.WovenleafLibby = Object.freeze({ api, valid,
    shelf: url => { try { const u = new URL(url); return u.origin === 'https://libbyapp.com' && /^\/shelf(?:\/loans)?\/?$/.test(u.pathname); } catch { return false; } },
  });
})();
