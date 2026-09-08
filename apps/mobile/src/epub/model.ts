import type { EpubCompatibilityProfile } from './compatibility'

export const EPUB_MEDIA_TYPE = 'application/epub+zip'
export const MAX_EPUB_ARCHIVE_BYTES = 256 * 1024 * 1024

export type EpubIdentifier = {
  readonly scheme: 'isbn-10' | 'isbn-13' | 'custom'
  readonly value: string
  readonly normalizedValue: string
}

export type EpubCover = {
  readonly path: string
  readonly mediaType: string
  readonly bytes: Uint8Array
  readonly sha256: string
}

export type EpubInspection = {
  readonly contentHash: string
  readonly byteSize: number
  readonly entryCount: number
  readonly packagePath: string
  readonly packageVersion: '2' | '3'
  readonly packageIdentifier: string
  readonly title: string
  readonly creators: readonly string[]
  readonly language: string
  readonly publisher?: string
  readonly publicationDate?: string
  readonly identifiers: readonly EpubIdentifier[]
  readonly cover?: EpubCover
  readonly containsScriptedContent: boolean
  readonly compatibility: EpubCompatibilityProfile
}

export type EpubImportOutcome = 'imported' | 'revision' | 'duplicate'

export type EpubImportResult = {
  readonly importId: string
  readonly outcome: EpubImportOutcome
  readonly title: string
  readonly bookId: string
  readonly editionId: string
  readonly assetId: string
  readonly fingerprint: string
  readonly originalName: string
  readonly importedAt: string
}

export type EpubImportStage =
  | 'reading'
  | 'validating'
  | 'fingerprinting'
  | 'storing'
  | 'cataloging'
  | 'complete'

export type EpubImportProgress = {
  readonly stage: EpubImportStage
  readonly fileName: string
  readonly detail: string
}

export type EpubImportErrorCode =
  | 'canceled'
  | 'wrong-media-type'
  | 'invalid-container'
  | 'unsafe-path'
  | 'archive-too-large'
  | 'archive-bomb'
  | 'encrypted-archive'
  | 'drm-protected'
  | 'invalid-package'
  | 'unsupported-version'
  | 'storage-failed'

export class EpubImportError extends Error {
  readonly code: EpubImportErrorCode

  constructor(code: EpubImportErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'EpubImportError'
    this.code = code
  }
}

export function canceledEpubImport(): EpubImportError {
  return new EpubImportError('canceled', 'Import canceled. No EPUB was added.')
}

export function throwIfEpubImportCanceled(signal?: AbortSignal): void {
  if (signal?.aborted) throw canceledEpubImport()
}

export function epubImportErrorMessage(error: unknown): string {
  if (error instanceof Error && error.name === 'LibraryUpgradeRequired') return error.message
  if (error instanceof EpubImportError) return error.message
  return 'This EPUB could not be imported. The library and managed files were left unchanged.'
}
