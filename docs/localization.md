# Localization

Wovenleaf supports English (US), Spanish (Spain), German (Germany), Italian
(Italy), and French (France) across the reader app, app-owned native reader and
playback controls, purchases, imports, exports, reviews, and the marketing site.
The US-focused Libby browser extension remains outside this scope.

## App behavior

Settings → Appearance → Language offers System and five manual choices. System
uses the first supported device language, with English as the fallback. A manual
choice is stored on the device under `wovenleaf.language.v1`. Changes immediately
update the interface and regional number/date formatting. Catalogs are bundled
with the app, so language selection works offline.

`apps/mobile/src/localization/index.ts` owns language selection, the typed
translation API, historic app-copy presentation, formatting, and the native
bridge. `useLanguage()` subscribes components to changes; `t()` translates a
catalog key; `translateAt()` renders a particular language. `translateCopy()` is
reserved for recognized app-authored copy, including historic review prose.
Never apply it to publication content or personal text.

Native Swift and Kotlin use the same generated JSON catalogs. The
`WovenleafLocalization` Capacitor plugin persists the selected interface language;
iOS shares that preference with the file share extension. Reader-opening code
awaits the native language update. Platform-owned dialogs and menus follow the
operating system's language rules. Publication language and text-to-speech voice
selection remain separate from the interface language.

`bun run localization:generate` copies the source catalogs into `public/locales`.
The app's dev and build commands run this automatically. Capacitor sync then
bundles those resources for both native platforms. Generated resources are
ignored; edit the source catalogs instead.

## Data and export boundaries

Book titles, authors, original files, passages, annotations, personal notes,
custom shelf/tag names, identifiers, reading facts, search language settings, and
backup schemas retain their original values. CSV and JSON exports stay stable
across interface languages. Readable Markdown headings and dates follow the
chosen interface language.

Review keepsakes are presented in the selected language without modifying stored
facts. New review images use the app language or the explicit English export
option. Previously saved images are untouched. Known app errors are translated;
unrecognized system/provider errors show a translated recovery message with the
original diagnostic available through Details.

## Website behavior

English URLs remain `/`, `/privacy/`, `/terms/`, and `/screenshots/library/`.
Spanish, German, Italian, and French add `/es`, `/de`, `/it`, and `/fr` to the
same paths. Every page has a language selector that preserves the current page,
a canonical URL, and all five regional alternate-language links plus `x-default`.
A first-visit browser-language suggestion offers a link without redirecting.
Selection or dismissal is remembered independently of the app preference.

Privacy and terms translations preserve the original effective date and
substance. Each translated legal page links to the authoritative English text.
The website catalogs are independent of the app build so the site can deploy
from its own package.

Each locale has three screenshots under
`apps/landing/public/screenshots/{en,es,de,it,fr}`. Library and audiobook images
come from the real React app with representative fixture books. Reader images
come from the native Readium reader on an iOS simulator. Book content remains in
its original language in all captures.

## Translation maintenance

Catalogs live in each package's `src/localization/catalogs`. English is the source
of truth. Update all five catalogs when adding interface copy, preserve named
placeholders, and use singular/plural keys with an explicit count. Website legal
HTML must preserve its tag structure; runtime operator values are escaped.
Display text must never become a stored ID, CSS class, query field, or enum value.

The initial non-English drafts were generated with Google Translate with the
owner's explicit permission to send interface and legal copy, then reviewed and
refined for terminology, placeholders, plurals, and markup. They are draft
translations and remain suitable for further editorial review.

## Verification and screenshot reproduction

Run from `apps/mobile`:

```sh
bun run lint
bun run typecheck
bun run test
bun run build
bunx playwright test visual-tests/localization.spec.ts
```

The browser suite exercises all five manual language choices, immediate changes,
persistence after reload, localized book commands, canonical shelf actions,
responsive layout, and the real audiobook player. It regenerates library and
audiobook marketing screenshots. Unit tests check both packages' catalog parity,
placeholders, legal markup, language resolution, plurals, original personal text,
stable CSV, and localized Markdown/reviews.

Run from `apps/landing`:

```sh
bun run lint
bun run typecheck
bun run build
bun run preview -- --port 4321
```

With the site preview running, run from `apps/mobile`:

```sh
bun run localization:verify-website
```

Set `MARKETING_URL` to use a different preview address. The check visits all 20
production pages at mobile and desktop widths, verifies images and metadata,
page-preserving language links, authoritative English legal links, and the
non-redirecting browser-language suggestion.

For native screenshots, follow the existing simulator fixture workflow in
`docs/verification/responsive/README.md`. The fixture scenario also accepts
`{"language":"es"}` (or any supported language). Bundle the fixture into a
copy of the app; keep the production entry point unchanged.

Native compilation was checked with Android `:app:compileDebugKotlin --offline`
and the iOS `App` scheme for the arm64 simulator. Native reader screenshots were
captured in all five languages. Physical-device OS dialogs and every individual
purchase/provider error were not separately exercised.
