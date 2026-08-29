import { Capacitor } from '@capacitor/core'
import { assetSchema, type Asset } from '../domain/catalog'
import type { SqlDatabase, SqlRow } from '../storage/database'
import { readNumber, readText } from '../storage/database'
import { EpubImportService } from './service'
import { CapacitorManagedAssetStore, type ManagedAssetStore } from './managed-store'
import type { EpubImportSource } from './incoming'
import type { EpubImportRepositoryOptions } from './repository'

export type EpubAssetState = 'available' | 'missing' | 'replaced'
export type EpubRelinkMatch = 'exact-fingerprint' | 'edition-metadata' | 'incompatible'
export type EpubStoragePlatform = 'ios' | 'android' | 'web'

export type EpubStoragePolicy = {
  readonly platform: EpubStoragePlatform
  readonly mode: 'managed-copy'
  readonly sourceHandling: string
  readonly storageLocation: string
  readonly systemBackup: 'excluded'
  readonly portableBackup: 'optional'
}

export type EpubAssetInventoryItem = {
  readonly assetId: string
  readonly bookId: string
  readonly editionId: string
  readonly title: string
  readonly originalName: string
  readonly expectedFingerprint: string
  readonly actualFingerprint?: string
  readonly relativePath: string
  readonly expectedByteSize: number
  readonly actualByteSize: number
  readonly importedAt: string
  readonly active: boolean
  readonly state: EpubAssetState
}

export type EpubStorageInventory = {
  readonly policy: EpubStoragePolicy
  readonly items: readonly EpubAssetInventoryItem[]
  readonly totalManagedBytes: number
  readonly activeManagedBytes: number
  readonly reclaimableBytes: number
  readonly availableCount: number
  readonly attentionCount: number
}

export type EpubCleanupSelection = {
  readonly assetId: string
  readonly relativePath: string
  readonly actualFingerprint?: string
  readonly byteSize: number
  readonly active: boolean
}

export type EpubCleanupPreview = {
  readonly selections: readonly EpubCleanupSelection[]
  readonly freedBytes: number
  readonly offlineBookCount: number
  readonly retainedReadingEventCount: number
  readonly retainedCheckpointCount: number
  readonly retainedAnnotationCount: number
  readonly consequence: string
}

export type EpubRelinkPreview = {
  readonly assetId: string
  readonly bookId: string
  readonly editionId: string
  readonly title: string
  readonly sourceName: string
  readonly expectedFingerprint: string
  readonly candidateFingerprint: string
  readonly expectedByteSize: number
  readonly candidateByteSize: number
  readonly match: EpubRelinkMatch
  readonly canRelink: boolean
  readonly evidence: readonly string[]
  readonly retainedReadingEventCount: number
  readonly retainedAnnotationCount: number
}

export type EpubRelinkResult = {
  readonly kind: 'restored' | 'revision'
  readonly assetId: string
  readonly editionId: string
  readonly fingerprint: string
}

export type EpubBackupContent = {
  readonly assetId: string
  readonly filename: string
  readonly mediaType: 'application/epub+zip'
  readonly bytes: Uint8Array
}

export type EpubAssetLifecycleServiceOptions = EpubImportRepositoryOptions & {
  readonly managedStore?: ManagedAssetStore
  readonly importer?: EpubImportService
  readonly platform?: EpubStoragePlatform
}

type LifecycleRow = SqlRow & {
  readonly id: string
  readonly content_hash: string
  readonly package_identifier: string
  readonly metadata_key: string
  readonly original_name: string
  readonly book_id: string
  readonly edition_id: string
  readonly content_asset_id: string
  readonly imported_at: string
  readonly asset_payload: string
  readonly book_payload: string
}

export class EpubAssetLifecycleService {
  readonly #database: SqlDatabase
  readonly #managedStore: ManagedAssetStore
  readonly #importer: EpubImportService
  readonly #platform: EpubStoragePlatform

