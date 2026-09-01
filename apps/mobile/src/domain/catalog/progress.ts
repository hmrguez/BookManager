import { z } from 'zod'
import {
  assetIdSchema,
  editionIdSchema,
  integrationCheckpointIdSchema,
  progressSnapshotIdSchema,
  readingDeviceIdSchema,
  readingEventIdSchema,
  readingSessionIdSchema,
  sourceRecordIdSchema,
  type EditionId,
  type ProgressSnapshotId,
  type ReadingEventId,
} from './ids'
import { isoDateTimeSchema, type IsoDateTime } from './shared'

const confidenceSchema = z.number().min(0).max(1)
const fractionSchema = z.number().min(0).max(1)

export const readingLocatorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('page'), page: z.number().int().nonnegative() }),
  z.object({ kind: z.literal('percent'), fraction: fractionSchema }),
  z.object({
    kind: z.literal('epub'),
    href: z.string().min(1),
    locator: z.string().min(1),
    type: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    fragments: z.array(z.string().min(1)).optional(),
    progression: fractionSchema.optional(),
    totalProgression: fractionSchema.optional(),
    position: z.number().int().positive().optional(),
    text: z.object({
      before: z.string().optional(),
      highlight: z.string().optional(),
      after: z.string().optional(),
    }).optional(),
    assetFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    toolkit: z.object({
      name: z.literal('readium'),
      platform: z.enum(['ios', 'android']),
      version: z.string().min(1),
    }).optional(),
  }),
  z.object({
    kind: z.literal('audio-time'),
    positionMs: z.number().int().nonnegative(),
    chapterKey: z.string().min(1).optional(),
    segmentId: z.string().min(1).optional(),
  }),
  z.object({
    kind: z.literal('chapter'),
    chapterKey: z.string().min(1),
    chapterIndex: z.number().int().nonnegative(),
    progression: fractionSchema.optional(),
  }),
])

export const readingNormalizationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('reported-percent'), confidence: confidenceSchema }),
  z.object({
    kind: z.literal('edition-page-count'),
    totalPages: z.number().int().positive(),
    confidence: confidenceSchema,
  }),
  z.object({
    kind: z.literal('edition-duration'),
    durationMs: z.number().int().positive(),
    confidence: confidenceSchema,
  }),
  z.object({ kind: z.literal('epub-progression'), confidence: confidenceSchema }),
  z.object({
    kind: z.literal('chapter-map'),
    chapterCount: z.number().int().positive(),
    confidence: confidenceSchema,
  }),
  z.object({
    kind: z.literal('integration-reported'),
    integrationKey: z.string().min(1),
    confidence: confidenceSchema,
  }),
  z.object({ kind: z.literal('none'), confidence: z.literal(0), reason: z.string().min(1) }),
])

