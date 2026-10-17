import { t, getLocale, formatNumber, translateCopy } from '../localization'
import { z } from 'zod'
import { emptyReviewBackup, readReviewBackup, replaceReviewBackup, reviewBackupSchema, type ReviewBackup } from '../reviews/backup'
import {
  assetSchema,
  catalogRecordsSchema,
  catalogSchema,
  readingEventPrivacyPolicy,
  readingEventSchema,
  type Catalog,
  type CatalogRecords,
  type ReadingEvent,
} from '../domain/catalog'
import { libraryBookSchema, type LibraryBook } from '../library-model'
import {
  EMPTY_LIBRARY_ORGANIZATION,
  libraryOrganizationSchema,
  type LibraryOrganization,
} from '../organization-model'
import { savedSmartListSchema, type SavedSmartList } from '../smart-lists/model'
import {
  createDefaultUpNextState,
  upNextStateSchema,
  type UpNextState,
} from '../up-next-model'
import { assertCredentialFree } from '../security'
import {
  readerAnnotationStateSchema,
  readerNavigationStateSchema,
  sortReaderAnnotations,
  type ReaderAnnotationState,
  type ReaderNavigationState,
} from '../reader/model'
import {
  EpubReaderRepository,
  replaceReaderAnnotationStates,
  replaceReaderNavigationStates,
} from '../reader/repository'
import type { ManagedAssetStore, ManagedFileWrite } from '../epub/managed-store'
import {
  CatalogRepository,
  deleteCatalogRecords,
  insertCatalogRecords,
} from './catalog-repository'
import type { SqlDatabase, SqlRow } from './database'
import { readText } from './database'
import {
  readLibraryBooks,
  replaceLibraryBooks,
} from './library-repository'
import { readLibraryOrganization, replaceOrganization } from './organization-repository'
import { readSavedSmartLists, replaceSavedSmartLists } from './smart-list-repository'
import { readUpNextState, replaceUpNextState } from './up-next-repository'

export const PORTABLE_ARCHIVE_FORMAT = 'wovenleaf-portable-library'
export const PORTABLE_ARCHIVE_FORMAT_VERSION = 1
export const PORTABLE_ARCHIVE_SCHEMA_VERSION = 10

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const archiveEntryDescriptorSchema = z.object({
  path: z.string().min(1),
  role: z.enum(['data', 'annotations', 'view', 'asset']),
  mediaType: z.string().min(1),
  encoding: z.enum(['utf8', 'base64']),
  byteSize: z.number().int().nonnegative(),
  sha256: sha256Schema,
  fidelity: z.enum(['canonical', 'lossy']),
}).passthrough()

const portableArchiveManifestSchema = z.object({
  format: z.literal(PORTABLE_ARCHIVE_FORMAT),
  formatVersion: z.number().int().positive(),
  schemaVersion: z.number().int().positive(),
  createdAt: z.iso.datetime({ offset: true }),
  producer: z.object({
    name: z.literal('Wovenleaf'),
    version: z.string().min(1),
  }).passthrough(),
  scope: z.object({
    kind: z.literal('complete-library'),
    bookCount: z.number().int().nonnegative(),
    workCount: z.number().int().nonnegative(),
  }).passthrough(),
  redactions: z.object({
    privateAnnotations: z.enum(['included', 'excluded']),
    sourcePayloads: z.enum(['included', 'excluded']),
    integrationCursors: z.literal('excluded'),
    localAssetHandles: z.literal('excluded'),
    credentialMaterial: z.literal('excluded'),
  }).passthrough(),
  assets: z.object({
    records: z.literal('included'),
    contents: z.enum(['excluded', 'selected']),
    includedIds: z.array(z.string()),
  }).passthrough(),
  exclusions: z.array(z.string()),
  compatibility: z.object({
    minimumReaderFormatVersion: z.number().int().positive(),
    restoreMode: z.literal('replace-after-validation'),
    unknownManifestFields: z.literal('ignored'),
  }).passthrough(),
  entries: z.array(archiveEntryDescriptorSchema).min(3),
}).passthrough()

const portableArchiveEnvelopeSchema = z.object({
  manifest: portableArchiveManifestSchema,
  entries: z.record(z.string(), z.string()),
}).passthrough()

const libraryAnnotationSchema = z.object({
  bookId: z.string().min(1),
  rating: z.number().int().min(0).max(5),
  notes: z.string(),
})

const portableAnnotationsSchema = z.object({
  version: z.literal(1),
  library: z.array(libraryAnnotationSchema),
  readingEvents: z.array(readingEventSchema),
})

const portableEpubImportSchema = z.object({
  id: z.string().min(1),
  contentHash: sha256Schema,
  packageIdentifier: z.string().min(1),
  metadataKey: z.string().min(1),
  packageVersion: z.enum(['2', '3', 'pdf']),
  originalName: z.string().min(1),
  bookId: z.string().min(1),
  editionId: z.string().min(1),
  contentAssetId: z.string().min(1),
  coverAssetId: z.string().min(1).optional(),
  sourceRecordId: z.string().min(1),
  outcome: z.enum(['imported', 'revision']),
  importedAt: z.iso.datetime({ offset: true }),
  payload: z.record(z.string(), z.unknown()),
})

export type PortableEpubImport = z.infer<typeof portableEpubImportSchema>

export type PortableArchiveManifest = z.infer<typeof portableArchiveManifestSchema>

export type PortableAssetContent = {
  readonly assetId: string
  readonly filename: string
  readonly mediaType: string
  readonly bytes: Uint8Array
}