  constructor(database: SqlDatabase, options: EpubAssetLifecycleServiceOptions = {}) {
    this.#database = database
    this.#managedStore = options.managedStore ?? new CapacitorManagedAssetStore()
    this.#importer = options.importer ?? new EpubImportService(database, {
      managedStore: this.#managedStore,
      ...(options.now ? { now: options.now } : {}),
      ...(options.createId ? { createId: options.createId } : {}),
    })
    this.#platform = options.platform ?? normalizePlatform(Capacitor.getPlatform())
  }

  async inventory(): Promise<EpubStorageInventory> {
    const rows = await this.#rows()
    const activeAssetIds = activeAssetIdsFor(rows)
    const inspectedByPath = new Map<string, Promise<InspectedManagedFile>>()
    const items = await Promise.all(rows.map(async (row): Promise<EpubAssetInventoryItem> => {
      const asset = assetSchema.parse(JSON.parse(readText(row, 'asset_payload')))
      const relativePath = managedPathFor(asset, readText(row, 'content_hash'))
      let inspected = inspectedByPath.get(relativePath)
      if (!inspected) {
        inspected = inspectManagedFile(this.#managedStore, relativePath)
        inspectedByPath.set(relativePath, inspected)
      }
      const file = await inspected
      const expectedFingerprint = readText(row, 'content_hash')
      const title = libraryTitle(readText(row, 'book_payload'), readText(row, 'original_name'))
      return {
        assetId: readText(row, 'content_asset_id'),
        bookId: readText(row, 'book_id'),
        editionId: readText(row, 'edition_id'),
        title,
        originalName: readText(row, 'original_name'),
        expectedFingerprint,
        ...(file.fingerprint ? { actualFingerprint: file.fingerprint } : {}),
        relativePath,
        expectedByteSize: expectedByteSize(asset),
        actualByteSize: file.byteSize,
        importedAt: readText(row, 'imported_at'),
        active: activeAssetIds.has(readText(row, 'content_asset_id')),
        state: !file.fingerprint
          ? 'missing'
          : file.fingerprint === expectedFingerprint
            ? 'available'
            : 'replaced',
      }
    }))
    const uniqueFiles = uniqueItemsByPath(items.filter(({ state }) => state !== 'missing'))
    return {
      policy: epubStoragePolicyForPlatform(this.#platform),
      items,
      totalManagedBytes: sumBytes(uniqueFiles),
      activeManagedBytes: sumBytes(uniqueItemsByPath(items.filter(({ active, state }) => active && state !== 'missing'))),
      reclaimableBytes: sumBytes(uniqueItemsByPath(items.filter(({ active, state }) => !active && state !== 'missing'))),
      availableCount: items.filter(({ state }) => state === 'available').length,
      attentionCount: items.filter(({ state }) => state !== 'available').length,
    }
  }

  async previewCleanup(assetIds?: readonly string[]): Promise<EpubCleanupPreview> {
    const inventory = await this.inventory()
    const selectedIds = new Set(assetIds ?? inventory.items.filter(({ active }) => !active).map(({ assetId }) => assetId))
    const selected = inventory.items.filter(({ assetId }) => selectedIds.has(assetId))
    if (selected.length !== selectedIds.size) throw new Error('One or more EPUB assets no longer exist in the catalog.')
    const selections = uniqueItemsByPath(selected).map((item) => ({
      assetId: item.assetId,
      relativePath: item.relativePath,
      ...(item.actualFingerprint ? { actualFingerprint: item.actualFingerprint } : {}),
      byteSize: item.actualByteSize,
      active: item.active,
    }))
    const activeBookIds = new Set(selected.filter(({ active, state }) => active && state !== 'missing').map(({ bookId }) => bookId))
    const retained = await this.#retainedCounts(selected.map(({ assetId }) => assetId))
    return {
      selections,
      freedBytes: sumBytes(selections),
      offlineBookCount: activeBookIds.size,
      ...retained,
      consequence: activeBookIds.size > 0
        ? `${activeBookIds.size} book${activeBookIds.size === 1 ? '' : 's'} will need re-linking before offline reading. Notes, bookmarks, progress, and library records stay.`
        : 'Only superseded copies are selected. Current offline reading stays available, and all history remains attached.',
    }
  }

  async cleanup(preview: EpubCleanupPreview): Promise<number> {
    const current = await this.inventory()
    const currentById = new Map(current.items.map((item) => [item.assetId, item]))
    for (const selection of preview.selections) {
      const item = currentById.get(selection.assetId)
      if (!item || item.relativePath !== selection.relativePath) {
        throw new Error('The EPUB cleanup preview is stale. Review storage again before removing files.')
      }
      if (item.actualFingerprint !== selection.actualFingerprint || item.actualByteSize !== selection.byteSize) {
        throw new Error('An EPUB file changed after the cleanup preview. Nothing was removed.')
      }
    }
    for (const selection of preview.selections) await this.#managedStore.remove(selection.relativePath)
    return preview.freedBytes
  }

  async previewRelink(assetId: string, source: EpubImportSource): Promise<EpubRelinkPreview> {
    const row = await this.#rowForAsset(assetId)
    const { inspectEpub } = await import('./inspect')
    const inspection = await inspectEpub(source.bytes, {
      fileName: source.name,
      mediaType: source.mediaType,
    })
    const expectedFingerprint = readText(row, 'content_hash')
    const metadataKey = createMetadataKey(inspection.title, inspection.creators)
    const exact = inspection.contentHash === expectedFingerprint
    const [existingCandidate] = await this.#database.query<{ readonly edition_id: string }>(
      'SELECT edition_id FROM epub_imports WHERE content_hash = ? LIMIT 1',
      [inspection.contentHash],
    )
    const metadataMatch = !exact
      && !existingCandidate
      && inspection.packageIdentifier === readText(row, 'package_identifier')
      && metadataKey === readText(row, 'metadata_key')
      && await this.#metadataAssociationStillTargets(row, inspection.packageIdentifier, metadataKey)
    const match: EpubRelinkMatch = exact
      ? 'exact-fingerprint'
      : metadataMatch
        ? 'edition-metadata'
        : 'incompatible'
    const retained = await this.#retainedCounts([assetId])
    return {
      assetId,
      bookId: readText(row, 'book_id'),
      editionId: readText(row, 'edition_id'),
      title: libraryTitle(readText(row, 'book_payload'), readText(row, 'original_name')),
      sourceName: source.name,
      expectedFingerprint,
      candidateFingerprint: inspection.contentHash,
      expectedByteSize: expectedByteSize(assetSchema.parse(JSON.parse(readText(row, 'asset_payload')))),
      candidateByteSize: inspection.byteSize,
      match,
      canRelink: match !== 'incompatible',
      evidence: match === 'exact-fingerprint'
        ? ['SHA-256 fingerprint is an exact match.', 'The existing Asset and Edition IDs will be retained.']
        : match === 'edition-metadata'
          ? ['Package identifier, title, and creators match this edition.', 'The fingerprint changed, so this will be recorded as a reviewed EPUB revision.']
          : ['The fingerprint does not match.', 'Package identity and normalized title/creator metadata do not prove this is the same edition.'],
      ...retained,
    }
  }

  async relink(preview: EpubRelinkPreview, source: EpubImportSource): Promise<EpubRelinkResult> {
    const checked = await this.previewRelink(preview.assetId, source)
    if (
      checked.candidateFingerprint !== preview.candidateFingerprint
      || checked.editionId !== preview.editionId
      || checked.match !== preview.match
    ) {
      throw new Error('The selected EPUB changed after review. Choose it again before re-linking.')
    }
    if (!checked.canRelink) throw new Error('This EPUB cannot be safely linked to the selected edition.')

    if (checked.match === 'exact-fingerprint') {
      const row = await this.#rowForAsset(checked.assetId)
      const asset = assetSchema.parse(JSON.parse(readText(row, 'asset_payload')))
      const relativePath = `assets/epub/${checked.candidateFingerprint}.epub`
      await this.#managedStore.replaceAtomically(relativePath, source.bytes)
      const restored = assetSchema.parse({
        ...asset,
        location: {
          kind: 'managed-file',
          relativePath,
          sha256: checked.candidateFingerprint,
          byteSize: checked.candidateByteSize,
        },
      })
      await this.#database.run('UPDATE assets SET payload_json = ? WHERE id = ?', [JSON.stringify(restored), restored.id])
      await this.#database.persist()
      return {
        kind: 'restored',
        assetId: checked.assetId,
        editionId: checked.editionId,
        fingerprint: checked.candidateFingerprint,
      }
    }

    const result = await this.#importer.import(source)
    if (result.outcome === 'duplicate' || result.editionId !== checked.editionId) {
      throw new Error('The reviewed revision resolved to a different edition and was not linked here.')
    }
    return {
      kind: 'revision',
      assetId: result.assetId,
      editionId: result.editionId,
      fingerprint: result.fingerprint,
    }
  }

  async backupContents(): Promise<readonly EpubBackupContent[]> {
    const inventory = await this.inventory()
    const contents: EpubBackupContent[] = []
    for (const item of inventory.items.filter(({ active, state }) => active && state === 'available')) {
      const bytes = await this.#managedStore.read(item.relativePath)
      if (!bytes || await sha256Hex(bytes) !== item.expectedFingerprint) {
        throw new Error(`${item.title} changed while its EPUB backup was being built. Try again after reviewing storage.`)
      }
      contents.push({
        assetId: item.assetId,
        filename: item.originalName,
        mediaType: 'application/epub+zip',
        bytes,
      })
    }
    return contents
  }

  async #rows(): Promise<LifecycleRow[]> {
    return this.#database.query<LifecycleRow>(
      `SELECT i.id, i.content_hash, i.package_identifier, i.metadata_key, i.original_name,
              i.book_id, i.edition_id, i.content_asset_id, i.imported_at,
              a.payload_json AS asset_payload, b.payload_json AS book_payload
       FROM epub_imports i
       JOIN assets a ON a.id = i.content_asset_id
       JOIN library_books b ON b.id = i.book_id
       ORDER BY i.imported_at DESC, i.id DESC`,
    )
  }

  async #rowForAsset(assetId: string): Promise<LifecycleRow> {
    const row = (await this.#rows()).find(({ content_asset_id }) => content_asset_id === assetId)
    if (!row) throw new Error('This EPUB Asset is no longer available for re-linking.')
    return row
  }

  async #metadataAssociationStillTargets(
    target: LifecycleRow,
    packageIdentifier: string,
    metadataKey: string,
  ): Promise<boolean> {
    const [association] = await this.#database.query<{ readonly edition_id: string }>(
      `SELECT edition_id FROM epub_imports
       WHERE package_identifier = ? AND metadata_key = ?
       ORDER BY imported_at DESC, id DESC LIMIT 1`,
      [packageIdentifier, metadataKey],
    )
    return Boolean(association && readText(association, 'edition_id') === readText(target, 'edition_id'))
  }

  async #retainedCounts(assetIds: readonly string[]): Promise<{
    readonly retainedReadingEventCount: number
    readonly retainedCheckpointCount: number
    readonly retainedAnnotationCount: number
  }> {
    if (assetIds.length === 0) {
      return { retainedReadingEventCount: 0, retainedCheckpointCount: 0, retainedAnnotationCount: 0 }
    }
    const placeholders = assetIds.map(() => '?').join(', ')
    const [[events], [checkpoints], annotationRows] = await Promise.all([
      this.#database.query<{ readonly count: number }>(
        `SELECT COUNT(*) AS count FROM reading_events WHERE asset_id IN (${placeholders})`,
        assetIds,
      ),
      this.#database.query<{ readonly count: number }>(
        `SELECT COUNT(*) AS count FROM epub_reader_checkpoints WHERE asset_id IN (${placeholders})`,
        assetIds,
      ),
      this.#database.query<{ readonly state_json: string }>(
        'SELECT state_json FROM epub_reader_annotations',
      ),
    ])
    const selectedIds = new Set(assetIds)
    const retainedAnnotationCount = annotationRows.reduce((count, row) => {
      const parsed = JSON.parse(readText(row, 'state_json')) as {
        readonly annotations?: readonly { readonly assetId?: string }[]
      }
      return count + (parsed.annotations ?? []).filter(({ assetId }) => assetId && selectedIds.has(assetId)).length
    }, 0)
    return {
      retainedReadingEventCount: events ? readNumber(events, 'count') : 0,
      retainedCheckpointCount: checkpoints ? readNumber(checkpoints, 'count') : 0,
      retainedAnnotationCount,
    }
  }
}

