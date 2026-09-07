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

export function AudiobookPlayer({ book }: { readonly book: LibraryBook }) {
  const bookId = book.id
  const [service, setService] = useState<AudiobookPlaybackService>()
  const [snapshot, setSnapshot] = useState<PlaybackSnapshot>()
  const [context, setContext] = useState<AudiobookPlaybackContext>()
  const [preferences, setPreferences] = useState<AudiobookControlPreferenceState>()
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
    let disposed = false
    let unsubscribeSnapshot: (() => void) | undefined
    let unsubscribeSeek: (() => void) | undefined
    let playbackService: AudiobookPlaybackService | undefined
    void getStorageRuntime().then(async (runtime) => {
      const playback = runtime.playback
      playbackService = playback
      const bookContext = await playback.contextForBook(bookId)
      if (!bookContext) throw new Error('No playable audiobook is attached to this book.')
      await playback.connect()
      const current = playback.snapshot?.queueId === bookContext.queueId
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
  }, [bookId])

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
        throw new Error('Voice notes are unavailable on this device. Text notes and bookmarks still work.')
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
        <span>{issue ?? 'Preparing your listening place…'}</span>
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
        <span>Now listening</span>
        <h3>{context.title}</h3>
        <p>{context.authors.join(', ') || context.narrators.join(', ') || 'Local audiobook'}</p>
      </header>

      <section className={tw('audiobook-player__timeline')} aria-labelledby="listening-position-title">
        <div className={tw('audiobook-player__chapter')}>
          <span id="listening-position-title">{currentChapter?.title ?? 'Audiobook'}</span>
          <small>{snapshot.route.name}{snapshot.capabilities.backgroundPlayback ? ' · background ready' : ' · foreground only'}</small>
        </div>
        <input
          type="range"
          min="0"
          max={Math.max(1, snapshot.durationMs - 1)}
          step="1000"
          value={position}
          aria-label="Audiobook position"
          onInput={(event) => setSeekDraft(Number(event.currentTarget.value))}
          onChange={(event) => {
            const target = Number(event.currentTarget.value)
            setSeekDraft(undefined)
            void run((playback) => playback.seekToAbsolute(target))
          }}
        />
        <div className={tw('audiobook-player__times')}>
          <strong>{formatAudioTime(position)}</strong>
          <span>{Math.min(100, Math.round(position / Math.max(1, snapshot.durationMs) * 100))}% complete</span>
          <span>−{formatAudioTime(Math.max(0, snapshot.durationMs - position))}</span>
        </div>
      </section>

      {seekUndo && (
        <button className={tw('audiobook-player__undo')} type="button" onClick={() => void run((playback) => playback.undoLastSeek())}>
          <RotateCcw aria-hidden="true" />
          <span><strong>Position changed</strong><small>Return to {formatAudioTime(seekUndo.beforePositionMs)}</small></span>
        </button>
      )}

      {snapshot.sleepTimer && (
        <div className={tw('audiobook-player__timer-live')} role="timer" aria-live="polite">
          <Timer aria-hidden="true" />
          <span>
            <strong>{snapshot.sleepTimer.mode === 'chapter-end'
              ? `End of chapter · ${formatAudioTime(sleepRemainingMs)}`
              : formatAudioTime(sleepRemainingMs)}</strong>
            <small>Sleep timer remains active in the background</small>
          </span>
          <button type="button" onClick={() => void run((playback) => playback.extendSleepTimer(preferences.effective.shakeExtensionMs))}>
            +{Math.round(preferences.effective.shakeExtensionMs / 60_000)} min
          </button>
          <button type="button" onClick={() => void run((playback) => playback.cancelSleepTimer())}>Cancel</button>
        </div>
      )}

      <div className={tw('audiobook-player__transport')}>
        <button type="button" onClick={() => void run((playback) => playback.previousChapter())} aria-label="Previous chapter">
          <ChevronLeft aria-hidden="true" /><small>Chapter</small>
        </button>
        <button type="button" onClick={() => void run((playback) => playback.seekByConfigured(bookId, 'backward'))} aria-label={`Back ${preferences.effective.backwardSkipMs / 1_000} seconds`}>
          <SkipBack aria-hidden="true" /><small>{preferences.effective.backwardSkipMs / 1_000}s</small>
        </button>
        <button className={tw('audiobook-player__play')} type="button" onClick={() => void run((playback) => playing ? playback.pause() : playback.play())} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
        </button>
        <button type="button" onClick={() => void run((playback) => playback.seekByConfigured(bookId, 'forward'))} aria-label={`Forward ${preferences.effective.forwardSkipMs / 1_000} seconds`}>
          <SkipForward aria-hidden="true" /><small>{preferences.effective.forwardSkipMs / 1_000}s</small>
        </button>
        <button type="button" onClick={() => void run((playback) => playback.nextChapter())} aria-label="Next chapter">
          <ChevronRight aria-hidden="true" /><small>Chapter</small>
        </button>
      </div>

      <div className={tw('audiobook-player__quick')}>
        <button type="button" onClick={() => void saveBookmark()}><Bookmark aria-hidden="true" /> Bookmark</button>
        <button type="button" onClick={() => document.getElementById('audiobook-quick-note')?.focus()}><StickyNote aria-hidden="true" /> Quick note</button>
        <button type="button" onClick={recording ? stopRecording : () => { void startVoiceCapture() }} className={tw(recording ? 'is-recording' : '')}>
          {recording ? <Square aria-hidden="true" /> : <Mic aria-hidden="true" />}
          {recording ? 'Save recording' : 'Voice note'}
        </button>
      </div>

      <section className={tw('audiobook-player__settings')} aria-label="Listening controls">
        <details open>
          <summary><Gauge aria-hidden="true" /><span>Speed</span><strong>{snapshot.rate.toFixed(snapshot.rate % 1 ? 2 : 0)}×</strong></summary>
          <div className={tw('audiobook-player__scope')}>
            <button type="button" aria-pressed={rateScope === 'book'} onClick={() => setRateScope('book')}>This book</button>
            <button type="button" aria-pressed={rateScope === 'global'} onClick={() => setRateScope('global')}>All books</button>
            {preferences.book?.rate !== undefined && <button type="button" onClick={() => void applyGlobalRate()}>Use global</button>}
          </div>
          <div className={tw('audiobook-player__presets')}>
            {speedPresets
              .filter((rate) => rate >= snapshot.capabilities.minimumRate && rate <= snapshot.capabilities.maximumRate)
              .map((rate) => (
                <button key={rate} type="button" aria-pressed={snapshot.rate === rate} onClick={() => void changeRate(rate)}>{rate}×</button>
              ))}
          </div>
          <p>Pitch stays natural. {rateScope === 'book' ? 'This speed follows this audiobook.' : 'This becomes the default for every audiobook.'}</p>
        </details>

        <details>
          <summary><Timer aria-hidden="true" /><span>Sleep & skips</span><strong>{snapshot.sleepTimer ? formatAudioTime(sleepRemainingMs) : 'Off'}</strong></summary>
          <div className={tw('audiobook-player__presets')}>
            {sleepPresets.map((minutes) => (
              <button key={minutes} type="button" onClick={() => void run((playback) => playback.setSleepTimer(minutes * 60_000))}>{minutes} min</button>
            ))}
            <button type="button" onClick={() => void run((playback) => playback.setSleepTimerAtChapterEnd())}>Chapter</button>
          </div>
          <div className={tw('audiobook-player__skip-fields')}>
            <label><span>Back</span><select value={preferences.effective.backwardSkipMs} onChange={(event) => void saveGlobalControl({ backwardSkipMs: Number(event.currentTarget.value) })}>{skipPresets.map((value) => <option key={value} value={value}>{value / 1_000} sec</option>)}</select></label>
            <label><span>Forward</span><select value={preferences.effective.forwardSkipMs} onChange={(event) => void saveGlobalControl({ forwardSkipMs: Number(event.currentTarget.value) })}>{skipPresets.map((value) => <option key={value} value={value}>{value / 1_000} sec</option>)}</select></label>
          </div>
          <button className={tw('audiobook-player__shake')} type="button" aria-pressed={preferences.effective.shakeToExtend} onClick={() => void toggleShake()}>
            <span><strong>Shake to extend</strong><small>Add {preferences.effective.shakeExtensionMs / 60_000} minutes only while a timer is active.</small></span><i aria-hidden="true" />
          </button>
        </details>
      </section>

      <section className={tw('audiobook-player__notes')} aria-labelledby="quick-notes-title">
        <header>
          <div><span>Exact timeline</span><h4 id="quick-notes-title">Bookmarks & notes</h4></div>
          <button type="button" onClick={() => void exportNotes()}><FileDown aria-hidden="true" /> Export</button>
        </header>
        <form onSubmit={(event) => { void saveTextNote(event) }}>
          <label htmlFor="audiobook-quick-note">Note at {formatAudioTime(snapshot.absolutePositionMs)}</label>
          <textarea id="audiobook-quick-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="A thought to return to…" />
          <div><button type="button" onClick={() => void saveBookmark()}><Bookmark aria-hidden="true" /> Bookmark with note</button><button type="submit" disabled={!note.trim()}><StickyNote aria-hidden="true" /> Save note</button></div>
        </form>
        <p className={tw('audiobook-player__privacy')}><Mic aria-hidden="true" /><span><strong>Voice notes are microphone-only.</strong> Playback pauses before recording; audiobook audio is never captured, mixed, or exported. Recordings remain in local app storage.</span></p>

        {annotations.length ? (
          <ol className={tw('audiobook-player__annotation-list')}>
            {annotations.map((annotation) => {
              const chapter = context.chapters.find(({ key }) => key === annotation.chapterId)?.title
              return (
                <li key={annotation.id}>
                  <div>
                    <span>{annotation.kind === 'bookmark' ? <Bookmark aria-hidden="true" /> : annotation.kind === 'voice-note' ? <Mic aria-hidden="true" /> : <StickyNote aria-hidden="true" />}</span>
                    <p><strong>{formatAudioTime(annotation.absolutePositionMs)}</strong><small>{chapter ?? 'Audiobook timeline'} · {annotation.kind.replace('-', ' ')}</small></p>
                    <button type="button" onClick={() => void removeAnnotation(annotation.id)} aria-label={`Delete annotation at ${formatAudioTime(annotation.absolutePositionMs)}`}><Trash2 aria-hidden="true" /></button>
                  </div>
                  {annotation.kind === 'voice-note' && voiceUrls[annotation.id] && <audio controls preload="metadata" src={voiceUrls[annotation.id]} aria-label={`Voice note at ${formatAudioTime(annotation.absolutePositionMs)}`} />}
                  {editingId === annotation.id ? (
                    <form onSubmit={(event) => { event.preventDefault(); void saveEditedNote(annotation.id) }}>
                      <input autoFocus value={editingNote} onChange={(event) => setEditingNote(event.target.value)} aria-label="Annotation note" />
                      <button type="submit">Save</button>
                    </form>
                  ) : annotation.note ? (
                    <button className={tw('audiobook-player__annotation-note')} type="button" onClick={() => { setEditingId(annotation.id); setEditingNote(annotation.note) }}>{annotation.note}</button>
                  ) : (
                    <button className={tw('audiobook-player__annotation-note')} type="button" onClick={() => { setEditingId(annotation.id); setEditingNote('') }}>Add a note</button>
                  )}
                </li>
              )
            })}
          </ol>
        ) : <p className={tw('audiobook-player__empty')}>Your first bookmark will keep the exact time and chapter here.</p>}
      </section>

      {issue && <p className={tw('audiobook-player__issue')} role="alert">{issue}</p>}
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
    throw new Error('Motion sensing is unavailable on this device. The sleep timer itself remains available.')
  }
  const motion = DeviceMotionEvent as typeof DeviceMotionEvent & {
    requestPermission?: () => Promise<'granted' | 'denied'>
  }
  if (motion.requestPermission && await motion.requestPermission() !== 'granted') {
    throw new Error('Motion access was not granted. The sleep timer itself remains available.')
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The listening control could not be updated.'
}

function safeFilename(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'audiobook'
}
