import { t, useLanguage } from '../localization'
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
  useLanguage()
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
  useLanguage()
  const view = useLibraryView()
  const setView = useContext(ChangeViewContext)
  return (
    <div className={tw('library-view-control')} role="group" aria-label={t("Library view")}>
      <button type="button" aria-label={t("List view")} title={t("List view")} aria-pressed={view === 'list'} onClick={() => setView('list')}>
        <List aria-hidden="true" />
      </button>
      <button type="button" aria-label={t("Grid view")} title={t("Grid view")} aria-pressed={view === 'grid'} onClick={() => setView('grid')}>
        <Grid2X2 aria-hidden="true" />
      </button>
    </div>
  )
}

export function LibraryViewHint() {
  useLanguage()
  return useLibraryView() === 'grid' ? (
    <p className={tw('library-view-hint')}>{t("Open a cover for details. Hold or drag to move.")}</p>
  ) : null
}

export function BookTile({ book, onDetails, position, onReorder }: {
  book: LibraryBook
  onDetails: (id: string) => void
  position?: number
  onReorder?: (offset: number) => void
}) {
  useLanguage()
  const authors = book.authors.join(', ')
  return (
    <button
      type="button"
      className={tw('book-tile__button')}
      onClick={() => onDetails(book.id)}
      draggable
      data-library-book={book.id}
      title={`${book.title}${authors ? t(" — {{v0}}", { v0: authors }) : ''}${position ? t(" · Position {{v0}}. Alt + arrow keys to reorder.", { v0: position }) : ''}`}
      aria-label={`${book.title}${authors ? t(" by {{v0}}", { v0: authors }) : ''}${position ? t(", position {{v0}}. Alt + arrow keys to reorder.", { v0: position }) : ''}`}
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
        <small>{authors || t("Unknown author")}</small>
      </span>
      {(position || book.shelf === 'reading' || (book.shelf === 'finished' && book.rating > 0)) && (
        <span className={tw('book-tile__meta')}>
          {position && <span>№ {String(position).padStart(2, '0')}</span>}
          {book.shelf === 'reading' && <><ProgressMeter value={book.progress} label={t("{{v0}} reading progress", { v0: book.title })} /><span>{book.progress}%</span></>}
          {book.shelf === 'finished' && book.rating > 0 && <span aria-label={t("{{v0}} out of 5 stars", { v0: book.rating })}>{'★'.repeat(book.rating)}</span>}
        </span>
      )}
    </button>
  )
}
