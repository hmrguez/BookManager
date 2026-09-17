import { z } from 'zod'
import {
  assetIdSchema,
  catalogSchema,
  contributorIdSchema,
  deriveReadingState,
  editionIdSchema,
  listEntryIdSchema,
  listIdSchema,
  metadataCandidateValueSchema,
  personIdSchema,
  progressSnapshotIdSchema,
  readingDeviceIdSchema,
  readingEventIdSchema,
  readingEventSchema,
  resolveMetadataField,
  sourceRecordIdSchema,
  toProgressSnapshot,
  workIdSchema,
  type Catalog,
  type IsoDateTime,
  type JsonValue,
  type MetadataField,
  type MetadataTarget,
  type ReadingEvent,
} from '../domain/catalog'
import {
  isStarterLibraryBookId,
  libraryBookSchema,
  shelfIdSchema,
  type LibraryBook,
  type ShelfId,
} from '../library-model'
import { CatalogRepository, insertCatalogRecords } from './catalog-repository'
import type { SqlDatabase, SqlRow } from './database'
import { readNumber, readText } from './database'

export const LEGACY_LIBRARY_MIGRATION_KEY = 'legacy-library-v1'
export const LEGACY_LIBRARY_STORAGE_KEYS = [
  'wovenleaf.library.v1',
  'bookmanager.library.v1',
] as const

const RECOVERY_GUIDANCE =
  'Wovenleaf could not safely migrate the previous library. No legacy data was deleted. ' +
  'Download the recovery copy and keep it somewhere safe before resetting or repairing local data.'

const migrationDeviceId = readingDeviceIdSchema.parse('reading-device:legacy-library-migration')

const legacyLibraryBookInputSchema = z
  .object({
    id: z.string().trim().min(1),
    title: z.string().trim().min(1),
    authors: z.array(z.string().trim().min(1)).optional(),
    thumbnail: z.url().optional(),
    pageCount: z.number().int().nonnegative().optional(),
    shelf: shelfIdSchema.optional(),
    progress: z.number().min(0).max(100).optional(),
    currentPage: z.number().int().nonnegative().optional(),
    rating: z.number().int().min(0).max(5).optional(),
    notes: z.string().optional(),
    addedAt: z.iso.datetime({ offset: true }).optional(),
    startedAt: z.iso.datetime({ offset: true }).optional(),
    finishedAt: z.iso.datetime({ offset: true }).optional(),
    lastUpdatedAt: z.iso.datetime({ offset: true }).optional(),
  })
  .catchall(z.json())

export type LegacyLibraryStorage = Pick<Storage, 'getItem' | 'removeItem'>

export type LegacyLibraryMigrationResult =
  | { readonly status: 'not-found' }
  | {
      readonly status: 'migrated' | 'already-migrated'
      readonly importedBooks: number
      readonly sourceKeys: readonly string[]
    }
  | {
      readonly status: 'recovery-required'
      readonly message: string
      readonly sourceKeys: readonly string[]
    }

export type LegacyLibraryRecoveryFile = {
  readonly filename: string
  readonly mediaType: string
  readonly contents: string
}

export type LegacyLibraryMigrationOptions = {
  readonly now?: () => Date
}

type LegacySource = {
  readonly key: string
  readonly raw: string
}

type LegacyRecoveryPayload = {
  readonly format: 'wovenleaf-legacy-library-recovery-v1'
  readonly sources: readonly LegacySource[]
}

type NormalizedLegacyBook = {
  readonly book: LibraryBook
  readonly raw: JsonValue
  readonly explicitStartedAt: boolean
  readonly explicitFinishedAt: boolean
}

type LegacyCheckpoint = {
  readonly sourceKey: string
  readonly sourceChecksum: string
  readonly status: 'started' | 'verified' | 'completed' | 'failed'
  readonly sourceCount?: number
  readonly importedCount: number
  readonly recoveryPayload: LegacyRecoveryPayload
  readonly error?: string
}

