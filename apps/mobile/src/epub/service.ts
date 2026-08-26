import type { SqlDatabase } from '../storage/database'
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
}

export class EpubImportService {
  readonly #repository: EpubImportRepository
  readonly #managedStore: ManagedAssetStore

  constructor(database: SqlDatabase, options: EpubImportServiceOptions = {}) {
    this.#repository = new EpubImportRepository(database, options)
    this.#managedStore = options.managedStore ?? new CapacitorManagedAssetStore()
  }

  async import(
    source: EpubImportSource,
    options: {
      readonly signal?: AbortSignal
      readonly onProgress?: (progress: EpubImportProgress) => void
    } = {},
  ): Promise<EpubImportResult> {
    const { signal, onProgress } = options
    throwIfEpubImportCanceled(signal)
    onProgress?.({ stage: 'reading', fileName: source.name, detail: 'Reading the selected file locally' })
    const { inspectEpub } = await import('./inspect')
    const inspection = await inspectEpub(source.bytes, {
      fileName: source.name,
      mediaType: source.mediaType,
      signal,
      onProgress,
    })
    const duplicate = await this.#repository.findByFingerprint(inspection.contentHash)
    if (duplicate) {
      onProgress?.({ stage: 'complete', fileName: source.name, detail: 'This exact EPUB is already managed' })
      return { ...duplicate, title: inspection.title, originalName: source.name }
    }

    const contentRelativePath = `assets/epub/${inspection.contentHash}.epub`
    const coverRelativePath = inspection.cover
      ? `assets/covers/${inspection.cover.sha256}.${extensionForCover(inspection.cover.mediaType)}`
      : undefined
    const writes: ManagedFileWrite[] = []
    try {
      onProgress?.({ stage: 'storing', fileName: source.name, detail: 'Copying into private managed storage' })
      writes.push(await this.#managedStore.putAtomically(contentRelativePath, source.bytes, signal))
      if (inspection.cover && coverRelativePath) {
        writes.push(await this.#managedStore.putAtomically(coverRelativePath, inspection.cover.bytes, signal))
      }
      throwIfEpubImportCanceled(signal)
      onProgress?.({ stage: 'cataloging', fileName: source.name, detail: 'Linking provenance, edition, and managed asset' })
      const result = await this.#repository.commit({
        originalName: source.name,
        inspection,
        contentRelativePath,
        ...(coverRelativePath ? { coverRelativePath } : {}),
      })
      onProgress?.({
        stage: 'complete',
        fileName: source.name,
        detail: result.outcome === 'revision'
          ? 'Revised file linked to its existing edition'
          : result.outcome === 'duplicate'
            ? 'This exact EPUB is already managed'
            : 'EPUB safely added to the library',
      })
      return result
    } catch (error) {
      await Promise.all(writes.filter(({ created }) => created).map(({ relativePath }) =>
        this.#managedStore.remove(relativePath),
      ))
      if (error instanceof EpubImportError) throw error
      throw new EpubImportError(
        'storage-failed',
        'The EPUB could not be committed. Its catalog records and newly managed files were rolled back.',
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
