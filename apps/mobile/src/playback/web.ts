import { WebPlugin } from '@capacitor/core'
import type { PlaybackManifest } from '../audiobooks/model'
import type { WovenleafPlaybackPlugin } from './bridge'
import {
  AUDIOBOOK_PLAYBACK_BRIDGE_VERSION,
  MAX_PLAYBACK_JOURNAL_EVENTS,
  type NativePlaybackEvent,
  type PlaybackArtwork,
  type PlaybackCapabilities,
  type PlaybackCommand,
  type PlaybackError,
  type PlaybackQueueRequest,
  type PlaybackRoute,
  type PlaybackSleepTimer,
  type PlaybackSnapshot,
  type PlaybackSuppressionReason,
  type PlaybackTransportState,
} from './model'

const webCapabilities: PlaybackCapabilities = {
  bridgeVersion: AUDIOBOOK_PLAYBACK_BRIDGE_VERSION,
  engine: 'web-audio',
  backgroundPlayback: false,
  systemControls: 'mediaSession' in navigator,
  processRestoration: false,
  systemLibrary: false,
  airPlay: false,
  cast: false,
  routeSelection: false,
  sleepTimer: true,
  seek: true,
  supportedMediaTypes: ['audio/mpeg', 'audio/mp4'],
  minimumRate: 0.5,
  maximumRate: 3,
  degradedReason: 'Browser playback is foreground-only and cannot guarantee process restoration.',
}

export class WovenleafPlaybackWeb extends WebPlugin implements WovenleafPlaybackPlugin {
  readonly #engineEpoch = `web-engine:${crypto.randomUUID()}`
  readonly #applied = new Map<string, PlaybackSnapshot>()
  readonly #events: NativePlaybackEvent[] = []
  #audio?: HTMLAudioElement
  #manifest?: PlaybackManifest
  #artwork?: PlaybackArtwork
  #sources = new Map<string, string>()
  #segmentIndex = 0
  #sessionId: string | null = null
  #revision = 0
  #sequence = 0
  #state: PlaybackTransportState = 'empty'
  #suppression: PlaybackSuppressionReason = 'none'
  #playIntent = false
  #rate = 1
  #lastCommandId: string | null = null
  #error: PlaybackError | null = null
  #sleepTimer: PlaybackSleepTimer | null = null
  #sleepTimeout?: number
  #sleepChapterEndMs?: number
  #previewEnabled = false
  #activeStartedAt?: number
  #activeDurationMs = 0
  #publishedMetadataIdentity?: string