type LegacyCheckpointRow = SqlRow & {
  readonly source_key: string
  readonly source_checksum: string
  readonly status: string
  readonly source_count: number | null
  readonly imported_count: number
  readonly recovery_payload: string
  readonly error: string | null
}

export async function migrateLegacyLibrary(
  database: SqlDatabase,
  storage: LegacyLibraryStorage,
  options: LegacyLibraryMigrationOptions = {},
): Promise<LegacyLibraryMigrationResult> {
  const timestamp = (options.now ?? (() => new Date()))().toISOString() as IsoDateTime
  const checkpoint = await readCheckpoint(database)
  let sources: LegacySource[]
  try {
    sources = readLegacySources(storage)
  } catch (error) {
    return recoveryRequired(
      `The previous library could not be read: ${errorMessage(error)}`,
      checkpoint?.recoveryPayload.sources.map(({ key }) => key) ?? [],
    )
  }

  if (sources.length === 0) {
    if (checkpoint?.status === 'verified') {
      await markCompleted(database, timestamp)
      return {
        status: 'already-migrated',
        importedBooks: checkpoint.importedCount,
        sourceKeys: checkpoint.recoveryPayload.sources.map(({ key }) => key),
      }
    }
    if (checkpoint?.status === 'completed') {
      return {
        status: 'already-migrated',
        importedBooks: checkpoint.importedCount,
        sourceKeys: checkpoint.recoveryPayload.sources.map(({ key }) => key),
      }
    }
    if (checkpoint) {
      return recoveryRequired(
        checkpoint.error ?? 'The previous migration did not complete.',
        checkpoint.recoveryPayload.sources.map(({ key }) => key),
      )
    }
    return { status: 'not-found' }
  }

  let recoveryPayload = createRecoveryPayload(sources)
  const distinctPayloads = new Set(sources.map(({ raw }) => raw))
  if (distinctPayloads.size > 1) {
    const checksum = await sha256(JSON.stringify(recoveryPayload))
    const message =
      'Both legacy storage keys exist with different contents, so Wovenleaf cannot choose one without risking data loss.'
    if (!checkpoint) {
      await recordFailure(database, {
        sourceKey: sources[0].key,
        sourceChecksum: checksum,
        recoveryPayload,
        timestamp,
        error: message,
      })
    }
    return recoveryRequired(message, sources.map(({ key }) => key))
  }

  const selected = sources[0]
  const checksum = await sha256(selected.raw)
  if (checkpoint && checkpoint.sourceChecksum !== checksum) {
    if (checkpoint.status !== 'failed') {
      return recoveryRequired(
        'The legacy source changed after a migration attempt. Automatic retry was stopped to preserve both versions.',
        sources.map(({ key }) => key),
      )
    }
    recoveryPayload = createRecoveryPayload(
      mergeRecoverySources(sources, checkpoint.recoveryPayload.sources),
    )
  }

  if (checkpoint?.status === 'completed') {
    const cleanup = removeVerifiedSources(storage, sources)
    if (cleanup) return recoveryRequired(cleanup, sources.map(({ key }) => key))
    return {
      status: 'already-migrated',
      importedBooks: checkpoint.importedCount,
      sourceKeys: sources.map(({ key }) => key),
    }
  }

  if (checkpoint?.status === 'verified') {
    const cleanup = removeVerifiedSources(storage, sources)
    if (cleanup) return recoveryRequired(cleanup, sources.map(({ key }) => key))
    await markCompleted(database, timestamp)
    return {
      status: 'already-migrated',
      importedBooks: checkpoint.importedCount,
      sourceKeys: sources.map(({ key }) => key),
    }
  }

  let normalized: readonly NormalizedLegacyBook[]
  try {
    normalized = parseLegacyLibrary(selected.raw, timestamp)
  } catch (error) {
    const message = errorMessage(error)
    await recordFailure(database, {
      sourceKey: selected.key,
      sourceChecksum: checksum,
      recoveryPayload,
      timestamp,
      error: message,
    })
    return recoveryRequired(message, sources.map(({ key }) => key))
  }

  await markStarted(database, {
    sourceKey: selected.key,
    sourceChecksum: checksum,
    sourceCount: normalized.length,
    recoveryPayload,
    timestamp,
  })

  try {
    const catalog = await mapLegacyLibrary(normalized, timestamp)
    const books = normalized.map(({ book }) => book)
    await database.transaction(async (transaction) => {
      await insertCatalogRecords(transaction, catalog)
      await upsertLegacyLibraryBooks(transaction, books)
      await verifyImport(transaction, catalog, books)
      const result = await transaction.run(
        `UPDATE legacy_library_migrations
         SET status = 'verified', imported_count = ?, verified_at = ?, error = NULL
         WHERE migration_key = ? AND source_checksum = ?`,
        [books.length, timestamp, LEGACY_LIBRARY_MIGRATION_KEY, checksum],
      )
      if (result.changes !== 1) throw new Error('Legacy migration checkpoint was not advanced')
    })
  } catch (error) {
    const message = `The SQLite import was rolled back: ${errorMessage(error)}`
    await recordFailure(database, {
      sourceKey: selected.key,
      sourceChecksum: checksum,
      sourceCount: normalized.length,
      recoveryPayload,
      timestamp,
      error: message,
    })
    return recoveryRequired(message, sources.map(({ key }) => key))
  }

  const cleanup = removeVerifiedSources(storage, sources)
  if (cleanup) return recoveryRequired(cleanup, sources.map(({ key }) => key))
  await markCompleted(database, timestamp)
  return {
    status: 'migrated',
    importedBooks: normalized.length,
    sourceKeys: sources.map(({ key }) => key),
  }
}