export const readingPositionSchema = z
  .object({
    locator: readingLocatorSchema,
    normalizedProgress: fractionSchema.optional(),
    normalization: readingNormalizationSchema,
  })
  .superRefine((position, context) => {
    const { locator, normalization, normalizedProgress } = position

    if (normalization.kind === 'none') {
      if (normalizedProgress !== undefined) {
        context.addIssue({
          code: 'custom',
          path: ['normalizedProgress'],
          message: 'Unnormalized positions cannot contain normalized progress',
        })
      }
      return
    }

    if (normalizedProgress === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['normalizedProgress'],
        message: 'A normalization method requires normalized progress',
      })
      return
    }

    let expected: number | undefined
    if (normalization.kind === 'reported-percent') {
      if (locator.kind !== 'percent') {
        addNormalizationIssue(context, 'Reported-percent normalization requires a percent locator')
      } else {
        expected = locator.fraction
      }
    }
    if (normalization.kind === 'edition-page-count') {
      if (locator.kind !== 'page') {
        addNormalizationIssue(context, 'Page-count normalization requires a page locator')
      } else if (locator.page > normalization.totalPages) {
        addNormalizationIssue(context, 'Page position exceeds the normalization page count')
      } else {
        expected = locator.page / normalization.totalPages
      }
    }
    if (normalization.kind === 'edition-duration') {
      if (locator.kind !== 'audio-time') {
        addNormalizationIssue(context, 'Duration normalization requires an audio-time locator')
      } else if (locator.positionMs > normalization.durationMs) {
        addNormalizationIssue(context, 'Audio position exceeds the normalization duration')
      } else {
        expected = locator.positionMs / normalization.durationMs
      }
    }
    if (normalization.kind === 'epub-progression') {
      if (
        locator.kind !== 'epub'
        || (locator.totalProgression === undefined && locator.progression === undefined)
      ) {
        addNormalizationIssue(
          context,
          'EPUB-progression normalization requires an EPUB locator with publication progression',
        )
      } else {
        expected = locator.totalProgression ?? locator.progression
      }
    }
    if (normalization.kind === 'chapter-map') {
      if (locator.kind !== 'chapter') {
        addNormalizationIssue(context, 'Chapter-map normalization requires a chapter locator')
      } else if (locator.chapterIndex >= normalization.chapterCount) {
        addNormalizationIssue(context, 'Chapter index exceeds the normalization chapter count')
      } else {
        expected =
          (locator.chapterIndex + (locator.progression ?? 0)) / normalization.chapterCount
      }
    }

    if (expected !== undefined && Math.abs(expected - normalizedProgress) > 1e-9) {
      context.addIssue({
        code: 'custom',
        path: ['normalizedProgress'],
        message: 'Normalized progress does not match its locator and normalization basis',
      })
    }
  })

function addNormalizationIssue(context: z.RefinementCtx, message: string): void {
  context.addIssue({ code: 'custom', path: ['normalization'], message })
}

export const readingEventSourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('local'),
    method: z.enum(['manual', 'epub-reader', 'audio-player', 'quick-capture', 'automation']),
  }),
  z.object({ kind: z.literal('migration'), migrationKey: z.string().min(1) }),
  z.object({
    kind: z.literal('integration'),
    integrationKey: z.string().min(1),
    sourceRecordId: sourceRecordIdSchema.optional(),
  }),
  z.object({
    kind: z.literal('sync'),
    integrationKey: z.string().min(1),
    peerId: z.string().min(1),
  }),
])

export const integrationCheckpointSchema = z.object({
  id: integrationCheckpointIdSchema,
  integrationKey: z.string().min(1),
  direction: z.enum(['import', 'export', 'sync']),
  opaqueCursor: z.string().min(1).optional(),
  previousCheckpointId: integrationCheckpointIdSchema.optional(),
  deviceId: readingDeviceIdSchema,
  observedAt: isoDateTimeSchema,
  committedAt: isoDateTimeSchema,
})

const eventEnvelopeShape = {
  id: readingEventIdSchema,
  editionId: editionIdSchema,
  assetId: assetIdSchema.optional(),
  source: readingEventSourceSchema,
  deviceId: readingDeviceIdSchema,
  integrationCheckpointId: integrationCheckpointIdSchema.optional(),
  observedAt: isoDateTimeSchema,
  effectiveAt: isoDateTimeSchema,
  recordedAt: isoDateTimeSchema,
  timeConfidence: confidenceSchema,
  estimatedClockOffsetMs: z.number().int().optional(),
}

const startPayloadSchema = z.object({
  kind: z.literal('start'),
  position: readingPositionSchema.optional(),
})
const resumePayloadSchema = z.object({
  kind: z.literal('resume'),
  position: readingPositionSchema.optional(),
})
const pausePayloadSchema = z.object({
  kind: z.literal('pause'),
  position: readingPositionSchema.optional(),
})
const locationPayloadSchema = z.object({
  kind: z.literal('location'),
  position: readingPositionSchema,
})
const sessionPayloadSchema = z.object({
  kind: z.literal('session'),
  sessionId: readingSessionIdSchema,
  startedAt: isoDateTimeSchema,
  endedAt: isoDateTimeSchema,
  activeDurationMs: z.number().int().nonnegative(),
  startPosition: readingPositionSchema.optional(),
  endPosition: readingPositionSchema.optional(),
})
const finishPayloadSchema = z.object({
  kind: z.literal('finish'),
  position: readingPositionSchema,
})
const didNotFinishPayloadSchema = z.object({
  kind: z.literal('did-not-finish'),
  position: readingPositionSchema.optional(),
  reason: z.string().min(1).optional(),
})
const ratingPayloadSchema = z.object({
  kind: z.literal('rating'),
  value: z.number().int().min(1).max(5),
})
const notePayloadSchema = z.object({
  kind: z.literal('note'),
  text: z.string().min(1),
})

