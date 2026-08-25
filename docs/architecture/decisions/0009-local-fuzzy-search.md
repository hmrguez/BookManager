# 0009 · Versioned local fuzzy search

## Status

Accepted for QUI-28.

## Decision

Wovenleaf builds an in-memory, versioned search index from records already stored on the device.
The index is provider-agnostic and accepts titles, alternate/edition titles, contributors, series,
identifiers, tags, list names, private notes, source names, and edition formats. Current library
rows and canonical catalog aggregates adapt to the same document contract.

Queries normalize case, punctuation, and diacritics, then combine exact, prefix, substring, and
bounded Damerau–Levenshtein matches. Titles and identifiers carry the strongest field weights;
notes and source names remain useful but cannot outrank an equally good title. Every tie falls back
to locale-aware title order and stable record ID. Results include ranges into the original strings
so the UI can highlight evidence without reconstructing it from normalized text.

Private notes are indexed only as local process memory and are excluded from candidate scoring by
default. A reader must enable **Search private notes** in local settings before note text can make a
record appear. Query text and index contents are never sent to a provider.

## Rebuild and migration contract

`LOCAL_SEARCH_INDEX_VERSION` changes whenever normalization, tokenization, or ranking semantics
become incompatible. Rebuilds fingerprint and process at most 50 records per chunk in the app, publish a
`SearchIndexCheckpoint`, and yield to the main event loop between chunks. A checkpoint contains the
index version, a source fingerprint, the next record offset, and total size. Matching checkpoints
resume the active builder; stale versions, changed source fingerprints, or a process restart begin
again safely from canonical data. The previous usable index can continue answering while a
replacement is built.

The index is derived data. It never becomes a source of truth and may always be discarded and
recreated from SQLite.

## Input-to-result budget

For a warm 10,000-work index, the core query target is **50 ms p95** on the Bun development
reference environment. The automated scale fixture runs twelve typo-tolerant multi-token queries
and enforces a 150 ms p95 ceiling to allow for shared-CI variance. UI input is deferred independently
from rendering, and visible library rows use `content-visibility`, so typing does not wait for a full
rebuild or a 10,000-row paint.

## Consequences

- Search and filters work with no network connection and without SQLite extension availability.
- Ranking and highlights are fully deterministic and testable across mobile and web shells.
- Prefix/gram postings narrow fuzzy candidates without adding a third-party search dependency.
- Index memory scales with searchable metadata and is reclaimed when the app process closes.
- Future durable background workers may persist the same document contract, but cannot weaken the
  private-note opt-in or replace canonical records as the source of truth.