export type PortableArchiveOptions = {
  readonly reviews?: ReviewBackup
  readonly includeAnnotations?: boolean
  readonly includeSourcePayloads?: boolean
  readonly assetContents?: readonly PortableAssetContent[]
  readonly epubImports?: readonly PortableEpubImport[]
  readonly createdAt?: string
  readonly producerVersion?: string
}

export type PortableArchiveBundle = {
  readonly archive: string
  readonly csv: string
  readonly markdown: string
  readonly filenameStem: string
  readonly manifest: PortableArchiveManifest
}

export type PortableArchiveInspection = {
  readonly reviews: ReviewBackup
  readonly manifest: PortableArchiveManifest
  readonly catalog: Catalog
  readonly books: readonly LibraryBook[]
  readonly organization: LibraryOrganization
  readonly upNext: UpNextState
  readonly smartLists: readonly SavedSmartList[]
  readonly readerNavigation: readonly ReaderNavigationState[]
  readonly readerAnnotations: readonly ReaderAnnotationState[]
  readonly epubImports: readonly PortableEpubImport[]
  readonly assetContents: readonly PortableAssetContent[]
}

export class PortableArchiveIntegrityError extends Error {
  readonly entryPath: string

  constructor(entryPath: string, reason: string) {
    super(`Portable archive entry ${entryPath} failed integrity validation: ${reason}`)
    this.name = 'PortableArchiveIntegrityError'
    this.entryPath = entryPath
  }
}

export class PortableArchiveCompatibilityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PortableArchiveCompatibilityError'
  }
}

export class PortableArchiveService {
  readonly #database: SqlDatabase
  readonly #epubAssetStore?: ManagedAssetStore

  constructor(database: SqlDatabase, options: { readonly epubAssetStore?: ManagedAssetStore } = {}) {
    this.#database = database
    this.#epubAssetStore = options.epubAssetStore
  }

  async create(options: PortableArchiveOptions = {}): Promise<PortableArchiveBundle> {
    return this.#database.transaction(async database => {
      const [catalog, books, organization, upNext, smartLists, readerNavigation, readerAnnotations, epubImports, reviews] = await Promise.all([
        new CatalogRepository(database).read(),
        readLibraryBooks(database),
        readLibraryOrganization(database),
        readUpNextState(database),
        readSavedSmartLists(database),
        new EpubReaderRepository(database).allNavigationStates(),
        new EpubReaderRepository(database).allAnnotationStates(),
        readPortableEpubImports(database),
        readReviewBackup(database),
      ])
      return createPortableArchive(
        catalog,
        books,
        { ...options, epubImports, reviews },
        organization,
        upNext,
        smartLists,
        readerNavigation,
        readerAnnotations,
      )
    })
  }

  async inspect(serializedArchive: string): Promise<PortableArchiveInspection> {
    return inspectPortableArchive(serializedArchive)
  }

  async restore(
    serializedArchive: string,
  ): Promise<PortableArchiveInspection> {
    const inspected = await this.inspect(serializedArchive)
    const restored = await restoreIncludedEpubAssets(inspected, this.#epubAssetStore)
    try {
      await this.#database.transaction(async (database) => {
        const erasureTable = await database.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'private_erasure_pending'")
        if (erasureTable.length && (await database.query('SELECT id FROM private_erasure_pending')).length) throw new Error('Finish private erasure cleanup before restoring an archive')
        await replaceReaderNavigationStates(database, [])
        await replaceReaderAnnotationStates(database, [])
        await deleteCatalogRecords(database)
        await replaceLibraryBooks(database, restored.inspection.books)
        await insertCatalogRecords(database, restored.inspection.catalog)
        await insertPortableEpubImports(database, restored.inspection.epubImports)
        await replaceOrganization(database, restored.inspection.organization)
        await replaceUpNextState(database, restored.inspection.upNext)
        await replaceSavedSmartLists(database, restored.inspection.smartLists)
        await replaceReviewBackup(database, restored.inspection.reviews)
        await replaceReaderNavigationStates(database, restored.inspection.readerNavigation)
        await replaceReaderAnnotationStates(database, restored.inspection.readerAnnotations)
      })
      return restored.inspection
    } catch (error) {
      await Promise.all(restored.writes.filter(({ created }) => created).map(({ relativePath }) =>
        this.#epubAssetStore?.remove(relativePath),
      ))
      throw error
    }
  }
}

type PortableEpubImportRow = SqlRow & {
  readonly id: string
  readonly content_hash: string
  readonly package_identifier: string
  readonly metadata_key: string
  readonly package_version: string
  readonly original_name: string
  readonly book_id: string
  readonly edition_id: string
  readonly content_asset_id: string
  readonly cover_asset_id: string | null
  readonly source_record_id: string
  readonly outcome: string
  readonly imported_at: string
  readonly payload_json: string
}

async function readPortableEpubImports(database: SqlDatabase): Promise<PortableEpubImport[]> {
  const rows = await database.query<PortableEpubImportRow>(
    `SELECT id, content_hash, package_identifier, metadata_key, package_version, original_name,
            book_id, edition_id, content_asset_id, cover_asset_id, source_record_id,
            outcome, imported_at, payload_json
     FROM epub_imports ORDER BY imported_at, id`,
  )
  return rows.map((row) => portableEpubImportSchema.parse({
    id: readText(row, 'id'),
    contentHash: readText(row, 'content_hash'),
    packageIdentifier: readText(row, 'package_identifier'),
    metadataKey: readText(row, 'metadata_key'),
    packageVersion: readText(row, 'package_version'),
    originalName: readText(row, 'original_name'),
    bookId: readText(row, 'book_id'),
    editionId: readText(row, 'edition_id'),
    contentAssetId: readText(row, 'content_asset_id'),
    ...(row.cover_asset_id === null ? {} : { coverAssetId: readText(row, 'cover_asset_id') }),
    sourceRecordId: readText(row, 'source_record_id'),
    outcome: readText(row, 'outcome'),
    importedAt: readText(row, 'imported_at'),
    payload: JSON.parse(readText(row, 'payload_json')),
  }))
}