export async function createLegacyLibraryRecoveryFile(
  database: SqlDatabase,
  storage: LegacyLibraryStorage,
): Promise<LegacyLibraryRecoveryFile | undefined> {
  let sources: readonly LegacySource[] = []
  try {
    sources = readLegacySources(storage)
  } catch {
    // The SQLite checkpoint remains available when local storage cannot be read.
  }
  const checkpointSources = (await readCheckpoint(database))?.recoveryPayload.sources ?? []
  sources = mergeRecoverySources(sources, checkpointSources)
  if (sources.length === 0) return undefined

  if (sources.length === 1) {
    const [{ key, raw }] = sources
    return {
      filename: `${safeFilename(key)}.recovery.txt`,
      mediaType: isJson(raw) ? 'application/json' : 'text/plain',
      contents: raw,
    }
  }

  return {
    filename: 'wovenleaf-legacy-library-recovery.json',
    mediaType: 'application/json',
    contents: JSON.stringify(createRecoveryPayload(sources), null, 2),
  }
}

function parseLegacyLibrary(raw: string, importedAt: IsoDateTime): readonly NormalizedLegacyBook[] {
  let value: unknown
  try {
    value = JSON.parse(raw) as unknown
  } catch {
    throw new Error('The legacy value is not valid JSON.')
  }
  if (!Array.isArray(value)) throw new Error('The legacy library must be a JSON array.')

  const books = value.map((rawBook, index) => normalizeLegacyBook(rawBook, index, importedAt))
  const ids = new Set<string>()
  for (const [index, { book }] of books.entries()) {
    if (ids.has(book.id)) throw new Error(`Book ${index + 1} repeats legacy ID ${book.id}.`)
    ids.add(book.id)
  }
  return books
}

