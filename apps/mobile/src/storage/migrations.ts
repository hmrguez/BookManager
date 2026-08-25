import type { SqlDatabase, SqlRow } from './database'
import { readNumber, readText } from './database'

export type MigrationKind = 'additive' | 'destructive'

export type StorageMigration = {
  readonly version: number
  readonly name: string
  readonly kind: MigrationKind
  readonly signature: string
  up(database: SqlDatabase): Promise<void>
}

export type MigrationEvent =
  | { readonly type: 'started'; readonly version: number; readonly name: string }
  | {
      readonly type: 'backup-created'
      readonly version: number
      readonly name: string
      readonly backupKey: string
    }
  | {
      readonly type: 'completed'
      readonly version: number
      readonly name: string
      readonly durationMs: number
    }
  | {
      readonly type: 'failed'
      readonly version: number
      readonly name: string
      readonly error: string
    }
  | { readonly type: 'skipped'; readonly version: number; readonly name: string }

export interface MigrationBackupStore {
  save(key: string, snapshot: string): Promise<string>
}

export type MigrationRunnerOptions = {
  readonly migrations?: readonly StorageMigration[]
  readonly backupStore?: MigrationBackupStore
  readonly observe?: (event: MigrationEvent) => void
  readonly now?: () => Date
  readonly monotonicNow?: () => number
}

