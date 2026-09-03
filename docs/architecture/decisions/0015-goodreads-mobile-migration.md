# ADR 0015: Local-first Goodreads migration on mobile

- **Status:** Accepted
- **Date:** 2026-09-03
- **Issues:** QUI-63, QUI-88, QUI-90, QUI-91, QUI-92, QUI-93
- **Depends on:** [ADR 0002: Source precedence and reconciliation](0002-source-precedence-and-reconciliation.md), [ADR 0007: Previewable imports](0007-previewable-import-pipeline.md)

## Context

Goodreads already provides a complete library export as CSV, but asking a reader to understand
file formats or manually map columns makes migration feel technical. Wovenleaf is mobile-only, and
mobile Chrome does not support the desktop extension model required to inject an import button into
Goodreads. Polling the downloads directory would also require broad platform permissions, is not
reliable on iOS, and could cause the app to inspect unrelated files.

The migration should therefore feel guided while keeping Goodreads credentials, reading history,
and source evidence off Wovenleaf servers.

## Decision

Wovenleaf uses the operating system's browser and file handoff rather than an embedded Goodreads
login, browser extension, local WebSocket, or backend relay:

1. Settings opens the official Goodreads export page in the system browser.
2. The reader asks Goodreads to create the export and downloads it normally.
3. The reader shares or opens that one file with Wovenleaf, or selects it from Wovenleaf.
4. Wovenleaf recognizes a Goodreads export by its headers and content, not its filename.
5. A local preview explains additions, updates, conflicts, skipped rows, and preserved evidence.
6. The reader confirms once; the complete import commits in one SQLite transaction and can be
   undone from the migration history.

The app never monitors the Downloads folder and does not need to be running while Goodreads creates
the file. Android registers scoped CSV open intents. The iOS share extension copies the selected
file into the app group's incoming directory and hands an opaque file reference to the app. Warm
opens use the native URL event; cold opens use the launch URL. Shared file events are retained by
the native plugin until the web view subscribes.

## Goodreads data contract

The parser accepts UTF-8, RFC 4180-compatible Goodreads exports containing `Book Id`, `Title`,
`Author`, and `Exclusive Shelf`. It preserves the following source evidence when present:

- Goodreads book ID, ISBN and ISBN13, edition title, binding, publisher, publication years, and
  average rating;
- primary and additional authors;
- exclusive shelf, custom shelves, read count, owned count, dates added/read, and the reader's
  rating;
- review text, private notes, and spoiler flags;
- the complete validated source row as a local source record.

Every currently observed official column has an explicit disposition:

| Goodreads column | Disposition |
| --- | --- |
| `Book Id` | Required source-local identity; never treated as an ISBN or canonical ID |
| `Title` | Work and Edition title evidence |
| `Author` | Primary Work contributor |
| `Author l-f` | Preserved sort-name evidence in the source revision |
| `Additional Authors` | Preserved as additional contributors with an unknown/`other` role because the export does not provide roles |
| `ISBN`, `ISBN13` | Optional checksum-validated Edition identifiers |
| `My Rating` | Reader rating event; zero means unrated |
| `Average Rating` | Goodreads aggregate evidence only; never used as the reader's rating |
| `Publisher` | Edition publisher evidence |
| `Binding` | Edition medium/binding evidence; unrecognized values remain in the source revision |
| `Number of Pages` | Edition page-count evidence |
| `Year Published` | Edition publication-date evidence at year precision |
| `Original Publication Year` | Preserved source evidence; not copied onto an Edition as if it were that edition's date |
| `Date Read` | Finish evidence when the exclusive shelf is `read` |
| `Date Added` | Library-added date; never fabricated as a reading start date |
| `Bookshelves` | Custom local Lists |
| `Bookshelves with positions` | Preserved source ordering evidence; not treated as a stable cross-export rank |
| `Exclusive Shelf` | Current compatibility status plus a local list; `read`, `currently-reading`, and `to-read` are mapped explicitly |
| `My Review` | Local reading-note evidence |
| `Spoiler` | Preserved source evidence; review text is not exposed in diagnostics |
| `Private Notes` | Local private-note evidence |
| `Read Count` | Preserved reread-count evidence; no missing reading periods or dates are invented |
| `Owned Copies` | Preserved ownership-count evidence; it does not create a specific copy without supporting data |

Columns added by Goodreads in a future export remain in each raw source revision even before a
typed mapping is introduced. Missing required signature columns fail with a fresh-export action;
the file is never reinterpreted as a generic Wovenleaf CSV. Hyphenated and slash-separated official
dates are accepted, while impossible calendar dates and locale-ambiguous dates fail validation.

ISBN values are normalized and checksum-validated before they participate in identity matching.
Dates are normalized from Goodreads' export format. Bad rows are quarantined for review instead of
partially written.

## Canonical mapping and precedence

Each reviewed row proposes a canonical graph: Work, Edition, SourceRecord, Identifiers, People,
Contributors, Lists, ListEntries, an integration checkpoint, immutable ReadingEvents, and a current
ProgressSnapshot. ISBN matches an existing edition before title/author similarity; ambiguous stable
identifiers become conflicts rather than silent merges.

Goodreads is evidence, not an authority over later local edits. Re-importing the same row is
idempotent. A changed export adds new source evidence and reading events, but it does not overwrite
a Wovenleaf rating or note that already exists. Custom Goodreads shelves become local lists. The
entire resulting catalog is schema-validated before any SQLite write.

Compatibility library rows and canonical entities commit together. Import changes retain exact
before/after records, allowing undo to reverse only values still owned by that import. Later edits
and records shared with another import are preserved.

## Privacy and safety

- Processing, matching, source rows, receipts, checkpoints, and undo history remain on device.
- No Goodreads password, cookie, session, or browser content is accessible to Wovenleaf.
- Only the explicitly shared or selected file is read, with a 10 MB limit and strict UTF-8 decode.
- A generic or unrelated CSV is rejected without writing library data.
- No network capability is declared or used by the importer.

## Consequences

- The flow includes one intentional system step—sharing or opening the downloaded file—but works on
  both supported mobile platforms without privileged storage access.
- Goodreads may change its export columns; representative fixtures and content-recognition tests
  make that contract explicit and independently maintainable.
- Libby synchronization remains a separate later adapter. It can reuse the same proposal, review,
  transactional commit, receipt, and undo infrastructure without coupling its lifecycle to this
  migration.
