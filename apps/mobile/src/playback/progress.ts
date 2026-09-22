import { recordReadingAdvance } from '../widgets/activity'
import {
  assetIdSchema,
  activeReadingEvents,
  conflictItemSchema,
  editionIdSchema,
  evaluateConflict,
  progressSnapshotIdSchema,
  readingDeviceIdSchema,
  readingEventIdSchema,
  readingEventSchema,
  readingPositionsInEvent,
  readingSessionIdSchema,
  sourceAdapterSchema,
  type ConflictCandidate,
  type ProgressSnapshot,
  type ReadingEvent,
  type ReadingPosition,
  type SourceAdapter,
} from '../domain/catalog'
import { appendReadingLedgerBatch } from '../storage/catalog-repository'
import type { SqlDatabase, SqlRow } from '../storage/database'
import { readNumber, readText } from '../storage/database'
import { immutablePlaybackManifest } from '../audiobooks/manifest'
import type { PlaybackManifest } from '../audiobooks/model'
import { libraryBookSchema } from '../library-model'
import { writeLibraryBook } from '../storage/library-repository'
import {
  PLAYBACK_RECOVERY_POSITION_BOUND_MS,
  type NativePlaybackEvent,
  type PlaybackSnapshot,
} from './model'

export const PLAYBACK_CHECKPOINT_WALL_THROTTLE_MS = 10_000

type AudiobookBinding = {
  readonly bookId: string
  readonly editionId: ReturnType<typeof editionIdSchema.parse>
  readonly assetId: ReturnType<typeof assetIdSchema.parse>
  readonly manifest: PlaybackManifest
}

type CheckpointState = {
  readonly playbackSessionId: string
  engineEpoch: string
  readonly queueId: string
  readonly bookId: string
  readonly editionId: ReturnType<typeof editionIdSchema.parse>
  readonly assetId: ReturnType<typeof assetIdSchema.parse>
  lastSequence: number
  lastRevision: number
  absolutePositionMs: number
  chapterId: string | null
  segmentId: string | null
  activeDurationMs: number
  rate: number
  transportState: string
  observedAt: string
  recordedAt: string
  intervalStartedAt: string | null
  intervalStartPositionMs: number | null
  intervalStartChapterId: string | null
  intervalStartActiveDurationMs: number | null
}

type CheckpointRow = SqlRow & {
  readonly playback_session_id: string
  readonly engine_epoch: string
  readonly queue_id: string
  readonly book_id: string
  readonly edition_id: string
  readonly asset_id: string
  readonly last_sequence: number
  readonly last_revision: number
  readonly absolute_position_ms: number
  readonly chapter_id: string | null
  readonly segment_id: string | null
  readonly active_duration_ms: number
  readonly rate: number
  readonly transport_state: string
  readonly observed_at: string
  readonly recorded_at: string
  readonly interval_started_at: string | null
  readonly interval_start_position_ms: number | null
  readonly interval_start_chapter_id: string | null
  readonly interval_start_active_duration_ms: number | null
}

type BindingRow = SqlRow & {
  readonly book_id: string
  readonly edition_id: string
  readonly content_asset_id: string
  readonly manifest_json: string
}

export type AudiobookProgressCheckpoint = Pick<
  CheckpointState,
  | 'playbackSessionId'
  | 'queueId'
  | 'bookId'
  | 'editionId'
  | 'assetId'
  | 'lastSequence'
  | 'lastRevision'
  | 'absolutePositionMs'
  | 'chapterId'
  | 'segmentId'
  | 'activeDurationMs'
  | 'rate'
  | 'transportState'
  | 'observedAt'
>

export type AudiobookPositionResolution =
  | {
      readonly status: 'resolved'
      readonly positionMs: number
      readonly selectedCandidateId: string
      readonly sourceEventId?: string
      readonly explanation: string
    }
  | {
      readonly status: 'review'
      readonly explanation: string
    }

const closingKinds = new Set<NativePlaybackEvent['kind']>([
  'pause',
  'interruption',
  'route-loss',
  'sleep-expired',
  'stop',
  'end',
  'failure',
])

const startingKinds = new Set<NativePlaybackEvent['kind']>(['play', 'resume'])

export class AudiobookProgressRepository {
  readonly #database: SqlDatabase
  readonly #now: () => Date

  constructor(database: SqlDatabase, options: { readonly now?: () => Date } = {}) {
    this.#database = database
    this.#now = options.now ?? (() => new Date())
  }