  constructor() {
    super()
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.#state === 'playing') {
        void this.#pauseForForegroundBoundary()
      }
    })
  }

  async getCapabilities(): Promise<PlaybackCapabilities> {
    return webCapabilities
  }

  async loadQueue(options: PlaybackQueueRequest & PlaybackCommand): Promise<PlaybackSnapshot> {
    return this.#command(options, async () => {
      this.#disposeAudio()
      this.#manifest = options.manifest
      this.#artwork = options.artwork
      this.#publishedMetadataIdentity = undefined
      this.#sources = new Map(options.sources.map(({ capability, uri }) => [capability, uri]))
      this.#segmentIndex = this.#segmentForAbsolute(options.manifest.initialAbsolutePositionMs)
      this.#sessionId = `playback-session:web:${crypto.randomUUID()}`
      this.#rate = options.manifest.rate
      this.#state = 'loading'
      this.#suppression = 'none'
      this.#playIntent = false
      this.#error = null
      this.#activeStartedAt = undefined
      this.#activeDurationMs = 0
      this.#createAudio(options.manifest.initialAbsolutePositionMs)
      this.#state = 'paused'
      this.#updateMediaSession()
    })
  }

  async play(options: PlaybackCommand): Promise<PlaybackSnapshot> {
    return this.#command(options, async () => {
      if (!this.#audio || !this.#manifest) throw new Error('No audiobook queue is loaded.')
      this.#playIntent = true
      this.#suppression = 'none'
      await this.#audio.play()
      this.#state = 'playing'
      this.#startActiveInterval()
      this.#journal('play', 'user-command')
    })
  }

  async pause(options: PlaybackCommand): Promise<PlaybackSnapshot> {
    return this.#command(options, () => {
      this.#audio?.pause()
      this.#closeActiveInterval()
      this.#playIntent = false
      this.#state = this.#audio ? 'paused' : 'empty'
      this.#journal('pause', 'user-command')
    })
  }

  async stop(options: PlaybackCommand): Promise<PlaybackSnapshot> {
    return this.#command(options, () => {
      this.#audio?.pause()
      this.#closeActiveInterval()
      this.#playIntent = false
      this.#state = this.#audio ? 'stopped' : 'empty'
      this.#journal('stop', 'user-command')
    })
  }

  async seekToAbsolute(options: PlaybackCommand & { readonly positionMs: number }): Promise<PlaybackSnapshot> {
    return this.#command(options, () => this.#seek(options.positionMs, 'absolute-seek'))
  }

  async seekBy(options: PlaybackCommand & { readonly offsetMs: number }): Promise<PlaybackSnapshot> {
    return this.#command(options, () => this.#seek(this.#absolutePosition() + options.offsetMs, 'relative-seek'))
  }

  async nextChapter(options: PlaybackCommand): Promise<PlaybackSnapshot> {
    return this.#command(options, () => {
      const current = this.#absolutePosition()
      const chapter = this.#manifest?.chapters.find(({ absoluteStartMs }) => absoluteStartMs > current + 500)
      if (chapter) this.#seek(chapter.absoluteStartMs, 'next-chapter')
    })
  }

  async previousChapter(options: PlaybackCommand): Promise<PlaybackSnapshot> {
    return this.#command(options, () => {
      const current = this.#absolutePosition()
      const chapters = this.#manifest?.chapters.filter(({ absoluteStartMs }) => absoluteStartMs < current - 3_000) ?? []
      this.#seek(chapters.at(-1)?.absoluteStartMs ?? 0, 'previous-chapter')
    })
  }

  async setRate(options: PlaybackCommand & { readonly rate: number }): Promise<PlaybackSnapshot> {
    return this.#command(options, () => {
      if (options.rate < webCapabilities.minimumRate || options.rate > webCapabilities.maximumRate) {
        throw new Error('The requested playback rate is unsupported.')
      }
      const before = this.#absolutePosition()
      this.#rate = options.rate
      if (this.#audio) this.#audio.playbackRate = options.rate
      this.#journal('rate-change', 'user-command', before, before)
    })
  }

  async setSleepTimer(
    options: PlaybackCommand & { readonly mode: 'duration' | 'chapter-end'; readonly durationMs?: number },
  ): Promise<PlaybackSnapshot> {
    return this.#command(options, () => {
      this.#clearSleepTimeout()
      const remainingMs = options.mode === 'duration'
        ? options.durationMs ?? 0
        : (this.#currentChapter()?.absoluteEndMs ?? this.#duration()) - this.#absolutePosition()
      if (remainingMs <= 0) throw new Error('The sleep timer duration is invalid.')
      this.#scheduleSleepTimer(options.mode, remainingMs)
    })
  }

  async cancelSleepTimer(options: PlaybackCommand): Promise<PlaybackSnapshot> {
    return this.#command(options, () => {
      this.#clearSleepTimeout()
      this.#sleepTimer = null
    })
  }

  async adoptPosition(
    options: PlaybackCommand & { readonly positionMs: number; readonly provenanceEventId: string },
  ): Promise<PlaybackSnapshot> {
    return this.#command(options, () => {
      if (this.#state === 'playing' || this.#state === 'buffering') {
        throw new Error('A position can only be adopted while playback is paused or stopped.')
      }
      this.#seek(options.positionMs, `adopt:${options.provenanceEventId}`)
    })
  }

  async getSnapshot(): Promise<PlaybackSnapshot> {
    return this.#snapshot()
  }

  async drainJournal(): Promise<{ readonly events: readonly NativePlaybackEvent[] }> {
    return { events: [...this.#events] }
  }

  async acknowledgeJournal(options: { readonly ids: readonly string[] }): Promise<void> {
    const ids = new Set(options.ids)
    let write = 0
    for (const event of this.#events) {
      if (!ids.has(event.id)) this.#events[write++] = event
    }
    this.#events.length = write
  }

  async setSystemSurfacePrivacy(options: { readonly previewEnabled: boolean }): Promise<PlaybackSnapshot> {
    if (this.#previewEnabled === options.previewEnabled) return this.#snapshot()
    this.#previewEnabled = options.previewEnabled
    this.#publishedMetadataIdentity = undefined
    this.#updateMediaSession()
    return this.#emitSnapshot()
  }

  async #command(options: PlaybackCommand, apply: () => void | Promise<void>): Promise<PlaybackSnapshot> {
    const prior = this.#applied.get(options.commandId)
    if (prior) return prior
    if (options.expectedRevision !== this.#revision) {
      throw new Error(`Stale playback revision ${options.expectedRevision}; expected ${this.#revision}.`)
    }
    this.#lastCommandId = options.commandId
    await apply()
    const snapshot = await this.#emitSnapshot()
    this.#applied.set(options.commandId, snapshot)
    if (this.#applied.size > 256) this.#applied.delete(this.#applied.keys().next().value ?? '')
    return snapshot
  }

  #createAudio(absolutePositionMs: number): void {
    const segment = this.#manifest?.segments[this.#segmentIndex]
    if (!segment) return
    const uri = this.#sources.get(segment.playableCapability)
    if (!uri) throw new Error(`Missing source for ${segment.id}.`)
    const audio = new Audio(uri)
    audio.preload = 'auto'
    audio.playbackRate = this.#rate
    audio.preservesPitch = true
    audio.currentTime = Math.max(0, absolutePositionMs - segment.absoluteStartMs) / 1_000
    audio.addEventListener('waiting', () => {
      if (this.#state === 'playing') {
        this.#closeActiveInterval()
        this.#state = 'buffering'
        void this.#emitSnapshot()
      }
    })
    audio.addEventListener('playing', () => {
      this.#state = 'playing'
      this.#startActiveInterval()
      void this.#emitSnapshot()
    })
    audio.addEventListener('pause', () => {
      this.#closeActiveInterval()
      if (this.#state !== 'stopped' && this.#state !== 'ended') this.#state = 'paused'
      void this.#emitSnapshot()
    })
    audio.addEventListener('timeupdate', () => {
      if (this.#sleepChapterEndMs !== undefined && this.#absolutePosition() >= this.#sleepChapterEndMs) {
        this.#expireSleepTimer()
        return
      }
      void this.#emitSnapshot()
    })
    audio.addEventListener('ended', () => {
      void this.#advanceSegment()
    })
    audio.addEventListener('error', () => {
      this.#closeActiveInterval()
      this.#playIntent = false
      this.#state = 'error'
      this.#suppression = 'error'
      this.#error = {
        code: 'playbackFailed',
        message: 'Browser audio could not continue this segment.',
        recoverable: true,
        capability: segment.playableCapability,
        expectedFingerprint: segment.fingerprint,
      }
      this.#journal('failure', 'browser-media-error')
      void this.#emitSnapshot()
    })
    this.#audio = audio
  }

  async #advanceSegment(): Promise<void> {
    if (!this.#manifest) return
    const before = this.#absolutePosition()
    if (this.#segmentIndex >= this.#manifest.segments.length - 1) {
      this.#closeActiveInterval()
      this.#state = 'ended'
      this.#playIntent = false
      this.#journal('end', 'queue-ended', before, this.#duration())
      await this.#emitSnapshot()
      return
    }
    this.#segmentIndex += 1
    this.#disposeAudio()
    this.#createAudio(this.#manifest.segments[this.#segmentIndex]?.absoluteStartMs ?? before)
    this.#journal('segment-transition', 'file-boundary', before, this.#absolutePosition())
    if (this.#playIntent) await this.#audio?.play()
    await this.#emitSnapshot()
  }

  #seek(requestedPositionMs: number, reason: string): void {
    if (!this.#manifest) return
    const before = this.#absolutePosition()
    const target = Math.max(0, Math.min(Math.trunc(requestedPositionMs), Math.max(0, this.#duration() - 1)))
    if (this.#state === 'ended') this.#state = 'paused'
    const segmentIndex = this.#segmentForAbsolute(target)
    if (segmentIndex === this.#segmentIndex && this.#audio) {
      this.#audio.currentTime = (target - (this.#manifest.segments[segmentIndex]?.absoluteStartMs ?? 0)) / 1_000
    } else {
      const shouldPlay = this.#playIntent
      this.#disposeAudio()
      this.#segmentIndex = segmentIndex
      this.#createAudio(target)
      if (shouldPlay) void this.#audio?.play()
    }
    this.#journal('seek', reason, before, target)
  }

  async #pauseForForegroundBoundary(): Promise<void> {
    const before = this.#absolutePosition()
    this.#audio?.pause()
    this.#closeActiveInterval()
    this.#playIntent = false
    this.#state = 'paused'
    this.#suppression = 'process-recreated'
    this.#journal('pause', 'foreground-only-browser', before, before)
    await this.#emitSnapshot()
  }

  #expireSleepTimer(): void {
    const before = this.#absolutePosition()
    this.#audio?.pause()
    this.#closeActiveInterval()
    this.#playIntent = false
    this.#state = 'paused'
    this.#suppression = 'sleep-timer'
    this.#sleepTimer = null
    this.#sleepChapterEndMs = undefined
    this.#journal('sleep-expired', 'sleep-timer', before, before)
    void this.#emitSnapshot()
  }

  #journal(
    kind: NativePlaybackEvent['kind'],
    reason: string,
    beforePositionMs = this.#absolutePosition(),
    afterPositionMs = this.#absolutePosition(),
  ): void {
    if (!this.#manifest || !this.#sessionId) return
    this.#closeActiveInterval(true)
    const event: NativePlaybackEvent = {
      bridgeVersion: AUDIOBOOK_PLAYBACK_BRIDGE_VERSION,
      id: `playback-event:web:${crypto.randomUUID()}`,
      sequence: ++this.#sequence,
      engineEpoch: this.#engineEpoch,
      queueId: this.#manifest.queueId,
      playbackSessionId: this.#sessionId,
      revision: this.#revision + 1,
      kind,
      observedAt: new Date().toISOString(),
      activeDurationMs: this.#activeDurationMs,
      beforePositionMs,
      afterPositionMs,
      rate: this.#rate,
      reason,
      confidence: 1,
      segmentId: this.#currentSegment()?.id ?? null,
      chapterId: this.#currentChapter()?.key ?? null,
      error: this.#error,
    }
    this.#events.push(event)
    if (this.#events.length > MAX_PLAYBACK_JOURNAL_EVENTS) this.#events.shift()
    void this.notifyListeners('eventsAvailable', { count: this.#events.length })
  }

  async #emitSnapshot(): Promise<PlaybackSnapshot> {
    this.#revision += 1
    this.#updateMediaSession()
    const snapshot = this.#snapshot()
    await this.notifyListeners('snapshotChanged', snapshot)
    return snapshot
  }

  #snapshot(): PlaybackSnapshot {
    return {
      bridgeVersion: AUDIOBOOK_PLAYBACK_BRIDGE_VERSION,
      engineEpoch: this.#engineEpoch,
      queueId: this.#manifest?.queueId ?? null,
      playbackSessionId: this.#sessionId,
      revision: this.#revision,
      state: this.#state,
      suppressionReason: this.#suppression,
      playIntent: this.#playIntent,
      segmentId: this.#currentSegment()?.id ?? null,
      chapterId: this.#currentChapter()?.key ?? null,
      absolutePositionMs: this.#absolutePosition(),
      segmentPositionMs: Math.max(0, Math.round((this.#audio?.currentTime ?? 0) * 1_000)),
      durationMs: this.#duration(),
      bufferedPositionMs: this.#bufferedAbsolutePosition(),
      activeDurationMs: this.#currentActiveDurationMs(),
      rate: this.#rate,
      sleepTimer: this.#sleepTimerSnapshot(),
      route: this.#route(),
      capabilities: webCapabilities,
      lastCommandId: this.#lastCommandId,
      error: this.#error,
      observedAt: new Date().toISOString(),
    }
  }

  #absolutePosition(): number {
    const start = this.#currentSegment()?.absoluteStartMs ?? 0
    return Math.max(0, Math.min(this.#duration(), start + Math.round((this.#audio?.currentTime ?? 0) * 1_000)))
  }

  #startActiveInterval(): void {
    this.#activeStartedAt ??= performance.now()
  }

  #closeActiveInterval(restart = false): void {
    if (this.#activeStartedAt !== undefined) {
      this.#activeDurationMs += Math.max(0, Math.round(performance.now() - this.#activeStartedAt))
    }
    this.#activeStartedAt = restart && this.#playIntent && this.#state === 'playing'
      ? performance.now()
      : undefined
  }

  #currentActiveDurationMs(): number {
    return this.#activeDurationMs + (this.#activeStartedAt === undefined
      ? 0
      : Math.max(0, Math.round(performance.now() - this.#activeStartedAt)))
  }

  #bufferedAbsolutePosition(): number {
    const audio = this.#audio
    const start = this.#currentSegment()?.absoluteStartMs ?? 0
    if (!audio?.buffered.length) return this.#absolutePosition()
    return Math.min(this.#duration(), start + Math.round(audio.buffered.end(audio.buffered.length - 1) * 1_000))
  }

  #duration(): number {
    return this.#manifest?.segments.at(-1)?.absoluteEndMs ?? 0
  }

  #segmentForAbsolute(positionMs: number): number {
    const index = this.#manifest?.segments.findIndex(
      ({ absoluteStartMs, absoluteEndMs }) => positionMs >= absoluteStartMs && positionMs < absoluteEndMs,
    ) ?? -1
    return Math.max(0, index)
  }

  #currentSegment() {
    return this.#manifest?.segments[this.#segmentIndex]
  }

  #currentChapter() {
    const position = this.#absolutePosition()
    return this.#manifest?.chapters.find(
      ({ absoluteStartMs, absoluteEndMs }) => position >= absoluteStartMs && position < absoluteEndMs,
    )
  }

  #route(): PlaybackRoute {
    return { kind: 'built-in', name: 'Browser output', external: false }
  }

  #updateMediaSession(): void {
    if (!('mediaSession' in navigator) || !this.#manifest) return
    const metadata = this.#previewEnabled
      ? this.#manifest.systemSurfaceMetadata.preview
      : this.#manifest.systemSurfaceMetadata.private
    const chapter = this.#previewEnabled ? this.#currentChapter() : undefined
    const identity = [
      this.#manifest.assetId,
      this.#previewEnabled,
      chapter?.key ?? 'private',
      this.#previewEnabled ? this.#artwork?.fingerprint ?? 'no-artwork' : 'hidden-artwork',
    ].join(':')
    if (identity !== this.#publishedMetadataIdentity) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: metadata.title,
        artist: 'contributor' in metadata ? metadata.contributor : metadata.subtitle,
        album: chapter?.title ?? ('series' in metadata ? metadata.series : undefined),
        artwork: this.#previewEnabled && this.#artwork
          ? [{ src: this.#artwork.uri, type: this.#artwork.mediaType }]
          : [],
      })
      this.#publishedMetadataIdentity = identity
    }

    const invoke = (command: (commandId: string, expectedRevision: number) => Promise<PlaybackSnapshot>) => {
      void command(`web-media:${crypto.randomUUID()}`, this.#revision).catch(() => {
        // A newer media action already won; the next authoritative snapshot refreshes these controls.
      })
    }
    this.#setMediaAction('play', () => {
      invoke((commandId, expectedRevision) => this.play({ commandId, expectedRevision }))
    })
    this.#setMediaAction('pause', () => {
      invoke((commandId, expectedRevision) => this.pause({ commandId, expectedRevision }))
    })
    this.#setMediaAction('stop', () => {
      invoke((commandId, expectedRevision) => this.stop({ commandId, expectedRevision }))
    })
    this.#setMediaAction('seekbackward', (details) => {
      invoke((commandId, expectedRevision) => this.seekBy({
        commandId,
        expectedRevision,
        offsetMs: -Math.round(
          (details.seekOffset ?? this.#manifest!.skipIntervals.backwardMs / 1_000) * 1_000,
        ),
      }))
    })
    this.#setMediaAction('seekforward', (details) => {
      invoke((commandId, expectedRevision) => this.seekBy({
        commandId,
        expectedRevision,
        offsetMs: Math.round(
          (details.seekOffset ?? this.#manifest!.skipIntervals.forwardMs / 1_000) * 1_000,
        ),
      }))
    })
    this.#setMediaAction('seekto', (details) => {
      invoke((commandId, expectedRevision) => this.seekToAbsolute({
        commandId,
        expectedRevision,
        positionMs: Math.round((details.seekTime ?? 0) * 1_000),
      }))
    })
    const position = this.#absolutePosition()
    const hasNext = this.#manifest.chapters.some(({ absoluteStartMs }) => absoluteStartMs > position + 500)
    this.#setMediaAction('nexttrack', hasNext
      ? () => invoke((commandId, expectedRevision) => this.nextChapter({ commandId, expectedRevision }))
      : null)
    this.#setMediaAction('previoustrack', position > 0
      ? () => invoke((commandId, expectedRevision) => this.previousChapter({ commandId, expectedRevision }))
      : null)

    navigator.mediaSession.playbackState = this.#state === 'playing'
      ? 'playing'
      : this.#state === 'paused' || this.#state === 'buffering'
        ? 'paused'
        : 'none'
    const duration = this.#duration()
    if (duration > 0) {
      try {
        navigator.mediaSession.setPositionState({
          duration: duration / 1_000,
          playbackRate: this.#rate,
          position: Math.min(Math.max(0, duration - 1), this.#absolutePosition()) / 1_000,
        })
      } catch {
        // Some browser implementations expose Media Session without position-state support.
      }
    }
  }

  #setMediaAction(action: MediaSessionAction, handler: MediaSessionActionHandler | null): void {
    try {
      navigator.mediaSession.setActionHandler(action, handler)
    } catch {
      // Optional actions vary by browser and platform version.
    }
  }

  #clearSleepTimeout(): void {
    if (this.#sleepTimeout !== undefined) window.clearTimeout(this.#sleepTimeout)
    this.#sleepTimeout = undefined
    this.#sleepChapterEndMs = undefined
  }

  #scheduleSleepTimer(mode: 'duration' | 'chapter-end', remainingMs: number): void {
    this.#clearSleepTimeout()
    if (mode === 'chapter-end') {
      this.#sleepChapterEndMs = this.#absolutePosition() + remainingMs
      this.#sleepTimer = { mode, remainingMs }
      return
    }
    const deadline = new Date(Date.now() + remainingMs).toISOString()
    this.#sleepTimer = { mode, deadline, remainingMs }
    this.#sleepTimeout = window.setTimeout(() => this.#expireSleepTimer(), remainingMs)
  }

  #sleepTimerSnapshot(): PlaybackSleepTimer | null {
    const timer = this.#sleepTimer
    if (timer?.mode === 'chapter-end' && this.#sleepChapterEndMs !== undefined) {
      return { ...timer, remainingMs: Math.max(0, this.#sleepChapterEndMs - this.#absolutePosition()) }
    }
    if (!timer?.deadline) return timer
    return { ...timer, remainingMs: Math.max(0, Date.parse(timer.deadline) - Date.now()) }
  }

  #disposeAudio(): void {
    if (!this.#audio) return
    this.#audio.pause()
    this.#audio.removeAttribute('src')
    this.#audio.load()
    this.#audio = undefined
  }
}