export function epubStoragePolicyForPlatform(platform: EpubStoragePlatform): EpubStoragePolicy {
  if (platform === 'ios') {
    return {
      platform,
      mode: 'managed-copy',
      sourceHandling: 'The selected document-provider file is read once; its permission is not retained.',
      storageLocation: 'A private Library/NoCloud copy remains available offline until you remove it.',
      systemBackup: 'excluded',
      portableBackup: 'optional',
    }
  }
  if (platform === 'android') {
    return {
      platform,
      mode: 'managed-copy',
      sourceHandling: 'The selected content-provider file is read once; its URI permission is not retained.',
      storageLocation: 'An app-private no-backup copy remains available offline until you remove it.',
      systemBackup: 'excluded',
      portableBackup: 'optional',
    }
  }
  return {
    platform,
    mode: 'managed-copy',
    sourceHandling: 'The selected browser file is read once; no external file handle is retained.',
    storageLocation: 'A private browser-managed copy remains until site data or the download is removed.',
    systemBackup: 'excluded',
    portableBackup: 'optional',
  }
}

type InspectedManagedFile = {
  readonly fingerprint?: string
  readonly byteSize: number
}

async function inspectManagedFile(store: ManagedAssetStore, relativePath: string): Promise<InspectedManagedFile> {
  const bytes = await store.read(relativePath)
  return bytes
    ? { fingerprint: await sha256Hex(bytes), byteSize: bytes.byteLength }
    : { byteSize: 0 }
}

