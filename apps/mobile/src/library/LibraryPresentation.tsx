import { useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Grid2X2, List } from 'lucide-react'
import type { LibraryBook } from '../library'
import { BookCover, ProgressMeter } from '../design-system'
import { tw } from '../tailwind/styles'
import { motionStyles } from '../tailwind/motion'
import { readLibraryView, saveLibraryView } from './view-preference'
import { useLibraryDrag, type LibraryDropTarget } from './library-drag'
import { ViewContext, ChangeViewContext, useLibraryView } from './use-library-view'

export function LibraryPresentation({ books, onDropBook, children }: {
  books: readonly LibraryBook[]
  onDropBook: (bookId: string, target: LibraryDropTarget) => void
  children: ReactNode
}) {
  const [view, setView] = useState(readLibraryView)
  const root = useRef<HTMLDivElement>(null)
  const announcement = useLibraryDrag(root, books, onDropBook)
  useEffect(() => saveLibraryView(view), [view])

  return (
    <ViewContext value={view}>
      <ChangeViewContext value={setView}>
        <div ref={root} data-library-view={view} className={tw('library-presentation library-page', motionStyles.navigate)} data-motion-event="navigate">
          {children}
          <span className={tw('sr-only')} role="status">{announcement}</span>
        </div>
      </ChangeViewContext>
    </ViewContext>
  )
}

export function LibraryViewControl() {
  const view = useLibraryView()
  const setView = useContext(ChangeViewContext)
  return (
    <div className={tw('library-view-control')} role="group" aria-label="Library view">
      <button type="button" aria-label="List view" title="List view" aria-pressed={view === 'list'} onClick={() => setView('list')}>
        <List aria-hidden="true" />
      </button>
      <button type="button" aria-label="Grid view" title="Grid view" aria-pressed={view === 'grid'} onClick={() => setView('grid')}>
        <Grid2X2 aria-hidden="true" />
      </button>
    </div>
  )
}

export function LibraryViewHint() {
  return useLibraryView() === 'grid' ? (
    <p className={tw('library-view-hint')}>Open a cover for details. Hold or drag to move.</p>
  ) : null
}

export function BookTile({ book, onDetails, position, onReorder }: {
  book: LibraryBook
  onDetails: (id: string) => void
  position?: number
  onReorder?: (offset: number) => void
}) {
  const authors = book.authors.join(', ')
  return (
    <button
      type="button"
      className={tw('book-tile__button')}
      onClick={() => onDetails(book.id)}
      draggable
      data-library-book={book.id}
      title={`${book.title}${authors ? ` — ${authors}` : ''}${position ? ` · Position ${position}. Alt + arrow keys to reorder.` : ''}`}
      aria-label={`${book.title}${authors ? ` by ${authors}` : ''}${position ? `, position ${position}. Alt + arrow keys to reorder.` : ''}`}
      onKeyDown={(event) => {
        if (!onReorder || !event.altKey) return
        const offset = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1
          : ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : 0
        if (!offset) return
        event.preventDefault()
        onReorder(offset)
      }}
    >
      <BookCover book={book} large />
      <span className={tw('book-tile__copy')}>
        <strong>{book.title}</strong>
        <small>{authors || 'Unknown author'}</small>
      </span>
      {(position || book.shelf === 'reading' || (book.shelf === 'finished' && book.rating > 0)) && (
        <span className={tw('book-tile__meta')}>
          {position && <span>№ {String(position).padStart(2, '0')}</span>}
          {book.shelf === 'reading' && <><ProgressMeter value={book.progress} label={`${book.title} reading progress`} /><span>{book.progress}%</span></>}
          {book.shelf === 'finished' && book.rating > 0 && <span aria-label={`${book.rating} out of 5 stars`}>{'★'.repeat(book.rating)}</span>}
        </span>
      )}
    </button>
  )
}