const INITIAL_SCHEMA_SQL = `
CREATE TABLE works (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  title_sort TEXT NOT NULL COLLATE NOCASE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
);

CREATE INDEX idx_works_updated_at
  ON works(updated_at DESC, id);
CREATE INDEX idx_works_title
  ON works(title_sort, id);

CREATE TABLE source_records (
  id TEXT PRIMARY KEY NOT NULL,
  source_kind TEXT NOT NULL,
  source_name TEXT NOT NULL,
  external_key TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  UNIQUE(source_kind, source_name, external_key)
);

CREATE TABLE people (
  id TEXT PRIMARY KEY NOT NULL,
  display_name_sort TEXT NOT NULL COLLATE NOCASE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
);

CREATE INDEX idx_people_display_name
  ON people(display_name_sort, id);

CREATE TABLE editions (
  id TEXT PRIMARY KEY NOT NULL,
  work_id TEXT NOT NULL,
  medium TEXT NOT NULL,
  title_sort TEXT NOT NULL COLLATE NOCASE,
  cover_asset_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE RESTRICT,
  FOREIGN KEY (cover_asset_id) REFERENCES assets(id) ON DELETE NO ACTION
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX idx_editions_work
  ON editions(work_id, medium, id);

CREATE TABLE assets (
  id TEXT PRIMARY KEY NOT NULL,
  edition_id TEXT NOT NULL,
  role TEXT NOT NULL,
  format TEXT NOT NULL,
  source_record_id TEXT,
  created_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  FOREIGN KEY (edition_id) REFERENCES editions(id) ON DELETE RESTRICT,
  FOREIGN KEY (source_record_id) REFERENCES source_records(id) ON DELETE RESTRICT
);

CREATE INDEX idx_assets_edition
  ON assets(edition_id, role, format, id);

CREATE TABLE metadata_overrides (
  id TEXT PRIMARY KEY NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  field TEXT NOT NULL,
  corrected_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  UNIQUE(target_type, target_id, field)
);

CREATE INDEX idx_metadata_overrides_target
  ON metadata_overrides(target_type, target_id, field);

CREATE TABLE identifiers (
  id TEXT PRIMARY KEY NOT NULL,
  owner_type TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  scheme TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  created_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  UNIQUE(owner_type, owner_id, scheme, normalized_value)
);

CREATE INDEX idx_identifiers_lookup
  ON identifiers(scheme, normalized_value, owner_type, owner_id);

CREATE TABLE identifier_source_records (
  identifier_id TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (identifier_id, source_record_id),
  FOREIGN KEY (identifier_id) REFERENCES identifiers(id) ON DELETE RESTRICT,
  FOREIGN KEY (source_record_id) REFERENCES source_records(id) ON DELETE RESTRICT
);

CREATE TABLE ownerships (
  id TEXT PRIMARY KEY NOT NULL,
  edition_id TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  disposed_at TEXT,
  source_record_id TEXT,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  FOREIGN KEY (edition_id) REFERENCES editions(id) ON DELETE RESTRICT,
  FOREIGN KEY (source_record_id) REFERENCES source_records(id) ON DELETE RESTRICT
);

CREATE INDEX idx_ownerships_edition
  ON ownerships(edition_id, acquired_at DESC, id);

CREATE TABLE loans (
  id TEXT PRIMARY KEY NOT NULL,
  edition_id TEXT NOT NULL,
  borrowed_at TEXT NOT NULL,
  due_at TEXT NOT NULL,
  returned_at TEXT,
  source_record_id TEXT,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  FOREIGN KEY (edition_id) REFERENCES editions(id) ON DELETE RESTRICT,
  FOREIGN KEY (source_record_id) REFERENCES source_records(id) ON DELETE RESTRICT
);

CREATE INDEX idx_loans_edition_due
  ON loans(edition_id, due_at DESC, id);

CREATE TABLE access_grants (
  id TEXT PRIMARY KEY NOT NULL,
  edition_id TEXT NOT NULL,
  basis TEXT NOT NULL,
  ownership_id TEXT,
  loan_id TEXT,
  source_record_id TEXT,
  created_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  FOREIGN KEY (edition_id) REFERENCES editions(id) ON DELETE RESTRICT,
  FOREIGN KEY (ownership_id) REFERENCES ownerships(id) ON DELETE RESTRICT,
  FOREIGN KEY (loan_id) REFERENCES loans(id) ON DELETE RESTRICT,
  FOREIGN KEY (source_record_id) REFERENCES source_records(id) ON DELETE RESTRICT
);

CREATE INDEX idx_access_grants_edition
  ON access_grants(edition_id, basis, id);

CREATE TABLE contributors (
  id TEXT PRIMARY KEY NOT NULL,
  person_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  role TEXT NOT NULL,
  position INTEGER NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE RESTRICT,
  UNIQUE(target_type, target_id, role, position, id)
);

CREATE INDEX idx_contributors_target
  ON contributors(target_type, target_id, position, id);
CREATE INDEX idx_contributors_person
  ON contributors(person_id, id);

CREATE TABLE work_parts (
  id TEXT PRIMARY KEY NOT NULL,
  container_work_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  FOREIGN KEY (container_work_id) REFERENCES works(id) ON DELETE RESTRICT,
  FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE RESTRICT,
  UNIQUE(container_work_id, position, id)
);

CREATE INDEX idx_work_parts_container
  ON work_parts(container_work_id, position, id);

CREATE TABLE integration_checkpoints (
  id TEXT PRIMARY KEY NOT NULL,
  integration_key TEXT NOT NULL,
  direction TEXT NOT NULL,
  previous_checkpoint_id TEXT,
  device_id TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  committed_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  FOREIGN KEY (previous_checkpoint_id) REFERENCES integration_checkpoints(id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX idx_integration_checkpoints_chain
  ON integration_checkpoints(integration_key, direction, committed_at, id);

CREATE TABLE reading_events (
  id TEXT PRIMARY KEY NOT NULL,
  edition_id TEXT NOT NULL,
  asset_id TEXT,
  integration_checkpoint_id TEXT,
  source_record_id TEXT,
  device_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  session_id TEXT,
  effective_at TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  FOREIGN KEY (edition_id) REFERENCES editions(id) ON DELETE RESTRICT,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE RESTRICT,
  FOREIGN KEY (integration_checkpoint_id) REFERENCES integration_checkpoints(id) ON DELETE RESTRICT,
  FOREIGN KEY (source_record_id) REFERENCES source_records(id) ON DELETE RESTRICT
);

CREATE INDEX idx_reading_events_edition_timeline
  ON reading_events(edition_id, effective_at, observed_at, recorded_at, id);
CREATE INDEX idx_reading_events_recorded
  ON reading_events(recorded_at, id);
CREATE INDEX idx_reading_events_sessions_timeline
  ON reading_events(edition_id, effective_at, observed_at, recorded_at, id)
  WHERE kind = 'session';
CREATE UNIQUE INDEX idx_reading_events_session_id
  ON reading_events(session_id)
  WHERE session_id IS NOT NULL;

CREATE TABLE reading_event_references (
  event_id TEXT NOT NULL,
  referenced_event_id TEXT NOT NULL,
  reference_kind TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (event_id, referenced_event_id, reference_kind),
  FOREIGN KEY (event_id) REFERENCES reading_events(id) ON DELETE RESTRICT,
  FOREIGN KEY (referenced_event_id) REFERENCES reading_events(id) ON DELETE RESTRICT
);

CREATE INDEX idx_reading_event_references_target
  ON reading_event_references(referenced_event_id, reference_kind, event_id);

CREATE TABLE progress_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  edition_id TEXT NOT NULL,
  asset_id TEXT,
  source_event_id TEXT,
  status TEXT NOT NULL,
  normalized_progress REAL,
  projected_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  FOREIGN KEY (edition_id) REFERENCES editions(id) ON DELETE RESTRICT,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE RESTRICT,
  FOREIGN KEY (source_event_id) REFERENCES reading_events(id) ON DELETE RESTRICT
);

CREATE INDEX idx_progress_snapshots_edition
  ON progress_snapshots(edition_id, projected_at DESC, id);

CREATE TABLE library_books (
  id TEXT PRIMARY KEY NOT NULL,
  position INTEGER NOT NULL,
  shelf TEXT NOT NULL,
  title_sort TEXT NOT NULL COLLATE NOCASE,
  added_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
);

CREATE INDEX idx_library_books_shelf
  ON library_books(shelf, position, id);
CREATE INDEX idx_library_books_title
  ON library_books(title_sort, id);
CREATE INDEX idx_library_books_position
  ON library_books(position, id);
`

