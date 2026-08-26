# ADR 0012: EPUB engine and customizable reader boundary

- **Status:** Accepted, with implementation validation gates
- **Date:** 2026-08-27
- **Issue:** QUI-33
- **Decision horizon:** Minimum lovable reader on iOS and Android
- **Reference versions:** Readium Swift 3.11.0 and Readium Kotlin 3.3.0

## Context

Wovenleaf needs the difficult parts of EPUB reading to come from a maintained engine, while the
reader itself must still feel wholly like Wovenleaf. The engine must not dictate the table of
contents, selection menu, highlight appearance, settings, navigation chrome, or paper-inspired
interaction design.

The downstream reader work makes this more than a rendering choice:

- QUI-34 needs safe, offline opening of app-managed DRM-free EPUB 2 and EPUB 3 packages.
- QUI-35 needs a semantic position that survives reflow, font changes, rotation, restart, and
  stale progress events.
- QUI-36 needs live typography, theme, margin, column, pagination, and scroll preferences.
- QUI-37 needs a hierarchical TOC, search, links, bookmarks, navigation history, and image detail.
- QUI-38 needs selectable ranges and durable, portable annotations with custom presentation.
- QUI-39 needs explicit accessibility, RTL, CJK, vertical-text, and fixed-layout behavior.
- QUI-41 can add page-turn delight only after navigation and locator correctness are stable.

Wovenleaf is currently a React 19 application in a Capacitor 8 shell. A web renderer would keep
the reader UI in the existing React codebase. Native toolkits add a platform boundary and require
two thin reader hosts, but they can open packaged local publications directly and have a more
mature mobile EPUB surface.

This ADR is a source-based decision. QUI-33 does not add production reader code and does not claim
that device performance, binary-size impact, or assistive-technology behavior has already been
measured. Those claims are explicit gates below.

## Decision

Use the stable **Readium Mobile** toolkits as the first EPUB engine:

- pin `readium/swift-toolkit` to **3.11.0** on iOS;
- pin `org.readium.kotlin-toolkit` modules to **3.3.0** on Android;
- include only Shared, Streamer, and Navigator capabilities needed by DRM-free EPUB;
- do not include Readium LCP or any DRM circumvention path;
- do not adopt the Swift 4.0 alpha until it is stable and its migration cost and Android parity
  have been reviewed.

The native Readium Navigator is a rendering surface, not the product UI. Wovenleaf will launch a
full-screen native reader host from Capacitor and build all reader chrome itself. Readium explicitly
describes its navigators as having no user interface beyond the publication view, leaving the app
responsible for bookmarks, progress, and other controls. This is the boundary Wovenleaf wants.

### Responsibility boundary

| Owner | Responsibilities |
| --- | --- |
| Readium Streamer and Navigator | Parse supported packages, expose publication metadata and navigation, render reflowable and fixed-layout resources, paginate or scroll reflowable content, resolve links and locators, expose selection and search, apply decorations, and report current location |
| Wovenleaf native reader host | Reader composition, safe areas, gestures, keyboard commands, focus, selection actions, custom TOC, settings, highlight and note UI, image/footnote presentation, reduced motion, recovery states, and mapping Pulp tokens to native controls and Readium preferences |
| Wovenleaf TypeScript domain and SQLite repositories | Edition and Asset identity, managed-file policy, preferences, reading-event ledger, annotations, bookmarks, export, conflict rules, backup, and renderer-independent records |
| Capacitor reader adapter | Open and close the native reader by Asset capability, exchange versioned commands and events, and recover a durable native outbox after interruption |

Wovenleaf must not fork Readium merely to restyle product chrome. Engine patches are reserved for
conformance, security, accessibility, or locator defects and must remain small enough to upstream.

### Custom reader interaction model

Readium supplies structure and destinations; Wovenleaf decides how they are presented.

The TOC should be a quiet edge rail rather than a conventional permanent drawer. On a wide or
pointer-capable surface, a vertical series of restrained markers indicates the book hierarchy and
current section. Hovering or focusing the rail reveals the actual nested TOC in an anchored panel,
with the active path and reading position visible. On touch, the same affordance opens an accessible
side sheet or bottom sheet; no action depends on hover. The TOC is a labelled navigation tree with
predictable keyboard movement, and every item navigates through a Readium `Link` or `Locator`.
It remains outside publication content so publisher CSS cannot restyle it.

Highlights are Wovenleaf annotation records rendered through a named Readium decoration group.
Their stored appearance is a semantic style key, not a hard-coded engine color. Platform adapters
map the key to custom Readium decoration templates, allowing translucent ink, underline, emphasis,
search, and read-aloud treatments to evolve without rewriting annotation locations. Selection
opens Wovenleaf's own action surface for highlight, note, copy, define, and accessibility actions.