  async ingestJournal(candidates: readonly NativePlaybackEvent[]): Promise<readonly string[]> {
    const events = [...candidates].sort((left, right) =>
      left.playbackSessionId.localeCompare(right.playbackSessionId) || left.sequence - right.sequence,
    )
    if (!events.length) return []

    return this.#database.transaction(async (database) => {
      const bindings = new Map<string, AudiobookBinding | undefined>()
      const checkpoints = new Map<string, CheckpointState | undefined>()
      const canonicalEvents: ReadingEvent[] = []
      const snapshotByAsset = new Map<string, ProgressSnapshot>()
      const libraryProgress = new Map<string, {
        readonly fraction: number
        readonly observedAt: string
        readonly startedAt: string
      }>()
      const consumed: string[] = []

      for (const event of events) {
        let binding = bindings.get(event.queueId)
        if (!bindings.has(event.queueId)) {
          binding = await bindingForQueue(database, event.queueId)
          bindings.set(event.queueId, binding)
        }
        if (!binding) continue

        let checkpoint = checkpoints.get(event.playbackSessionId)
        if (!checkpoints.has(event.playbackSessionId)) {
          checkpoint = await checkpointForSession(database, event.playbackSessionId)
          checkpoints.set(event.playbackSessionId, checkpoint)
        }
        if (checkpoint && event.sequence <= checkpoint.lastSequence) {
          consumed.push(event.id)
          continue
        }

        const recordedAt = this.#now().toISOString()
        checkpoint ??= checkpointFromEvent(event, binding, recordedAt)
        const position = audioPosition(
          event.afterPositionMs ?? checkpoint.absolutePositionMs,
          binding.manifest,
          event.chapterId,
          event.segmentId,
          event.confidence,
        )

        if (startingKinds.has(event.kind) && checkpoint.intervalStartedAt === null) {
          checkpoint.intervalStartedAt = event.observedAt
          checkpoint.intervalStartPositionMs = event.afterPositionMs ?? checkpoint.absolutePositionMs
          checkpoint.intervalStartChapterId = event.chapterId
          checkpoint.intervalStartActiveDurationMs = event.activeDurationMs
        }
        const hasListening = checkpoint.intervalStartedAt !== null || event.activeDurationMs > 0
        const startedAt = checkpoint.intervalStartedAt ?? event.observedAt

        const positionEvent = playbackPositionEvent(
          event,
          binding,
          position,
          recordedAt,
          closingKinds.has(event.kind) ? 'pause' : startingKinds.has(event.kind) ? 'resume' : 'location',
        )
        if (!await readingEventExists(database, positionEvent.id)) canonicalEvents.push(positionEvent)

        if (closingKinds.has(event.kind)) {
          const session = completedSessionEvent(event, binding, checkpoint, position, recordedAt)
          if (session && !await readingEventExists(database, session.id)) canonicalEvents.push(session)
          clearInterval(checkpoint)
        }

        if (hasListening && event.afterPositionMs !== null && event.afterPositionMs !== undefined) {
          await recordReadingAdvance(database, {
            id: `reading-activity:audio:${event.id}`, bookId: binding.bookId,
            occurredAt: event.observedAt, source: 'audio-player',
            before: checkpoint.absolutePositionMs, after: event.afterPositionMs,
          })
        }

        checkpoint.engineEpoch = event.engineEpoch
        checkpoint.lastSequence = event.sequence
        checkpoint.lastRevision = event.revision
        checkpoint.absolutePositionMs = event.afterPositionMs ?? checkpoint.absolutePositionMs
        checkpoint.chapterId = event.chapterId
        checkpoint.segmentId = event.segmentId
        checkpoint.activeDurationMs = Math.max(checkpoint.activeDurationMs, event.activeDurationMs)
        checkpoint.rate = event.rate
        checkpoint.transportState = transportStateAfter(event.kind, checkpoint.transportState)
        checkpoint.observedAt = event.observedAt
        checkpoint.recordedAt = recordedAt
        checkpoints.set(event.playbackSessionId, checkpoint)

        snapshotByAsset.set(binding.assetId, progressSnapshot(
          binding,
          positionEvent,
          position,
          checkpoint.transportState,
          event.observedAt,
        ))
        if (hasListening && position.normalizedProgress !== undefined) {
          const current = libraryProgress.get(binding.bookId)
          if (!current || Date.parse(event.observedAt) >= Date.parse(current.observedAt)) {
            libraryProgress.set(binding.bookId, {
              fraction: position.normalizedProgress,
              observedAt: event.observedAt,
              startedAt: current?.startedAt ?? startedAt,
            })
          }
        }
        consumed.push(event.id)
      }

      if (canonicalEvents.length || snapshotByAsset.size) {
        await appendReadingLedgerBatch(database, {
          events: canonicalEvents,
          snapshots: [...snapshotByAsset.values()],
        })
      }
      for (const checkpoint of checkpoints.values()) {
        if (checkpoint) await saveCheckpoint(database, checkpoint)
      }
      for (const [bookId, progress] of libraryProgress) {
        await updateLibraryProgress(database, bookId, progress.fraction, progress.observedAt, progress.startedAt)
      }
      return consumed
    })
  }

  async checkpointSnapshot(snapshot: PlaybackSnapshot, force = false): Promise<'saved' | 'throttled' | 'ignored'> {
    if (!snapshot.queueId || !snapshot.playbackSessionId) return 'ignored'
    const binding = await bindingForQueue(this.#database, snapshot.queueId)
    if (!binding) return 'ignored'

    // The terminal state is authoritative even if the decoder stops short of the manifest duration.
    if (snapshot.state === 'ended') {
      snapshot = { ...snapshot, absolutePositionMs: binding.manifest.segments.at(-1)?.absoluteEndMs ?? 0 }
    }

    return this.#database.transaction(async (database) => {
      const existing = await checkpointForSession(database, snapshot.playbackSessionId!)
      if (
        existing &&
        existing.engineEpoch === snapshot.engineEpoch &&
        snapshot.revision < existing.lastRevision
      ) return 'ignored'

      const elapsed = existing
        ? Math.max(0, Date.parse(snapshot.observedAt) - Date.parse(existing.observedAt))
        : Number.POSITIVE_INFINITY
      const mediaDelta = existing
        ? Math.abs(snapshot.absolutePositionMs - existing.absolutePositionMs)
        : Number.POSITIVE_INFINITY
      if (
        !force &&
        !(snapshot.state === 'ended' && existing?.transportState !== 'ended') &&
        elapsed < PLAYBACK_CHECKPOINT_WALL_THROTTLE_MS &&
        mediaDelta < PLAYBACK_RECOVERY_POSITION_BOUND_MS
      ) return 'throttled'

      const recordedAt = this.#now().toISOString()
      const checkpoint = existing ?? checkpointFromSnapshot(snapshot, binding, recordedAt)
      const hasListening = snapshot.state === 'playing' || snapshot.state === 'ended'
        || checkpoint.intervalStartedAt !== null
        || snapshot.activeDurationMs > 0
      const startedAt = checkpoint.intervalStartedAt ?? snapshot.observedAt
      const canonicalEvents: ReadingEvent[] = []
      if (
        checkpoint.intervalStartedAt !== null &&
        snapshot.state !== 'playing' &&
        snapshot.state !== 'buffering'
      ) {
        const recovered = recoveredSnapshotEvents(snapshot, binding, checkpoint, recordedAt)
        for (const event of recovered) {
          if (!await readingEventExists(database, event.id)) canonicalEvents.push(event)
        }
        clearInterval(checkpoint)
      }

      if (hasListening && existing) {
        await recordReadingAdvance(database, {
          id: `reading-activity:audio:${snapshot.playbackSessionId}:${snapshot.engineEpoch}:${snapshot.revision}`,
          bookId: binding.bookId, occurredAt: snapshot.observedAt, source: 'audio-player',
          before: existing.absolutePositionMs, after: snapshot.absolutePositionMs,
        })
      }

      checkpoint.engineEpoch = snapshot.engineEpoch
      checkpoint.lastRevision = snapshot.revision
      checkpoint.absolutePositionMs = snapshot.absolutePositionMs
      checkpoint.chapterId = snapshot.chapterId
      checkpoint.segmentId = snapshot.segmentId
      checkpoint.activeDurationMs = Math.max(checkpoint.activeDurationMs, snapshot.activeDurationMs)
      checkpoint.rate = snapshot.rate
      checkpoint.transportState = snapshot.state
      checkpoint.observedAt = snapshot.observedAt
      checkpoint.recordedAt = recordedAt

      if (hasListening) {
        const position = audioPosition(
          snapshot.absolutePositionMs,
          binding.manifest,
          snapshot.chapterId,
          snapshot.segmentId,
          snapshot.suppressionReason === 'process-recreated' ? 0.75 : 1,
        )
        const source = canonicalEvents[0] ?? readingEventSchema.parse({
          id: readingEventIdSchema.parse(`reading-event:audio:checkpoint:${safeId(snapshot.playbackSessionId!)}:${safeId(snapshot.engineEpoch)}:${snapshot.revision}`),
          editionId: binding.editionId,
          assetId: binding.assetId,
          source: { kind: 'local', method: 'audio-player' },
          deviceId: playbackDeviceId(snapshot.engineEpoch),
          observedAt: snapshot.observedAt,
          effectiveAt: snapshot.observedAt,
          recordedAt,
          timeConfidence: snapshot.suppressionReason === 'process-recreated' ? 0.75 : 1,
          kind: 'location',
          position,
        })
        if (!canonicalEvents.length && !await readingEventExists(database, source.id)) canonicalEvents.push(source)
        await appendReadingLedgerBatch(database, {
          events: canonicalEvents,
          snapshots: [progressSnapshot(binding, source, position, snapshot.state, snapshot.observedAt)],
        })
      }
      await saveCheckpoint(database, checkpoint)
      if (hasListening && binding.manifest.segments.at(-1)?.absoluteEndMs) {
        await updateLibraryProgress(
          database,
          binding.bookId,
          snapshot.absolutePositionMs / binding.manifest.segments.at(-1)!.absoluteEndMs,
          snapshot.observedAt,
          startedAt,
        )
      }
      return 'saved'
    })
  }

  async checkpointForBook(bookId: string): Promise<AudiobookProgressCheckpoint | undefined> {
    const [row] = await this.#database.query<CheckpointRow>(
      `${checkpointSelect}
       WHERE book_id = ?
       ORDER BY observed_at DESC, playback_session_id DESC
       LIMIT 1`,
      [bookId],
    )
    return row ? publicCheckpoint(checkpointFromRow(row)) : undefined
  }

  async resolvePositionForBook(bookId: string): Promise<AudiobookPositionResolution | undefined> {
    const binding = await bindingForBook(this.#database, bookId)
    if (!binding) return undefined
    const durationMs = binding.manifest.segments.at(-1)?.absoluteEndMs ?? 0
    if (durationMs <= 0) return undefined

    const [rows, checkpoint] = await Promise.all([
      this.#database.query<{ readonly payload_json: string }>(
        `SELECT payload_json FROM reading_events
         WHERE edition_id = ?
         ORDER BY effective_at DESC, observed_at DESC, recorded_at DESC, id DESC`,
        [binding.editionId],
      ),
      this.checkpointForBook(bookId),
    ])
    const ledgerEvents = rows.map((row) =>
      readingEventSchema.parse(JSON.parse(readText(row, 'payload_json'))),
    )
    const latestBySource = new Map<SourceAdapter, ConflictCandidate & { readonly sourceEventId?: string }>()
    for (const event of [...activeReadingEvents(binding.editionId, ledgerEvents)].reverse()) {
      const position = readingPositionsInEvent(event).at(-1)
      const positionMs = audioMilliseconds(position, durationMs)
      const source = conflictSource(event)
      if (positionMs === undefined || !source || latestBySource.has(source.adapter)) continue
      latestBySource.set(source.adapter, candidate(
        binding.editionId,
        event.id,
        positionMs,
        source.adapter,
        source.evidence,
        event.observedAt,
        event.timeConfidence,
        `Reading ledger ${event.source.kind} position.`,
      ))
    }
    if (checkpoint) {
      const current = latestBySource.get('wovenleaf-audio-player')
      if (!current || Date.parse(checkpoint.observedAt) >= Date.parse(current.observedAt)) {
        latestBySource.set('wovenleaf-audio-player', candidate(
          binding.editionId,
          `checkpoint:${checkpoint.playbackSessionId}`,
          checkpoint.absolutePositionMs,
          'wovenleaf-audio-player',
          'authoritative',
          checkpoint.observedAt,
          1,
          'Latest durable first-party playback checkpoint.',
        ))
      }
    }

    const candidates = [...latestBySource.values()]
    if (!candidates.length) return undefined
    if (candidates.length === 1) {
      const selected = candidates[0]!
      if (!['wovenleaf-audio-player', 'local-manual'].includes(selected.source)) {
        return {
          status: 'review',
          explanation: 'External progress remains a proposal until the reader explicitly adopts it.',
        }
      }
      return {
        status: 'resolved',
        positionMs: clampPosition(Number(selected.value), durationMs),
        selectedCandidateId: selected.id,
        ...(selected.sourceEventId ? { sourceEventId: selected.sourceEventId } : {}),
        explanation: selected.explanation,
      }
    }

    const resolution = evaluateConflict(conflictItemSchema.parse({
      id: `conflict:audiobook-progress:${safeId(binding.editionId)}`,
      domain: 'progress',
      subject: { type: 'reading-state', id: `reading-state:${binding.editionId}` },
      field: 'reading-state.audioPositionMs',
      candidates,
      reason: 'Manual, imported, synchronized, and first-party positions disagree.',
    }))
    if (resolution.status === 'review' || typeof resolution.value !== 'number') {
      return { status: 'review', explanation: resolution.explanation }
    }
    const selected = candidates.find(({ id }) => id === resolution.selectedCandidateId)
    return {
      status: 'resolved',
      positionMs: clampPosition(resolution.value, durationMs),
      selectedCandidateId: resolution.selectedCandidateId ?? selected?.id ?? candidates[0]!.id,
      ...(selected?.sourceEventId ? { sourceEventId: selected.sourceEventId } : {}),
      explanation: resolution.explanation,
    }
  }
}