export const STORAGE_MIGRATIONS: readonly StorageMigration[] = [
  {
    version: 1,
    name: 'canonical catalog and reading ledger',
    kind: 'additive',
    signature: INITIAL_SCHEMA_SQL,
    async up(database) {
      await database.execute(INITIAL_SCHEMA_SQL)
    },
  },
]

const MIGRATION_INFRASTRUCTURE_SQL = `
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS migration_runs (
  id TEXT PRIMARY KEY NOT NULL,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER,
  backup_key TEXT,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_migration_runs_version
  ON migration_runs(version, started_at DESC);
`

type AppliedMigrationRow = SqlRow & {
  readonly version: number
  readonly name: string
  readonly checksum: string
}

export async function migrateStorage(
  database: SqlDatabase,
  options: MigrationRunnerOptions = {},
): Promise<void> {
  const migrations = options.migrations ?? STORAGE_MIGRATIONS
  validateMigrationSequence(migrations)
  await database.execute(MIGRATION_INFRASTRUCTURE_SQL)
  await database.persist()

  const appliedRows = await database.query<AppliedMigrationRow>(
    'SELECT version, name, checksum FROM schema_migrations ORDER BY version',
  )
  const applied = new Map(appliedRows.map((row) => [readNumber(row, 'version'), row]))
  const now = options.now ?? (() => new Date())
  const monotonicNow = options.monotonicNow ?? (() => performance.now())

  for (const migration of migrations) {
    const checksum = checksumFor(migration.signature)
    const previous = applied.get(migration.version)
    if (previous) {
      if (readText(previous, 'name') !== migration.name || readText(previous, 'checksum') !== checksum) {
        throw new Error(`Applied migration ${migration.version} no longer matches its source`)
      }
      options.observe?.({ type: 'skipped', version: migration.version, name: migration.name })
      continue
    }

    const runId = `migration-run:${migration.version}:${crypto.randomUUID()}`
    const startedAt = now().toISOString()
    const started = monotonicNow()
    options.observe?.({ type: 'started', version: migration.version, name: migration.name })
    await database.run(
      `INSERT INTO migration_runs(id, version, name, status, started_at)
       VALUES (?, ?, ?, 'started', ?)`,
      [runId, migration.version, migration.name, startedAt],
    )
    await database.persist()

    let backupKey: string | undefined
    try {
      if (migration.kind === 'destructive') {
        if (!options.backupStore) {
          throw new Error(`Destructive migration ${migration.version} requires a backup store`)
        }
        const requestedKey = `wovenleaf-v${migration.version - 1}-before-v${migration.version}-${startedAt}`
        backupKey = await options.backupStore.save(requestedKey, await database.exportSnapshot())
        await database.run('UPDATE migration_runs SET backup_key = ? WHERE id = ?', [backupKey, runId])
        await database.persist()
        options.observe?.({
          type: 'backup-created',
          version: migration.version,
          name: migration.name,
          backupKey,
        })
      }

      await database.transaction(async (transaction) => {
        await migration.up(transaction)
        const durationMs = Math.max(0, Math.round(monotonicNow() - started))
        await transaction.run(
          `INSERT INTO schema_migrations(version, name, checksum, applied_at, duration_ms)
           VALUES (?, ?, ?, ?, ?)`,
          [migration.version, migration.name, checksum, now().toISOString(), durationMs],
        )
      })

      const durationMs = Math.max(0, Math.round(monotonicNow() - started))
      await database.run(
        `UPDATE migration_runs
         SET status = 'completed', finished_at = ?, duration_ms = ?
         WHERE id = ?`,
        [now().toISOString(), durationMs, runId],
      )
      await database.persist()
      options.observe?.({
        type: 'completed',
        version: migration.version,
        name: migration.name,
        durationMs,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const durationMs = Math.max(0, Math.round(monotonicNow() - started))
      await database.run(
        `UPDATE migration_runs
         SET status = 'failed', finished_at = ?, duration_ms = ?, backup_key = ?, error = ?
         WHERE id = ?`,
        [now().toISOString(), durationMs, backupKey ?? null, message, runId],
      )
      await database.persist()
      options.observe?.({
        type: 'failed',
        version: migration.version,
        name: migration.name,
        error: message,
      })
      throw error
    }
  }
}

function validateMigrationSequence(migrations: readonly StorageMigration[]): void {
  migrations.forEach((migration, index) => {
    const expectedVersion = index + 1
    if (migration.version !== expectedVersion) {
      throw new Error(`Storage migration versions must be contiguous; expected ${expectedVersion}`)
    }
  })
}

function checksumFor(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
