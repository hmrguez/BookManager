import {
  accessGrantIdSchema,
  accessGrantSchema,
  assetIdSchema,
  assetSchema,
  contributorIdSchema,
  contributorSchema,
  editionIdSchema,
  editionSchema,
  listEntryIdSchema,
  listEntrySchema,
  listIdSchema,
  listSchema,
  metadataCandidateValueSchema,
  ownershipIdSchema,
  ownershipSchema,
  personIdSchema,
  personSchema,
  resolveMetadataField,
  sourceClaimIdSchema,
  sourceRecordIdSchema,
  sourceRecordSchema,
  workIdSchema,
  workSchema,
  type Edition,
  type MetadataField,
  type MetadataTarget,
  type SourceClaim,
  type Work,
} from '../domain/catalog'
import { libraryBookSchema, type LibraryBook } from '../library-model'
import type { SqlDatabase, SqlRow } from '../storage/database'
import { readText } from '../storage/database'
import { readLibraryBooks, writeLibraryBook } from '../storage/library-repository'
import { createPlaybackManifest, immutablePlaybackManifest } from './manifest'
import type {
  AudiobookImportResult,
  NormalizedAudiobook,
} from './model'

export type StoredAudiobookSegment = {
  readonly segmentId: string
  readonly relativePath: string
  readonly capabilityId: string
}

export type AudiobookCommitInput = {
  readonly audiobook: NormalizedAudiobook
  readonly bundleRelativePath: string
  readonly storedSegments: readonly StoredAudiobookSegment[]
  readonly coverRelativePath?: string
}

export type AudiobookImportRepositoryOptions = {
  readonly now?: () => Date
  readonly createId?: (prefix: string) => string
}

type AudiobookImportRow = SqlRow & {
  readonly id: string
  readonly fingerprint: string
  readonly title: string
  readonly book_id: string
  readonly edition_id: string
  readonly content_asset_id: string
  readonly imported_at: string
  readonly manifest_json: string
}

type Association = {
  readonly work?: Work
  readonly edition?: Edition
  readonly book?: LibraryBook
  readonly previousImport?: AudiobookImportRow
}

export class AudiobookImportRepository {
  readonly #database: SqlDatabase
  readonly #now: () => Date
  readonly #createId: (prefix: string) => string

  constructor(database: SqlDatabase, options: AudiobookImportRepositoryOptions = {}) {
    this.#database = database
    this.#now = options.now ?? (() => new Date())
    this.#createId = options.createId ?? ((prefix) => `${prefix}:audiobook:${crypto.randomUUID()}`)
  }

