import { originalFiles, type OriginalFileAccess } from '../files/original-files'
import { ebookFormat, inspectBook } from './inspect-book'
import type { EpubCover } from './model'
import { pdfCover } from '../pdf/cover'
import { sha256 } from '../audiobooks/binary'
import type { SqlDatabase } from '../storage/database'
import { applyEmbeddedCover } from '../covers/embedded-cover'
import type { EpubImportSource } from './incoming'
import {
  CapacitorManagedAssetStore,
  type ManagedAssetStore,
  type ManagedFileWrite,
} from './managed-store'
import {
  EpubImportError,
  throwIfEpubImportCanceled,
  type EpubImportProgress,
  type EpubImportResult,
} from './model'
import { EpubImportRepository, type EpubImportRepositoryOptions } from './repository'

export type EpubImportServiceOptions = EpubImportRepositoryOptions & {
  readonly originalFiles?: OriginalFileAccess
  readonly managedStore?: ManagedAssetStore
  readonly pdfCover?: (relativePath: string, referenceId?: string) => Promise<EpubCover | undefined>
}

export class EpubImportService {
  readonly #originalFiles: OriginalFileAccess
  readonly #database: SqlDatabase
  readonly #repository: EpubImportRepository
  readonly #managedStore: ManagedAssetStore
  readonly #pdfCover: (relativePath: string, referenceId?: string) => Promise<EpubCover | undefined>

  constructor(database: SqlDatabase, options: EpubImportServiceOptions = {}) {
    this.#originalFiles = options.originalFiles ?? originalFiles
    this.#pdfCover = options.pdfCover ?? pdfCover
    this.#database = database
    this.#repository = new EpubImportRepository(database, options)
    this.#managedStore = options.managedStore ?? new CapacitorManagedAssetStore()
  }

  async import(
    source: EpubImportSource,
    options: {
      readonly signal?: AbortSignal
      readonly onProgress?: (progress: EpubImportProgress) => void
      readonly targetBookId?: string
      readonly overwriteCover?: boolean
    } = {},
  ): Promise<EpubImportResult> {
    const { signal, onProgress } = options
    throwIfEpubImportCanceled(signal)
    onProgress?.({ stage: 'reading', fileName: source.name, detail: 'Reading the selected file locally' })
    if (source.originalInspection && !source.reference) throw new EpubImportError('invalid-container', 'The original book reference is missing.')
    let inspection = source.originalInspection ?? await inspectBook(source.bytes, {
      fileName: source.name,
      mediaType: source.mediaType,
      signal,
      onProgress,
    })
    const format = ebookFormat(inspection)
    const contentRelativePath = `assets/${format}/${inspection.contentHash}.${format}`
    const contentLocation = source.reference ? {
      kind: 'linked-file' as const, bookmarkId: source.reference.id, fingerprint: inspection.contentHash,
      lastKnownName: source.name, byteSize: inspection.byteSize,
    } : undefined
    if (source.reference) await this.#originalFiles.verify(source.reference, inspection.contentHash, inspection.byteSize)
    const duplicate = await this.#repository.findByFingerprint(inspection.contentHash)
    if (duplicate) {
      if (contentLocation) {
        await this.#repository.linkOriginalAsset(duplicate.assetId, contentLocation)
      } else {
        const existing = await this.#managedStore.read(contentRelativePath)
        if (!existing || await sha256(existing) !== inspection.contentHash) {
          const write = await this.#managedStore.replaceAtomically(contentRelativePath, source.bytes, signal)
          try {
            await this.#repository.restoreManagedAsset(duplicate.assetId, contentRelativePath, inspection)
          } catch (error) {
            if (write.created) await this.#managedStore.remove(contentRelativePath)
            throw error
          }
        }
      }
      if (!options.targetBookId || options.targetBookId === duplicate.bookId) {
        await this.#database.transaction((database) =>
          applyEmbeddedCover(database, duplicate.bookId, inspection.cover, options.overwriteCover),
        )
      }
      onProgress?.({ stage: 'complete', fileName: source.name, detail: 'This exact book file is already in your library' })
      return { ...duplicate, title: inspection.title, originalName: source.name }
    }

    let coverRelativePath = inspection.cover
      ? `assets/covers/${inspection.cover.sha256}.${extensionForCover(inspection.cover.mediaType)}`
      : undefined
    const writes: ManagedFileWrite[] = []
    try {
      onProgress?.({ stage: 'storing', fileName: source.name, detail: source.reference ? 'Keeping access to the original file' : 'Saving the book on this device' })
      if (!source.reference) writes.push(await this.#managedStore.putAtomically(contentRelativePath, source.bytes, signal))
      if (format === 'pdf') {
        const cover = await this.#pdfCover(contentRelativePath, source.reference?.id)
        if (cover) {
          inspection = { ...inspection, cover }
          coverRelativePath = `assets/covers/${cover.sha256}.jpg`
        }
      }
      if (inspection.cover && coverRelativePath) {
        writes.push(await this.#managedStore.putAtomically(coverRelativePath, inspection.cover.bytes, signal))
      }
      throwIfEpubImportCanceled(signal)
      onProgress?.({ stage: 'cataloging', fileName: source.name, detail: 'Linking the book to its edition' })
      const result = await this.#repository.commit({
        originalName: source.name,
        inspection,
        contentRelativePath,
        ...(contentLocation ? { contentLocation } : {}),
        ...(options.targetBookId ? { targetBookId: options.targetBookId } : {}),
        overwriteCover: options.overwriteCover,
        ...(coverRelativePath ? { coverRelativePath } : {}),
      })
      onProgress?.({
        stage: 'complete',
        fileName: source.name,
        detail: result.outcome === 'revision'
          ? 'Revised file linked to its existing edition'
          : result.outcome === 'duplicate'
            ? 'This exact book file is already in your library'
            : 'Book safely added to the library',
      })
      return result
    } catch (error) {
      await Promise.all(writes.filter(({ created }) => created).map(({ relativePath }) =>
        this.#managedStore.remove(relativePath),
      ))
      if (error instanceof EpubImportError || (error instanceof Error && error.name === 'FileAccessError')) throw error
      throw new EpubImportError(
        'storage-failed',
        'The book could not be committed. Its catalog records and newly managed files were rolled back.',
        { cause: error },
      )
    }
  }
}

function extensionForCover(mediaType: string): string {
  return {
    'image/avif': 'avif',
    'image/gif': 'gif',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/svg+xml': 'svg',
    'image/webp': 'webp',
  }[mediaType.toLocaleLowerCase()] ?? 'image'
}
