# Wovenleaf EPUB compatibility corpus

These tiny source fixtures are generated in memory by `index.ts`; no copyrighted book text, DRM,
or opaque binary is stored in the repository. The fixtures are authored for Wovenleaf and dedicated
to the public domain under [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/).

The corpus covers semantic headings and landmarks, footnotes, MathML, inline SVG, complex tables,
RTL and bidi, CJK vertical text and ruby, fixed layout, media-overlay discovery, unsupported scripted
content, foreign spine resources, and auditory-only publications. Cases marked `high` are regression
gates: automated inspection must classify them before the native navigator can show a blank,
misordered, or falsely supported reading surface.

The authored cases complement, rather than copy, the upstream
[W3C EPUB 3.3 tests](https://w3c.github.io/epub-tests/epub33/) and
[DAISY EPUB accessibility tests](https://github.com/daisy/epub-accessibility-tests). Device runs may
load those suites separately under their own licenses; upstream files must not be copied here without
recording the exact revision and license.