async function bindingForQueue(database: SqlDatabase, queueId: string): Promise<AudiobookBinding | undefined> {
  const [row] = await database.query<BindingRow>(
    `SELECT book_id, edition_id, content_asset_id, manifest_json
     FROM audiobook_imports
     WHERE json_extract(manifest_json, '$.queueId') = ?
     ORDER BY imported_at DESC, id DESC
     LIMIT 1`,
    [queueId],
  )
  return row ? bindingFromRow(row) : undefined
}

async function bindingForBook(database: SqlDatabase, bookId: string): Promise<AudiobookBinding | undefined> {
  const [row] = await database.query<BindingRow>(
    `SELECT book_id, edition_id, content_asset_id, manifest_json
     FROM audiobook_imports
     WHERE book_id = ?
     ORDER BY imported_at DESC, id DESC
     LIMIT 1`,
    [bookId],
  )
  return row ? bindingFromRow(row) : undefined
}

function bindingFromRow(row: BindingRow): AudiobookBinding {
  return {
    bookId: readText(row, 'book_id'),
    editionId: editionIdSchema.parse(readText(row, 'edition_id')),
    assetId: assetIdSchema.parse(readText(row, 'content_asset_id')),
    manifest: immutablePlaybackManifest(JSON.parse(readText(row, 'manifest_json'))),
  }
}

