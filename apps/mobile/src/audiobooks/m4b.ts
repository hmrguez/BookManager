import { dataView, distinct, readAscii, readLatin1, splitContributors, uint64 } from './binary'
import { AudiobookImportError, type AudiobookCover } from './model'
import type { ParsedAudioChapter, ParsedAudioMetadata } from './mp3'

type Mp4Atom = {
  readonly type: string
  readonly start: number
  readonly dataStart: number
  readonly end: number
  readonly children: readonly Mp4Atom[]
}

export function parseM4b(bytes: Uint8Array, fileName: string): ParsedAudioMetadata {
  const atoms = readAtoms(bytes, 0, bytes.byteLength, true)
  const ftyp = atoms.find(({ type }) => type === 'ftyp')
  const moov = atoms.find(({ type }) => type === 'moov')
  if (!ftyp || !moov) {
    throw new AudiobookImportError(
      'corrupt-file',
      `“${fileName}” is not a readable MPEG-4 audio container.`,
    )
  }
  const brands = readAscii(bytes, ftyp.dataStart, ftyp.end - ftyp.dataStart)
  const sampleDescriptions = descendants(moov).filter(({ type }) => type === 'stsd').flatMap((atom) => {
    if (atom.dataStart + 8 > atom.end) {
      throw new AudiobookImportError('corrupt-file', 'The audio sample description is truncated.')
    }
    const count = dataView(bytes).getUint32(atom.dataStart + 4, false)
    const entries = readAtoms(bytes, atom.dataStart + 8, atom.end, true)
    if (entries.length !== count) {
      throw new AudiobookImportError('corrupt-file', 'The audio sample description table is incomplete.')
    }
    return entries
  })
  // Codec/protection identifiers are sample-description atoms, not arbitrary
  // four-byte sequences. Compressed audio and cover art can contain those bytes.
  if (sampleDescriptions.some((entry) => isProtectedAudio(bytes, entry))) {
    throw new AudiobookImportError(
      'drm-protected',
      `“${fileName}” contains protected audio. Wovenleaf imports only unprotected M4B/AAC and does not offer circumvention guidance.`,
    )
  }
  if (!/(?:M4A |M4B |mp4[12]|isom|iso2)/.test(brands) || !sampleDescriptions.some(({ type }) => type === 'mp4a')) {
    throw new AudiobookImportError(
      'unsupported-format',
      `“${fileName}” is MPEG-4, but it does not contain supported AAC audiobook audio.`,
    )
  }

  const movieHeader = descendants(moov).find(({ type }) => type === 'mvhd')
  const durationMs = movieHeader ? readMovieDuration(bytes, movieHeader) : 0
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new AudiobookImportError('corrupt-file', `“${fileName}” has no readable audiobook duration.`)
  }

  const ilst = descendants(moov).find(({ type }) => type === 'ilst')
  const values = ilst ? readMetadataItems(bytes, ilst) : new Map<string, readonly Uint8Array[]>()
  const text = (key: string) => readMetadataText(values.get(key)?.[0])
  const custom = readFreeformMetadata(bytes, ilst)
  const artist = text('©ART')
  const authors = distinct([
    ...splitContributors(custom.get('AUTHOR')),
    ...splitContributors(text('©wrt')),
    ...splitContributors(text('aART')),
  ])
  if (authors.length === 0) authors.push(...splitContributors(artist))
  const narrators = distinct([
    ...splitContributors(custom.get('NARRATOR')),
    ...splitContributors(text('©nrt')),
    ...(artist && !authors.some((author) => author.toLocaleLowerCase() === artist.toLocaleLowerCase())
      ? splitContributors(artist)
      : []),
  ])
  const track = readPair(values.get('trkn')?.[0])
  const disc = readPair(values.get('disk')?.[0])
  const cover = readCover(values.get('covr')?.[0])
  const chapterAtom = descendants(moov).find(({ type }) => type === 'chpl')
  const chapters = chapterAtom ? readChapterList(bytes, chapterAtom, durationMs) : []

  return {
    durationMs: Math.round(durationMs),
    ...(text('©nam') ? { title: text('©nam') } : {}),
    ...(text('©alb') ? { album: text('©alb') } : {}),
    authors,
    narrators,
    ...(custom.get('SERIES') || text('©grp')
      ? { series: custom.get('SERIES') ?? text('©grp') }
      : {}),
    ...(track[0] ? { trackNumber: track[0] } : {}),
    ...(track[1] ? { trackTotal: track[1] } : {}),
    ...(disc[0] ? { discNumber: disc[0] } : {}),
    ...(disc[1] ? { discTotal: disc[1] } : {}),
    ...(cover ? { cover } : {}),
    chapters,
  }
}

