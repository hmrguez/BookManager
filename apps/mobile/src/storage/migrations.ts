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
  {
    version: 2,
    name: 'legacy library checkpoints and canonical lists',
    kind: 'additive',
    signature: legacyLibraryMigrationSql(),
    async up(database) {
      await database.execute(legacyLibraryMigrationSql())
    },
  },
  {
    version: 3,
    name: 'durable import batches and change sets',
    kind: 'additive',
    signature: importPipelineSchemaSql(),
    async up(database) {
      await database.execute(importPipelineSchemaSql())
    },
  },
  {
    version: 4,
    name: 'custom shelves tags and ordered membership',
    kind: 'additive',
    signature: libraryOrganizationSchemaSql(),
    async up(database) {
      await database.execute(libraryOrganizationSchemaSql())
    },
  },
  {
    version: 5,
    name: 'duplicate decisions and reversible identity journal',
    kind: 'additive',
    signature: duplicateReviewSchemaSql(),
    async up(database) {
      await database.execute(duplicateReviewSchemaSql())
    },
  },
  {
    version: 6,
    name: 'explainable up next preferences and decisions',
    kind: 'additive',
    signature: upNextSchemaSql(),
    async up(database) {
      await database.execute(upNextSchemaSql())
    },
  },
  {
    version: 7,
    name: 'versioned smart lists and saved rules',
    kind: 'additive',
    signature: smartListSchemaSql(),
    async up(database) {
      await database.execute(smartListSchemaSql())
    },
  },
  {
    version: 8,
    name: 'durable metadata search cache',
    kind: 'additive',
    signature: metadataSearchCacheSchemaSql(),
    async up(database) {
      await database.execute(metadataSearchCacheSchemaSql())
    },
  },
  {
    version: 9,
    name: 'safe managed EPUB imports',
    kind: 'additive',
    signature: epubImportSchemaSql(),
    async up(database) {
      await database.execute(epubImportSchemaSql())
    },
  },
  {
    version: 10,
    name: 'normalized managed audiobook imports',
    kind: 'additive',
    signature: audiobookImportSchemaSql(),
    async up(database) {
      await database.execute(audiobookImportSchemaSql())
    },
  },
  {
    version: 11,
    name: 'durable native EPUB reader checkpoints',
    kind: 'additive',
    signature: epubReaderCheckpointSchemaSql(),
    async up(database) {
      await database.execute(epubReaderCheckpointSchemaSql())
    },
  },
  {
    version: 12,
    name: 'paper-aware EPUB reader preferences',
    kind: 'additive',
    signature: epubReaderPreferencesSchemaSql(),
    async up(database) {
      await database.execute(epubReaderPreferencesSchemaSql())
    },
  },
  {
    version: 13,
    name: 'durable audiobook progress checkpoints',
    kind: 'additive',
    signature: audiobookPlaybackCheckpointSchemaSql(),
    async up(database) {
      await database.execute(audiobookPlaybackCheckpointSchemaSql())
    },
  },
  {
    version: 14,
    name: 'portable EPUB navigation and bookmarks',
    kind: 'additive',
    signature: epubReaderNavigationSchemaSql(),
    async up(database) {
      await database.execute(epubReaderNavigationSchemaSql())
    },
  },
  {
    version: 15,
    name: 'audiobook listening controls and annotations',
    kind: 'additive',
    signature: audiobookListeningControlsSchemaSql(),
    async up(database) {
      await database.execute(audiobookListeningControlsSchemaSql())
    },
  },
  {
    version: 16,
    name: 'durable full-fidelity EPUB annotations',
    kind: 'additive',
    signature: epubReaderAnnotationSchemaSql(),
    async up(database) {
      await database.execute(epubReaderAnnotationSchemaSql())
    },
  },
  {
    version: 17,
    name: 'managed PDF imports alongside EPUBs',
    kind: 'additive',
    signature: pdfImportSchemaSql(),
    async up(database) {
      await database.execute(pdfImportSchemaSql())
    },
  },
  {
    version: 18,
    name: 'persistent original audiobook file references',
    kind: 'additive',
    signature: 'ALTER TABLE audiobook_files ADD COLUMN reference_id TEXT;',
    async up(database) { await database.execute('ALTER TABLE audiobook_files ADD COLUMN reference_id TEXT;') },
  },
]

