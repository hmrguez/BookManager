# ADR 0005: Transactional SQLite storage and repository boundaries

- **Status:** Accepted
- **Date:** 2026-08-25
- **Issue:** QUI-17
- **Depends on:** [ADR 0001: Canonical catalog and access boundaries](0001-canonical-catalog-boundaries.md), [ADR 0003: Reading ledger](0003-reading-ledger.md)

For day-to-day schema changes, see the
[SQLite development guide](../../guides/sqlite-development.md).

## Context

The development UI stored its flat library as one `localStorage` JSON value. That cannot make a
checkpoint and its reading events atomic, enforce catalog relationships, query a long history, or
upgrade safely. QUI-15 and QUI-16 now define the canonical records and event ledger that storage
must preserve.

## Compatibility spike and decision

Use [`@capacitor-community/sqlite`](https://github.com/capacitor-community/sqlite) 8.1.1 behind the
Wovenleaf `SqlDatabase` interface. Version 8.1.1 declares Capacitor 8 compatibility and has native
iOS/Android implementations plus a web implementation. The project pins the plugin and its web
runtime so an upstream release cannot silently change the database contract.

The same migrations and repository SQL run on every platform:

| Path | Engine and durable location | Commit behavior |
| --- | --- | --- |
| iOS | SQLCipher-backed SQLite in `Library/CapacitorDatabase`; the location is outside Documents/iCloud backup | Native SQLite commit; migration snapshots go to `LibraryNoCloud/storage-backups` |
| Android | SQLCipher-backed SQLite in the app-private database directory; Android cloud/device-transfer rules exclude app databases | Native SQLite commit; migration snapshots go to the app-private library directory |
| Web development | `jeep-sqlite` 2.8.0 and its build-compatible `sql.js` 1.11.0; the database is stored in the `jeepSqliteStore` IndexedDB database | SQLite commits in WASM, then `saveToStore` after every repository transaction; migration snapshots use a separate `wovenleaf-migration-backups` IndexedDB database |

Web is a supported development and PWA path, not an encryption-equivalent substitute for native
SQLCipher. Vite serves and bundles the pinned `sql-wasm.wasm`; no manual asset copy is required.
`sql.js` 1.13+ is deliberately not selected because `jeep-sqlite` 2.8.0's compiled JavaScript uses
the 1.11 WASM import ABI; mixing those artifacts fails before the database opens. The plugin's
native SQLCipher dependency also has encryption-export compliance consequences that must be
handled before store release.

## Storage contract

`apps/mobile/src/storage/` owns integration code. React uses `LibraryRepository`; domain features
use `CatalogRepository`, `ReadingLedgerRepository`, and `CatalogQueryService`. None of those
consumers imports the Capacitor plugin, SQL connection types, or integration payload rows.

The first schema migration creates one table per canonical record boundary. JSON payloads preserve
the complete Zod contract while relationship, ordering, lookup, and timeline columns are extracted
and indexed. Repositories parse payloads back through the Zod aggregate at every trust boundary.
Polymorphic references such as Contributor targets remain checked by the aggregate schema;
ordinary relationships use restrictive foreign keys.

The `library_books` table is the current UI's compatibility read model. It replaces all catalog
data reads and writes previously made by `library.ts` through `localStorage`. QUI-18 owns the
one-time, lossless conversion of the old `bookmanager.library.v1`/`wovenleaf.library.v1` values into
canonical Work, Edition, SourceRecord, list, and reading-event records. Appearance preferences are
small UI settings outside the catalog and continue to use the appearance preference adapter.

### Atomic writes

- `CatalogRepository.replace` validates the whole aggregate, then replaces every related table in
  one transaction.
- `ReadingLedgerRepository.append` validates the combined ledger, verifies Asset scope, and commits
  new checkpoints, events, reference edges, and disposable snapshots in one transaction.
- A thrown error rolls the transaction back. Web persistence happens only after SQLite commit, so
  IndexedDB never receives a half-applied transaction.
- Reading-event foreign keys and reference edges are restrictive. Evidence is not physically
  removed by normal ledger APIs.

### Query contract

The query service exposes domain objects rather than rows. The schema indexes recent Work browsing
and the full Edition timeline (`effectiveAt`, `observedAt`, `recordedAt`, stable ID), with a partial
session index for high-volume statistics. Scale fixtures load 10,000 Works and 50,000 reading
events and assert the expected indexes through `EXPLAIN QUERY PLAN`.

### Versioned migrations and recovery

Migrations are immutable, contiguous, and checksummed. `schema_migrations` is the replay ledger;
`migration_runs` records start, completion/failure, duration, error, and backup location. Startup
fails if an applied migration's name or checksum changes.

Every destructive migration must be labeled `destructive`. The runner exports a full SQLite JSON
snapshot to the platform backup store before invoking its `up` function and refuses to run when no
backup store is available. Schema work and its replay-ledger row share one transaction. A failed
attempt is therefore observable without advancing the schema version.

## Development inspection

In a development browser or native WebView console:

```js
await window.__wovenleafStorage.inspect()
```

The result includes `PRAGMA integrity_check`, schema version, domain record counts, installed
indexes, recent migration attempts, and the current Work query plan. For an extracted SQLite file,
run:

```bash
cd apps/mobile
bun run storage:inspect -- /absolute/path/to/wovenleafSQLite.db
```

## Rejected alternatives

### Direct plugin calls from React

Rejected because it couples UI lifecycle and integration types to transaction and migration
details, making tests and future adapters unsafe.

### One JSON catalog row

Rejected because it repeats localStorage's all-or-nothing query model and cannot enforce or index
canonical relationships and reading timelines.

### Plugin-managed upgrade statements only

Rejected because Wovenleaf needs the same replay log, checksums, observability, and pre-destructive
backup policy on native and web.

### A second web-only persistence design

Rejected because development would stop exercising production schema and transaction boundaries.
The WASM/IndexedDB adapter has different durability mechanics but runs the same SQL contract.

## Consequences

- Native builds include SQLCipher and the Capacitor Filesystem plugin for migration snapshots.
- Web startup loads a WASM database before repositories become available.
- QUI-18 can migrate the legacy JSON through repository APIs without teaching React about SQL.
- Later search, import, sync, statistics, and recovery work share one transactional contract.
