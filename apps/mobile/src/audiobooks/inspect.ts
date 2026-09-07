import {
  distinct,
  extension,
  fileStem,
  hasNumericOrderingHint,
  mimeTypeForImage,
  naturalCompare,
  readAscii,
  safeRelativePath,
  sha256,
} from './binary'
import { parseM4b } from './m4b'
import {
  AudiobookImportError,
  AUDIOBOOK_MEDIA_TYPES,
  throwIfAudiobookImportCanceled,
  type AudiobookChapterInspection,
  type AudiobookCover,
  type AudiobookImportDraft,
  type AudiobookImportIssue,
  type AudiobookImportProgress,
  type AudiobookImportReview,
  type AudiobookImportSource,
  type AudiobookMetadataDraft,
  type AudiobookSegmentInspection,
  type NormalizedAudiobook,
  type NormalizedAudiobookChapter,
  type NormalizedAudiobookSegment,
} from './model'
import { parseMp3, type ParsedAudioMetadata } from './mp3'
import { inspectAudiobookSidecars, type SidecarChapter } from './sidecars'

export const AUDIOBOOK_IMPORT_LIMITS = {
  maxAudioFiles: 512,
  maxSidecarBytes: 16 * 1024 * 1024,
  maxTotalBytes: 16 * 1024 * 1024 * 1024,
} as const

