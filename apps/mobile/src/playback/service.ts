import type { PluginListenerHandle } from '@capacitor/core'
import type { SqlDatabase } from '../storage/database'
import { nativePlayback, type WovenleafPlaybackPlugin } from './bridge'
import {
  AudiobookPlaybackError,
  PLAYBACK_RECOVERY_POSITION_BOUND_MS,
  commandId,
  isNewerPlaybackSnapshot,
  nativePlaybackEventSchema,
  playbackCapabilitiesSchema,
  playbackSnapshotSchema,
  type NativePlaybackEvent,
  type PlaybackCapabilities,
  type PlaybackSnapshot,
} from './model'
import { AudiobookPlaybackRepository } from './repository'
import {
  AudiobookProgressRepository,
  PLAYBACK_CHECKPOINT_WALL_THROTTLE_MS,
} from './progress'

export type PlaybackJournalConsumer = (
  events: readonly NativePlaybackEvent[],
) => Promise<readonly string[] | void>

export class AudiobookPlaybackService {
  readonly #repository: AudiobookPlaybackRepository
  readonly #progress: AudiobookProgressRepository
  readonly #plugin: WovenleafPlaybackPlugin
  readonly #listeners = new Set<(snapshot: PlaybackSnapshot) => void>()
  #snapshot?: PlaybackSnapshot
  #handles: PluginListenerHandle[] = []
  #journalConsumer?: PlaybackJournalConsumer
  #draining?: Promise<void>
  #progressQueue: Promise<void> = Promise.resolve()
  #queuedCheckpoints = new Map<string, Pick<PlaybackSnapshot, 'absolutePositionMs' | 'observedAt'>>()

  constructor(
    database: SqlDatabase,
    options: {
      readonly plugin?: WovenleafPlaybackPlugin
      readonly journalConsumer?: PlaybackJournalConsumer
      readonly progressRepository?: AudiobookProgressRepository
    } = {},
  ) {
    this.#repository = new AudiobookPlaybackRepository(database)
    this.#progress = options.progressRepository ?? new AudiobookProgressRepository(database)
    this.#plugin = options.plugin ?? nativePlayback
    this.#journalConsumer = options.journalConsumer
  }

  get snapshot(): PlaybackSnapshot | undefined {
    return this.#snapshot
  }

