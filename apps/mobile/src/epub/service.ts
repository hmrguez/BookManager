import { ebookFormat, inspectBook } from './inspect-book'
import type { EpubCover } from './model'
import { pdfCover } from '../pdf/cover'
import { sha256 } from '../audiobooks/binary'
import type { SqlDatabase } from '../storage/database'
import { LibraryUpgradeRequired } from '../purchases/model'
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
  readonly managedStore?: ManagedAssetStore
  readonly pdfCover?: (relativePath: string) => Promise<EpubCover | undefined>
}

export class EpubImportService {
  readonly #database: SqlDatabase
  readonly #repository: EpubImportRepository
  readonly #managedStore: ManagedAssetStore
  readonly #pdfCover: (relativePath: string) => Promise<EpubCover | undefined>

  constructor(database: SqlDatabase, options: EpubImportServiceOptions = {}) {
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
    let inspection = await inspectBook(source.bytes, {
      fileName: source.name,
      mediaType: source.mediaType,
      signal,
      onProgress,
    })
    const format = ebookFormat(inspection)
    const contentRelativePath = `assets/${format}/${inspection.contentHash}.${format}`
    const duplicate = await this.#repository.findByFingerprint(inspection.contentHash)
    if (duplicate) {
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
      if (!options.targetBookId || options.targetBookId === duplicate.bookId) {
        await this.#database.transaction((database) =>
          applyEmbeddedCover(database, duplicate.bookId, inspection.cover, options.overwriteCover),
        )
      }
      onProgress?.({ stage: 'complete', fileName: source.name, detail: 'This exact book file is already managed' })
      return { ...duplicate, title: inspection.title, originalName: source.name }
    }

    let coverRelativePath = inspection.cover
      ? `assets/covers/${inspection.cover.sha256}.${extensionForCover(inspection.cover.mediaType)}`
      : undefined
    const writes: ManagedFileWrite[] = []
    try {
      onProgress?.({ stage: 'storing', fileName: source.name, detail: 'Copying into private managed storage' })
      writes.push(await this.#managedStore.putAtomically(contentRelativePath, source.bytes, signal))
      if (format === 'pdf') {
        const cover = await this.#pdfCover(contentRelativePath)
        if (cover) {
          inspection = { ...inspection, cover }
          coverRelativePath = `assets/covers/${cover.sha256}.jpg`
        }
      }
      if (inspection.cover && coverRelativePath) {
        writes.push(await this.#managedStore.putAtomically(coverRelativePath, inspection.cover.bytes, signal))
      }
      throwIfEpubImportCanceled(signal)
      onProgress?.({ stage: 'cataloging', fileName: source.name, detail: 'Linking provenance, edition, and managed asset' })
      const result = await this.#repository.commit({
        originalName: source.name,
        inspection,
        contentRelativePath,
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
            ? 'This exact book file is already managed'
            : 'Book safely added to the library',
      })
      return result
    } catch (error) {
      await Promise.all(writes.filter(({ created }) => created).map(({ relativePath }) =>
        this.#managedStore.remove(relativePath),
      ))
      if (error instanceof EpubImportError || error instanceof LibraryUpgradeRequired) throw error
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