export async function inspectAudiobook(
  inputSources: readonly AudiobookImportSource[],
  options: {
    readonly signal?: AbortSignal
    readonly onProgress?: (progress: AudiobookImportProgress) => void
  } = {},
): Promise<AudiobookImportDraft> {
  const { signal, onProgress } = options
  throwIfAudiobookImportCanceled(signal)
  if (inputSources.length === 0) {
    throw new AudiobookImportError('empty-selection', 'Choose one M4B or the files from one MP3 audiobook folder.')
  }
  const sources = inputSources.map((source) => ({
    ...source,
    name: source.name.trim(),
    relativePath: safeRelativePath(source.relativePath || source.name),
  }))
  assertUniquePaths(sources)
  const totalBytes = sources.reduce((total, { bytes }) => total + bytes.byteLength, 0)
  if (totalBytes > AUDIOBOOK_IMPORT_LIMITS.maxTotalBytes) {
    throw new AudiobookImportError('unsupported-format', 'This audiobook is larger than the managed import limit.')
  }

  const sidecars = inspectAudiobookSidecars(sources)
  const audioSources = sources.filter(isAudioCandidate)
  if (audioSources.length === 0) {
    throw new AudiobookImportError('unsupported-format', 'No readable M4B or MP3 audio file was selected.')
  }
  if (audioSources.length > AUDIOBOOK_IMPORT_LIMITS.maxAudioFiles) {
    throw new AudiobookImportError(
      'unsupported-combination',
      `Choose at most ${AUDIOBOOK_IMPORT_LIMITS.maxAudioFiles} files for one audiobook.`,
    )
  }

  const inspected: Array<{ source: AudiobookImportSource; metadata: ParsedAudioMetadata; fingerprint: string }> = []
  for (const [index, source] of audioSources.entries()) {
    throwIfAudiobookImportCanceled(signal)
    onProgress?.({
      stage: 'inspecting',
      fileName: source.name,
      detail: 'Reading container evidence, duration, tags, and chapters',
      completedFiles: index,
      totalFiles: audioSources.length,
    })
    const container = probeContainer(source.bytes)
    const metadata = container === 'mpeg-4-audio'
      ? parseM4b(source.bytes, source.name)
      : parseMp3(source.bytes, source.name)
    onProgress?.({
      stage: 'fingerprinting',
      fileName: source.name,
      detail: 'Fingerprinting original audio locally',
      completedFiles: index,
      totalFiles: audioSources.length,
    })
    inspected.push({ source, metadata, fingerprint: await sha256(source.bytes) })
  }
  throwIfAudiobookImportCanceled(signal)

  const containers = new Set(inspected.map(({ source }) => probeContainer(source.bytes)))
  if (containers.has('mpeg-4-audio') && (containers.size > 1 || inspected.length > 1)) {
    throw new AudiobookImportError(
      'unsupported-combination',
      'Import one M4B by itself, or select the MP3 files that belong to one audiobook. Mixed or multi-M4B sets stay separate.',
    )
  }

  const segments = inspected.map(({ source, metadata, fingerprint }, sourceIndex) => {
    const duplicateCount = inspected.slice(0, sourceIndex).filter((item) => item.fingerprint === fingerprint).length
    return {
      id: `segment:${fingerprint.slice(0, 24)}${duplicateCount ? `:${duplicateCount + 1}` : ''}`,
      sourceIndex,
      fileName: source.name,
      relativePath: source.relativePath,
      container: probeContainer(source.bytes),
      mediaType: probeContainer(source.bytes) === 'mpeg-4-audio'
        ? AUDIOBOOK_MEDIA_TYPES.m4b
        : AUDIOBOOK_MEDIA_TYPES.mp3,
      durationMs: metadata.durationMs,
      byteSize: source.bytes.byteLength,
      fingerprint,
      ...(metadata.title ? { title: metadata.title } : {}),
      ...(metadata.album ? { album: metadata.album } : {}),
      authors: metadata.authors,
      narrators: metadata.narrators,
      ...(metadata.series ? { series: metadata.series } : {}),
      ...(metadata.trackNumber ? { trackNumber: metadata.trackNumber } : {}),
      ...(metadata.trackTotal ? { trackTotal: metadata.trackTotal } : {}),
      ...(metadata.discNumber ? { discNumber: metadata.discNumber } : {}),
      ...(metadata.discTotal ? { discTotal: metadata.discTotal } : {}),
    } satisfies AudiobookSegmentInspection
  })
  const order = suggestOrder(segments)
  const orderedSegments = order.segmentIds.map((id) => requireSegment(segments, id))
  const metadata = inferMetadata(orderedSegments, sidecars.metadata)
  const issues = buildIssues(orderedSegments, metadata, order)
  const sourceSetFingerprint = await sha256(new TextEncoder().encode(
    [...inspected].map(({ fingerprint }) => fingerprint).sort().join('\n'),
  ))
  const inspectionId = `audiobook-inspection:${sourceSetFingerprint.slice(0, 32)}`
  const chapters = normalizeInspectedChapters(
    orderedSegments,
    inspected,
    sidecars.chapters,
  )
  const cover = await chooseCover(sidecars.coverSource, inspected)
  const totalDurationMs = orderedSegments.reduce((total, segment) => total + segment.durationMs, 0)
  const draft: AudiobookImportDraft = {
    inspectionId,
    sourceSetFingerprint,
    suggestedOrder: order.segmentIds,
    segments,
    chapters,
    metadata,
    ...(cover ? { cover } : {}),
    issues,
    requiresOrderReview: order.requiresReview,
    totalDurationMs,
  }
  onProgress?.({
    stage: 'review-ready',
    fileName: metadata.title,
    detail: order.requiresReview
      ? 'File order needs your confirmation before Wovenleaf merges the book'
      : 'Metadata and deterministic file order are ready to review',
    completedFiles: audioSources.length,
    totalFiles: audioSources.length,
  })
  return draft
}

export function defaultAudiobookReview(draft: AudiobookImportDraft): AudiobookImportReview {
  return {
    inspectionId: draft.inspectionId,
    segmentIds: draft.suggestedOrder,
    title: draft.metadata.title,
    authors: draft.metadata.authors,
    narrators: draft.metadata.narrators,
    ...(draft.metadata.series ? { series: draft.metadata.series } : {}),
    ...(draft.metadata.language ? { language: draft.metadata.language } : {}),
    orderConfirmed: !draft.requiresOrderReview,
  }
}