const readingEventIdListSchema = z
  .array(readingEventIdSchema)
  .min(1)
  .refine((ids) => new Set(ids).size === ids.length, 'Reading event references must be unique')

export const readingCorrectionReplacementSchema = z.discriminatedUnion('kind', [
  startPayloadSchema,
  resumePayloadSchema,
  pausePayloadSchema,
  locationPayloadSchema,
  sessionPayloadSchema,
  finishPayloadSchema,
  didNotFinishPayloadSchema,
  ratingPayloadSchema,
  notePayloadSchema,
])

const importPayloadSchema = z.object({
  kind: z.literal('import'),
  importedEventIds: readingEventIdListSchema,
  externalBatchKey: z.string().min(1).optional(),
})
const syncPayloadSchema = z.object({
  kind: z.literal('sync'),
  syncedEventIds: readingEventIdListSchema,
  direction: z.enum(['push', 'pull', 'bidirectional']),
})
const correctionPayloadSchema = z.object({
  kind: z.literal('correction'),
  targetEventIds: readingEventIdListSchema,
  reason: z.string().min(1),
  action: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('tombstone') }),
    z.object({ kind: z.literal('replace'), replacement: readingCorrectionReplacementSchema }),
  ]),
})

export const readingEventSchema = z
  .discriminatedUnion('kind', [
    startPayloadSchema.extend(eventEnvelopeShape),
    resumePayloadSchema.extend(eventEnvelopeShape),
    pausePayloadSchema.extend(eventEnvelopeShape),
    locationPayloadSchema.extend(eventEnvelopeShape),
    sessionPayloadSchema.extend(eventEnvelopeShape),
    finishPayloadSchema.extend(eventEnvelopeShape),
    didNotFinishPayloadSchema.extend(eventEnvelopeShape),
    ratingPayloadSchema.extend(eventEnvelopeShape),
    notePayloadSchema.extend(eventEnvelopeShape),
    importPayloadSchema.extend(eventEnvelopeShape),
    syncPayloadSchema.extend(eventEnvelopeShape),
    correctionPayloadSchema.extend(eventEnvelopeShape),
  ])
  .superRefine((event, context) => {
    if (
      (event.source.kind === 'integration' || event.source.kind === 'sync') &&
      event.integrationCheckpointId === undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['integrationCheckpointId'],
        message: 'Integration and sync events require an integration checkpoint',
      })
    }
    if (
      event.source.kind !== 'integration' &&
      event.source.kind !== 'sync' &&
      event.integrationCheckpointId !== undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['integrationCheckpointId'],
        message: 'Only integration and sync sources may reference an integration checkpoint',
      })
    }
    if (
      event.kind === 'import' &&
      event.source.kind !== 'integration' &&
      event.source.kind !== 'migration'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['source'],
        message: 'Import markers require an integration or migration source',
      })
    }
    if (event.kind === 'sync' && event.source.kind !== 'sync') {
      context.addIssue({
        code: 'custom',
        path: ['source'],
        message: 'Sync markers require a sync source',
      })
    }
    const statePayload =
      event.kind === 'correction' && event.action.kind === 'replace'
        ? event.action.replacement
        : event
    if (
      statePayload.kind === 'session' &&
      Date.parse(statePayload.endedAt) < Date.parse(statePayload.startedAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['endedAt'],
        message: 'A reading session cannot end before it starts',
      })
    }
    if (
      statePayload.kind === 'finish' &&
      statePayload.position.normalizedProgress !== undefined &&
      statePayload.position.normalizedProgress !== 1
    ) {
      context.addIssue({
        code: 'custom',
        path: ['position', 'normalizedProgress'],
        message: 'A finish event with normalized progress must be at 100%',
      })
    }
    if (event.kind === 'correction' && event.targetEventIds.includes(event.id)) {
      context.addIssue({
        code: 'custom',
        path: ['targetEventIds'],
        message: 'A correction cannot target itself',
      })
    }
    if (event.kind === 'import' && event.importedEventIds.includes(event.id)) {
      context.addIssue({
        code: 'custom',
        path: ['importedEventIds'],
        message: 'An import marker cannot include itself',
      })
    }
    if (event.kind === 'sync' && event.syncedEventIds.includes(event.id)) {
      context.addIssue({
        code: 'custom',
        path: ['syncedEventIds'],
        message: 'A sync marker cannot include itself',
      })
    }
  })

