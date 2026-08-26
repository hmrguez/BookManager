# Pulp paper system

Pulp is Wovenleaf's visual foundation. It should feel like a lived-in reading room: calm enough
for long attention, tactile enough to feel personal, and clear enough that content and state are
never mistaken for decoration.

This document is the review record for QUI-8's surfaces, QUI-9's motion grammar, and QUI-14's
living gallery. The contracts are enforced by `tests/design-tokens.test.ts`,
`tests/motion.test.ts`, and `tests/gallery-contract.test.ts`; Settings and `/__gallery` are the
live appearance, dynamic-type, reduced-motion, and component-state specimens.

## Audit and files

| File | Responsibility |
| --- | --- |
| `fonts.css` | Bundled, offline Latin subsets for Literata Variable normal/italic and IBM Plex Sans Variable |
| `tokens.css` | Identity palette, paper stocks, semantic colors, type, spacing, edge, elevation, texture, focus, selection, state, and platform fallbacks |
| `appearance.ts` | Validated, persisted appearance preferences and root selector application |
| `components.tsx` | Reusable UI primitives registered in the development gallery |
| `GALLERY.md` | Component-story contract, deterministic baselines, and visual review gate |
| `motion.ts` | Semantic motion rules, reduced equivalents, gesture/interruption policy, and frame budget |
| `../tailwind/styles.ts` | Tailwind utility recipes for app, feature, and gallery surfaces |
| `../tailwind/motion.ts` | Tailwind utility recipes for composited semantic motion |
| `motion.css` | Keyframes and global OS/explicit reduced-motion enforcement |
| `index.ts` | Public TypeScript contract |
| `../../tests/design-tokens.test.ts` | Literal-color boundary, contrast measurements, required-token checks, and texture budget |
| `../../tests/appearance.test.ts` | Preference validation, persistence, and system-contrast behavior |
| `../../tests/gallery-contract.test.ts` | Gallery registration, state coverage, deterministic fixtures, and route gate |

The font audit keeps the intended pairing and removes network variability:

- Literata Variable is the reading voice: book titles, notes, expressive headings, and long copy.
  Normal and italic range from weight 200–900.
- IBM Plex Sans Variable is the interface voice: controls, labels, metadata, and short
  instructions. It ranges from weight 100–700.
- `font-display: swap` and Latin-only WOFF2 files keep first paint resilient and the Capacitor
  bundle offline. The current production build emits about 152 KB of compressed font files
  before transport compression.
- Georgia and Helvetica Neue remain deliberate fallbacks. `font-synthesis: none` prevents a
  platform from inventing unavailable faces.

## Using the contract

Import fonts and global tokens once:

```tsx
import './design-system/fonts.css'
import './index.css'
```

Feature and component utilities must use semantic roles, never palette values:

```tsx
<aside className="border-t-[var(--stroke-hairline)] border-[var(--border-subtle)] bg-[var(--surface-raised)] font-[var(--font-reading)] text-[var(--text-primary)] focus-within:outline-2 focus-within:outline-offset-3 focus-within:outline-[var(--focus-ring)]">
  {note}
</aside>
```

Raw `--brand-*` and `--stock-*` values are ingredients for `tokens.css`; they are not component
contracts. A test fails if product styles add a hex/RGB literal or consume those raw families.

## Semantic roles

| Family | Tokens | Intended use |
| --- | --- | --- |
| Paper | `--surface-page`, `--surface-raised`, `--surface-sunken`, `--surface-card` | Canvas, sheets/modals, recessed controls, and quiet grouped regions |
| Inversion | `--surface-inverse`, `--text-on-inverse`, `--surface-scrim` | Toasts/primary actions and modal separation |
| Ink | `--text-primary`, `--text-secondary`, `--text-tertiary` | Reading hierarchy; all three are valid small text on every paper surface |
| Intent | `--text-accent`, `--text-destructive` | Current/progress/high-value state and irreversible actions |
| Rules | `--border-subtle`, `--border-strong`, `--border-accent` | Decorative division, control definition/focus adjacency, selected boundaries |
| State | `--state-selected-*`, `--state-destructive-*` | Complete foreground/background/border sets; do not assemble state from opacity |
| Input | `--focus-ring`, `--focus-halo`, `--selection-background`, `--selection-text` | Keyboard focus and text selection on every paper mode |
| Edge | `--edge-cover`, `--edge-highlight`, `--edge-shadow`, `--cover-stock-*` | The physical suggestion of a book cover without a skeuomorphic frame |
| Depth | `--depth-resting`, `--depth-navigation`, `--depth-floating`, `--depth-modal` | Only for true layer changes; high contrast and print flatten them |
| Texture | `--surface-backdrop`, `--texture-fibers`, `--texture-opacity`, `--texture-blend` | One ambient canvas and one restrained fiber layer |

