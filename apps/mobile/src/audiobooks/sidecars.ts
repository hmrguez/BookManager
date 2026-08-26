import { distinct, extension, fileStem, mimeTypeForImage, splitContributors } from './binary'
import { AudiobookImportError, type AudiobookImportSource } from './model'

export type SidecarChapter = {
  readonly title: string
  readonly startMs: number
  readonly endMs?: number
  readonly fileName?: string
  readonly provenance: 'cue' | 'sidecar'
}

export type AudiobookSidecars = {
  readonly metadata: {
    readonly title?: string
    readonly authors: readonly string[]
    readonly narrators: readonly string[]
    readonly series?: string
    readonly language?: string
  }
  readonly chapters: readonly SidecarChapter[]
  readonly coverSource?: AudiobookImportSource
}

type JsonSidecar = Record<string, unknown> & {
  readonly title?: unknown
  readonly author?: unknown
  readonly authors?: unknown
  readonly narrator?: unknown
  readonly narrators?: unknown
  readonly series?: unknown
  readonly language?: unknown
  readonly cover?: unknown
  readonly chapters?: readonly unknown[]
}

export function inspectAudiobookSidecars(sources: readonly AudiobookImportSource[]): AudiobookSidecars {
  const jsonSource = sources.find((source) =>
    ['audiobook.json', 'metadata.json', 'book.json'].includes(source.name.toLocaleLowerCase()),
  )
  const json = jsonSource ? readJsonSidecar(jsonSource) : undefined
  const cueChapters = sources
    .filter((source) => extension(source.name) === 'cue')
    .flatMap((source) => readCueSheet(source))
  const explicitCoverName = typeof json?.cover === 'string' ? json.cover : undefined
  const imageSources = sources.filter((source) => mimeTypeForImage(source.bytes, source.mediaType))
  const coverSource = explicitCoverName
    ? imageSources.find((source) => sameFileReference(source, explicitCoverName))
    : [...imageSources].sort((left, right) => coverScore(right) - coverScore(left))[0]

  return {
    metadata: {
      ...(cleanText(json?.title) ? { title: cleanText(json?.title) } : {}),
      authors: contributors(json?.authors ?? json?.author),
      narrators: contributors(json?.narrators ?? json?.narrator),
      ...(cleanText(json?.series) ? { series: cleanText(json?.series) } : {}),
      ...(cleanText(json?.language) ? { language: cleanText(json?.language) } : {}),
    },
    chapters: json?.chapters?.length ? readJsonChapters(json.chapters, jsonSource?.name ?? 'metadata.json') : cueChapters,
    ...(coverSource ? { coverSource } : {}),
  }
}

function readJsonSidecar(source: AudiobookImportSource): JsonSidecar {
  if (source.bytes.byteLength > 2 * 1024 * 1024) {
    throw new AudiobookImportError('corrupt-file', `“${source.name}” is too large to be audiobook metadata.`)
  }
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(source.bytes))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('expected object')
    return parsed as JsonSidecar
  } catch (error) {
    throw new AudiobookImportError(
      'corrupt-file',
      `“${source.name}” is not readable audiobook metadata JSON.`,
      { cause: error },
    )
  }
}

function readJsonChapters(chapters: readonly unknown[], sourceName: string): SidecarChapter[] {
  const parsed = chapters.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new AudiobookImportError('corrupt-file', `Chapter ${index + 1} in “${sourceName}” is malformed.`)
    }
    const chapter = raw as Record<string, unknown>
    const title = cleanText(chapter.title) ?? `Chapter ${index + 1}`
    const startMs = timeValue(chapter.startMs ?? chapter.start)
    const endMs = timeValue(chapter.endMs ?? chapter.end)
    if (startMs === undefined || startMs < 0 || (endMs !== undefined && endMs <= startMs)) {
      throw new AudiobookImportError('corrupt-file', `Chapter “${title}” in “${sourceName}” has an invalid time range.`)
    }
    return {
      title,
      startMs,
      ...(endMs !== undefined ? { endMs } : {}),
      ...(cleanText(chapter.file) ? { fileName: cleanText(chapter.file) } : {}),
      provenance: 'sidecar' as const,
    }
  })
  return parsed.sort((left, right) => left.startMs - right.startMs)
}