export const readingLedgerSchema = z
  .object({
    integrationCheckpoints: z.array(integrationCheckpointSchema),
    events: z.array(readingEventSchema),
  })
  .superRefine((ledger, context) => {
    const checkpoints = uniqueById(
      ledger.integrationCheckpoints,
      'integrationCheckpoints',
      context,
    )
    const events = uniqueById(ledger.events, 'events', context)

    ledger.integrationCheckpoints.forEach((checkpoint, index) => {
      if (!checkpoint.previousCheckpointId) return
      const previous = checkpoints.get(checkpoint.previousCheckpointId)
      if (!previous) {
        context.addIssue({
          code: 'custom',
          path: ['integrationCheckpoints', index, 'previousCheckpointId'],
          message: `Missing integration checkpoint ${checkpoint.previousCheckpointId}`,
        })
      } else if (
        previous.integrationKey !== checkpoint.integrationKey ||
        previous.direction !== checkpoint.direction
      ) {
        context.addIssue({
          code: 'custom',
          path: ['integrationCheckpoints', index, 'previousCheckpointId'],
          message: 'A checkpoint can only continue the same integration and direction',
        })
      }
    })

    ledger.events.forEach((event, index) => {
      const checkpoint = event.integrationCheckpointId
        ? checkpoints.get(event.integrationCheckpointId)
        : undefined
      if (event.integrationCheckpointId && !checkpoint) {
        context.addIssue({
          code: 'custom',
          path: ['events', index, 'integrationCheckpointId'],
          message: `Missing integration checkpoint ${event.integrationCheckpointId}`,
        })
      }
      if (
        checkpoint &&
        (event.source.kind === 'integration' || event.source.kind === 'sync') &&
        checkpoint.integrationKey !== event.source.integrationKey
      ) {
        context.addIssue({
          code: 'custom',
          path: ['events', index, 'integrationCheckpointId'],
          message: 'Event source and checkpoint must identify the same integration',
        })
      }

      const referencedEventIds =
        event.kind === 'import'
          ? event.importedEventIds
          : event.kind === 'sync'
            ? event.syncedEventIds
            : event.kind === 'correction'
              ? event.targetEventIds
              : []
      referencedEventIds.forEach((eventId, referenceIndex) => {
        const referenced = events.get(eventId)
        if (!referenced) {
          context.addIssue({
            code: 'custom',
            path: ['events', index, referencedEventPath(event.kind), referenceIndex],
            message: `Missing reading event ${eventId}`,
          })
        } else if (referenced.editionId !== event.editionId) {
          context.addIssue({
            code: 'custom',
            path: ['events', index, referencedEventPath(event.kind), referenceIndex],
            message: 'Reading event references cannot cross Edition boundaries',
          })
        }
      })
    })

    addCycleIssues(
      ledger.integrationCheckpoints,
      (checkpoint) => checkpoint.previousCheckpointId ? [checkpoint.previousCheckpointId] : [],
      ['integrationCheckpoints'],
      context,
    )
    addCycleIssues(
      ledger.events,
      (event) => event.kind === 'correction' ? event.targetEventIds : [],
      ['events'],
      context,
    )
  })