async function insertPortableEpubImports(
  database: SqlDatabase,
  imports: readonly PortableEpubImport[],
): Promise<void> {
  for (const item of portableEpubImportSchema.array().parse(imports)) {
    await database.run(
      `INSERT INTO epub_imports(
         id, content_hash, package_identifier, metadata_key, package_version, original_name,
         book_id, edition_id, content_asset_id, cover_asset_id, source_record_id,
         outcome, imported_at, payload_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item.id,
        item.contentHash,
        item.packageIdentifier,
        item.metadataKey,
        item.packageVersion,
        item.originalName,
        item.bookId,
        item.editionId,
        item.contentAssetId,
        item.coverAssetId ?? null,
        item.sourceRecordId,
        item.outcome,
        item.importedAt,
        JSON.stringify(item.payload),
      ],
    )
  }
}

async function restoreIncludedEpubAssets(
  inspection: PortableArchiveInspection,
  store?: ManagedAssetStore,
): Promise<{ readonly inspection: PortableArchiveInspection; readonly writes: readonly ManagedFileWrite[] }> {
  if (!store) return { inspection, writes: [] }
  const contentById = new Map(inspection.assetContents.map((content) => [content.assetId, content]))
  const writes: ManagedFileWrite[] = []
  const assets = []
  try {
    for (const asset of inspection.catalog.assets) {
      const content = contentById.get(asset.id)
      if (!['epub', 'pdf'].includes(asset.format)) {
        assets.push(asset)
        continue
      }
      const expected = asset.location.kind === 'missing'
        ? asset.location.fingerprint?.replace(/^sha256:/, '')
        : undefined
      const fingerprint = content ? await sha256Hex(content.bytes) : expected
      if (!fingerprint || (expected && expected !== fingerprint)) {
        if (!content) {
          assets.push(asset)
          continue
        }
        throw new PortableArchiveIntegrityError(
          `assets/${encodeURIComponent(asset.id)}`,
          'Book bytes do not match the catalog fingerprint',
        )
      }
      const relativePath = `assets/${asset.format}/${fingerprint}.${asset.format}`
      const current = await store.read(relativePath)
      if (!content && (!current || await sha256Hex(current) !== fingerprint)) {
        assets.push(asset)
        continue
      }
      if (content) {
        const write = current && await sha256Hex(current) === fingerprint
          ? { relativePath, created: false }
          : await store.replaceAtomically(relativePath, content.bytes)
        writes.push(write)
      }
      assets.push(assetSchema.parse({
        ...asset,
        location: {
          kind: 'managed-file',
          relativePath,
          sha256: fingerprint,
          byteSize: content?.bytes.byteLength ?? current?.byteLength ?? 0,
        },
      }))
    }
    return {
      inspection: {
        ...inspection,
        catalog: catalogSchema.parse({ ...inspection.catalog, assets }),
      },
      writes,
    }
  } catch (error) {
    await Promise.all(writes.filter(({ created }) => created).map(({ relativePath }) => store.remove(relativePath)))
    throw error
  }
}

export async function createPortableArchive(
  catalogInput: Catalog,
  libraryInput: readonly LibraryBook[],
  options: PortableArchiveOptions = {},
  organizationInput: LibraryOrganization = EMPTY_LIBRARY_ORGANIZATION,
  upNextInput: UpNextState = createDefaultUpNextState(options.createdAt),
  smartListsInput: readonly SavedSmartList[] = [],
  readerNavigationInput: readonly ReaderNavigationState[] = [],
  readerAnnotationInput: readonly ReaderAnnotationState[] = [],
): Promise<PortableArchiveBundle> {
  const includeAnnotations = options.includeAnnotations ?? true
  const reviews = reviewBackupSchema.parse(includeAnnotations ? options.reviews ?? emptyReviewBackup() : emptyReviewBackup())
  const includeSourcePayloads = options.includeSourcePayloads ?? false
  const createdAt = options.createdAt ?? new Date().toISOString()
  const catalog = preparePortableCatalog(catalogInput, {
    includeAnnotations,
    includeSourcePayloads,
  })
  const books = libraryBookSchema.array().parse(libraryInput)
  validateReadingEditionLinks(catalog, books)
  const organization = libraryOrganizationSchema.parse(organizationInput)
  const upNext = upNextStateSchema.parse(upNextInput)
  const smartLists = savedSmartListSchema.array().parse(smartListsInput)
  const readerNavigation = readerNavigationStateSchema.array().parse(
    options.includeAnnotations === false ? [] : readerNavigationInput,
  )
  const readerAnnotations = readerAnnotationStateSchema.array().parse(
    options.includeAnnotations === false ? [] : readerAnnotationInput,
  )
  const epubImports = portableEpubImportSchema.array().parse(options.epubImports ?? [])
  const portableOrganization = includeAnnotations
    ? organization
    : libraryOrganizationSchema.parse({
        ...organization,
        shelves: organization.shelves.map((shelf) => ({ ...shelf, notes: '' })),
      })
  const libraryData = books.map(({ notes: _notes, rating: _rating, ...book }) => ({
    ...book,
    notes: '',
    rating: 0,
  }))
  const readingAnnotations = catalog.readingEvents.filter(isAnnotationEvent)
  const coreCatalog = catalogRecordsSchema.parse({
    ...catalog,
    readingEvents: catalog.readingEvents.filter((event) => !isAnnotationEvent(event)),
  })
  const annotations = portableAnnotationsSchema.parse({
    version: 1,
    library: includeAnnotations
      ? books.map(({ id, rating, notes }) => ({ bookId: id, rating, notes }))
      : [],
    readingEvents: includeAnnotations ? readingAnnotations : [],
  })
  const readableBooks = includeAnnotations ? books : libraryData
  const csv = createLibraryCsv(readableBooks)
  const markdown = createLibraryMarkdown(readableBooks, createdAt, readerAnnotations)
  const assetContents = validateAssetContents(catalog, options.assetContents ?? [])

  assertCredentialFree({
    reviews,
    catalog: coreCatalog,
    annotations,
    library: libraryData,
    organization: portableOrganization,
    upNext,
    smartLists,
    readerNavigation,
    readerAnnotations,
    epubImports,
  })

  const entries: Record<string, string> = {}
  const descriptors: Array<z.infer<typeof archiveEntryDescriptorSchema>> = []
  await addTextEntry(entries, descriptors, { path: 'data/reviews.json', role: 'annotations', mediaType: 'application/json', fidelity: 'canonical', contents: canonicalStringify(reviews) })
  await addTextEntry(entries, descriptors, {
    path: 'data/catalog.json',
    role: 'data',
    mediaType: 'application/json',
    fidelity: 'canonical',
    contents: canonicalStringify(coreCatalog),
  })
  await addTextEntry(entries, descriptors, {
    path: 'data/library.json',
    role: 'data',
    mediaType: 'application/json',
    fidelity: 'canonical',
    contents: canonicalStringify(libraryData),
  })
  await addTextEntry(entries, descriptors, {
    path: 'data/organization.json',
    role: 'data',
    mediaType: 'application/json',
    fidelity: 'canonical',
    contents: canonicalStringify(portableOrganization),
  })
  await addTextEntry(entries, descriptors, {
    path: 'data/up-next.json',
    role: 'data',
    mediaType: 'application/json',
    fidelity: 'canonical',
    contents: canonicalStringify(upNext),
  })
  await addTextEntry(entries, descriptors, {
    path: 'data/smart-lists.json',
    role: 'data',
    mediaType: 'application/json',
    fidelity: 'canonical',
    contents: canonicalStringify(smartLists),
  })
  await addTextEntry(entries, descriptors, {
    path: 'data/epub-assets.json',
    role: 'data',
    mediaType: 'application/json',
    fidelity: 'canonical',
    contents: canonicalStringify(epubImports),
  })
  await addTextEntry(entries, descriptors, {
    path: 'data/reader-navigation.json',
    role: 'annotations',
    mediaType: 'application/json',
    fidelity: 'canonical',
    contents: canonicalStringify(readerNavigation),
  })
  await addTextEntry(entries, descriptors, {
    path: 'data/reader-annotations.json',
    role: 'annotations',
    mediaType: 'application/json',
    fidelity: 'canonical',
    contents: canonicalStringify(readerAnnotations),
  })
  await addTextEntry(entries, descriptors, {
    path: 'annotations/reading.json',
    role: 'annotations',
    mediaType: 'application/json',
    fidelity: 'canonical',
    contents: canonicalStringify(annotations),
  })
  await addTextEntry(entries, descriptors, {
    path: 'views/library.csv',
    role: 'view',
    mediaType: 'text/csv',
    fidelity: 'lossy',
    contents: csv,
  })
  await addTextEntry(entries, descriptors, {
    path: 'views/reading-journal.md',
    role: 'view',
    mediaType: 'text/markdown',
    fidelity: 'lossy',
    contents: markdown,
  })
  for (const asset of assetContents) {
    await addBinaryEntry(entries, descriptors, asset)
  }

  const manifest = portableArchiveManifestSchema.parse({
    format: PORTABLE_ARCHIVE_FORMAT,
    formatVersion: PORTABLE_ARCHIVE_FORMAT_VERSION,
    schemaVersion: PORTABLE_ARCHIVE_SCHEMA_VERSION,
    createdAt,
    producer: { name: 'Wovenleaf', version: options.producerVersion ?? '0.0.0' },
    scope: {
      kind: 'complete-library',
      bookCount: books.length,
      workCount: catalog.works.length,
      customShelfCount: organization.shelves.length,
      tagCount: organization.tags.length,
      smartListCount: smartLists.length,
    },
    redactions: {
      privateAnnotations: includeAnnotations ? 'included' : 'excluded',
      sourcePayloads: includeSourcePayloads ? 'included' : 'excluded',
      integrationCursors: 'excluded',
      localAssetHandles: 'excluded',
      credentialMaterial: 'excluded',
    },
    assets: {
      records: 'included',
      contents: assetContents.length ? 'selected' : 'excluded',
      includedIds: assetContents.map(({ assetId }) => assetId),
    },
    exclusions: [
      ...(!includeAnnotations ? ['saved quarterly reviews, identities, progress and private review settings'] : []),
      'credential-vault material',
      'device-local asset paths, security-scoped file bookmarks, and expired remote links',
      'SQLite and IndexedDB implementation details',
      'import staging, checkpoints, receipts, and other rebuildable cache',
      'sync marker events and opaque integration cursors',
      assetContents.length
        ? 'asset bytes not explicitly selected by the user'
        : 'cover, ebook, audiobook, and supplement bytes',
    ],
    compatibility: {
      minimumReaderFormatVersion: 1,
      restoreMode: 'replace-after-validation',
      unknownManifestFields: 'ignored',
    },
    entries: descriptors,
  })
  const envelope = portableArchiveEnvelopeSchema.parse({ manifest, entries })
  const filenameStem = `wovenleaf-library-${createdAt.slice(0, 10)}`

  return {
    archive: JSON.stringify(envelope, null, 2),
    csv,
    markdown,
    filenameStem,
    manifest,
  }
}

export async function inspectPortableArchive(
  serializedArchive: string,
): Promise<PortableArchiveInspection> {
  let unknownArchive: unknown
  try {
    unknownArchive = JSON.parse(serializedArchive)
  } catch {
    throw new PortableArchiveIntegrityError('archive.json', 'invalid JSON envelope')
  }

  const parsed = portableArchiveEnvelopeSchema.safeParse(unknownArchive)
  if (!parsed.success) {
    throw new PortableArchiveIntegrityError('manifest', parsed.error.issues[0]?.message ?? 'invalid')
  }
  const archive = parsed.data
  if (archive.manifest.formatVersion > PORTABLE_ARCHIVE_FORMAT_VERSION) {
    throw new PortableArchiveCompatibilityError(
      `Archive format ${archive.manifest.formatVersion} is newer than supported format ${PORTABLE_ARCHIVE_FORMAT_VERSION}`,
    )
  }
  if (archive.manifest.formatVersion < PORTABLE_ARCHIVE_FORMAT_VERSION) {
    throw new PortableArchiveCompatibilityError(
      `Archive format ${archive.manifest.formatVersion} has no registered upgrade path`,
    )
  }
  if (archive.manifest.schemaVersion > PORTABLE_ARCHIVE_SCHEMA_VERSION) {
    throw new PortableArchiveCompatibilityError(
      `Archive schema ${archive.manifest.schemaVersion} is newer than supported schema ${PORTABLE_ARCHIVE_SCHEMA_VERSION}`,
    )
  }
  if (archive.manifest.schemaVersion < 1) {
    throw new PortableArchiveCompatibilityError(
      `Archive schema ${archive.manifest.schemaVersion} has no registered upgrade path`,
    )
  }

  const descriptorPaths = new Set<string>()
  for (const descriptor of archive.manifest.entries) {
    if (descriptorPaths.has(descriptor.path)) {
      throw new PortableArchiveIntegrityError(descriptor.path, 'duplicate manifest entry')
    }
    descriptorPaths.add(descriptor.path)
    const contents = archive.entries[descriptor.path]
    if (contents === undefined) {
      throw new PortableArchiveIntegrityError(descriptor.path, 'entry is missing')
    }
    const bytes = descriptor.encoding === 'base64'
      ? decodeBase64(contents, descriptor.path)
      : new TextEncoder().encode(contents)
    if (bytes.byteLength !== descriptor.byteSize) {
      throw new PortableArchiveIntegrityError(
        descriptor.path,
        `expected ${descriptor.byteSize} bytes but found ${bytes.byteLength}`,
      )
    }
    if (await sha256Hex(bytes) !== descriptor.sha256) {
      throw new PortableArchiveIntegrityError(descriptor.path, 'SHA-256 checksum mismatch')
    }
  }
  for (const path of Object.keys(archive.entries)) {
    if (!descriptorPaths.has(path)) {
      throw new PortableArchiveIntegrityError(path, 'entry is not declared in the manifest')
    }
  }

  const coreCatalog = parseJsonEntry(
    archive,
    'data/catalog.json',
    catalogRecordsSchema,
  )
  const libraryData = parseJsonEntry(
    archive,
    'data/library.json',
    libraryBookSchema.array(),
  )
  const annotations = parseJsonEntry(
    archive,
    'annotations/reading.json',
    portableAnnotationsSchema,
  )
  const organization = archive.manifest.schemaVersion >= 2
    ? parseJsonEntry(archive, 'data/organization.json', libraryOrganizationSchema)
    : EMPTY_LIBRARY_ORGANIZATION
  const upNext = archive.manifest.schemaVersion >= 3
    ? parseJsonEntry(archive, 'data/up-next.json', upNextStateSchema)
    : createDefaultUpNextState(archive.manifest.createdAt)
  const smartLists = archive.manifest.schemaVersion >= 4
    ? parseJsonEntry(archive, 'data/smart-lists.json', savedSmartListSchema.array())
    : []
  const readerNavigation = archive.manifest.schemaVersion >= 5
    ? parseJsonEntry(archive, 'data/reader-navigation.json', readerNavigationStateSchema.array())
    : []
  const readerAnnotations = archive.manifest.schemaVersion >= 6
    ? parseJsonEntry(archive, 'data/reader-annotations.json', readerAnnotationStateSchema.array())
    : []
  const epubImports = archive.manifest.schemaVersion >= 7
    ? parseJsonEntry(archive, 'data/epub-assets.json', portableEpubImportSchema.array())
    : []
  const reviews = archive.manifest.schemaVersion >= 10
    ? parseJsonEntry(archive, 'data/reviews.json', reviewBackupSchema) : emptyReviewBackup()
  if (archive.manifest.redactions.privateAnnotations === 'excluded' && canonicalStringify(reviews) !== canonicalStringify(emptyReviewBackup())) throw new PortableArchiveIntegrityError('data/reviews.json', 'Private reviews must be absent from a redacted export')
  const catalog = parseCatalogEntries(coreCatalog, annotations.readingEvents)
  const books = mergeLibraryAnnotations(
    libraryData,
    annotations.library,
    archive.manifest.redactions.privateAnnotations,
  )
  validateReadingEditionLinks(catalog, books)
  const assetContents = validateRestoredAssets(
    catalog,
    archive.manifest,
    archive.entries,
  )

  assertCredentialFree({ catalog, books, organization, upNext, smartLists, readerNavigation, readerAnnotations, epubImports, reviews })
  return {
    manifest: archive.manifest,
    reviews,
    catalog,
    books,
    organization,
    upNext,
    smartLists,
    readerNavigation,
    readerAnnotations,
    epubImports,
    assetContents,
  }
}

function preparePortableCatalog(
  catalogInput: Catalog,
  options: { readonly includeAnnotations: boolean; readonly includeSourcePayloads: boolean },
): Catalog {
  const catalog = catalogSchema.parse(catalogInput)
  const events = filterPortableEvents(catalog.readingEvents, options.includeAnnotations)
  const eventIds = new Set(events.map(({ id }) => id))
  const checkpoints = neededCheckpoints(catalog, events).map(({ opaqueCursor: _cursor, ...value }) => value)
  const sourceRecords = catalog.sourceRecords.map((record) => {
    if (options.includeSourcePayloads) return record
    const { rawPayload: _rawPayload, ...portableRecord } = record
    return portableRecord
  })
  const assets = catalog.assets.map((asset) => {
    if (asset.location.kind === 'managed-file') {
      return {
        ...asset,
        location: {
          kind: 'missing' as const,
          fingerprint: `sha256:${asset.location.sha256}`,
          lastKnownName: asset.location.relativePath.split('/').at(-1) ?? 'asset',
        },
      }
    }
    if (asset.location.kind === 'managed-bundle' || asset.location.kind === 'linked-bundle') {
      return {
        ...asset,
        location: {
          kind: 'missing' as const,
          fingerprint: `sha256:${asset.location.fingerprint}`,
          lastKnownName: asset.location.kind === 'linked-bundle' ? asset.location.lastKnownName : asset.location.relativePath.split('/').at(-1) ?? 'audiobook',
        },
      }
    }
    if (asset.location.kind === 'linked-file') {
      return {
        ...asset,
        location: {
          kind: 'missing' as const,
          fingerprint: asset.location.fingerprint,
          lastKnownName: asset.location.lastKnownName,
        },
      }
    }
    if (asset.location.kind === 'remote' && asset.location.expiresAt) {
      return {
        ...asset,
        location: {
          kind: 'missing' as const,
          lastKnownName: portableRemoteName(asset.location.uri),
        },
      }
    }
    return asset
  })

  return catalogSchema.parse({
    ...catalog,
    assets,
    sourceRecords,
    integrationCheckpoints: checkpoints,
    readingEvents: events,
    progressSnapshots: catalog.progressSnapshots.filter(
      (snapshot) => !snapshot.sourceEventId || eventIds.has(snapshot.sourceEventId),
    ),
  })
}

function portableRemoteName(uri: string): string {
  try {
    const pathname = new URL(uri).pathname
    return decodeURIComponent(pathname.split('/').filter(Boolean).at(-1) ?? 'remote asset')
  } catch {
    return 'remote asset'
  }
}

function filterPortableEvents(
  events: readonly ReadingEvent[],
  includeAnnotations: boolean,
): ReadingEvent[] {
  let retained = events.filter((event) =>
    readingEventPrivacyPolicy[event.kind].portableExport === 'include' &&
    (includeAnnotations || !isAnnotationEvent(event)),
  )
  let retainedIds = new Set<string>(retained.map(({ id }) => id))

  while (true) {
    const next = retained.filter((event) =>
      referencedEventIds(event).every((id) => retainedIds.has(id)),
    )
    if (next.length === retained.length) return next
    retained = next
    retainedIds = new Set<string>(retained.map(({ id }) => id))
  }
}

function neededCheckpoints(catalog: Catalog, events: readonly ReadingEvent[]) {
  const byId = new Map(catalog.integrationCheckpoints.map((checkpoint) => [checkpoint.id, checkpoint]))
  const needed = new Set(events.flatMap((event) =>
    event.integrationCheckpointId ? [event.integrationCheckpointId] : [],
  ))
  const queue = [...needed]
  while (queue.length) {
    const checkpoint = byId.get(queue.pop()!)
    if (checkpoint?.previousCheckpointId && !needed.has(checkpoint.previousCheckpointId)) {
      needed.add(checkpoint.previousCheckpointId)
      queue.push(checkpoint.previousCheckpointId)
    }
  }
  return catalog.integrationCheckpoints.filter(({ id }) => needed.has(id))
}

function referencedEventIds(event: ReadingEvent): readonly string[] {
  if (event.kind === 'import') return event.importedEventIds
  if (event.kind === 'sync') return event.syncedEventIds
  if (event.kind === 'correction') return event.targetEventIds
  return []
}

function isAnnotationEvent(event: ReadingEvent): boolean {
  return event.kind === 'note' || event.kind === 'rating'
}

function parseCatalogEntries(
  records: CatalogRecords,
  annotationEvents: readonly ReadingEvent[],
): Catalog {
  return catalogSchema.parse({
    ...records,
    readingEvents: [...records.readingEvents, ...annotationEvents],
  })
}

function mergeLibraryAnnotations(
  books: readonly LibraryBook[],
  annotations: readonly z.infer<typeof libraryAnnotationSchema>[],
  policy: 'included' | 'excluded',
): LibraryBook[] {
  if (policy === 'excluded' && annotations.length) {
    throw new PortableArchiveIntegrityError(
      'annotations/reading.json',
      'manifest excludes private annotations but annotation rows are present',
    )
  }
  const annotationsByBook = new Map<string, z.infer<typeof libraryAnnotationSchema>>()
  for (const annotation of annotations) {
    if (annotationsByBook.has(annotation.bookId)) {
      throw new PortableArchiveIntegrityError(
        'annotations/reading.json',
        `duplicate annotation row for ${annotation.bookId}`,
      )
    }
    annotationsByBook.set(annotation.bookId, annotation)
  }
  const bookIds = new Set(books.map(({ id }) => id))
  for (const id of annotationsByBook.keys()) {
    if (!bookIds.has(id)) {
      throw new PortableArchiveIntegrityError(
        'annotations/reading.json',
        `annotation row references missing book ${id}`,
      )
    }
  }
  if (policy === 'included' && annotationsByBook.size !== books.length) {
    throw new PortableArchiveIntegrityError(
      'annotations/reading.json',
      'included annotations must contain one row per library book',
    )
  }

  return libraryBookSchema.array().parse(books.map((book) => ({
    ...book,
    rating: annotationsByBook.get(book.id)?.rating ?? 0,
    notes: annotationsByBook.get(book.id)?.notes ?? '',
  })))
}

function parseJsonEntry<Schema extends z.ZodType>(
  archive: z.infer<typeof portableArchiveEnvelopeSchema>,
  path: string,
  schema: Schema,
): z.infer<Schema> {
  const contents = archive.entries[path]
  if (contents === undefined) {
    throw new PortableArchiveIntegrityError(path, 'required entry is missing')
  }
  try {
    return schema.parse(JSON.parse(contents))
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'invalid JSON data'
    throw new PortableArchiveIntegrityError(path, reason)
  }
}

function validateAssetContents(
  catalog: Catalog,
  assetContents: readonly PortableAssetContent[],
): PortableAssetContent[] {
  const knownIds = new Set<string>(catalog.assets.map(({ id }) => id))
  const seen = new Set<string>()
  return assetContents.map((asset) => {
    if (!knownIds.has(asset.assetId)) {
      throw new Error(`Cannot export bytes for unknown Asset ${asset.assetId}`)
    }
    if (seen.has(asset.assetId)) {
      throw new Error(`Asset ${asset.assetId} was selected more than once`)
    }
    seen.add(asset.assetId)
    if (!asset.filename.trim()) throw new Error(`Asset ${asset.assetId} needs a filename`)
    return { ...asset, bytes: new Uint8Array(asset.bytes) }
  })
}

function validateRestoredAssets(
  catalog: Catalog,
  manifest: PortableArchiveManifest,
  entries: Readonly<Record<string, string>>,
): PortableAssetContent[] {
  const knownIds = new Set<string>(catalog.assets.map(({ id }) => id))
  const seen = new Set<string>()
  const assets = manifest.entries
    .filter((entry) => entry.role === 'asset')
    .map((entry) => {
      if (entry.encoding !== 'base64' || entry.fidelity !== 'canonical') {
        throw new PortableArchiveIntegrityError(
          entry.path,
          'asset entries must be canonical base64 payloads',
        )
      }
      const assetId = assetIdFromPath(entry.path)
      if (!knownIds.has(assetId)) {
        throw new PortableArchiveIntegrityError(entry.path, `unknown Asset ${assetId}`)
      }
      if (seen.has(assetId)) {
        throw new PortableArchiveIntegrityError(entry.path, `duplicate bytes for Asset ${assetId}`)
      }
      seen.add(assetId)
      return {
        assetId,
        filename: entry.path.split('/').at(-1) ?? 'asset',
        mediaType: entry.mediaType,
        bytes: decodeBase64(entries[entry.path], entry.path),
      }
    })
  const declaredIds = [...manifest.assets.includedIds].sort()
  const actualIds = assets.map(({ assetId }) => assetId).sort()
  if (JSON.stringify(declaredIds) !== JSON.stringify(actualIds)) {
    throw new PortableArchiveIntegrityError(
      'manifest.assets',
      'included Asset IDs do not match asset entries',
    )
  }
  if (
    (manifest.assets.contents === 'selected' && assets.length === 0) ||
    (manifest.assets.contents === 'excluded' && assets.length > 0)
  ) {
    throw new PortableArchiveIntegrityError(
      'manifest.assets',
      'asset content policy does not match asset entries',
    )
  }
  return assets
}

async function addTextEntry(
  entries: Record<string, string>,
  descriptors: Array<z.infer<typeof archiveEntryDescriptorSchema>>,
  entry: {
    readonly path: string
    readonly role: 'data' | 'annotations' | 'view'
    readonly mediaType: string
    readonly fidelity: 'canonical' | 'lossy'
    readonly contents: string
  },
) {
  const bytes = new TextEncoder().encode(entry.contents)
  entries[entry.path] = entry.contents
  descriptors.push({
    path: entry.path,
    role: entry.role,
    mediaType: entry.mediaType,
    encoding: 'utf8',
    byteSize: bytes.byteLength,
    sha256: await sha256Hex(bytes),
    fidelity: entry.fidelity,
  })
}

async function addBinaryEntry(
  entries: Record<string, string>,
  descriptors: Array<z.infer<typeof archiveEntryDescriptorSchema>>,
  asset: PortableAssetContent,
) {
  const safeFilename = asset.filename.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'asset'
  const path = `assets/${encodeURIComponent(asset.assetId)}/${safeFilename}`
  entries[path] = encodeBase64(asset.bytes)
  descriptors.push({
    path,
    role: 'asset',
    mediaType: asset.mediaType,
    encoding: 'base64',
    byteSize: asset.bytes.byteLength,
    sha256: await sha256Hex(asset.bytes),
    fidelity: 'canonical',
  })
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digestBytes = new Uint8Array(bytes.byteLength)
  digestBytes.set(bytes)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', digestBytes.buffer)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

function decodeBase64(contents: string, path: string): Uint8Array {
  try {
    const binary = atob(contents)
    return Uint8Array.from(binary, (character) => character.charCodeAt(0))
  } catch {
    throw new PortableArchiveIntegrityError(path, 'invalid base64 contents')
  }
}

function assetIdFromPath(path: string): string {
  const encodedId = path.split('/')[1]
  if (!encodedId) throw new PortableArchiveIntegrityError(path, 'asset path has no Asset ID')
  try {
    return decodeURIComponent(encodedId)
  } catch {
    throw new PortableArchiveIntegrityError(path, 'asset path has an invalid Asset ID')
  }
}

function canonicalStringify(value: unknown): string {
  return JSON.stringify(sortJson(value))
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortJson(item)]),
    )
  }
  return value
}

export function createLibraryCsv(books: readonly LibraryBook[]): string {
  const rows = [
    [
      'Title',
      'Authors',
      'Shelf',
      'Progress',
      'Current Page',
      'Page Count',
      'Rating',
      'Notes',
      'Added At',
      'Started At',
      'Finished At',
      'Updated At',
    ],
    ...books.map((book) => [
      book.title,
      book.authors.join('; '),
      book.shelf,
      String(book.progress),
      String(book.currentPage),
      String(book.pageCount),
      book.rating ? String(book.rating) : '',
      book.notes,
      book.addedAt,
      book.startedAt ?? '',
      book.finishedAt ?? '',
      book.lastUpdatedAt,
    ]),
  ]
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

export function createLibraryMarkdown(
  books: readonly LibraryBook[],
  createdAt = new Date().toISOString(),
  annotationStates: readonly ReaderAnnotationState[] = [],
): string {
  const shelfLabels: Record<LibraryBook['shelf'], string> = {
    tbr: t("To Be Read"),
    next: t("Up Next"),
    reading: t("Reading"),
    finished: t("Finished"),
    dnf: t("DNF"),
  }
  const lines = [
    '# ' + t("Wovenleaf Reading Journal"),
    '',
    '> ' + t("Human-readable view only. This Markdown omits canonical IDs, provenance, relationships, checksums, and restore metadata. Keep the portable JSON archive for a lossless move."),
    '',
    t("Exported {{date}}", { date: new Date(createdAt).toLocaleString(getLocale()) }),
  ]

  for (const shelf of ['tbr', 'next', 'reading', 'finished', 'dnf'] as const) {
    const shelfBooks = books.filter((book) => book.shelf === shelf)
    lines.push('', `## ${shelfLabels[shelf]} (${formatNumber(shelfBooks.length)})`)
    if (!shelfBooks.length) {
      lines.push('', '_' + t("No books on this shelf.") + '_')
      continue
    }
    for (const book of shelfBooks) {
      lines.push('', `### ${escapeMarkdown(book.title)}`)
      lines.push('', `- ${book.authors.length === 1 ? t("Author") : t("Authors")}: ${book.authors.map(escapeMarkdown).join(', ')}`)
      if (book.pageCount) lines.push('- ' + t("Pages: {{current}} of {{total}} ({{progress}}%)", { current: formatNumber(book.currentPage), total: formatNumber(book.pageCount), progress: formatNumber(book.progress) }))
      else lines.push('- ' + t("Progress: {{value}}%", { value: formatNumber(book.progress) }))
      if (book.rating) lines.push('- ' + t("Rating: {{value}}/5", { value: formatNumber(book.rating) }))
      if (book.notes) lines.push('', book.notes)
    }
  }

  const bookById = new Map(books.map((book) => [book.id, book]))
  const highlights = annotationStates
    .flatMap((state) => sortReaderAnnotations(state.annotations))
    .filter(({ deletedAt }) => deletedAt === undefined)
    .sort((left, right) => {
      const leftTitle = bookById.get(left.bookId)?.title ?? left.bookId
      const rightTitle = bookById.get(right.bookId)?.title ?? right.bookId
      return leftTitle.localeCompare(rightTitle)
        || (left.chapter ?? '').localeCompare(right.chapter ?? '')
        || left.createdAt.localeCompare(right.createdAt)
        || left.id.localeCompare(right.id)
    })
  lines.push('', '## ' + t("Highlights & Notes ({{count}})", { count: formatNumber(highlights.length) }))
  if (!highlights.length) {
    lines.push('', '_' + t("No saved highlights or passage notes.") + '_')
  } else {
    for (const annotation of highlights) {
      const book = bookById.get(annotation.bookId)
      lines.push('', `### ${escapeMarkdown(book?.title ?? t("Unknown book"))}`)
      const details = [annotation.chapter, translateCopy(annotation.color[0]!.toUpperCase() + annotation.color.slice(1)), new Date(annotation.createdAt).toLocaleString(getLocale())]
        .filter((value): value is string => Boolean(value))
        .map(escapeMarkdown)
      lines.push('', `_${details.join(' · ')}_`)
      lines.push('', ...annotation.quote.split(/\r?\n/).map((line) => `> ${line}`))
      if (annotation.note) lines.push('', annotation.note)
      if (annotation.tags.length) {
        lines.push('', `${t("Tags")}: ${annotation.tags.map((tag) => `#${escapeMarkdown(tag.replaceAll(' ', '-'))}`).join(' ')}`)
      }
      if (annotation.anchor.status === 'review') {
        lines.push('', '_' + t("Anchor needs review after an EPUB revision.") + '_')
      }
    }
  }
  return `${lines.join('\n')}\n`
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]<>()#+.!|>-]/g, '\\$&')
}

function validateReadingEditionLinks(catalog: Catalog, books: readonly LibraryBook[]): void {
  const editions = new Set(catalog.editions.map(({ id }) => id))
  if (books.some((book) => book.readingEditionId && !editions.has(book.readingEditionId))) {
    throw new PortableArchiveIntegrityError('data/library.json', 'reading edition reference is missing from the catalog')
  }
}