export async function normalizeAudiobookReview(
  draft: AudiobookImportDraft,
  review: AudiobookImportReview,
): Promise<NormalizedAudiobook> {
  if (review.inspectionId !== draft.inspectionId) {
    throw new AudiobookImportError('stale-review', 'The selected files changed. Review the audiobook again before importing.')
  }
  const knownIds = new Set(draft.segments.map(({ id }) => id))
  if (
    review.segmentIds.length !== knownIds.size ||
    new Set(review.segmentIds).size !== knownIds.size ||
    review.segmentIds.some((id) => !knownIds.has(id))
  ) {
    throw new AudiobookImportError('stale-review', 'The reviewed order does not contain each selected audio file exactly once.')
  }
  if (draft.requiresOrderReview && !review.orderConfirmed) {
    throw new AudiobookImportError('review-required', 'Confirm the file order before merging this audiobook.')
  }
  const title = review.title.trim().replace(/\s+/g, ' ')
  if (!title) throw new AudiobookImportError('review-required', 'Add a title before importing this audiobook.')
  const authors = distinct(review.authors)
  const narrators = distinct(review.narrators)
  const series = review.series?.trim().replace(/\s+/g, ' ') || undefined
  const language = review.language?.trim() || undefined

  let absoluteStartMs = 0
  const segments: NormalizedAudiobookSegment[] = review.segmentIds.map((id) => {
    const segment = requireSegment(draft.segments, id)
    const normalized = {
      ...segment,
      absoluteStartMs,
      absoluteEndMs: absoluteStartMs + segment.durationMs,
    }
    absoluteStartMs = normalized.absoluteEndMs
    return normalized
  })
  const chapters = absoluteChapters(draft.chapters, segments)
  const metadata: AudiobookMetadataDraft = {
    title,
    authors,
    narrators,
    ...(series ? { series } : {}),
    ...(language ? { language } : {}),
  }
  const metadataKey = JSON.stringify([
    title.toLocaleLowerCase(),
    authors.map((author) => author.toLocaleLowerCase()).sort(),
    narrators.map((narrator) => narrator.toLocaleLowerCase()).sort(),
    series?.toLocaleLowerCase() ?? '',
  ])
  const fingerprint = await sha256(new TextEncoder().encode(JSON.stringify({
    segments: segments.map(({ fingerprint: segmentFingerprint }) => segmentFingerprint),
    chapters: chapters.map(({ title: chapterTitle, segmentId, absoluteStartMs, absoluteEndMs }) => ({
      title: chapterTitle,
      segmentId,
      absoluteStartMs,
      absoluteEndMs,
    })),
    metadata,
    cover: draft.cover?.sha256 ?? null,
  })))
  const m4b = segments.length === 1 && segments[0]?.container === 'mpeg-4-audio'
  return {
    inspectionId: draft.inspectionId,
    sourceSetFingerprint: draft.sourceSetFingerprint,
    fingerprint,
    metadataKey,
    metadata,
    segments,
    chapters,
    ...(draft.cover ? { cover: draft.cover } : {}),
    totalDurationMs: absoluteStartMs,
    format: m4b ? 'm4b' : 'mp3',
    mediaType: m4b ? AUDIOBOOK_MEDIA_TYPES.m4b : AUDIOBOOK_MEDIA_TYPES.mp3,
  }
}

function probeContainer(bytes: Uint8Array): 'mpeg-4-audio' | 'mpeg-audio' {
  if (readAscii(bytes, 4, 4) === 'ftyp') return 'mpeg-4-audio'
  if (readAscii(bytes, 0, 3) === 'ID3' || containsMpegSync(bytes)) return 'mpeg-audio'
  throw new AudiobookImportError(
    'unsupported-format',
    'One selected file is neither unprotected MPEG-4/AAC audio nor MP3 audio.',
  )
}

function containsMpegSync(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.byteLength - 1, 65_536)
  for (let offset = 0; offset < end; offset += 1) {
    if (bytes[offset] === 0xff && ((bytes[offset + 1] ?? 0) & 0xe0) === 0xe0) return true
  }
  return false
}