  async findByFingerprint(fingerprint: string): Promise<AudiobookImportResult | undefined> {
    const [row] = await this.#database.query<AudiobookImportRow>(
      `${AUDIOBOOK_RESULT_SELECT} FROM audiobook_imports WHERE fingerprint = ?`,
      [fingerprint],
    )
    return row ? duplicateResult(row) : undefined
  }

  async commit(input: AudiobookCommitInput): Promise<AudiobookImportResult> {
    return this.#database.transaction(async (database) => {
      const [duplicate] = await database.query<AudiobookImportRow>(
        `${AUDIOBOOK_RESULT_SELECT} FROM audiobook_imports WHERE fingerprint = ?`,
        [input.audiobook.fingerprint],
      )
      if (duplicate) return duplicateResult(duplicate)

      const importedAt = this.#now().toISOString()
      const association = await findAssociation(database, input.audiobook)
      const workId = association.edition?.workId ?? workIdSchema.parse(this.#createId('work'))
      const editionId = association.edition?.id ?? editionIdSchema.parse(this.#createId('edition'))
      const bookId = association.book?.id ?? this.#createId('book')
      const importId = this.#createId('audiobook-import')
      const sourceRecordId = sourceRecordIdSchema.parse(this.#createId('source-record'))
      const contentAssetId = assetIdSchema.parse(this.#createId('asset'))
      const queueId = this.#createId('queue')
      const targetWork = { type: 'work', id: workId } as const
      const targetEdition = { type: 'edition', id: editionId } as const
      const source = createSourceRecord({
        sourceRecordId,
        targetWork,
        targetEdition,
        audiobook: input.audiobook,
        importedAt,
        createId: this.#createId,
      })
      await insertSourceRecord(database, source.record)

      const existingCoverAssetId = input.audiobook.cover
        ? await findCoverAsset(database, editionId, input.audiobook.cover.sha256)
        : undefined
      const coverAssetId = input.audiobook.cover && input.coverRelativePath
        ? existingCoverAssetId ?? assetIdSchema.parse(this.#createId('asset'))
        : undefined

      if (!association.edition) {
        const work = workSchema.parse({
          id: workId,
          kind: 'single',
          title: resolvedSourceField(targetWork, 'work.title', input.audiobook.metadata.title, source.claimsByField, sourceRecordId, importedAt),
          createdAt: importedAt,
          updatedAt: importedAt,
        })
        const edition = editionSchema.parse({
          id: editionId,
          workId,
          medium: 'audiobook',
          title: resolvedSourceField(targetEdition, 'edition.title', input.audiobook.metadata.title, source.claimsByField, sourceRecordId, importedAt),
          language: resolvedSourceField(targetEdition, 'edition.language', input.audiobook.metadata.language ?? 'und', source.claimsByField, sourceRecordId, importedAt),
          durationMs: resolvedSourceField(targetEdition, 'edition.durationMs', input.audiobook.totalDurationMs, source.claimsByField, sourceRecordId, importedAt),
          ...(coverAssetId ? { coverAssetId } : {}),
          createdAt: importedAt,
          updatedAt: importedAt,
        })
        await insertWork(database, work)
        await insertEdition(database, edition)
        await insertContributors(
          database,
          input.audiobook.metadata.authors,
          input.audiobook.metadata.narrators,
          workId,
          editionId,
          importedAt,
          this.#createId,
        )
      } else {
        if (!association.work) throw new Error(`Audiobook import references missing Work ${workId}`)
        await updateAudiobookWork(
          database,
          association.work,
          input.audiobook,
          source.claimsByField,
          sourceRecordId,
          importedAt,
        )
        await updateAudiobookEdition(
          database,
          association.edition,
          input.audiobook,
          source.claimsByField,
          sourceRecordId,
          importedAt,
          coverAssetId,
        )
      }

      const contentAsset = assetSchema.parse({
        id: contentAssetId,
        editionId,
        role: 'content',
        format: input.audiobook.format,
        mediaType: input.audiobook.mediaType,
        location: {
          kind: 'managed-bundle',
          relativePath: input.bundleRelativePath,
          fingerprint: input.audiobook.fingerprint,
          byteSize: input.audiobook.segments.reduce((total, { byteSize }) => total + byteSize, 0),
          entryCount: input.audiobook.segments.length,
        },
        createdAt: importedAt,
      })
      await insertAsset(database, contentAsset)

      if (coverAssetId && input.audiobook.cover && input.coverRelativePath && !existingCoverAssetId) {
        const coverAsset = assetSchema.parse({
          id: coverAssetId,
          editionId,
          role: 'cover',
          format: 'image',
          mediaType: input.audiobook.cover.mediaType,
          location: {
            kind: 'managed-file',
            relativePath: input.coverRelativePath,
            sha256: input.audiobook.cover.sha256,
            byteSize: input.audiobook.cover.bytes.byteLength,
          },
          createdAt: importedAt,
        })
        await insertAsset(database, coverAsset)
      }
      await ensureOwnership(database, editionId, sourceRecordId, importedAt, this.#createId)
      const currentBook = libraryBookSchema.parse(association.book
        ? {
            ...association.book,
            title: association.book.title === association.previousImport?.title
              ? input.audiobook.metadata.title
              : association.book.title,
            format: 'Audiobook',
            authors: input.audiobook.metadata.authors.length
              ? [...input.audiobook.metadata.authors]
              : association.book.authors,
            ...(input.audiobook.metadata.series
              ? { series: distinct([...(association.book.series ?? []), input.audiobook.metadata.series]) }
              : {}),
            sourceNames: distinct([...(association.book.sourceNames ?? []), 'Audiobook files']),
            lastUpdatedAt: importedAt,
          }
        : {
            id: bookId,
            title: input.audiobook.metadata.title,
            authors: [...input.audiobook.metadata.authors],
            ...(input.audiobook.metadata.series ? { series: [input.audiobook.metadata.series] } : {}),
            sourceNames: ['Audiobook files'],
            format: 'Audiobook',
            pageCount: 0,
            shelf: 'tbr',
            progress: 0,
            currentPage: 0,
            rating: 0,
            notes: '',
            addedAt: importedAt,
            lastUpdatedAt: importedAt,
          })
      await writeLibraryBook(database, currentBook)
      if (!association.book) await ensureToBeReadListEntry(database, workId, importedAt, this.#createId)

      const initialAbsolutePositionMs = await latestAudioPosition(database, editionId)
      const capabilities = new Map(input.storedSegments.map(({ segmentId, capabilityId }) => [segmentId, capabilityId]))
      const manifest = createPlaybackManifest(input.audiobook, {
        queueId,
        editionId,
        assetId: contentAssetId,
        createdAt: importedAt,
        playableCapabilities: capabilities,
        initialAbsolutePositionMs,
      })
      const outcome = association.previousImport ? 'revision' : 'imported'
      const payload = {
        id: importId,
        fingerprint: input.audiobook.fingerprint,
        sourceSetFingerprint: input.audiobook.sourceSetFingerprint,
        metadataKey: input.audiobook.metadataKey,
        title: input.audiobook.metadata.title,
        bookId,
        editionId,
        contentAssetId,
        ...(coverAssetId ? { coverAssetId } : {}),
        sourceRecordId,
        outcome,
        importedAt,
        replacedAssetId: association.previousImport?.content_asset_id,
      }
      await database.run(
        `INSERT INTO audiobook_imports(
           id, fingerprint, source_set_fingerprint, metadata_key, title, book_id, edition_id, content_asset_id,
           cover_asset_id, source_record_id, outcome, imported_at, manifest_json, payload_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          importId,
          input.audiobook.fingerprint,
          input.audiobook.sourceSetFingerprint,
          input.audiobook.metadataKey,
          input.audiobook.metadata.title,
          bookId,
          editionId,
          contentAssetId,
          coverAssetId ?? null,
          sourceRecordId,
          outcome,
          importedAt,
          JSON.stringify(manifest),
          JSON.stringify(payload),
        ],
      )
      for (const [position, stored] of input.storedSegments.entries()) {
        const segment = input.audiobook.segments.find(({ id }) => id === stored.segmentId)
        if (!segment) throw new Error(`Missing normalized audiobook segment ${stored.segmentId}`)
        await database.run(
          `INSERT INTO audiobook_files(
             capability_id, import_id, segment_id, position, relative_path,
             fingerprint, byte_size, media_type
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            stored.capabilityId,
            importId,
            stored.segmentId,
            position,
            stored.relativePath,
            segment.fingerprint,
            segment.byteSize,
            segment.mediaType,
          ],
        )
      }

      return {
        importId,
        outcome,
        title: input.audiobook.metadata.title,
        bookId,
        editionId,
        assetId: contentAssetId,
        fingerprint: input.audiobook.fingerprint,
        importedAt,
        manifest,
      }
    })
  }
}

function duplicateResult(row: AudiobookImportRow): AudiobookImportResult {
  return {
    importId: readText(row, 'id'),
    outcome: 'duplicate',
    title: readText(row, 'title'),
    bookId: readText(row, 'book_id'),
    editionId: readText(row, 'edition_id'),
    assetId: readText(row, 'content_asset_id'),
    fingerprint: readText(row, 'fingerprint'),
    importedAt: readText(row, 'imported_at'),
    manifest: immutablePlaybackManifest(JSON.parse(readText(row, 'manifest_json'))),
  }
}

async function findAssociation(database: SqlDatabase, audiobook: NormalizedAudiobook): Promise<Association> {
  const [previousImport] = await database.query<AudiobookImportRow>(
    `${AUDIOBOOK_RESULT_SELECT} FROM audiobook_imports
     WHERE source_set_fingerprint = ? OR metadata_key = ?
     ORDER BY CASE WHEN source_set_fingerprint = ? THEN 0 ELSE 1 END,
       imported_at DESC, id DESC LIMIT 1`,
    [audiobook.sourceSetFingerprint, audiobook.metadataKey, audiobook.sourceSetFingerprint],
  )
  if (!previousImport) return {}
  return {
    previousImport,
    ...await readEditionAndWork(database, readText(previousImport, 'edition_id')),
    book: (await readLibraryBooks(database)).find(({ id }) => id === readText(previousImport, 'book_id')),
  }
}

function createSourceRecord(input: {
  readonly sourceRecordId: ReturnType<typeof sourceRecordIdSchema.parse>
  readonly targetWork: MetadataTarget
  readonly targetEdition: MetadataTarget
  readonly audiobook: NormalizedAudiobook
  readonly importedAt: string
  readonly createId: (prefix: string) => string
}) {
  const claims: SourceClaim[] = []
  const claimsByField = new Map<string, SourceClaim>()
  const addClaim = (target: MetadataTarget, field: MetadataField, value: string | number, confidence = 1) => {
    const claim = sourceRecordSchema.shape.claims.element.parse({
      id: sourceClaimIdSchema.parse(input.createId('source-claim')),
      target,
      field,
      value,
      observedAt: input.importedAt,
      confidence,
    })
    claims.push(claim)
    claimsByField.set(claimKey(target, field), claim)
  }
  addClaim(input.targetWork, 'work.title', input.audiobook.metadata.title)
  addClaim(input.targetEdition, 'edition.title', input.audiobook.metadata.title)
  addClaim(input.targetEdition, 'edition.language', input.audiobook.metadata.language ?? 'und', input.audiobook.metadata.language ? 1 : 0.5)
  addClaim(input.targetEdition, 'edition.durationMs', input.audiobook.totalDurationMs)
  const record = sourceRecordSchema.parse({
    id: input.sourceRecordId,
    source: { kind: 'file-import', name: 'Audiobook files' },
    externalKey: input.audiobook.fingerprint,
    observedAt: input.importedAt,
    importedAt: input.importedAt,
    claims,
    observedIdentifiers: [],
    rawPayload: {
      fingerprint: input.audiobook.fingerprint,
      sourceSetFingerprint: input.audiobook.sourceSetFingerprint,
      format: input.audiobook.format,
      durationMs: input.audiobook.totalDurationMs,
      authors: [...input.audiobook.metadata.authors],
      narrators: [...input.audiobook.metadata.narrators],
      ...(input.audiobook.metadata.series ? { series: input.audiobook.metadata.series } : {}),
      segments: input.audiobook.segments.map((segment) => ({
        name: segment.fileName,
        fingerprint: segment.fingerprint,
        durationMs: segment.durationMs,
        trackNumber: segment.trackNumber ?? null,
        discNumber: segment.discNumber ?? null,
      })),
      chapterCount: input.audiobook.chapters.length,
    },
  })
  return { record, claimsByField }
}

function resolvedSourceField(
  target: MetadataTarget,
  field: MetadataField,
  value: string | number,
  claims: ReadonlyMap<string, SourceClaim>,
  sourceRecordId: ReturnType<typeof sourceRecordIdSchema.parse>,
  observedAt: string,
  userOverride?: Parameters<typeof resolveMetadataField>[1],
) {
  const claim = claims.get(claimKey(target, field))
  if (!claim) throw new Error(`Missing audiobook source claim for ${field}`)
  return resolveMetadataField(metadataCandidateValueSchema.parse({
    kind: 'source',
    target,
    field,
    value,
    sourceRecordId,
    claimId: claim.id,
    observedAt,
    confidence: claim.confidence,
  }), userOverride)
}

async function updateAudiobookEdition(
  database: SqlDatabase,
  edition: Edition,
  audiobook: NormalizedAudiobook,
  claims: ReadonlyMap<string, SourceClaim>,
  sourceRecordId: ReturnType<typeof sourceRecordIdSchema.parse>,
  importedAt: string,
  coverAssetId: ReturnType<typeof assetIdSchema.parse> | undefined,
): Promise<void> {
  if (edition.medium !== 'audiobook') throw new Error(`Edition ${edition.id} is not an audiobook`)
  const target = { type: 'edition', id: edition.id } as const
  const changed = editionSchema.parse({
    ...edition,
    title: resolvedSourceField(target, 'edition.title', audiobook.metadata.title, claims, sourceRecordId, importedAt, edition.title.userOverride),
    language: resolvedSourceField(target, 'edition.language', audiobook.metadata.language ?? 'und', claims, sourceRecordId, importedAt, edition.language.userOverride),
    durationMs: resolvedSourceField(target, 'edition.durationMs', audiobook.totalDurationMs, claims, sourceRecordId, importedAt, edition.durationMs?.userOverride),
    ...(coverAssetId ? { coverAssetId } : {}),
    updatedAt: importedAt,
  })
  await database.run(
    `UPDATE editions SET title_sort = ?, cover_asset_id = ?, updated_at = ?, payload_json = ? WHERE id = ?`,
    [changed.title.value, changed.coverAssetId ?? null, importedAt, JSON.stringify(changed), changed.id],
  )
}

async function updateAudiobookWork(
  database: SqlDatabase,
  work: Work,
  audiobook: NormalizedAudiobook,
  claims: ReadonlyMap<string, SourceClaim>,
  sourceRecordId: ReturnType<typeof sourceRecordIdSchema.parse>,
  importedAt: string,
): Promise<void> {
  const target = { type: 'work', id: work.id } as const
  const changed = workSchema.parse({
    ...work,
    title: resolvedSourceField(target, 'work.title', audiobook.metadata.title, claims, sourceRecordId, importedAt, work.title.userOverride),
    updatedAt: importedAt,
  })
  await database.run(
    'UPDATE works SET title_sort = ?, updated_at = ?, payload_json = ? WHERE id = ?',
    [changed.title.value, importedAt, JSON.stringify(changed), changed.id],
  )
}

async function insertContributors(
  database: SqlDatabase,
  authors: readonly string[],
  narrators: readonly string[],
  workId: ReturnType<typeof workIdSchema.parse>,
  editionId: ReturnType<typeof editionIdSchema.parse>,
  importedAt: string,
  createId: (prefix: string) => string,
): Promise<void> {
  const contributors = [
    ...authors.map((name, position) => ({ name, position, role: 'author' as const, target: { type: 'work', id: workId } as const })),
    ...narrators.map((name, position) => ({ name, position, role: 'narrator' as const, target: { type: 'edition', id: editionId } as const })),
  ]
  for (const item of contributors) {
    const personId = personIdSchema.parse(createId('person'))
    const personTarget = { type: 'person', id: personId } as const
    const person = personSchema.parse({
      id: personId,
      displayName: resolveMetadataField(metadataCandidateValueSchema.parse({
        kind: 'local',
        target: personTarget,
        field: 'person.displayName',
        value: item.name,
        recordedAt: importedAt,
        method: 'manual-entry',
      })),
      createdAt: importedAt,
      updatedAt: importedAt,
    })
    await insertPerson(database, person)
    const contributor = contributorSchema.parse({
      id: contributorIdSchema.parse(createId('contributor')),
      personId,
      target: item.target,
      role: item.role,
      creditedAs: item.name,
      position: item.position,
    })
    await database.run(
      `INSERT INTO contributors(id, person_id, target_type, target_id, role, position, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [contributor.id, contributor.personId, contributor.target.type, contributor.target.id, contributor.role, contributor.position, JSON.stringify(contributor)],
    )
  }
}

async function latestAudioPosition(database: SqlDatabase, editionId: string): Promise<number> {
  const rows = await database.query(
    `SELECT payload_json FROM progress_snapshots
     WHERE edition_id = ? ORDER BY projected_at DESC, id DESC LIMIT 20`,
    [editionId],
  )
  for (const row of rows) {
    try {
      const payload = JSON.parse(readText(row, 'payload_json')) as {
        readonly position?: { readonly locator?: { readonly kind?: string; readonly positionMs?: number } }
      }
      const locator = payload.position?.locator
      if (locator?.kind === 'audio-time' && Number.isInteger(locator.positionMs) && (locator.positionMs ?? -1) >= 0) {
        return locator.positionMs ?? 0
      }
    } catch {
      // A malformed unrelated projection is ignored here and remains visible to catalog validation.
    }
  }
  return 0
}

async function ensureOwnership(
  database: SqlDatabase,
  editionId: ReturnType<typeof editionIdSchema.parse>,
  sourceRecordId: ReturnType<typeof sourceRecordIdSchema.parse>,
  importedAt: string,
  createId: (prefix: string) => string,
): Promise<void> {
  const [existing] = await database.query(
    `SELECT id FROM ownerships
     WHERE edition_id = ? AND json_extract(payload_json, '$.copyKind') = 'drm-free-digital'
       AND disposed_at IS NULL LIMIT 1`,
    [editionId],
  )
  if (existing) return
  const ownership = ownershipSchema.parse({
    id: ownershipIdSchema.parse(createId('ownership')),
    editionId,
    copyKind: 'drm-free-digital',
    acquisition: 'import',
    acquiredAt: importedAt,
    sourceRecordId,
  })
  const access = accessGrantSchema.parse({
    id: accessGrantIdSchema.parse(createId('access')),
    editionId,
    basis: 'ownership',
    ownershipId: ownership.id,
    createdAt: importedAt,
  })
  await database.run(
    `INSERT INTO ownerships(id, edition_id, acquired_at, disposed_at, source_record_id, payload_json)
     VALUES (?, ?, ?, NULL, ?, ?)`,
    [ownership.id, editionId, importedAt, sourceRecordId, JSON.stringify(ownership)],
  )
  await database.run(
    `INSERT INTO access_grants(id, edition_id, basis, ownership_id, loan_id, source_record_id, created_at, payload_json)
     VALUES (?, ?, 'ownership', ?, NULL, NULL, ?, ?)`,
    [access.id, editionId, ownership.id, importedAt, JSON.stringify(access)],
  )
}

async function ensureToBeReadListEntry(
  database: SqlDatabase,
  workId: ReturnType<typeof workIdSchema.parse>,
  importedAt: string,
  createId: (prefix: string) => string,
): Promise<void> {
  const [existingList] = await database.query('SELECT payload_json FROM lists WHERE slug IN (?, ?) LIMIT 1', ['tbr', 'legacy-tbr'])
  const list = existingList
    ? listSchema.parse(JSON.parse(readText(existingList, 'payload_json')))
    : listSchema.parse({
        id: listIdSchema.parse(createId('list')),
        kind: 'system',
        slug: 'tbr',
        name: 'To Be Read',
        createdAt: importedAt,
        updatedAt: importedAt,
      })
  if (!existingList) {
    await database.run(
      `INSERT INTO lists(id, kind, slug, name, created_at, updated_at, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [list.id, list.kind, list.slug, list.name, list.createdAt, list.updatedAt, JSON.stringify(list)],
    )
  }
  const [existingEntry] = await database.query(
    'SELECT id FROM list_entries WHERE list_id = ? AND work_id = ? LIMIT 1',
    [list.id, workId],
  )
  if (existingEntry) return
  const [{ position } = { position: 0 }] = await database.query<{ readonly position: number }>(
    'SELECT COALESCE(MAX(position) + 1, 0) AS position FROM list_entries WHERE list_id = ?',
    [list.id],
  )
  const entry = listEntrySchema.parse({
    id: listEntryIdSchema.parse(createId('list-entry')),
    listId: list.id,
    workId,
    position,
    createdAt: importedAt,
    updatedAt: importedAt,
  })
  await database.run(
    `INSERT INTO list_entries(id, list_id, work_id, position, created_at, updated_at, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [entry.id, entry.listId, entry.workId, entry.position, entry.createdAt, entry.updatedAt, JSON.stringify(entry)],
  )
}

async function findCoverAsset(database: SqlDatabase, editionId: string, sha256: string) {
  const [row] = await database.query(
    `SELECT id FROM assets
     WHERE edition_id = ? AND role = 'cover'
       AND json_extract(payload_json, '$.location.sha256') = ? LIMIT 1`,
    [editionId, sha256],
  )
  return row ? assetIdSchema.parse(readText(row, 'id')) : undefined
}

async function readEdition(database: SqlDatabase, id: string): Promise<Edition> {
  const [row] = await database.query('SELECT payload_json FROM editions WHERE id = ?', [id])
  if (!row) throw new Error(`Audiobook import references missing Edition ${id}`)
  return editionSchema.parse(JSON.parse(readText(row, 'payload_json')))
}

async function readEditionAndWork(
  database: SqlDatabase,
  editionId: string,
): Promise<{ readonly edition: Edition; readonly work: Work }> {
  const edition = await readEdition(database, editionId)
  const [row] = await database.query('SELECT payload_json FROM works WHERE id = ?', [edition.workId])
  if (!row) throw new Error(`Audiobook import references missing Work ${edition.workId}`)
  return { edition, work: workSchema.parse(JSON.parse(readText(row, 'payload_json'))) }
}

async function insertSourceRecord(database: SqlDatabase, source: ReturnType<typeof sourceRecordSchema.parse>) {
  await database.run(
    `INSERT INTO source_records(id, source_kind, source_name, external_key, observed_at, imported_at, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [source.id, source.source.kind, source.source.name, source.externalKey, source.observedAt, source.importedAt, JSON.stringify(source)],
  )
}

async function insertWork(database: SqlDatabase, work: ReturnType<typeof workSchema.parse>) {
  await database.run(
    `INSERT INTO works(id, kind, title_sort, created_at, updated_at, payload_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [work.id, work.kind, work.title.value, work.createdAt, work.updatedAt, JSON.stringify(work)],
  )
}

async function insertEdition(database: SqlDatabase, edition: Edition) {
  await database.run(
    `INSERT INTO editions(id, work_id, medium, title_sort, cover_asset_id, created_at, updated_at, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [edition.id, edition.workId, edition.medium, edition.title.value, edition.coverAssetId ?? null, edition.createdAt, edition.updatedAt, JSON.stringify(edition)],
  )
}

async function insertAsset(database: SqlDatabase, asset: ReturnType<typeof assetSchema.parse>) {
  await database.run(
    `INSERT INTO assets(id, edition_id, role, format, source_record_id, created_at, payload_json)
     VALUES (?, ?, ?, ?, NULL, ?, ?)`,
    [asset.id, asset.editionId, asset.role, asset.format, asset.createdAt, JSON.stringify(asset)],
  )
}

async function insertPerson(database: SqlDatabase, person: ReturnType<typeof personSchema.parse>) {
  await database.run(
    `INSERT INTO people(id, display_name_sort, created_at, updated_at, payload_json)
     VALUES (?, ?, ?, ?, ?)`,
    [person.id, person.displayName.value, person.createdAt, person.updatedAt, JSON.stringify(person)],
  )
}

function claimKey(target: MetadataTarget, field: MetadataField): string {
  return `${target.type}:${target.id}:${field}`
}

function distinct(values: readonly string[]): string[] {
  return [...new Set(values)]
}

const AUDIOBOOK_RESULT_SELECT = `SELECT id, fingerprint, title, book_id, edition_id,
  content_asset_id, imported_at, manifest_json`
