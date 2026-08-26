import {
  dataView,
  distinct,
  parsePositiveInteger,
  readAscii,
  readEncodedTerminatedText,
  readEncodedText,
  readNullTerminatedLatin1,
  splitContributors,
  synchsafeInteger,
} from './binary'
import { AudiobookImportError, type AudiobookCover } from './model'

export type ParsedAudioChapter = {
  readonly title: string
  readonly startMs: number
  readonly endMs?: number
}

export type ParsedAudioMetadata = {
  readonly durationMs: number
  readonly title?: string
  readonly album?: string
  readonly authors: readonly string[]
  readonly narrators: readonly string[]
  readonly series?: string
  readonly trackNumber?: number
  readonly trackTotal?: number
  readonly discNumber?: number
  readonly discTotal?: number
  readonly cover?: Omit<AudiobookCover, 'sha256'>
  readonly chapters: readonly ParsedAudioChapter[]
}

type Id3Frame = {
  readonly id: string
  readonly data: Uint8Array
}

type MpegFrameHeader = {
  readonly version: 1 | 2 | 2.5
  readonly sampleRate: number
  readonly samplesPerFrame: number
  readonly frameLength: number
  readonly channelMode: number
  readonly protectedByCrc: boolean
}

export function parseMp3(bytes: Uint8Array, fileName: string): ParsedAudioMetadata {
  const tag = readId3(bytes)
  const durationMs = readMp3Duration(bytes, tag.audioStart)
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new AudiobookImportError(
      'corrupt-file',
      `“${fileName}” does not contain a readable MPEG audio timeline.`,
    )
  }

  const text = new Map<string, string>()
  const custom = new Map<string, string>()
  const chapters: ParsedAudioChapter[] = []
  let cover: Omit<AudiobookCover, 'sha256'> | undefined
  for (const frame of tag.frames) {
    if (frame.id.startsWith('T') && frame.id !== 'TXXX') {
      const value = readEncodedText(frame.data)
      if (value) text.set(frame.id, value)
    } else if (frame.id === 'TXXX') {
      const encoding = frame.data[0] ?? 3
      const description = readEncodedTerminatedText(frame.data, 1, encoding)
      const value = readEncodedText(frame.data.subarray(description.nextOffset), encoding)
      if (description.value && value) custom.set(description.value.toLocaleUpperCase(), value)
    } else if (frame.id === 'APIC' && !cover) {
      cover = readAttachedPicture(frame.data)
    } else if (frame.id === 'CHAP') {
      const chapter = readChapterFrame(frame.data, tag.version)
      if (chapter) chapters.push(chapter)
    }
  }

  const primaryArtist = text.get('TPE1')
  const authors = distinct([
    ...splitContributors(custom.get('AUTHOR')),
    ...splitContributors(text.get('TCOM')),
    ...splitContributors(text.get('TPE2')),
  ])
  if (authors.length === 0) authors.push(...splitContributors(primaryArtist))
  const narrators = distinct([
    ...splitContributors(custom.get('NARRATOR')),
    ...(primaryArtist && !authors.some((author) => author.toLocaleLowerCase() === primaryArtist.toLocaleLowerCase())
      ? splitContributors(primaryArtist)
      : []),
  ])
  const [trackNumber, trackTotal] = parseNumberPair(text.get('TRCK'))
  const [discNumber, discTotal] = parseNumberPair(text.get('TPOS'))

  return {
    durationMs: Math.round(durationMs),
    ...(text.get('TIT2') ? { title: text.get('TIT2') } : {}),
    ...(text.get('TALB') ? { album: text.get('TALB') } : {}),
    authors,
    narrators,
    ...(custom.get('SERIES') || text.get('TIT1')
      ? { series: custom.get('SERIES') ?? text.get('TIT1') }
      : {}),
    ...(trackNumber ? { trackNumber } : {}),
    ...(trackTotal ? { trackTotal } : {}),
    ...(discNumber ? { discNumber } : {}),
    ...(discTotal ? { discTotal } : {}),
    ...(cover ? { cover } : {}),
    chapters: chapters
      .filter(({ startMs }) => startMs >= 0 && startMs < durationMs)
      .sort((left, right) => left.startMs - right.startMs),
  }
}