function readAtoms(
  bytes: Uint8Array,
  start: number,
  end: number,
  strict: boolean,
): Mp4Atom[] {
  const atoms: Mp4Atom[] = []
  let offset = start
  while (offset + 8 <= end) {
    const view = dataView(bytes)
    const smallSize = view.getUint32(offset, false)
    const type = readAscii(bytes, offset + 4, 4)
    const headerSize = smallSize === 1 ? 16 : 8
    let size = smallSize === 0 ? end - offset : smallSize
    if (smallSize === 1) {
      if (offset + 16 > end) size = -1
      else size = uint64(bytes, offset + 8)
    }
    if (size < headerSize || offset + size > end || !type) {
      if (strict) {
        throw new AudiobookImportError('corrupt-file', 'The MPEG-4 atom table is truncated or malformed.')
      }
      break
    }
    const dataStart = offset + headerSize
    const atomEnd = offset + size
    const childStart = type === 'meta' ? dataStart + 4 : dataStart
    const children = (MP4_CONTAINER_TYPES.has(type) || MP4_METADATA_ITEM_TYPES.has(type)) && childStart <= atomEnd
      ? readAtoms(bytes, childStart, atomEnd, false)
      : []
    atoms.push({ type, start: offset, dataStart, end: atomEnd, children })
    offset = atomEnd
  }
  return atoms
}

function descendants(atom: Mp4Atom): Mp4Atom[] {
  return atom.children.flatMap((child) => [child, ...descendants(child)])
}

function readMovieDuration(bytes: Uint8Array, atom: Mp4Atom): number {
  const version = bytes[atom.dataStart] ?? 0
  const timescaleOffset = atom.dataStart + (version === 1 ? 20 : 12)
  const durationOffset = atom.dataStart + (version === 1 ? 24 : 16)
  if (timescaleOffset + 4 > atom.end || durationOffset + (version === 1 ? 8 : 4) > atom.end) return 0
  const timescale = dataView(bytes).getUint32(timescaleOffset, false)
  const duration = version === 1
    ? uint64(bytes, durationOffset)
    : dataView(bytes).getUint32(durationOffset, false)
  return timescale > 0 ? (duration * 1000) / timescale : 0
}

function readMetadataItems(bytes: Uint8Array, ilst: Mp4Atom): Map<string, readonly Uint8Array[]> {
  const values = new Map<string, readonly Uint8Array[]>()
  for (const item of ilst.children) {
    if (item.type === '----') continue
    const dataAtoms = item.children.filter(({ type }) => type === 'data')
    const payloads = dataAtoms.flatMap((data) => {
      const start = data.dataStart + 8
      return start <= data.end ? [bytes.subarray(start, data.end)] : []
    })
    if (payloads.length > 0) values.set(item.type, payloads)
  }
  return values
}

function readFreeformMetadata(bytes: Uint8Array, ilst: Mp4Atom | undefined): Map<string, string> {
  const values = new Map<string, string>()
  if (!ilst) return values
  for (const item of ilst.children.filter(({ type }) => type === '----')) {
    const name = item.children.find(({ type }) => type === 'name')
    const data = item.children.find(({ type }) => type === 'data')
    if (!name || !data || name.dataStart + 4 > name.end || data.dataStart + 8 > data.end) continue
    const key = readLatin1(bytes.subarray(name.dataStart + 4, name.end)).toLocaleUpperCase()
    const value = readMetadataText(bytes.subarray(data.dataStart + 8, data.end))
    if (key && value) values.set(key, value)
  }
  return values
}