// Preserve the historical table name so existing reader checkpoints and archives
// retain their identities. Rebuild only to widen the format constraint.
function pdfImportSchemaSql(): string {
  const create = epubImportSchemaSql()
    .replace('CREATE TABLE epub_imports', 'CREATE TABLE ebook_imports_next')
    .replace("('2', '3')", "('2', '3', 'pdf')")
    .split('CREATE INDEX')[0]
  return `${create}
INSERT INTO ebook_imports_next SELECT * FROM epub_imports;
DROP TABLE epub_imports;
ALTER TABLE ebook_imports_next RENAME TO epub_imports;
CREATE INDEX idx_epub_imports_package ON epub_imports(package_identifier, metadata_key, imported_at DESC, id);
CREATE INDEX idx_epub_imports_edition ON epub_imports(edition_id, imported_at DESC, id);
`
}

function epubReaderAnnotationSchemaSql(): string {
  return `
CREATE TABLE epub_reader_annotations (
  book_id TEXT PRIMARY KEY NOT NULL,
  edition_id TEXT NOT NULL,
  state_json TEXT NOT NULL CHECK (json_valid(state_json)),
  recorded_at TEXT NOT NULL,
  FOREIGN KEY (edition_id) REFERENCES editions(id) ON DELETE RESTRICT
);

CREATE INDEX idx_epub_reader_annotations_edition
  ON epub_reader_annotations(edition_id, recorded_at DESC, book_id);
`
}

function audiobookListeningControlsSchemaSql(): string {
  return `
CREATE TABLE audiobook_playback_preferences (
  scope TEXT NOT NULL CHECK (scope IN ('global', 'book')),
  book_id TEXT NOT NULL,
  preferences_json TEXT NOT NULL CHECK (json_valid(preferences_json)),
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (scope, book_id),
  CHECK (
    (scope = 'global' AND book_id = '')
    OR (scope = 'book' AND length(book_id) > 0)
  )
);

CREATE INDEX idx_audiobook_playback_preferences_book
  ON audiobook_playback_preferences(book_id, scope);

CREATE TABLE audiobook_annotations (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('bookmark', 'text-note', 'voice-note')),
  book_id TEXT NOT NULL,
  edition_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  queue_id TEXT NOT NULL,
  playback_session_id TEXT NOT NULL,
  snapshot_revision INTEGER NOT NULL CHECK (snapshot_revision >= 0),
  absolute_position_ms INTEGER NOT NULL CHECK (absolute_position_ms >= 0),
  chapter_id TEXT,
  note TEXT NOT NULL DEFAULT '',
  voice_relative_path TEXT,
  voice_duration_ms INTEGER CHECK (voice_duration_ms IS NULL OR voice_duration_ms >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (kind = 'voice-note' AND voice_relative_path IS NOT NULL AND length(voice_relative_path) > 0)
    OR (kind != 'voice-note' AND voice_relative_path IS NULL AND voice_duration_ms IS NULL)
  ),
  FOREIGN KEY (book_id) REFERENCES library_books(id) ON DELETE RESTRICT,
  FOREIGN KEY (edition_id) REFERENCES editions(id) ON DELETE RESTRICT,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE RESTRICT
);

CREATE INDEX idx_audiobook_annotations_book
  ON audiobook_annotations(book_id, absolute_position_ms, created_at, id);
CREATE INDEX idx_audiobook_annotations_asset
  ON audiobook_annotations(asset_id, absolute_position_ms, id);
`
}

