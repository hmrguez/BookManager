import { LocalizedError } from '../localization/LocalizedError'
import { t, formatNumber, useLanguage } from '../localization'
import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  FileDown,
  Gauge,
  Mic,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  Square,
  StickyNote,
  Timer,
  Trash2,
} from 'lucide-react'
import { downloadTextFile } from '../app/download'
import { BookCover } from '../design-system/components'
import type { LibraryBook } from '../library-model'
import { getStorageRuntime } from '../storage/runtime'
import { tw } from '../tailwind/styles'
import type { AudiobookPlaybackService } from './service'
import {
  formatAudioTime,
  type AudiobookAnnotation,
  type AudiobookControlPreferenceScope,
  type AudiobookControlPreferenceState,
  type AudiobookPlaybackContext,
} from './controls'
import type { PlaybackSnapshot } from './model'
import type { PlaybackSeekUndo, VoiceNotePoint } from './service'

const speedPresets = [0.75, 1, 1.25, 1.5, 1.75, 2] as const
const skipPresets = [10_000, 15_000, 30_000, 45_000, 60_000] as const
const sleepPresets = [10, 20, 30, 45, 60] as const
const MAX_VOICE_NOTE_MS = 90_000

export type AudiobookPlayerPreview = {
  readonly snapshot: PlaybackSnapshot
  readonly context: AudiobookPlaybackContext
  readonly preferences: AudiobookControlPreferenceState
}