function readMetadataText(bytes: Uint8Array | undefined): string | undefined {
  if (!bytes || bytes.byteLength === 0) return undefined
  const value = new TextDecoder().decode(bytes).replace(/\0+$/g, '').trim()
  return value || undefined
}

function readPair(bytes: Uint8Array | undefined): [number | undefined, number | undefined] {
  if (!bytes || bytes.byteLength < 6) return [undefined, undefined]
  const view = dataView(bytes)
  const current = view.getUint16(2, false)
  const total = view.getUint16(4, false)
  return [current || undefined, total || undefined]
}

function readCover(bytes: Uint8Array | undefined): Omit<AudiobookCover, 'sha256'> | undefined {
  if (!bytes || bytes.byteLength === 0) return undefined
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  const png = readAscii(bytes, 1, 3) === 'PNG'
  if (!jpeg && !png) return undefined
  return {
    mediaType: jpeg ? 'image/jpeg' : 'image/png',
    bytes: bytes.slice(),
    provenance: 'embedded',
  }
}

function readChapterList(bytes: Uint8Array, atom: Mp4Atom, durationMs: number): ParsedAudioChapter[] {
  const payload = bytes.subarray(atom.dataStart, atom.end)
  for (const countOffset of [4, 8]) {
    const count = payload[countOffset] ?? 0
    if (count === 0 || count > 200) continue
    let offset = countOffset + 1
    const chapters: ParsedAudioChapter[] = []
    for (let index = 0; index < count; index += 1) {
      if (offset + 9 > payload.byteLength) break
      const start100ns = uint64(payload, offset)
      const titleLength = payload[offset + 8] ?? 0
      offset += 9
      if (offset + titleLength > payload.byteLength) break
      const title = new TextDecoder().decode(payload.subarray(offset, offset + titleLength)).trim()
      chapters.push({ title: title || `Chapter ${index + 1}`, startMs: Math.round(start100ns / 10_000) })
      offset += titleLength
    }
    if (chapters.length === count && chapters.every(({ startMs }) => startMs >= 0 && startMs < durationMs)) {
      return chapters.map((chapter, index) => ({
        ...chapter,
        endMs: chapters[index + 1]?.startMs ?? Math.round(durationMs),
      }))
    }
  }
  return []
}

function isProtectedAudio(bytes: Uint8Array, entry: Mp4Atom): boolean {
  if (entry.type === 'enca' || entry.type === 'drms') return true
  if (entry.type !== 'mp4a') return false
  if (entry.dataStart + 28 > entry.end) {
    throw new AudiobookImportError('corrupt-file', 'The AAC sample description is truncated.')
  }
  const version = dataView(bytes).getUint16(entry.dataStart + 8, false)
  // QuickTime sound descriptions extend the 28-byte header for versions 1 and 2.
  const headerSize = [28, 44, 64][version]
  if (headerSize === undefined) {
    throw new AudiobookImportError('unsupported-format', 'The audio sample description version is unsupported.')
  }
  if (entry.dataStart + headerSize > entry.end) {
    throw new AudiobookImportError('corrupt-file', 'The AAC sample description is truncated.')
  }
  return readAtoms(bytes, entry.dataStart + headerSize, entry.end, true).some(({ type }) => type === 'sinf')
}

const MP4_CONTAINER_TYPES = new Set([
  'moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'udta', 'meta', 'ilst',
  'moof', 'traf', 'mvex', 'tref',
])
const MP4_METADATA_ITEM_TYPES = new Set([
  '©nam', '©alb', '©ART', 'aART', '©wrt', '©nrt', '©grp', '©lan',
  'trkn', 'disk', 'covr', '----',
])