function epubReaderNavigationSchemaSql(): string {
  return `
CREATE TABLE epub_reader_navigation (
  book_id TEXT PRIMARY KEY NOT NULL,
  edition_id TEXT NOT NULL,
  state_json TEXT NOT NULL CHECK (json_valid(state_json)),
  recorded_at TEXT NOT NULL,
  FOREIGN KEY (edition_id) REFERENCES editions(id) ON DELETE RESTRICT
);

CREATE INDEX idx_epub_reader_navigation_edition
  ON epub_reader_navigation(edition_id, recorded_at DESC, book_id);
`
}

function audiobookPlaybackCheckpointSchemaSql(): string {
  return `
CREATE TABLE audiobook_playback_checkpoints (
  playback_session_id TEXT PRIMARY KEY NOT NULL,
  engine_epoch TEXT NOT NULL,
  queue_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  edition_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  last_sequence INTEGER NOT NULL CHECK (last_sequence >= 0),
  last_revision INTEGER NOT NULL CHECK (last_revision >= 0),
  absolute_position_ms INTEGER NOT NULL CHECK (absolute_position_ms >= 0),
  chapter_id TEXT,
  segment_id TEXT,
  active_duration_ms INTEGER NOT NULL CHECK (active_duration_ms >= 0),
  rate REAL NOT NULL CHECK (rate > 0),
  transport_state TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  interval_started_at TEXT,
  interval_start_position_ms INTEGER CHECK (interval_start_position_ms >= 0),
  interval_start_chapter_id TEXT,
  interval_start_active_duration_ms INTEGER CHECK (interval_start_active_duration_ms >= 0),
  FOREIGN KEY (edition_id) REFERENCES editions(id) ON DELETE RESTRICT,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE RESTRICT
);

CREATE INDEX idx_audiobook_playback_checkpoints_book
  ON audiobook_playback_checkpoints(book_id, observed_at DESC, playback_session_id);
CREATE INDEX idx_audiobook_playback_checkpoints_edition
  ON audiobook_playback_checkpoints(edition_id, observed_at DESC, playback_session_id);
CREATE INDEX idx_audiobook_playback_checkpoints_queue
  ON audiobook_playback_checkpoints(queue_id, observed_at DESC, playback_session_id);
`
}

function epubReaderPreferencesSchemaSql(): string {
  return `
CREATE TABLE epub_reader_preferences (
  scope TEXT NOT NULL CHECK (scope IN ('global', 'book')),
  book_id TEXT NOT NULL,
  preferences_json TEXT NOT NULL CHECK (json_valid(preferences_json)),
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (scope, book_id),
  CHECK (
    (scope = 'global' AND book_id = '')
    OR (scope = 'book' AND length(book_id) > 0)
  )
);

CREATE INDEX idx_epub_reader_preferences_book
  ON epub_reader_preferences(book_id, scope);
`
}

function epubReaderCheckpointSchemaSql(): string {
  return `
CREATE TABLE epub_reader_checkpoints (
  asset_id TEXT PRIMARY KEY NOT NULL,
  book_id TEXT NOT NULL,
  edition_id TEXT NOT NULL,
  asset_fingerprint TEXT NOT NULL CHECK (length(asset_fingerprint) = 64),
  last_sequence INTEGER NOT NULL CHECK (last_sequence >= 0),
  locator_json TEXT CHECK (locator_json IS NULL OR json_valid(locator_json)),
  total_progression REAL CHECK (total_progression IS NULL OR total_progression BETWEEN 0 AND 1),
  chapter_href TEXT,
  chapter_title TEXT,
  recorded_at TEXT NOT NULL,
  FOREIGN KEY (edition_id) REFERENCES editions(id) ON DELETE RESTRICT,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE RESTRICT
);

CREATE INDEX idx_epub_reader_checkpoints_book
  ON epub_reader_checkpoints(book_id, recorded_at DESC, asset_id);
`
}