function readId3(bytes: Uint8Array): {
  readonly audioStart: number
  readonly version: number
  readonly frames: readonly Id3Frame[]
} {
  if (readAscii(bytes, 0, 3) !== 'ID3') return { audioStart: 0, version: 4, frames: [] }
  if (bytes.byteLength < 10) {
    throw new AudiobookImportError('corrupt-file', 'The MP3 ID3 header is truncated.')
  }
  const version = bytes[3] ?? 0
  if (version < 2 || version > 4) {
    throw new AudiobookImportError('corrupt-file', `ID3v2.${version} metadata is not readable.`)
  }
  const size = synchsafeInteger(bytes, 6)
  const footerSize = version === 4 && ((bytes[5] ?? 0) & 0x10) !== 0 ? 10 : 0
  const audioStart = 10 + size + footerSize
  if (size < 0 || audioStart > bytes.byteLength) {
    throw new AudiobookImportError('corrupt-file', 'The MP3 ID3 metadata extends beyond the file.')
  }
  let payload = bytes.subarray(10, 10 + size)
  if (((bytes[5] ?? 0) & 0x80) !== 0) payload = removeUnsynchronization(payload)
  let offset = extendedHeaderLength(payload, version, bytes[5] ?? 0)
  const frames: Id3Frame[] = []
  while (offset < payload.byteLength) {
    const headerLength = version === 2 ? 6 : 10
    if (offset + headerLength > payload.byteLength) break
    const idLength = version === 2 ? 3 : 4
    const rawId = readAscii(payload, offset, idLength)
    if (!/^[A-Z0-9]{3,4}$/.test(rawId)) break
    const size = version === 2
      ? ((payload[offset + 3] ?? 0) << 16) | ((payload[offset + 4] ?? 0) << 8) | (payload[offset + 5] ?? 0)
      : version === 4
        ? synchsafeInteger(payload, offset + 4)
        : dataView(payload).getUint32(offset + 4, false)
    if (size <= 0 || offset + headerLength + size > payload.byteLength) break
    frames.push({ id: normalizeFrameId(rawId), data: payload.subarray(offset + headerLength, offset + headerLength + size) })
    offset += headerLength + size
  }
  return { audioStart, version, frames }
}

function extendedHeaderLength(payload: Uint8Array, version: number, flags: number): number {
  if ((flags & 0x40) === 0 || payload.byteLength < 4) return 0
  const size = version === 4 ? synchsafeInteger(payload, 0) : dataView(payload).getUint32(0, false) + 4
  return size > 0 && size <= payload.byteLength ? size : 0
}

function normalizeFrameId(id: string): string {
  return ({
    TT2: 'TIT2', TAL: 'TALB', TP1: 'TPE1', TP2: 'TPE2', TCM: 'TCOM',
    TRK: 'TRCK', TPA: 'TPOS', TXX: 'TXXX', PIC: 'APIC',
  } as Record<string, string>)[id] ?? id
}

function removeUnsynchronization(bytes: Uint8Array): Uint8Array {
  const result: number[] = []
  for (let offset = 0; offset < bytes.byteLength; offset += 1) {
    const value = bytes[offset] ?? 0
    result.push(value)
    if (value === 0xff && bytes[offset + 1] === 0x00) offset += 1
  }
  return Uint8Array.from(result)
}

function readAttachedPicture(data: Uint8Array): Omit<AudiobookCover, 'sha256'> | undefined {
  if (data.byteLength < 5) return undefined
  const encoding = data[0] ?? 0
  const mime = readNullTerminatedLatin1(data, 1)
  const pictureTypeOffset = mime.nextOffset
  if (pictureTypeOffset >= data.byteLength) return undefined
  const description = readEncodedTerminatedText(data, pictureTypeOffset + 1, encoding)
  const pictureBytes = data.subarray(description.nextOffset)
  if (!mime.value.startsWith('image/') || pictureBytes.byteLength === 0) return undefined
  return { mediaType: mime.value.toLocaleLowerCase(), bytes: pictureBytes.slice(), provenance: 'embedded' }
}

function readChapterFrame(data: Uint8Array, version: number): ParsedAudioChapter | undefined {
  const element = readNullTerminatedLatin1(data)
  if (element.nextOffset + 16 > data.byteLength) return undefined
  const view = dataView(data)
  const startMs = view.getUint32(element.nextOffset, false)
  const rawEndMs = view.getUint32(element.nextOffset + 4, false)
  const nested = data.subarray(element.nextOffset + 16)
  const title = readNestedChapterTitle(nested, version) || element.value || 'Chapter'
  return {
    title,
    startMs,
    ...(rawEndMs !== 0xffffffff && rawEndMs > startMs ? { endMs: rawEndMs } : {}),
  }
}

