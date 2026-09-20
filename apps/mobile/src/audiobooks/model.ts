import type { OriginalFileReference } from '../files/original-files'
import type { ParsedAudioMetadata } from './mp3'
export const AUDIOBOOK_MANIFEST_VERSION = 1 as const

export const AUDIOBOOK_MEDIA_TYPES = {
  mp3: 'audio/mpeg',
  m4b: 'audio/mp4',
} as const

export type AudiobookContainer = 'mpeg-audio' | 'mpeg-4-audio'

export type AudiobookImportSource = {
  readonly reference?: OriginalFileReference
  readonly name: string
  readonly relativePath: string
  readonly mediaType: string
  readonly bytes: Uint8Array
  /** Native audio keeps only inspected metadata here; bytes is empty and playback uses reference. */
  readonly originalInspection?: {
    readonly container: AudiobookContainer
    readonly metadata: ParsedAudioMetadata
    readonly fingerprint: string
  }
}

export type AudiobookCover = {
  readonly mediaType: string
  readonly bytes: Uint8Array
  readonly sha256: string
  readonly provenance: 'embedded' | 'sidecar'
}

export type AudiobookSegmentInspection = {
  readonly id: string
  readonly sourceIndex: number
  readonly fileName: string
  readonly relativePath: string
  readonly container: AudiobookContainer
  readonly mediaType: 'audio/mpeg' | 'audio/mp4'
  readonly durationMs: number
  readonly byteSize: number
  readonly fingerprint: string
  readonly title?: string
  readonly album?: string
  readonly authors: readonly string[]
  readonly narrators: readonly string[]
  readonly series?: string
  readonly trackNumber?: number
  readonly trackTotal?: number
  readonly discNumber?: number
  readonly discTotal?: number
}

export type AudiobookChapterInspection = {
  readonly key: string
  readonly title: string
  readonly segmentId: string
  readonly positionMs: number
  readonly endPositionMs?: number
  readonly provenance: 'embedded' | 'cue' | 'sidecar' | 'track'
}

export type AudiobookImportIssueCode =
  | 'ambiguous-order'
  | 'duplicate-track-number'
  | 'missing-title'
  | 'missing-author'
  | 'conflicting-metadata'
  | 'mislabeled-container'

export type AudiobookImportIssue = {
  readonly code: AudiobookImportIssueCode
  readonly severity: 'review' | 'notice'
  readonly message: string
  readonly segmentIds: readonly string[]
}

export type AudiobookMetadataDraft = {
  readonly title: string
  readonly authors: readonly string[]
  readonly narrators: readonly string[]
  readonly series?: string
  readonly language?: string
}

export type AudiobookImportDraft = {
  readonly inspectionId: string
  readonly sourceSetFingerprint: string
  readonly suggestedOrder: readonly string[]
  readonly segments: readonly AudiobookSegmentInspection[]
  readonly chapters: readonly AudiobookChapterInspection[]
  readonly metadata: AudiobookMetadataDraft
  readonly cover?: AudiobookCover
  readonly issues: readonly AudiobookImportIssue[]
  readonly requiresOrderReview: boolean
  readonly totalDurationMs: number
}

export type AudiobookImportReview = {
  readonly inspectionId: string
  readonly segmentIds: readonly string[]
  readonly title: string
  readonly authors: readonly string[]
  readonly narrators: readonly string[]
  readonly series?: string
  readonly language?: string
  readonly orderConfirmed: boolean
}

export type NormalizedAudiobookSegment = AudiobookSegmentInspection & {
  readonly absoluteStartMs: number
  readonly absoluteEndMs: number
}

export type NormalizedAudiobookChapter = {
  readonly key: string
  readonly title: string
  readonly segmentId: string
  readonly absoluteStartMs: number
  readonly absoluteEndMs: number
  readonly provenance: AudiobookChapterInspection['provenance']
}

