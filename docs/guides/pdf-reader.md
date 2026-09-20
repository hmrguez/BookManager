# PDF import and native reading

Choose **Settings → Choose book files**, attach an EPUB or PDF to a book, or share a PDF
from the operating system. Unprotected PDFs up to 256 MB are validated locally, linked to their
original location, and cataloged with their title, author, language, and physical page count.
Missing titles fall back to the filename. Native imports render the first page as a cover.

Identical bytes are deduplicated. Documents with identical metadata are kept separate unless
the user explicitly attaches a replacement to an existing book. Re-importing identical bytes
repairs the original-file reference without resetting its reading history. Existing private
copies remain supported; see [original-file access and current verification](original-files.md).

The iOS reader uses PDFKit with horizontal paging, pinch zoom, previous/next controls,
fit-to-page, and a page-number picker. Android uses PdfRenderer with bounded bitmap allocation
on a serial worker, pinch/double-tap zoom, panning, swipe/button page turns, fit-to-page, and a
page-number picker. Both offer keyboard page navigation and return to the library.
Neighboring pages follow the swipe before release. Android keeps two bounded previews,
snaps short or cancelled drags back, and records progress only after completing the turn.
Fit appears only when the page is zoomed away from its fitted size; its empty toolbar space
remains reserved so the title does not shift while zooming.

Each displayed page is written to the existing durable native outbox. The full checkpoint
retains a one-based physical page number, page count, and asset fingerprint. Page events update
the library and reading ledger; the final page reaches 100% without automatically moving the
book to Finished. Returning to an earlier page lowers progress again. Backgrounding or closing
the reader ends the active reading session. A changed PDF revision falls back to proportional
position instead of silently reusing a physical page from a different document.

Portable archive schema 8 includes PDF import records and optionally the original PDF bytes.
Library progress reconstructs the page checkpoint on a clean restore. Cleanup and exact-file
relinking preserve progress. Storage migration 17 widens the existing import format constraint
without changing historical EPUB IDs or records; the `epub_*` table names remain for compatibility.

## Current scope

- Reading is available in the native iOS and Android apps. Web imports and backups work, but
  there is no browser PDF reader or browser-generated cover.
- Password-protected PDFs are rejected. Search, OCR, PDF highlights/notes, and embedded form
  editing are outside this first reader. Scanned pages can be viewed and zoomed.
- PDF pages keep their original layout and colors; EPUB typography preferences do not apply.
- Android exposes reader controls to accessibility services; full PDF text accessibility is
  not implemented by the bitmap renderer. iOS uses PDFKit's document accessibility.

## Verification

`bun run lint` and `bun run typecheck` pass. The final unit run has 341 passing tests and
three timing-budget failures in the existing Goodreads import, local search, and smart-list
benchmarks. All three failures also reproduce from unchanged commit `d75cc20` on this machine;
an earlier full run passed all 344 tests. The targeted EPUB/PDF suite passes all 26 tests.
PDF tests cover metadata, invalid/encrypted files, duplicate handling, import rollback,
migration of an existing EPUB, backup/restore, cleanup/relinking, re-import recovery,
stale events, and page progress.

On the connected Pixel 9, `PDFReaderTest.importFromPickerReadAndResumeOnDevice` exercises the
actual WebView file input, native first-page rendering, reader open, double-tap zoom,
conditional Fit visibility, next-page content during a live drag, cancelled/short drags,
completed swipes, persisted SQLite checkpoint, reopen at page 3, and final-page boundaries.
It leaves a single reusable **PDF reader verification** book in the library.

On the iOS 26.5 simulator, a generated four-page PDF was shared through the iOS extension,
opened in the native reader, advanced to page 3, and reopened at page 3 after terminating and
relaunching the app. The library reported 75%; next-page was disabled on page 4 and re-enabled
after returning to page 3. Both native Debug builds pass.

The paging refinement was also checked on the iOS simulator: double-tap zoom reveals Fit;
Fit restores the original framing and disappears from both the toolbar and accessibility
tree. Previous/next controls still update the page count and final-page boundary correctly.
