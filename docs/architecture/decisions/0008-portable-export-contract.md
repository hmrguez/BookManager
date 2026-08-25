# ADR 0008: Full-fidelity portable export contract

- **Status:** Accepted
- **Date:** 2026-08-25
- **Issue:** QUI-21
- **Depends on:** [ADR 0004: Private data and integration credentials](0004-private-data-and-integration-credentials.md), [ADR 0005: Transactional SQLite storage](0005-transactional-sqlite-storage.md), [ADR 0007: Previewable import pipeline](0007-previewable-import-pipeline.md)

## Context

A local-first library must remain useful when Wovenleaf is unavailable. A SQLite backup is useful
for disaster recovery but is tied to implementation details, while CSV and Markdown cannot retain
canonical IDs, provenance, relationships, reading-event history, or redaction decisions. The
portable contract therefore needs one lossless machine format and clearly labeled readable views.

## Decision

Wovenleaf exports `wovenleaf-portable-library` format version 1 as one JSON envelope. The envelope
contains a manifest and a path-addressed entry map. Text entries store UTF-8 strings; optional asset
entries store base64. Every manifest descriptor records its path, role, media type, encoding, byte
size, SHA-256 checksum, and fidelity classification.

| Entry | Role | Fidelity | Purpose |
| --- | --- | --- | --- |
| `data/catalog.json` | Data | Canonical | Works, editions, asset records, lists, access records, provenance, and portable reading events |
| `data/library.json` | Data | Canonical | Current shelves, progress, dates, and the UI compatibility projection; annotation fields are deliberately empty here |
| `annotations/reading.json` | Annotations | Canonical | Private library notes/ratings and canonical note/rating reading events |
| `views/library.csv` | View | Lossy | A conventional table for inspection and migration help |
| `views/reading-journal.md` | View | Lossy | A human reading journal that explicitly says it is not a backup |
| `assets/<asset-id>/<name>` | Asset | Canonical bytes | Optional, individually selected cover/content/supplement payloads |

Canonical entry JSON uses recursively sorted object keys before checksumming. Array order remains
meaningful and is preserved. The outer envelope is pretty-printed for inspection; its formatting is
not part of an entry checksum.

### Export boundary and redaction

The manifest records the exact choices that produced an archive:

- Private notes and ratings are included by default in a portable archive and can be excluded from
  the canonical annotation entry and both readable views together.
- Raw source-provider payloads are excluded by default. Canonical claims and provenance remain.
  An internal caller may opt them in, but the existing credential-leak guard still fails closed if
  the payload contains credential-shaped material.
- Sync marker events and opaque integration cursors are rebuildable operational state and are not
  portable. Events that would point at an omitted event are also omitted so the retained ledger is
  valid.
- Secure-vault credentials are outside SQLite and are never queried. Import staging, receipts,
  caches, database snapshots, and storage-engine metadata are never queried either.
- Device-local managed paths and security-scoped bookmark handles are converted to explicit
  `missing` locations with portable fingerprints/names. Expiring remote links are treated the same
  way. Public, non-expiring metadata links can remain as provenance.
- Asset records remain in the catalog. Asset bytes are excluded unless each payload is explicitly
  supplied to the export boundary; this prevents a generic export action from silently copying
  copyrighted books, audiobooks, supplements, or covers.

The Settings screen presents these inclusions and exclusions before any download. Archive creation,
checksumming, CSV generation, and Markdown generation use only local data and platform crypto, so
the full workflow works without a network connection.

### Restore and integrity

Restore follows `replace-after-validation` semantics:

1. Parse the envelope and enforce supported format/schema versions.
2. Verify that every declared entry exists, no undeclared entry exists, decoded byte sizes match,
   and every SHA-256 checksum matches.
3. Parse each canonical entry and re-run Zod schemas plus cross-record catalog invariants.
4. Recombine the separated annotation records and assert the result is credential-free.
5. Replace the canonical catalog and library projection in one SQLite transaction.

Errors name the affected entry, such as `data/library.json`, before any database write begins. SHA-256
detects accidental truncation and tampering; it does not authenticate who created an archive.
Authenticated archives can be added as a later envelope version without weakening this contract.

Optional asset bytes are verified and returned by inspection/restore for an asset-store adapter to
materialize. Database restoration does not pretend a byte payload has been installed when no asset
adapter is present.

### Compatibility

`formatVersion` versions the envelope and checksum rules. `schemaVersion` versions the recombined
canonical domain payload. Version 1 readers ignore unknown manifest fields, but they do not ignore
unknown major format/schema versions or missing required entries.

- A newer writer can add descriptive manifest fields while keeping format/schema version 1.
- A format/schema change must add an explicit migration path before its version is accepted.
- This first implementation has no pre-v1 upgrade path and rejects newer versions with a specific
  compatibility error rather than guessing.

### Partial exports and readable views

An annotation-redacted archive is a valid complete-library export with an explicit redaction choice;
restore reconstructs all included data and initializes omitted notes/ratings to their neutral values.
An archive with selected asset entries reconstructs the same library structure and returns only the
selected verified bytes. The manifest always identifies unselected asset content.

CSV and Markdown downloads are views, not partial canonical archives. They intentionally omit IDs,
relationships, source evidence, reading-event history, checksums, and restore metadata. Neither the
UI nor the storage service presents them as lossless or accepts them at the portable restore boundary.
CSV import remains a separately previewed, reviewed workflow under ADR 0007.

## Consequences

- A clean database can reconstruct the representative catalog and current library projection from
  a portable archive without network access.
- The archive remains inspectable with ordinary JSON tools and includes convenient readable views.
- Archive restores are replace operations, not silent merges. Recovery UX and user confirmation are
  owned by the later backup/restore feature.
- Asset-store materialization and authenticated archive signatures remain compatible follow-ups.