function readNestedChapterTitle(bytes: Uint8Array, version: number): string | undefined {
  let offset = 0
  while (offset + 10 <= bytes.byteLength) {
    const id = readAscii(bytes, offset, 4)
    const size = version === 4
      ? synchsafeInteger(bytes, offset + 4)
      : dataView(bytes).getUint32(offset + 4, false)
    if (!/^[A-Z0-9]{4}$/.test(id) || size <= 0 || offset + 10 + size > bytes.byteLength) break
    if (id === 'TIT2') return readEncodedText(bytes.subarray(offset + 10, offset + 10 + size))
    offset += 10 + size
  }
  return undefined
}

function readMp3Duration(bytes: Uint8Array, audioStart: number): number {
  const firstOffset = findFirstMpegFrame(bytes, audioStart)
  if (firstOffset < 0) return 0
  const first = parseMpegFrameHeader(bytes, firstOffset)
  if (!first) return 0
  const xingFrames = readXingFrameCount(bytes, firstOffset, first)
  if (xingFrames) return (xingFrames * first.samplesPerFrame * 1000) / first.sampleRate

  let frames = 0
  let durationMs = 0
  let offset = firstOffset
  while (offset + 4 <= bytes.byteLength) {
    const header = parseMpegFrameHeader(bytes, offset)
    if (!header || offset + header.frameLength > bytes.byteLength) break
    frames += 1
    durationMs += (header.samplesPerFrame * 1000) / header.sampleRate
    offset += header.frameLength
  }
  return frames > 0 ? durationMs : 0
}

function findFirstMpegFrame(bytes: Uint8Array, start: number): number {
  const end = Math.min(bytes.byteLength - 4, start + 65_536)
  for (let offset = Math.max(0, start); offset <= end; offset += 1) {
    const header = parseMpegFrameHeader(bytes, offset)
    if (!header || offset + header.frameLength > bytes.byteLength) continue
    const next = offset + header.frameLength
    if (next + 4 > bytes.byteLength || parseMpegFrameHeader(bytes, next)) return offset
  }
  return -1
}

function parseMpegFrameHeader(bytes: Uint8Array, offset: number): MpegFrameHeader | undefined {
  if (offset < 0 || offset + 4 > bytes.byteLength) return undefined
  const header = dataView(bytes).getUint32(offset, false)
  if (((header & 0xffe00000) >>> 0) !== 0xffe00000) return undefined
  const versionBits = (header >>> 19) & 0x3
  const layerBits = (header >>> 17) & 0x3
  const bitrateIndex = (header >>> 12) & 0xf
  const sampleRateIndex = (header >>> 10) & 0x3
  if (versionBits === 1 || layerBits !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) {
    return undefined
  }
  const version = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 2.5
  const bitrate = (version === 1 ? MPEG1_LAYER3_BITRATES : MPEG2_LAYER3_BITRATES)[bitrateIndex] ?? 0
  const baseSampleRate = [44_100, 48_000, 32_000][sampleRateIndex] ?? 0
  const sampleRate = version === 1 ? baseSampleRate : version === 2 ? baseSampleRate / 2 : baseSampleRate / 4
  const padding = (header >>> 9) & 0x1
  const coefficient = version === 1 ? 144_000 : 72_000
  const frameLength = Math.floor((coefficient * bitrate) / sampleRate) + padding
  if (!bitrate || !sampleRate || frameLength < 24) return undefined
  return {
    version,
    sampleRate,
    samplesPerFrame: version === 1 ? 1152 : 576,
    frameLength,
    channelMode: (header >>> 6) & 0x3,
    protectedByCrc: ((header >>> 16) & 0x1) === 0,
  }
}

function readXingFrameCount(
  bytes: Uint8Array,
  frameOffset: number,
  header: MpegFrameHeader,
): number | undefined {
  const mono = header.channelMode === 3
  const sideInfoLength = header.version === 1 ? (mono ? 17 : 32) : (mono ? 9 : 17)
  const offset = frameOffset + 4 + (header.protectedByCrc ? 2 : 0) + sideInfoLength
  const marker = readAscii(bytes, offset, 4)
  if (marker !== 'Xing' && marker !== 'Info') return undefined
  if (offset + 12 > bytes.byteLength) return undefined
  const flags = dataView(bytes).getUint32(offset + 4, false)
  if ((flags & 0x1) === 0) return undefined
  const frames = dataView(bytes).getUint32(offset + 8, false)
  return frames > 0 ? frames : undefined
}

function parseNumberPair(value: string | undefined): [number | undefined, number | undefined] {
  if (!value) return [undefined, undefined]
  const [current, total] = value.split('/', 2)
  return [parsePositiveInteger(current), parsePositiveInteger(total)]
}

const MPEG1_LAYER3_BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
const MPEG2_LAYER3_BITRATES = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