Typography controls are also Wovenleaf UI. They map global and per-book preferences to the
toolkits' EPUB preferences for font family and size, weight, line height, spacing, margins,
alignment, hyphenation, ligatures, columns, theme, publisher-style policy, and scroll mode. An
unsupported or inactive engine preference is explained or hidden rather than shown as a control
that appears to do nothing.

### Locator and annotation contract

Readium's `Locator` model is the adapter interchange format, not the database model itself. The
canonical record stores:

- resource `href` and media `type`, normalized within the publication;
- optional title, fragments, resource progression, total progression, and position;
- text-before, highlighted text, and text-after context when available;
- the toolkit-provided range selector, such as a partial CFI or DOM range, as an opaque fragment;
- Asset fingerprint, Edition and Asset IDs, toolkit/version provenance, and timestamps.

Page number, viewport coordinates, DOM node references, and platform view identifiers are never
durable locations. The original toolkit locator is retained without treating its fragment syntax
as globally interchangeable. Resume and re-anchoring first try the precise fragment on the same
fingerprinted Asset, then quote context, then resource progression; ambiguous recovery enters
review instead of moving an annotation silently. ADR 0003 continues to own event ordering and
normalized progress.

The same serialized locator fixtures must round-trip through both platform adapters. A difference
between the Swift and Kotlin fragment extensions is acceptable only when the shared envelope and
text context still produce the same semantic passage.

### Capacitor boundary

The bridge is deliberately coarse-grained. React asks the platform to open an Asset by a validated
capability or repository ID; it does not pass an unrestricted file path or drive individual page
turns. The native reader handles high-frequency navigation, selection, and animation locally.

Durable changes cross the boundary as versioned events: location checkpoint, session boundary,
bookmark mutation, annotation mutation, preference mutation, and close result. The native adapter
writes them to a small durable outbox before notifying React. The TypeScript repository ingests the
outbox idempotently into the reading ledger and annotation tables and acknowledges it. This keeps a
background kill or bridge reload from losing the last position. The reader never reaches through
Readium's internal WebView DOM from React.

## Option scorecard

Scores are 1 (poor) to 5 (strong). The weighted result expresses current implementation readiness
for Wovenleaf, not general library quality. It is based on published capabilities and architecture,
not a substitute for the device validation gate.

| Criterion | Weight | Readium Mobile Swift/Kotlin | Readium Web + Thorium in Capacitor | Foliate-js in Capacitor |
| --- | ---: | ---: | ---: | ---: |
| Offline packaged EPUB and security boundary | 5 | 5 | 1 | 4 |
| EPUB 2/3, reflow, fixed layout, scroll, RTL | 5 | 5 | 4 | 3 |
| Stable position and range locator model | 5 | 5 | 5 | 3 |
| Search, selection, and custom decorations | 4 | 5 | 5 | 4 |
| Accessibility and international-reading evidence | 5 | 4 | 4 | 2 |
| Freedom to own the reader UI | 5 | 5 | 5 | 5 |
| Capacitor integration and shared UI code | 4 | 2 | 3 | 5 |
| Maintenance, release process, and license | 4 | 5 | 4 | 1 |
| Expected mobile performance and contained crash surface | 3 | 4 | 3 | 3 |
| Migration and escape path | 3 | 5 | 5 | 3 |
| **Weighted total** | **215** | **195 (91%)** | **167 (78%)** | **143 (67%)** |

### Why Readium Mobile wins

The stable mobile toolkits already report reflowable and fixed-layout EPUB, pagination, reflowable
scrolling, RTL, text search, decorations, selection-oriented navigator APIs, and a broad preferences
surface. They parse packaged local files without introducing a publication server. Their shared
Readium publication and locator concepts also provide the cleanest escape path to another Readium
navigator later.

The cost is real: Wovenleaf must maintain an iOS reader host, an Android reader host, and a narrow
Capacitor adapter. Reader UI behavior and semantic design tokens therefore need shared contract
fixtures even though their final controls are native. This duplication is accepted because the
engine handles publication complexity and because the reader is a focused surface rather than a
second implementation of the entire app.

Known limits are product limits, not hidden promises. Readium Mobile currently lists media overlays
as planned and fixed-layout scrolling as not implemented. QUI-39 must label supported, limited, and
unsupported content before release.

### Why Readium Web and Thorium Web are not selected now

Readium's TypeScript navigator is active and increasingly compelling. Its current Decorator API
supports locator-addressed custom highlights and hover, and Thorium Web exposes React components,
plugins, preferences, and an injectable position store. It is the leading reconsideration candidate.