`--border-subtle` is deliberately a non-text decorative rule. Its absence must never remove a
label, selected state, control name, or grouping that is otherwise ambiguous. Use
`--border-strong` for a boundary that carries meaning.

## Paper and accessibility modes

Preferences are stored under `wovenleaf.appearance.v1` and applied to the document root.

| Selector | Character | Intended use |
| --- | --- | --- |
| `data-paper-mode="warm"` | Soft neutral paper and carbon ink | Default library and daytime reading |
| `data-paper-mode="cool"` | Cooler recycled stock and green-black ink | Bright environments or reduced color warmth |
| `data-paper-mode="print"` | Approved cream stock with forest ink | The most book-like, identity-forward mode |
| `data-paper-mode="night"` | Deep green-black paper with cream ink | Low-light reading without pure black/white glare |
| `data-contrast="high"` | Stronger ink/rules, flat depth, no fiber | Explicit high-contrast override |
| no `data-contrast` | Honor `prefers-contrast` | Default “System” setting |
| `data-type-scale="large"` | Root rem scale at 112.5% | Larger interface and reading type |
| `data-type-scale="x-large"` | Root rem scale at 125% | Largest supported in-app boost |
| `data-texture="off"` | Flat semantic paper | User override and low-paint fallback |

Browser and OS font-size preferences remain authoritative because typography uses `rem`.
In-app scale is a multiplier on that baseline, not a replacement for it. At 125%, controls may
grow vertically and labels may wrap; product layouts must not clip, hide, or shrink type to retain
the original density. Reading copy uses `--leading-reading` and `--measure-reading`; interface
copy uses `--leading-interface`.

Forced Colors maps the contract to system colors. Print produces black ink on white paper with
no texture or shadow. Reduced motion shortens every animation, transition, and scripted scroll to
1 ms/instant. Reduced transparency makes navigation/cards opaque and removes fiber.

## Measured contrast

`bun test` resolves the literal semantic colors for every paper mode and checks all intended
foreground/background pairs. Primary, secondary, tertiary, accent, and destructive ink are each
tested on page, raised, and sunken paper. Inverse, selection, selected, and destructive state
pairs are also tested at 4.5:1; focus and strong rules are tested at 3:1.

| Mode | Minimum standard text pair | Strong rule/page | Focus/page | High-contrast minimum text pair |
| --- | ---: | ---: | ---: | ---: |
| Warm | 4.70:1 | 4.93:1 | 5.23:1 | 5.95:1 |
| Cool | 4.72:1 | 4.95:1 | 6.16:1 | 7.06:1 |
| Print | 4.58:1 | 4.81:1 | 5.86:1 | 6.58:1 |
| Night | 5.23:1 | 6.47:1 | 6.03:1 | 9.99:1 |

The lowest standard pair is always tertiary or accent ink on sunken/raised paper and remains
above WCAG AA for normal text. Decorative subtle rules measure 1.81–2.24:1 by design; high
contrast raises them to 4.81–8.30:1. They are not used as the sole indication of interaction or
state.

## Texture and depth budget

Paper craft must not become scrolling or battery debt.

- One fixed `body::after` fiber layer, exactly two repeating CSS gradients, zero raster assets,
  zero requests, and no texture animation.
- Standard opacity is 0.09–0.16. Texture cannot be placed behind dense text as a separate local
  layer, multiplied per row, or used to communicate state.
- The ambient backdrop is two non-animated radial gradients plus the semantic page color.
- `data-texture="off"`, high contrast, `prefers-contrast: more`,
  `prefers-reduced-transparency`, Forced Colors, and print all remove fiber or flatten the surface.