  subscribe(listener: (snapshot: PlaybackSnapshot) => void): () => void {
    this.#listeners.add(listener)
    if (this.#snapshot) listener(this.#snapshot)
    return () => this.#listeners.delete(listener)
  }

  async connect(): Promise<PlaybackSnapshot> {
    if (!this.#handles.length) {
      this.#handles = [
        await this.#plugin.addListener('snapshotChanged', (candidate) => {
          const snapshot = this.#accept(candidate)
          void this.#checkpoint(snapshot).catch(() => {
            // The native journal remains authoritative and will retry on the next drain/connect.
          })
        }),
        await this.#plugin.addListener('eventsAvailable', () => {
          void this.drainJournal()
        }),
      ]
    }
    const snapshot = this.#accept(await this.#plugin.getSnapshot(), true)
    await this.drainJournal()
    await this.#checkpoint(snapshot, true)
    return snapshot
  }

  async disconnect(): Promise<void> {
    await this.flush()
    const handles = this.#handles
    this.#handles = []
    await Promise.all(handles.map((handle) => handle.remove()))
  }

  async capabilities(): Promise<PlaybackCapabilities> {
    return playbackCapabilitiesSchema.parse(await this.#plugin.getCapabilities())
  }

  async loadBook(bookId: string): Promise<PlaybackSnapshot> {
    const queue = await this.#repository.queueForBook(bookId)
    if (!queue) throw new AudiobookPlaybackError('notFound', 'No playable audiobook is attached to this book.')
    return this.#run((command) => this.#plugin.loadQueue({ ...queue, ...command }), 'load')
  }

  play(): Promise<PlaybackSnapshot> {
    return this.#run((command) => this.#plugin.play(command), 'play')
  }

  pause(): Promise<PlaybackSnapshot> {
    return this.#run((command) => this.#plugin.pause(command), 'pause')
  }

  stop(): Promise<PlaybackSnapshot> {
    return this.#run((command) => this.#plugin.stop(command), 'stop')
  }

  seekToAbsolute(positionMs: number): Promise<PlaybackSnapshot> {
    return this.#run((command) => this.#plugin.seekToAbsolute({ ...command, positionMs }), 'seek')
  }

  seekBy(offsetMs: number): Promise<PlaybackSnapshot> {
    return this.#run((command) => this.#plugin.seekBy({ ...command, offsetMs }), 'seek')
  }

  nextChapter(): Promise<PlaybackSnapshot> {
    return this.#run((command) => this.#plugin.nextChapter(command), 'next-chapter')
  }

  previousChapter(): Promise<PlaybackSnapshot> {
    return this.#run((command) => this.#plugin.previousChapter(command), 'previous-chapter')
  }

  setRate(rate: number): Promise<PlaybackSnapshot> {
    return this.#run((command) => this.#plugin.setRate({ ...command, rate }), 'rate')
  }

  setSleepTimer(durationMs: number): Promise<PlaybackSnapshot> {
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      return Promise.reject(new AudiobookPlaybackError(
        'commandRejected',
        'The sleep timer duration must be greater than zero.',
      ))
    }
    return this.#run(
      (command) => this.#plugin.setSleepTimer({ ...command, mode: 'duration', durationMs }),
      'sleep-timer',
    )
  }

  setSleepTimerAtChapterEnd(): Promise<PlaybackSnapshot> {
    return this.#run(
      (command) => this.#plugin.setSleepTimer({ ...command, mode: 'chapter-end' }),
      'sleep-timer',
    )
  }

  cancelSleepTimer(): Promise<PlaybackSnapshot> {
    return this.#run((command) => this.#plugin.cancelSleepTimer(command), 'cancel-sleep-timer')
  }

  adoptPosition(positionMs: number, provenanceEventId: string): Promise<PlaybackSnapshot> {
    return this.#run(
      (command) => this.#plugin.adoptPosition({ ...command, positionMs, provenanceEventId }),
      'adopt-position',
    )
  }

  async flush(): Promise<void> {
    const snapshot = this.#accept(await this.#plugin.getSnapshot(), true)
    await this.drainJournal()
    await this.#checkpoint(snapshot, true)
  }

  setSystemSurfacePrivacy(previewEnabled: boolean): Promise<PlaybackSnapshot> {
    return this.#plugin.setSystemSurfacePrivacy({ previewEnabled }).then((snapshot) => this.#accept(snapshot, true))
  }

  async drainJournal(): Promise<void> {
    if (this.#draining) return this.#draining
    this.#draining = this.#drainJournal()
    try {
      await this.#draining
    } finally {
      this.#draining = undefined
    }
  }

  async #drainJournal(): Promise<void> {
    while (true) {
      const { events: candidates } = await this.#plugin.drainJournal()
      const events = candidates.map((event) => nativePlaybackEventSchema.parse(event))
      if (!events.length) return
      const consumed = this.#journalConsumer
        ? await this.#journalConsumer(events)
        : await this.#runProgress(() => this.#progress.ingestJournal(events))
      const availableIds = new Set(events.map(({ id }) => id))
      const ids = [...new Set(consumed ?? availableIds)].filter((id) => availableIds.has(id))
      if (!ids.length) return
      await this.#plugin.acknowledgeJournal({ ids })
      if (ids.length < events.length) return
    }
  }

  async #run(
    invoke: (command: { readonly commandId: string; readonly expectedRevision: number }) => Promise<PlaybackSnapshot>,
    prefix: string,
  ): Promise<PlaybackSnapshot> {
    if (!this.#snapshot) await this.connect()
    const expectedRevision = this.#snapshot?.revision ?? 0
    try {
      const result = await invoke({ commandId: commandId(`playback-${prefix}`), expectedRevision })
      const snapshot = this.#accept(result, true)
      await this.drainJournal()
      await this.#checkpoint(snapshot, true)
      return snapshot
    } catch (error) {
      const current = this.#accept(await this.#plugin.getSnapshot(), true)
      if (current.error) {
        throw new AudiobookPlaybackError(current.error.code, current.error.message, {
          cause: error,
          recoverable: current.error.recoverable,
        })
      }
      if (current.revision !== expectedRevision) {
        throw new AudiobookPlaybackError(
          'staleSnapshot',
          'Playback changed from another system control. The authoritative state has been refreshed.',
          { cause: error, recoverable: true },
        )
      }
      throw error
    }
  }

  #accept(candidate: PlaybackSnapshot, force = false): PlaybackSnapshot {
    const snapshot = playbackSnapshotSchema.parse(candidate)
    if (force || isNewerPlaybackSnapshot(this.#snapshot, snapshot)) {
      this.#snapshot = snapshot
      this.#listeners.forEach((listener) => listener(snapshot))
    }
    return this.#snapshot ?? snapshot
  }

  #runProgress<Result>(work: () => Promise<Result>): Promise<Result> {
    const result = this.#progressQueue.then(work)
    this.#progressQueue = result.then(() => undefined, () => undefined)
    return result
  }

  #checkpoint(snapshot: PlaybackSnapshot, force = false): Promise<unknown> {
    if (!snapshot.playbackSessionId) return Promise.resolve('ignored')
    const previous = this.#queuedCheckpoints.get(snapshot.playbackSessionId)
    if (
      !force &&
      previous &&
      Date.parse(snapshot.observedAt) - Date.parse(previous.observedAt) < PLAYBACK_CHECKPOINT_WALL_THROTTLE_MS &&
      Math.abs(snapshot.absolutePositionMs - previous.absolutePositionMs) < PLAYBACK_RECOVERY_POSITION_BOUND_MS
    ) return Promise.resolve('throttled')
    this.#queuedCheckpoints.set(snapshot.playbackSessionId, {
      absolutePositionMs: snapshot.absolutePositionMs,
      observedAt: snapshot.observedAt,
    })
    return this.#runProgress(() => this.#progress.checkpointSnapshot(snapshot, force))
  }
}
