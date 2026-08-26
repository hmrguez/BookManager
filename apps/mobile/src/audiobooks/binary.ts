import { AudiobookImportError } from './model'

export async function sha256(bytes: Uint8Array): Promise<string> {
  const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const digest = await crypto.subtle.digest('SHA-256', input)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

export function dataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

export function readAscii(bytes: Uint8Array, start: number, length: number): string {
  if (start < 0 || length < 0 || start + length > bytes.byteLength) return ''
  return String.fromCharCode(...bytes.subarray(start, start + length))
}

export function readLatin1(bytes: Uint8Array): string {
  return new TextDecoder('windows-1252').decode(bytes).replace(/\0+$/g, '').trim()
}

export function readNullTerminatedLatin1(bytes: Uint8Array, start = 0): {
  readonly value: string
  readonly nextOffset: number
} {
  let end = start
  while (end < bytes.byteLength && bytes[end] !== 0) end += 1
  return {
    value: readLatin1(bytes.subarray(start, end)),
    nextOffset: Math.min(bytes.byteLength, end + 1),
  }
}

export function readEncodedText(bytes: Uint8Array, encoding = bytes[0] ?? 3): string {
  const payload = encoding === bytes[0] ? bytes.subarray(1) : bytes
  if (payload.byteLength === 0) return ''
  if (encoding === 0) return readLatin1(payload)
  if (encoding === 3) return new TextDecoder().decode(payload).replace(/\0+$/g, '').trim()
  if (encoding === 2) return decodeUtf16(payload, false)
  if (encoding === 1) {
    const littleEndian = payload[0] === 0xff && payload[1] === 0xfe
    const bigEndian = payload[0] === 0xfe && payload[1] === 0xff
    return decodeUtf16(payload.subarray(littleEndian || bigEndian ? 2 : 0), littleEndian)
  }
  return new TextDecoder().decode(payload).replace(/\0+$/g, '').trim()
}

export function readEncodedTerminatedText(
  bytes: Uint8Array,
  start: number,
  encoding: number,
): { readonly value: string; readonly nextOffset: number } {
  const unit = encoding === 1 || encoding === 2 ? 2 : 1
  let end = start
  while (end + unit <= bytes.byteLength) {
    if (bytes[end] === 0 && (unit === 1 || bytes[end + 1] === 0)) break
    end += unit
  }
  return {
    value: readEncodedText(bytes.subarray(start, end), encoding),
    nextOffset: Math.min(bytes.byteLength, end + unit),
  }
}

export function synchsafeInteger(bytes: Uint8Array, start: number): number {
  if (start < 0 || start + 4 > bytes.byteLength) return -1
  return (
    ((bytes[start] ?? 0) << 21) |
    ((bytes[start + 1] ?? 0) << 14) |
    ((bytes[start + 2] ?? 0) << 7) |
    (bytes[start + 3] ?? 0)
  )
}

export function uint32(bytes: Uint8Array, start: number): number {
  return dataView(bytes).getUint32(start, false)
}

export function uint64(bytes: Uint8Array, start: number): number {
  const value = dataView(bytes).getBigUint64(start, false)
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new AudiobookImportError('corrupt-file', 'The audio timeline is too large to represent safely.')
  }
  return Number(value)
}

export function distinct(values: readonly string[]): string[] {
  const seen = new Set<string>()
  return values.flatMap((value) => {
    const trimmed = value.trim()
    if (!trimmed) return []
    const key = trimmed.toLocaleLowerCase()
    if (seen.has(key)) return []
    seen.add(key)
    return [trimmed]
  })
}

export function splitContributors(value: string | undefined): string[] {
  if (!value) return []
  return distinct(value.replaceAll(String.fromCharCode(0), ';').split(/\s*(?:;|\||\s+&\s+)\s*/))
}

export function naturalCompare(left: string, right: string): number {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: 'base',
    usage: 'sort',
  })
}

export function safeRelativePath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '')
  const segments = normalized.split('/')
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.includes('\0') ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new AudiobookImportError(
      'unsafe-path',
      `Wovenleaf refused the unsafe imported path “${path || '(empty)'}”.`,
    )
  }
  return normalized
}

export function fileStem(path: string): string {
  const name = path.split('/').at(-1) ?? path
  return name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim()
}

export function hasNumericOrderingHint(path: string): boolean {
  return /(?:^|[^a-z])\d{1,4}(?:[^a-z]|$)/i.test(fileStem(path))
}

export function extension(path: string): string {
  return path.split('.').at(-1)?.toLocaleLowerCase() ?? ''
}

export function mimeTypeForImage(bytes: Uint8Array, fallback = ''): string | undefined {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (readAscii(bytes, 0, 8) === '\u0089PNG\r\n\u001a\n') return 'image/png'
  if (readAscii(bytes, 0, 6) === 'GIF87a' || readAscii(bytes, 0, 6) === 'GIF89a') return 'image/gif'
  if (readAscii(bytes, 0, 4) === 'RIFF' && readAscii(bytes, 8, 4) === 'WEBP') return 'image/webp'
  const fallbackType = fallback.split(';', 1)[0].toLocaleLowerCase()
  if (['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp'].includes(fallbackType)) {
    return fallbackType
  }
  return undefined
}

export function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number.parseInt(value.split('/', 1)[0] ?? '', 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string {
  const evenLength = bytes.byteLength - (bytes.byteLength % 2)
  const swapped = new Uint8Array(evenLength)
  for (let offset = 0; offset < evenLength; offset += 2) {
    if (littleEndian) {
      swapped[offset] = bytes[offset] ?? 0
      swapped[offset + 1] = bytes[offset + 1] ?? 0
    } else {
      swapped[offset] = bytes[offset + 1] ?? 0
      swapped[offset + 1] = bytes[offset] ?? 0
    }
  }
  return new TextDecoder('utf-16le').decode(swapped).replace(/\0+$/g, '').trim()
}