function isAudioCandidate(source: AudiobookImportSource): boolean {
  const suffix = extension(source.name)
  if (['m4b', 'm4a', 'mp4', 'mp3'].includes(suffix)) return true
  if (source.mediaType.startsWith('audio/')) return true
  return readAscii(source.bytes, 4, 4) === 'ftyp' || readAscii(source.bytes, 0, 3) === 'ID3'
}

function assertUniquePaths(sources: readonly AudiobookImportSource[]): void {
  const paths = new Set<string>()
  for (const source of sources) {
    const key = source.relativePath.toLocaleLowerCase()
    if (paths.has(key)) {
      throw new AudiobookImportError('unsafe-path', `The selection repeats “${source.relativePath}”.`)
    }
    paths.add(key)
  }
}

function suggestOrder(segments: readonly AudiobookSegmentInspection[]): {
  readonly segmentIds: readonly string[]
  readonly requiresReview: boolean
  readonly duplicateTrackIds: readonly string[]
} {
  const trackKeys = new Map<string, string[]>()
  for (const segment of segments) {
    if (!segment.trackNumber) continue
    const key = `${segment.discNumber ?? 1}:${segment.trackNumber}`
    trackKeys.set(key, [...(trackKeys.get(key) ?? []), segment.id])
  }
  const duplicateTrackIds = [...trackKeys.values()].filter((ids) => ids.length > 1).flat()
  const completeUniqueTags = segments.every(({ trackNumber }) => trackNumber !== undefined) && duplicateTrackIds.length === 0
  const ordered = [...segments].sort((left, right) => completeUniqueTags
    ? (left.discNumber ?? 1) - (right.discNumber ?? 1)
      || (left.trackNumber ?? 0) - (right.trackNumber ?? 0)
      || naturalCompare(left.relativePath, right.relativePath)
    : naturalCompare(left.relativePath, right.relativePath))
  const filenamesAreOrdered = segments.every(({ relativePath }) => hasNumericOrderingHint(relativePath))
  return {
    segmentIds: ordered.map(({ id }) => id),
    requiresReview: segments.length > 1 && (!completeUniqueTags && !filenamesAreOrdered || duplicateTrackIds.length > 0),
    duplicateTrackIds,
  }
}

function inferMetadata(
  segments: readonly AudiobookSegmentInspection[],
  sidecar: ReturnType<typeof inspectAudiobookSidecars>['metadata'],
): AudiobookMetadataDraft {
  const albums = distinct(segments.flatMap(({ album }) => album ? [album] : []))
  const singleTitle = segments.length === 1 ? segments[0]?.title : undefined
  const folderTitle = inferredFolderTitle(segments)
  const title = sidecar.title ?? (albums.length === 1 ? albums[0] : undefined) ?? singleTitle ?? folderTitle
    ?? fileStem(segments[0]?.fileName ?? 'Untitled audiobook')
  const segmentAuthors = distinct(segments.flatMap(({ authors }) => authors))
  const segmentNarrators = distinct(segments.flatMap(({ narrators }) => narrators))
  const seriesValues = distinct(segments.flatMap(({ series }) => series ? [series] : []))
  return {
    title,
    authors: sidecar.authors.length ? sidecar.authors : segmentAuthors,
    narrators: sidecar.narrators.length ? sidecar.narrators : segmentNarrators,
    ...(sidecar.series || seriesValues.length === 1 ? { series: sidecar.series ?? seriesValues[0] } : {}),
    ...(sidecar.language ? { language: sidecar.language } : {}),
  }
}

function inferredFolderTitle(segments: readonly AudiobookSegmentInspection[]): string | undefined {
  const roots = distinct(segments.flatMap(({ relativePath }) => {
    const parts = relativePath.split('/')
    return parts.length > 1 ? [parts[0] ?? ''] : []
  }))
  return roots.length === 1 ? fileStem(roots[0] ?? '') : undefined
}