function audiobookImportSchemaSql(): string {
  return `
CREATE TABLE audiobook_imports (
  id TEXT PRIMARY KEY NOT NULL,
  fingerprint TEXT NOT NULL UNIQUE CHECK (length(fingerprint) = 64),
  source_set_fingerprint TEXT NOT NULL CHECK (length(source_set_fingerprint) = 64),
  metadata_key TEXT NOT NULL,
  title TEXT NOT NULL,
  book_id TEXT NOT NULL,
  edition_id TEXT NOT NULL,
  content_asset_id TEXT NOT NULL UNIQUE,
  cover_asset_id TEXT,
  source_record_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('imported', 'revision')),
  imported_at TEXT NOT NULL,
  manifest_json TEXT NOT NULL CHECK (json_valid(manifest_json)),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  FOREIGN KEY (edition_id) REFERENCES editions(id) ON DELETE RESTRICT,
  FOREIGN KEY (content_asset_id) REFERENCES assets(id) ON DELETE RESTRICT,
  FOREIGN KEY (cover_asset_id) REFERENCES assets(id) ON DELETE RESTRICT,
  FOREIGN KEY (source_record_id) REFERENCES source_records(id) ON DELETE RESTRICT
);

CREATE INDEX idx_audiobook_imports_identity
  ON audiobook_imports(source_set_fingerprint, metadata_key, imported_at DESC, id);
CREATE INDEX idx_audiobook_imports_edition
  ON audiobook_imports(edition_id, imported_at DESC, id);

CREATE TABLE audiobook_files (
  capability_id TEXT PRIMARY KEY NOT NULL,
  import_id TEXT NOT NULL,
  segment_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  relative_path TEXT NOT NULL,
  fingerprint TEXT NOT NULL CHECK (length(fingerprint) = 64),
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  media_type TEXT NOT NULL,
  FOREIGN KEY (import_id) REFERENCES audiobook_imports(id) ON DELETE RESTRICT,
  UNIQUE(import_id, segment_id),
  UNIQUE(import_id, position)
);

CREATE INDEX idx_audiobook_files_import
  ON audiobook_files(import_id, position, capability_id);
`
}

function epubImportSchemaSql(): string {
  return `
CREATE TABLE epub_imports (
  id TEXT PRIMARY KEY NOT NULL,
  content_hash TEXT NOT NULL UNIQUE CHECK (length(content_hash) = 64),
  package_identifier TEXT NOT NULL,
  metadata_key TEXT NOT NULL,
  package_version TEXT NOT NULL CHECK (package_version IN ('2', '3')),
  original_name TEXT NOT NULL,
  book_id TEXT NOT NULL,
  edition_id TEXT NOT NULL,
  content_asset_id TEXT NOT NULL UNIQUE,
  cover_asset_id TEXT,
  source_record_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('imported', 'revision')),
  imported_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  FOREIGN KEY (edition_id) REFERENCES editions(id) ON DELETE RESTRICT,
  FOREIGN KEY (content_asset_id) REFERENCES assets(id) ON DELETE RESTRICT,
  FOREIGN KEY (cover_asset_id) REFERENCES assets(id) ON DELETE RESTRICT,
  FOREIGN KEY (source_record_id) REFERENCES source_records(id) ON DELETE RESTRICT
);

CREATE INDEX idx_epub_imports_package
  ON epub_imports(package_identifier, metadata_key, imported_at DESC, id);
CREATE INDEX idx_epub_imports_edition
  ON epub_imports(edition_id, imported_at DESC, id);
`
}

function metadataSearchCacheSchemaSql(): string {
  return `
CREATE TABLE metadata_search_cache (
  provider TEXT NOT NULL CHECK (provider IN ('open-library', 'google-books')),
  query_key TEXT NOT NULL,
  locale TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  PRIMARY KEY (provider, query_key)
);

CREATE INDEX idx_metadata_search_cache_expiry
  ON metadata_search_cache(expires_at, provider, query_key);
`
}

function smartListSchemaSql(): string {
  return `
CREATE TABLE smart_lists (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  pinned INTEGER NOT NULL CHECK (pinned IN (0, 1)),
  archived INTEGER NOT NULL CHECK (archived IN (0, 1)),
  position INTEGER NOT NULL CHECK (position >= 0),
  rule_schema_version INTEGER NOT NULL CHECK (rule_schema_version >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  definition_json TEXT NOT NULL CHECK (json_valid(definition_json)),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
);

CREATE INDEX idx_smart_lists_visible
  ON smart_lists(archived, pinned DESC, position, name, id);
CREATE INDEX idx_smart_lists_schema
  ON smart_lists(rule_schema_version, updated_at DESC, id);
`
}