However, Readium Web is architected around a Readium Web Publication Manifest plus separately
fetchable publication resources. Thorium's implementer guide requires a publication server, and
the maintainers have documented that arbitrary local publication loading does not yet have a
straightforward production path. Using it for Wovenleaf today would require an on-device
publication server or a custom native Streamer-to-web resource bridge. That hybrid would add local
HTTP/origin/CORS/CSP behavior and two interdependent engine layers before the first page is shown.
It conflicts with the offline Asset boundary and the issue's rule against an unrecorded hybrid.

Thorium's ready-made shell is also not the decision: Wovenleaf can learn from its accessible React
components, but adopting the shell would pull in a larger opinionated reader surface when the
product goal is to own the interaction design.

### Why Foliate-js and epub.js are not selected

Foliate-js most directly matches the desire for a small, UI-agnostic web component. It opens a
`File` or `Blob`, exposes TOC and CFI structures, supports custom overlay drawing, and expects the
implementer to replace its demo UI. It is useful as a design and fallback reference.

Its own documentation also says the library is unstable, has no release, can break its API at any
time, requires explicit CSP protection for EPUB content, and currently lacks continuous scrolling.
There is insufficient published mobile VoiceOver/TalkBack evidence for QUI-39, and an open 2026
issue shows failures being swallowed on older Android WebViews. Vendoring it would make Wovenleaf
the stabilization owner for the engine itself.

epub.js remains a useful reference implementation, but it is not chosen over the actively released
Readium toolkits. Its browser-oriented hooks and CFI annotation API do not offset the same iframe,
mobile accessibility, and long-term engine-ownership risks for this project.

### Rejected hybrid

Do not combine a native Readium Streamer with the TypeScript Readium Navigator for the first reader.
Although that could preserve React chrome, it would require a bespoke publication/resource server
and locator bridge on both mobile platforms. Reconsider only after Readium publishes a supported
local packaged-publication path for Web, or after a separate spike demonstrates materially lower
total complexity than the native hosts.

## Size and crash-surface record

The following numbers describe downloadable dependency inputs, not final store download deltas:

| Candidate | Observed dependency input on 2026-08-27 | What remains unknown |
| --- | --- | --- |
| Readium Kotlin 3.3.0 | Maven Central AARs: Shared 1,537,837 bytes; Streamer 302,521 bytes; Navigator 1,135,307 bytes; 2,975,665 bytes total before transitive dependencies, R8, resources, ABI splitting, and store compression | Incremental universal APK/AAB and per-device Play download |
| Readium Swift 3.11.0 | Source-distributed Swift packages with independently selectable modules; no comparable prebuilt application artifact | Incremental archived and App Store-thinned IPA size after dead stripping |
| Readium TS + Thorium | Current npm unpacked sizes: Navigator 1,032,926 bytes; Shared 959,679 bytes; HTML injectables 498,125 bytes; Thorium Web 6,578,986 bytes, before peer dependencies and Vite tree shaking | Incremental compressed JS bundle plus any local publication server |
| Foliate-js | No stable package or release artifact | Vendored module graph, zip implementation, polyfills, and final bundle |

The dependency sizes are not directly comparable and did not decide the outcome. The validation
spike must build the same baseline and reader-enabled release commit, then record compressed archive
delta, installed delta, and the store's per-device estimate.

Readium Mobile's crash surface is the native parser, navigator, platform WebView, and coarse
Capacitor adapter. A Readium Web solution for local EPUB would add the main Capacitor WebView,
nested publication frames, a package/manifest service, a local resource transport, and origin
policy. Foliate-js avoids the native bridge but makes Wovenleaf responsible for zip loading, CSP,
polyfills, hidden renderer failures, and upstream API churn. In every option, a renderer failure
must close into a recoverable Asset error without deleting annotations or reading history.

## Required implementation validation

Before QUI-35 can turn this decision into a product reader, one time-boxed adapter spike must run
the identical, license-compatible corpus on physical iOS and Android devices. It must include:

- EPUB 2 and EPUB 3 reflowable books, long chapters, internal links, footnotes, SVG, MathML, tables,
  publisher fonts, and broken or missing navigation;
- fixed layout, RTL and bidi, CJK horizontal and vertical text, ruby, and mixed-language content;
- accessible headings, landmarks, alt text, page navigation, large text, keyboard/switch input,
  VoiceOver, and TalkBack;
- malformed packages, encrypted/protected packages, external resources, and scripted-content
  discovery without executing untrusted publication code;
- position and range fixtures that survive font, margin, theme, scroll/page, orientation, restart,
  background kill, and cross-platform serialization;
