import { useEffect, useId, useState, type ReactNode } from 'react'
import { BookOpen, Headphones, Plus, RefreshCw } from 'lucide-react'
import { OpenLibbyLink } from '../libby/OpenLibbyLink'
import { SourcePicker } from './SourcePicker'
import type { LibraryBook } from '../library-model'
import { OriginalFileInput } from '../files/OriginalFileInput'
import { getStorageRuntime } from '../storage/runtime'
import type { AudiobookAttachmentState, EpubAttachmentState } from './WorkDetailExperience'

type LocalSource = 'ebook' | 'audio'

/** Imported records, rather than catalog format labels, identify an attached source. */
export function BookSource({ book, libby, libbyLinked = false, onRead, onAttachEpub, onAttachAudiobook,
  epubBusy, epubImport, audiobookBusy, audiobookImport }: {
  readonly book: LibraryBook
  readonly libby?: ReactNode
  readonly libbyLinked?: boolean
  readonly onRead: (source?: LocalSource) => void
  readonly onAttachEpub: (files: readonly File[], overwriteCover: boolean) => void
  readonly onAttachAudiobook: (files: readonly File[], overwriteCover: boolean) => void
  readonly epubBusy: boolean
  readonly epubImport: EpubAttachmentState
  readonly audiobookBusy: boolean
  readonly audiobookImport: AudiobookAttachmentState
}) {
  const id = useId()
  const [source, setSource] = useState<LocalSource | null>()
  const [error, setError] = useState<string>()
  const [retry, setRetry] = useState(0)
  const [choice, setChoice] = useState('ebook')
  const [attempt, setAttempt] = useState<LocalSource>()
  const [overwriteCover, setOverwriteCover] = useState(false)
  const [changing, setChanging] = useState(false)
  const busy = epubBusy || audiobookBusy
  const importError = attempt === 'audio' ? audiobookImport.error : attempt === 'ebook' ? epubImport.error : undefined
  const epubResult = epubImport.result?.bookId === book.id ? epubImport.result : undefined
  const audioResult = audiobookImport.result?.bookId === book.id ? audiobookImport.result : undefined

  useEffect(() => {
    let cancelled = false
    void getStorageRuntime().then(async ({ database }) => {
      const rows = await database.query(
        `SELECT 'ebook' AS kind, imported_at, id FROM epub_imports WHERE book_id = ?
         UNION ALL SELECT 'audio' AS kind, imported_at, id FROM audiobook_imports WHERE book_id = ?
         ORDER BY imported_at DESC, id DESC LIMIT 1`, [book.id, book.id])
      if (cancelled) return
      setSource(rows[0]?.kind === 'audio' ? 'audio' : rows[0] ? 'ebook' : null)
      setError(undefined)
      setChanging(false)
    }).catch(() => { if (!cancelled) setError('Your attachment could not be checked.') })
    return () => { cancelled = true }
  }, [book.id, epubResult, audioResult, retry])


  const picker = <div className="book-source__picker">
    <SourcePicker value={choice} onChange={setChoice} disabled={busy} includeLibby={Boolean(libby)} />
    {choice === 'libby' ? libby : <>
      <label className="book-source__file">
        <Plus size={18} aria-hidden="true" />
        <span>{busy ? 'Attaching…' : choice === 'audio' ? 'Attach audio' : 'Attach book'}</span>
        <OriginalFileInput key={choice} kind={choice === 'audio' ? 'audio' : 'ebook'}
          aria-label={choice === 'audio' ? 'Choose audio files' : 'Choose book file'}
          accept={choice === 'audio' ? '.m4b,.m4a,.mp4,.mp3,audio/mpeg,audio/mp4' : '.epub,.pdf,application/epub+zip,application/pdf'}
          multiple={choice === 'audio'} disabled={busy}
          onFiles={files => {
            setAttempt(choice === 'audio' ? 'audio' : 'ebook')
            if (choice === 'audio') onAttachAudiobook(files, overwriteCover)
            else onAttachEpub(files, overwriteCover)
          }} />
      </label>
      <details className="book-source__options">
        <summary>Import options</summary>
        <label><input type="checkbox" checked={overwriteCover} disabled={busy} onChange={event => setOverwriteCover(event.target.checked)} /> Use the file’s cover</label>
        <p>Missing covers are filled automatically.</p>
      </details>
    </>}
  </div>

  return <section className="book-source" aria-label="Reading source" aria-busy={busy}>
    {libbyLinked ? <>
      <div className="book-source__heading"><BookOpen size={19} aria-hidden="true" /><span>Reading with Libby</span></div>
      <OpenLibbyLink />
      {libby}
    </> : error ? <div role="alert"><p>{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>Try again</button></div>
      : source === undefined ? <p className="book-source__caption" role="status">Checking attachment…</p>
        : source ? <>
          <div className="book-source__heading">
            {source === 'audio' ? <Headphones size={19} aria-hidden="true" /> : <BookOpen size={19} aria-hidden="true" />}
            <span>{source === 'audio' ? 'Audiobook' : 'E-reader'}</span>
            <button type="button" aria-expanded={changing} aria-controls={`${id}-change`} disabled={busy} onClick={() => setChanging(value => !value)}>{changing ? 'Cancel' : 'Change'}</button>
          </div>
          <button className="book-source__primary" type="button" onClick={() => onRead(source)} disabled={busy}>
            {source === 'audio' ? <Headphones size={18} aria-hidden="true" /> : <BookOpen size={18} aria-hidden="true" />}
            {book.progress > 0 && book.shelf !== 'finished' ? 'Continue' : 'Start'} {source === 'audio' ? 'listening' : 'reading'}
          </button>
          <div id={`${id}-change`} hidden={!changing}>{changing && picker}</div>
        </> : <>
          {picker}
        </>}
    {(busy || importError) && <p className="book-source__message" role={importError ? 'alert' : 'status'}>
      {busy && <RefreshCw size={16} aria-hidden="true" />}
      {importError ?? (epubBusy ? epubImport.progress?.detail : audiobookImport.progress?.detail) ?? 'Attaching your file…'}
    </p>}
  </section>
}
