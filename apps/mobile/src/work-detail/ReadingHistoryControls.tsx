import { useState } from 'react'
import type { LibraryBook } from '../library-model'

export function ReadingHistoryControls({ book, onMetadata, onReread }: {
  book: LibraryBook
  onMetadata: (changes: Partial<LibraryBook>) => void
  onReread?: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [date, setDate] = useState('')
  if (book.shelf !== 'finished') return null
  return <section className="book-progress" aria-label="Reading history">
    <div className="book-progress__label">
      <span>Finished</span>
      <span>{book.finishedAt ? new Date(book.finishedAt).toLocaleDateString() : 'Date not recorded'}</span>
    </div>
    {editing ? <form onSubmit={(event) => {
      event.preventDefault()
      if (!date) return
      // Keep a date-only choice on its local calendar date, avoiding UTC midnight shifts.
      const chosen = new Date(`${date}T12:00:00`)
      if (!Number.isFinite(chosen.getTime())) return
      onMetadata({ finishedAt: chosen.toISOString() })
      setEditing(false)
    }}>
      <label>Finish date <input type="date" value={date} required onChange={(event) => setDate(event.target.value)} /></label>
      <div className="book-progress__actions">
        <button type="submit">Save finish date</button>
        <button type="button" onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </form> : <div className="book-progress__actions">
      <button type="button" onClick={() => {
        const value = book.finishedAt ? new Date(book.finishedAt) : new Date()
        setDate(`${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`)
        setEditing(true)
      }}>Change finish date</button>
      {onReread && <button type="button" onClick={onReread}>Read again</button>}
    </div>}
  </section>
}
