import { Capacitor } from '@capacitor/core'
import { FileAccessError, originalFiles, originalSelectionFromUri, type OriginalFile, type OriginalFileReference } from '../files/original-files'
import { isPdfBytes } from './inspect-book'
import { inspectOriginalEpub } from './inspect'
import type { EpubInspection } from './model'
import { Filesystem } from '@capacitor/filesystem'
import { EPUB_MEDIA_TYPE, EpubImportError, MAX_EPUB_ARCHIVE_BYTES } from './model'

export type EpubImportSource = {
  readonly reference?: OriginalFileReference
  readonly name: string
  readonly mediaType: string
  readonly bytes: Uint8Array
  readonly originalInspection?: EpubInspection
}

export async function epubSourceFromFile(file: File): Promise<EpubImportSource> {
  if (Capacitor.isNativePlatform() && !(file as OriginalFile).originalReference) throw new FileAccessError({ code: 'RESELECT_FILE' })
  assertSafeIncomingSize(file.size)
  const reference = (file as OriginalFile).originalReference
  if (reference) return epubSourceFromOriginal(reference, file.type)
  return {
    reference: (file as OriginalFile).originalReference,
    name: file.name,
    mediaType: file.type,
    bytes: new Uint8Array(await file.arrayBuffer()),
  }
}

export async function epubSourceFromIncomingUrl(url: string): Promise<EpubImportSource> {
  if (Capacitor.isNativePlatform()) {
    const reference = await originalSelectionFromUri(url)
    assertSafeIncomingSize(reference.size)
    return epubSourceFromOriginal(reference, reference.mediaType)
  }
  if (!/^(?:file|content|capacitor):/i.test(url)) {
    throw new EpubImportError(
      'wrong-media-type',
      'Wovenleaf ignored a non-file link. Use the file picker or share a local unprotected EPUB or PDF.',
    )
  }
  try {
    const metadata = await Filesystem.stat({ path: url })
    assertSafeIncomingSize(metadata.size)
  } catch (error) {
    if (error instanceof EpubImportError) throw error
    // Some content providers do not expose metadata; the byte-level validator still enforces the limit.
  }
  try {
    const result = await Filesystem.readFile({ path: url })
    const bytes = result.data instanceof Blob
      ? new Uint8Array(await result.data.arrayBuffer())
      : base64ToBytes(result.data)
    return {
      name: incomingName(url, isPdfBytes(bytes)),
      mediaType: isPdfBytes(bytes) ? 'application/pdf' : EPUB_MEDIA_TYPE,
      bytes,
    }
  } catch (error) {
    throw new EpubImportError(
      'storage-failed',
      'The shared book could not be read. Choose it again from Files to grant access.',
      { cause: error },
    )
  }
}

export async function epubSourceFromOriginal(reference: OriginalFileReference, mediaType: string): Promise<EpubImportSource> {
  assertSafeIncomingSize(reference.size)
  const header = await originalFiles.readRange(reference, 0, Math.min(16, reference.size))
  if (isPdfBytes(header)) return { name: reference.name, mediaType: 'application/pdf', reference, bytes: await originalFiles.read(reference) }
  const inspection = await inspectOriginalEpub(reference, { fileName: reference.name, mediaType })
  return { name: reference.name, mediaType, reference, bytes: new Uint8Array(), originalInspection: inspection }
}

function assertSafeIncomingSize(byteSize: number): void {
  if (byteSize > MAX_EPUB_ARCHIVE_BYTES) {
    throw new EpubImportError(
      'archive-too-large',
      `This book is larger than the ${MAX_EPUB_ARCHIVE_BYTES / (1024 * 1024)} MB import limit.`,
    )
  }
}

function incomingName(url: string, pdf = false): string {
  const extension = pdf ? 'pdf' : 'epub'
  const lastSegment = url.split(/[\\/]/).at(-1)?.split(/[?#]/, 1)[0] ?? 'Shared book.epub'
  try {
    const decoded = decodeURIComponent(lastSegment)
    return decoded.toLocaleLowerCase().endsWith(`.${extension}`) ? decoded : `${decoded || 'Shared book'}.${extension}`
  } catch {
    return `Shared book.${extension}`
  }
}

function base64ToBytes(encoded: string): Uint8Array {
  const binary = atob(encoded.replace(/^data:[^,]+,/, ''))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}
