import type { AssetLocation } from '../domain/catalog'
import {
  accessGrantIdSchema,
  accessGrantSchema,
  assetIdSchema,
  assetSchema,
  contributorIdSchema,
  contributorSchema,
  editionIdSchema,
  editionSchema,
  identifierIdSchema,
  identifierSchema,
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
} from '../domain/catalog'
import { libraryBookSchema, type LibraryBook } from '../library-model'
import { applyEmbeddedCover } from '../covers/embedded-cover'
import type { SqlDatabase, SqlRow } from '../storage/database'
import { readText } from '../storage/database'
import { readLibraryBooks, writeLibraryBook } from '../storage/library-repository'
import type { EpubImportResult } from './model'
import { ebookFormat, type EbookInspection } from './inspect-book'

export type EpubCommitInput = {
  readonly originalName: string
  readonly inspection: EbookInspection
  readonly contentLocation?: AssetLocation
  readonly contentRelativePath: string
  readonly coverRelativePath?: string
  readonly targetBookId?: string
  readonly overwriteCover?: boolean
}

export type EpubImportRepositoryOptions = {
  readonly now?: () => Date
  readonly createId?: (prefix: string) => string
}

type EpubImportRow = SqlRow & {
  readonly id: string
  readonly content_hash: string
  readonly original_name: string
  readonly book_id: string
  readonly edition_id: string
  readonly content_asset_id: string
  readonly imported_at: string
}

type Association = {
  readonly edition?: Edition
  readonly book?: LibraryBook
  readonly previousImport?: EpubImportRow
}

export class EpubImportRepository {
  readonly #database: SqlDatabase
  readonly #now: () => Date
  readonly #createId: (prefix: string) => string

  constructor(database: SqlDatabase, options: EpubImportRepositoryOptions = {}) {
    this.#database = database
    this.#now = options.now ?? (() => new Date())
    this.#createId = options.createId ?? ((prefix) => `${prefix}:epub:${crypto.randomUUID()}`)
  }

