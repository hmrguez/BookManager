import type { PluginListenerHandle } from '@capacitor/core'
import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
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
import {
  AudiobookControlsRepository,
  type AudiobookAnnotation,
  type AudiobookControlPreferenceScope,
  type AudiobookControlPreferenceState,
  type AudiobookPlaybackContext,
} from './controls'

export type PlaybackJournalConsumer = (
  events: readonly NativePlaybackEvent[],
) => Promise<readonly string[] | void>

export type PlaybackSeekUndo = {
  readonly eventId: string
  readonly playbackSessionId: string
  readonly beforePositionMs: number
  readonly afterPositionMs: number
}

export type VoiceNotePoint = {
  readonly bookId: string
  readonly snapshot: PlaybackSnapshot
}

export class AudiobookPlaybackService {
  readonly #repository: AudiobookPlaybackRepository
  readonly #progress: AudiobookProgressRepository
  readonly #controls: AudiobookControlsRepository
  readonly #plugin: WovenleafPlaybackPlugin
  readonly #listeners = new Set<(snapshot: PlaybackSnapshot) => void>()
  readonly #seekListeners = new Set<(seek: PlaybackSeekUndo | undefined) => void>()
  #snapshot?: PlaybackSnapshot
  #currentBookId?: string
  #lastSeekUndo?: PlaybackSeekUndo
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
    this.#controls = new AudiobookControlsRepository(database)
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
    if (snapshot.queueId) {
      this.#currentBookId = (await this.#controls.contextForQueue(snapshot.queueId))?.bookId
    }
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
    const snapshot = await this.#run((command) => this.#plugin.loadQueue({ ...queue, ...command }), 'load')
    this.#currentBookId = bookId
    return snapshot
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

  async setRate(
    rate: number,
    scope: AudiobookControlPreferenceScope = 'book',
  ): Promise<PlaybackSnapshot> {
    const snapshot = await this.#run((command) => this.#plugin.setRate({ ...command, rate }), 'rate')
    const bookId = await this.#resolveCurrentBookId()
    if (bookId) await this.#controls.saveRate(bookId, snapshot.rate, scope)
    return snapshot
  }

