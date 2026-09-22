import { VirtualBookList } from './library/VirtualBookList'
import { BookTile } from './library/LibraryPresentation'
import { useLibraryView } from './library/use-library-view'
import { libraryDropTarget } from './library/library-drag'
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  Plus,
} from 'lucide-react'
import { BookCover, type MotionMode } from './design-system'
import type { LibraryBook } from './library-model'
import { useAnimatedShelfBooks, type ShelfMotionEvent } from './library/shelf-motion'
import { shelfCascadeItem, useShelfCascade } from './library/shelf-cascade'
import { tw } from './tailwind/styles'

export function UpNextSection({
  books,
  isFiltering,
  onAdd,
  onDetails,
  onStart,
  onMove,
  shelfMotion,
  motionMode,
  libraryHydrated,
}: {
  books: readonly LibraryBook[]
  isFiltering: boolean
  onAdd: () => void
  onDetails: (bookId: string) => void
  onStart: (bookId: string) => void
  onMove: (bookId: string, targetIndex: number) => void
  shelfMotion?: ShelfMotionEvent
  motionMode: MotionMode
  libraryHydrated: boolean
}) {
  const grid = useLibraryView() === 'grid'
  const relevantMotionSequence = shelfMotion?.from === 'next' || shelfMotion?.to === 'next'
    ? shelfMotion.sequence
    : undefined
  const { displayedBooks, animating, setRowElement } = useAnimatedShelfBooks({
    books,
    shelf: 'next',
    event: shelfMotion,
    motionMode,
    ready: libraryHydrated,
  })
  const cascadeItemCount = Math.max(displayedBooks.length, 1)
  const { isCollapsed, toggle, cascadeProps } = useShelfCascade({
    itemCount: cascadeItemCount,
    preferenceKey: 'status:next',
    bookCount: books.length,
    ready: libraryHydrated,
    motionMode,
    forceOpen: isFiltering,
    expansionKey: relevantMotionSequence,
  })
  return (
    <section className={tw("shelf shelf--next up-next")} id="shelf-next" data-shelf="next" {...libraryDropTarget('status', 'next', 'Up Next')}>
      <header className={tw("shelf-header up-next__header")}>
        <button
          type="button"
          className={tw("shelf-toggle")}
          onClick={toggle}
          aria-expanded={!isCollapsed}
          aria-controls="shelf-books-next"
        >
          <h2>Up Next <i>·</i> {books.length}</h2>
          <ChevronDown className={tw(isCollapsed ? 'is-collapsed' : '')} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={tw("shelf-add")}
          onClick={onAdd}
          aria-label="Add a book to Up Next"
        >
          <Plus aria-hidden="true" />
        </button>
      </header>

      <div
        className={tw("shelf-books")}
        id="shelf-books-next"
        {...cascadeProps}
        aria-busy={animating || undefined}
      >
        {!cascadeProps.hidden && (displayedBooks.length === 0 ? (
          <button
            className={tw("empty-shelf")}
            type="button"
            onClick={onAdd}
            {...shelfCascadeItem(0, cascadeItemCount)}
          >
            <Plus aria-hidden="true" />
            <span>
              <strong>Choose what comes next</strong>
              <small>Add a title, then arrange it your way</small>
            </span>
          </button>
        ) : (
          <VirtualBookList className="up-next__queue" items={displayedBooks} grid={grid} estimateSize={69} getKey={animatedBookKey}>
            {({ book, motion }, index) => {
              return (
                <article
                  className={tw(grid ? 'book-tile' : 'up-next-book')}
                  key={book.id}
                  ref={(element) => { setRowElement(book.id, element) }}
                  data-shelf-motion={motion === 'idle' ? undefined : motion}
                  {...shelfCascadeItem(index, cascadeItemCount)}
                >
                  {grid ? <BookTile book={book} onDetails={onDetails} position={index + 1} onReorder={(offset) => onMove(book.id, index + offset)} /> : <>
                    <span className={tw("up-next-book__number")} aria-label={`Position ${index + 1}`}>
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <button className={tw("book-identity")} type="button" draggable data-library-book={book.id} onClick={() => onDetails(book.id)}>
                      <BookCover book={book} />
                      <span className={tw("book-copy")}>
                        <strong>{book.title}</strong>
                        <small>{book.authors.join(', ')}</small>
                        {book.format && (
                          <em className={tw("up-next-book__note")}>{book.format}</em>
                        )}
                      </span>
                    </button>
                    <div className={tw("up-next-book__actions")}>
                      <button
                        type="button"
                        className={tw("up-next-book__move")}
                        onClick={() => onMove(book.id, index - 1)}
                        disabled={index === 0}
                        aria-label={`Move ${book.title} earlier`}
                      >
                        <ArrowUp aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className={tw("up-next-book__move")}
                        onClick={() => onMove(book.id, index + 1)}
                        disabled={index === displayedBooks.length - 1}
                        aria-label={`Move ${book.title} later`}
                      >
                        <ArrowDown aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className={tw("row-action up-next-book__start")}
                        onClick={() => onStart(book.id)}
                        aria-label={`Start reading ${book.title}`}
                      >
                        Start <ArrowRight aria-hidden="true" />
                      </button>
                    </div>
                  </>}
                </article>
              )
            }}
          </VirtualBookList>
        ))}


      </div>
    </section>
  )
}

function animatedBookKey({ book }: { book: LibraryBook }) { return book.id }