function checkpointFromEvent(
  event: NativePlaybackEvent,
  binding: AudiobookBinding,
  recordedAt: string,
): CheckpointState {
  return {
    playbackSessionId: event.playbackSessionId,
    engineEpoch: event.engineEpoch,
    queueId: event.queueId,
    bookId: binding.bookId,
    editionId: binding.editionId,
    assetId: binding.assetId,
    lastSequence: 0,
    lastRevision: event.revision,
    absolutePositionMs: event.beforePositionMs ?? event.afterPositionMs ?? 0,
    chapterId: event.chapterId,
    segmentId: event.segmentId,
    activeDurationMs: event.activeDurationMs,
    rate: event.rate,
    transportState: 'paused',
    observedAt: event.observedAt,
    recordedAt,
    intervalStartedAt: null,
    intervalStartPositionMs: null,
    intervalStartChapterId: null,
    intervalStartActiveDurationMs: null,
  }
}

function checkpointFromSnapshot(
  snapshot: PlaybackSnapshot,
  binding: AudiobookBinding,
  recordedAt: string,
): CheckpointState {
  return {
    playbackSessionId: snapshot.playbackSessionId!,
    engineEpoch: snapshot.engineEpoch,
    queueId: snapshot.queueId!,
    bookId: binding.bookId,
    editionId: binding.editionId,
    assetId: binding.assetId,
    lastSequence: 0,
    lastRevision: snapshot.revision,
    absolutePositionMs: snapshot.absolutePositionMs,
    chapterId: snapshot.chapterId,
    segmentId: snapshot.segmentId,
    activeDurationMs: snapshot.activeDurationMs,
    rate: snapshot.rate,
    transportState: snapshot.state,
    observedAt: snapshot.observedAt,
    recordedAt,
    intervalStartedAt: null,
    intervalStartPositionMs: null,
    intervalStartChapterId: null,
    intervalStartActiveDurationMs: null,
  }
}