- Depth has four roles. Resting content prefers a hairline; navigation receives a shallow edge;
  floating feedback gets `--depth-floating`; only a modal sheet gets `--depth-modal`.
- Book rows retain `content-visibility: auto` so the paper system does not force off-screen row
  paint.

## Paper motion grammar

Motion explains a change in place, hierarchy, or state. It never runs merely because the screen is
idle, and no paper texture, cover, icon, or empty state loops for decoration. The executable source
of truth is `motion.ts`; components combine `data-motion-event` with recipes from
`../tailwind/motion.ts` rather than inventing durations locally.

| Family | Purpose and trigger | Duration / easing / origin | Interruption and reduced equivalent |
| --- | --- | --- | --- |
| Navigate | Preserve place when primary navigation changes view or jumps to a shelf | 240 ms, enter, inline-end center | New navigation replaces the in-flight view. Reduced swaps immediately, updates `aria-current`, restores focus, and uses instant scrolling. |
| Reveal | Expose requested search, disclosure, or modal detail | 180 ms, enter, top center; sheet origin is bottom center | Content is interactive on frame one and dismissal commits immediately. Reduced keeps the same heading, boundary, state, and focus order with a 1 ms reveal. |
| Reorder | Keep a book identifiable when its sort position changes | 180 ms, move, center | A new order retargets current positions; it never queues. Reduced commits and announces the final position. |
| Move shelf | Connect a row with its new shelf after Move, Next, or Start | 180 ms, move, inline-start center | A second move retargets immediately. Reduced places the row at once and retains shelf text plus the undoable status message. |
| Progress | Connect percent/page input to proportional progress | 140 ms, linear, inline-start center | Repeated input retargets the bar from its rendered width. Reduced updates number, page count, and bar together without interpolation. |
| Complete | Confirm Finished once, without spectacle | 300 ms, enter, inline-start center | Rating and Done work immediately. Reduced shows the check, Finished heading, book identity, and rating controls at once. |
| Undo | Confirm that a reversible shelf move was rolled back | 140 ms, exit, bottom center | Undo commits synchronously and replaces the prior message. Reduced restores the shelf and says “Move undone” immediately. |
| Sync | Distinguish bounded active/success/failure states when remote sync exists | 140 ms state change, linear, center | Cancel/retry/result replaces active state. Reduced uses static icon plus explicit `Syncing`, `Synced`, or error text. The current local-only idle state does not animate. |

Enter uses `cubic-bezier(0.22, 1, 0.36, 1)`, exit uses
`cubic-bezier(0.4, 0, 1, 1)`, and spatial movement uses
`cubic-bezier(0.2, 0.8, 0.2, 1)`. Only opacity and transform are used for structural keyframes;
progress interpolates one bounded meter fill while its numeric value updates synchronously.

At most one structural event and one feedback event may animate together. A sheet's surface and
scrim count as the two parts of one reveal; list rows are not staggered as a group. A new event
replaces an in-flight event rather than joining a queue. Controls are never disabled to wait for a
transition. Sheets trap focus while open, Escape and scrim dismissal stay live during entry, and
dismissal restores the exact triggering control (or the active view heading if that control was
removed).

Future direct-manipulation gestures must remain 1:1 with the pointer. Page navigation settles from
release velocity; a sheet dismisses only beyond 35% travel or the agreed velocity threshold; a book
moves shelves only over a valid drop target. Motion must not be used to manufacture momentum after
the finger stops.

### Reduced-motion parity

Settings → Motion → Reduced applies `data-motion="reduced"` globally so QA does not need to change
the operating system. System mode honors `prefers-reduced-motion`. Both paths set distances to zero,
shorten animations/transitions to 1 ms, stop smooth JavaScript scrolling, and cap any semantic loop
at one iteration. They do not use `display: none`, hidden visibility, opacity-only state, or remove
live-region feedback. Selection, destination, percent, page count, shelf membership, completion,
undo, and future sync state all remain available as text or semantics.

### Frame budget and review

The device floor is the Capacitor WebView at 60 Hz under 4× CPU slowdown. The budget is 16.7 ms per
frame, with no animation frame over 25 ms in the representative Navigate, Reveal, Move shelf,
Progress, and Complete flows; review uses the 95th-percentile frame time. This is deliberately more
strict than judging the animation by eye.

