import { Filesystem } from '@capacitor/filesystem'
import { EPUB_MEDIA_TYPE, EpubImportError, MAX_EPUB_ARCHIVE_BYTES } from './model'

export type EpubImportSource = {
  readonly name: string
  readonly mediaType: string
  readonly bytes: Uint8Array
}

export async function epubSourceFromFile(file: File): Promise<EpubImportSource> {
  assertSafeIncomingSize(file.size)
  return {
    name: file.name,
    mediaType: file.type,
    bytes: new Uint8Array(await file.arrayBuffer()),
  }
}

export async function epubSourceFromIncomingUrl(url: string): Promise<EpubImportSource> {
  if (!/^(?:file|content|capacitor):/i.test(url)) {
    throw new EpubImportError(
      'wrong-media-type',
      'Wovenleaf ignored a non-file link. Use the file picker or share a local DRM-free EPUB.',
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
      name: incomingName(url),
      mediaType: EPUB_MEDIA_TYPE,
      bytes,
    }
  } catch (error) {
    throw new EpubImportError(
      'storage-failed',
      'The shared EPUB could not be read. Choose it again from Files to grant access.',
      { cause: error },
    )
  }
}

function assertSafeIncomingSize(byteSize: number): void {
  if (byteSize > MAX_EPUB_ARCHIVE_BYTES) {
    throw new EpubImportError(
      'archive-too-large',
      `This EPUB is larger than the ${MAX_EPUB_ARCHIVE_BYTES / (1024 * 1024)} MB import limit.`,
    )
  }
}

function incomingName(url: string): string {
  const lastSegment = url.split(/[\\/]/).at(-1)?.split(/[?#]/, 1)[0] ?? 'Shared book.epub'
  try {
    const decoded = decodeURIComponent(lastSegment)
    return decoded.toLocaleLowerCase().endsWith('.epub') ? decoded : `${decoded || 'Shared book'}.epub`
  } catch {
    return 'Shared book.epub'
  }
}

function base64ToBytes(encoded: string): Uint8Array {
  const binary = atob(encoded.replace(/^data:[^,]+,/, ''))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}