function readCueSheet(source: AudiobookImportSource): SidecarChapter[] {
  if (source.bytes.byteLength > 2 * 1024 * 1024) {
    throw new AudiobookImportError('corrupt-file', `“${source.name}” is too large to be a CUE sheet.`)
  }
  const lines = new TextDecoder().decode(source.bytes).replace(/^\uFEFF/, '').split(/\r?\n/)
  let currentFile: string | undefined
  let currentTitle: string | undefined
  let currentTrack: { title?: string; fileName?: string; startMs?: number } | undefined
  const chapters: SidecarChapter[] = []
  const flush = () => {
    if (!currentTrack || currentTrack.startMs === undefined) return
    chapters.push({
      title: currentTrack.title ?? `Chapter ${chapters.length + 1}`,
      startMs: currentTrack.startMs,
      ...(currentTrack.fileName ? { fileName: currentTrack.fileName } : {}),
      provenance: 'cue',
    })
  }
  for (const rawLine of lines) {
    const line = rawLine.trim()
    const file = /^FILE\s+(?:"([^"]+)"|(\S+))/i.exec(line)
    if (file) {
      currentFile = file[1] ?? file[2]
      continue
    }
    if (/^TRACK\s+\d+\s+AUDIO/i.test(line)) {
      flush()
      currentTrack = { fileName: currentFile }
      continue
    }
    const title = /^TITLE\s+(?:"([^"]+)"|(.+))$/i.exec(line)
    if (title) {
      const value = (title[1] ?? title[2] ?? '').trim()
      if (currentTrack) currentTrack.title = value
      else currentTitle = value
      continue
    }
    const index = /^INDEX\s+01\s+(\d{1,3}):(\d{2}):(\d{2})$/i.exec(line)
    if (index && currentTrack) {
      const minutes = Number(index[1])
      const seconds = Number(index[2])
      const frames = Number(index[3])
      if (seconds >= 60 || frames >= 75) {
        throw new AudiobookImportError('corrupt-file', `“${source.name}” contains an invalid CUE timestamp.`)
      }
      currentTrack.startMs = Math.round((minutes * 60 + seconds + frames / 75) * 1000)
    }
  }
  flush()
  if (chapters.length === 0 && currentTitle) return []
  return chapters
}

function contributors(value: unknown): string[] {
  if (typeof value === 'string') return splitContributors(value)
  if (Array.isArray(value)) return distinct(value.filter((item): item is string => typeof item === 'string'))
  return []
}

function cleanText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const cleaned = value.trim().replace(/\s+/g, ' ')
  return cleaned || undefined
}

function timeValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  if (typeof value !== 'string') return undefined
  if (/^\d+(?:\.\d+)?$/.test(value)) return Math.round(Number(value))
  const parts = value.split(':').map(Number)
  if (parts.some((part) => !Number.isFinite(part)) || parts.length < 2 || parts.length > 3) return undefined
  const seconds = parts.length === 3
    ? (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0)
    : (parts[0] ?? 0) * 60 + (parts[1] ?? 0)
  return Math.round(seconds * 1000)
}

function sameFileReference(source: AudiobookImportSource, reference: string): boolean {
  const normalized = reference.replace(/\\/g, '/').toLocaleLowerCase()
  return source.relativePath.toLocaleLowerCase() === normalized || source.name.toLocaleLowerCase() === normalized
}

function coverScore(source: AudiobookImportSource): number {
  const stem = fileStem(source.name).toLocaleLowerCase()
  if (stem === 'cover') return 4
  if (stem === 'folder') return 3
  if (stem === 'front') return 2
  return 1
}