- search-to-result navigation, selection-to-annotation, custom decoration hit testing, TOC
  navigation, and annotation re-anchoring;
- a representative large book and long session for peak memory, cold open, page-turn latency,
  battery/thermal behavior, crashes, and Android ANRs;
- baseline-versus-reader release measurements for build and installed size.

Start with the W3C EPUB 3.3 test suite and EPUB accessibility test material, then add small
Wovenleaf-authored fixtures for lifecycle, locators, and hostile-container handling. Fixture
provenance and licenses must permit repository and automated-test use.

Any high-severity accessibility failure, repeatable semantic-location loss, inability to contain
publication scripts/resources, or materially divergent iOS/Android locator behavior reopens this
ADR before product UI work proceeds.

## Reconsideration triggers

Re-evaluate the engine when any of the following becomes true:

1. Readium Web ships and documents a production local `File`/`Blob` or embedded publication-server
   path for packaged offline EPUB, with mobile WebView accessibility and conformance evidence.
2. Maintaining native reader-shell parity repeatedly costs more than the engine work it saves, and
   a web candidate passes the same corpus and lifecycle tests.
3. Foliate-js publishes a stable versioned package, supports continuous scroll, demonstrates
   mobile assistive-technology behavior, and passes the shared locator corpus.
4. Readium Mobile stops maintaining either platform, changes to an incompatible license, or fails
   a must-have EPUB 3, security, accessibility, or locator requirement without a viable upstream fix.
5. A first-class browser reader becomes a product requirement rather than a development convenience.

## Consequences

- Wovenleaf gets a mature EPUB core while retaining complete control over visible reader design.
- The custom TOC, highlights, typography controls, and navigation surfaces are product code, not an
  engine fork or a skinned sample reader.
- iOS and Android reader hosts require explicit parity tests and shared semantic design contracts.
- Browser reading is deferred; web can continue to manage library records without claiming reader
  parity.
- Toolkit upgrades are deliberate: exact pins, migration-guide review, corpus rerun, and binary and
  performance comparison before each upgrade.
- Unsupported DRM is detected and explained. Wovenleaf neither bundles Readium LCP nor suggests
  bypassing protection.
- Renderer replacement remains feasible because durable Assets, events, preferences, bookmarks,
  and annotations stay in Wovenleaf schemas and locators retain text context and provenance.

## References

- [W3C EPUB 3.3](https://www.w3.org/TR/epub-33/)
- [W3C EPUB Reading Systems 3.3](https://www.w3.org/TR/epub-rs-33/)
- [W3C EPUB Accessibility 1.1](https://www.w3.org/TR/epub-a11y-11/)
- [W3C EPUB 3.3 test suite](https://w3c.github.io/epub-tests/index.html)
- [Readium architecture: Locators](https://readium.org/architecture/models/locators/)
- [Readium Swift Toolkit](https://github.com/readium/swift-toolkit)
- [Readium Swift getting started](https://readium.org/swift-toolkit/latest/documentation/readium/getting-started/)
- [Readium Swift releases](https://github.com/readium/swift-toolkit/releases)
- [Readium Kotlin Toolkit](https://github.com/readium/kotlin-toolkit)
- [Readium Kotlin Navigator guide](https://github.com/readium/kotlin-toolkit/blob/develop/docs/guides/navigator/navigator.md)
- [Readium Kotlin preferences guide](https://github.com/readium/kotlin-toolkit/blob/develop/docs/guides/navigator/preferences.md)
- [Readium Kotlin releases](https://github.com/readium/kotlin-toolkit/releases)
- [Readium Kotlin Navigator on Maven Central](https://central.sonatype.com/artifact/org.readium.kotlin-toolkit/readium-navigator/3.3.0)
- [Readium Web](https://readium.org/web/)
- [Readium TypeScript Toolkit](https://github.com/readium/ts-toolkit)
- [Readium TypeScript Decorator and Timeline release note](https://blog.readium.org/release-note-readium-typescript-toolkit-july-2026/)
- [`@readium/navigator` package](https://www.npmjs.com/package/@readium/navigator)
- [Thorium Web implementers' guide](https://github.com/edrlab/thorium-web/blob/develop/docs/ImplementersGuide.md)
- [Thorium Web local-publication discussion](https://github.com/edrlab/thorium-web/discussions/122)
- [`@edrlab/thorium-web` package](https://www.npmjs.com/package/@edrlab/thorium-web)
- [Foliate-js](https://github.com/johnfactotum/foliate-js)
- [Foliate-js Android WebView failure report](https://github.com/johnfactotum/foliate-js/issues/146)
- [epub.js](https://github.com/futurepress/epub.js)
- [Capacitor 8 documentation](https://capacitorjs.com/docs)
