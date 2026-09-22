import { VirtualBookList } from '../library/VirtualBookList'
import { BookTile } from '../library/LibraryPresentation'
import { useLibraryView } from '../library/use-library-view'
import { libraryDropTarget } from '../library/library-drag'
import { useState, type FormEvent } from 'react'
import { Archive, ArchiveRestore, Check, ChevronDown, FolderCog, FolderPlus, Pin, Search, Trash2, X } from 'lucide-react'
import { ActionButton, BookCover, type MotionMode } from '../design-system'
import type { LibraryBook } from '../library'
import type { ShelfDraft } from '../organization'
import { orderedShelfEntries, tagsForBook, type CustomShelf, type LibraryOrganization } from '../organization-model'
import type { LocalSearchResult } from '../search'
import { shelfCopy } from '../app/config'
import { Sheet } from '../app/components/Sheet'
import { SearchBookCopy } from '../library/ShelfSection'
import { shelfCascadeItem, useShelfCascade } from '../library/shelf-cascade'
import { tw } from '../tailwind/styles'

function authorLine(authors: string[]) {
  return authors.join(', ')
}

export function CustomShelfSection({
  shelf,
  books,
  organization,
  isFiltering,
  searchResults,
  motionMode,
  libraryHydrated = true,
  onDetails,
  onManage,
}: {
  shelf: CustomShelf
  books: LibraryBook[]
  organization: LibraryOrganization
  isFiltering: boolean
  searchResults: ReadonlyMap<string, LocalSearchResult>
  motionMode: MotionMode
  libraryHydrated?: boolean
  onDetails: (id: string) => void
  onManage: () => void
}) {
  const grid = useLibraryView() === 'grid'
  const noteCount = shelf.notes ? 1 : 0
  const cascadeItemCount = noteCount + Math.max(books.length, 1)
  const { isCollapsed, toggle, cascadeProps } = useShelfCascade({
    itemCount: cascadeItemCount,
    preferenceKey: `custom:${shelf.id}`,
    bookCount: books.length,
    ready: libraryHydrated,
    motionMode,
    forceOpen: isFiltering,
  })

  return (
    <section className={tw('shelf custom-shelf')} id={`custom-shelf-${shelf.id}`} {...libraryDropTarget('custom', shelf.id, shelf.name)}>
      <header className={tw('shelf-header custom-shelf__header')}>
        <button
          type="button"
          className={tw('shelf-toggle')}
          onClick={toggle}
          aria-expanded={!isCollapsed}
          aria-controls={`custom-shelf-books-${shelf.id}`}
        >
          <h2>
            {shelf.pinned && <Pin aria-label="Pinned shelf" />}
            {shelf.name} <i>·</i> {books.length}
          </h2>
          <ChevronDown className={tw(isCollapsed ? 'is-collapsed' : '')} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={tw('shelf-add custom-shelf__manage')}
          onClick={onManage}
          aria-label={`Manage ${shelf.name}`}
        >
          <FolderCog aria-hidden="true" />
        </button>
      </header>

      <div className={tw('shelf-books')} id={`custom-shelf-books-${shelf.id}`} {...cascadeProps}>
        {shelf.notes && (
          <p className={tw('custom-shelf__note')} {...shelfCascadeItem(0, cascadeItemCount)}>{shelf.notes}</p>
        )}
        {!cascadeProps.hidden && (books.length === 0 ? (
          isFiltering ? (
            <div className={tw('empty-shelf empty-shelf--filter')} {...shelfCascadeItem(noteCount, cascadeItemCount)}>
              <Search aria-hidden="true" />
              <span><strong>No matches on this shelf</strong><small>Try another title, author, or tag</small></span>
            </div>
          ) : (
            <button className={tw('empty-shelf')} type="button" onClick={onManage} {...shelfCascadeItem(noteCount, cascadeItemCount)}>
              <FolderPlus aria-hidden="true" />
              <span><strong>Collect the first book</strong><small>Books keep their reading status</small></span>
            </button>
          )
        ) : (
          <VirtualBookList items={books} grid={grid} getKey={bookKey}>
            {(book, index) => {
              const tags = tagsForBook(organization, book.id)
              return (
                <article
                  className={tw(grid ? 'book-tile' : 'book-row custom-book-row')}
                  key={book.id}
                  {...shelfCascadeItem(noteCount + index, cascadeItemCount)}
                >
                  {grid ? <BookTile book={book} onDetails={onDetails} /> : <button className={tw('book-identity')} type="button" draggable data-library-book={book.id} onClick={() => onDetails(book.id)}>
                    <BookCover book={book} />
                    <SearchBookCopy book={book} result={searchResults.get(book.id)}>
                      <span className={tw('custom-book-row__meta')}>
                        <i>{shelfCopy[book.shelf].label}</i>
                        {tags.slice(0, 2).map((tag) => <em key={tag.id}>#{tag.name}</em>)}
                        {tags.length > 2 && <em>+{tags.length - 2}</em>}
                      </span>
                    </SearchBookCopy>
                  </button>}
                </article>
              )
            }}
          </VirtualBookList>
        ))}
      </div>
    </section>
  )
}

export function CustomShelfEditorSheet({
  shelf,
  organization,
  books,
  onClose,
  onSave,
  onArchive,
  onDelete,
}: {
  shelf?: CustomShelf
  organization: LibraryOrganization
  books: LibraryBook[]
  onClose: () => void
  onSave: (draft: ShelfDraft, orderedBookIds: readonly string[]) => void
  onArchive: (shelf: CustomShelf) => void
  onDelete: (shelf: CustomShelf) => void
}) {
  const initialBookIds = shelf
    ? orderedShelfEntries(organization, shelf.id).map(({ bookId }) => bookId)
    : []
  const [name, setName] = useState(shelf?.name ?? '')
  const [notes, setNotes] = useState(shelf?.notes ?? '')
  const [pinned, setPinned] = useState(shelf?.pinned ?? false)
  const [orderedBookIds, setOrderedBookIds] = useState(initialBookIds)
  const [query, setQuery] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const matchingBooks = books.filter((book) =>
    !normalizedQuery || [book.title, ...book.authors].some((value) =>
      value.toLocaleLowerCase().includes(normalizedQuery),
    ),
  )
  const visibleBooks = matchingBooks.slice(0, 80)
  const selectedIds = new Set(orderedBookIds)

  const toggleBook = (bookId: string) => {
    setOrderedBookIds((current) => current.includes(bookId)
      ? current.filter((id) => id !== bookId)
      : [...current, bookId])
  }

  const moveToPosition = (bookId: string, requestedPosition: number) => {
    setOrderedBookIds((current) => {
      const sourceIndex = current.indexOf(bookId)
      if (sourceIndex === -1) return current
      const targetIndex = Math.max(0, Math.min(current.length - 1, Math.round(requestedPosition) - 1))
      if (sourceIndex === targetIndex) return current
      const next = [...current]
      next.splice(sourceIndex, 1)
      next.splice(targetIndex, 0, bookId)
      return next
    })
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    onSave({ id: shelf?.id, name, notes, pinned, archived: shelf?.archived }, orderedBookIds)
  }

  return (
    <Sheet title={shelf ? `Edit ${shelf.name}` : 'New custom shelf'} onClose={onClose} tall>
      <form className={tw('custom-shelf-editor')} onSubmit={submit}>
        <div className={tw('custom-shelf-editor__intro')}>
          <span>Collection, not reading status</span>
          <p>Books can live on several custom shelves. Their TBR, Up Next, Reading, Finished, or DNF status stays unchanged.</p>
        </div>

        <label className={tw('shelf-field')}>
          <span>Shelf name</span>
          <input
            autoFocus
            required
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Small press favorites"
          />
        </label>

        <label className={tw('shelf-field')}>
          <span>Shelf note <i>optional</i></span>
          <textarea
            maxLength={1_000}
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Why these books belong together"
          />
        </label>

        <label className={tw('shelf-pin-field')}>
          <input type="checkbox" checked={pinned} onChange={(event) => setPinned(event.target.checked)} />
          <Pin aria-hidden="true" />
          <span><strong>Pin this shelf</strong><small>Keep a shortcut beneath your reading shelves</small></span>
        </label>

        <section className={tw('shelf-membership-editor')}>
          <header>
            <div><span>Books</span><h3>{orderedBookIds.length} selected</h3></div>
            <small>Checkboxes change membership only</small>
          </header>
          <div className={tw('shelf-book-search')}>
            <Search aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a book to add or reorder"
              aria-label="Find a book to add or reorder"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="Clear book search">
                <X aria-hidden="true" />
              </button>
            )}
          </div>

          <div className={tw('shelf-membership-list')}>
            {visibleBooks.map((book) => {
              const selected = selectedIds.has(book.id)
              const order = selected ? orderedBookIds.indexOf(book.id) + 1 : 0
              return (
                <div className={tw('shelf-membership-row')} key={book.id}>
                  <label>
                    <input type="checkbox" checked={selected} onChange={() => toggleBook(book.id)} />
                    <span><strong>{book.title}</strong><small>{authorLine(book.authors)}</small></span>
                  </label>
                  {selected && (
                    <label className={tw('shelf-position')}>
                      <span>Order</span>
                      <input
                        key={`${book.id}-${order}`}
                        type="number"
                        min="1"
                        max={orderedBookIds.length}
                        defaultValue={order}
                        onBlur={(event) => moveToPosition(book.id, Number(event.target.value))}
                        aria-label={`Position of ${book.title}`}
                      />
                    </label>
                  )}
                </div>
              )
            })}
            {!visibleBooks.length && <p className={tw('shelf-membership-empty')}>No matching books.</p>}
          </div>
          {matchingBooks.length > visibleBooks.length && (
            <p className={tw('shelf-result-limit')}>
              Showing 80 of {matchingBooks.length}. Refine the search to reach any book without loading the entire library.
            </p>
          )}
          <p className={tw('shelf-order-help')}>Set any selected book’s order number to move it without dragging.</p>
        </section>

        <ActionButton type="submit" disabled={!name.trim()}>
          <Check aria-hidden="true" /> {shelf ? 'Save shelf' : 'Create shelf'}
        </ActionButton>

        {shelf && (
          <div className={tw('custom-shelf-editor__danger')}>
            <button type="button" onClick={() => onArchive(shelf)}>
              {shelf.archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
              <span>
                <strong>{shelf.archived ? 'Restore shelf' : 'Archive shelf'}</strong>
                <small>{shelf.archived ? 'Return it to My Books' : 'Hide this shelf; every book stays in your library'}</small>
              </span>
            </button>
            <button
              className={tw('remove-action')}
              type="button"
              onClick={() => (confirmDelete ? onDelete(shelf) : setConfirmDelete(true))}
            >
              <Trash2 aria-hidden="true" />
              <span>
                <strong>{confirmDelete ? 'Tap again to delete shelf' : 'Delete shelf'}</strong>
                <small>Deletes membership and the shelf only—not the books</small>
              </span>
            </button>
          </div>
        )}
      </form>
    </Sheet>
  )
}

function bookKey(book: LibraryBook) { return book.id }