function normalizeLegacyBook(
  rawBook: unknown,
  index: number,
  importedAt: IsoDateTime,
): NormalizedLegacyBook {
  const result = legacyLibraryBookInputSchema.safeParse(rawBook)
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'record'}: ${issue.message}`)
      .join('; ')
    throw new Error(`Book ${index + 1} is malformed (${details}).`)
  }
  const raw = z.json().parse(rawBook)
  const input = result.data
  const shelf = input.shelf ?? inferShelf(input)
  const pageCount = input.pageCount ?? 0
  const progress = input.progress ?? inferProgress(input, shelf, pageCount)
  const currentPage = input.currentPage ?? inferCurrentPage(progress, pageCount)
  if (pageCount > 0 && currentPage > pageCount) {
    throw new Error(`Book ${index + 1} has a current page greater than its page count.`)
  }

  const addedAt =
    input.addedAt ?? input.startedAt ?? input.finishedAt ?? input.lastUpdatedAt ?? importedAt
  const lastUpdatedAt =
    input.lastUpdatedAt ?? input.finishedAt ?? input.startedAt ?? input.addedAt ?? importedAt
  const startedAt = input.startedAt ?? (shelf === 'reading' ? addedAt : undefined)
  const finishedAt = input.finishedAt ?? (shelf === 'finished' ? lastUpdatedAt : undefined)
  if (startedAt && finishedAt && Date.parse(startedAt) > Date.parse(finishedAt)) {
    throw new Error(`Book ${index + 1} finishes before it starts.`)
  }

  return {
    book: libraryBookSchema.parse({
      id: input.id,
      title: input.title,
      authors: input.authors ?? [],
      ...(input.thumbnail ? { thumbnail: input.thumbnail } : {}),
      pageCount,
      shelf,
      progress,
      currentPage,
      rating: input.rating ?? 0,
      notes: input.notes ?? '',
      addedAt,
      ...(startedAt ? { startedAt } : {}),
      ...(finishedAt ? { finishedAt } : {}),
      lastUpdatedAt,
    }),
    raw,
    explicitStartedAt: input.startedAt !== undefined,
    explicitFinishedAt: input.finishedAt !== undefined,
  }
}

function inferShelf(input: z.infer<typeof legacyLibraryBookInputSchema>): ShelfId {
  if (input.finishedAt) return 'finished'
  if (input.startedAt || (input.progress ?? 0) > 0 || (input.currentPage ?? 0) > 0) {
    return 'reading'
  }
  return 'tbr'
}

function inferProgress(
  input: z.infer<typeof legacyLibraryBookInputSchema>,
  shelf: ShelfId,
  pageCount: number,
): number {
  if (shelf === 'finished') return 100
  if (pageCount > 0 && input.currentPage !== undefined) {
    return Math.min(100, Math.round((input.currentPage / pageCount) * 100))
  }
  return 0
}

function inferCurrentPage(progress: number, pageCount: number): number {
  return pageCount > 0 ? Math.round((pageCount * progress) / 100) : 0
}

async function mapLegacyLibrary(
  legacyBooks: readonly NormalizedLegacyBook[],
  importedAt: IsoDateTime,
): Promise<Catalog> {
  const works: unknown[] = []
  const editions: unknown[] = []
  const assets: unknown[] = []
  const sourceRecords: unknown[] = []
  const people = new Map<string, unknown>()
  const contributors: unknown[] = []
  const lists = new Map<ShelfId, unknown>()
  const listEntries: unknown[] = []
  const readingEvents: ReadingEvent[] = []
  const progressSnapshots: unknown[] = []
  const positions = new Map<ShelfId, number>()

  for (const { book, raw, explicitStartedAt, explicitFinishedAt } of legacyBooks) {
    const token = (await sha256(book.id)).slice(0, 32)
    const workId = workIdSchema.parse(`work:legacy:${token}`)
    const editionId = editionIdSchema.parse(`edition:legacy:${token}`)
    const sourceRecordId = sourceRecordIdSchema.parse(`source-record:legacy:${token}`)
    const sourceName = isStarterLibraryBookId(book.id)
      ? 'Wovenleaf seeded starter library'
      : 'BookManager legacy user library'
    const migrationKey = isStarterLibraryBookId(book.id)
      ? `${LEGACY_LIBRARY_MIGRATION_KEY}:seeded-starter`
      : `${LEGACY_LIBRARY_MIGRATION_KEY}:user`

    sourceRecords.push({
      id: sourceRecordId,
      source: { kind: 'migration', name: sourceName },
      externalKey: book.id,
      observedAt: book.lastUpdatedAt,
      importedAt,
      claims: [],
      observedIdentifiers: [],
      rawPayload: raw,
    })
    works.push({
      id: workId,
      kind: 'single',
      title: migratedField({ type: 'work', id: workId }, 'work.title', book.title, book.addedAt),
      createdAt: book.addedAt,
      updatedAt: book.lastUpdatedAt,
    })

    const coverAssetId = book.thumbnail
      ? assetIdSchema.parse(`asset:legacy:${token}:cover`)
      : undefined
    editions.push({
      id: editionId,
      workId,
      medium: 'print',
      binding: 'other',
      title: migratedField(
        { type: 'edition', id: editionId },
        'edition.title',
        book.title,
        book.addedAt,
      ),
      language: migratedField(
        { type: 'edition', id: editionId },
        'edition.language',
        'und',
        importedAt,
      ),
      ...(book.pageCount > 0
        ? {
            pageCount: migratedField(
              { type: 'edition', id: editionId },
              'edition.pageCount',
              book.pageCount,
              book.addedAt,
            ),
          }
        : {}),
      ...(coverAssetId ? { coverAssetId } : {}),
      createdAt: book.addedAt,
      updatedAt: book.lastUpdatedAt,
    })
    if (coverAssetId && book.thumbnail) {
      assets.push({
        id: coverAssetId,
        editionId,
        role: 'cover',
        format: 'image',
        mediaType: 'image/*',
        location: {
          kind: 'remote',
          uri: book.thumbnail,
          sourceRecordId,
        },
        createdAt: book.addedAt,
      })
    }

    for (const [position, author] of book.authors.entries()) {
      const personToken = (await sha256(normalizeAuthor(author))).slice(0, 32)
      const personId = personIdSchema.parse(`person:legacy:${personToken}`)
      if (!people.has(personId)) {
        people.set(personId, {
          id: personId,
          displayName: migratedField(
            { type: 'person', id: personId },
            'person.displayName',
            author,
            book.addedAt,
          ),
          createdAt: book.addedAt,
          updatedAt: book.lastUpdatedAt,
        })
      }
      contributors.push({
        id: contributorIdSchema.parse(`contributor:legacy:${token}:${position}`),
        personId,
        target: { type: 'work', id: workId },
        role: 'author',
        creditedAs: author,
        position,
      })
    }

    if (!lists.has(book.shelf)) {
      lists.set(book.shelf, {
        id: listIdForShelf(book.shelf),
        kind: 'system',
        slug: `legacy-${book.shelf}`,
        name: listName(book.shelf),
        createdAt: importedAt,
        updatedAt: importedAt,
      })
    }
    const listPosition = positions.get(book.shelf) ?? 0
    positions.set(book.shelf, listPosition + 1)
    listEntries.push({
      id: listEntryIdSchema.parse(`list-entry:legacy:${token}`),
      listId: listIdForShelf(book.shelf),
      workId,
      position: listPosition,
      createdAt: book.addedAt,
      updatedAt: book.lastUpdatedAt,
    })

    const events = createReadingEvents({
      book,
      editionId,
      token,
      migrationKey,
      importedAt,
      explicitStartedAt,
      explicitFinishedAt,
    })
    readingEvents.push(...events)
    const state = deriveReadingState(editionId, events)
    progressSnapshots.push(
      toProgressSnapshot(
        progressSnapshotIdSchema.parse(`progress:legacy:${token}`),
        state,
        importedAt,
      ),
    )
  }

  return catalogSchema.parse({
    works,
    editions,
    assets,
    identifiers: [],
    sourceRecords,
    metadataOverrides: [],
    ownerships: [],
    loans: [],
    accessGrants: [],
    people: [...people.values()],
    contributors,
    workParts: [],
    lists: [...lists.values()],
    listEntries,
    integrationCheckpoints: [],
    readingEvents,
    progressSnapshots,
  })
}

function createReadingEvents(input: {
  readonly book: LibraryBook
  readonly editionId: ReturnType<typeof editionIdSchema.parse>
  readonly token: string
  readonly migrationKey: string
  readonly importedAt: IsoDateTime
  readonly explicitStartedAt: boolean
  readonly explicitFinishedAt: boolean
}): ReadingEvent[] {
  const { book, editionId, token, migrationKey, importedAt } = input
  const source = { kind: 'migration', migrationKey } as const
  const facts: unknown[] = []
  const event = (suffix: string, effectiveAt: string, timeConfidence: number) => ({
    id: readingEventIdSchema.parse(`reading-event:legacy:${token}:${suffix}`),
    editionId,
    source,
    deviceId: migrationDeviceId,
    observedAt: effectiveAt,
    effectiveAt,
    recordedAt: importedAt,
    timeConfidence,
  })

  if (book.startedAt) {
    facts.push({
      ...event('start', book.startedAt, input.explicitStartedAt ? 1 : 0.5),
      kind: 'start',
    })
  }
  if (book.pageCount > 0 || book.currentPage > 0) {
    facts.push({
      ...event('location:0-page', book.lastUpdatedAt, 1),
      kind: 'location',
      position: {
        locator: { kind: 'page', page: book.currentPage },
        ...(book.pageCount > 0
          ? {
              normalizedProgress: book.currentPage / book.pageCount,
              normalization: {
                kind: 'edition-page-count',
                totalPages: book.pageCount,
                confidence: 1,
              },
            }
          : {
              normalization: {
                kind: 'none',
                confidence: 0,
                reason: 'Legacy record has no page count',
              },
            }),
      },
    })
  }
  facts.push({
    ...event('location:1-percent', book.lastUpdatedAt, 1),
    kind: 'location',
    position: {
      locator: { kind: 'percent', fraction: book.progress / 100 },
      normalizedProgress: book.progress / 100,
      normalization: { kind: 'reported-percent', confidence: 1 },
    },
  })
  if (book.finishedAt) {
    facts.push({
      ...event('finish', book.finishedAt, input.explicitFinishedAt ? 1 : 0.5),
      kind: 'finish',
      position: {
        locator: { kind: 'percent', fraction: 1 },
        normalizedProgress: 1,
        normalization: { kind: 'reported-percent', confidence: 1 },
      },
    })
  }
  if (book.rating > 0) {
    facts.push({
      ...event('rating', book.lastUpdatedAt, 1),
      kind: 'rating',
      value: book.rating,
    })
  }
  if (book.notes.length > 0) {
    facts.push({
      ...event('note', book.lastUpdatedAt, 1),
      kind: 'note',
      text: book.notes,
    })
  }

  const parsedFacts = readingEventSchema.array().parse(facts)
  const marker = readingEventSchema.parse({
    ...event('import', book.lastUpdatedAt, 1),
    kind: 'import',
    importedEventIds: parsedFacts.map(({ id }) => id),
    externalBatchKey: book.id,
  })
  return [...parsedFacts, marker]
}

function migratedField(
  target: MetadataTarget,
  field: MetadataField,
  value: JsonValue,
  recordedAt: string,
) {
  return resolveMetadataField(
    metadataCandidateValueSchema.parse({
      kind: 'local',
      target,
      field,
      value,
      recordedAt,
      method: 'legacy-migration',
    }),
  )
}

async function verifyImport(
  database: SqlDatabase,
  imported: Catalog,
  books: readonly LibraryBook[],
): Promise<void> {
  const stored = await new CatalogRepository(database).read()
  for (const [collection, importedRecords] of Object.entries(imported)) {
    const storedRecords = stored[collection as keyof Catalog]
    const storedIds = new Set(storedRecords.map(({ id }) => id))
    for (const { id } of importedRecords) {
      if (!storedIds.has(id)) throw new Error(`Verification could not find ${collection} record ${id}`)
    }
  }
  const storedBooks = new Map(
    (await readLegacyLibraryBooks(database)).map((book) => [book.id, book]),
  )
  for (const book of books) {
    if (JSON.stringify(storedBooks.get(book.id)) !== JSON.stringify(book)) {
      throw new Error(`Verification failed for legacy book ${book.id}`)
    }
  }
}

async function upsertLegacyLibraryBooks(
  database: SqlDatabase,
  books: readonly LibraryBook[],
): Promise<void> {
  for (const [position, book] of books.entries()) {
    await database.run(
      `INSERT INTO library_books(
         id, position, shelf, title_sort, added_at, updated_at, payload_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         position = excluded.position,
         shelf = excluded.shelf,
         title_sort = excluded.title_sort,
         added_at = excluded.added_at,
         updated_at = excluded.updated_at,
         payload_json = excluded.payload_json`,
      [
        book.id,
        position,
        book.shelf,
        book.title,
        book.addedAt,
        book.lastUpdatedAt,
        JSON.stringify(book),
      ],
    )
  }
}

async function readLegacyLibraryBooks(database: SqlDatabase): Promise<LibraryBook[]> {
  const rows = await database.query('SELECT payload_json FROM library_books ORDER BY position, id')
  return rows.map((row) =>
    libraryBookSchema.parse(JSON.parse(readText(row, 'payload_json'))),
  )
}

function listIdForShelf(shelf: ShelfId) {
  return listIdSchema.parse(`list:legacy:${shelf}`)
}

function listName(shelf: ShelfId): string {
  return {
    tbr: 'To Be Read',
    next: 'Up Next',
    reading: 'Reading',
    finished: 'Finished',
    dnf: 'DNF',
  }[shelf]
}

function normalizeAuthor(author: string): string {
  return author.normalize('NFKC').trim().toLocaleLowerCase('en-US')
}

function readLegacySources(storage: LegacyLibraryStorage): LegacySource[] {
  const sources: LegacySource[] = []
  for (const key of LEGACY_LIBRARY_STORAGE_KEYS) {
    const raw = storage.getItem(key)
    if (raw !== null) sources.push({ key, raw })
  }
  return sources
}

function createRecoveryPayload(sources: readonly LegacySource[]): LegacyRecoveryPayload {
  return { format: 'wovenleaf-legacy-library-recovery-v1', sources }
}

function removeVerifiedSources(
  storage: LegacyLibraryStorage,
  sources: readonly LegacySource[],
): string | undefined {
  try {
    for (const { key } of sources) storage.removeItem(key)
    for (const { key } of sources) {
      if (storage.getItem(key) !== null) throw new Error(`storage key ${key} still exists`)
    }
  } catch (error) {
    return `The imported records were verified, but the old key could not be archived: ${errorMessage(error)}`
  }
  return undefined
}

async function readCheckpoint(database: SqlDatabase): Promise<LegacyCheckpoint | undefined> {
  const rows = await database.query<LegacyCheckpointRow>(
    `SELECT source_key, source_checksum, status, source_count, imported_count,
            recovery_payload, error
     FROM legacy_library_migrations
     WHERE migration_key = ?`,
    [LEGACY_LIBRARY_MIGRATION_KEY],
  )
  const row = rows[0]
  if (!row) return undefined
  const status = readText(row, 'status')
  if (status !== 'started' && status !== 'verified' && status !== 'completed' && status !== 'failed') {
    throw new Error(`Unknown legacy migration status ${status}`)
  }
  const sourceCount = row.source_count
  if (sourceCount !== null && typeof sourceCount !== 'number') {
    throw new Error('Legacy migration source count is invalid')
  }
  const error = row.error
  if (error !== null && typeof error !== 'string') {
    throw new Error('Legacy migration error is invalid')
  }
  return {
    sourceKey: readText(row, 'source_key'),
    sourceChecksum: readText(row, 'source_checksum'),
    status,
    ...(sourceCount === null ? {} : { sourceCount }),
    importedCount: readNumber(row, 'imported_count'),
    recoveryPayload: parseRecoveryPayload(readText(row, 'recovery_payload')),
    ...(error === null ? {} : { error }),
  }
}

function parseRecoveryPayload(value: string): LegacyRecoveryPayload {
  return z
    .object({
      format: z.literal('wovenleaf-legacy-library-recovery-v1'),
      sources: z.array(z.object({ key: z.string().min(1), raw: z.string() })),
    })
    .parse(JSON.parse(value))
}

async function markStarted(
  database: SqlDatabase,
  input: {
    readonly sourceKey: string
    readonly sourceChecksum: string
    readonly sourceCount: number
    readonly recoveryPayload: LegacyRecoveryPayload
    readonly timestamp: string
  },
): Promise<void> {
  await database.run(
    `INSERT INTO legacy_library_migrations(
       migration_key, source_key, source_checksum, status, source_count,
       imported_count, recovery_payload, started_at
     ) VALUES (?, ?, ?, 'started', ?, 0, ?, ?)
     ON CONFLICT(migration_key) DO UPDATE SET
       source_key = excluded.source_key,
       source_checksum = excluded.source_checksum,
       status = 'started',
       source_count = excluded.source_count,
       recovery_payload = excluded.recovery_payload,
       started_at = excluded.started_at,
       verified_at = NULL,
       completed_at = NULL,
       error = NULL`,
    [
      LEGACY_LIBRARY_MIGRATION_KEY,
      input.sourceKey,
      input.sourceChecksum,
      input.sourceCount,
      JSON.stringify(input.recoveryPayload),
      input.timestamp,
    ],
  )
  await database.persist()
}

async function recordFailure(
  database: SqlDatabase,
  input: {
    readonly sourceKey: string
    readonly sourceChecksum: string
    readonly sourceCount?: number
    readonly recoveryPayload: LegacyRecoveryPayload
    readonly timestamp: string
    readonly error: string
  },
): Promise<void> {
  await database.run(
    `INSERT INTO legacy_library_migrations(
       migration_key, source_key, source_checksum, status, source_count,
       imported_count, recovery_payload, started_at, error
     ) VALUES (?, ?, ?, 'failed', ?, 0, ?, ?, ?)
     ON CONFLICT(migration_key) DO UPDATE SET
       source_key = excluded.source_key,
       source_checksum = excluded.source_checksum,
       status = 'failed',
       source_count = excluded.source_count,
       recovery_payload = excluded.recovery_payload,
       started_at = excluded.started_at,
       verified_at = NULL,
       completed_at = NULL,
       error = excluded.error`,
    [
      LEGACY_LIBRARY_MIGRATION_KEY,
      input.sourceKey,
      input.sourceChecksum,
      input.sourceCount ?? null,
      JSON.stringify(input.recoveryPayload),
      input.timestamp,
      input.error,
    ],
  )
  await database.persist()
}

async function markCompleted(database: SqlDatabase, timestamp: string): Promise<void> {
  const result = await database.run(
    `UPDATE legacy_library_migrations
     SET status = 'completed', completed_at = ?, error = NULL
     WHERE migration_key = ? AND status IN ('verified', 'completed')`,
    [timestamp, LEGACY_LIBRARY_MIGRATION_KEY],
  )
  if (result.changes !== 1) throw new Error('Legacy migration checkpoint was not completed')
  await database.persist()
}

function mergeRecoverySources(
  current: readonly LegacySource[],
  checkpoint: readonly LegacySource[],
): readonly LegacySource[] {
  const merged = [...current]
  for (const source of checkpoint) {
    if (!merged.some(({ key, raw }) => key === source.key && raw === source.raw)) {
      merged.push(source)
    }
  }
  return merged
}

function recoveryRequired(detail: string, sourceKeys: readonly string[]): LegacyLibraryMigrationResult {
  return {
    status: 'recovery-required',
    message: `${RECOVERY_GUIDANCE} ${detail}`,
    sourceKeys,
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function safeFilename(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '-')
}

function isJson(value: string): boolean {
  try {
    JSON.parse(value)
    return true
  } catch {
    return false
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