function buildIssues(
  segments: readonly AudiobookSegmentInspection[],
  metadata: AudiobookMetadataDraft,
  order: ReturnType<typeof suggestOrder>,
): AudiobookImportIssue[] {
  const issues: AudiobookImportIssue[] = []
  if (order.requiresReview) {
    issues.push({
      code: 'ambiguous-order',
      severity: 'review',
      message: 'Track tags or filenames do not prove one order. Check the sequence before merging.',
      segmentIds: segments.map(({ id }) => id),
    })
  }
  if (order.duplicateTrackIds.length > 0) {
    issues.push({
      code: 'duplicate-track-number',
      severity: 'review',
      message: 'Two or more files claim the same disc and track number.',
      segmentIds: order.duplicateTrackIds,
    })
  }
  const titleEvidence = distinct(segments.flatMap(({ album, title }) => album ? [album] : title ? [title] : []))
  if (titleEvidence.length === 0) {
    issues.push({
      code: 'missing-title',
      severity: 'review',
      message: `No embedded title was found. “${metadata.title}” was inferred from the folder or filename.`,
      segmentIds: segments.map(({ id }) => id),
    })
  }
  if (metadata.authors.length === 0) {
    issues.push({
      code: 'missing-author',
      severity: 'review',
      message: 'No author tag was found. Add an author if the files do not identify one.',
      segmentIds: segments.map(({ id }) => id),
    })
  }
  const albums = distinct(segments.flatMap(({ album }) => album ? [album] : []))
  const authors = distinct(segments.flatMap((segment) => segment.authors))
  if (albums.length > 1 || authors.length > Math.max(1, metadata.authors.length)) {
    issues.push({
      code: 'conflicting-metadata',
      severity: 'review',
      message: 'The selected files disagree about book or contributor metadata. Review the merged values.',
      segmentIds: segments.map(({ id }) => id),
    })
  }
  for (const segment of segments) {
    const suffix = extension(segment.fileName)
    const mismatched = segment.container === 'mpeg-audio'
      ? !['mp3', ''].includes(suffix)
      : !['m4b', 'm4a', 'mp4', ''].includes(suffix)
    if (mismatched) {
      issues.push({
        code: 'mislabeled-container',
        severity: 'notice',
        message: `“${segment.fileName}” was identified from its audio container, not its extension.`,
        segmentIds: [segment.id],
      })
    }
  }
  return issues
}

function normalizeInspectedChapters(
  orderedSegments: readonly AudiobookSegmentInspection[],
  inspected: readonly { source: AudiobookImportSource; metadata: ParsedAudioMetadata }[],
  sidecarChapters: readonly SidecarChapter[],
): AudiobookChapterInspection[] {
  if (sidecarChapters.length > 0) {
    return sidecarChapters.flatMap((chapter, index) => {
      const mapped = mapSidecarChapter(chapter, orderedSegments)
      if (!mapped) return []
      return [{
        key: chapterKey(mapped.segment.id, chapter.startMs, chapter.title, index),
        title: chapter.title,
        segmentId: mapped.segment.id,
        positionMs: mapped.positionMs,
        ...(chapter.endMs !== undefined ? { endPositionMs: mapped.positionMs + (chapter.endMs - chapter.startMs) } : {}),
        provenance: chapter.provenance,
      }]
    })
  }
  return orderedSegments.flatMap<AudiobookChapterInspection>((segment, segmentIndex) => {
    const metadata = inspected[segment.sourceIndex]?.metadata
    return metadata?.chapters.length
      ? metadata.chapters.map((chapter, index) => ({
          key: chapterKey(segment.id, chapter.startMs, chapter.title, index),
          title: chapter.title,
          segmentId: segment.id,
          positionMs: chapter.startMs,
          ...(chapter.endMs !== undefined ? { endPositionMs: chapter.endMs } : {}),
          provenance: 'embedded' as const,
        }))
      : [{
          key: chapterKey(segment.id, 0, segment.title ?? segment.fileName, segmentIndex),
          title: segment.title ?? (fileStem(segment.fileName) || `Part ${segmentIndex + 1}`),
          segmentId: segment.id,
          positionMs: 0,
          endPositionMs: segment.durationMs,
          provenance: 'track' as const,
        }]
  })
}

