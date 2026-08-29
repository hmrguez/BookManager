# EPUB accessibility and international reading

Wovenleaf inspects every EPUB before it becomes a native-reader capability. The inspection is
stored with the import provenance and travels across the Capacitor boundary with the book. It does
not claim that a publication is accessible merely because metadata or markup is present; it tells
the reader what the app can render and which publisher features were discovered.

## Reader support contract

| Publication behavior | Status | Wovenleaf behavior |
| --- | --- | --- |
| EPUB 2/3 XHTML reflow, horizontal Latin and CJK, bidi isolation, RTL spine progression | Supported | Readium renders in semantic reading order; page controls and hardware arrows follow the spine direction. |
| Headings, landmarks, lists, links, image alternatives, footnotes, MathML, SVG, ruby, and semantic tables | Supported | Publisher semantics stay in the publication WebView for VoiceOver/TalkBack and keyboard or switch navigation. Wovenleaf does not invent missing semantics. |
| Dynamic Type, high contrast, reduced motion, system font scaling, keyboard navigation, selection, copy, annotations, and selection read-aloud | Supported for reflowable text | Native chrome stays accessible; selected text is handed to AVSpeechSynthesizer or Android TextToSpeech using the publication language. |
| Vertical CJK writing | Limited | Publisher writing mode, font, start alignment, one column, and pagination are preserved. Layout overrides that could flatten reading order are disabled. Physical-device regression remains mandatory for each supported OS/toolkit release. |
| Fixed-layout and mixed-layout EPUB | Limited | Pages stay paginated with publisher styling. Type size, reflow, columns, and scrolling do not apply to fixed pages. Fixed-layout scrolling is not offered. |
| Scripted content | Limited | Scripted interaction is detected but is not supported or guaranteed. Ordinary text, links, and images remain available; a compatibility notice appears before reading. |
| EPUB media overlays | Limited when equivalent text is present | Synchronized recorded narration is not played. Text stays readable and selection read-aloud is available. |
| Foreign spine content with a valid XHTML/SVG fallback | Limited | Wovenleaf opens the declared fallback and explains that the original content type is not rendered directly. |
| Foreign spine content without a readable fallback | Unsupported | Opening is stopped before the navigator, with the unsupported type explained. The managed file, locator, history, and annotations remain untouched. |
| Auditory-only EPUB requiring media-overlay playback | Unsupported | Opening is stopped because presenting it as a readable edition would be misleading. |
| DRM/LCP or encrypted publication content | Unsupported | Import is rejected without linking a DRM module or offering circumvention. |

Compatibility warnings appear on first presentation and remain available from the reader’s Info
control. Unsupported content returns to the existing recovery sheet without a retry loop. A legacy
book imported before profile version 1 remains openable; re-importing it adds the current profile.

The classification follows the package-level fixed-layout, spine direction, fallback, media-overlay,
and accessibility-discoverability metadata defined by EPUB. Accessibility metadata is preserved as
publisher provenance, including `accessMode`, `accessibilityFeature`, `accessibilityHazard`,
`accessibilitySummary`, and `conformsTo` values.

## Continuous corpus

The authored corpus lives in
`apps/mobile/tests/fixtures/epub-corpus`. Its source cases are CC0-1.0 and generate conforming EPUB
containers in memory. Every feature and every high-severity failure has an automated classification
gate. The corpus deliberately contains no copyrighted book, DRM payload, remote resource, or copied
upstream binary.

Run the continuous checks with:

```sh
cd apps/mobile
bun test ./tests/epub-compatibility.test.ts
```

The local cases complement the W3C EPUB 3.3 and DAISY accessibility suites. A device run can sideload
exact upstream revisions, but its report must record the revision, source URL, license, platform,
OS, toolkit version, WebView version, assistive technology, result, and any retained regression case.

## Assistive-technology matrix

The agreed minimum matrix is deliberately small enough to run for every Readium or OS upgrade and
large enough to catch platform divergence.

| Platform | Assistive input | Required corpus passes |
| --- | --- | --- |
| Current and previous iOS major on a physical iPhone | VoiceOver; Full Keyboard Access; Switch Control; Dynamic Type at default and largest accessibility size | Semantic structure, RTL bidi, vertical ruby, fixed layout, media-overlay notice, unsupported-spine block, read-aloud handoff |
| Current and previous Android major on a physical phone | TalkBack; hardware keyboard; Switch Access; font size and display size at default and largest supported setting | The same cases, with the same reading order and capability labels |

For each pass:

1. Focus enters the reader chrome in Library → title → bookmark/info/appearance order, then the
   publication, then Contents → Back → position → Previous → Next.
2. Headings and landmarks are discoverable in publisher order; moving by heading never enters
   Wovenleaf chrome or skips into another spine item.
3. RTL Next moves left and Previous moves right while their spoken labels remain semantic. Mixed
   inline LTR text is announced once in logical order.
4. Ruby base text is announced before or with its annotation. Vertical text keeps publisher order;
   it is not flattened into visual column order.
5. Sheets trap focus until dismissed and return focus to the invoking control or publication.
6. Largest text sizes scroll native sheets without clipping. Reflowable content keeps the locator;
   fixed pages explain that type size does not apply.
7. Read Aloud speaks the selected passage in its declared language and can be interrupted by a new
   selection or by closing the reader.
8. Unsupported content never opens a blank navigator, and leaving the message does not change the
   last trusted locator or delete annotations.

An automated build is not a substitute for this physical-device matrix. A high-severity failure is
release-blocking: retain or add the smallest license-compatible fixture, reproduce it on both
platforms, and keep the issue open until the matrix passes.
