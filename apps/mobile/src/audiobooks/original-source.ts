import { FileAccessError, originalFiles, type OriginalFileAccess, type OriginalFileReference } from '../files/original-files'
import { dataView, readAscii, safeRelativePath, synchsafeInteger, uint64 } from './binary'
import { parseM4b } from './m4b'
import { AudiobookImportError, type AudiobookImportSource } from './model'
import { parseMp3 } from './mp3'

/** Read container metadata by offset; audio payloads never cross the native bridge. */
export async function audiobookSourceFromOriginal(
  reference: OriginalFileReference,
  relativePath = reference.name,
  mediaType = 'application/octet-stream',
  access: OriginalFileAccess = originalFiles,
): Promise<AudiobookImportSource> {
  const header = await access.readRange(reference, 0, Math.min(16, reference.size))
  const container = readAscii(header, 4, 4) === 'ftyp' ? 'mpeg-4-audio' : 'mpeg-audio'
  const metadata = container === 'mpeg-4-audio'
    ? parseM4b(await readM4bMetadata(reference, access), reference.name)
    : await readMp3Metadata(reference, header, access)
  // Stream content identity natively without allocating the full file in JavaScript.
  const identity = await access.inspect(reference.id)
  if (identity.size !== reference.size || !identity.fingerprint || !/^[a-f0-9]{64}$/.test(identity.fingerprint)) {
    throw new FileAccessError({ code: 'FILE_CHANGED' })
  }
  return {
    reference, name: reference.name, relativePath: safeRelativePath(relativePath), mediaType,
    bytes: new Uint8Array(),
    originalInspection: { container, metadata, fingerprint: identity.fingerprint },
  }
}

async function readM4bMetadata(reference: OriginalFileReference, access: OriginalFileAccess): Promise<Uint8Array> {
  const parts: Uint8Array[] = []
  let metadataBytes = 0
  let count = 0
  for (let offset = 0; offset < reference.size;) {
    if (++count > 4096 || reference.size - offset < 8) throw corruptContainer()
    const header = await access.readRange(reference, offset, Math.min(16, reference.size - offset))
    const shortSize = dataView(header).getUint32(0, false)
    const headerSize = shortSize === 1 ? 16 : 8
    if (header.length < headerSize) throw corruptContainer()
    const size = shortSize === 1 ? uint64(header, 8) : shortSize === 0 ? reference.size - offset : shortSize
    if (size < headerSize || size > reference.size - offset) throw corruptContainer()
    const type = readAscii(header, 4, 4)
    if (type === 'ftyp' || type === 'moov') {
      metadataBytes += size
      if (metadataBytes > 64 * 1024 * 1024) {
        throw new AudiobookImportError('unsupported-format', 'This audiobook contains too much container metadata to inspect safely.')
      }
      parts.push(await access.readRange(reference, offset, size))
    }
    offset += size // Seek over mdat, including when moov follows a large audio payload.
  }
  const bytes = new Uint8Array(metadataBytes)
  let offset = 0
  for (const part of parts) { bytes.set(part, offset); offset += part.length }
  return bytes
}

async function readMp3Metadata(reference: OriginalFileReference, header: Uint8Array, access: OriginalFileAccess) {
  const tagSize = readAscii(header, 0, 3) === 'ID3'
    ? 10 + synchsafeInteger(header, 6) + (header[3] === 4 && ((header[5] ?? 0) & 0x10) !== 0 ? 10 : 0)
    : 0
  if (tagSize < 0 || tagSize > reference.size || tagSize > 16 * 1024 * 1024) throw corruptContainer()
  const prefix = await access.readRange(reference, 0, Math.min(reference.size, tagSize + 65_536))
  const durationMs = await access.audioDuration(reference.id)
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw corruptContainer()
  return parseMp3(prefix, reference.name, durationMs)
}

function corruptContainer() {
  return new AudiobookImportError('corrupt-file', 'The original audiobook container is truncated or malformed.')
}