function activeAssetIdsFor(rows: readonly LifecycleRow[]): Set<string> {
  const seenBooks = new Set<string>()
  const assetIds = new Set<string>()
  for (const row of rows) {
    const bookId = readText(row, 'book_id')
    if (seenBooks.has(bookId)) continue
    seenBooks.add(bookId)
    assetIds.add(readText(row, 'content_asset_id'))
  }
  return assetIds
}

function managedPathFor(asset: Asset, fingerprint: string): string {
  return asset.location.kind === 'managed-file'
    ? asset.location.relativePath
    : `assets/epub/${fingerprint}.epub`
}

function expectedByteSize(asset: Asset): number {
  return asset.location.kind === 'managed-file' || asset.location.kind === 'managed-bundle'
    ? asset.location.byteSize
    : 0
}

function libraryTitle(payload: string, fallbackName: string): string {
  try {
    const parsed = JSON.parse(payload) as { readonly title?: string }
    return parsed.title?.trim() || fallbackName.replace(/\.epub$/i, '')
  } catch {
    return fallbackName.replace(/\.epub$/i, '')
  }
}

function createMetadataKey(title: string, creators: readonly string[]): string {
  return [title, ...creators]
    .join('|')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function uniqueItemsByPath<Item extends { readonly relativePath: string }>(items: readonly Item[]): Item[] {
  const byPath = new Map<string, Item>()
  for (const item of items) if (!byPath.has(item.relativePath)) byPath.set(item.relativePath, item)
  return [...byPath.values()]
}

function sumBytes(items: readonly { readonly actualByteSize?: number; readonly byteSize?: number }[]): number {
  return items.reduce((total, item) => total + (item.actualByteSize ?? item.byteSize ?? 0), 0)
}

function normalizePlatform(platform: string): EpubStoragePlatform {
  return platform === 'ios' || platform === 'android' ? platform : 'web'
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digestBytes = new Uint8Array(bytes.byteLength)
  digestBytes.set(bytes)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', digestBytes.buffer)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
