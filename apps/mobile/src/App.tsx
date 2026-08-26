import {
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from 'react'
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ArrowRight,
  BookCheck,
  BookPlus,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  CirclePlus,
  Clock3,
  Command as CommandIcon,
  Download,
  FileUp,
  FileText,
  FolderCog,
  FolderPlus,
  History,
  Library,
  Minus,
  Palette,
  Pin,
  Plus,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  Table2,
  Trash2,
  Wrench,
  X,
} from 'lucide-react'
import { searchGoogleBooks } from './googleBooks'
import {
  SHELVES,
  useLibrary,
  type BookSearchResult,
  type LibraryBook,
  type ShelfId,
} from './library'
import {
  CONTRAST_MODES,
  MOTION_MODES,
  PAPER_MODES,
  TYPE_SCALES,
  applyAppearance,
  ActionButton,
  BookCover,
  getAppearanceStorage,
  ProgressMeter,
  RatingStars,
  readAppearance,
  motionScrollBehavior,
  writeAppearance,
  type AppearancePreferences,
} from './design-system'
import { ImportReviewPage } from './imports/ImportReviewPage'
import type { ImportBatchSummary, ImportPreview, ImportReviewDecision } from './imports'
import { useOrganization, type ShelfDraft } from './organization'
import {
  orderedShelfEntries,
  tagsForBook,
  type CustomShelf,
  type LibraryOrganization,
} from './organization-model'
import {
  CommandPalette,
  getSearchPreferencesStorage,
  readSearchPreferences,
  useLibrarySearchIndex,
  writeSearchPreferences,
  type LocalSearchResult,
  type LocalSearchSort,
  type SearchHighlight,
  type SearchPreferences,
} from './search'
import { getStorageRuntime } from './storage/runtime'
import { UpNextSection, UpNextSettings } from './UpNext'
import { useUpNext } from './up-next'
import { WorkDetailExperience } from './work-detail/WorkDetailExperience'
import {
  buildUpNextSuggestions,
  orderedUpNextBooks,
} from './up-next-model'
import './App.css'

type SheetState =
  | { kind: 'search'; shelf: ShelfId; manual?: boolean }
  | { kind: 'detail'; bookId: string }
  | { kind: 'progress'; bookId: string }
  | { kind: 'finished'; bookId: string }
  | { kind: 'custom-shelf'; shelfId?: string }
  | { kind: 'up-next' }
  | null

type AppView = 'library' | 'settings' | 'import'
type ToastState = { message: string; undo?: () => void; family?: 'undo' } | null
type ExportFormat = 'archive' | 'csv' | 'markdown'

const MANUAL_ENTRY_ENABLED =
  import.meta.env.DEV || import.meta.env.VITE_ENABLE_MANUAL_BOOKS === 'true'
const GOOGLE_BOOKS_KEY_CONFIGURED = Boolean(import.meta.env.VITE_GOOGLE_BOOKS_API_KEY)

const appearanceLabels = {
  paperMode: {
    warm: 'Warm',
    cool: 'Cool',
    print: 'Print',
    night: 'Night',
  },
  contrast: {
    system: 'System',
    standard: 'Standard',
    high: 'High',
  },
  typeScale: {
    standard: '100%',
    large: '113%',
    'x-large': '125%',
  },
  motion: {
    system: 'System',
    reduced: 'Reduced',
  },
} as const

const shelfCopy: Record<ShelfId, { label: string; eyebrow: string; empty: string }> = {
  tbr: {
    label: 'To Be Read',
    eyebrow: 'A home for every maybe',
    empty: 'Save something for later',
  },
  next: {
    label: 'Up Next',
    eyebrow: 'Your shortest shortlist',
    empty: 'Choose what comes next',
  },
  reading: {
    label: 'Reading',
    eyebrow: 'The books in your hands',
    empty: 'Start your next read',
  },
  finished: {
    label: 'Finished',
    eyebrow: 'A private reading record',
    empty: 'Finished books land here',
  },
}

function authorLine(authors: string[]) {
  return authors.join(', ')
}

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

