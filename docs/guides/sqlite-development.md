# SQLite development guide

This is the day-to-day guide for changing Wovenleaf's SQLite storage. For the architectural
decision and platform details, see
[ADR 0005](../architecture/decisions/0005-transactional-sqlite-storage.md).

## Current state

SQLite is the storage boundary on iOS, Android, and web development. All three platforms run the
same migrations and repository SQL through the small `SqlDatabase` interface.

The current implementation includes:

- schema version 1 for the canonical catalog, reading ledger, and the temporary `library_books`
  compatibility model;
- immutable, checksummed migrations with an applied-migration ledger and run history;
- a mandatory snapshot before every migration marked `destructive`;
- transactional repositories for catalog replacement and reading-ledger appends;
- indexed query services with query-plan tests; and
- development inspection for integrity, schema version, counts, indexes, and migration history.

`library_books` still exists so the current UI can use SQLite before the legacy library is converted
to canonical records. That conversion belongs to QUI-18. New domain storage should normally extend
the canonical catalog rather than the compatibility table.

## Mental model

The storage flow is:

```text
Zod domain object -> repository -> SqlDatabase -> SQLite/SQLCipher
                              ^
                    versioned migrations
```

Canonical tables intentionally store each record in two forms:

1. `payload_json` preserves the complete Zod object and is parsed at repository/query boundaries.
2. Extracted columns support foreign keys, uniqueness, filtering, ordering, and indexes.

The JSON payload is the domain contract. Extracted columns are a query and integrity projection of
that contract. A write that changes an extracted value must update both representations in the same
transaction.

## Important files

| Concern | Location |
| --- | --- |
| Domain IDs, Zod schemas, and aggregate rules | `apps/mobile/src/domain/catalog/` |
| Migration definitions and runner | `apps/mobile/src/storage/migrations.ts` |
| Database interface | `apps/mobile/src/storage/database.ts` |
| Capacitor/web adapter | `apps/mobile/src/storage/capacitor-database.ts` |
| Catalog and ledger writes | `apps/mobile/src/storage/catalog-repository.ts` |
| Current UI compatibility writes | `apps/mobile/src/storage/library-repository.ts` |
| Indexed reads and query plans | `apps/mobile/src/storage/query-services.ts` |
| Runtime construction | `apps/mobile/src/storage/runtime.ts` |
| Development inspection | `apps/mobile/src/storage/inspection.ts` |
| Storage tests and in-memory adapter | `apps/mobile/tests/storage.test.ts`, `apps/mobile/tests/storage-test-database.ts` |

## Creating a migration

Never edit a migration that might already have run, including version 1. Its name and `signature`
are checksummed in `schema_migrations`; changing either causes startup to fail. Add the next version
to `STORAGE_MIGRATIONS` instead.

### 1. Write the change

Keep the SQL in a named constant near the migration list. For example:

```ts
const ADD_WORK_ARCHIVE_STATE_SQL = `
ALTER TABLE works ADD COLUMN archived_at TEXT;

UPDATE works
SET payload_json = json_set(payload_json, '$.archivedAt', NULL)
WHERE json_type(payload_json, '$.archivedAt') IS NULL;

CREATE INDEX idx_works_archive_state
  ON works(archived_at, updated_at DESC, id);
`
```

This example adds a nullable extracted column, backfills the new required-but-nullable JSON
property, and creates an index for the expected query shape.

### 2. Append the migration

Versions must be contiguous, starting at 1.

```ts
export const STORAGE_MIGRATIONS: readonly StorageMigration[] = [
  // Existing migrations stay byte-for-byte unchanged.
  {
    version: 1,
    name: 'canonical catalog and reading ledger',
    kind: 'additive',
    signature: INITIAL_SCHEMA_SQL,
    async up(database) {
      await database.execute(INITIAL_SCHEMA_SQL)
    },
  },
  {
    version: 2,
    name: 'add Work archive state',
    kind: 'additive',
    signature: ADD_WORK_ARCHIVE_STATE_SQL,
    async up(database) {
      await database.execute(ADD_WORK_ARCHIVE_STATE_SQL)
    },
  },
]
```

The runner wraps `up` and the new `schema_migrations` row in one transaction. Throwing from `up`
rolls back both. It records the failed attempt separately in `migration_runs`.

The `signature` must describe every behavior in `up`. Using the exact SQL is the simplest option.
If `up` also performs transformation code, include a stable, versioned description of that logic
in the signature. Once a migration has been applied, fix it with another migration rather than
changing its SQL, name, signature, or transformation code.

Do not call a repository from a migration. Repositories implement today's domain schema and may no
longer accept yesterday's payloads. Migrations should work directly against the old storage shape
using parameterized SQL and explicit transformations.

### 3. Classify it correctly

Use `kind: 'additive'` when the old information remains intact, such as adding a table, nullable
column, or index and performing a lossless backfill.

Use `kind: 'destructive'` whenever the change can discard or reinterpret user data, including:

- dropping a table or column;
- rebuilding a table to change a type, nullability, primary key, or foreign key;
- deleting or merging rows; or
- rewriting payloads in a way that cannot be reversed from the new value.

A destructive migration is not run unless a `MigrationBackupStore` is available. The runner
exports and persists the full pre-migration database snapshot before invoking `up`.

SQLite often requires a table rebuild for constraint changes. The usual sequence is to create the
replacement table, copy and transform validated data into it, drop the original table, rename the
replacement, and recreate indexes. Keep that whole sequence inside `up`, respect foreign-key
dependency order, and mark it destructive.

### 4. Test the migration

At minimum, cover these paths in `apps/mobile/tests/storage.test.ts`:

