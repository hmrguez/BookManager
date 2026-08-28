import type { PluginListenerHandle } from '@capacitor/core'
import type { SqlDatabase } from '../storage/database'
import { nativePlayback, type WovenleafPlaybackPlugin } from './bridge'
import {
  AudiobookPlaybackError,
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

export type PlaybackJournalConsumer = (
  events: readonly NativePlaybackEvent[],
) => Promise<readonly string[] | void>

export class AudiobookPlaybackService {
  readonly #repository: AudiobookPlaybackRepository
  readonly #plugin: WovenleafPlaybackPlugin
  readonly #listeners = new Set<(snapshot: PlaybackSnapshot) => void>()
  #snapshot?: PlaybackSnapshot
  #handles: PluginListenerHandle[] = []
  #journalConsumer?: PlaybackJournalConsumer
  #draining?: Promise<void>

  constructor(
    database: SqlDatabase,
    options: {
      readonly plugin?: WovenleafPlaybackPlugin
      readonly journalConsumer?: PlaybackJournalConsumer
    } = {},
  ) {
    this.#repository = new AudiobookPlaybackRepository(database)
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
          this.#accept(candidate)
        }),
        await this.#plugin.addListener('eventsAvailable', () => {
          void this.drainJournal()
        }),
      ]
    }
    const snapshot = this.#accept(await this.#plugin.getSnapshot(), true)
    await this.drainJournal()
    return snapshot
  }

  async disconnect(): Promise<void> {
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
    if (!this.#journalConsumer) return
    const { events: candidates } = await this.#plugin.drainJournal()
    const events = candidates.map((event) => nativePlaybackEventSchema.parse(event))
    if (!events.length) return
    const consumed = await this.#journalConsumer(events)
    const ids = consumed ?? events.map(({ id }) => id)
    if (ids.length) await this.#plugin.acknowledgeJournal({ ids })
  }

  async #run(
    invoke: (command: { readonly commandId: string; readonly expectedRevision: number }) => Promise<PlaybackSnapshot>,
    prefix: string,
  ): Promise<PlaybackSnapshot> {
    if (!this.#snapshot) await this.connect()
    const expectedRevision = this.#snapshot?.revision ?? 0
    try {
      const result = await invoke({ commandId: commandId(`playback-${prefix}`), expectedRevision })
      return this.#accept(result, true)
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
}