Record a Performance trace with Rendering → FPS meter enabled, 4× CPU slowdown, and no network
throttle. Exercise each flow once after warm-up. The implementation keeps the structural paths to
opacity/transform, limits concurrency to two elements, uses no layout reads inside animation loops,
and retains `content-visibility: auto` for off-screen rows. `tests/motion.test.ts` guards those
constraints and the agreed device-floor budget; any trace that exceeds the thresholds blocks the
review even when the static contract passes.

## Quiet-retreat rubric

Score a screen before accepting it. Five means the quality is strongly present, except
“decoration,” where a lower score is safer.

| Dimension | Target | Observable test | Cozy/clutter boundary |
| --- | ---: | --- | --- |
| Breathing room | 4/5 | Major regions are separated by rhythm or one rule; reading copy has a clear measure | Empty space supports hierarchy; it does not create a landing-page hero around routine controls |
| Tactility | 2/5 | Paper hue, one fiber layer, cover edge, and restrained depth are perceptible on inspection | More than one local texture, ornamental shadow, or faux material per region is clutter |
| Personal traces | 3/5 | Real progress, ratings, notes, and dates remain visible and legible | Never add fake marginalia, stains, stamps, or handwriting to simulate history |
| Hierarchy | 5/5 | Literata carries reading meaning; Plex carries operation; state survives grayscale | Decoration may never compete with title, current shelf, progress, focus, or destructive intent |
| Density | 3/5 | A useful mobile shelf remains visible without rushed spacing or tiny type | Compact is acceptable; compressed tap targets or metadata below AA are not |
| Warmth | 3/5 | Cream/forest/clay feel human while neutral roles still dominate | A single accent per region; repeated sepia ornaments become themed nostalgia |
| Decoration | 1/5 | Every visible flourish has a content, state, edge, or atmospheric job | Reject decoration that survives after its meaning is removed |

Accept a side-by-side review only when breathing room is at least 4, hierarchy is 5, tactility
stays between 1 and 3, and decoration stays at or below 2.

| Reject: sterile dashboard | Keep: quiet retreat | Reject: decorative nostalgia |
| --- | --- | --- |
| Pure white/gray card grid, one sans face, identical container depth, generic status pills everywhere | Paper canvas, reading/interface type split, real personal traces, rules before cards, one accent, depth only for actual layers | Faux stains, torn edges, ornamental labels, script type, stacked textures, sepia filters that obscure cover/state |
| Warmth/tactility score 0; the product could be any productivity app | Content remains fastest to read and state survives texture-off/high-contrast modes | Decoration or tactility exceeds hierarchy; removing ornament improves comprehension |

## Do / don't

Do use the full semantic state pair:

```css
.choice[aria-pressed='true'] {
  border-color: var(--state-selected-border);
  background: var(--state-selected-surface);
  color: var(--state-selected-text);
}
```

Don't recreate it from brand values or opacity:

```css
/* Don't: theme-specific, unmeasured, and ambiguous in high contrast. */
.choice.is-active {
  border-color: #a64627;
  background: rgb(166 70 39 / 12%);
}
```

Do prefer a rule and spacing before elevation. Do reserve accent ink for current/progress/high
value state. Don't put texture on each card, add paper imagery, use tertiary ink below 4.5:1, or
make destructive actions look like neutral metadata.

## Platform evidence

These screenshots are produced from the same Vite/Capacitor UI at responsive platform
viewports. They are review baselines, not hand-edited comps.

| Web · warm Settings | iPhone 16 Pro · print library | Pixel 7 · night/high Settings |
| --- | --- | --- |
| ![Warm web settings](./evidence/web-warm-settings.png) | ![Print mobile library](./evidence/mobile-print-library.png) | ![Night high-contrast mobile settings](./evidence/mobile-night-high-settings.png) |

Re-capture evidence after a token or global surface change, then run:

```bash
cd apps/mobile
bun run lint
bun run test
bun run build
```

The review fails if product CSS gains a raw color, any intended text pair falls below 4.5:1,
focus/meaningful rules fall below 3:1, texture adds a third gradient or an asset request, or a
125%-type mobile pass clips content or actions.
