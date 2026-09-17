import { VirtualBookList } from './VirtualBookList'
import { BookTile } from './LibraryPresentation'
import { useLibraryView } from './use-library-view'
import { libraryDropTarget } from './library-drag'
import type { ReactNode } from 'react'
import { ArrowRight, ChevronDown, CirclePlus, Plus, Search } from 'lucide-react'
import { BookCover, ProgressMeter, RatingStars, type MotionMode } from '../design-system'
import type { LibraryBook, ShelfId } from '../library'
import type { LocalSearchResult, SearchHighlight } from '../search'
import { shelfCopy } from '../app/config'
import { tw } from '../tailwind/styles'
import { shelfCascadeItem, useShelfCascade } from './shelf-cascade'
import { useAnimatedShelfBooks, type ShelfMotionEvent } from './shelf-motion'
import { FinishBookAction } from './FinishBookAction'

function SearchHighlightedText({ value, highlight }: { value: string; highlight?: SearchHighlight }) {
  if (!highlight?.ranges.length) return value
  const parts: ReactNode[] = []
  let offset = 0
  for (const range of highlight.ranges) {
    if (range.start > offset) parts.push(value.slice(offset, range.start))
    parts.push(<mark key={`${range.start}:${range.end}`}>{value.slice(range.start, range.end)}</mark>)
    offset = range.end
  }
  if (offset < value.length) parts.push(value.slice(offset))
  return parts
}

function highlightFor(
  result: LocalSearchResult | undefined,
  field: SearchHighlight['field'],
  value: string,
): SearchHighlight | undefined {
  return result?.highlights.find((highlight) => highlight.field === field && highlight.value === value)
}

export function SearchBookCopy({
  book,
  result,
  children,
}: {
  book: LibraryBook
  result?: LocalSearchResult
  children?: ReactNode
}) {
  const context = result?.highlights.find(({ field }) => field !== 'title' && field !== 'contributor')
  const contextLabels: Partial<Record<SearchHighlight['field'], string>> = {
    'alternate-title': 'Also titled',
    series: 'Series',
    identifier: 'Identifier',
    tag: 'Tag',
    list: 'Shelf',
    note: 'Private note',
    source: 'Source',
    edition: 'Edition',
  }

  return (
    <span className={tw('book-copy')}>
      <strong>
        <SearchHighlightedText value={book.title} highlight={highlightFor(result, 'title', book.title)} />
      </strong>
      <small>
        {book.authors.map((author, index) => (
          <span key={`${author}:${index}`}>
            {index > 0 && ', '}
            <SearchHighlightedText value={author} highlight={highlightFor(result, 'contributor', author)} />
          </span>
        ))}
      </small>
      {(book.format || context) && (
        <em className={tw('book-search-context')}>
          {book.format && <span>{book.format}</span>}
          {context && (
            <span>
              {contextLabels[context.field]} ·{' '}
              <SearchHighlightedText value={context.value} highlight={context} />
            </span>
          )}
        </em>
      )}
      {children}
    </span>
  )
}

