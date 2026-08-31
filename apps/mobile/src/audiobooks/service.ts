import type { SqlDatabase } from '../storage/database'
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
  readonly managedStore?: ManagedAudiobookStore
  readonly createCapabilityId?: () => string
}

export class AudiobookImportService {
  readonly #repository: AudiobookImportRepository
  readonly #managedStore: ManagedAudiobookStore
  readonly #createCapabilityId: () => string

  constructor(database: SqlDatabase, options: AudiobookImportServiceOptions = {}) {
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

  async import(
    sources: readonly AudiobookImportSource[],
    review: AudiobookImportReview,
    options: {
      readonly signal?: AbortSignal
      readonly onProgress?: (progress: AudiobookImportProgress) => void
      readonly targetBookId?: string
    } = {},
  ): Promise<AudiobookImportResult> {
    const { signal, onProgress } = options
    throwIfAudiobookImportCanceled(signal)
    const draft = await inspectAudiobook(sources, { signal })
    const audiobook = await normalizeAudiobookReview(draft, review)
    const duplicate = await this.#repository.findByFingerprint(audiobook.fingerprint)
    if (duplicate) {
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
          detail: 'Copying verified audio into private managed storage',
          completedFiles: index,
          totalFiles: audiobook.segments.length,
        })
        const suffix = segment.container === 'mpeg-4-audio' ? 'm4b' : 'mp3'
        const relativePath = `${bundleRelativePath}/segments/${segment.fingerprint}.${suffix}`
        writes.push(await this.#managedStore.putAtomically(relativePath, source.bytes, signal))
        storedSegments.push({
          segmentId: segment.id,
          relativePath,
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
      if (error instanceof AudiobookImportError) throw error
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
