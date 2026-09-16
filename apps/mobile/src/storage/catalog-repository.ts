import {
  contributorSchema,
  editionSchema,
  identifierSchema,
  integrationCheckpointSchema,
  listEntrySchema,
  listSchema,
  personSchema,
  catalogSchema,
  progressSnapshotSchema,
  readingEventSchema,
  readingLedgerSchema,
  sourceRecordSchema,
  workSchema,
  type Catalog,
  type IntegrationCheckpoint,
  type ProgressSnapshot,
  type ReadingEvent,
  type ReadingLedger,
} from '../domain/catalog'
import type { SqlDatabase, SqlValue } from './database'
import { readText } from './database'

export type ImportableCatalogEntityType =
  | 'work'
  | 'edition'
  | 'source-record'
  | 'identifier'
  | 'person'
  | 'contributor'
  | 'list'
  | 'list-entry'
  | 'integration-checkpoint'
  | 'reading-event'
  | 'progress-snapshot'

const IMPORTABLE_CATALOG_TABLES: Record<ImportableCatalogEntityType, string> = {
  work: 'works',
  edition: 'editions',
  'source-record': 'source_records',
  identifier: 'identifiers',
  person: 'people',
  contributor: 'contributors',
  list: 'lists',
  'list-entry': 'list_entries',
  'integration-checkpoint': 'integration_checkpoints',
  'reading-event': 'reading_events',
  'progress-snapshot': 'progress_snapshots',
}

const CATALOG_TABLES_IN_DELETE_ORDER = [
  'audiobook_playback_checkpoints',
  'audiobook_files',
  'audiobook_imports',
  'epub_reader_annotations',
  'epub_reader_navigation',
  'epub_reader_checkpoints',
  'epub_imports',
  'reading_event_references',
  'progress_snapshots',
  'reading_events',
  'integration_checkpoints',
  'list_entries',
  'lists',
  'access_grants',
  'ownerships',
  'loans',
  'identifier_source_records',
  'identifiers',
  'metadata_overrides',
  'contributors',
  'work_parts',
  'assets',
  'editions',
  'people',
  'source_records',
  'works',
] as const

export class CatalogRepository {
  readonly #database: SqlDatabase

  constructor(database: SqlDatabase) {
    this.#database = database
  }