export function ShelfSection({
  shelf,
  books,
  isFiltering,
  searchResults,
  onAdd,
  onDetails,
  onProgress,
  onNext,
  onStart,
  onFinish,
  onDnf,
  onRate,
  shelfMotion,
  motionMode,
  libraryHydrated,
}: {
  shelf: ShelfId
  books: LibraryBook[]
  isFiltering: boolean
  searchResults: ReadonlyMap<string, LocalSearchResult>
  onAdd: (shelf: ShelfId) => void
  onDetails: (id: string) => void
  onProgress: (id: string) => void
  onNext: (id: string) => void
  onStart: (id: string) => void
  onFinish: (id: string) => void
  onDnf: (id: string) => void
  onRate: (id: string, rating: number) => void
  shelfMotion?: ShelfMotionEvent
  motionMode: MotionMode
  libraryHydrated: boolean
}) {
  const grid = useLibraryView() === 'grid'
  const meta = shelfCopy[shelf]
  const relevantMotionSequence = shelfMotion?.from === shelf || shelfMotion?.to === shelf
    ? shelfMotion.sequence
    : undefined
  const { displayedBooks, animating, setRowElement } = useAnimatedShelfBooks({
    books,
    shelf,
    event: shelfMotion,
    motionMode,
    ready: libraryHydrated,
  })
  const cascadeItemCount = Math.max(displayedBooks.length, 1)
  const { isCollapsed, toggle, cascadeProps } = useShelfCascade({
    itemCount: cascadeItemCount,
    motionMode,
    forceOpen: isFiltering,
    expansionKey: relevantMotionSequence,
  })
  return (
    <section className={tw(`shelf shelf--${shelf}`)} id={`shelf-${shelf}`} data-shelf={shelf} {...libraryDropTarget('status', shelf, meta.label)}>
      <header className={tw('shelf-header')}>
        <button
          type="button"
          className={tw('shelf-toggle')}
          onClick={toggle}
          aria-expanded={!isCollapsed}
          aria-controls={`shelf-books-${shelf}`}
        >
          <h2>{meta.label} <i>·</i> {books.length}</h2>
          <ChevronDown className={tw(isCollapsed ? 'is-collapsed' : '')} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={tw('shelf-add')}
          onClick={() => onAdd(shelf)}
          aria-label={`Add a book to ${meta.label}`}
        >
          <Plus aria-hidden="true" />
        </button>
      </header>

      <div
        className={tw('shelf-books')}
        id={`shelf-books-${shelf}`}
        {...cascadeProps}
        aria-busy={animating || undefined}
      >
        {!cascadeProps.hidden && (displayedBooks.length === 0 ? (
          isFiltering ? (
            <div className={tw('empty-shelf empty-shelf--filter')} {...shelfCascadeItem(0, cascadeItemCount)}>
              <Search aria-hidden="true" />
              <span><strong>No matches on this shelf</strong><small>Try another title or author</small></span>
            </div>
          ) : (
            <button className={tw('empty-shelf')} type="button" onClick={() => onAdd(shelf)} {...shelfCascadeItem(0, cascadeItemCount)}>
              <CirclePlus aria-hidden="true" />
              <span><strong>{meta.empty}</strong><small>Add a title to this shelf</small></span>
            </button>
          )
        ) : (
          <VirtualBookList items={displayedBooks} grid={grid} getKey={animatedBookKey}>
            {({ book, motion }, index) => (
              <article
                className={tw(grid ? 'book-tile' : 'book-row')}
                key={book.id}
                ref={(element) => { setRowElement(book.id, element) }}
                data-shelf-motion={motion === 'idle' ? undefined : motion}
                {...shelfCascadeItem(index, cascadeItemCount)}
              >
                {grid ? <BookTile book={book} onDetails={onDetails} /> : <>
                  <button className={tw('book-identity')} type="button" draggable data-library-book={book.id} onClick={() => onDetails(book.id)}>
                    <BookCover book={book} />
                    <SearchBookCopy book={book} result={searchResults.get(book.id)} />
                  </button>

                  {shelf === 'tbr' && (
                    <button className={tw('row-action row-action--next')} type="button" onClick={() => onNext(book.id)}>
                      Next <ArrowRight aria-hidden="true" />
                    </button>
                  )}
                  {shelf === 'next' && (
                    <button className={tw('row-action row-action--start')} type="button" onClick={() => onStart(book.id)}>
                      Start <ArrowRight aria-hidden="true" />
                    </button>
                  )}
                  {shelf === 'reading' && (
                    <div className={tw('reading-actions')}>
                      <button className={tw('progress-button')} type="button" onClick={() => onProgress(book.id)}>
                        <span>{book.progress}%</span>
                        <ProgressMeter value={book.progress} label={`${book.title} reading progress`} />
                      </button>
                      <FinishBookAction onFinish={() => onFinish(book.id)} onDnf={() => onDnf(book.id)} />
                    </div>
                  )}
                  {shelf === 'finished' && (
                    <RatingStars compact value={book.rating} onChange={(rating) => onRate(book.id, rating)} />
                  )}
                </>}
                {shelf === 'dnf' && (
                  <button className={tw('row-action')} type="button" onClick={() => onStart(book.id)} aria-label={`Return ${book.title} to Reading`}>
                    Resume <ArrowRight aria-hidden="true" />
                  </button>
                )}
              </article>
            )}
          </VirtualBookList>
        ))}
      </div>
    </section>
  )
}

function animatedBookKey({ book }: { book: LibraryBook }) { return book.id }
