# Optional store assets

Historical device screenshots and release-console captures were removed from the
public source because their private-data and third-party-content provenance was
not sufficient for redistribution. The original app identity and reproducible
native icons remain in the project.

If distributing through a store, capture your own running build using fictional
books and original cover fixtures in `apps/mobile/tests/fixtures/`. The public
landing illustrations are labelled illustrations and must not be presented as
actual device screenshots. See `docs/guides/community-builds.md` for build paths.

## README screenshots

The reader and reading-appearance captures in `docs/screenshots/` were recovered
from the owner's preliminary App Store Connect listing on 2026-10-17. Their
original demo passage is in `apps/mobile/scripts/preview-responsive-reader.ts`;
these captures include no third-party book covers or text. Provenance and hashes
are recorded in `ASSET_LICENSES.json`.

The README's library, grid, and details screenshots use original CC0 artwork in
`docs/screenshots/covers/`; `scripts/capture-readme.mjs` reproduces them. Libby
screenshots use isolated browser demo data; the audiobook screen uses the
development marketing preview. The draft
store library screenshot was not added because it contains provider cover art.