function playbackPositionEvent(
  event: NativePlaybackEvent,
  binding: AudiobookBinding,
  position: ReadingPosition,
  recordedAt: string,
  kind: 'resume' | 'pause' | 'location',
): ReadingEvent {
  return readingEventSchema.parse({
    id: readingEventIdSchema.parse(`reading-event:audio:${safeId(event.id)}:position`),
    editionId: binding.editionId,
    assetId: binding.assetId,
    source: { kind: 'local', method: 'audio-player' },
    deviceId: playbackDeviceId(event.engineEpoch),
    observedAt: event.observedAt,
    effectiveAt: event.observedAt,
    recordedAt,
    timeConfidence: event.confidence,
    kind,
    position,
  })
}

function completedSessionEvent(
  event: NativePlaybackEvent,
  binding: AudiobookBinding,
  checkpoint: CheckpointState,
  endPosition: ReadingPosition,
  recordedAt: string,
): ReadingEvent | undefined {
  if (
    checkpoint.intervalStartedAt === null ||
    checkpoint.intervalStartPositionMs === null ||
    checkpoint.intervalStartActiveDurationMs === null
  ) return undefined
  const activeDurationMs = Math.max(0, event.activeDurationMs - checkpoint.intervalStartActiveDurationMs)
  if (activeDurationMs === 0) return undefined
  return readingEventSchema.parse({
    id: readingEventIdSchema.parse(`reading-event:audio:${safeId(event.id)}:session`),
    editionId: binding.editionId,
    assetId: binding.assetId,
    source: { kind: 'local', method: 'audio-player' },
    deviceId: playbackDeviceId(event.engineEpoch),
    observedAt: event.observedAt,
    effectiveAt: event.observedAt,
    recordedAt,
    timeConfidence: event.confidence,
    kind: 'session',
    sessionId: readingSessionIdSchema.parse(`reading-session:audio:${safeId(event.id)}`),
    startedAt: safeStartedAt(checkpoint.intervalStartedAt, event.observedAt),
    endedAt: event.observedAt,
    activeDurationMs,
    startPosition: audioPosition(
      checkpoint.intervalStartPositionMs,
      binding.manifest,
      checkpoint.intervalStartChapterId,
      null,
      event.confidence,
    ),
    endPosition,
  })
}