export type NormalizedAudiobook = {
  readonly inspectionId: string
  readonly sourceSetFingerprint: string
  readonly fingerprint: string
  readonly metadataKey: string
  readonly metadata: AudiobookMetadataDraft
  readonly segments: readonly NormalizedAudiobookSegment[]
  readonly chapters: readonly NormalizedAudiobookChapter[]
  readonly cover?: AudiobookCover
  readonly totalDurationMs: number
  readonly format: 'm4b' | 'mp3'
  readonly mediaType: 'audio/mp4' | 'audio/mpeg'
}

export type PlaybackManifestSegment = {
  readonly id: string
  readonly mediaType: 'audio/mp4' | 'audio/mpeg'
  readonly container: AudiobookContainer
  readonly durationMs: number
  readonly absoluteStartMs: number
  readonly absoluteEndMs: number
  readonly fingerprint: string
  /** Opaque identifier resolved inside the native playback adapter. */
  readonly playableCapability: string
}

export type PlaybackManifestChapter = {
  readonly key: string
  readonly title: string
  readonly segmentId: string
  readonly absoluteStartMs: number
  readonly absoluteEndMs: number
  readonly provenance: AudiobookChapterInspection['provenance']
}

export type PlaybackManifest = {
  readonly schemaVersion: typeof AUDIOBOOK_MANIFEST_VERSION
  readonly queueId: string
  readonly editionId: string
  readonly assetId: string
  readonly fingerprint: string
  readonly createdAt: string
  readonly displayMetadata: {
    readonly title: string
    readonly authors: readonly string[]
    readonly narrators: readonly string[]
    readonly series?: string
  }
  readonly systemSurfaceMetadata: {
    readonly private: { readonly title: 'Wovenleaf'; readonly subtitle: 'Audiobook' }
    readonly preview: {
      readonly title: string
      readonly contributor: string
      readonly series?: string
    }
  }
  readonly segments: readonly PlaybackManifestSegment[]
  readonly chapters: readonly PlaybackManifestChapter[]
  readonly initialAbsolutePositionMs: number
  readonly rate: number
  readonly skipIntervals: { readonly forwardMs: number; readonly backwardMs: number }
  readonly sleepTimer: null
  readonly sourceCapabilities: {
    readonly local: true
    readonly seekable: true
    readonly relinkable: true
  }
}

export type AudiobookImportOutcome = 'imported' | 'revision' | 'duplicate'

export type AudiobookImportResult = {
  readonly importId: string
  readonly outcome: AudiobookImportOutcome
  readonly title: string
  readonly bookId: string
  readonly editionId: string
  readonly assetId: string
  readonly fingerprint: string
  readonly importedAt: string
  readonly manifest: PlaybackManifest
}

export type AudiobookImportStage =
  | 'reading'
  | 'inspecting'
  | 'fingerprinting'
  | 'review-ready'
  | 'storing'
  | 'cataloging'
  | 'complete'

export type AudiobookImportProgress = {
  readonly stage: AudiobookImportStage
  readonly fileName: string
  readonly detail: string
  readonly completedFiles?: number
  readonly totalFiles?: number
}

export type AudiobookImportErrorCode =
  | 'canceled'
  | 'empty-selection'
  | 'unsupported-combination'
  | 'unsupported-format'
  | 'corrupt-file'
  | 'drm-protected'
  | 'unsafe-path'
  | 'review-required'
  | 'stale-review'
  | 'storage-failed'

export class AudiobookImportError extends Error {
  readonly code: AudiobookImportErrorCode

  constructor(code: AudiobookImportErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AudiobookImportError'
    this.code = code
  }
}

export function canceledAudiobookImport(): AudiobookImportError {
  return new AudiobookImportError('canceled', 'Import canceled. No audiobook was added.')
}

export function throwIfAudiobookImportCanceled(signal?: AbortSignal): void {
  if (signal?.aborted) throw canceledAudiobookImport()
}

export function audiobookImportErrorMessage(error: unknown): string {
  if (error instanceof Error && ['LibraryUpgradeRequired', 'FileAccessError'].includes(error.name)) return error.message
  if (error instanceof AudiobookImportError) return error.message
  return 'This audiobook could not be imported. The library and managed files were left unchanged.'
}