function upNextSchemaSql(): string {
  return `
CREATE TABLE up_next_state (
  id TEXT PRIMARY KEY NOT NULL CHECK (id = 'primary'),
  updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
);
`
}

function duplicateReviewSchemaSql(): string {
  return `
CREATE TABLE duplicate_pair_decisions (
  id TEXT PRIMARY KEY NOT NULL,
  pair_key TEXT NOT NULL,
  left_work_id TEXT NOT NULL,
  right_work_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('merge', 'keep-separate', 'relate', 'never-suggest')),
  survivor_work_id TEXT,
  operation_id TEXT,
  decided_at TEXT NOT NULL,
  undone_at TEXT,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
);

CREATE INDEX idx_duplicate_pair_decisions_active
  ON duplicate_pair_decisions(pair_key, undone_at, decided_at DESC, id);
CREATE INDEX idx_duplicate_pair_decisions_operation
  ON duplicate_pair_decisions(operation_id, id)
  WHERE operation_id IS NOT NULL;

CREATE TABLE identity_operations (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('merge-works', 'split-work', 'reassign-edition')),
  from_work_id TEXT NOT NULL,
  to_work_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('applied', 'undone')),
  recorded_at TEXT NOT NULL,
  undone_at TEXT,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
);

CREATE INDEX idx_identity_operations_history
  ON identity_operations(recorded_at DESC, id);
CREATE INDEX idx_identity_operations_works
  ON identity_operations(from_work_id, to_work_id, status, id);
`
}

function libraryOrganizationSchemaSql(): string {
  return `
CREATE TABLE custom_shelves (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  pinned INTEGER NOT NULL CHECK (pinned IN (0, 1)),
  archived INTEGER NOT NULL CHECK (archived IN (0, 1)),
  position INTEGER NOT NULL CHECK (position >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
);

CREATE INDEX idx_custom_shelves_visible
  ON custom_shelves(archived, pinned DESC, position, id);

CREATE TABLE custom_shelf_entries (
  id TEXT PRIMARY KEY NOT NULL,
  shelf_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  FOREIGN KEY (shelf_id) REFERENCES custom_shelves(id) ON DELETE RESTRICT,
  UNIQUE(shelf_id, book_id),
  UNIQUE(shelf_id, position)
);

CREATE INDEX idx_custom_shelf_entries_order
  ON custom_shelf_entries(shelf_id, position, id);
CREATE INDEX idx_custom_shelf_entries_book
  ON custom_shelf_entries(book_id, shelf_id, id);

CREATE TABLE organization_tags (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
);

CREATE INDEX idx_organization_tags_name
  ON organization_tags(normalized_name, id);

CREATE TABLE library_book_tags (
  tag_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  PRIMARY KEY (tag_id, book_id),
  FOREIGN KEY (tag_id) REFERENCES organization_tags(id) ON DELETE RESTRICT
);

CREATE INDEX idx_library_book_tags_book
  ON library_book_tags(book_id, tag_id);
`
}

