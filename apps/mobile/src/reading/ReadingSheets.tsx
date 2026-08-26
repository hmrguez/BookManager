import type { CSSProperties } from 'react'
import { Check, Clock3, Minus, Plus } from 'lucide-react'
import { ActionButton, BookCover, RatingStars } from '../design-system'
import type { LibraryBook } from '../library'
import { Sheet } from '../app/components/Sheet'
import { tw } from '../tailwind/styles'
import { motionStyles } from '../tailwind/motion'

function authorLine(authors: string[]) {
  return authors.join(', ')
}

function formatUpdated(value: string) {
  const date = new Date(value)
  const today = new Date()
  const isToday = date.toDateString() === today.toDateString()
  return `${isToday ? 'Today' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} at ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
}

export function ProgressSheet({
  book,
  onClose,
  onProgress,
  onPage,
  onFinish,
}: {
  book: LibraryBook
  onClose: () => void
  onProgress: (progress: number) => void
  onPage: (page: number) => void
  onFinish: () => void
}) {
  return (
    <Sheet title="Update progress" onClose={onClose}>
      <div className={tw('sheet-book-line')}>
        <BookCover book={book} />
        <div><strong>{book.title}</strong><small>{authorLine(book.authors)}</small></div>
      </div>

      <div className={tw('progress-editor')}>
        <button type="button" onClick={() => onProgress(book.progress - 5)} aria-label="Decrease by 5 percent">
          <Minus aria-hidden="true" />
        </button>
        <div className={tw('progress-editor__value')}>
          <output>{book.progress}<span>%</span></output>
          <i className={tw('progress-editor__meter')} aria-hidden="true">
            <b className={tw(motionStyles.progressFill)} style={{ width: `${book.progress}%` }} />
          </i>
        </div>
        <button type="button" onClick={() => onProgress(book.progress + 5)} aria-label="Increase by 5 percent">
          <Plus aria-hidden="true" />
        </button>
      </div>

      <div className={tw('progress-presets')} aria-label="Progress presets">
        {[25, 50, 75].map((progress) => (
          <button type="button" key={progress} onClick={() => onProgress(progress)}>{progress}%</button>
        ))}
        <button type="button" onClick={onFinish}>Finished</button>
      </div>

      {book.pageCount > 0 && (
        <div className={tw('page-progress')}>
          <label htmlFor="current-page">Or set by page</label>
          <div className={tw('page-input-line')}>
            <input
              id="current-page"
              type="number"
              inputMode="numeric"
              min="0"
              max={book.pageCount}
              value={book.currentPage}
              onChange={(event) => onPage(Number(event.target.value))}
            />
            <span>/ {book.pageCount} pages</span>
          </div>
          <input
            className={tw('page-range')}
            type="range"
            min="0"
            max={book.pageCount}
            value={book.currentPage}
            aria-label="Current page"
            onChange={(event) => onPage(Number(event.target.value))}
            style={{ '--range-progress': `${(book.currentPage / book.pageCount) * 100}%` } as CSSProperties}
          />
          <div className={tw('range-labels')}><span>0</span><span>{book.pageCount}</span></div>
        </div>
      )}

      <p className={tw('updated-time')}><Clock3 aria-hidden="true" /> Last updated {formatUpdated(book.lastUpdatedAt)}</p>
    </Sheet>
  )
}

export function FinishedSheet({
  book,
  onClose,
  onRate,
}: {
  book: LibraryBook
  onClose: () => void
  onRate: (rating: number) => void
}) {
  return (
    <Sheet title="Finished" onClose={onClose}>
      <div className={tw('finish-celebration', motionStyles.complete)} data-motion-event="complete">
        <BookCover book={book} large />
        <div>
          <span className={tw('finish-mark')}><Check aria-hidden="true" /></span>
          <p>Another story, kept.</p>
          <h3>{book.title}</h3>
          <small>{authorLine(book.authors)}</small>
        </div>
      </div>
      <div className={tw('finish-rating')}>
        <span>Your rating</span>
        <RatingStars value={book.rating} onChange={onRate} />
        <small>{book.rating ? `${book.rating} out of 5` : 'Optional — tap a star'}</small>
      </div>
      <ActionButton type="button" onClick={onClose}>Done</ActionButton>
    </Sheet>
  )
}
