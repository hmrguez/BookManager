import { z } from 'zod'
import {
  AUDIOBOOK_MANIFEST_VERSION,
  type NormalizedAudiobook,
  type PlaybackManifest,
} from './model'

const fingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/)
const playbackManifestSegmentSchema = z.object({
  id: z.string().min(1),
  mediaType: z.enum(['audio/mp4', 'audio/mpeg']),
  container: z.enum(['mpeg-audio', 'mpeg-4-audio']),
  durationMs: z.number().int().positive(),
  absoluteStartMs: z.number().int().nonnegative(),
  absoluteEndMs: z.number().int().positive(),
  fingerprint: fingerprintSchema,
  playableCapability: z.string().min(1),
})
const playbackManifestChapterSchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  segmentId: z.string().min(1),
  absoluteStartMs: z.number().int().nonnegative(),
  absoluteEndMs: z.number().int().positive(),
  provenance: z.enum(['embedded', 'cue', 'sidecar', 'track']),
})

export const playbackManifestSchema = z.object({
  schemaVersion: z.literal(AUDIOBOOK_MANIFEST_VERSION),
  queueId: z.string().min(1),
  editionId: z.string().min(1),
  assetId: z.string().min(1),
  fingerprint: fingerprintSchema,
  createdAt: z.iso.datetime({ offset: true }),
  displayMetadata: z.object({
    title: z.string().min(1),
    authors: z.array(z.string().min(1)),
    narrators: z.array(z.string().min(1)),
    series: z.string().min(1).optional(),
  }),
  systemSurfaceMetadata: z.object({
    private: z.object({ title: z.literal('Wovenleaf'), subtitle: z.literal('Audiobook') }),
    preview: z.object({
      title: z.string().min(1),
      contributor: z.string().min(1),
      series: z.string().min(1).optional(),
    }),
  }),
  segments: z.array(playbackManifestSegmentSchema).min(1),
  chapters: z.array(playbackManifestChapterSchema).min(1),
  initialAbsolutePositionMs: z.number().int().nonnegative(),
  rate: z.number().positive(),
  skipIntervals: z.object({
    forwardMs: z.number().int().positive(),
    backwardMs: z.number().int().positive(),
  }),
  sleepTimer: z.null(),
  sourceCapabilities: z.object({
    local: z.literal(true),
    seekable: z.literal(true),
    relinkable: z.literal(true),
  }),
}).superRefine((manifest, context) => {
  let expectedStart = 0
  for (const [index, segment] of manifest.segments.entries()) {
    if (segment.absoluteStartMs !== expectedStart || segment.absoluteEndMs !== expectedStart + segment.durationMs) {
      context.addIssue({
        code: 'custom',
        path: ['segments', index, 'absoluteStartMs'],
        message: 'Playback manifest segments must form one contiguous absolute timeline',
      })
    }
    expectedStart = segment.absoluteEndMs
  }
  const segmentIds = new Set(manifest.segments.map(({ id }) => id))
  manifest.chapters.forEach((chapter, index) => {
    if (!segmentIds.has(chapter.segmentId) || chapter.absoluteEndMs <= chapter.absoluteStartMs) {
      context.addIssue({
        code: 'custom',
        path: ['chapters', index],
        message: 'Playback manifest chapters require a valid segment and positive range',
      })
    }
  })
  if (manifest.initialAbsolutePositionMs >= expectedStart && expectedStart > 0) {
    context.addIssue({
      code: 'custom',
      path: ['initialAbsolutePositionMs'],
      message: 'Initial position must remain inside the audiobook timeline',
    })
  }
})

export function createPlaybackManifest(
  audiobook: NormalizedAudiobook,
  input: {
    readonly queueId: string
    readonly editionId: string
    readonly assetId: string
    readonly createdAt: string
    readonly playableCapabilities: ReadonlyMap<string, string>
    readonly initialAbsolutePositionMs?: number
    readonly rate?: number
    readonly forwardSkipMs?: number
    readonly backwardSkipMs?: number
  },
): PlaybackManifest {
  const initialAbsolutePositionMs = Math.max(
    0,
    Math.min(input.initialAbsolutePositionMs ?? 0, Math.max(0, audiobook.totalDurationMs - 1)),
  )
  const manifest: PlaybackManifest = {
    schemaVersion: AUDIOBOOK_MANIFEST_VERSION,
    queueId: input.queueId,
    editionId: input.editionId,
    assetId: input.assetId,
    fingerprint: audiobook.fingerprint,
    createdAt: input.createdAt,
    displayMetadata: {
      title: audiobook.metadata.title,
      authors: audiobook.metadata.authors,
      narrators: audiobook.metadata.narrators,
      ...(audiobook.metadata.series ? { series: audiobook.metadata.series } : {}),
    },
    systemSurfaceMetadata: {
      private: { title: 'Wovenleaf', subtitle: 'Audiobook' },
      preview: {
        title: audiobook.metadata.title,
        contributor: audiobook.metadata.authors[0] ?? audiobook.metadata.narrators[0] ?? 'Unknown contributor',
        ...(audiobook.metadata.series ? { series: audiobook.metadata.series } : {}),
      },
    },
    segments: audiobook.segments.map((segment) => {
      const playableCapability = input.playableCapabilities.get(segment.id)
      if (!playableCapability) throw new Error(`Missing playable capability for ${segment.id}`)
      return {
        id: segment.id,
        mediaType: segment.mediaType,
        container: segment.container,
        durationMs: segment.durationMs,
        absoluteStartMs: segment.absoluteStartMs,
        absoluteEndMs: segment.absoluteEndMs,
        fingerprint: segment.fingerprint,
        playableCapability,
      }
    }),
    chapters: audiobook.chapters.map((chapter) => ({ ...chapter })),
    initialAbsolutePositionMs,
    rate: input.rate ?? 1,
    skipIntervals: {
      forwardMs: input.forwardSkipMs ?? 30_000,
      backwardMs: input.backwardSkipMs ?? 15_000,
    },
    sleepTimer: null,
    sourceCapabilities: { local: true, seekable: true, relinkable: true },
  }
  return immutablePlaybackManifest(manifest)
}

export function immutablePlaybackManifest(value: unknown): PlaybackManifest {
  return deepFreeze(playbackManifestSchema.parse(value)) as PlaybackManifest
}

function deepFreeze<Value>(value: Value): Value {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
  return value
}
