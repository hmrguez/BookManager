import { originalFiles, type OriginalFileAccess } from '../files/original-files'
import type { SqlDatabase } from '../storage/database'
import { LibraryUpgradeRequired } from '../purchases/model'
import { applyEmbeddedCover } from '../covers/embedded-cover'
import { extension } from './binary'
import { inspectAudiobook, normalizeAudiobookReview } from './inspect'
import {
  CapacitorManagedAudiobookStore,
  type ManagedAudiobookStore,
  type ManagedAudiobookWrite,
} from './managed-store'
import {
  AudiobookImportError,
  throwIfAudiobookImportCanceled,
  type AudiobookImportDraft,
  type AudiobookImportProgress,
  type AudiobookImportResult,
  type AudiobookImportReview,
  type AudiobookImportSource,
} from './model'
import {
  AudiobookImportRepository,
  type AudiobookImportRepositoryOptions,
  type StoredAudiobookSegment,
} from './repository'

export type AudiobookImportServiceOptions = AudiobookImportRepositoryOptions & {
  readonly originalFiles?: OriginalFileAccess
  readonly managedStore?: ManagedAudiobookStore
  readonly createCapabilityId?: () => string
}

export class AudiobookImportService {
  readonly #originalFiles: OriginalFileAccess
  readonly #database: SqlDatabase
  readonly #repository: AudiobookImportRepository
  readonly #managedStore: ManagedAudiobookStore
  readonly #createCapabilityId: () => string

  constructor(database: SqlDatabase, options: AudiobookImportServiceOptions = {}) {
    this.#originalFiles = options.originalFiles ?? originalFiles
    this.#database = database
    this.#repository = new AudiobookImportRepository(database, options)
    this.#managedStore = options.managedStore ?? new CapacitorManagedAudiobookStore()
    this.#createCapabilityId = options.createCapabilityId
      ?? (() => `audio-capability:${crypto.randomUUID()}`)
  }

  prepare(
    sources: readonly AudiobookImportSource[],
    options: {
      readonly signal?: AbortSignal
      readonly onProgress?: (progress: AudiobookImportProgress) => void
    } = {},
  ): Promise<AudiobookImportDraft> {
    return inspectAudiobook(sources, options)
  }

  findImported(draft: AudiobookImportDraft): Promise<AudiobookImportResult | undefined> {
    return this.#repository.findBySourceSetFingerprint(draft.sourceSetFingerprint)
  }

  async relinkImported(result: AudiobookImportResult, sources: readonly AudiobookImportSource[], draft: AudiobookImportDraft): Promise<void> {
    const references = new Map<string, string>()
    for (const segment of draft.segments) {
      const source = sources.find((candidate) => candidate.relativePath === segment.relativePath)
      if (!source?.reference) continue
      await this.#originalFiles.verify(source.reference, segment.fingerprint, segment.byteSize)
      references.set(segment.fingerprint, source.reference.id)
    }
    if (references.size) await this.#repository.linkOriginalSegments(result.assetId, references)
  }

  async import(
    sources: readonly AudiobookImportSource[],
    review: AudiobookImportReview,
    options: {
      readonly signal?: AbortSignal
      readonly onProgress?: (progress: AudiobookImportProgress) => void
      readonly targetBookId?: string
      readonly overwriteCover?: boolean
    } = {},
  ): Promise<AudiobookImportResult> {
    const { signal, onProgress } = options
    throwIfAudiobookImportCanceled(signal)
    const draft = await inspectAudiobook(sources, { signal })
    const audiobook = await normalizeAudiobookReview(draft, review)
    for (const segment of audiobook.segments) {
      const source = sources.find((candidate) => candidate.relativePath === segment.relativePath)
      if (source?.reference) await this.#originalFiles.verify(source.reference, segment.fingerprint, segment.byteSize)
    }
    const duplicate = await this.#repository.findByFingerprint(audiobook.fingerprint)
    if (duplicate) {
      await this.relinkImported(duplicate, sources, draft)
      if (!options.targetBookId || options.targetBookId === duplicate.bookId) {
        await this.#database.transaction((database) =>
          applyEmbeddedCover(database, duplicate.bookId, audiobook.cover, options.overwriteCover),
        )
      }
      onProgress?.({
        stage: 'complete',
        fileName: audiobook.metadata.title,
        detail: 'This exact normalized audiobook is already managed',
      })
      return duplicate
    }