function uniqueById<Entity extends { readonly id: string }>(
  entities: readonly Entity[],
  collectionName: string,
  context: z.RefinementCtx,
): Map<string, Entity> {
  const result = new Map<string, Entity>()
  entities.forEach((entity, index) => {
    if (result.has(entity.id)) {
      context.addIssue({
        code: 'custom',
        path: [collectionName, index, 'id'],
        message: `Duplicate ID ${entity.id}`,
      })
    }
    result.set(entity.id, entity)
  })
  return result
}

function referencedEventPath(kind: ReadingEventKind): string {
  if (kind === 'import') return 'importedEventIds'
  if (kind === 'sync') return 'syncedEventIds'
  return 'targetEventIds'
}

function addCycleIssues<Entity extends { readonly id: string }>(
  entities: readonly Entity[],
  edgesFor: (entity: Entity) => readonly string[],
  path: readonly string[],
  context: z.RefinementCtx,
): void {
  const byId = new Map(entities.map((entity) => [entity.id, entity]))
  const complete = new Set<string>()
  const visiting = new Set<string>()

  function visit(id: string): boolean {
    if (complete.has(id)) return false
    if (visiting.has(id)) return true
    const entity = byId.get(id)
    if (!entity) return false
    visiting.add(id)
    const cyclic = edgesFor(entity).some((targetId) => visit(targetId))
    visiting.delete(id)
    complete.add(id)
    return cyclic
  }

  entities.forEach((entity, index) => {
    if (visit(entity.id)) {
      context.addIssue({
        code: 'custom',
        path: [...path, index],
        message: `Cycle detected from ${entity.id}`,
      })
    }
  })
}

export const readingStatusSchema = z.enum([
  'unstarted',
  'reading',
  'paused',
  'finished',
  'did-not-finish',
])

export const progressSnapshotSchema = z
  .object({
    id: progressSnapshotIdSchema,
    editionId: editionIdSchema,
    assetId: assetIdSchema.optional(),
    status: readingStatusSchema,
    position: readingPositionSchema.optional(),
    normalizedProgress: fractionSchema.optional(),
    startedAt: isoDateTimeSchema.optional(),
    pausedAt: isoDateTimeSchema.optional(),
    finishedAt: isoDateTimeSchema.optional(),
    didNotFinishAt: isoDateTimeSchema.optional(),
    sourceEventId: readingEventIdSchema.optional(),
    projectedAt: isoDateTimeSchema,
  })
  .superRefine((snapshot, context) => {
    if (snapshot.normalizedProgress !== snapshot.position?.normalizedProgress) {
      context.addIssue({
        code: 'custom',
        path: ['normalizedProgress'],
        message: 'Snapshot normalized progress must match its native position',
      })
    }
    if (snapshot.status === 'finished' && snapshot.finishedAt === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['finishedAt'],
        message: 'A finished snapshot requires finishedAt',
      })
    }
    if (snapshot.status === 'did-not-finish' && snapshot.didNotFinishAt === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['didNotFinishAt'],
        message: 'A did-not-finish snapshot requires didNotFinishAt',
      })
    }
    if (snapshot.status === 'paused' && snapshot.pausedAt === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['pausedAt'],
        message: 'A paused snapshot requires pausedAt',
      })
    }
    if (snapshot.position && snapshot.sourceEventId === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['sourceEventId'],
        message: 'A positioned snapshot requires its source reading event',
      })
    }
  })

export const READING_EVENT_KINDS = [
  'start',
  'resume',
  'pause',
  'location',
  'session',
  'finish',
  'did-not-finish',
  'rating',
  'note',
  'import',
  'sync',
  'correction',
] as const

export type ReadingEventKind = (typeof READING_EVENT_KINDS)[number]
export type ReadingLocator = z.infer<typeof readingLocatorSchema>
export type ReadingNormalization = z.infer<typeof readingNormalizationSchema>
export type ReadingPosition = z.infer<typeof readingPositionSchema>
export type ReadingEventSource = z.infer<typeof readingEventSourceSchema>
export type IntegrationCheckpoint = z.infer<typeof integrationCheckpointSchema>
export type ReadingCorrectionReplacement = z.infer<typeof readingCorrectionReplacementSchema>
export type ReadingEvent = z.infer<typeof readingEventSchema>
export type ReadingLedger = z.infer<typeof readingLedgerSchema>
export type ReadingStatus = z.infer<typeof readingStatusSchema>
export type ProgressSnapshot = z.infer<typeof progressSnapshotSchema>