function SearchBookCopy({
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
    <span className="book-copy">
      <strong>
        <SearchHighlightedText value={book.title} highlight={highlightFor(result, 'title', book.title)} />
      </strong>
      <small>
        {book.authors.map((author, index) => (
          <span key={`${author}:${index}`}>
            {index > 0 && ', '}
            <SearchHighlightedText
              value={author}
              highlight={highlightFor(result, 'contributor', author)}
            />
          </span>
        ))}
      </small>
      {(book.format || context) && (
        <em className="book-search-context">
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

function formatUpdated(value: string) {
  const date = new Date(value)
  const today = new Date()
  const isToday = date.toDateString() === today.toDateString()
  return `${isToday ? 'Today' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} at ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
}

function downloadTextFile(contents: string, filename: string, mediaType: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: mediaType }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.hidden = true
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function Sheet({
  title,
  onClose,
  children,
  tall = false,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  tall?: boolean
}) {
  const dialogRef = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)

  useLayoutEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [])

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog || dialog.contains(document.activeElement)) return

    const target = dialog.querySelector<HTMLElement>('[autofocus], button, input, textarea, select')
    target?.focus({ preventScroll: true })
  }, [])

  const containFocus = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return

    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ) ?? [])].filter((element) => !element.hidden)
    if (!focusable.length) return

    const first = focusable[0]
    const last = focusable.at(-1)
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="sheet-layer" data-motion-event="reveal" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className={`bottom-sheet${tall ? ' bottom-sheet--tall' : ''}`}
        data-motion-event="reveal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={containFocus}
      >
        <div className="sheet-handle" aria-hidden="true" />
        <header className="sheet-header">
          <h2>{title}</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
            <X aria-hidden="true" />
          </button>
        </header>
        {children}
      </section>
    </div>
  )
}

function SearchSheet({
  shelf,
  books,
  onAdd,
  onClose,
  initialManual = false,
}: {
  shelf: ShelfId
  books: LibraryBook[]
  onAdd: (book: BookSearchResult, shelf: ShelfId) => void
  onClose: () => void
  initialManual?: boolean
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<BookSearchResult[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [manualMode, setManualMode] = useState(initialManual)
  const [manualTitle, setManualTitle] = useState('')
  const [manualAuthor, setManualAuthor] = useState('')
  const [manualPages, setManualPages] = useState('')

  useEffect(() => {
    const cleanQuery = query.trim()
    if (cleanQuery.length < 2) {
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setStatus('loading')
      try {
        const response = await searchGoogleBooks(cleanQuery, controller.signal)
        setResults(response)
        setStatus('ready')
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setStatus('error')
      }
    }, 360)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [query])

  const addFirstResult = (event: FormEvent) => {
    event.preventDefault()
    if (results[0]) onAdd(results[0], shelf)
  }

  const updateQuery = (value: string) => {
    setQuery(value)
    if (value.trim().length < 2) {
      setResults([])
      setStatus('idle')
    }
  }

  const openManualEntry = () => {
    setManualTitle(query.trim())
    setManualMode(true)
  }

  const forceAddBook = (event: FormEvent) => {
    event.preventDefault()
    const cleanTitle = manualTitle.trim()
    if (!cleanTitle) return

    const generatedId = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`
    onAdd(
      {
        id: `manual-${generatedId}`,
        title: cleanTitle,
        authors: [manualAuthor.trim() || 'Unknown author'],
        pageCount: Math.max(0, Number.parseInt(manualPages, 10) || 0),
      },
      shelf,
    )
    onClose()
  }

  return (
    <Sheet
      title={manualMode ? 'Force add a book' : `Add to ${shelfCopy[shelf].label}`}
      onClose={onClose}
      tall
    >
      {manualMode ? (
        <form className="manual-book-form" onSubmit={forceAddBook}>
          <div className="manual-notice">
            <Wrench aria-hidden="true" />
            <p>
              <strong>Development tool</strong>
              This skips Google Books and saves only the metadata you enter on this device.
            </p>
          </div>
          <label>
            <span>Book title</span>
            <input
              autoFocus
              required
              value={manualTitle}
              onChange={(event) => setManualTitle(event.target.value)}
              placeholder="The book Google missed"
            />
          </label>
          <label>
            <span>Author</span>
            <input
              value={manualAuthor}
              onChange={(event) => setManualAuthor(event.target.value)}
              placeholder="Unknown author"
            />
          </label>
          <label>
            <span>Page count <i>optional</i></span>
            <input
              type="number"
              inputMode="numeric"
              min="0"
              value={manualPages}
              onChange={(event) => setManualPages(event.target.value)}
              placeholder="0"
            />
          </label>
          <div className="manual-form-actions">
            {!initialManual && (
              <ActionButton type="button" variant="secondary" onClick={() => setManualMode(false)}>
                Back to search
              </ActionButton>
            )}
            <ActionButton type="submit" disabled={!manualTitle.trim()}>
              <BookPlus aria-hidden="true" /> Add to {shelfCopy[shelf].label}
            </ActionButton>
          </div>
        </form>
      ) : (
        <>
      <form className="book-search" onSubmit={addFirstResult}>
        <Search aria-hidden="true" />
        <input
          autoFocus
          value={query}
          onChange={(event) => updateQuery(event.target.value)}
          placeholder="Title, author, or ISBN"
          aria-label="Search Google Books"
          autoCapitalize="none"
          enterKeyHint="search"
        />
        {query && (
          <button type="button" aria-label="Clear search" onClick={() => updateQuery('')}>
            <X aria-hidden="true" />
          </button>
        )}
      </form>

      <div className="search-meta" aria-live="polite">
        {status === 'idle' && <span>Search Google Books. Tap once to add.</span>}
        {status === 'loading' && <span>Looking through the stacks…</span>}
        {status === 'ready' && (
          <span>{results.length ? `${results.length} books found` : 'No matching books found'}</span>
        )}
        {status === 'error' && <span>Google Books is unavailable right now. Try again shortly.</span>}
      </div>

      {MANUAL_ENTRY_ENABLED && (
        <button className="manual-entry-trigger" type="button" onClick={openManualEntry}>
          <Wrench aria-hidden="true" />
          <span>
            <strong>{query.trim() ? `Can't find “${query.trim()}”?` : 'Google Books missing something?'}</strong>
            Force add it locally
          </span>
          <ChevronRight aria-hidden="true" />
        </button>
      )}

      <div className="search-results">
        {results.map((result) => {
          const existing = books.find((book) => book.id === result.id)
          const alreadyHere = existing?.shelf === shelf
          return (
            <article className="search-result" key={result.id}>
              <BookCover book={result} />
              <div className="search-result__copy">
                <h3>{result.title}</h3>
                <p>{authorLine(result.authors)}</p>
                {result.pageCount > 0 && <small>{result.pageCount} pages</small>}
              </div>
              <button
                className={`result-add${alreadyHere ? ' is-added' : ''}`}
                type="button"
                onClick={() => onAdd(result, shelf)}
                disabled={alreadyHere}
                aria-label={alreadyHere ? `${result.title} already added` : `Add ${result.title}`}
              >
                {alreadyHere ? <Check aria-hidden="true" /> : <Plus aria-hidden="true" />}
                <span>{alreadyHere ? 'Added' : existing ? 'Move' : 'Add'}</span>
              </button>
            </article>
          )
        })}
      </div>
        </>
      )}
    </Sheet>
  )
}

function ShelfSection({
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
  onRate,
  movingBookId,
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
  onRate: (id: string, rating: number) => void
  movingBookId?: string
}) {
  const meta = shelfCopy[shelf]
  const [collapsed, setCollapsed] = useState(false)
  const isCollapsed = collapsed && !isFiltering

  return (
    <section className={`shelf shelf--${shelf}`} id={`shelf-${shelf}`} data-shelf={shelf}>
      <header className="shelf-header">
        <button
          type="button"
          className="shelf-toggle"
          onClick={() => setCollapsed((value) => !value)}
          aria-expanded={!isCollapsed}
          aria-controls={`shelf-books-${shelf}`}
        >
          <h2>
            {meta.label} <i>·</i> {books.length}
          </h2>
          <ChevronDown className={isCollapsed ? 'is-collapsed' : ''} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="shelf-add"
          onClick={() => onAdd(shelf)}
          aria-label={`Add a book to ${meta.label}`}
        >
          <Plus aria-hidden="true" />
        </button>
      </header>

      <div className="shelf-books" id={`shelf-books-${shelf}`} hidden={isCollapsed}>
        {books.length === 0 ? (
          isFiltering ? (
            <div className="empty-shelf empty-shelf--filter">
              <Search aria-hidden="true" />
              <span>
                <strong>No matches on this shelf</strong>
                <small>Try another title or author</small>
              </span>
            </div>
          ) : (
            <button className="empty-shelf" type="button" onClick={() => onAdd(shelf)}>
              <CirclePlus aria-hidden="true" />
              <span>
                <strong>{meta.empty}</strong>
                <small>Add a title to this shelf</small>
              </span>
            </button>
          )
        ) : (
          books.map((book) => (
            <article
              className="book-row"
              key={book.id}
              data-motion-event={movingBookId === book.id ? 'move-shelf' : undefined}
            >
              <button className="book-identity" type="button" onClick={() => onDetails(book.id)}>
                <BookCover book={book} />
                <SearchBookCopy book={book} result={searchResults.get(book.id)} />
              </button>

              {shelf === 'tbr' && (
                <button className="row-action row-action--next" type="button" onClick={() => onNext(book.id)}>
                  Next <ArrowRight aria-hidden="true" />
                </button>
              )}

              {shelf === 'next' && (
                <button className="row-action row-action--start" type="button" onClick={() => onStart(book.id)}>
                  Start <ArrowRight aria-hidden="true" />
                </button>
              )}

              {shelf === 'reading' && (
                <div className="reading-actions">
                  <button className="progress-button" type="button" onClick={() => onProgress(book.id)}>
                    <span>{book.progress}%</span>
                    <ProgressMeter value={book.progress} label={`${book.title} reading progress`} />
                  </button>
                  <button className="row-action row-action--finish" type="button" onClick={() => onFinish(book.id)}>
                    Finish <Check aria-hidden="true" />
                  </button>
                </div>
              )}

              {shelf === 'finished' && (
                <RatingStars compact value={book.rating} onChange={(rating) => onRate(book.id, rating)} />
              )}
            </article>
          ))
        )}
      </div>
    </section>
  )
}

function CustomShelfSection({
  shelf,
  books,
  organization,
  isFiltering,
  searchResults,
  onDetails,
  onManage,
}: {
  shelf: CustomShelf
  books: LibraryBook[]
  organization: LibraryOrganization
  isFiltering: boolean
  searchResults: ReadonlyMap<string, LocalSearchResult>
  onDetails: (id: string) => void
  onManage: () => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const isCollapsed = collapsed && !isFiltering

  return (
    <section className="shelf custom-shelf" id={`custom-shelf-${shelf.id}`}>
      <header className="shelf-header custom-shelf__header">
        <button
          type="button"
          className="shelf-toggle"
          onClick={() => setCollapsed((value) => !value)}
          aria-expanded={!isCollapsed}
          aria-controls={`custom-shelf-books-${shelf.id}`}
        >
          <h2>
            {shelf.pinned && <Pin aria-label="Pinned shelf" />}
            {shelf.name} <i>·</i> {books.length}
          </h2>
          <ChevronDown className={isCollapsed ? 'is-collapsed' : ''} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="shelf-add custom-shelf__manage"
          onClick={onManage}
          aria-label={`Manage ${shelf.name}`}
        >
          <FolderCog aria-hidden="true" />
        </button>
      </header>

      <div className="shelf-books" id={`custom-shelf-books-${shelf.id}`} hidden={isCollapsed}>
        {shelf.notes && <p className="custom-shelf__note">{shelf.notes}</p>}
        {books.length === 0 ? (
          isFiltering ? (
            <div className="empty-shelf empty-shelf--filter">
              <Search aria-hidden="true" />
              <span>
                <strong>No matches on this shelf</strong>
                <small>Try another title, author, or tag</small>
              </span>
            </div>
          ) : (
            <button className="empty-shelf" type="button" onClick={onManage}>
              <FolderPlus aria-hidden="true" />
              <span>
                <strong>Collect the first book</strong>
                <small>Books keep their reading status</small>
              </span>
            </button>
          )
        ) : (
          books.map((book) => {
            const tags = tagsForBook(organization, book.id)
            return (
              <article className="book-row custom-book-row" key={book.id}>
                <button className="book-identity" type="button" onClick={() => onDetails(book.id)}>
                  <BookCover book={book} />
                  <SearchBookCopy book={book} result={searchResults.get(book.id)}>
                    <span className="custom-book-row__meta">
                      <i>{shelfCopy[book.shelf].label}</i>
                      {tags.slice(0, 2).map((tag) => <em key={tag.id}>#{tag.name}</em>)}
                      {tags.length > 2 && <em>+{tags.length - 2}</em>}
                    </span>
                  </SearchBookCopy>
                </button>
              </article>
            )
          })
        )}
      </div>
    </section>
  )
}

function CustomShelfEditorSheet({
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
      <form className="custom-shelf-editor" onSubmit={submit}>
        <div className="custom-shelf-editor__intro">
          <span>Collection, not reading status</span>
          <p>Books can live on several custom shelves. Their TBR, Up Next, Reading, or Finished status stays unchanged.</p>
        </div>

        <label className="shelf-field">
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

        <label className="shelf-field">
          <span>Shelf note <i>optional</i></span>
          <textarea
            maxLength={1_000}
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Why these books belong together"
          />
        </label>

        <label className="shelf-pin-field">
          <input type="checkbox" checked={pinned} onChange={(event) => setPinned(event.target.checked)} />
          <Pin aria-hidden="true" />
          <span><strong>Pin this shelf</strong><small>Keep a shortcut beneath your reading shelves</small></span>
        </label>

        <section className="shelf-membership-editor">
          <header>
            <div>
              <span>Books</span>
              <h3>{orderedBookIds.length} selected</h3>
            </div>
            <small>Checkboxes change membership only</small>
          </header>
          <div className="shelf-book-search">
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

          <div className="shelf-membership-list">
            {visibleBooks.map((book) => {
              const selected = selectedIds.has(book.id)
              const order = selected ? orderedBookIds.indexOf(book.id) + 1 : 0
              return (
                <div className="shelf-membership-row" key={book.id}>
                  <label>
                    <input type="checkbox" checked={selected} onChange={() => toggleBook(book.id)} />
                    <span><strong>{book.title}</strong><small>{authorLine(book.authors)}</small></span>
                  </label>
                  {selected && (
                    <label className="shelf-position">
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
            {!visibleBooks.length && <p className="shelf-membership-empty">No matching books.</p>}
          </div>
          {matchingBooks.length > visibleBooks.length && (
            <p className="shelf-result-limit">
              Showing 80 of {matchingBooks.length}. Refine the search to reach any book without loading the entire library.
            </p>
          )}
          <p className="shelf-order-help">
            Set any selected book’s order number to move it without dragging.
          </p>
        </section>

        <ActionButton type="submit" disabled={!name.trim()}>
          <Check aria-hidden="true" /> {shelf ? 'Save shelf' : 'Create shelf'}
        </ActionButton>

        {shelf && (
          <div className="custom-shelf-editor__danger">
            <button type="button" onClick={() => onArchive(shelf)}>
              {shelf.archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
              <span>
                <strong>{shelf.archived ? 'Restore shelf' : 'Archive shelf'}</strong>
                <small>{shelf.archived ? 'Return it to My Books' : 'Hide this shelf; every book stays in your library'}</small>
              </span>
            </button>
            <button
              className="remove-action"
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

function ProgressSheet({
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
      <div className="sheet-book-line">
        <BookCover book={book} />
        <div>
          <strong>{book.title}</strong>
          <small>{authorLine(book.authors)}</small>
        </div>
      </div>

      <div className="progress-editor">
        <button type="button" onClick={() => onProgress(book.progress - 5)} aria-label="Decrease by 5 percent">
          <Minus aria-hidden="true" />
        </button>
        <div className="progress-editor__value">
          <output>{book.progress}<span>%</span></output>
          <i className="progress-editor__meter" aria-hidden="true">
            <b style={{ width: `${book.progress}%` }} />
          </i>
        </div>
        <button type="button" onClick={() => onProgress(book.progress + 5)} aria-label="Increase by 5 percent">
          <Plus aria-hidden="true" />
        </button>
      </div>

      <div className="progress-presets" aria-label="Progress presets">
        {[25, 50, 75].map((progress) => (
          <button type="button" key={progress} onClick={() => onProgress(progress)}>{progress}%</button>
        ))}
        <button type="button" onClick={onFinish}>Finished</button>
      </div>

      {book.pageCount > 0 && (
        <div className="page-progress">
          <label htmlFor="current-page">Or set by page</label>
          <div className="page-input-line">
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
            className="page-range"
            type="range"
            min="0"
            max={book.pageCount}
            value={book.currentPage}
            aria-label="Current page"
            onChange={(event) => onPage(Number(event.target.value))}
            style={{ '--range-progress': `${(book.currentPage / book.pageCount) * 100}%` } as CSSProperties}
          />
          <div className="range-labels"><span>0</span><span>{book.pageCount}</span></div>
        </div>
      )}

      <p className="updated-time"><Clock3 aria-hidden="true" /> Last updated {formatUpdated(book.lastUpdatedAt)}</p>
    </Sheet>
  )
}

function FinishedSheet({
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
      <div className="finish-celebration" data-motion-event="complete">
        <BookCover book={book} large />
        <div>
          <span className="finish-mark"><Check aria-hidden="true" /></span>
          <p>Another story, kept.</p>
          <h3>{book.title}</h3>
          <small>{authorLine(book.authors)}</small>
        </div>
      </div>
      <div className="finish-rating">
        <span>Your rating</span>
        <RatingStars value={book.rating} onChange={onRate} />
        <small>{book.rating ? `${book.rating} out of 5` : 'Optional — tap a star'}</small>
      </div>
      <ActionButton type="button" onClick={onClose}>Done</ActionButton>
    </Sheet>
  )
}

function DetailSheet({
  book,
  customShelves,
  customShelfIds,
  tags,
  tagSuggestions,
  onClose,
  onMove,
  onProgress,
  onFinish,
  onRate,
  onNotes,
  onCustomShelves,
  onTags,
  onRemove,
}: {
  book: LibraryBook
  customShelves: readonly CustomShelf[]
  customShelfIds: readonly string[]
  tags: readonly string[]
  tagSuggestions: readonly string[]
  onClose: () => void
  onMove: (shelf: ShelfId) => void
  onProgress: () => void
  onFinish: () => void
  onRate: (rating: number) => void
  onNotes: (notes: string) => void
  onCustomShelves: (shelfIds: readonly string[]) => void
  onTags: (tags: readonly string[]) => void
  onRemove: () => void
}) {
  return (
    <Sheet title="Book details" onClose={onClose} tall>
      <WorkDetailExperience
        key={book.id}
        book={book}
        customShelves={customShelves}
        customShelfIds={customShelfIds}
        tags={tags}
        tagSuggestions={tagSuggestions}
        onMove={onMove}
        onProgress={onProgress}
        onFinish={onFinish}
        onRate={onRate}
        onNotes={onNotes}
        onCustomShelves={onCustomShelves}
        onTags={onTags}
        onRemove={onRemove}
      />
    </Sheet>
  )
}

function SettingsPage({
  books,
  appearance,
  searchPreferences,
  importHistory,
  importBusy,
  importError,
  exportBusy,
  exportError,
  onBack,
  onAppearanceChange,
  onSearchPreferencesChange,
  onManualAdd,
  onImportFile,
  onUndoImport,
  onExport,
}: {
  books: LibraryBook[]
  appearance: AppearancePreferences
  searchPreferences: SearchPreferences
  importHistory: readonly ImportBatchSummary[]
  importBusy: boolean
  importError?: string
  exportBusy: boolean
  exportError?: string
  onBack: () => void
  onAppearanceChange: (preferences: AppearancePreferences) => void
  onSearchPreferencesChange: (preferences: SearchPreferences) => void
  onManualAdd: () => void
  onImportFile: (file: File) => void
  onUndoImport: (batchId: string) => void
  onExport: (format: ExportFormat, includeAnnotations: boolean) => void
}) {
  const [includeExportAnnotations, setIncludeExportAnnotations] = useState(true)
  const ratedBooks = books.filter((book) => book.rating > 0).length
  const notedBooks = books.filter((book) => book.notes.trim()).length

  return (
    <main className="settings-page" data-motion-event="navigate">
      <header className="settings-header">
        <div className="app-header__meta">
          <span>Wovenleaf</span>
          <i aria-hidden="true" />
          <span>Local preferences</span>
        </div>
        <div className="title-row">
          <div>
            <p>Quiet controls for a private library</p>
            <h1 tabIndex={-1}>Settings</h1>
          </div>
          <button className="header-search" type="button" onClick={onBack} aria-label="Back to my books">
            <Library aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="settings-ledger">
        <section className="settings-card settings-card--appearance">
          <div className="settings-card__icon"><Palette aria-hidden="true" /></div>
          <div className="settings-card__heading">
            <span>Reading room</span>
            <h2>Paper, contrast, and type</h2>
            <p>Choose the atmosphere without changing the hierarchy or hiding state.</p>
          </div>

          <fieldset className="appearance-field appearance-field--paper">
            <legend>Paper stock</legend>
            <div className="appearance-options">
              {PAPER_MODES.map((mode) => (
                <button
                  className="appearance-option appearance-option--paper"
                  data-paper={mode}
                  type="button"
                  key={mode}
                  aria-pressed={appearance.paperMode === mode}
                  onClick={() => onAppearanceChange({ ...appearance, paperMode: mode })}
                >
                  <i aria-hidden="true" />
                  <span>{appearanceLabels.paperMode[mode]}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="appearance-field">
            <legend>Contrast</legend>
            <div className="appearance-options appearance-options--compact">
              {CONTRAST_MODES.map((contrast) => (
                <button
                  className="appearance-option"
                  type="button"
                  key={contrast}
                  aria-pressed={appearance.contrast === contrast}
                  onClick={() => onAppearanceChange({ ...appearance, contrast })}
                >
                  {appearanceLabels.contrast[contrast]}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="appearance-field">
            <legend>Motion</legend>
            <div className="appearance-options appearance-options--motion">
              {MOTION_MODES.map((motion) => (
                <button
                  className="appearance-option"
                  type="button"
                  key={motion}
                  aria-pressed={appearance.motion === motion}
                  onClick={() => onAppearanceChange({ ...appearance, motion })}
                >
                  {appearanceLabels.motion[motion]}
                </button>
              ))}
            </div>
            <small className="appearance-field__hint">
              Reduced is a global test mode: hierarchy, status, focus, and feedback stay intact.
            </small>
          </fieldset>

          <fieldset className="appearance-field">
            <legend>Type scale</legend>
            <div className="appearance-options appearance-options--compact">
              {TYPE_SCALES.map((typeScale) => (
                <button
                  className="appearance-option"
                  type="button"
                  key={typeScale}
                  aria-pressed={appearance.typeScale === typeScale}
                  onClick={() => onAppearanceChange({ ...appearance, typeScale })}
                >
                  {appearanceLabels.typeScale[typeScale]}
                </button>
              ))}
            </div>
          </fieldset>

          <button
            className="texture-toggle"
            type="button"
            aria-pressed={appearance.texture === 'quiet'}
            onClick={() => onAppearanceChange({
              ...appearance,
              texture: appearance.texture === 'quiet' ? 'off' : 'quiet',
            })}
          >
            <span>
              <strong>Paper fiber</strong>
              <small>One static procedural layer; automatically removed for contrast and transparency preferences.</small>
            </span>
            <i aria-hidden="true" />
          </button>
        </section>

        <section className="settings-card settings-card--privacy">
          <div className="settings-card__icon"><ShieldCheck aria-hidden="true" /></div>
          <div className="settings-card__heading">
            <span>Data & privacy</span>
            <h2>Your reading life stays here.</h2>
            <p>There is no account, analytics layer, community profile, or cloud sync.</p>
          </div>
          <dl className="library-tally">
            <div><dt>Books</dt><dd>{books.length}</dd></div>
            <div><dt>Rated</dt><dd>{ratedBooks}</dd></div>
            <div><dt>With notes</dt><dd>{notedBooks}</dd></div>
          </dl>
          <button
            className="texture-toggle search-notes-toggle"
            type="button"
            aria-pressed={searchPreferences.includePrivateNotes}
            onClick={() => onSearchPreferencesChange({
              includePrivateNotes: !searchPreferences.includePrivateNotes,
            })}
          >
            <span>
              <strong>Search private notes</strong>
              <small>
                {searchPreferences.includePrivateNotes
                  ? 'Note text can surface a book in local search.'
                  : 'Off by default; titles and library metadata remain searchable.'}
              </small>
            </span>
            <i aria-hidden="true" />
          </button>
        </section>

        <section className="settings-card settings-card--export">
          <div className="settings-card__icon"><Archive aria-hidden="true" /></div>
          <div className="settings-card__heading">
            <span>Portable export · Contract v1</span>
            <h2>Your library, with a way home.</h2>
            <p>Built entirely on this device. Review the manifest below before saving or sharing anything.</p>
          </div>

          <div className="export-manifest" aria-label="Portable export contents">
            <div>
              <strong>Inside the archive</strong>
              <span>Catalog records and relationships</span>
              <span>Shelves, progress, dates, and ratings</span>
              <span>Checksums plus readable CSV and Markdown views</span>
            </div>
            <div>
              <strong>Always left behind</strong>
              <span>Passwords, API keys, and secure credentials</span>
              <span>Database cache and import staging</span>
              <span>Cover, ebook, and audiobook files</span>
            </div>
          </div>

          <button
            className="export-annotation-toggle"
            type="button"
            aria-pressed={includeExportAnnotations}
            onClick={() => setIncludeExportAnnotations((value) => !value)}
          >
            <span>
              <strong>Private notes and ratings</strong>
              <small>{includeExportAnnotations ? 'Included in canonical and readable files' : 'Redacted from every exported file'}</small>
            </span>
            <i aria-hidden="true" />
          </button>

          <div className="export-actions">
            <button
              className="export-action export-action--primary"
              type="button"
              disabled={exportBusy}
              onClick={() => onExport('archive', includeExportAnnotations)}
            >
              <Archive aria-hidden="true" />
              <span><strong>{exportBusy ? 'Building locally…' : 'Portable JSON archive'}</strong><small>Lossless structure · verified restore</small></span>
              <Download aria-hidden="true" />
            </button>
            <button
              className="export-action"
              type="button"
              disabled={exportBusy}
              onClick={() => onExport('csv', includeExportAnnotations)}
            >
              <Table2 aria-hidden="true" />
              <span><strong>Readable CSV</strong><small>Lossy table · not restorable</small></span>
              <Download aria-hidden="true" />
            </button>
            <button
              className="export-action"
              type="button"
              disabled={exportBusy}
              onClick={() => onExport('markdown', includeExportAnnotations)}
            >
              <FileText aria-hidden="true" />
              <span><strong>Reading journal</strong><small>Lossy Markdown · not restorable</small></span>
              <Download aria-hidden="true" />
            </button>
          </div>
          {exportError && <p className="settings-hint settings-hint--error export-error" role="alert">{exportError}</p>}
        </section>

        <section className="settings-card settings-card--import">
          <div className="settings-card__icon"><FileUp aria-hidden="true" /></div>
          <div className="settings-card__heading">
            <span>Import & recovery</span>
            <h2>Preview every row before it lands.</h2>
            <p>Use a Wovenleaf CSV now. Matching, changes, validation errors, and file permissions stay visible until you commit.</p>
          </div>
          <label className={`settings-action import-file-picker${importBusy ? ' is-busy' : ''}`}>
            <FileUp aria-hidden="true" />
            <span><strong>{importBusy ? 'Preparing preview…' : 'Choose a CSV file'}</strong><small>Parsed locally · no network access</small></span>
            <ChevronRight aria-hidden="true" />
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={importBusy}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                if (file) onImportFile(file)
                event.currentTarget.value = ''
              }}
            />
          </label>
          {importError && <p className="settings-hint settings-hint--error" role="alert">{importError}</p>}
          {importHistory.length > 0 && (
            <div className="import-history" aria-label="Recent import batches">
              <div className="import-history__heading"><History aria-hidden="true" /><span>Recent checkpoints</span></div>
              {importHistory.slice(0, 3).map((batch) => (
                <div className="import-history__row" key={batch.id}>
                  <span><strong>{batch.fileName}</strong><small>{batch.appliedRows} rows · {batch.changeCount} changes</small></span>
                  <span className={`import-history__status is-${batch.status}`}>{batch.status}</span>
                  {batch.status === 'committed' && (
                    <button type="button" onClick={() => onUndoImport(batch.id)}>Undo</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="settings-card">
          <div className="settings-card__icon"><Search aria-hidden="true" /></div>
          <div className="settings-card__heading">
            <span>Book search</span>
            <h2>Google Books API</h2>
            <p>Search metadata comes from Google. Your personal library data is never sent with a search.</p>
          </div>
          <div className="settings-status-row">
            <span>API key</span>
            <strong className={GOOGLE_BOOKS_KEY_CONFIGURED ? 'is-ready' : 'is-warning'}>
              {GOOGLE_BOOKS_KEY_CONFIGURED ? 'Configured' : 'Anonymous quota'}
            </strong>
          </div>
          {!GOOGLE_BOOKS_KEY_CONFIGURED && (
            <p className="settings-hint">
              Add <code>VITE_GOOGLE_BOOKS_API_KEY</code> to <code>.env.local</code> for project-specific quota.
            </p>
          )}
        </section>

        <section className="settings-card settings-card--developer">
          <div className="settings-card__icon"><Wrench aria-hidden="true" /></div>
          <div className="settings-card__heading">
            <span>Developer tools</span>
            <h2>Manual book entry</h2>
            <p>Force add local metadata when a title is absent from Google Books or the API is unavailable.</p>
          </div>
          {MANUAL_ENTRY_ENABLED ? (
            <button className="settings-action" type="button" onClick={onManualAdd}>
              <BookPlus aria-hidden="true" />
              <span><strong>Force add a book</strong><small>Development mode is enabled</small></span>
              <ChevronRight aria-hidden="true" />
            </button>
          ) : (
            <p className="settings-hint">
              Set <code>VITE_ENABLE_MANUAL_BOOKS=true</code> only in a local development environment to enable this tool.
            </p>
          )}
        </section>
      </div>
    </main>
  )
}

function BottomNavigation({
  view,
  onLibrary,
  onShelf,
  onAdd,
  onSettings,
}: {
  view: AppView
  onLibrary: () => void
  onShelf: (shelf: ShelfId) => void
  onAdd: () => void
  onSettings: () => void
}) {
  return (
    <nav className="bottom-nav" aria-label="App shortcuts">
      <button
        className={view === 'library' ? 'is-active' : ''}
        type="button"
        onClick={onLibrary}
        aria-current={view === 'library' ? 'page' : undefined}
      >
        <Library aria-hidden="true" /><span>My Books</span>
      </button>
      <button
        type="button"
        onClick={() => onShelf('reading')}
      >
        <BookOpen aria-hidden="true" /><span>Reading</span>
      </button>
      <button className="bottom-nav__add" type="button" onClick={onAdd}>
        <Plus aria-hidden="true" /><span>Add Book</span>
      </button>
      <button
        type="button"
        onClick={() => onShelf('finished')}
      >
        <BookCheck aria-hidden="true" /><span>Finished</span>
      </button>
      <button
        className={view === 'settings' ? 'is-active' : ''}
        type="button"
        onClick={onSettings}
        aria-current={view === 'settings' ? 'page' : undefined}
      >
        <SettingsIcon aria-hidden="true" /><span>Settings</span>
      </button>
    </nav>
  )
}

function App() {
  const {
    books,
    storageError,
    legacyRecoveryAvailable,
    downloadLegacyRecovery,
    addBook,
    updateBook,
    moveBook,
    setProgress,
    setCurrentPage,
    finishBook,
    removeBook,
    reload,
  } = useLibrary()
  const {
    organization,
    organizationError,
    saveShelf,
    setShelfMembersInOrder,
    setBookMemberships,
    setBookTags,
    removeShelf,
  } = useOrganization()
  const {
    upNext,
    upNextError,
    savePreferences: saveUpNextPreferences,
    addQueueBook,
    removeQueueBook,
    moveQueueBook,
    togglePinnedBook,
    setReasonState,
    dismissSuggestion,
    restoreSuggestion,
  } = useUpNext()
  const [sheet, setSheet] = useState<SheetState>(null)
  const [view, setView] = useState<AppView>('library')
  const [librarySearchOpen, setLibrarySearchOpen] = useState(false)
  const [libraryQuery, setLibraryQuery] = useState('')
  const [libraryShelfFilter, setLibraryShelfFilter] = useState<ShelfId | 'all'>('all')
  const [librarySort, setLibrarySort] = useState<LocalSearchSort>('relevance')
  const [commandMenuOpen, setCommandMenuOpen] = useState(false)
  const [toast, setToast] = useState<ToastState>(null)
  const [movingBookId, setMovingBookId] = useState<string>()
  const [appearance, setAppearance] = useState(() => readAppearance(getAppearanceStorage()))
  const [searchPreferences, setSearchPreferences] = useState(() =>
    readSearchPreferences(getSearchPreferencesStorage()),
  )
  const [importPreview, setImportPreview] = useState<ImportPreview>()
  const [importHistory, setImportHistory] = useState<ImportBatchSummary[]>([])
  const [importBusy, setImportBusy] = useState(false)
  const [importError, setImportError] = useState<string>()
  const [exportBusy, setExportBusy] = useState(false)
  const [exportError, setExportError] = useState<string>()
  const sheetTriggerRef = useRef<HTMLElement | null>(null)

  const deferredLibraryQuery = useDeferredValue(libraryQuery.trim())
  const normalizedLibraryQuery = deferredLibraryQuery.toLocaleLowerCase()
  const tagNamesByBookId = useMemo(() => {
    const tagById = new Map(organization.tags.map((tag) => [tag.id, tag.name]))
    const names = new Map<string, string[]>()
    for (const bookTag of organization.bookTags) {
      const tagName = tagById.get(bookTag.tagId)
      if (tagName) names.set(bookTag.bookId, [...(names.get(bookTag.bookId) ?? []), tagName])
    }
    return names
  }, [organization.bookTags, organization.tags])
  const listNamesByBookId = useMemo(() => {
    const shelfById = new Map(organization.shelves.map((shelf) => [shelf.id, shelf.name]))
    const names = new Map<string, string[]>()
    for (const entry of organization.entries) {
      const shelfName = shelfById.get(entry.shelfId)
      if (shelfName) names.set(entry.bookId, [...(names.get(entry.bookId) ?? []), shelfName])
    }
    return names
  }, [organization.entries, organization.shelves])
  const searchableBooks = useMemo(() => books.map((book) => ({
    ...book,
    tags: tagNamesByBookId.get(book.id),
    listNames: listNamesByBookId.get(book.id),
  })), [books, listNamesByBookId, tagNamesByBookId])
  const { index: librarySearchIndex, checkpoint: searchCheckpoint, indexing } =
    useLibrarySearchIndex(searchableBooks)
  const librarySearchActive = librarySearchOpen && Boolean(
    normalizedLibraryQuery
    || libraryShelfFilter !== 'all'
    || librarySort !== 'relevance',
  )
  const librarySearchResults = useMemo(() => {
    if (!librarySearchActive) return []
    return librarySearchIndex.search(deferredLibraryQuery, {
      includeNotes: searchPreferences.includePrivateNotes,
      shelves: libraryShelfFilter === 'all' ? undefined : [libraryShelfFilter],
      sort: librarySort,
    })
  }, [
    deferredLibraryQuery,
    librarySearchActive,
    librarySearchIndex,
    libraryShelfFilter,
    librarySort,
    searchPreferences.includePrivateNotes,
  ])
  const librarySearchResultById = useMemo(
    () => new Map(librarySearchResults.map((result) => [result.document.id, result])),
    [librarySearchResults],
  )
  const bookById = useMemo(() => new Map(books.map((book) => [book.id, book])), [books])
  const visibleBooks = useMemo(() => {
    if (!librarySearchActive) return books
    return librarySearchResults
      .map(({ document }) => bookById.get(document.id))
      .filter((book): book is LibraryBook => Boolean(book))
  }, [bookById, books, librarySearchActive, librarySearchResults])

  const booksByShelf = useMemo(
    () => Object.fromEntries(SHELVES.map(({ id }) => [id, visibleBooks.filter((book) => book.shelf === id)])) as Record<ShelfId, LibraryBook[]>,
    [visibleBooks],
  )
  const orderedNextBooks = useMemo(
    () => orderedUpNextBooks(booksByShelf.next, upNext),
    [booksByShelf.next, upNext],
  )
  const upNextSuggestions = useMemo(
    () => buildUpNextSuggestions(searchableBooks, upNext),
    [searchableBooks, upNext],
  )

  const activeCustomShelves = useMemo(
    () => organization.shelves
      .filter(({ archived }) => !archived)
      .sort((left, right) => Number(right.pinned) - Number(left.pinned)
        || left.position - right.position
        || left.name.localeCompare(right.name)),
    [organization.shelves],
  )
  const archivedCustomShelves = useMemo(
    () => organization.shelves
      .filter(({ archived }) => archived)
      .sort((left, right) => left.name.localeCompare(right.name)),
    [organization.shelves],
  )
  const visibleBookById = useMemo(
    () => new Map(visibleBooks.map((book) => [book.id, book])),
    [visibleBooks],
  )
  const booksByCustomShelf = useMemo(() => new Map(activeCustomShelves.map((shelf) => [
    shelf.id,
    orderedShelfEntries(organization, shelf.id)
      .map(({ bookId }) => visibleBookById.get(bookId))
      .filter((book): book is LibraryBook => Boolean(book)),
  ])), [activeCustomShelves, organization, visibleBookById])

  const selectedBook = sheet && 'bookId' in sheet
    ? books.find((book) => book.id === sheet.bookId)
    : undefined
  const selectedCustomShelf = sheet?.kind === 'custom-shelf' && sheet.shelfId
    ? organization.shelves.find((shelf) => shelf.id === sheet.shelfId)
    : undefined

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), toast.undo ? 5000 : 2400)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (!movingBookId) return
    const timer = window.setTimeout(() => setMovingBookId(undefined), 300)
    return () => window.clearTimeout(timer)
  }, [movingBookId])

  useLayoutEffect(() => {
    applyAppearance(document.documentElement, appearance)
    const storage = getAppearanceStorage()
    if (storage) writeAppearance(storage, appearance)
  }, [appearance])

  useEffect(() => {
    writeSearchPreferences(getSearchPreferencesStorage(), searchPreferences)
  }, [searchPreferences])

  useEffect(() => {
    const handleCommandShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault()
        if (commandMenuOpen) {
          setCommandMenuOpen(false)
        } else {
          setLibrarySearchOpen(false)
          setLibraryQuery('')
          setLibraryShelfFilter('all')
          setLibrarySort('relevance')
          setCommandMenuOpen(true)
        }
      }
    }
    window.addEventListener('keydown', handleCommandShortcut)
    return () => window.removeEventListener('keydown', handleCommandShortcut)
  }, [commandMenuOpen])

  const scrollToShelf = (shelf: ShelfId) => {
    document.getElementById(`shelf-${shelf}`)?.scrollIntoView({
      behavior: motionScrollBehavior(appearance.motion),
      block: 'start',
    })
  }

  const closeLibrarySearch = () => {
    setLibrarySearchOpen(false)
    setLibraryQuery('')
    setLibraryShelfFilter('all')
    setLibrarySort('relevance')
  }

  const showLibrary = () => {
    setView('library')
    window.setTimeout(() => window.scrollTo({
      top: 0,
      behavior: motionScrollBehavior(appearance.motion),
    }), 0)
  }

  const showShelf = (shelf: ShelfId) => {
    setView('library')
    window.setTimeout(() => scrollToShelf(shelf), 0)
  }

  const showSettings = () => {
    setView('settings')
    void refreshImportHistory()
    window.scrollTo({ top: 0, behavior: motionScrollBehavior(appearance.motion) })
  }

  const refreshImportHistory = async () => {
    try {
      setImportHistory(await (await getStorageRuntime()).imports.listRecentBatches())
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error))
    }
  }

  const handleImportFile = async (file: File) => {
    setImportBusy(true)
    setImportError(undefined)
    try {
      await reload()
      const preview = await (await getStorageRuntime()).imports.previewCsv(file.name, await file.text())
      setImportPreview(preview)
      setView('import')
      window.scrollTo({ top: 0, behavior: motionScrollBehavior(appearance.motion) })
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error))
    } finally {
      setImportBusy(false)
    }
  }

  const handleExport = async (format: ExportFormat, includeAnnotations: boolean) => {
    setExportBusy(true)
    setExportError(undefined)
    try {
      await reload()
      const bundle = await (await getStorageRuntime()).portableArchives.create({
        includeAnnotations,
        includeSourcePayloads: false,
      })
      if (format === 'archive') {
        downloadTextFile(bundle.archive, `${bundle.filenameStem}.wovenleaf.json`, 'application/json')
      } else if (format === 'csv') {
        downloadTextFile(bundle.csv, `${bundle.filenameStem}.csv`, 'text/csv;charset=utf-8')
      } else {
        downloadTextFile(bundle.markdown, `${bundle.filenameStem}.md`, 'text/markdown;charset=utf-8')
      }
      setToast({
        message: format === 'archive'
          ? 'Portable archive verified and ready'
          : `${format === 'csv' ? 'CSV' : 'Reading journal'} saved as a readable, lossy view`,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setExportError(message)
      setToast({ message })
    } finally {
      setExportBusy(false)
    }
  }

  const undoImportBatch = async (batchId: string) => {
    setImportBusy(true)
    setImportError(undefined)
    try {
      const result = await (await getStorageRuntime()).imports.undo(batchId)
      await reload()
      await refreshImportHistory()
      setToast({
        message: result.preservedChanges
          ? `Import undone; ${result.preservedChanges} later edits were preserved`
          : 'Import undone; the previous library state is restored',
        family: 'undo',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setImportError(message)
      setToast({ message })
    } finally {
      setImportBusy(false)
    }
  }

  const commitImport = async (decisions: readonly ImportReviewDecision[]) => {
    if (!importPreview) return
    setImportBusy(true)
    setImportError(undefined)
    try {
      const result = await (await getStorageRuntime()).imports.commit(importPreview.id, decisions)
      await reload()
      await refreshImportHistory()
      setView('library')
      setToast({
        message: result.appliedChanges
          ? `Imported ${result.appliedRows} rows with ${result.appliedChanges} reviewed changes`
          : 'Import checked; no duplicate changes were made',
        undo: result.appliedChanges ? () => { void undoImportBatch(result.batchId) } : undefined,
      })
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error))
    } finally {
      setImportBusy(false)
    }
  }

  const openSheet = (nextSheet: Exclude<SheetState, null>) => {
    if (!sheet && document.activeElement instanceof HTMLElement) {
      sheetTriggerRef.current = document.activeElement
    }
    setSheet(nextSheet)
  }

  const closeSheet = () => {
    setSheet(null)
    window.requestAnimationFrame(() => {
      const trigger = sheetTriggerRef.current
      const fallback = document.querySelector<HTMLElement>('.app-content h1')
      const target = trigger?.isConnected ? trigger : fallback
      target?.focus({ preventScroll: true })
      sheetTriggerRef.current = null
    })
  }

  const moveToShelf = (id: string, shelf: ShelfId) => {
    moveBook(id, shelf)
    if (shelf === 'next') addQueueBook(id)
    else removeQueueBook(id)
  }

  const moveWithUndo = (id: string, shelf: ShelfId, message: string) => {
    const book = books.find((item) => item.id === id)
    if (!book || book.shelf === shelf) return

    const previousShelf = book.shelf
    moveToShelf(id, shelf)
    setMovingBookId(id)
    setToast({
      message,
      undo: () => {
        moveToShelf(id, previousShelf)
        setMovingBookId(id)
        if (shelf === 'finished') closeSheet()
        setToast({
          message: `${book.title} returned to ${shelfCopy[previousShelf].label}`,
          family: 'undo',
        })
      },
    })
  }

  const handleAdd = (result: BookSearchResult, shelf: ShelfId) => {
    const previous = books.find((book) => book.id === result.id)
    if (previous && previous.shelf !== shelf) {
      addBook(result, shelf)
      if (shelf === 'next') addQueueBook(result.id)
      else removeQueueBook(result.id)
      setMovingBookId(previous.id)
      setToast({ message: `Moved to ${shelfCopy[shelf].label}` })
      return
    }

    addBook(result, shelf)
    if (shelf === 'next') addQueueBook(result.id)
    else removeQueueBook(result.id)
    setMovingBookId(result.id)
    setToast({ message: previous ? `Already in ${shelfCopy[shelf].label}` : `Added to ${shelfCopy[shelf].label}` })
  }

  const handleStart = (id: string) => {
    const book = books.find((item) => item.id === id)
    moveWithUndo(id, 'reading', `${book?.title ?? 'Book'} is now being read`)
  }

  const handleNext = (id: string) => {
    const book = books.find((item) => item.id === id)
    moveWithUndo(id, 'next', `${book?.title ?? 'Book'} moved to Up Next`)
  }

  const handleFinish = (id: string) => {
    finishBook(id)
    removeQueueBook(id)
    setMovingBookId(id)
    openSheet({ kind: 'finished', bookId: id })
  }

  const saveUpNextSettings = (
    mode: typeof upNext.mode,
    preferences: typeof upNext.preferences,
  ) => {
    saveUpNextPreferences(mode, preferences)
    closeSheet()
    setToast({
      message: mode === 'manual'
        ? 'Up Next is fully manual'
        : 'Choice signals saved on this device',
    })
  }

  const saveCustomShelf = (draft: ShelfDraft, orderedBookIds: readonly string[]) => {
    const shelfId = saveShelf(draft)
    setShelfMembersInOrder(shelfId, orderedBookIds)
    closeSheet()
    setToast({ message: draft.id ? 'Custom shelf saved; reading statuses unchanged' : 'Custom shelf created' })
  }

  const archiveCustomShelf = (shelf: CustomShelf) => {
    saveShelf({
      id: shelf.id,
      name: shelf.name,
      notes: shelf.notes,
      pinned: shelf.pinned,
      archived: !shelf.archived,
    })
    closeSheet()
    setToast({
      message: shelf.archived
        ? `${shelf.name} restored`
        : `${shelf.name} archived; its books remain in your library`,
    })
  }

  const deleteCustomShelf = (shelf: CustomShelf) => {
    removeShelf(shelf.id)
    closeSheet()
    setToast({ message: `${shelf.name} deleted; no books were removed` })
  }

  return (
    <div className="library-app">
      <div
        className="app-content"
        inert={sheet || commandMenuOpen ? true : undefined}
        aria-hidden={sheet || commandMenuOpen ? true : undefined}
      >
        {(storageError || organizationError || upNextError) && (
          <section className="storage-recovery" role="alert" aria-live="assertive">
            <AlertTriangle aria-hidden="true" />
            <div>
              <strong>
                {legacyRecoveryAvailable ? 'Previous library needs recovery' : 'Library storage error'}
              </strong>
              <p>{storageError ?? organizationError ?? upNextError}</p>
              {legacyRecoveryAvailable && (
                <button type="button" onClick={() => { void downloadLegacyRecovery() }}>
                  <Download aria-hidden="true" />
                  Download recovery copy
                </button>
              )}
            </div>
          </section>
        )}
        {view === 'library' ? (
          <div className="library-page" data-motion-event="navigate">
            <header className="app-header" id="top">
              <div className="title-row">
                <h1 tabIndex={-1}>My Books</h1>
                <div className="header-actions">
                  <button
                    className="header-search command-trigger"
                    type="button"
                    onClick={() => {
                      closeLibrarySearch()
                      setCommandMenuOpen(true)
                    }}
                    aria-label="Open command menu"
                    aria-keyshortcuts="Meta+K Control+K"
                  >
                    <CommandIcon aria-hidden="true" />
                  </button>
                  <button
                    className={`header-search${librarySearchOpen ? ' is-open' : ''}`}
                    type="button"
                    onClick={() => {
                      if (librarySearchOpen) closeLibrarySearch()
                      else setLibrarySearchOpen(true)
                    }}
                    aria-label={librarySearchOpen ? 'Close library search' : 'Search my library'}
                    aria-expanded={librarySearchOpen}
                  >
                    {librarySearchOpen ? <X aria-hidden="true" /> : <Search aria-hidden="true" />}
                  </button>
                </div>
              </div>

              {librarySearchOpen && (
                <div className="library-search-panel" data-motion-event="reveal">
                  <div className="library-search">
                    <Search aria-hidden="true" />
                    <input
                      autoFocus
                      type="search"
                      value={libraryQuery}
                      onChange={(event) => setLibraryQuery(event.target.value)}
                      placeholder="Title, author, tag, ISBN…"
                      aria-label="Search your local library"
                      autoCapitalize="none"
                      enterKeyHint="search"
                    />
                    <small aria-live="polite">
                      {indexing
                        ? `Indexing ${searchCheckpoint?.nextDocument ?? 0}/${books.length}`
                        : librarySearchActive ? `${visibleBooks.length} found` : 'On this device'}
                    </small>
                    {libraryQuery && (
                      <button type="button" onClick={() => setLibraryQuery('')} aria-label="Clear library search">
                        <X aria-hidden="true" />
                      </button>
                    )}
                  </div>
                  <div className="library-search-controls">
                    <label>
                      <span className="sr-only">Filter by shelf</span>
                      <select
                        value={libraryShelfFilter}
                        onChange={(event) => setLibraryShelfFilter(event.target.value as ShelfId | 'all')}
                      >
                        <option value="all">All shelves</option>
                        {SHELVES.map((shelf) => <option key={shelf.id} value={shelf.id}>{shelf.label}</option>)}
                      </select>
                    </label>
                    <label>
                      <span className="sr-only">Sort library search results</span>
                      <select
                        value={librarySort}
                        onChange={(event) => setLibrarySort(event.target.value as LocalSearchSort)}
                      >
                        <option value="relevance">Relevance</option>
                        <option value="title">Title</option>
                        <option value="updated">Recently updated</option>
                        <option value="added">Recently added</option>
                      </select>
                    </label>
                    <span><CommandIcon aria-hidden="true" /> K · Commands</span>
                  </div>
                </div>
              )}

              <nav className="shelf-tabs" aria-label="Jump to a shelf">
                {SHELVES.map((shelf) => (
                  <button
                    type="button"
                    key={shelf.id}
                    onClick={() => scrollToShelf(shelf.id)}
                  >
                    <span>{shelf.shortLabel}</span>
                    <strong>{booksByShelf[shelf.id].length}</strong>
                  </button>
                ))}
              </nav>
              {activeCustomShelves.some(({ pinned }) => pinned) && (
                <nav className="pinned-shelf-tabs" aria-label="Pinned custom shelves">
                  <span><Pin aria-hidden="true" /> Pinned</span>
                  <div>
                    {activeCustomShelves.filter(({ pinned }) => pinned).map((shelf) => (
                      <button
                        type="button"
                        key={shelf.id}
                        onClick={() => document.getElementById(`custom-shelf-${shelf.id}`)?.scrollIntoView({
                          behavior: motionScrollBehavior(appearance.motion),
                          block: 'start',
                        })}
                      >
                        {shelf.name}
                        <strong>{booksByCustomShelf.get(shelf.id)?.length ?? 0}</strong>
                      </button>
                    ))}
                  </div>
                </nav>
              )}
            </header>

            <main className="shelf-stack">
              {librarySearchActive && visibleBooks.length === 0 ? (
                <div className="library-no-results">
                  <Search aria-hidden="true" />
                  <div>
                    <strong>No books found</strong>
                    <span>Try another title, contributor, tag, identifier, or shelf.</span>
                  </div>
                </div>
              ) : (
                <>
                  {SHELVES.filter(
                    (shelf) => !librarySearchActive || booksByShelf[shelf.id].length > 0,
                  ).map((shelf) => shelf.id === 'next' ? (
                    <UpNextSection
                      key={shelf.id}
                      books={orderedNextBooks}
                      state={upNext}
                      suggestions={upNextSuggestions}
                      isFiltering={librarySearchActive}
                      onAdd={() => openSheet({ kind: 'search', shelf: 'next' })}
                      onDetails={(bookId) => openSheet({ kind: 'detail', bookId })}
                      onStart={handleStart}
                      onMove={(bookId, targetIndex) => moveQueueBook(
                        bookId,
                        targetIndex,
                        orderedNextBooks.map(({ id }) => id),
                      )}
                      onPinBook={togglePinnedBook}
                      onManage={() => openSheet({ kind: 'up-next' })}
                      onAddSuggestion={handleNext}
                      onDismissSuggestion={dismissSuggestion}
                      onReasonState={setReasonState}
                    />
                  ) : (
                    <ShelfSection
                      key={shelf.id}
                      shelf={shelf.id}
                      books={booksByShelf[shelf.id]}
                      isFiltering={librarySearchActive}
                      searchResults={librarySearchResultById}
                      movingBookId={movingBookId}
                      onAdd={(targetShelf) => openSheet({ kind: 'search', shelf: targetShelf })}
                      onDetails={(bookId) => openSheet({ kind: 'detail', bookId })}
                      onProgress={(bookId) => openSheet({ kind: 'progress', bookId })}
                      onNext={handleNext}
                      onStart={handleStart}
                      onFinish={handleFinish}
                      onRate={(id, rating) => updateBook(id, { rating })}
                    />
                  ))}

                  {!librarySearchActive && (
                    <div className="custom-shelves-heading">
                      <div>
                        <span>Your collections</span>
                        <h2>Custom shelves</h2>
                        <p>Collect freely. Reading status still belongs to the four shelves above.</p>
                      </div>
                      <button type="button" onClick={() => openSheet({ kind: 'custom-shelf' })}>
                        <FolderPlus aria-hidden="true" /> New shelf
                      </button>
                    </div>
                  )}

                  {activeCustomShelves
                    .filter((shelf) => !librarySearchActive || (booksByCustomShelf.get(shelf.id)?.length ?? 0) > 0)
                    .map((shelf) => (
                      <CustomShelfSection
                        key={shelf.id}
                        shelf={shelf}
                        books={booksByCustomShelf.get(shelf.id) ?? []}
                        organization={organization}
                        isFiltering={librarySearchActive}
                        searchResults={librarySearchResultById}
                        onDetails={(bookId) => openSheet({ kind: 'detail', bookId })}
                        onManage={() => openSheet({ kind: 'custom-shelf', shelfId: shelf.id })}
                      />
                    ))}

                  {!librarySearchActive && !activeCustomShelves.length && (
                    <button
                      className="custom-shelf-empty"
                      type="button"
                      onClick={() => openSheet({ kind: 'custom-shelf' })}
                    >
                      <FolderPlus aria-hidden="true" />
                      <span><strong>Make a shelf of your own</strong><small>A book can belong to as many as you like</small></span>
                    </button>
                  )}

                  {!librarySearchActive && archivedCustomShelves.length > 0 && (
                    <section className="archived-shelves">
                      <header>
                        <Archive aria-hidden="true" />
                        <span>Archived shelves</span>
                        <strong>{archivedCustomShelves.length}</strong>
                      </header>
                      <div>
                        {archivedCustomShelves.map((shelf) => (
                          <button
                            type="button"
                            key={shelf.id}
                            onClick={() => openSheet({ kind: 'custom-shelf', shelfId: shelf.id })}
                          >
                            <span><strong>{shelf.name}</strong><small>Books remain in your library</small></span>
                            <ChevronRight aria-hidden="true" />
                          </button>
                        ))}
                      </div>
                    </section>
                  )}
                </>
              )}
            </main>
          </div>
        ) : view === 'import' && importPreview ? (
          <ImportReviewPage
            preview={importPreview}
            books={books}
            busy={importBusy}
            error={importError}
            onBack={showSettings}
            onCommit={commitImport}
          />
        ) : (
          <SettingsPage
            books={books}
            appearance={appearance}
            searchPreferences={searchPreferences}
            importHistory={importHistory}
            importBusy={importBusy}
            importError={importError}
            exportBusy={exportBusy}
            exportError={exportError}
            onBack={showLibrary}
            onAppearanceChange={setAppearance}
            onSearchPreferencesChange={setSearchPreferences}
            onManualAdd={() => openSheet({ kind: 'search', shelf: 'tbr', manual: true })}
            onImportFile={(file) => { void handleImportFile(file) }}
            onUndoImport={(batchId) => { void undoImportBatch(batchId) }}
            onExport={(format, includeAnnotations) => { void handleExport(format, includeAnnotations) }}
          />
        )}

        <BottomNavigation
          view={view}
          onLibrary={showLibrary}
          onShelf={showShelf}
          onAdd={() => openSheet({ kind: 'search', shelf: 'tbr' })}
          onSettings={showSettings}
        />
      </div>

      <div
        className={`toast${toast ? ' is-visible' : ''}`}
        data-motion-event={toast?.family}
        role="status"
        aria-live="polite"
      >
        <Check aria-hidden="true" />
        <span>{toast?.message}</span>
        {toast?.undo && (
          <button type="button" onClick={toast.undo}>Undo</button>
        )}
      </div>

      {sheet?.kind === 'search' && (
        <SearchSheet
          shelf={sheet.shelf}
          books={books}
          onAdd={handleAdd}
          onClose={closeSheet}
          initialManual={sheet.manual}
        />
      )}

      {sheet?.kind === 'progress' && selectedBook && (
        <ProgressSheet
          book={selectedBook}
          onClose={closeSheet}
          onProgress={(progress) => setProgress(selectedBook.id, progress)}
          onPage={(page) => setCurrentPage(selectedBook.id, page)}
          onFinish={() => handleFinish(selectedBook.id)}
        />
      )}

      {sheet?.kind === 'finished' && selectedBook && (
        <FinishedSheet
          book={selectedBook}
          onClose={closeSheet}
          onRate={(rating) => updateBook(selectedBook.id, { rating })}
        />
      )}

      {sheet?.kind === 'detail' && selectedBook && (
        <DetailSheet
          book={selectedBook}
          customShelves={activeCustomShelves}
          customShelfIds={organization.entries
            .filter((entry) => entry.bookId === selectedBook.id && activeCustomShelves.some(({ id }) => id === entry.shelfId))
            .map(({ shelfId }) => shelfId)}
          tags={tagsForBook(organization, selectedBook.id).map(({ name }) => name)}
          tagSuggestions={organization.tags.map(({ name }) => name)}
          onClose={closeSheet}
          onMove={(shelf) => {
            if (shelf === 'finished') {
              handleFinish(selectedBook.id)
            } else {
              moveToShelf(selectedBook.id, shelf)
              setMovingBookId(selectedBook.id)
              setToast({ message: `Moved to ${shelfCopy[shelf].label}` })
            }
          }}
          onProgress={() => openSheet({ kind: 'progress', bookId: selectedBook.id })}
          onFinish={() => handleFinish(selectedBook.id)}
          onRate={(rating) => updateBook(selectedBook.id, { rating })}
          onNotes={(notes) => updateBook(selectedBook.id, { notes })}
          onCustomShelves={(activeShelfIds) => {
            const archivedMemberships = organization.entries
              .filter((entry) => entry.bookId === selectedBook.id
                && archivedCustomShelves.some(({ id }) => id === entry.shelfId))
              .map(({ shelfId }) => shelfId)
            setBookMemberships(selectedBook.id, [...archivedMemberships, ...activeShelfIds])
            setToast({ message: 'Custom shelf membership saved; reading status unchanged' })
          }}
          onTags={(tags) => setBookTags(selectedBook.id, tags)}
          onRemove={() => {
            removeBook(selectedBook.id)
            removeQueueBook(selectedBook.id)
            closeSheet()
            setToast({ message: 'Removed from your library' })
          }}
        />
      )}

      {sheet?.kind === 'custom-shelf' && (
        <CustomShelfEditorSheet
          key={sheet.shelfId ?? 'new-custom-shelf'}
          shelf={selectedCustomShelf}
          organization={organization}
          books={books}
          onClose={closeSheet}
          onSave={saveCustomShelf}
          onArchive={archiveCustomShelf}
          onDelete={deleteCustomShelf}
        />
      )}

      {sheet?.kind === 'up-next' && (
        <Sheet title="How should Up Next help?" onClose={closeSheet} tall>
          <UpNextSettings
            state={upNext}
            books={books}
            onSave={saveUpNextSettings}
            onRestoreSuggestion={restoreSuggestion}
            onRestoreReason={(criterion) => setReasonState(criterion, 'neutral')}
          />
        </Sheet>
      )}

      <CommandPalette
        key={commandMenuOpen ? 'command-menu-open' : 'command-menu-closed'}
        open={commandMenuOpen}
        books={books}
        libraryIndex={librarySearchIndex}
        includePrivateNotes={searchPreferences.includePrivateNotes}
        onClose={() => setCommandMenuOpen(false)}
        onLibrary={showLibrary}
        onSettings={showSettings}
        onShelf={showShelf}
        onAdd={() => openSheet({ kind: 'search', shelf: 'tbr' })}
        onBook={(bookId) => {
          setView('library')
          openSheet({ kind: 'detail', bookId })
        }}
        onBookAction={(bookId, shelf) => {
          setView('library')
          if (shelf === 'finished') {
            handleFinish(bookId)
          } else {
            moveToShelf(bookId, shelf)
            setMovingBookId(bookId)
            setToast({ message: `Moved to ${shelfCopy[shelf].label}` })
          }
        }}
      />
    </div>
  )
}

export default App
