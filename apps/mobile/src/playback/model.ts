import { z } from 'zod'
import { playbackManifestSchema } from '../audiobooks/manifest'

export const AUDIOBOOK_PLAYBACK_BRIDGE_VERSION = 1 as const
export const PLAYBACK_RECOVERY_POSITION_BOUND_MS = 15_000
export const PLAYBACK_SNAPSHOT_CONVERGENCE_BOUND_MS = 1_000
export const MAX_PLAYBACK_JOURNAL_EVENTS = 1_024

const identifierSchema = z.string().min(1)
const positionSchema = z.number().int().nonnegative()

export const playbackTransportStateSchema = z.enum([
  'empty',
  'loading',
  'paused',
  'playing',
  'buffering',
  'stopped',
  'ended',
  'error',
])

export const playbackSuppressionReasonSchema = z.enum([
  'none',
  'interruption',
  'audio-focus-loss',
  'route-lost',
  'sleep-timer',
  'process-recreated',
  'error',
])

export const playbackErrorSchema = z.object({
  code: z.enum([
    'engineUnavailable',
    'unsupportedAsset',
    'corruptAsset',
    'relinkRequired',
    'authenticationRequired',
    'queueInvalid',
    'commandRejected',
    'playbackFailed',
  ]),
  message: z.string().min(1),
  recoverable: z.boolean(),
  capability: z.string().min(1).optional(),
  expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
})

export const playbackCapabilitiesSchema = z.object({
  bridgeVersion: z.literal(AUDIOBOOK_PLAYBACK_BRIDGE_VERSION),
  engine: z.enum(['ios-avfoundation', 'android-media3', 'web-audio']),
  backgroundPlayback: z.boolean(),
  systemControls: z.boolean(),
  processRestoration: z.boolean(),
  systemLibrary: z.boolean(),
  airPlay: z.boolean(),
  cast: z.boolean(),
  routeSelection: z.boolean(),
  sleepTimer: z.boolean(),
  seek: z.boolean(),
  supportedMediaTypes: z.array(z.enum(['audio/mpeg', 'audio/mp4'])),
  minimumRate: z.number().positive(),
  maximumRate: z.number().positive(),
  degradedReason: z.string().min(1).optional(),
})

export const playbackRouteSchema = z.object({
  kind: z.enum(['built-in', 'wired', 'bluetooth', 'airplay', 'cast', 'unknown']),
  name: z.string().min(1),
  external: z.boolean(),
})

export const playbackSleepTimerSchema = z.object({
  mode: z.enum(['duration', 'chapter-end']),
  deadline: z.iso.datetime({ offset: true }).optional(),
  remainingMs: z.number().int().nonnegative(),
})

export const playbackSnapshotSchema = z.object({
  bridgeVersion: z.literal(AUDIOBOOK_PLAYBACK_BRIDGE_VERSION),
  engineEpoch: identifierSchema,
  queueId: identifierSchema.nullable(),
  playbackSessionId: identifierSchema.nullable(),
  revision: z.number().int().nonnegative(),
  state: playbackTransportStateSchema,
  suppressionReason: playbackSuppressionReasonSchema,
  playIntent: z.boolean(),
  segmentId: identifierSchema.nullable(),
  chapterId: identifierSchema.nullable(),
  absolutePositionMs: positionSchema,
  segmentPositionMs: positionSchema,
  durationMs: positionSchema,
  bufferedPositionMs: positionSchema,
  rate: z.number().positive(),
  sleepTimer: playbackSleepTimerSchema.nullable(),
  route: playbackRouteSchema,
  capabilities: playbackCapabilitiesSchema,
  lastCommandId: identifierSchema.nullable(),
  error: playbackErrorSchema.nullable(),
  observedAt: z.iso.datetime({ offset: true }),
})

export const nativePlaybackEventSchema = z.object({
  bridgeVersion: z.literal(AUDIOBOOK_PLAYBACK_BRIDGE_VERSION),
  id: identifierSchema,
  sequence: z.number().int().positive(),
  engineEpoch: identifierSchema,
  queueId: identifierSchema,
  playbackSessionId: identifierSchema,
  revision: z.number().int().nonnegative(),
  kind: z.enum([
    'play',
    'resume',
    'pause',
    'seek',
    'rate-change',
    'chapter-transition',
    'segment-transition',
    'interruption',
    'route-loss',
    'sleep-expired',
    'stop',
    'end',
    'failure',
  ]),
  observedAt: z.iso.datetime({ offset: true }),
  activeDurationMs: z.number().int().nonnegative(),
  beforePositionMs: positionSchema.optional(),
  afterPositionMs: positionSchema.optional(),
  rate: z.number().positive(),
  reason: z.string().min(1),
  confidence: z.number().min(0).max(1),
  segmentId: identifierSchema.nullable(),
  chapterId: identifierSchema.nullable(),
  error: playbackErrorSchema.nullable(),
})

export const playbackSourceSchema = z.object({
  capability: identifierSchema,
  uri: z.string().min(1),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  byteSize: z.number().int().nonnegative(),
  mediaType: z.enum(['audio/mpeg', 'audio/mp4']),
})

export const playbackQueueRequestSchema = z.object({
  manifest: playbackManifestSchema,
  sources: z.array(playbackSourceSchema).min(1),
}).superRefine(({ manifest, sources }, context) => {
  const sourceByCapability = new Map(sources.map((source) => [source.capability, source]))
  for (const [index, segment] of manifest.segments.entries()) {
    const source = sourceByCapability.get(segment.playableCapability)
    if (!source || source.fingerprint !== segment.fingerprint || source.mediaType !== segment.mediaType) {
      context.addIssue({
        code: 'custom',
        path: ['sources', index],
        message: `Missing or mismatched source capability for segment ${segment.id}`,
      })
    }
  }
})

export type PlaybackTransportState = z.infer<typeof playbackTransportStateSchema>
export type PlaybackSuppressionReason = z.infer<typeof playbackSuppressionReasonSchema>
export type PlaybackError = z.infer<typeof playbackErrorSchema>
export type PlaybackCapabilities = z.infer<typeof playbackCapabilitiesSchema>
export type PlaybackRoute = z.infer<typeof playbackRouteSchema>
export type PlaybackSleepTimer = z.infer<typeof playbackSleepTimerSchema>
export type PlaybackSnapshot = z.infer<typeof playbackSnapshotSchema>
export type NativePlaybackEvent = z.infer<typeof nativePlaybackEventSchema>
export type PlaybackSource = z.infer<typeof playbackSourceSchema>
export type PlaybackQueueRequest = z.infer<typeof playbackQueueRequestSchema>

export type PlaybackCommand = {
  readonly commandId: string
  readonly expectedRevision: number
}

export class AudiobookPlaybackError extends Error {
  readonly code: PlaybackError['code'] | 'notFound' | 'staleSnapshot'
  readonly recoverable: boolean

  constructor(
    code: AudiobookPlaybackError['code'],
    message: string,
    options: ErrorOptions & { readonly recoverable?: boolean } = {},
  ) {
    super(message, options)
    this.name = 'AudiobookPlaybackError'
    this.code = code
    this.recoverable = options.recoverable ?? false
  }
}

export function isNewerPlaybackSnapshot(
  current: PlaybackSnapshot | undefined,
  candidate: PlaybackSnapshot,
): boolean {
  if (!current) return true
  if (current.engineEpoch !== candidate.engineEpoch) return true
  if (current.playbackSessionId !== candidate.playbackSessionId) return true
  return candidate.revision > current.revision
}

export function commandId(prefix = 'playback-command'): string {
  return `${prefix}:${crypto.randomUUID()}`
}
