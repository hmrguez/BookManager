# Pulp component gallery

The Pulp gallery is the development proofing table for Wovenleaf UI. Run `bun run gallery` and
open `/__gallery`. It is loaded through an `import.meta.env.DEV` route gate; production builds
send the same path to the normal app and do not expose gallery controls.

## Component completion contract

Reusable components live in `components.tsx`. Every exported component name must have a matching
entry in `../gallery/catalog.ts`, and that entry must include a default story. The
`gallery-contract.test.ts` check makes an unregistered export fail the normal unit-test suite.
Add the story and the states changed by the component before calling a feature complete.

The shared state matrix is: default, hover, focus, pressed, disabled, loading, empty, error, long
content, dark, high contrast, reduced motion, and large text. The gallery toolbar writes each
environment choice into the URL, so a review can link directly to the exact proofing state.

## Stable screenshot gate

Three high-value baselines stay deliberately small:

1. Warm primitives with every interaction pose held in the DOM.
2. Night/high-contrast composites at a narrow mobile viewport.
3. Print feedback states at 125% type with reduced motion.

Fixtures have fixed text and dates, generated covers, bundled fonts, texture disabled, reduced
motion, UTC, and no remote requests. Playwright captures the gallery canvas rather than browser
chrome. Run:

```bash
bun run gallery:test
bun run gallery:update # only after approving an intentional visual change
```

Never update a screenshot just to make the test green. Inspect the changed pixels, name the
intent in the commit, and complete the review below first.

## Visual review checklist

- Visual: compare all affected baselines at full size and explain each intentional diff.
- Keyboard: tab through the changed story; order, activation, and the focus ring remain clear.
- Semantics: inspect names, roles, live regions, errors, progress values, and disabled states.
- Contrast: review standard, night, and explicit high contrast; subtle rules never carry meaning.
- Text: review 125% type and long fixtures without clipping, hiding, or shrinking labels.
- Motion: review the reduced-motion replacement; information survives without animation.
- Performance: confirm no remote requests, raster texture, unbounded animation, or layout shift.
- Quality: run `bun run lint`, `bun run test`, `bun run build`, and `bun run gallery:test`.
