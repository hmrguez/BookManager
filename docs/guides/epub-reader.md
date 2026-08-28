# Native EPUB reader lifecycle

Wovenleaf renders reflowable EPUBs with the native Readium hosts selected in
[ADR 0012](../architecture/decisions/0012-epub-engine-and-reader-boundary.md): Swift Toolkit
3.11.0 on iOS and Kotlin Toolkit 3.3.0 on Android. LCP and other DRM modules are not linked.

## Resume contract

The Readium `Locator` is the canonical checkpoint. Wovenleaf stores its complete JSON rather than
reconstructing a location from a page number. Chapter title, chapter `href`, total progression, and
text context are derived views for UI, history, and recovery only. Switching between paginated and
scrolling layouts, rotating the device, backgrounding, changing books, or opening
`wovenleaf://reader?book=<book-id>` therefore returns the locator to Readium unchanged.

Locations are debounced for 750 ms. Backgrounding and closing the reader flush immediately, so a
normal lifecycle transition loses no observed position. A force-quit can lose at most the final
750 ms of movement after the last emitted locator. Native events are first written to a durable
outbox and use a monotonically increasing sequence per asset. The database ignores any sequence at
or below its checkpoint, making retries idempotent and preventing a delayed event from silently
moving progress backwards.

## Navigation and saved passages

The native navigation sheet keeps the book in view while offering its hierarchical table of
contents, saved bookmarks, and full-text search. Search results retain Readium's title, surrounding
text, and exact locator; selecting a result, TOC entry, internal link, or scrubber position adds the
current passage to an in-book back stack. Hardware back, Escape, Alt-Left, and the visible Back
control unwind that stack before leaving the reader. Arrow keys and the page controls turn pages,
while Command/Control-F opens search and Command/Control-B toggles a bookmark.

Footnotes open over the current passage with an explicit return action. Web links are limited to
HTTP(S), name their destination before handing off to the system browser, and never expose the
managed EPUB URL. Tapping an EPUB image opens bytes read from the publication container in a
local-only zoom surface; missing resources and broken TOC targets leave the current passage intact
and show a recoverable message.

Bookmarks and the last selected TOC target use the same asset fingerprint and locator rules as
reading checkpoints. They travel in portable archive schema 6 when annotations are included, and
are omitted when private annotation data is excluded. Restoring an archive replaces navigation
state transactionally, while an edition replacement drops revision-specific locator fragments
before offering the saved passage to the new asset.

## Highlights and notes

Selecting EPUB text exposes Copy, Highlight, and Add Note through the platform selection menu.
The same actions work with keyboard and assistive selection: Command-Shift-H/N on iOS and
Control-Shift-H/N on Android. Each annotation keeps the exact Readium range together with the
quoted passage, bounded text before and after it, chapter, color, note, normalized tags, timestamps,
asset fingerprint, and toolkit provenance. Highlights are separate from bookmarks and can be
opened, edited, or deleted from the Notes tab in the navigation sheet; tapping a highlight opens
the same editor.

Deletion creates a durable tombstone so sync and restore semantics cannot resurrect a removed
annotation by accident. The reader offers an immediate Undo, which records an explicit restore.
Portable archive schema 6 includes the complete annotation states in canonical, stable-order JSON
and adds active highlights and notes to the human-readable Markdown journal. Excluding private
annotations removes quotes, notes, tags, bookmarks, and annotation tombstones from both forms.

An unchanged asset fingerprint keeps the full range across appearance, layout, orientation,
restart, backup, and restore. A changed EPUB revision never receives an old CFI or selector
silently: Wovenleaf drops revision-specific fragments, preserves the quote and surrounding context,
and searches the new publication. A unique exact quote, or a unique match disambiguated by both
available sides of its text context, receives the new Readium range and is persisted as re-anchored.
Missing or ambiguous matches stay in **Needs review**; the reader must visit the candidate passage
and choose **Keep Here** before the highlight is drawn again. Protected/DRM publications remain
outside this flow because the app does not link a DRM module; only the visible passage selected in
an unprotected EPUB is stored.

## Replacement and recovery

Every checkpoint records the managed asset's SHA-256 fingerprint. If a new import replaces that
asset, Wovenleaf preserves the semantic resource, progression, chapter title, and text context but
removes revision-specific fragments before asking Readium to resume. This avoids applying a stale
CFI or selector to changed content while retaining the best safe passage-level anchor.

The native hosts only accept file URLs inside the app-managed private library. A missing file,
invalid archive, protected publication, or resource load failure leaves the last trusted checkpoint,
reading-event ledger, notes, and annotations untouched. Recovery UI directs the reader back to the
library to re-import the edition; it never offers destructive cleanup as part of opening a book.

## Paper-aware appearance

The default reading surface is warm paper (`#EEEDE7`) with near-black graphite ink (`#252622`), a
literary serif, paginated movement, generous line spacing, restrained margins, justification, and
hyphenation. White paper and inverse graphite are available without introducing accent color. A
very low-opacity, static fibre pattern sits above the page; it never animates and disappears when
the operating system requests stronger contrast.

The **Aa** sheet previews changes on the open passage through Readium's live preference API. It
controls typeface, size, ink weight, line spacing, margins, alignment, hyphenation, columns,
paginated or scrolling movement, theme, and whether to respect the publisher's original design.
Publisher styling is an explicit policy rather than an all-or-nothing escape hatch: Wovenleaf still
normalizes text and owns the page and ink colors so the book stays readable.

Preferences are versioned and persisted locally. **All books** changes the global default; **This
book** creates a complete book override, and returning to **All books** removes that override. Native
changes use the durable reader outbox, so closing or backgrounding flushes them immediately. The
navigator is not recreated when a setting changes, preserving the current Readium locator and text
selection. Two-column mode collapses to one column on compact screens and scrolling always uses one
column.

The settings sheet supports Dynamic Type, scrolling at large accessibility sizes, reduced motion,
and high-contrast palettes. It deliberately leaves device brightness to the operating system and
explains how to match the luminous display to ambient light; an LCD/OLED phone cannot reproduce the
reflective front-light hardware of an e-ink panel.