  async useGlobalRate(): Promise<PlaybackSnapshot> {
    const bookId = await this.#requireCurrentBookId()
    await this.#controls.clearBookRate(bookId)
    const { global } = await this.#controls.preferencesForBook(bookId)
    return this.#run((command) => this.#plugin.setRate({ ...command, rate: global.rate }), 'rate')
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

  async extendSleepTimer(extensionMs: number): Promise<PlaybackSnapshot> {
    const snapshot = await this.#authoritativeSnapshot()
    if (!snapshot.sleepTimer) {
      throw new AudiobookPlaybackError('commandRejected', 'There is no sleep timer to extend.', {
        recoverable: true,
      })
    }
    return this.setSleepTimer(Math.max(1_000, snapshot.sleepTimer.remainingMs) + extensionMs)
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

  subscribeSeekUndo(listener: (seek: PlaybackSeekUndo | undefined) => void): () => void {
    this.#seekListeners.add(listener)
    listener(this.#lastSeekUndo)
    return () => this.#seekListeners.delete(listener)
  }

  async undoLastSeek(): Promise<PlaybackSnapshot> {
    const undo = this.#lastSeekUndo
    const snapshot = await this.#authoritativeSnapshot()
    if (!undo || snapshot.playbackSessionId !== undo.playbackSessionId) {
      throw new AudiobookPlaybackError('commandRejected', 'The previous seek is no longer available.', {
        recoverable: true,
      })
    }
    const result = await this.seekToAbsolute(undo.beforePositionMs)
    this.#setSeekUndo(undefined)
    return result
  }

  contextForBook(bookId: string): Promise<AudiobookPlaybackContext | undefined> {
    return this.#controls.contextForBook(bookId)
  }

  preferencesForBook(bookId: string): Promise<AudiobookControlPreferenceState> {
    return this.#controls.preferencesForBook(bookId)
  }

  async saveGlobalControls(
    bookId: string,
    changes: Parameters<AudiobookControlsRepository['saveGlobalControls']>[1],
  ): Promise<AudiobookControlPreferenceState> {
    await this.#controls.saveGlobalControls(bookId, changes)
    return this.#controls.preferencesForBook(bookId)
  }

  async seekByConfigured(bookId: string, direction: 'forward' | 'backward'): Promise<PlaybackSnapshot> {
    const { effective } = await this.#controls.preferencesForBook(bookId)
    return this.seekBy(direction === 'forward' ? effective.forwardSkipMs : -effective.backwardSkipMs)
  }

  annotationsForBook(bookId: string): Promise<AudiobookAnnotation[]> {
    return this.#controls.annotationsForBook(bookId)
  }

  async addBookmark(bookId: string, note = ''): Promise<AudiobookAnnotation> {
    return this.#controls.createAnnotation({
      bookId,
      snapshot: await this.#authoritativeSnapshot(),
      kind: 'bookmark',
      note,
    })
  }

  async addTextNote(bookId: string, note: string): Promise<AudiobookAnnotation> {
    if (!note.trim()) {
      throw new AudiobookPlaybackError('commandRejected', 'Write a note before saving it.', {
        recoverable: true,
      })
    }
    return this.#controls.createAnnotation({
      bookId,
      snapshot: await this.#authoritativeSnapshot(),
      kind: 'text-note',
      note,
    })
  }

  async prepareVoiceNote(bookId: string): Promise<VoiceNotePoint> {
    let snapshot = await this.#authoritativeSnapshot()
    if (snapshot.state === 'playing' || snapshot.state === 'buffering' || snapshot.playIntent) {
      snapshot = await this.pause()
    }
    return { bookId, snapshot }
  }

  async saveVoiceNote(
    point: VoiceNotePoint,
    recording: Blob,
    durationMs: number,
    note = '',
  ): Promise<AudiobookAnnotation> {
    if (!recording.size) {
      throw new AudiobookPlaybackError('commandRejected', 'The microphone recording was empty.', {
        recoverable: true,
      })
    }
    const id = `audiobook-voice-note:${crypto.randomUUID()}`
    const extension = recording.type.includes('mp4') ? 'm4a' : recording.type.includes('ogg') ? 'ogg' : 'webm'
    const voiceRelativePath = `annotations/audiobooks/${id}.${extension}`
    await Filesystem.writeFile({
      path: voiceRelativePath,
      directory: Directory.LibraryNoCloud,
      data: await blobBase64(recording),
      recursive: true,
    })
    try {
      return await this.#controls.createAnnotation({
        id,
        bookId: point.bookId,
        snapshot: point.snapshot,
        kind: 'voice-note',
        note,
        voiceRelativePath,
        voiceDurationMs: Math.max(0, Math.round(durationMs)),
      })
    } catch (error) {
      await Filesystem.deleteFile({ path: voiceRelativePath, directory: Directory.LibraryNoCloud }).catch(() => undefined)
      throw error
    }
  }

  updateAnnotationNote(id: string, note: string): Promise<AudiobookAnnotation | undefined> {
    return this.#controls.updateAnnotationNote(id, note)
  }

  async deleteAnnotation(id: string): Promise<void> {
    const voiceRelativePath = await this.#controls.deleteAnnotation(id)
    if (voiceRelativePath) {
      await Filesystem.deleteFile({
        path: voiceRelativePath,
        directory: Directory.LibraryNoCloud,
      }).catch(() => undefined)
    }
  }

  async voiceNoteUrl(annotation: AudiobookAnnotation): Promise<string | undefined> {
    if (!annotation.voiceRelativePath) return undefined
    const { uri } = await Filesystem.getUri({
      path: annotation.voiceRelativePath,
      directory: Directory.LibraryNoCloud,
    })
    return Capacitor.convertFileSrc(uri)
  }

  exportAnnotationsMarkdown(bookId: string): Promise<string> {
    return this.#controls.exportAnnotationsMarkdown(bookId)
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
      for (const event of events) {
        if (
          event.kind === 'seek' &&
          event.playbackSessionId === this.#snapshot?.playbackSessionId &&
          event.beforePositionMs !== undefined &&
          event.afterPositionMs !== undefined &&
          event.beforePositionMs !== event.afterPositionMs
        ) {
          this.#setSeekUndo({
            eventId: event.id,
            playbackSessionId: event.playbackSessionId,
            beforePositionMs: event.beforePositionMs,
            afterPositionMs: event.afterPositionMs,
          })
        }
      }
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
      const previousSessionId = this.#snapshot?.playbackSessionId
      this.#snapshot = snapshot
      if (previousSessionId && previousSessionId !== snapshot.playbackSessionId) {
        this.#setSeekUndo(undefined)
      }
      this.#listeners.forEach((listener) => listener(snapshot))
    }
    return this.#snapshot ?? snapshot
  }

  #runProgress<Result>(work: () => Promise<Result>): Promise<Result> {
    const result = this.#progressQueue.then(work)
    this.#progressQueue = result.then(() => undefined, () => undefined)
    return result
  }

  async #authoritativeSnapshot(): Promise<PlaybackSnapshot> {
    const snapshot = this.#accept(await this.#plugin.getSnapshot(), true)
    await this.#checkpoint(snapshot, true)
    return snapshot
  }

  async #resolveCurrentBookId(): Promise<string | undefined> {
    if (this.#currentBookId) return this.#currentBookId
    const queueId = this.#snapshot?.queueId
    if (!queueId) return undefined
    this.#currentBookId = (await this.#controls.contextForQueue(queueId))?.bookId
    return this.#currentBookId
  }

  async #requireCurrentBookId(): Promise<string> {
    const bookId = await this.#resolveCurrentBookId()
    if (!bookId) throw new AudiobookPlaybackError('notFound', 'No audiobook is loaded.')
    return bookId
  }

  #setSeekUndo(seek: PlaybackSeekUndo | undefined): void {
    this.#lastSeekUndo = seek
    this.#seekListeners.forEach((listener) => listener(seek))
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

async function blobBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const chunkSize = 32_768
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}