function recoveredSnapshotEvents(
  snapshot: PlaybackSnapshot,
  binding: AudiobookBinding,
  checkpoint: CheckpointState,
  recordedAt: string,
): ReadingEvent[] {
  const nativeLike: NativePlaybackEvent = {
    bridgeVersion: snapshot.bridgeVersion,
    id: `playback-snapshot:${snapshot.playbackSessionId}:${snapshot.revision}`,
    sequence: Math.max(1, checkpoint.lastSequence + 1),
    engineEpoch: snapshot.engineEpoch,
    queueId: snapshot.queueId!,
    playbackSessionId: snapshot.playbackSessionId!,
    revision: snapshot.revision,
    kind: 'pause',
    observedAt: snapshot.observedAt,
    activeDurationMs: snapshot.activeDurationMs,
    beforePositionMs: checkpoint.absolutePositionMs,
    afterPositionMs: snapshot.absolutePositionMs,
    rate: snapshot.rate,
    reason: snapshot.suppressionReason,
    confidence: snapshot.suppressionReason === 'process-recreated' ? 0.75 : 1,
    segmentId: snapshot.segmentId,
    chapterId: snapshot.chapterId,
    error: snapshot.error,
  }
  const position = audioPosition(
    snapshot.absolutePositionMs,
    binding.manifest,
    snapshot.chapterId,
    snapshot.segmentId,
    nativeLike.confidence,
  )
  return [
    playbackPositionEvent(nativeLike, binding, position, recordedAt, 'pause'),
    completedSessionEvent(nativeLike, binding, checkpoint, position, recordedAt),
  ].filter((event): event is ReadingEvent => event !== undefined)
}

function progressSnapshot(
  binding: AudiobookBinding,
  source: ReadingEvent,
  position: ReadingPosition,
  transportState: string,
  projectedAt: string,
) {
  const paused = !['playing', 'buffering'].includes(transportState)
  return {
    id: progressSnapshotIdSchema.parse(`progress:audio:${binding.assetId}`),
    editionId: binding.editionId,
    assetId: binding.assetId,
    status: paused ? 'paused' as const : 'reading' as const,
    position,
    normalizedProgress: position.normalizedProgress,
    ...(paused ? { pausedAt: projectedAt } : {}),
    sourceEventId: source.id,
    projectedAt,
  }
}

function audioPosition(
  requestedMs: number,
  manifest: PlaybackManifest,
  chapterId: string | null,
  segmentId: string | null,
  confidence: number,
): ReadingPosition {
  const durationMs = manifest.segments.at(-1)?.absoluteEndMs ?? 0
  const positionMs = clampPosition(requestedMs, durationMs)
  return {
    locator: {
      kind: 'audio-time',
      positionMs,
      ...(chapterId ? { chapterKey: chapterId } : {}),
      ...(segmentId ? { segmentId } : {}),
    },
    ...(durationMs > 0 ? { normalizedProgress: positionMs / durationMs } : {}),
    normalization: durationMs > 0
      ? { kind: 'edition-duration', durationMs, confidence }
      : { kind: 'none', confidence: 0, reason: 'The playback manifest has no duration.' },
  }
}

function audioMilliseconds(position: ReadingPosition | undefined, durationMs: number): number | undefined {
  if (!position) return undefined
  if (position.locator.kind === 'audio-time') return clampPosition(position.locator.positionMs, durationMs)
  if (position.normalizedProgress !== undefined) {
    return clampPosition(Math.round(position.normalizedProgress * durationMs), durationMs)
  }
  return undefined
}

