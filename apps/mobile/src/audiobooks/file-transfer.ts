import { Filesystem, type FilesystemPlugin } from '@capacitor/filesystem'
import { AudiobookImportError } from './model'

// Keep both the encoded bridge payload and native decoding allocations bounded.
export const AUDIOBOOK_FILE_CHUNK_BYTES = 1024 * 1024

export async function readNativeAudiobookFile(
  path: string,
  maxBytes: number,
  filesystem: Pick<FilesystemPlugin, 'stat' | 'readFile'> = Filesystem,
): Promise<Uint8Array> {
  const { size } = await filesystem.stat({ path })
  if (!Number.isSafeInteger(size) || size < 0 || size > maxBytes) {
    throw new AudiobookImportError('unsupported-format', 'This audiobook is larger than the managed import limit.')
  }
  // Inspection still needs the original bytes. Fill one buffer instead of
  // materializing a file-sized base64 string and a second decoded string.
  const bytes = new Uint8Array(size)
  for (let offset = 0; offset < size;) {
    const length = Math.min(AUDIOBOOK_FILE_CHUNK_BYTES, size - offset)
    const result = await filesystem.readFile({ path, offset, length })
    const chunk = result.data instanceof Blob
      ? new Uint8Array(await result.data.arrayBuffer())
      : base64ToBytes(result.data)
    if (chunk.byteLength === 0 || chunk.byteLength > length) {
      throw new Error('The shared audiobook changed or could not be read completely.')
    }
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  if ((await filesystem.stat({ path })).size !== size) {
    throw new Error('The shared audiobook changed while it was being read.')
  }
  return bytes
}

export function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = []
  for (let offset = 0; offset < bytes.byteLength; offset += 32_768) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32_768)))
  }
  return btoa(chunks.join(''))
}

export function base64ToBytes(encoded: string): Uint8Array {
  const binary = atob(encoded.replace(/^data:[^,]+,/, ''))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}