export function AudiobookPlayer({ book, preview, onChooseFile }: { readonly book: LibraryBook; readonly preview?: AudiobookPlayerPreview; readonly onChooseFile?: () => void }) {
  useLanguage()
  // Static capture data is accepted only by the development build.
  const capture = import.meta.env.DEV ? preview : undefined
  const bookId = book.id
  const [service, setService] = useState<AudiobookPlaybackService>()
  const [snapshot, setSnapshot] = useState<PlaybackSnapshot | undefined>(capture?.snapshot)
  const [context, setContext] = useState<AudiobookPlaybackContext | undefined>(capture?.context)
  const [preferences, setPreferences] = useState<AudiobookControlPreferenceState | undefined>(capture?.preferences)
  const [annotations, setAnnotations] = useState<readonly AudiobookAnnotation[]>([])
  const [seekUndo, setSeekUndo] = useState<PlaybackSeekUndo>()
  const [seekDraft, setSeekDraft] = useState<number>()
  const [rateScope, setRateScope] = useState<AudiobookControlPreferenceScope>('book')
  const [note, setNote] = useState('')
  const [editingId, setEditingId] = useState<string>()
  const [editingNote, setEditingNote] = useState('')
  const [voiceUrls, setVoiceUrls] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState(false)
  const [issue, setIssue] = useState<string>()
  const [now, setNow] = useState(() => Date.now())
  const recorderRef = useRef<MediaRecorder | undefined>(undefined)
  const voiceStreamRef = useRef<MediaStream | undefined>(undefined)
  const voiceChunksRef = useRef<Blob[]>([])
  const voicePointRef = useRef<VoiceNotePoint | undefined>(undefined)
  const voiceStartedRef = useRef(0)
  const voiceLimitRef = useRef<number | undefined>(undefined)
  const shakeCooldownRef = useRef(0)

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    if (capture) return
    let disposed = false
    let unsubscribeSnapshot: (() => void) | undefined
    let unsubscribeSeek: (() => void) | undefined
    let playbackService: AudiobookPlaybackService | undefined
    void getStorageRuntime().then(async (runtime) => {
      const playback = runtime.playback
      playbackService = playback
      const bookContext = await playback.contextForBook(bookId)
      if (!bookContext) throw new Error(t("No playable audiobook is attached to this book."))
      await playback.connect()
      await playback.checkBook(bookId)
      const current = playback.snapshot?.queueId === bookContext.queueId && playback.snapshot.state !== 'error'
        ? playback.snapshot
        : await playback.loadBook(bookId)
      const [preferenceState, savedAnnotations] = await Promise.all([
        playback.preferencesForBook(bookId),
        playback.annotationsForBook(bookId),
      ])
      if (disposed) return
      setService(playback)
      setContext(bookContext)
      setSnapshot(current)
      setPreferences(preferenceState)
      setAnnotations(savedAnnotations)
      setRateScope(preferenceState.book?.rate === undefined ? 'global' : 'book')
      unsubscribeSnapshot = playback.subscribe(setSnapshot)
      unsubscribeSeek = playback.subscribeSeekUndo(setSeekUndo)
    }).catch((error) => {
      if (!disposed) setIssue(errorMessage(error))
    })
    return () => {
      disposed = true
      unsubscribeSnapshot?.()
      unsubscribeSeek?.()
      void playbackService?.flush().catch(() => undefined)
      cancelVoiceCapture()
    }
  }, [bookId, capture])

  const refreshAnnotations = async (playback = service) => {
    if (!playback) return
    const saved = await playback.annotationsForBook(bookId)
    setAnnotations(saved)
  }

  useEffect(() => {
    if (!service) return
    let disposed = false
    const voiceNotes = annotations.filter(({ kind }) => kind === 'voice-note')
    void Promise.all(voiceNotes.map(async (annotation) => [
      annotation.id,
      await service.voiceNoteUrl(annotation),
    ] as const)).then((entries) => {
      if (!disposed) setVoiceUrls(Object.fromEntries(entries.filter((entry) => Boolean(entry[1]))) as Record<string, string>)
    })
    return () => {
      disposed = true
    }
  }, [annotations, service])

  const run = async (work: (playback: AudiobookPlaybackService) => Promise<unknown>) => {
    if (!service || busy || recording) return
    setBusy(true)
    setIssue(undefined)
    try {
      await work(service)
    } catch (error) {
      setIssue(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const extendFromMotion = useEffectEvent(() => {
    if (!service || !snapshot?.sleepTimer || !preferences?.effective.shakeToExtend) return
    const current = Date.now()
    if (current - shakeCooldownRef.current < 5_000) return
    shakeCooldownRef.current = current
    void run((playback) => playback.extendSleepTimer(preferences.effective.shakeExtensionMs))
  })

  useEffect(() => {
    if (!preferences?.effective.shakeToExtend) return
    const onMotion = (event: DeviceMotionEvent) => {
      const acceleration = event.accelerationIncludingGravity
      if (!acceleration) return
      const force = Math.hypot(acceleration.x ?? 0, acceleration.y ?? 0, acceleration.z ?? 0)
      if (force > 24) extendFromMotion()
    }
    window.addEventListener('devicemotion', onMotion)
    return () => window.removeEventListener('devicemotion', onMotion)
  }, [preferences?.effective.shakeToExtend])

  const currentChapter = useMemo(() => {
    if (!context || !snapshot) return undefined
    return context.chapters.find(({ key }) => key === snapshot.chapterId)
      ?? context.chapters.find(({ absoluteStartMs, absoluteEndMs }) =>
        snapshot.absolutePositionMs >= absoluteStartMs && snapshot.absolutePositionMs < absoluteEndMs)
  }, [context, snapshot])

  const sleepRemainingMs = snapshot?.sleepTimer
    ? Math.max(
        0,
        snapshot.sleepTimer.deadline
          ? Date.parse(snapshot.sleepTimer.deadline) - now
          : snapshot.sleepTimer.remainingMs,
      )
    : 0

  const saveTextNote = async (event: FormEvent) => {
    event.preventDefault()
    await run(async (playback) => {
      await playback.addTextNote(bookId, note)
      setNote('')
      await refreshAnnotations(playback)
    })
  }

  const saveBookmark = () => run(async (playback) => {
    await playback.addBookmark(bookId, note)
    setNote('')
    await refreshAnnotations(playback)
  })

  const changeRate = (rate: number) => run(async (playback) => {
    await playback.setRate(rate, rateScope)
    setPreferences(await playback.preferencesForBook(bookId))
  })

  const applyGlobalRate = () => run(async (playback) => {
    await playback.useGlobalRate()
    setRateScope('global')
    setPreferences(await playback.preferencesForBook(bookId))
  })

  const saveGlobalControl = (
    changes: Parameters<AudiobookPlaybackService['saveGlobalControls']>[1],
  ) => run(async (playback) => {
    setPreferences(await playback.saveGlobalControls(bookId, changes))
  })

  const toggleShake = () => run(async (playback) => {
    const next = !preferences?.effective.shakeToExtend
    if (next) await requestMotionPermission()
    setPreferences(await playback.saveGlobalControls(bookId, { shakeToExtend: next }))
  })

  const startVoiceCapture = async () => {
    if (!service || recording || busy) return
    setBusy(true)
    setIssue(undefined)
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        throw new Error(t("Voice notes are unavailable on this device. Text notes and bookmarks still work."))
      }
      const point = await service.prepareVoiceNote(bookId)
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      })
      const preferredType = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm']
        .find((type) => MediaRecorder.isTypeSupported(type))
      const recorder = new MediaRecorder(stream, preferredType ? { mimeType: preferredType } : undefined)
      recorderRef.current = recorder
      voiceStreamRef.current = stream
      voicePointRef.current = point
      voiceChunksRef.current = []
      recorder.ondataavailable = ({ data }) => {
        if (data.size) voiceChunksRef.current.push(data)
      }
      recorder.onstart = ({ timeStamp }) => { voiceStartedRef.current = timeStamp }
      recorder.onstop = ({ timeStamp }) => { void finishVoiceCapture(recorder.mimeType, timeStamp) }
      recorder.start(500)
      voiceLimitRef.current = window.setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop()
      }, MAX_VOICE_NOTE_MS)
      setRecording(true)
    } catch (error) {
      cancelVoiceCapture()
      setIssue(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const finishVoiceCapture = async (mimeType: string, stoppedAt: number) => {
    const playback = service
    const point = voicePointRef.current
    const durationMs = Math.min(MAX_VOICE_NOTE_MS, stoppedAt - voiceStartedRef.current)
    const blob = new Blob(voiceChunksRef.current, { type: mimeType || 'audio/webm' })
    stopVoiceTracks()
    setRecording(false)
    if (!playback || !point) return
    setBusy(true)
    try {
      await playback.saveVoiceNote(point, blob, durationMs, note)
      setNote('')
      await refreshAnnotations(playback)
    } catch (error) {
      setIssue(errorMessage(error))
    } finally {
      voicePointRef.current = undefined
      voiceChunksRef.current = []
      setBusy(false)
    }
  }

  const stopRecording = () => {
    const recorder = recorderRef.current
    if (recorder?.state === 'recording') recorder.stop()
  }

  const saveEditedNote = (id: string) => run(async (playback) => {
    await playback.updateAnnotationNote(id, editingNote)
    setEditingId(undefined)
    setEditingNote('')
    await refreshAnnotations(playback)
  })

  const removeAnnotation = (id: string) => run(async (playback) => {
    await playback.deleteAnnotation(id)
    await refreshAnnotations(playback)
  })

  const exportNotes = () => run(async (playback) => {
    const markdown = await playback.exportAnnotationsMarkdown(bookId)
    downloadTextFile(markdown, `${safeFilename(context?.title ?? 'audiobook')}-listening-notes.md`, 'text/markdown;charset=utf-8')
  })

  if (!snapshot || !context || !preferences) {
    return (
      <div className={tw('audiobook-player audiobook-player--loading')}>
        <span role={issue ? 'alert' : 'status'}>{issue ?? t("Preparing your listening place…")}</span>
        {issue && onChooseFile && <button type="button" onClick={onChooseFile}>{t("Choose file")}</button>}
      </div>
    )
  }

  const position = seekDraft ?? snapshot.absolutePositionMs
  const playing = snapshot.state === 'playing' || snapshot.state === 'buffering'

  return (
    <div className={tw('audiobook-player')} aria-busy={busy}>
      <header className={tw('audiobook-player__identity')}>
        <div className={tw('audiobook-player__cover')}>
          <BookCover book={book} large />
        </div>
        <span>{t("Now listening")}</span>
        <h3>{context.title}</h3>
        <p>{context.authors.join(', ') || context.narrators.join(', ') || t("Local audiobook")}</p>
      </header>

      <section className={tw('audiobook-player__timeline')} aria-labelledby="listening-position-title">
        <div className={tw('audiobook-player__chapter')}>
          <span id="listening-position-title">{currentChapter?.title ?? t("Audiobook")}</span>
          <small>{snapshot.route.name}{snapshot.capabilities.backgroundPlayback ? t(" · background ready") : t(" · foreground only")}</small>
        </div>
        <input
          type="range"
          min="0"
          max={Math.max(1, snapshot.durationMs - 1)}
          step="1000"
          value={position}
          aria-label={t("Audiobook position")}
          onInput={(event) => setSeekDraft(Number(event.currentTarget.value))}
          onChange={(event) => {
            const target = Number(event.currentTarget.value)
            setSeekDraft(undefined)
            void run((playback) => playback.seekToAbsolute(target))
          }}
        />
        <div className={tw('audiobook-player__times')}>
          <strong>{formatAudioTime(position)}</strong>
          <span>{Math.min(100, Math.round(position / Math.max(1, snapshot.durationMs) * 100))}{t("% complete")}</span>
          <span>−{formatAudioTime(Math.max(0, snapshot.durationMs - position))}</span>
        </div>
      </section>

      {seekUndo && (
        <button className={tw('audiobook-player__undo')} type="button" onClick={() => void run((playback) => playback.undoLastSeek())}>
          <RotateCcw aria-hidden="true" />
          <span><strong>{t("Position changed")}</strong><small>{t('Return to {{time}}', { time: formatAudioTime(seekUndo.beforePositionMs) })}</small></span>
        </button>
      )}

      {snapshot.sleepTimer && (
        <div className={tw('audiobook-player__timer-live')} role="timer" aria-live="polite">
          <Timer aria-hidden="true" />
          <span>
            <strong>{snapshot.sleepTimer.mode === 'chapter-end'
              ? t("End of chapter · {{v0}}", { v0: formatAudioTime(sleepRemainingMs) })
              : formatAudioTime(sleepRemainingMs)}</strong>
            <small>{t("Sleep timer remains active in the background")}</small>
          </span>
          <button type="button" onClick={() => void run((playback) => playback.extendSleepTimer(preferences.effective.shakeExtensionMs))}>
            +{Math.round(preferences.effective.shakeExtensionMs / 60_000)} {t(" min")}</button>
          <button type="button" onClick={() => void run((playback) => playback.cancelSleepTimer())}>{t("Cancel")}</button>
        </div>
      )}

      <div className={tw('audiobook-player__transport')}>
        <button type="button" onClick={() => void run((playback) => playback.previousChapter())} aria-label={t("Previous chapter")}>
          <ChevronLeft aria-hidden="true" /><small>{t("Chapter")}</small>
        </button>
        <button type="button" onClick={() => void run((playback) => playback.seekByConfigured(bookId, 'backward'))} aria-label={t("Back {{v0}} seconds", { v0: preferences.effective.backwardSkipMs / 1_000 })}>
          <SkipBack aria-hidden="true" /><small>{preferences.effective.backwardSkipMs / 1_000}{t("s")}</small>
        </button>
        <button className={tw('audiobook-player__play')} type="button" onClick={() => void run((playback) => playing ? playback.pause() : playback.play())} aria-label={playing ? t("Pause") : t("Play")}>
          {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
        </button>
        <button type="button" onClick={() => void run((playback) => playback.seekByConfigured(bookId, 'forward'))} aria-label={t("Forward {{v0}} seconds", { v0: preferences.effective.forwardSkipMs / 1_000 })}>
          <SkipForward aria-hidden="true" /><small>{preferences.effective.forwardSkipMs / 1_000}{t("s")}</small>
        </button>
        <button type="button" onClick={() => void run((playback) => playback.nextChapter())} aria-label={t("Next chapter")}>
          <ChevronRight aria-hidden="true" /><small>{t("Chapter")}</small>
        </button>
      </div>

      <div className={tw('audiobook-player__quick')}>
        <button type="button" onClick={() => void saveBookmark()}><Bookmark aria-hidden="true" /> {t(" Bookmark")}</button>
        <button type="button" onClick={() => document.getElementById('audiobook-quick-note')?.focus()}><StickyNote aria-hidden="true" /> {t(" Quick note")}</button>
        <button type="button" onClick={recording ? stopRecording : () => { void startVoiceCapture() }} className={tw(recording ? 'is-recording' : '')}>
          {recording ? <Square aria-hidden="true" /> : <Mic aria-hidden="true" />}
          {recording ? t("Save recording") : t("Voice note")}
        </button>
      </div>

      <section className={tw('audiobook-player__settings')} aria-label={t("Listening controls")}>
        <details open>
          <summary><Gauge aria-hidden="true" /><span>{t("Speed")}</span><strong>{formatNumber(snapshot.rate, { minimumFractionDigits: snapshot.rate % 1 ? 2 : 0, maximumFractionDigits: 2 })}×</strong></summary>
          <div className={tw('audiobook-player__scope')}>
            <button type="button" aria-pressed={rateScope === 'book'} onClick={() => setRateScope('book')}>{t("This book")}</button>
            <button type="button" aria-pressed={rateScope === 'global'} onClick={() => setRateScope('global')}>{t("All books")}</button>
            {preferences.book?.rate !== undefined && <button type="button" onClick={() => void applyGlobalRate()}>{t("Use global")}</button>}
          </div>
          <div className={tw('audiobook-player__presets')}>
            {speedPresets
              .filter((rate) => rate >= snapshot.capabilities.minimumRate && rate <= snapshot.capabilities.maximumRate)
              .map((rate) => (
                <button key={rate} type="button" aria-pressed={snapshot.rate === rate} onClick={() => void changeRate(rate)}>{formatNumber(rate)}×</button>
              ))}
          </div>
          <p>{t("Pitch stays natural.")}{' '}{rateScope === 'book' ? t("This speed follows this audiobook.") : t("This becomes the default for every audiobook.")}</p>
        </details>

        <details>
          <summary><Timer aria-hidden="true" /><span>{t("Sleep & skips")}</span><strong>{snapshot.sleepTimer ? formatAudioTime(sleepRemainingMs) : t("Off")}</strong></summary>
          <div className={tw('audiobook-player__presets')}>
            {sleepPresets.map((minutes) => (
              <button key={minutes} type="button" onClick={() => void run((playback) => playback.setSleepTimer(minutes * 60_000))}>{minutes} {t(" min")}</button>
            ))}
            <button type="button" onClick={() => void run((playback) => playback.setSleepTimerAtChapterEnd())}>{t("Chapter")}</button>
          </div>
          <div className={tw('audiobook-player__skip-fields')}>
            <label><span>{t("Back")}</span><select value={preferences.effective.backwardSkipMs} onChange={(event) => void saveGlobalControl({ backwardSkipMs: Number(event.currentTarget.value) })}>{skipPresets.map((value) => <option key={value} value={value}>{value / 1_000} {t(" sec")}</option>)}</select></label>
            <label><span>{t("Forward")}</span><select value={preferences.effective.forwardSkipMs} onChange={(event) => void saveGlobalControl({ forwardSkipMs: Number(event.currentTarget.value) })}>{skipPresets.map((value) => <option key={value} value={value}>{value / 1_000} {t(" sec")}</option>)}</select></label>
          </div>
          <button className={tw('audiobook-player__shake')} type="button" aria-pressed={preferences.effective.shakeToExtend} onClick={() => void toggleShake()}>
            <span><strong>{t("Shake to extend")}</strong><small>{t('Add {{minutes}} minutes only while a timer is active.', { minutes: formatNumber(preferences.effective.shakeExtensionMs / 60_000) })}</small></span><i aria-hidden="true" />
          </button>
        </details>
      </section>

      <section className={tw('audiobook-player__notes')} aria-labelledby="quick-notes-title">
        <header>
          <div><span>{t("Exact timeline")}</span><h4 id="quick-notes-title">{t("Bookmarks & notes")}</h4></div>
          <button type="button" onClick={() => void exportNotes()}><FileDown aria-hidden="true" /> {t(" Export")}</button>
        </header>
        <form onSubmit={(event) => { void saveTextNote(event) }}>
          <label htmlFor="audiobook-quick-note">{t('Note at {{time}}', { time: formatAudioTime(snapshot.absolutePositionMs) })}</label>
          <textarea id="audiobook-quick-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder={t("A thought to return to…")} />
          <div><button type="button" onClick={() => void saveBookmark()}><Bookmark aria-hidden="true" /> {t(" Bookmark with note")}</button><button type="submit" disabled={!note.trim()}><StickyNote aria-hidden="true" /> {t(" Save note")}</button></div>
        </form>
        <p className={tw('audiobook-player__privacy')}><Mic aria-hidden="true" /><span><strong>{t("Voice notes are microphone-only.")}</strong> {t(" Playback pauses before recording; audiobook audio is never captured, mixed, or exported. Recordings remain in local app storage.")}</span></p>

        {annotations.length ? (
          <ol className={tw('audiobook-player__annotation-list')}>
            {annotations.map((annotation) => {
              const chapter = context.chapters.find(({ key }) => key === annotation.chapterId)?.title
              return (
                <li key={annotation.id}>
                  <div>
                    <span>{annotation.kind === 'bookmark' ? <Bookmark aria-hidden="true" /> : annotation.kind === 'voice-note' ? <Mic aria-hidden="true" /> : <StickyNote aria-hidden="true" />}</span>
                    <p><strong>{formatAudioTime(annotation.absolutePositionMs)}</strong><small>{chapter ?? t("Audiobook timeline")} · {annotation.kind.replace('-', ' ')}</small></p>
                    <button type="button" onClick={() => void removeAnnotation(annotation.id)} aria-label={t("Delete annotation at {{v0}}", { v0: formatAudioTime(annotation.absolutePositionMs) })}><Trash2 aria-hidden="true" /></button>
                  </div>
                  {annotation.kind === 'voice-note' && voiceUrls[annotation.id] && <audio controls preload="metadata" src={voiceUrls[annotation.id]} aria-label={t("Voice note at {{v0}}", { v0: formatAudioTime(annotation.absolutePositionMs) })} />}
                  {editingId === annotation.id ? (
                    <form onSubmit={(event) => { event.preventDefault(); void saveEditedNote(annotation.id) }}>
                      <input autoFocus value={editingNote} onChange={(event) => setEditingNote(event.target.value)} aria-label={t("Annotation note")} />
                      <button type="submit">{t("Save")}</button>
                    </form>
                  ) : annotation.note ? (
                    <button className={tw('audiobook-player__annotation-note')} type="button" onClick={() => { setEditingId(annotation.id); setEditingNote(annotation.note) }}>{annotation.note}</button>
                  ) : (
                    <button className={tw('audiobook-player__annotation-note')} type="button" onClick={() => { setEditingId(annotation.id); setEditingNote('') }}>{t("Add a note")}</button>
                  )}
                </li>
              )
            })}
          </ol>
        ) : <p className={tw('audiobook-player__empty')}>{t("Your first bookmark will keep the exact time and chapter here.")}</p>}
      </section>

      {(issue || snapshot.error) && <div className={tw('audiobook-player__issue')} role="alert"><p>{<LocalizedError message={issue ?? snapshot.error?.message ?? ''} />}</p>{onChooseFile && <button type="button" onClick={onChooseFile}>{t("Choose file")}</button>}</div>}
    </div>
  )

  function stopVoiceTracks() {
    if (voiceLimitRef.current !== undefined) window.clearTimeout(voiceLimitRef.current)
    voiceLimitRef.current = undefined
    voiceStreamRef.current?.getTracks().forEach((track) => track.stop())
    voiceStreamRef.current = undefined
    recorderRef.current = undefined
  }

  function cancelVoiceCapture() {
    const recorder = recorderRef.current
    if (recorder) recorder.onstop = null
    if (recorder?.state === 'recording') recorder.stop()
    stopVoiceTracks()
    voicePointRef.current = undefined
    voiceChunksRef.current = []
  }
}

async function requestMotionPermission(): Promise<void> {
  if (!('DeviceMotionEvent' in window)) {
    throw new Error(t("Motion sensing is unavailable on this device. The sleep timer itself remains available."))
  }
  const motion = DeviceMotionEvent as typeof DeviceMotionEvent & {
    requestPermission?: () => Promise<'granted' | 'denied'>
  }
  if (motion.requestPermission && await motion.requestPermission() !== 'granted') {
    throw new Error(t("Motion access was not granted. The sleep timer itself remains available."))
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : t("The listening control could not be updated.")
}

function safeFilename(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'audiobook'
}
