import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react'
import { Sheet } from '../app/components/Sheet'
import { ActionButton, BookCover } from '../design-system'
import type { LibraryBook } from '../library-model'
import { getStorageRuntime } from '../storage/runtime'
import { readActivity, readingStreak } from './activity'
import { usesPages, widgetBooks } from './snapshot'
import './widgets.css'

export function ReadingWidgetSheet({ books, initialBookId, streak, onClose, onSaved }: {
  books: LibraryBook[]; initialBookId?: string; streak: boolean; onClose: () => void; onSaved: () => Promise<unknown>
}) {
  const [activity, setActivity] = useState<Awaited<ReturnType<typeof readActivity>>>()
  const [loadError, setLoadError] = useState<string>()
  const [selected, setSelected] = useState(initialBookId)
  const [showStreak, setShowStreak] = useState(streak)
  useEffect(() => {
    let active = true
    void getStorageRuntime().then(({ database }) => readActivity(database)).then((value) => { if (active) setActivity(value) }).catch(() => { if (active) setLoadError('Reading activity could not be loaded. Close and try again.') })
    return () => { active = false }
  }, [])
  const ordered = widgetBooks(books, activity?.recent ?? new Map(), activity?.sources)
  const index = Math.max(0, ordered.findIndex((book) => book.id === selected))
  const book = books.find((candidate) => candidate.id === ordered[index]?.id)
  const stats = readingStreak(activity?.days ?? [])
  return (
    <Sheet title={showStreak ? 'Reading streak' : 'Record progress'} onClose={onClose}>
      {loadError ? <p role="alert">{loadError}</p> : !activity ? <p role="status">Loading your reading…</p> : showStreak ? (
        <div className="reading-widget-streak">
          <span className="reading-widget-streak__count">{activity ? stats.count : '—'}</span>
          <p>{stats.count === 1 ? 'day of reading' : 'days of reading'}</p>
          <small>{!activity ? 'Loading your reading…' : stats.readToday ? 'You’ve read today.' : stats.count ? 'A little reading today keeps it going.' : 'Every page is a beginning.'}</small>
          <ActionButton onClick={() => setShowStreak(false)}>Record progress</ActionButton>
        </div>
      ) : selected && !ordered.some((candidate) => candidate.id === selected) ? (
        <div className="reading-widget-empty"><p>This book is no longer in Reading.</p><ActionButton onClick={() => setSelected(undefined)}>Choose another book</ActionButton></div>
      ) : book ? (
        <>
          {ordered.length > 1 && <nav className="reading-widget-nav" aria-label="Currently reading books">
            <button aria-label="Previous book" onClick={() => setSelected(ordered[(index - 1 + ordered.length) % ordered.length]!.id)}><ChevronLeft aria-hidden="true" /></button>
            <span>{index + 1} of {ordered.length}</span>
            <button aria-label="Next book" onClick={() => setSelected(ordered[(index + 1) % ordered.length]!.id)}><ChevronRight aria-hidden="true" /></button>
          </nav>}
          <ProgressEntry key={book.id} book={book} source={activity.sources.get(book.id)} onSaved={onSaved} onClose={onClose} />
        </>
      ) : <p className="reading-widget-empty">Start a book in your library to record your next page.</p>}
    </Sheet>
  )
}

function ProgressEntry({ book, source, onSaved, onClose }: { book: LibraryBook; source?: string; onSaved: () => Promise<unknown>; onClose: () => void }) {
  const [byPage, setByPage] = useState(usesPages(book, source))
  const [draft, setDraft] = useState(String(byPage ? book.currentPage : book.progress))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const max = byPage ? book.pageCount : 100
  const value = Number(draft)
  const valid = draft.trim() !== '' && Number.isInteger(value) && value >= 0 && value <= max
  const adjust = (delta: number) => setDraft(String(Math.min(max, Math.max(0, (valid ? value : 0) + delta))))
  const save = async () => {
    if (!valid || saving) return
    setSaving(true)
    setError(undefined)
    try {
      const { library } = await getStorageRuntime()
      const latest = (await library.list()).find((candidate) => candidate.id === book.id)
      if (!latest || latest.shelf !== 'reading') throw new Error('This book is no longer in Reading.')
      if (latest.currentPage !== book.currentPage || latest.progress !== book.progress || latest.pageCount !== book.pageCount) {
        throw new Error('Progress changed while this was open. Close and reopen to use the latest position.')
      }
      const at = new Date().toISOString()
      await library.save({ ...latest,
        ...(value === max ? { shelf: 'finished', finishedAt: at } : {}),
        currentPage: byPage ? value : latest.pageCount ? Math.round(latest.pageCount * value / 100) : latest.currentPage,
        progress: value === max ? 100 : byPage ? Math.min(99, Math.round(value / max * 100)) : value,
        lastUpdatedAt: at,
      }, byPage ? 'page' : 'percent', latest.lastUpdatedAt)
      await onSaved()
      onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Progress could not be saved.') }
    finally { setSaving(false) }
  }
  return <form className="reading-widget-entry" onSubmit={(event) => { event.preventDefault(); void save() }}>
    <div className="reading-widget-book"><BookCover book={book} large /><div><h3>{book.title}</h3><p>{book.authors.join(', ')}</p></div></div>
    <label htmlFor="widget-progress">{byPage ? 'Which page are you on?' : 'How far have you read?'}</label>
    <div className="reading-widget-value">
      <button type="button" aria-label={byPage ? 'Previous page' : 'Decrease by one percent'} onClick={() => adjust(-1)}><Minus aria-hidden="true" /></button>
      <input id="widget-progress" type="number" inputMode="numeric" min={0} max={max} step={1} value={draft} onChange={(event) => setDraft(event.target.value)} autoFocus onFocus={(event) => event.target.select()} />
      <button type="button" aria-label={byPage ? 'Next page' : 'Increase by one percent'} onClick={() => adjust(1)}><Plus aria-hidden="true" /></button>
    </div>
    {book.pageCount > 0 ? <button className="reading-widget-unit" type="button" onClick={() => {
      setByPage(!byPage); setDraft(String(byPage ? book.progress : book.currentPage))
    }}>{byPage ? `of ${max} pages · Use percent` : 'percent · Use pages'}</button> : <small>percent</small>}
    {error && <p role="alert">{error}</p>}
    <ActionButton type="submit" disabled={!valid || saving}>{saving ? 'Saving…' : value === max ? 'Finish book' : 'Save progress'}</ActionButton>
  </form>
}