function importPipelineSchemaSql(): string {
  return `
CREATE TABLE import_batches (
  id TEXT PRIMARY KEY NOT NULL,
  source_key TEXT NOT NULL,
  parser_id TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  file_name TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('review', 'committed', 'undone')),
  created_at TEXT NOT NULL,
  committed_at TEXT,
  undone_at TEXT,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
);

CREATE INDEX idx_import_batches_history
  ON import_batches(created_at DESC, id);
CREATE INDEX idx_import_batches_source
  ON import_batches(source_key, status, created_at DESC, id);

CREATE TABLE import_rows (
  id TEXT PRIMARY KEY NOT NULL,
  batch_id TEXT NOT NULL,
  row_number INTEGER NOT NULL,
  external_key TEXT,
  row_hash TEXT NOT NULL,
  proposal_kind TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (
    decision IN ('proposed', 'included', 'excluded', 'skipped', 'duplicate', 'error')
  ),
  target_id TEXT,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  UNIQUE(batch_id, row_number),
  FOREIGN KEY (batch_id) REFERENCES import_batches(id) ON DELETE RESTRICT
);

CREATE INDEX idx_import_rows_batch
  ON import_rows(batch_id, row_number, id);

CREATE TABLE import_changes (
  id TEXT PRIMARY KEY NOT NULL,
  batch_id TEXT NOT NULL,
  row_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  field TEXT NOT NULL,
  before_json TEXT NOT NULL CHECK (json_valid(before_json)),
  after_json TEXT NOT NULL CHECK (json_valid(after_json)),
  reason TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  undo_status TEXT NOT NULL DEFAULT 'pending' CHECK (
    undo_status IN ('pending', 'restored', 'preserved')
  ),
  undone_at TEXT,
  UNIQUE(batch_id, sequence),
  FOREIGN KEY (batch_id) REFERENCES import_batches(id) ON DELETE RESTRICT,
  FOREIGN KEY (row_id) REFERENCES import_rows(id) ON DELETE RESTRICT
);

CREATE INDEX idx_import_changes_batch
  ON import_changes(batch_id, sequence DESC);
CREATE INDEX idx_import_changes_entity
  ON import_changes(entity_type, entity_id, applied_at, id);

CREATE TABLE import_checkpoints (
  id TEXT PRIMARY KEY NOT NULL,
  batch_id TEXT NOT NULL UNIQUE,
  source_key TEXT NOT NULL,
  previous_checkpoint_id TEXT,
  content_hash TEXT NOT NULL,
  committed_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  FOREIGN KEY (batch_id) REFERENCES import_batches(id) ON DELETE RESTRICT,
  FOREIGN KEY (previous_checkpoint_id) REFERENCES import_checkpoints(id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX idx_import_checkpoints_chain
  ON import_checkpoints(source_key, committed_at, id);

CREATE TABLE import_row_receipts (
  id TEXT PRIMARY KEY NOT NULL,
  source_key TEXT NOT NULL,
  external_key TEXT NOT NULL,
  row_hash TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  row_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(source_key, external_key, row_hash),
  FOREIGN KEY (batch_id) REFERENCES import_batches(id) ON DELETE RESTRICT,
  FOREIGN KEY (row_id) REFERENCES import_rows(id) ON DELETE RESTRICT
);

CREATE INDEX idx_import_row_receipts_batch
  ON import_row_receipts(batch_id, row_id);
`
}

function legacyLibraryMigrationSql(): string {
  return `
CREATE TABLE lists (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('system', 'custom')),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
);

CREATE INDEX idx_lists_kind
  ON lists(kind, name, id);

CREATE TABLE list_entries (
  id TEXT PRIMARY KEY NOT NULL,
  list_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE RESTRICT,
  FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE RESTRICT,
  UNIQUE(list_id, work_id),
  UNIQUE(list_id, position)
);

CREATE INDEX idx_list_entries_work
  ON list_entries(work_id, list_id, id);

CREATE TABLE legacy_library_migrations (
  migration_key TEXT PRIMARY KEY NOT NULL,
  source_key TEXT NOT NULL,
  source_checksum TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started', 'verified', 'completed', 'failed')),
  source_count INTEGER,
  imported_count INTEGER NOT NULL DEFAULT 0,
  recovery_payload TEXT NOT NULL CHECK (json_valid(recovery_payload)),
  started_at TEXT NOT NULL,
  verified_at TEXT,
  completed_at TEXT,
  error TEXT
);

CREATE INDEX idx_legacy_library_migrations_status
  ON legacy_library_migrations(status, started_at DESC);
`
}

const BUSY_TIMEOUT_SQL = 'PRAGMA busy_timeout = 5000'

const MIGRATION_INFRASTRUCTURE_SQL = `
PRAGMA foreign_keys = ON;

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
  await database.query(BUSY_TIMEOUT_SQL)
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