- a fresh database reaches the latest version;
- a database at the previous version upgrades with all data preserved;
- running the migration runner again skips the migration;
- an injected failure rolls back the schema and data and records a failed run; and
- a destructive migration creates its backup before its first schema/data change.

Use `BunSqliteDatabase` from `storage-test-database.ts` for fast, real SQLite tests. Pass an explicit
migration list when a test needs to stop at an old version or include a test-only migration:

```ts
const database = new BunSqliteDatabase()
await migrateStorage(database, { migrations: STORAGE_MIGRATIONS.slice(0, 1) })

// Seed data in the old shape, then upgrade.
await migrateStorage(database, { migrations: STORAGE_MIGRATIONS })
```

## Adding a property to an existing entity

Start with the Zod model, then decide whether the property also needs a SQLite column.

| Property use | Required storage work |
| --- | --- |
| Optional and only read as part of the object | Add it to Zod and fixtures. Existing payloads remain valid; `json(object)` writes it automatically. No migration is normally needed. |
| Required in the new Zod schema | Add a migration that inserts a valid value into every old `payload_json` before the new repository reads it. |
| Filtered, sorted, grouped, or used for uniqueness | Add/backfill an extracted column, keep repository writes synchronized, and usually add an index or constraint. |
| A relationship to another entity | Add/backfill the ID column and foreign key. A table rebuild may be needed and is usually destructive. |

Then follow this checklist:

1. Update the entity's schema and inferred type in `src/domain/catalog/`. Add or update its ID
   schema in `ids.ts` if needed.
2. Update representative fixtures and domain-model tests. Decide how old payloads obtain a valid
   value; making a field required without a payload backfill will make repository reads fail.
3. If an extracted column is needed, add the next migration and backfill both the column and
   `payload_json` consistently.
4. Update every repository `INSERT`, `UPSERT`, or update touching that table. Serializing the full
   object updates `payload_json`, but extracted columns still need explicit bound values.
5. Add the read to `CatalogQueryService` when callers need a storage-backed filter or ordering.
   React and other consumers should not issue SQL directly.
6. Add an index matching the query's equality predicates and ordering, then assert its use with
   `EXPLAIN QUERY PLAN` at realistic scale.
7. Test round-trip parsing, old-to-new migration, write rollback, and query behavior.

Avoid adding an extracted column pre-emptively. JSON-only fields are appropriate when they are
always loaded with their owning record and do not participate in relationships or database-side
queries.

## Adding a new entity

A canonical entity crosses the domain, migration, repository, and test boundaries.

### Domain

1. Define its branded ID in `src/domain/catalog/ids.ts`.
2. Define and export its Zod schema and inferred type in the relevant domain module, or create a
   focused module when it is a new concept.
3. Add its collection to `catalogRecordsSchema` in `records.ts`.
4. Add uniqueness, reference, and cross-record rules to `validateCatalogInvariants` in
   `invariants.ts`.
5. Export its public schema/type from `src/domain/catalog/index.ts` and add representative fixtures.

### SQLite

Create the table in the next migration. A typical canonical table has:

- a text primary key containing the branded domain ID;
- extracted foreign-key and query columns;
- restrictive foreign keys unless the domain explicitly owns a safe cascade;
- `payload_json TEXT NOT NULL CHECK (json_valid(payload_json))`; and
- indexes matching known access patterns.

Do not add the new table to `INITIAL_SCHEMA_SQL`; version 1 is immutable. A new installation reaches
the same final schema by replaying versions 1, 2, and so on.

### Repository and queries

Update `CatalogRepository` in both directions:

- `read()` must load the new table's `payload_json` and pass the resulting collection to
  `catalogSchema.parse`.
- `insertCatalog()` must insert parents before children so immediate foreign keys succeed.
- `CATALOG_TABLES_IN_DELETE_ORDER` must delete children before parents.

If the entity has a different mutation boundary from the whole catalog, add a focused repository
instead of forcing callers to replace the aggregate. It must still validate Zod inputs and use one
transaction for each domain operation. Add domain-returning methods to `CatalogQueryService` for
indexed reads.

Add the entity to development inspection counts when seeing its population would be useful during
debugging.

### Tests

Add tests for:

- full catalog round-trip;
- duplicate IDs and invalid references at the domain boundary;
- SQLite foreign-key enforcement;
- parent/child insert and delete ordering;
- rollback of a partially completed domain operation;
- migration from the previous schema version; and
- bounded query plans for high-volume access paths.

## Inspecting and verifying changes

From `apps/mobile`, run:

```bash
bun run lint
bun run typecheck
bun run test
bun run build
```

After starting the app with `bun run dev`, inspect the live development database in the browser or
WebView console:

```js
await window.__wovenleafStorage.inspect()
```

For an extracted database file:

```bash
bun run storage:inspect -- /absolute/path/to/wovenleafSQLite.db
```

Check that `integrity` is `ok`, the schema version advanced once, the migration run completed, the
new table/count/index is visible, and the relevant query plan uses the expected index.

Use in-memory databases for migration tests. When a manual fresh-start check is genuinely needed,
remove only the development app's database through browser storage tools or by uninstalling the
development native app. That deletes local data and is not a migration test.

For platform-affecting changes, also run `bun run cap:sync` and compile both native projects before
merging.

## Review checklist

- Existing migrations are unchanged; the new version is contiguous.
- The migration kind reflects whether any information can be lost or reinterpreted.
- Required properties are backfilled in old JSON payloads.
- Extracted columns and `payload_json` are written atomically and agree.
- Foreign keys and insert/delete ordering match aggregate ownership.
- Every user-visible operation has a clear transaction boundary.
- Query columns have justified indexes and scale-tested query plans.
- Fresh install, upgrade, replay, and failure rollback are tested.
- Destructive changes prove that backup completion precedes `up`.
- Inspection output exposes any new state needed for diagnosis.