function conflictSource(event: ReadingEvent): {
  readonly adapter: SourceAdapter
  readonly evidence: ConflictCandidate['evidence']
} | undefined {
  if (event.source.kind === 'local') {
    if (event.source.method === 'audio-player') {
      return { adapter: 'wovenleaf-audio-player', evidence: 'authoritative' }
    }
    if (event.source.method === 'manual' || event.source.method === 'quick-capture') {
      return { adapter: 'local-manual', evidence: 'user-corrected' }
    }
    return undefined
  }
  if (event.source.kind === 'migration') {
    return { adapter: 'legacy-migration', evidence: 'observed' }
  }
  const adapter = sourceAdapterSchema.safeParse(event.source.integrationKey)
  return adapter.success ? { adapter: adapter.data, evidence: 'observed' } : undefined
}

function candidate(
  editionId: string,
  sourceId: string,
  positionMs: number,
  source: SourceAdapter,
  evidence: ConflictCandidate['evidence'],
  observedAt: string,
  confidence: number,
  explanation: string,
): ConflictCandidate & { readonly sourceEventId?: string } {
  return {
    id: `conflict-candidate:audio:${safeId(sourceId)}`,
    subject: { type: 'reading-state', id: `reading-state:${editionId}` },
    field: 'reading-state.audioPositionMs',
    value: positionMs,
    source,
    evidence,
    observedAt,
    effectiveAt: observedAt,
    confidence,
    explanation,
    ...(sourceId.startsWith('reading-event:') ? { sourceEventId: sourceId } : {}),
  }
}

function transportStateAfter(kind: NativePlaybackEvent['kind'], current: string): string {
  if (kind === 'play' || kind === 'resume') return 'playing'
  if (kind === 'stop') return 'stopped'
  if (kind === 'end') return 'ended'
  if (kind === 'failure') return 'error'
  if (closingKinds.has(kind)) return 'paused'
  return current
}

function playbackDeviceId(engineEpoch: string) {
  const platform = engineEpoch.startsWith('ios-')
    ? 'ios'
    : engineEpoch.startsWith('android-')
      ? 'android'
      : 'web'
  return readingDeviceIdSchema.parse(`reading-device:${platform}:audio-player`)
}

function clearInterval(checkpoint: CheckpointState): void {
  checkpoint.intervalStartedAt = null
  checkpoint.intervalStartPositionMs = null
  checkpoint.intervalStartChapterId = null
  checkpoint.intervalStartActiveDurationMs = null
}

function clampPosition(positionMs: number, durationMs: number): number {
  return Math.max(0, Math.min(Math.trunc(positionMs), Math.max(0, durationMs)))
}

function safeStartedAt(startedAt: string, endedAt: string): string {
  return Date.parse(startedAt) <= Date.parse(endedAt) ? startedAt : endedAt
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9:._-]/g, '-')
}

async function readingEventExists(database: SqlDatabase, id: string): Promise<boolean> {
  const [row] = await database.query('SELECT id FROM reading_events WHERE id = ? LIMIT 1', [id])
  return row !== undefined
}

const checkpointSelect = `SELECT playback_session_id, engine_epoch, queue_id, book_id,
  edition_id, asset_id, last_sequence, last_revision, absolute_position_ms,
  chapter_id, segment_id, active_duration_ms, rate, transport_state, observed_at,
  recorded_at, interval_started_at, interval_start_position_ms,
  interval_start_chapter_id, interval_start_active_duration_ms
  FROM audiobook_playback_checkpoints`

async function checkpointForSession(
  database: SqlDatabase,
  playbackSessionId: string,
): Promise<CheckpointState | undefined> {
  const [row] = await database.query<CheckpointRow>(
    `${checkpointSelect} WHERE playback_session_id = ? LIMIT 1`,
    [playbackSessionId],
  )
  return row ? checkpointFromRow(row) : undefined
}

function checkpointFromRow(row: CheckpointRow): CheckpointState {
  return {
    playbackSessionId: readText(row, 'playback_session_id'),
    engineEpoch: readText(row, 'engine_epoch'),
    queueId: readText(row, 'queue_id'),
    bookId: readText(row, 'book_id'),
    editionId: editionIdSchema.parse(readText(row, 'edition_id')),
    assetId: assetIdSchema.parse(readText(row, 'asset_id')),
    lastSequence: readNumber(row, 'last_sequence'),
    lastRevision: readNumber(row, 'last_revision'),
    absolutePositionMs: readNumber(row, 'absolute_position_ms'),
    chapterId: nullableText(row.chapter_id),
    segmentId: nullableText(row.segment_id),
    activeDurationMs: readNumber(row, 'active_duration_ms'),
    rate: readNumber(row, 'rate'),
    transportState: readText(row, 'transport_state'),
    observedAt: readText(row, 'observed_at'),
    recordedAt: readText(row, 'recorded_at'),
    intervalStartedAt: nullableText(row.interval_started_at),
    intervalStartPositionMs: nullableNumber(row.interval_start_position_ms),
    intervalStartChapterId: nullableText(row.interval_start_chapter_id),
    intervalStartActiveDurationMs: nullableNumber(row.interval_start_active_duration_ms),
  }
}