  async findByFingerprint(contentHash: string): Promise<EpubImportResult | undefined> {
    const [row] = await this.#database.query<EpubImportRow>(
      `SELECT id, content_hash, original_name, book_id, edition_id, content_asset_id, imported_at
       FROM epub_imports WHERE content_hash = ?`,
      [contentHash],
    )
    return row ? duplicateResult(row) : undefined
  }

  async linkOriginalAsset(assetId: string, location: AssetLocation): Promise<void> {
    await this.#database.transaction(async (database) => {
      const [row] = await database.query('SELECT payload_json FROM assets WHERE id = ?', [assetId])
      if (!row) throw new Error('This book is no longer in the library.')
      const asset = assetSchema.parse(JSON.parse(readText(row, 'payload_json')))
      const retainedCopy = asset.location.kind === 'managed-file' ? asset.location
        : asset.location.kind === 'linked-file' ? asset.location.retainedCopy : undefined
      const linked = location.kind === 'linked-file' && retainedCopy ? { ...location, retainedCopy } : location
      await database.run('UPDATE assets SET payload_json = ? WHERE id = ?', [JSON.stringify(assetSchema.parse({ ...asset, location: linked })), assetId])
    })
  }

  async restoreManagedAsset(assetId: string, relativePath: string, inspection: EbookInspection): Promise<void> {
    await this.#database.transaction(async (database) => {
      const [row] = await database.query('SELECT payload_json FROM assets WHERE id = ?', [assetId])
      if (!row) throw new Error('The managed book no longer exists.')
      const asset = assetSchema.parse(JSON.parse(readText(row, 'payload_json')))
      const restored = assetSchema.parse({ ...asset, location: {
        kind: 'managed-file', relativePath, sha256: inspection.contentHash, byteSize: inspection.byteSize,
      } })
      await database.run('UPDATE assets SET payload_json = ? WHERE id = ?', [JSON.stringify(restored), assetId])
    })
  }

  async commit(input: EpubCommitInput): Promise<EpubImportResult> {
    return this.#database.transaction(async (database) => {
      const [duplicate] = await database.query<EpubImportRow>(
        `SELECT id, content_hash, original_name, book_id, edition_id, content_asset_id, imported_at
         FROM epub_imports WHERE content_hash = ?`,
        [input.inspection.contentHash],
      )
      if (duplicate) return duplicateResult(duplicate)

      const importedAt = this.#now().toISOString()
      const format = ebookFormat(input.inspection)
      const sourceName = format === 'pdf' ? 'PDF document' : 'EPUB package'
      const metadataKey = createMetadataKey(input.inspection)
      const association = await findAssociation(database, input.inspection, metadataKey, input.targetBookId)
      const workId = association.edition?.workId
        ?? workIdSchema.parse(this.#createId('work'))
      const editionId = association.edition?.id
        ?? editionIdSchema.parse(this.#createId('edition'))
      const bookId = association.book?.id ?? this.#createId('book')
      const importId = this.#createId('epub-import')
      const sourceRecordId = sourceRecordIdSchema.parse(this.#createId('source-record'))
      const contentAssetId = assetIdSchema.parse(this.#createId('asset'))
      const existingCoverAssetId = input.inspection.cover
        ? await findCoverAsset(database, editionId, input.inspection.cover.sha256)
        : undefined
      const coverAssetId = input.inspection.cover && input.coverRelativePath
        ? existingCoverAssetId ?? assetIdSchema.parse(this.#createId('asset'))
        : undefined
      const targetWork = { type: 'work', id: workId } as const
      const targetEdition = { type: 'edition', id: editionId } as const
      const source = createSourceRecord({
        sourceRecordId,
        targetWork,
        targetEdition,
        inspection: input.inspection,
        originalName: input.originalName,
        importedAt,
        createId: this.#createId,
      })
      await insertSourceRecord(database, source.record)

      if (!association.edition) {
        const work = workSchema.parse({
          id: workId,
          kind: 'single',
          title: resolvedSourceField(targetWork, 'work.title', input.inspection.title, source.claimsByField, sourceRecordId, importedAt),
          createdAt: importedAt,
          updatedAt: importedAt,
        })
        const edition = editionSchema.parse({
          id: editionId,
          workId,
          medium: 'ebook',
          ...(input.inspection.packageVersion === 'pdf' ? { pageCount: resolvedSourceField(targetEdition, 'edition.pageCount', input.inspection.pageCount, source.claimsByField, sourceRecordId, importedAt) } : {}),
          title: resolvedSourceField(targetEdition, 'edition.title', input.inspection.title, source.claimsByField, sourceRecordId, importedAt),
          language: resolvedSourceField(targetEdition, 'edition.language', input.inspection.language, source.claimsByField, sourceRecordId, importedAt),
          ...(input.inspection.publisher
            ? { publisher: resolvedSourceField(targetEdition, 'edition.publisher', input.inspection.publisher, source.claimsByField, sourceRecordId, importedAt) }
            : {}),
          ...(input.inspection.publicationDate
            ? { publicationDate: resolvedSourceField(targetEdition, 'edition.publicationDate', input.inspection.publicationDate, source.claimsByField, sourceRecordId, importedAt) }
            : {}),
          ...(coverAssetId ? { coverAssetId } : {}),
          createdAt: importedAt,
          updatedAt: importedAt,
        })
        await insertWork(database, work)
        await insertEdition(database, edition)
        await insertCreators(database, input.inspection.creators, workId, importedAt, this.#createId)
      }

      const contentAsset = assetSchema.parse({
        id: contentAssetId,
        editionId,
        role: 'content',
        format,
        mediaType: format === 'pdf' ? 'application/pdf' : 'application/epub+zip',
        location: input.contentLocation ?? {
          kind: 'managed-file',
          relativePath: input.contentRelativePath,
          sha256: input.inspection.contentHash,
          byteSize: input.inspection.byteSize,
        },
        createdAt: importedAt,
      })
      await insertAsset(database, contentAsset)

      if (coverAssetId && input.inspection.cover && input.coverRelativePath && !existingCoverAssetId) {
        const coverAsset = assetSchema.parse({
          id: coverAssetId,
          editionId,
          role: 'cover',
          format: 'image',
          mediaType: input.inspection.cover.mediaType,
          location: {
            kind: 'managed-file',
            relativePath: input.coverRelativePath,
            sha256: input.inspection.cover.sha256,
            byteSize: input.inspection.cover.bytes.byteLength,
          },
          createdAt: importedAt,
        })
        await insertAsset(database, coverAsset)
      }
      if (coverAssetId && association.edition && association.edition.coverAssetId !== coverAssetId) {
        await setEditionCover(database, association.edition, coverAssetId, importedAt)
      }
      if (association.edition && input.inspection.packageVersion === 'pdf') {
        const current = await readEdition(database, editionId)
        const updated = editionSchema.parse({ ...current,
          pageCount: resolvedSourceField(targetEdition, 'edition.pageCount', input.inspection.pageCount, source.claimsByField, sourceRecordId, importedAt),
          updatedAt: importedAt,
        })
        await database.run('UPDATE editions SET updated_at = ?, payload_json = ? WHERE id = ?', [importedAt, JSON.stringify(updated), editionId])
      }

      await insertIdentifiers(database, input.inspection, editionId, sourceRecordId, importedAt, this.#createId)
      await ensureOwnership(database, editionId, sourceRecordId, importedAt, this.#createId)

      const book = libraryBookSchema.parse(association.book
        ? {
            ...association.book,
            format: format.toUpperCase(),
            ...(input.inspection.packageVersion === 'pdf' ? { pageCount: input.inspection.pageCount, currentPage: 0 } : {}),
            sourceNames: distinct([...(association.book.sourceNames ?? []), sourceName]),
            identifiers: distinct([...(association.book.identifiers ?? []), ...input.inspection.identifiers.map(({ normalizedValue }) => normalizedValue)]),
            lastUpdatedAt: importedAt,
          }
        : {
            id: bookId,
            title: input.inspection.title,
            authors: [...input.inspection.creators],
            identifiers: input.inspection.identifiers.map(({ normalizedValue }) => normalizedValue),
            sourceNames: [sourceName],
            format: format.toUpperCase(),
            pageCount: input.inspection.packageVersion === 'pdf' ? input.inspection.pageCount : 0,
            shelf: 'tbr',
            progress: 0,
            currentPage: 0,
            rating: 0,
            notes: '',
            addedAt: importedAt,
            lastUpdatedAt: importedAt,
          })
      await writeLibraryBook(database, book)
      await applyEmbeddedCover(database, bookId, input.inspection.cover, input.overwriteCover)
      if (!association.book) await ensureToBeReadListEntry(database, workId, importedAt, this.#createId)

      const outcome = association.previousImport ? 'revision' : 'imported'
      const payload = {
        id: importId,
        contentHash: input.inspection.contentHash,
        packageIdentifier: input.inspection.packageIdentifier,
        packageVersion: input.inspection.packageVersion,
        originalName: input.originalName,
        bookId,
        editionId,
        contentAssetId,
        ...(coverAssetId ? { coverAssetId } : {}),
        sourceRecordId,
        outcome,
        importedAt,
        provenance: {
          source: 'local-file',
          ...(input.inspection.packageVersion !== 'pdf' && input.inspection.subjects?.length
            ? { subjects: [...input.inspection.subjects] } : {}),
          packagePath: input.inspection.packagePath,
          entryCount: input.inspection.entryCount,
          scriptedContentDiscovered: input.inspection.containsScriptedContent,
          ...(input.inspection.compatibility ? { compatibility: input.inspection.compatibility } : {}),
          replacedAssetId: association.previousImport?.content_asset_id,
        },
      }
      await database.run(
        `INSERT INTO epub_imports(
           id, content_hash, package_identifier, metadata_key, package_version, original_name,
           book_id, edition_id, content_asset_id, cover_asset_id, source_record_id,
           outcome, imported_at, payload_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          importId,
          input.inspection.contentHash,
          input.inspection.packageIdentifier,
          metadataKey,
          input.inspection.packageVersion,
          input.originalName,
          bookId,
          editionId,
          contentAssetId,
          coverAssetId ?? null,
          sourceRecordId,
          outcome,
          importedAt,
          JSON.stringify(payload),
        ],
      )

      return {
        importId,
        outcome,
        title: input.inspection.title,
        bookId,
        editionId,
        assetId: contentAssetId,
        fingerprint: input.inspection.contentHash,
        originalName: input.originalName,
        importedAt,
      }
    })
  }
}

function duplicateResult(row: EpubImportRow): EpubImportResult {
  return {
    importId: readText(row, 'id'),
    outcome: 'duplicate',
    title: readText(row, 'original_name').replace(/\.(?:epub|pdf)$/i, ''),
    bookId: readText(row, 'book_id'),
    editionId: readText(row, 'edition_id'),
    assetId: readText(row, 'content_asset_id'),
    fingerprint: readText(row, 'content_hash'),
    originalName: readText(row, 'original_name'),
    importedAt: readText(row, 'imported_at'),
  }
}

async function findAssociation(
  database: SqlDatabase,
  inspection: EbookInspection,
  metadataKey: string,
  targetBookId?: string,
): Promise<Association> {
  if (targetBookId) {
    const book = (await readLibraryBooks(database)).find(({ id }) => id === targetBookId)
    if (!book) throw new Error(`Cannot attach ebook to missing library book ${targetBookId}`)
    const [previousImport] = await database.query<EpubImportRow>(
      `SELECT id, content_hash, original_name, book_id, edition_id, content_asset_id, imported_at
       FROM epub_imports WHERE book_id = ?
       ORDER BY imported_at DESC, id DESC LIMIT 1`,
      [targetBookId],
    )
    return {
      book,
      ...(previousImport
        ? {
            previousImport,
            edition: await readEdition(database, readText(previousImport, 'edition_id')),
          }
        : {}),
    }
  }

  const [previousImport] = await database.query<EpubImportRow>(
    `SELECT id, content_hash, original_name, book_id, edition_id, content_asset_id, imported_at
     FROM epub_imports
     WHERE package_identifier = ? AND metadata_key = ?
     ORDER BY imported_at DESC, id DESC LIMIT 1`,
    [inspection.packageIdentifier, metadataKey],
  )
  if (previousImport) {
    return {
      previousImport,
      edition: await readEdition(database, readText(previousImport, 'edition_id')),
      book: (await readLibraryBooks(database)).find(({ id }) => id === readText(previousImport, 'book_id')),
    }
  }

  const isbnKeys = inspection.identifiers
    .filter(({ scheme }) => scheme === 'isbn-10' || scheme === 'isbn-13')
    .map(({ scheme, normalizedValue }) => `${scheme}:${normalizedValue}`)
  if (isbnKeys.length === 0) return {}
  const editions = new Map<string, Edition>()
  for (const key of isbnKeys) {
    const [scheme, normalizedValue] = key.split(':', 2)
    const rows = await database.query(
      `SELECT editions.payload_json FROM identifiers
       JOIN editions ON editions.id = identifiers.owner_id
       WHERE identifiers.owner_type = 'edition'
         AND editions.medium = 'ebook'
         AND identifiers.scheme = ? AND identifiers.normalized_value = ?`,
      [scheme, normalizedValue],
    )
    rows.forEach((row) => {
      const edition = editionSchema.parse(JSON.parse(readText(row, 'payload_json')))
      editions.set(edition.id, edition)
    })
  }
  if (editions.size !== 1) return {}
  const edition = [...editions.values()][0]
  const [previousEditionImport] = await database.query<EpubImportRow>(
    `SELECT id, content_hash, original_name, book_id, edition_id, content_asset_id, imported_at
     FROM epub_imports WHERE edition_id = ?
     ORDER BY imported_at DESC, id DESC LIMIT 1`,
    [edition.id],
  )
  const books = await readLibraryBooks(database)
  const matches = books.filter((book) =>
    book.identifiers?.some((identifier) => isbnKeys.some((key) => key.endsWith(`:${normalizeIsbn(identifier)}`))),
  )
  const importedBook = previousEditionImport
    ? books.find(({ id }) => id === readText(previousEditionImport, 'book_id'))
    : undefined
  return {
    edition,
    ...(previousEditionImport ? { previousImport: previousEditionImport } : {}),
    ...(importedBook ? { book: importedBook } : matches.length === 1 ? { book: matches[0] } : {}),
  }
}

function createSourceRecord(input: {
  readonly sourceRecordId: ReturnType<typeof sourceRecordIdSchema.parse>
  readonly targetWork: MetadataTarget
  readonly targetEdition: MetadataTarget
  readonly inspection: EbookInspection
  readonly originalName: string
  readonly importedAt: string
  readonly createId: (prefix: string) => string
}) {
  const claims: SourceClaim[] = []
  const claimsByField = new Map<string, SourceClaim>()
  const addClaim = (target: MetadataTarget, field: MetadataField, value: string | number) => {
    const claim = sourceRecordSchema.shape.claims.element.parse({
      id: sourceClaimIdSchema.parse(input.createId('source-claim')),
      target,
      field,
      value,
      observedAt: input.importedAt,
      confidence: 1,
    })
    claims.push(claim)
    claimsByField.set(claimKey(target, field), claim)
  }
  addClaim(input.targetWork, 'work.title', input.inspection.title)
  addClaim(input.targetEdition, 'edition.title', input.inspection.title)
  addClaim(input.targetEdition, 'edition.language', input.inspection.language)
  if (input.inspection.publisher) addClaim(input.targetEdition, 'edition.publisher', input.inspection.publisher)
  if (input.inspection.publicationDate) addClaim(input.targetEdition, 'edition.publicationDate', input.inspection.publicationDate)

  if (input.inspection.packageVersion === 'pdf') addClaim(input.targetEdition, 'edition.pageCount', input.inspection.pageCount)

  const record = sourceRecordSchema.parse({
    id: input.sourceRecordId,
    source: { kind: 'file-import', name: ebookFormat(input.inspection) === 'pdf' ? 'PDF document' : 'EPUB package' },
    externalKey: `${input.inspection.packageIdentifier}:${input.inspection.contentHash}`,
    observedAt: input.importedAt,
    importedAt: input.importedAt,
    claims,
    observedIdentifiers: input.inspection.identifiers.map((identifier) => ({
      target: input.targetEdition,
      ...identifier,
      confidence: 1,
    })),
    rawPayload: {
      originalName: input.originalName,
      sha256: input.inspection.contentHash,
      byteSize: input.inspection.byteSize,
      packageVersion: input.inspection.packageVersion,
      packagePath: input.inspection.packagePath,
      creators: [...input.inspection.creators],
      containsScriptedContent: input.inspection.containsScriptedContent,
      ...(input.inspection.compatibility ? { compatibility: input.inspection.compatibility } : {}),
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
) {
  const claim = claims.get(claimKey(target, field))
  if (!claim) throw new Error(`Missing EPUB source claim for ${field}`)
  return resolveMetadataField(metadataCandidateValueSchema.parse({
    kind: 'source',
    target,
    field,
    value,
    sourceRecordId,
    claimId: claim.id,
    observedAt,
    confidence: 1,
  }))
}

async function insertCreators(
  database: SqlDatabase,
  creators: readonly string[],
  workId: ReturnType<typeof workIdSchema.parse>,
  importedAt: string,
  createId: (prefix: string) => string,
): Promise<void> {
  for (const [position, creator] of creators.entries()) {
    const personId = personIdSchema.parse(createId('person'))
    const target = { type: 'person', id: personId } as const
    // Person claims are local projections of the already-preserved EPUB creator list.
    // They intentionally do not pretend to be SourceRecord claims until contributor reconciliation exists.
    const localPerson = personSchema.parse({
      id: personId,
      displayName: resolveMetadataField(metadataCandidateValueSchema.parse({
        kind: 'local',
        target,
        field: 'person.displayName',
        value: creator,
        recordedAt: importedAt,
        method: 'manual-entry',
      })),
      createdAt: importedAt,
      updatedAt: importedAt,
    })
    await insertPerson(database, localPerson)
    const contributor = contributorSchema.parse({
      id: contributorIdSchema.parse(createId('contributor')),
      personId,
      target: { type: 'work', id: workId },
      role: 'author',
      creditedAs: creator,
      position,
    })
    await database.run(
      `INSERT INTO contributors(id, person_id, target_type, target_id, role, position, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [contributor.id, contributor.personId, contributor.target.type, contributor.target.id, contributor.role, contributor.position, JSON.stringify(contributor)],
    )
  }
}

async function insertIdentifiers(
  database: SqlDatabase,
  inspection: EbookInspection,
  editionId: ReturnType<typeof editionIdSchema.parse>,
  sourceRecordId: ReturnType<typeof sourceRecordIdSchema.parse>,
  importedAt: string,
  createId: (prefix: string) => string,
): Promise<void> {
  for (const observed of inspection.identifiers) {
    const [existing] = await database.query(
      `SELECT id FROM identifiers
       WHERE owner_type = 'edition' AND owner_id = ? AND scheme = ? AND normalized_value = ?`,
      [editionId, observed.scheme, observed.normalizedValue],
    )
    if (existing) continue
    const identifier = identifierSchema.parse({
      id: identifierIdSchema.parse(createId('identifier')),
      owner: { type: 'edition', id: editionId },
      scheme: observed.scheme,
      value: observed.value,
      normalizedValue: observed.normalizedValue,
      sourceRecordIds: [sourceRecordId],
      createdAt: importedAt,
    })
    await database.run(
      `INSERT INTO identifiers(id, owner_type, owner_id, scheme, normalized_value, created_at, payload_json)
       VALUES (?, 'edition', ?, ?, ?, ?, ?)`,
      [identifier.id, editionId, identifier.scheme, identifier.normalizedValue, importedAt, JSON.stringify(identifier)],
    )
    await database.run(
      `INSERT INTO identifier_source_records(identifier_id, source_record_id, position)
       VALUES (?, ?, 0)`,
      [identifier.id, sourceRecordId],
    )
  }
}

async function ensureOwnership(
  database: SqlDatabase,
  editionId: ReturnType<typeof editionIdSchema.parse>,
  sourceRecordId: ReturnType<typeof sourceRecordIdSchema.parse>,
  importedAt: string,
  createId: (prefix: string) => string,
): Promise<void> {
  const [existing] = await database.query(
    `SELECT payload_json FROM ownerships
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

async function findCoverAsset(
  database: SqlDatabase,
  editionId: ReturnType<typeof editionIdSchema.parse>,
  sha256: string,
) {
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
  if (!row) throw new Error(`EPUB import references missing Edition ${id}`)
  return editionSchema.parse(JSON.parse(readText(row, 'payload_json')))
}

async function setEditionCover(
  database: SqlDatabase,
  edition: Edition,
  coverAssetId: ReturnType<typeof assetIdSchema.parse>,
  updatedAt: string,
): Promise<void> {
  const changed = editionSchema.parse({ ...edition, coverAssetId, updatedAt })
  await database.run(
    'UPDATE editions SET cover_asset_id = ?, updated_at = ?, payload_json = ? WHERE id = ?',
    [coverAssetId, updatedAt, JSON.stringify(changed), edition.id],
  )
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

function createMetadataKey(inspection: EbookInspection): string {
  return [inspection.title, ...inspection.creators]
    .join('|')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function normalizeIsbn(value: string): string {
  return value.replace(/^urn:isbn:/i, '').replace(/[\s-]/g, '').toLocaleUpperCase()
}

function distinct(values: readonly string[]): string[] {
  return [...new Set(values)]
}