export type ProjectedReadingSession = {
  readonly id: z.infer<typeof readingSessionIdSchema>
  readonly sourceEventId: ReadingEventId
  readonly startedAt: IsoDateTime
  readonly endedAt: IsoDateTime
  readonly activeDurationMs: number
  readonly startPosition?: ReadingPosition
  readonly endPosition?: ReadingPosition
}

export type ProjectedReadingRating = {
  readonly value: number
  readonly sourceEventId: ReadingEventId
  readonly effectiveAt: IsoDateTime
}

export type ProjectedReadingNote = {
  readonly text: string
  readonly sourceEventId: ReadingEventId
  readonly effectiveAt: IsoDateTime
}

export type ReadingState = {
  readonly editionId: EditionId
  status: ReadingStatus
  currentPosition?: ReadingPosition
  currentPositionEventId?: ReadingEventId
  currentPositionAssetId?: z.infer<typeof assetIdSchema>
  startedAt?: IsoDateTime
  pausedAt?: IsoDateTime
  finishedAt?: IsoDateTime
  didNotFinishAt?: IsoDateTime
  lastReadAt?: IsoDateTime
  lastEventId?: ReadingEventId
  rating?: ProjectedReadingRating
  readonly notes: ProjectedReadingNote[]
  readonly sessions: ProjectedReadingSession[]
  readonly appliedEventIds: ReadingEventId[]
}

export type ReadingProjectionOptions = {
  /** Include only facts effective at or before this instant. */
  readonly effectiveAt?: IsoDateTime
  /** Reconstruct what the local ledger knew at or before this append instant. */
  readonly knownAt?: IsoDateTime
}

export function deriveReadingState(
  editionId: EditionId,
  events: readonly ReadingEvent[],
  options: ReadingProjectionOptions = {},
): ReadingState {
  validateProjectionEvents(events)

  const candidates = events.filter(
    (event) =>
      event.editionId === editionId &&
      (options.effectiveAt === undefined ||
        timestamp(event.effectiveAt) <= timestamp(options.effectiveAt)) &&
      (options.knownAt === undefined || timestamp(event.recordedAt) <= timestamp(options.knownAt)),
  )
  const activeIds = resolveActiveEventIds(candidates)
  const activeEvents = candidates
    .filter((event) => activeIds.has(event.id))
    .sort(compareReadingEvents)

  const state: ReadingState = {
    editionId,
    status: 'unstarted',
    notes: [],
    sessions: [],
    appliedEventIds: [],
  }

  for (const event of activeEvents) {
    state.appliedEventIds.push(event.id)
    const payload =
      event.kind === 'correction'
        ? event.action.kind === 'replace'
          ? event.action.replacement
          : undefined
        : event.kind === 'import' || event.kind === 'sync'
          ? undefined
          : event
    if (!payload) continue

    const setPosition = (position: ReadingPosition | undefined) => {
      if (!position) return
      state.currentPosition = position
      state.currentPositionEventId = event.id
      state.currentPositionAssetId = event.assetId
    }
    const markReadAt = (value: IsoDateTime = event.effectiveAt) => {
      state.lastReadAt = value
      state.lastEventId = event.id
    }

    switch (payload.kind) {
      case 'start':
        if (
          state.status === 'unstarted' ||
          state.status === 'finished' ||
          state.status === 'did-not-finish'
        ) {
          state.startedAt = event.effectiveAt
        }
        state.status = 'reading'
        state.pausedAt = undefined
        state.finishedAt = undefined
        state.didNotFinishAt = undefined
        setPosition(payload.position)
        markReadAt()
        break
      case 'resume':
        state.startedAt ??= event.effectiveAt
        state.status = 'reading'
        state.pausedAt = undefined
        state.finishedAt = undefined
        state.didNotFinishAt = undefined
        setPosition(payload.position)
        markReadAt()
        break
      case 'pause':
        state.status = 'paused'
        state.pausedAt = event.effectiveAt
        setPosition(payload.position)
        markReadAt()
        break
      case 'location':
        setPosition(payload.position)
        markReadAt()
        break
      case 'session':
        state.sessions.push({
          id: payload.sessionId,
          sourceEventId: event.id,
          startedAt: payload.startedAt,
          endedAt: payload.endedAt,
          activeDurationMs: payload.activeDurationMs,
          ...(payload.startPosition ? { startPosition: payload.startPosition } : {}),
          ...(payload.endPosition ? { endPosition: payload.endPosition } : {}),
        })
        setPosition(payload.endPosition)
        markReadAt(payload.endedAt)
        break
      case 'finish':
        state.status = 'finished'
        state.pausedAt = undefined
        state.finishedAt = event.effectiveAt
        state.didNotFinishAt = undefined
        setPosition(payload.position)
        markReadAt()
        break
      case 'did-not-finish':
        state.status = 'did-not-finish'
        state.pausedAt = undefined
        state.finishedAt = undefined
        state.didNotFinishAt = event.effectiveAt
        setPosition(payload.position)
        markReadAt()
        break
      case 'rating':
        state.rating = {
          value: payload.value,
          sourceEventId: event.id,
          effectiveAt: event.effectiveAt,
        }
        state.lastEventId = event.id
        break
      case 'note':
        state.notes.push({
          text: payload.text,
          sourceEventId: event.id,
          effectiveAt: event.effectiveAt,
        })
        state.lastEventId = event.id
        break
    }
  }

  state.sessions.sort((left, right) =>
    compareInstants(left.startedAt, right.startedAt) || left.id.localeCompare(right.id),
  )
  state.notes.sort((left, right) =>
    compareInstants(left.effectiveAt, right.effectiveAt) ||
    left.sourceEventId.localeCompare(right.sourceEventId),
  )
  return state
}