function mapSidecarChapter(
  chapter: SidecarChapter,
  segments: readonly AudiobookSegmentInspection[],
): { readonly segment: AudiobookSegmentInspection; readonly positionMs: number } | undefined {
  if (chapter.fileName) {
    const normalized = chapter.fileName.replace(/\\/g, '/').toLocaleLowerCase()
    const segment = segments.find(({ relativePath, fileName }) =>
      relativePath.toLocaleLowerCase() === normalized || fileName.toLocaleLowerCase() === normalized,
    )
    return segment && chapter.startMs < segment.durationMs ? { segment, positionMs: chapter.startMs } : undefined
  }
  if (segments.length === 1) {
    const segment = segments[0]
    return segment && chapter.startMs < segment.durationMs ? { segment, positionMs: chapter.startMs } : undefined
  }
  let remaining = chapter.startMs
  for (const segment of segments) {
    if (remaining < segment.durationMs) return { segment, positionMs: remaining }
    remaining -= segment.durationMs
  }
  return undefined
}

function absoluteChapters(
  chapters: readonly AudiobookChapterInspection[],
  segments: readonly NormalizedAudiobookSegment[],
): NormalizedAudiobookChapter[] {
  const byId = new Map(segments.map((segment) => [segment.id, segment]))
  const starts = chapters.flatMap((chapter) => {
    const segment = byId.get(chapter.segmentId)
    if (!segment || chapter.positionMs < 0 || chapter.positionMs >= segment.durationMs) return []
    return [{ chapter, segment, absoluteStartMs: segment.absoluteStartMs + chapter.positionMs }]
  }).sort((left, right) => left.absoluteStartMs - right.absoluteStartMs || left.chapter.key.localeCompare(right.chapter.key))
  const seenStarts = new Set<number>()
  return starts.flatMap(({ chapter, segment, absoluteStartMs }, index) => {
    if (seenStarts.has(absoluteStartMs)) return []
    seenStarts.add(absoluteStartMs)
    const nextStart = starts[index + 1]?.absoluteStartMs
    const explicitEnd = chapter.endPositionMs === undefined
      ? undefined
      : Math.min(segment.absoluteEndMs, segment.absoluteStartMs + chapter.endPositionMs)
    const proposedEnd = explicitEnd === undefined
      ? nextStart ?? segments.at(-1)?.absoluteEndMs ?? absoluteStartMs + 1
      : nextStart === undefined
        ? explicitEnd
        : Math.min(explicitEnd, nextStart)
    const absoluteEndMs = Math.max(
      absoluteStartMs + 1,
      proposedEnd,
    )
    return [{
      key: chapter.key,
      title: chapter.title,
      segmentId: chapter.segmentId,
      absoluteStartMs,
      absoluteEndMs,
      provenance: chapter.provenance,
    }]
  })
}

async function chooseCover(
  sidecar: AudiobookImportSource | undefined,
  inspected: readonly { metadata: ParsedAudioMetadata }[],
): Promise<AudiobookCover | undefined> {
  if (sidecar) {
    const mediaType = mimeTypeForImage(sidecar.bytes, sidecar.mediaType)
    if (mediaType) {
      return { mediaType, bytes: sidecar.bytes.slice(), sha256: await sha256(sidecar.bytes), provenance: 'sidecar' }
    }
  }
  for (const { metadata: { cover } } of inspected) {
    if (!cover) continue
    const mediaType = mimeTypeForImage(cover.bytes, cover.mediaType)
    if (mediaType) return { ...cover, mediaType, sha256: await sha256(cover.bytes) }
  }
  return undefined
}

function requireSegment(
  segments: readonly AudiobookSegmentInspection[],
  id: string,
): AudiobookSegmentInspection {
  const segment = segments.find((candidate) => candidate.id === id)
  if (!segment) throw new AudiobookImportError('stale-review', `The reviewed segment ${id} is no longer selected.`)
  return segment
}

function chapterKey(segmentId: string, startMs: number, title: string, index: number): string {
  const slug = title.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32)
  return `${segmentId}:chapter:${startMs}:${slug || index + 1}`
}