async function saveCheckpoint(database: SqlDatabase, checkpoint: CheckpointState): Promise<void> {
  await database.run(
    `INSERT INTO audiobook_playback_checkpoints(
       playback_session_id, engine_epoch, queue_id, book_id, edition_id, asset_id,
       last_sequence, last_revision, absolute_position_ms, chapter_id, segment_id,
       active_duration_ms, rate, transport_state, observed_at, recorded_at,
       interval_started_at, interval_start_position_ms, interval_start_chapter_id,
       interval_start_active_duration_ms
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(playback_session_id) DO UPDATE SET
       engine_epoch = excluded.engine_epoch,
       queue_id = excluded.queue_id,
       book_id = excluded.book_id,
       edition_id = excluded.edition_id,
       asset_id = excluded.asset_id,
       last_sequence = excluded.last_sequence,
       last_revision = excluded.last_revision,
       absolute_position_ms = excluded.absolute_position_ms,
       chapter_id = excluded.chapter_id,
       segment_id = excluded.segment_id,
       active_duration_ms = excluded.active_duration_ms,
       rate = excluded.rate,
       transport_state = excluded.transport_state,
       observed_at = excluded.observed_at,
       recorded_at = excluded.recorded_at,
       interval_started_at = excluded.interval_started_at,
       interval_start_position_ms = excluded.interval_start_position_ms,
       interval_start_chapter_id = excluded.interval_start_chapter_id,
       interval_start_active_duration_ms = excluded.interval_start_active_duration_ms`,
    [
      checkpoint.playbackSessionId,
      checkpoint.engineEpoch,
      checkpoint.queueId,
      checkpoint.bookId,
      checkpoint.editionId,
      checkpoint.assetId,
      checkpoint.lastSequence,
      checkpoint.lastRevision,
      checkpoint.absolutePositionMs,
      checkpoint.chapterId,
      checkpoint.segmentId,
      checkpoint.activeDurationMs,
      checkpoint.rate,
      checkpoint.transportState,
      checkpoint.observedAt,
      checkpoint.recordedAt,
      checkpoint.intervalStartedAt,
      checkpoint.intervalStartPositionMs,
      checkpoint.intervalStartChapterId,
      checkpoint.intervalStartActiveDurationMs,
    ],
  )
}

function publicCheckpoint(checkpoint: CheckpointState): AudiobookProgressCheckpoint {
  return {
    playbackSessionId: checkpoint.playbackSessionId,
    queueId: checkpoint.queueId,
    bookId: checkpoint.bookId,
    editionId: checkpoint.editionId,
    assetId: checkpoint.assetId,
    lastSequence: checkpoint.lastSequence,
    lastRevision: checkpoint.lastRevision,
    absolutePositionMs: checkpoint.absolutePositionMs,
    chapterId: checkpoint.chapterId,
    segmentId: checkpoint.segmentId,
    activeDurationMs: checkpoint.activeDurationMs,
    rate: checkpoint.rate,
    transportState: checkpoint.transportState,
    observedAt: checkpoint.observedAt,
  }
}

function nullableText(value: string | number | null): string | null {
  return typeof value === 'string' ? value : null
}

function nullableNumber(value: string | number | null): number | null {
  return typeof value === 'number' ? value : null
}

async function updateLibraryProgress(
  database: SqlDatabase,
  bookId: string,
  fraction: number,
  observedAt: string,
  startedAt: string,
): Promise<void> {
  const [row] = await database.query('SELECT payload_json FROM library_books WHERE id = ? LIMIT 1', [bookId])
  if (!row) return
  const book = libraryBookSchema.parse(JSON.parse(readText(row, 'payload_json')))
  if (book.shelf === 'finished' || book.shelf === 'dnf' || Date.parse(book.lastUpdatedAt) > Date.parse(observedAt)) return
  await writeLibraryBook(database, {
    ...book,
    shelf: 'reading',
    progress: fraction >= 1 ? 100 : Math.max(0, Math.min(99, Math.round(fraction * 100))),
    startedAt: book.startedAt ?? startedAt,
    lastUpdatedAt: observedAt,
  })
}
