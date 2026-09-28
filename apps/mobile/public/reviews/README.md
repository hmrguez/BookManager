# Quarterly review artwork

`concepts/` retains byte-for-byte copies of the accepted cropped originals. No
artwork was regenerated for the static design revision.

`ink-v1/` contains transparent black-ink PNGs derived at the original dimensions
by `python3 apps/mobile/scripts/prepare-review-ink.py` (Python + Pillow). The alpha
channel is `round(max(0, 240 - luminance) * 255 / 240)`: near-white paper texture
becomes transparent while shading/antialiasing remain continuous. Composition,
line placement and the small medallions are preserved. Source files remain intact.

The UI uses these PNGs as CSS alpha masks filled with the theme's text/ink colour.
Images remain decodable with intrinsic dimensions and error handling; missing or
corrupt artwork preserves identity text and navigation. Known concept-v1 keepsakes
resolve to their corresponding ink asset without changing their stored manifest or
facts; new keepsakes record `original-ink-v1`. Unknown versions retain their own
still. No pathway animation is played or requested.

`fantasy-preview-v1/` remains solely for old version references and historical
compatibility. It is no longer used by the UI. Final visual acceptance was recorded on 28 September 2026 in
`docs/verification/quarterly-review-artwork/README.md`.


## Reproduction and review

Run `python3 apps/mobile/scripts/prepare-review-ink.py --check` from the repository
root to verify all eight compositions and eight separate medallions. Omit
`--check` to reproduce them. The script verifies exact source crop pixels,
unchanged source copies, RGBA decode, continuous alpha and the versioned manifest.
`ink-v1/manifest.json` records original/crop/output SHA-256 hashes, coordinates,
dimensions, decoded-pixel hashes and byte counts. Encoders may change compressed
bytes; review a manifest change rather than treating it as a new drawing.

The original achievement engravings live in `src/reviews/achievement-art.ts` and
`AchievementSeal.tsx`, version `engraved-seals-v1`. They are bundled vectors,
with no network or font dependency. Each of the 30 catalogue entries has its own
symbol; shared rings, hatching, leaves and crown add tier ornament. The separate
small star medallion is used only for a supported personal best. New keepsakes
record this version. Existing temporary seal manifests retain their stored facts
and render the new symbol set; no saved metric, tier or identity is rewritten.
Unknown badge IDs retain a neutral page symbol and their adjacent factual text.
Once approved, retain this version when introducing future art versions.

`bun apps/mobile/scripts/prepare-review-artwork-gallery.tsx` recreates the visual
review sheet at `docs/verification/quarterly-review-artwork/index.html` using the
production seal component and original-derived masks. It shows all four papers,
every supported tier, personal-best treatments and the 128/52 px display sizes.
The reader approved all eight pathways and the achievement-art set on 28 September
2026 after reviewing the sheet. The adjacent verification README records acceptance;
integrated release verification remains separate.