/** Returns correction-aware evidence in deterministic semantic order for reconciliation adapters. */
export function activeReadingEvents(
  editionId: EditionId,
  events: readonly ReadingEvent[],
): readonly ReadingEvent[] {
  validateProjectionEvents(events)
  const candidates = events.filter((event) => event.editionId === editionId)
  const activeIds = resolveActiveEventIds(candidates)
  return candidates.filter((event) => activeIds.has(event.id)).sort(compareReadingEvents)
}

export function toProgressSnapshot(
  id: ProgressSnapshotId,
  state: ReadingState,
  projectedAt: IsoDateTime,
): ProgressSnapshot {
  return progressSnapshotSchema.parse({
    id,
    editionId: state.editionId,
    ...(state.currentPositionAssetId ? { assetId: state.currentPositionAssetId } : {}),
    status: state.status,
    ...(state.currentPosition ? { position: state.currentPosition } : {}),
    ...(state.currentPosition?.normalizedProgress !== undefined
      ? { normalizedProgress: state.currentPosition.normalizedProgress }
      : {}),
    ...(state.startedAt ? { startedAt: state.startedAt } : {}),
    ...(state.pausedAt ? { pausedAt: state.pausedAt } : {}),
    ...(state.finishedAt ? { finishedAt: state.finishedAt } : {}),
    ...(state.didNotFinishAt ? { didNotFinishAt: state.didNotFinishAt } : {}),
    ...(state.currentPositionEventId ? { sourceEventId: state.currentPositionEventId } : {}),
    projectedAt,
  })
}

function validateProjectionEvents(events: readonly ReadingEvent[]): void {
  const byId = new Map<ReadingEventId, ReadingEvent>()
  events.forEach((event) => {
    if (byId.has(event.id)) throw new Error(`Duplicate reading event ${event.id}`)
    byId.set(event.id, event)
  })
  events.forEach((event) => {
    if (event.kind !== 'correction') return
    event.targetEventIds.forEach((targetId) => {
      const target = byId.get(targetId)
      if (!target) throw new Error(`Missing reading event ${targetId}`)
      if (target.editionId !== event.editionId) {
        throw new Error('Reading event corrections cannot cross Edition boundaries')
      }
    })
  })
}