    const bundleRelativePath = `assets/audiobooks/${audiobook.sourceSetFingerprint}`
    const writes: ManagedAudiobookWrite[] = []
    const storedSegments: StoredAudiobookSegment[] = []
    try {
      for (const [index, segment] of audiobook.segments.entries()) {
        throwIfAudiobookImportCanceled(signal)
        const source = sources.find(({ relativePath }) => relativePath === segment.relativePath)
        if (!source) {
          throw new AudiobookImportError('stale-review', `“${segment.fileName}” is no longer in the selected files.`)
        }
        onProgress?.({
          stage: 'storing',
          fileName: segment.fileName,
          detail: source.reference ? 'Keeping access to the original audio' : 'Saving verified audio on this device',
          completedFiles: index,
          totalFiles: audiobook.segments.length,
        })
        const suffix = segment.container === 'mpeg-4-audio' ? 'm4b' : 'mp3'
        const relativePath = `${bundleRelativePath}/segments/${segment.fingerprint}.${suffix}`
        if (!source.reference) writes.push(await this.#managedStore.putAtomically(relativePath, source.bytes, signal))
        storedSegments.push({
          segmentId: segment.id,
          relativePath: source.reference ? '' : relativePath,
          ...(source.reference ? { referenceId: source.reference.id } : {}),
          capabilityId: this.#createCapabilityId(),
        })
      }
      let coverRelativePath: string | undefined
      if (audiobook.cover) {
        coverRelativePath = `assets/covers/${audiobook.cover.sha256}.${coverExtension(audiobook.cover.mediaType)}`
        writes.push(await this.#managedStore.putAtomically(coverRelativePath, audiobook.cover.bytes, signal))
      }
      throwIfAudiobookImportCanceled(signal)
      onProgress?.({
        stage: 'cataloging',
        fileName: audiobook.metadata.title,
        detail: 'Creating one edition asset and its immutable playback manifest',
        completedFiles: audiobook.segments.length,
        totalFiles: audiobook.segments.length,
      })
      const result = await this.#repository.commit({
        audiobook,
        bundleRelativePath,
        storedSegments,
        ...(options.targetBookId ? { targetBookId: options.targetBookId } : {}),
        overwriteCover: options.overwriteCover,
        ...(coverRelativePath ? { coverRelativePath } : {}),
      })
      onProgress?.({
        stage: 'complete',
        fileName: audiobook.metadata.title,
        detail: result.outcome === 'revision'
          ? 'Revision linked without replacing reading progress'
          : 'Audiobook safely normalized and added',
        completedFiles: audiobook.segments.length,
        totalFiles: audiobook.segments.length,
      })
      return result
    } catch (error) {
      await Promise.all(
        distinctCreatedWrites(writes).map(({ relativePath }) => this.#managedStore.remove(relativePath)),
      )
      if (error instanceof AudiobookImportError || error instanceof LibraryUpgradeRequired || (error instanceof Error && error.name === 'FileAccessError')) throw error
      throw new AudiobookImportError(
        'storage-failed',
        'The audiobook could not be committed. Its catalog records and newly managed files were rolled back.',
        { cause: error },
      )
    }
  }
}

function distinctCreatedWrites(writes: readonly ManagedAudiobookWrite[]): ManagedAudiobookWrite[] {
  const paths = new Set<string>()
  return writes.filter(({ created, relativePath }) => {
    if (!created || paths.has(relativePath)) return false
    paths.add(relativePath)
    return true
  })
}

function coverExtension(mediaType: string): string {
  return ({
    'image/avif': 'avif',
    'image/gif': 'gif',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  } as Record<string, string>)[mediaType.toLocaleLowerCase()] ?? (extension(mediaType) || 'image')
}
