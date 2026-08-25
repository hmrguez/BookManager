# ADR 0006: Lossless legacy library migration and recovery

- **Status:** Accepted
- **Date:** 2026-08-25
- **Issue:** QUI-18
- **Depends on:** [ADR 0001: Canonical catalog and access boundaries](0001-canonical-catalog-boundaries.md), [ADR 0003: Reading ledger](0003-reading-ledger.md), [ADR 0005: Transactional SQLite storage](0005-transactional-sqlite-storage.md)

## Context

BookManager and early Wovenleaf builds stored a flat `LibraryBook[]` under
`bookmanager.library.v1` or `wovenleaf.library.v1`. The record combines provider identity,
bibliographic fields, shelf placement, reading state, ratings, and notes. Removing that value or
copying it only into the temporary SQLite UI table would lose provenance and leave later features
without canonical Work, Edition, List, and ReadingEvent records.

The migration crosses two durability systems: browser/WebView local storage and SQLite. They cannot
share a transaction, so the order of checkpoint, verification, and source cleanup must make every
interruption retryable.

## Decision

Run `migrateLegacyLibrary` after schema migrations and before starter seeding. It examines both
legacy keys, preserves an exact recovery payload in SQLite, validates the complete source, maps it
into canonical records and the compatibility read model in one transaction, reads the stored data
back through Zod, and only then removes the old keys.

```text
discover -> checkpoint raw source -> validate/map -> SQLite transaction -> verify
                                                                    |
                                                      remove old key -> complete
```

The durable checkpoint states are:

| State | Meaning | Retry behavior |
| --- | --- | --- |
| `started` | Exact source and checksum are recoverable; import is not verified | Re-run the atomic import |
| `verified` | Canonical and compatibility records committed and read back successfully | Skip inserts and retry only old-key cleanup |
| `completed` | Verification and old-key cleanup both completed | Do not import again |
| `failed` | Validation or the import failed; source/recovery data was retained | Show recovery guidance; the same checksum can retry safely |

The migration refuses to choose automatically when both aliases contain different values or when
the source changes after an import has started or been verified. A source repaired after validation
failure may retry, while the recovery export retains both the malformed and repaired versions.

### Defensive legacy contract

`id` and `title` are the minimum recoverable identity. Missing fields receive conservative values:

- authors become an empty collection;
- missing shelf is inferred from finish/start/progress evidence, otherwise To Be Read;
- missing progress and current page are derived from each other when a page count exists;
- rating and notes become their empty legacy values;
- missing timestamps use the nearest available legacy timestamp, then the import time; and
- missing language becomes `und` (undetermined).

Known fields with invalid types, ranges, dates, or page extents fail the whole migration. Unknown
future fields are accepted and retained in the SourceRecord raw payload and exact recovery copy.
No partially valid subset is committed.

### Canonical mapping

Stable SHA-256-derived IDs make every mapped record deterministic across retries.

| Legacy evidence | Canonical destination |
| --- | --- |
| ID and full raw row | Migration SourceRecord with the legacy ID as `externalKey` |
| Title | One Work and one provisional print Edition with migration-sourced resolved metadata |
| Authors | Exact-name Person records plus ordered Work-level author Contributors |
| Thumbnail | Remote Edition cover Asset retaining its SourceRecord |
| Page count | Edition page count; the raw row remains available if format needs later review |
| Shelf | System List and ordered ListEntry records |
| Start, finish, page, and percent | Individually addressable migration ReadingEvents |
| Rating and notes | Migration rating/note events |
| Per-book event batch | Import marker plus disposable ProgressSnapshot |

The temporary `library_books` table is updated in the same transaction so the existing UI shows
the migrated library immediately. It is a compatibility projection, not the canonical destination.

Starter IDs are recognized from the shipped starter fixture. Their SourceRecords use
`Wovenleaf seeded starter library`; all other rows use `BookManager legacy user library`. This keeps
seed data distinguishable without weakening stable identity or parsing rules.

### Recovery behavior

`legacy_library_migrations.recovery_payload` retains the exact raw source before import. It is
deliberately excluded from inspection and diagnostics because it may contain private notes. The app
shows an alert when migration cannot proceed and offers an explicit recovery download. Malformed
source keys remain untouched.

SQLite import and verification are one transaction. Source removal happens only from `verified`.
If source removal fails, the checkpoint remains `verified`; startup retries cleanup without
duplicating any canonical records.

## Rejected alternatives

### Reset development data

Rejected as the product migration because it proves neither upgrades nor recovery and would lose
real user libraries after release. Developers may still reset disposable local instances.

### Import only into `library_books`

Rejected because later catalog, list, reading-history, and provenance work would still depend on a
flat compatibility record.

### Remove the old key immediately after parsing

Rejected because a SQLite interruption or mapping bug would leave no rollback source.

### Silently skip malformed rows

Rejected because a smaller-looking successful library is data loss. Migration is all-or-nothing;
the raw source remains exportable for recovery.

## Consequences

- Schema version 2 adds canonical List/ListEntry tables and the legacy migration checkpoint.
- New installations replay versions 1 and 2; existing version-1 databases upgrade additively.
- Startup seeds the compatibility starter library only when no legacy source or prior checkpoint
  exists.
- Exact recovery data remains in SQLite backups after successful migration.
- Later removal of `library_books` can use canonical records without repeating legacy parsing.