function resolveActiveEventIds(events: readonly ReadingEvent[]): Set<ReadingEventId> {
  const candidates = new Map(events.map((event) => [event.id, event]))
  const correctionsByTarget = new Map<ReadingEventId, ReadingEvent[]>()
  events.forEach((event) => {
    if (event.kind !== 'correction') return
    event.targetEventIds.forEach((targetId) => {
      if (!candidates.has(targetId)) return
      const corrections = correctionsByTarget.get(targetId) ?? []
      corrections.push(event)
      correctionsByTarget.set(targetId, corrections)
    })
  })

  const memo = new Map<ReadingEventId, boolean>()
  const visiting = new Set<ReadingEventId>()
  function isActive(eventId: ReadingEventId): boolean {
    const known = memo.get(eventId)
    if (known !== undefined) return known
    if (visiting.has(eventId)) throw new Error(`Correction cycle detected at ${eventId}`)
    visiting.add(eventId)
    const active = !(correctionsByTarget.get(eventId) ?? []).some((event) => isActive(event.id))
    visiting.delete(eventId)
    memo.set(eventId, active)
    return active
  }

  return new Set(events.filter((event) => isActive(event.id)).map((event) => event.id))
}

function compareReadingEvents(left: ReadingEvent, right: ReadingEvent): number {
  return (
    compareInstants(left.effectiveAt, right.effectiveAt) ||
    compareInstants(left.observedAt, right.observedAt) ||
    compareInstants(left.recordedAt, right.recordedAt) ||
    left.id.localeCompare(right.id)
  )
}

function compareInstants(left: IsoDateTime, right: IsoDateTime): number {
  return timestamp(left) - timestamp(right)
}

function timestamp(value: IsoDateTime): number {
  return Date.parse(value)
}

/** Every ledger event is private by default; export code must select an explicit profile. */
export const readingEventPrivacyPolicy = {
  start: privacy('private-activity', 'include', 'exclude'),
  resume: privacy('private-activity', 'include', 'exclude'),
  pause: privacy('private-activity', 'include', 'exclude'),
  location: privacy('private-activity', 'include', 'exclude'),
  session: privacy('private-activity', 'include', 'exclude'),
  finish: privacy('private-activity', 'include', 'exclude'),
  'did-not-finish': privacy('private-activity', 'include', 'exclude'),
  rating: privacy('private-opinion', 'include', 'exclude'),
  note: privacy('private-content', 'include', 'redact'),
  import: privacy('operational-provenance', 'include', 'exclude'),
  sync: privacy('operational-provenance', 'exclude', 'exclude'),
  correction: privacy('operational-provenance', 'include', 'exclude'),
} as const satisfies Record<
  ReadingEventKind,
  {
    readonly classification:
      | 'private-activity'
      | 'private-opinion'
      | 'private-content'
      | 'operational-provenance'
    readonly fullBackup: 'include'
    readonly portableExport: 'include' | 'exclude'
    readonly shareSafeExport: 'exclude' | 'redact'
  }
>

function privacy<
  const Classification extends
    | 'private-activity'
    | 'private-opinion'
    | 'private-content'
    | 'operational-provenance',
  const Portable extends 'include' | 'exclude',
  const ShareSafe extends 'exclude' | 'redact',
>(classification: Classification, portableExport: Portable, shareSafeExport: ShareSafe) {
  return { classification, fullBackup: 'include' as const, portableExport, shareSafeExport }
}

/** Returns every native position carried by an event, including correction replacements. */
export function readingPositionsInEvent(event: ReadingEvent): readonly ReadingPosition[] {
  const payload =
    event.kind === 'correction'
      ? event.action.kind === 'replace'
        ? event.action.replacement
        : undefined
      : event.kind === 'import' ||
          event.kind === 'sync' ||
          event.kind === 'rating' ||
          event.kind === 'note'
        ? undefined
        : event
  if (!payload) return []
  if (payload.kind === 'session') {
    return [payload.startPosition, payload.endPosition].filter(
      (position): position is ReadingPosition => position !== undefined,
    )
  }
  if (payload.kind === 'rating' || payload.kind === 'note') return []
  return payload.position ? [payload.position] : []
}
