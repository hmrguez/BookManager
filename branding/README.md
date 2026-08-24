# Wovenleaf identity

The production mark is the vectorized artwork supplied for QUI-6. The discarded generated concept remains local-only and is not an export source.

## Canonical sources

- [`source/wovenleaf-mark-color.svg`](./source/wovenleaf-mark-color.svg) - canonical editable vector mark
- [`source/wovenleaf-identity-vector-master.pdf`](./source/wovenleaf-identity-vector-master.pdf) - canonical vector PDF
- [`source/wovenleaf-mark-color-2048px.png`](./source/wovenleaf-mark-color-2048px.png) - canonical high-resolution raster

These three files are versioned because both the identity and platform-asset generators need to work from a fresh clone.

## Generated package

- [`final/wovenleaf-brand-mini-guide.md`](./final/wovenleaf-brand-mini-guide.md) - reviewable source guide
- [`final/wovenleaf-brand-mini-guide.pdf`](./final/wovenleaf-brand-mini-guide.pdf) - presentation guide
- [`final/qa/qa-report.md`](./final/qa/qa-report.md) - size, silhouette, contrast, and source-integrity evidence

The package also contains small-size, monochrome, reversed, horizontal, tagline, and descriptor SVG variants plus deterministic PNG exports.

## Rebuild

From the repository root:

```bash
uv run --no-project --with-requirements branding/requirements.txt branding/build_brand_assets.py
```

The three canonical source files are inputs and are never rewritten. Generated review intermediates live in `branding/.work/`; final reviewable deliverables are written to `branding/final/`. Both directories are intentionally ignored by Git.

## Status

Identity version 1.0 uses **Wovenleaf** as the working production name. QUI-6 remains dependent on the name-validation decision in QUI-7. A name change affects the three text lockups; it does not require redrawing the mark.
