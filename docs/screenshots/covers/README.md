# Demo covers

Six original covers for fictional books, made from geometric SVG artwork and
system typography. No downloaded images, commercial covers, or reference artwork.

The cover artwork and fictional catalog in this directory are dedicated to the
public domain under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
You may reuse or modify them without attribution. The app and screenshots retain
their existing licenses.

Regenerate from the repository root:

```sh
node scripts/generate-demo-covers.mjs
```

To retake the library, grid, and book-details screenshots, install the mobile
app's dependencies, start `bun run dev -- --host 127.0.0.1 --port 4173` from
`apps/mobile`, then run this from the repository root:

```sh
node scripts/capture-readme.mjs
```

The capture script uses an isolated Playwright browser with fictional data and
never opens an existing browser profile or personal library. Refresh the asset
hashes in `ASSET_LICENSES.json` after regenerating tracked assets.

For the quarterly-review and reading-stats screenshots, run the mobile development
server on port 4183 and use `node scripts/capture-reading-story.mjs` from the
repository root. This capture fixes the clock to 17 October 2026 and records only
fictional reading/listening activity in a fresh, isolated browser.