  async read(): Promise<Catalog> {
    const [
      works,
      editions,
      assets,
      identifiers,
      sourceRecords,
      metadataOverrides,
      ownerships,
      loans,
      accessGrants,
      people,
      contributors,
      workParts,
      lists,
      listEntries,
      integrationCheckpoints,
      readingEvents,
      progressSnapshots,
    ] = await Promise.all([
      readPayloads(this.#database, 'works'),
      readPayloads(this.#database, 'editions'),
      readPayloads(this.#database, 'assets'),
      readPayloads(this.#database, 'identifiers'),
      readPayloads(this.#database, 'source_records'),
      readPayloads(this.#database, 'metadata_overrides'),
      readPayloads(this.#database, 'ownerships'),
      readPayloads(this.#database, 'loans'),
      readPayloads(this.#database, 'access_grants'),
      readPayloads(this.#database, 'people'),
      readPayloads(this.#database, 'contributors'),
      readPayloads(this.#database, 'work_parts'),
      readPayloads(this.#database, 'lists'),
      readPayloads(this.#database, 'list_entries'),
      readPayloads(this.#database, 'integration_checkpoints'),
      readPayloads(this.#database, 'reading_events'),
      readPayloads(this.#database, 'progress_snapshots'),
    ])

    return catalogSchema.parse({
      works,
      editions,
      assets,
      identifiers,
      sourceRecords,
      metadataOverrides,
      ownerships,
      loans,
      accessGrants,
      people,
      contributors,
      workParts,
      lists,
      listEntries,
      integrationCheckpoints,
      readingEvents,
      progressSnapshots,
    })
  }

  async replace(catalog: Catalog): Promise<void> {
    const validated = catalogSchema.parse(catalog)
    await this.#database.transaction(async (database) => {
      await deleteCatalogRecords(database)
      await insertCatalog(database, validated)
    })
  }
}

export async function deleteCatalogRecords(database: SqlDatabase): Promise<void> {
  for (const table of CATALOG_TABLES_IN_DELETE_ORDER) {
    await database.run(`DELETE FROM ${table}`)
  }
}

export async function insertCatalogRecords(
  database: SqlDatabase,
  catalog: Catalog,
): Promise<void> {
  await insertCatalog(database, catalogSchema.parse(catalog))
}

export async function readImportableCatalogEntity(
  database: SqlDatabase,
  type: ImportableCatalogEntityType,
  id: string,
): Promise<unknown | undefined> {
  const rows = await database.query(
    `SELECT payload_json FROM ${IMPORTABLE_CATALOG_TABLES[type]} WHERE id = ?`,
    [id],
  )
  return rows[0] ? JSON.parse(readText(rows[0], 'payload_json')) as unknown : undefined
}

/** Upserts one reviewed canonical import record while preserving the catalog's FK order. */
export async function upsertImportableCatalogEntity(
  database: SqlDatabase,
  type: ImportableCatalogEntityType,
  value: unknown,
  options: { readonly creating?: boolean } = {},
): Promise<void> {
  if (type === 'work') {
    const item = workSchema.parse(value)
    await database.run(
      `INSERT INTO works(id, kind, title_sort, created_at, updated_at, payload_json)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, title_sort=excluded.title_sort,
         created_at=excluded.created_at, updated_at=excluded.updated_at, payload_json=excluded.payload_json`,
      [item.id, item.kind, item.title.value, item.createdAt, item.updatedAt, json(item)],
    )
    return
  }
  if (type === 'source-record') {
    const item = sourceRecordSchema.parse(value)
    await database.run(
      `INSERT INTO source_records(id, source_kind, source_name, external_key, observed_at, imported_at, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET source_kind=excluded.source_kind, source_name=excluded.source_name,
         external_key=excluded.external_key, observed_at=excluded.observed_at,
         imported_at=excluded.imported_at, payload_json=excluded.payload_json`,
      [item.id, item.source.kind, item.source.name, item.externalKey, item.observedAt, item.importedAt, json(item)],
    )
    return
  }
  if (type === 'person') {
    const item = personSchema.parse(value)
    await database.run(
      `INSERT INTO people(id, display_name_sort, created_at, updated_at, payload_json)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET display_name_sort=excluded.display_name_sort,
         created_at=excluded.created_at, updated_at=excluded.updated_at, payload_json=excluded.payload_json`,
      [item.id, item.displayName.value, item.createdAt, item.updatedAt, json(item)],
    )
    return
  }
  if (type === 'edition') {
    const item = editionSchema.parse(value)
    await database.run(
      `INSERT INTO editions(id, work_id, medium, title_sort, cover_asset_id, created_at, updated_at, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET work_id=excluded.work_id, medium=excluded.medium,
         title_sort=excluded.title_sort, cover_asset_id=excluded.cover_asset_id,
         created_at=excluded.created_at, updated_at=excluded.updated_at, payload_json=excluded.payload_json`,
      [item.id, item.workId, item.medium, item.title.value, item.coverAssetId ?? null, item.createdAt, item.updatedAt, json(item)],
    )
    return
  }
  if (type === 'identifier') {
    const item = identifierSchema.parse(value)
    await database.run(
      `INSERT INTO identifiers(id, owner_type, owner_id, scheme, normalized_value, created_at, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET owner_type=excluded.owner_type, owner_id=excluded.owner_id,
         scheme=excluded.scheme, normalized_value=excluded.normalized_value,
         created_at=excluded.created_at, payload_json=excluded.payload_json`,
      [item.id, item.owner.type, item.owner.id, item.scheme, item.normalizedValue, item.createdAt, json(item)],
    )
    if (!options.creating) await database.run('DELETE FROM identifier_source_records WHERE identifier_id = ?', [item.id])
    for (const [position, sourceRecordId] of item.sourceRecordIds.entries()) {
      await database.run(
        'INSERT INTO identifier_source_records(identifier_id, source_record_id, position) VALUES (?, ?, ?)',
        [item.id, sourceRecordId, position],
      )
    }
    return
  }
  if (type === 'contributor') {
    const item = contributorSchema.parse(value)
    await database.run(
      `INSERT INTO contributors(id, person_id, target_type, target_id, role, position, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET person_id=excluded.person_id, target_type=excluded.target_type,
         target_id=excluded.target_id, role=excluded.role, position=excluded.position,
         payload_json=excluded.payload_json`,
      [item.id, item.personId, item.target.type, item.target.id, item.role, item.position, json(item)],
    )
    return
  }
  if (type === 'list') {
    const item = listSchema.parse(value)
    await database.run(
      `INSERT INTO lists(id, kind, slug, name, created_at, updated_at, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, slug=excluded.slug, name=excluded.name,
         created_at=excluded.created_at, updated_at=excluded.updated_at, payload_json=excluded.payload_json`,
      [item.id, item.kind, item.slug, item.name, item.createdAt, item.updatedAt, json(item)],
    )
    return
  }
  if (type === 'list-entry') {
    const item = listEntrySchema.parse(value)
    await database.run(
      `INSERT INTO list_entries(id, list_id, work_id, position, created_at, updated_at, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET list_id=excluded.list_id, work_id=excluded.work_id,
         position=excluded.position, created_at=excluded.created_at,
         updated_at=excluded.updated_at, payload_json=excluded.payload_json`,
      [item.id, item.listId, item.workId, item.position, item.createdAt, item.updatedAt, json(item)],
    )
    return
  }
  if (type === 'integration-checkpoint') {
    const item = integrationCheckpointSchema.parse(value)
    await database.run(
      `INSERT INTO integration_checkpoints(
         id, integration_key, direction, previous_checkpoint_id, device_id,
         observed_at, committed_at, payload_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET integration_key=excluded.integration_key,
         direction=excluded.direction, previous_checkpoint_id=excluded.previous_checkpoint_id,
         device_id=excluded.device_id, observed_at=excluded.observed_at,
         committed_at=excluded.committed_at, payload_json=excluded.payload_json`,
      [item.id, item.integrationKey, item.direction, item.previousCheckpointId ?? null, item.deviceId, item.observedAt, item.committedAt, json(item)],
    )
    return
  }
  if (type === 'reading-event') {
    const item = readingEventSchema.parse(value)
    await database.run(
      `INSERT INTO reading_events(
         id, edition_id, asset_id, integration_checkpoint_id, source_record_id,
         device_id, kind, session_id, effective_at, observed_at, recorded_at, payload_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET edition_id=excluded.edition_id, asset_id=excluded.asset_id,
         integration_checkpoint_id=excluded.integration_checkpoint_id,
         source_record_id=excluded.source_record_id, device_id=excluded.device_id,
         kind=excluded.kind, session_id=excluded.session_id, effective_at=excluded.effective_at,
         observed_at=excluded.observed_at, recorded_at=excluded.recorded_at,
         payload_json=excluded.payload_json`,
      [
        item.id,
        item.editionId,
        item.assetId ?? null,
        item.integrationCheckpointId ?? null,
        item.source.kind === 'integration' ? item.source.sourceRecordId ?? null : null,
        item.deviceId,
        item.kind,
        item.kind === 'session' ? item.sessionId : null,
        item.effectiveAt,
        item.observedAt,
        item.recordedAt,
        json(item),
      ],
    )
    if (!options.creating) await database.run('DELETE FROM reading_event_references WHERE event_id = ?', [item.id])
    await insertReadingEventReferences(database, item)
    return
  }
  const item = progressSnapshotSchema.parse(value)
  await insertProgressSnapshot(database, item)
}

export async function deleteImportableCatalogEntity(
  database: SqlDatabase,
  type: ImportableCatalogEntityType,
  id: string,
): Promise<boolean> {
  if (await catalogEntityHasDependents(database, type, id)) return false
  if (type === 'identifier') {
    await database.run('DELETE FROM identifier_source_records WHERE identifier_id = ?', [id])
  }
  if (type === 'reading-event') {
    await database.run('DELETE FROM reading_event_references WHERE event_id = ?', [id])
  }
  const result = await database.run(`DELETE FROM ${IMPORTABLE_CATALOG_TABLES[type]} WHERE id = ?`, [id])
  return result.changes > 0
}

async function catalogEntityHasDependents(
  database: SqlDatabase,
  type: ImportableCatalogEntityType,
  id: string,
): Promise<boolean> {
  const checks: Partial<Record<ImportableCatalogEntityType, readonly [string, string][]>> = {
    work: [
      ['editions', 'work_id'],
      ['list_entries', 'work_id'],
      ['contributors', 'target_id'],
    ],
    edition: [
      ['assets', 'edition_id'],
      ['identifiers', 'owner_id'],
      ['ownerships', 'edition_id'],
      ['loans', 'edition_id'],
      ['access_grants', 'edition_id'],
      ['reading_events', 'edition_id'],
      ['progress_snapshots', 'edition_id'],
    ],
    'source-record': [
      ['identifier_source_records', 'source_record_id'],
      ['assets', 'source_record_id'],
      ['ownerships', 'source_record_id'],
      ['loans', 'source_record_id'],
      ['access_grants', 'source_record_id'],
      ['reading_events', 'source_record_id'],
    ],
    person: [['contributors', 'person_id']],
    list: [['list_entries', 'list_id']],
    'integration-checkpoint': [
      ['integration_checkpoints', 'previous_checkpoint_id'],
      ['reading_events', 'integration_checkpoint_id'],
    ],
    'reading-event': [
      ['reading_event_references', 'referenced_event_id'],
      ['progress_snapshots', 'source_event_id'],
    ],
  }
  for (const [table, column] of checks[type] ?? []) {
    const rows = await database.query(`SELECT 1 AS found FROM ${table} WHERE ${column} = ? LIMIT 1`, [id])
    if (rows.length) return true
  }
  return false
}

export type ReadingLedgerBatch = {
  readonly integrationCheckpoints?: readonly IntegrationCheckpoint[]
  readonly events: readonly ReadingEvent[]
  readonly snapshots?: readonly ProgressSnapshot[]
}

export class ReadingLedgerRepository {
  readonly #database: SqlDatabase

  constructor(database: SqlDatabase) {
    this.#database = database
  }

  async read(): Promise<ReadingLedger> {
    return readReadingLedger(this.#database)
  }

  async append(batch: ReadingLedgerBatch): Promise<void> {
    await this.#database.transaction((database) => appendReadingLedgerBatch(database, batch))
  }
}

export async function appendReadingLedgerBatch(
  database: SqlDatabase,
  batch: ReadingLedgerBatch,
): Promise<void> {
  const checkpoints = batch.integrationCheckpoints ?? []
  const snapshots = (batch.snapshots ?? []).map((snapshot) => progressSnapshotSchema.parse(snapshot))
  const current = await readReadingLedger(database)
  const ledger = readingLedgerSchema.parse({
    integrationCheckpoints: [...current.integrationCheckpoints, ...checkpoints],
    events: [...current.events, ...batch.events],
  })
  const checkpointIds = new Set(checkpoints.map(({ id }) => id))
  const eventIds = new Set(batch.events.map(({ id }) => id))

  await validateAssetScopes(database, batch.events, snapshots)
  for (const checkpoint of ledger.integrationCheckpoints) {
    if (checkpointIds.has(checkpoint.id)) await insertCheckpoint(database, checkpoint)
  }
  for (const event of ledger.events) {
    if (!eventIds.has(event.id)) continue
    await insertReadingEvent(database, event)
  }
  for (const event of ledger.events) {
    if (!eventIds.has(event.id)) continue
    await insertReadingEventReferences(database, event)
  }
  for (const snapshot of snapshots) {
    await insertProgressSnapshot(database, snapshot)
  }
}

async function readReadingLedger(database: SqlDatabase): Promise<ReadingLedger> {
  return readingLedgerSchema.parse({
    integrationCheckpoints: await readPayloads(database, 'integration_checkpoints'),
    events: await readPayloads(database, 'reading_events'),
  })
}

async function insertCatalog(database: SqlDatabase, catalog: Catalog): Promise<void> {
  for (const work of catalog.works) {
    await database.run(
      `INSERT INTO works(id, kind, title_sort, created_at, updated_at, payload_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [work.id, work.kind, work.title.value, work.createdAt, work.updatedAt, json(work)],
    )
  }
  for (const source of catalog.sourceRecords) {
    await database.run(
      `INSERT INTO source_records(
         id, source_kind, source_name, external_key, observed_at, imported_at, payload_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        source.id,
        source.source.kind,
        source.source.name,
        source.externalKey,
        source.observedAt,
        source.importedAt,
        json(source),
      ],
    )
  }
  for (const person of catalog.people) {
    await database.run(
      `INSERT INTO people(id, display_name_sort, created_at, updated_at, payload_json)
       VALUES (?, ?, ?, ?, ?)`,
      [person.id, person.displayName.value, person.createdAt, person.updatedAt, json(person)],
    )
  }
  for (const edition of catalog.editions) {
    await database.run(
      `INSERT INTO editions(
         id, work_id, medium, title_sort, cover_asset_id, created_at, updated_at, payload_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        edition.id,
        edition.workId,
        edition.medium,
        edition.title.value,
        edition.coverAssetId ?? null,
        edition.createdAt,
        edition.updatedAt,
        json(edition),
      ],
    )
  }
  for (const asset of catalog.assets) {
    await database.run(
      `INSERT INTO assets(
         id, edition_id, role, format, source_record_id, created_at, payload_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        asset.id,
        asset.editionId,
        asset.role,
        asset.format,
        asset.location.kind === 'remote' ? asset.location.sourceRecordId : null,
        asset.createdAt,
        json(asset),
      ],
    )
  }
  for (const override of catalog.metadataOverrides) {
    await database.run(
      `INSERT INTO metadata_overrides(
         id, target_type, target_id, field, corrected_at, payload_json
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        override.id,
        override.target.type,
        override.target.id,
        override.field,
        override.correctedAt,
        json(override),
      ],
    )
  }
  for (const identifier of catalog.identifiers) {
    await database.run(
      `INSERT INTO identifiers(
         id, owner_type, owner_id, scheme, normalized_value, created_at, payload_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        identifier.id,
        identifier.owner.type,
        identifier.owner.id,
        identifier.scheme,
        identifier.normalizedValue,
        identifier.createdAt,
        json(identifier),
      ],
    )
    for (const [position, sourceRecordId] of identifier.sourceRecordIds.entries()) {
      await database.run(
        `INSERT INTO identifier_source_records(identifier_id, source_record_id, position)
         VALUES (?, ?, ?)`,
        [identifier.id, sourceRecordId, position],
      )
    }
  }
  for (const ownership of catalog.ownerships) {
    await database.run(
      `INSERT INTO ownerships(
         id, edition_id, acquired_at, disposed_at, source_record_id, payload_json
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        ownership.id,
        ownership.editionId,
        ownership.acquiredAt,
        ownership.disposedAt ?? null,
        ownership.sourceRecordId ?? null,
        json(ownership),
      ],
    )
  }
  for (const loan of catalog.loans) {
    await database.run(
      `INSERT INTO loans(
         id, edition_id, borrowed_at, due_at, returned_at, source_record_id, payload_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        loan.id,
        loan.editionId,
        loan.borrowedAt,
        loan.dueAt,
        loan.returnedAt ?? null,
        loan.sourceRecordId ?? null,
        json(loan),
      ],
    )
  }
  for (const grant of catalog.accessGrants) {
    await database.run(
      `INSERT INTO access_grants(
         id, edition_id, basis, ownership_id, loan_id, source_record_id, created_at, payload_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        grant.id,
        grant.editionId,
        grant.basis,
        grant.basis === 'ownership' ? grant.ownershipId : null,
        grant.basis === 'loan' ? grant.loanId : null,
        grant.basis === 'subscription' ? grant.sourceRecordId : null,
        grant.createdAt,
        json(grant),
      ],
    )
  }
  for (const contributor of catalog.contributors) {
    await database.run(
      `INSERT INTO contributors(
         id, person_id, target_type, target_id, role, position, payload_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        contributor.id,
        contributor.personId,
        contributor.target.type,
        contributor.target.id,
        contributor.role,
        contributor.position,
        json(contributor),
      ],
    )
  }
  for (const part of catalog.workParts) {
    await database.run(
      `INSERT INTO work_parts(id, container_work_id, work_id, position, payload_json)
       VALUES (?, ?, ?, ?, ?)`,
      [part.id, part.containerWorkId, part.workId, part.position, json(part)],
    )
  }
  for (const list of catalog.lists) {
    await database.run(
      `INSERT INTO lists(id, kind, slug, name, created_at, updated_at, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        list.id,
        list.kind,
        list.slug,
        list.name,
        list.createdAt,
        list.updatedAt,
        json(list),
      ],
    )
  }
  for (const entry of catalog.listEntries) {
    await database.run(
      `INSERT INTO list_entries(
         id, list_id, work_id, position, created_at, updated_at, payload_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.id,
        entry.listId,
        entry.workId,
        entry.position,
        entry.createdAt,
        entry.updatedAt,
        json(entry),
      ],
    )
  }
  for (const checkpoint of catalog.integrationCheckpoints) {
    await insertCheckpoint(database, checkpoint)
  }
  for (const event of catalog.readingEvents) {
    await insertReadingEvent(database, event)
  }
  for (const event of catalog.readingEvents) {
    await insertReadingEventReferences(database, event)
  }
  for (const snapshot of catalog.progressSnapshots) {
    await insertProgressSnapshot(database, snapshot)
  }
}

async function insertCheckpoint(
  database: SqlDatabase,
  checkpoint: IntegrationCheckpoint,
): Promise<void> {
  await database.run(
    `INSERT INTO integration_checkpoints(
       id, integration_key, direction, previous_checkpoint_id, device_id,
       observed_at, committed_at, payload_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      checkpoint.id,
      checkpoint.integrationKey,
      checkpoint.direction,
      checkpoint.previousCheckpointId ?? null,
      checkpoint.deviceId,
      checkpoint.observedAt,
      checkpoint.committedAt,
      json(checkpoint),
    ],
  )
}

async function insertReadingEvent(database: SqlDatabase, event: ReadingEvent): Promise<void> {
  await database.run(
    `INSERT INTO reading_events(
       id, edition_id, asset_id, integration_checkpoint_id, source_record_id,
       device_id, kind, session_id, effective_at, observed_at, recorded_at, payload_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      event.id,
      event.editionId,
      event.assetId ?? null,
      event.integrationCheckpointId ?? null,
      event.source.kind === 'integration' ? event.source.sourceRecordId ?? null : null,
      event.deviceId,
      event.kind,
      event.kind === 'session' ? event.sessionId : null,
      event.effectiveAt,
      event.observedAt,
      event.recordedAt,
      json(event),
    ],
  )
}

async function insertReadingEventReferences(
  database: SqlDatabase,
  event: ReadingEvent,
): Promise<void> {
  for (const [position, reference] of referencesFor(event).entries()) {
    await database.run(
      `INSERT INTO reading_event_references(
         event_id, referenced_event_id, reference_kind, position
       ) VALUES (?, ?, ?, ?)`,
      [event.id, reference.id, reference.kind, position],
    )
  }
}

async function insertProgressSnapshot(
  database: SqlDatabase,
  snapshot: ProgressSnapshot,
): Promise<void> {
  await database.run(
    `INSERT INTO progress_snapshots(
       id, edition_id, asset_id, source_event_id, status,
       normalized_progress, projected_at, payload_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       edition_id = excluded.edition_id,
       asset_id = excluded.asset_id,
       source_event_id = excluded.source_event_id,
       status = excluded.status,
       normalized_progress = excluded.normalized_progress,
       projected_at = excluded.projected_at,
       payload_json = excluded.payload_json`,
    [
      snapshot.id,
      snapshot.editionId,
      snapshot.assetId ?? null,
      snapshot.sourceEventId ?? null,
      snapshot.status,
      snapshot.normalizedProgress ?? null,
      snapshot.projectedAt,
      json(snapshot),
    ],
  )
}

function referencesFor(event: ReadingEvent): Array<{ readonly id: string; readonly kind: string }> {
  if (event.kind === 'import') {
    return event.importedEventIds.map((id) => ({ id, kind: 'import' }))
  }
  if (event.kind === 'sync') {
    return event.syncedEventIds.map((id) => ({ id, kind: 'sync' }))
  }
  if (event.kind === 'correction') {
    return event.targetEventIds.map((id) => ({ id, kind: 'correction' }))
  }
  return []
}

async function readPayloads(database: SqlDatabase, table: string): Promise<unknown[]> {
  const rows = await database.query(`SELECT payload_json FROM ${table} ORDER BY id`)
  return rows.map((row) => JSON.parse(readText(row, 'payload_json')) as unknown)
}

async function validateAssetScopes(
  database: SqlDatabase,
  events: readonly ReadingEvent[],
  snapshots: readonly ProgressSnapshot[],
): Promise<void> {
  const scopes = new Map<string, string>()
  for (const item of [...events, ...snapshots]) {
    if (!item.assetId) continue
    let editionId = scopes.get(item.assetId)
    if (!editionId) {
      const rows = await database.query('SELECT edition_id FROM assets WHERE id = ?', [item.assetId])
      editionId = rows[0] ? readText(rows[0], 'edition_id') : undefined
      if (editionId) scopes.set(item.assetId, editionId)
    }
    if (!editionId) throw new Error(`Missing Asset ${item.assetId}`)
    if (editionId !== item.editionId) {
      throw new Error(`Asset ${item.assetId} does not belong to Edition ${item.editionId}`)
    }
  }
}

function json(value: unknown): SqlValue {
  return JSON.stringify(value)
}
