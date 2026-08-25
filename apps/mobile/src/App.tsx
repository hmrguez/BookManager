import {
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
  ArrowRight,
  BookCheck,
  BookPlus,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  CirclePlus,
  Clock3,
  FolderInput,
  Library,
  Minus,
  Palette,
  Plus,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  Star,
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
  getAppearanceStorage,
  motionScrollBehavior,
  readAppearance,
  writeAppearance,
  type AppearancePreferences,
} from './design-system'
import './App.css'

type SheetState =
  | { kind: 'search'; shelf: ShelfId; manual?: boolean }
  | { kind: 'detail'; bookId: string }
  | { kind: 'progress'; bookId: string }
  | { kind: 'finished'; bookId: string }
  | null

type CoverData = Pick<LibraryBook, 'id' | 'title' | 'authors' | 'thumbnail'>
type AppView = 'library' | 'settings'
type ToastState = { message: string; undo?: () => void; family?: 'undo' } | null

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

function formatUpdated(value: string) {
  const date = new Date(value)
  const today = new Date()
  const isToday = date.toDateString() === today.toDateString()
  return `${isToday ? 'Today' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} at ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
}

function Cover({ book, large = false }: { book: CoverData; large?: boolean }) {
  const [imageFailed, setImageFailed] = useState(false)
  const colorIndex = [...book.title].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 6
  const initials = book.title
    .replace(/^(the|a|an)\s+/i, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')

  return (
    <div
      className={`book-cover tone-${colorIndex}${large ? ' book-cover--large' : ''}`}
      style={{ '--cover-index': colorIndex } as CSSProperties}
      aria-hidden="true"
    >
      {book.thumbnail && !imageFailed ? (
        <img src={book.thumbnail} alt="" onError={() => setImageFailed(true)} />
      ) : (
        <>
          <span className="cover-rule" />
          <strong>{initials || 'BK'}</strong>
          <small>{book.authors[0]?.split(' ').at(-1) ?? 'Book'}</small>
        </>
      )}
    </div>
  )
}

function Stars({
  value,
  onChange,
  compact = false,
}: {
  value: number
  onChange?: (rating: number) => void
  compact?: boolean
}) {
  return (
    <div className={`stars${compact ? ' stars--compact' : ''}`} aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((rating) =>
        onChange ? (
          <button
            type="button"
            key={rating}
            className={rating <= value ? 'is-filled' : ''}
            aria-label={`Rate ${rating} out of 5`}
            onClick={() => onChange(rating)}
          >
            <Star aria-hidden="true" />
          </button>
        ) : (
          <Star key={rating} className={rating <= value ? 'is-filled' : ''} aria-hidden="true" />
        ),
      )}
    </div>
  )
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
              <button type="button" className="secondary-button" onClick={() => setManualMode(false)}>
                Back to search
              </button>
            )}
            <button type="submit" className="primary-button" disabled={!manualTitle.trim()}>
              <BookPlus aria-hidden="true" /> Add to {shelfCopy[shelf].label}
            </button>
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
              <Cover book={result} />
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
                <Cover book={book} />
                <span className="book-copy">
                  <strong>{book.title}</strong>
                  <small>{authorLine(book.authors)}</small>
                </span>
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
                    <i>
                      <b style={{ width: `${book.progress}%` }} />
                    </i>
                  </button>
                  <button className="row-action row-action--finish" type="button" onClick={() => onFinish(book.id)}>
                    Finish <Check aria-hidden="true" />
                  </button>
                </div>
              )}

              {shelf === 'finished' && (
                <Stars compact value={book.rating} onChange={(rating) => onRate(book.id, rating)} />
              )}
            </article>
          ))
        )}
      </div>
    </section>
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
        <Cover book={book} />
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
        <Cover book={book} large />
        <div>
          <span className="finish-mark"><Check aria-hidden="true" /></span>
          <p>Another story, kept.</p>
          <h3>{book.title}</h3>
          <small>{authorLine(book.authors)}</small>
        </div>
      </div>
      <div className="finish-rating">
        <span>Your rating</span>
        <Stars value={book.rating} onChange={onRate} />
        <small>{book.rating ? `${book.rating} out of 5` : 'Optional — tap a star'}</small>
      </div>
      <button className="primary-button" type="button" onClick={onClose}>Done</button>
    </Sheet>
  )
}

function DetailSheet({
  book,
  onClose,
  onMove,
  onProgress,
  onFinish,
  onRate,
  onNotes,
  onRemove,
}: {
  book: LibraryBook
  onClose: () => void
  onMove: (shelf: ShelfId) => void
  onProgress: () => void
  onFinish: () => void
  onRate: (rating: number) => void
  onNotes: (notes: string) => void
  onRemove: () => void
}) {
  const [showShelves, setShowShelves] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)

  return (
    <Sheet title="Book details" onClose={onClose} tall>
      <div className="detail-hero">
        <Cover book={book} large />
        <div className="detail-hero__copy">
          <span className="status-pill"><BookOpen aria-hidden="true" /> {shelfCopy[book.shelf].label}</span>
          <h3>{book.title}</h3>
          <p>{authorLine(book.authors)}</p>
          {book.pageCount > 0 && <small>{book.pageCount} pages</small>}
        </div>
      </div>

      {(book.shelf === 'reading' || book.shelf === 'finished') && (
        <button className="detail-progress" type="button" onClick={onProgress} disabled={book.shelf === 'finished'}>
          <span><strong>{book.progress}%</strong> complete</span>
          {book.pageCount > 0 && <small>{book.currentPage} / {book.pageCount} pages</small>}
          <i><b style={{ width: `${book.progress}%` }} /></i>
        </button>
      )}

      <div className="detail-rating">
        <span>My rating</span>
        <Stars value={book.rating} onChange={onRate} />
      </div>

      <label className="notes-field">
        <span>Private notes</span>
        <textarea
          value={book.notes}
          onChange={(event) => onNotes(event.target.value)}
          placeholder="What do you want to remember?"
          rows={3}
        />
      </label>

      <div className="detail-actions">
        <button type="button" onClick={() => setShowShelves((value) => !value)}>
          <FolderInput aria-hidden="true" />
          <span>Move to…</span>
          <ChevronRight className={showShelves ? 'is-rotated' : ''} aria-hidden="true" />
        </button>
        {showShelves && (
          <div className="move-choices" data-motion-event="reveal">
            {SHELVES.map((shelf) => (
              <button
                type="button"
                className={book.shelf === shelf.id ? 'is-current' : ''}
                key={shelf.id}
                onClick={() => onMove(shelf.id)}
                disabled={book.shelf === shelf.id}
              >
                {shelf.shortLabel}
                {book.shelf === shelf.id && <Check aria-hidden="true" />}
              </button>
            ))}
          </div>
        )}
        {book.shelf !== 'finished' && (
          <button type="button" onClick={onFinish}>
            <BookCheck aria-hidden="true" />
            <span>Mark finished</span>
            <ChevronRight aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className="remove-action"
          onClick={() => (confirmRemove ? onRemove() : setConfirmRemove(true))}
        >
          <Trash2 aria-hidden="true" />
          <span>{confirmRemove ? 'Tap again to remove' : 'Remove from library'}</span>
          <ChevronRight aria-hidden="true" />
        </button>
      </div>
    </Sheet>
  )
}

function SettingsPage({
  books,
  appearance,
  onBack,
  onAppearanceChange,
  onManualAdd,
}: {
  books: LibraryBook[]
  appearance: AppearancePreferences
  onBack: () => void
  onAppearanceChange: (preferences: AppearancePreferences) => void
  onManualAdd: () => void
}) {
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
    addBook,
    updateBook,
    moveBook,
    setProgress,
    setCurrentPage,
    finishBook,
    removeBook,
  } = useLibrary()
  const [sheet, setSheet] = useState<SheetState>(null)
  const [view, setView] = useState<AppView>('library')
  const [librarySearchOpen, setLibrarySearchOpen] = useState(false)
  const [libraryQuery, setLibraryQuery] = useState('')
  const [toast, setToast] = useState<ToastState>(null)
  const [movingBookId, setMovingBookId] = useState<string>()
  const [appearance, setAppearance] = useState(() => readAppearance(getAppearanceStorage()))
  const sheetTriggerRef = useRef<HTMLElement | null>(null)

  const normalizedLibraryQuery = libraryQuery.trim().toLocaleLowerCase()
  const visibleBooks = useMemo(() => {
    if (!normalizedLibraryQuery) return books

    return books.filter((book) =>
      [book.title, ...book.authors].some((value) =>
        value.toLocaleLowerCase().includes(normalizedLibraryQuery),
      ),
    )
  }, [books, normalizedLibraryQuery])

  const booksByShelf = useMemo(
    () => Object.fromEntries(SHELVES.map(({ id }) => [id, visibleBooks.filter((book) => book.shelf === id)])) as Record<ShelfId, LibraryBook[]>,
    [visibleBooks],
  )

  const selectedBook = sheet && 'bookId' in sheet
    ? books.find((book) => book.id === sheet.bookId)
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

  const scrollToShelf = (shelf: ShelfId) => {
    document.getElementById(`shelf-${shelf}`)?.scrollIntoView({
      behavior: motionScrollBehavior(appearance.motion),
      block: 'start',
    })
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
    window.scrollTo({ top: 0, behavior: motionScrollBehavior(appearance.motion) })
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

  const moveWithUndo = (id: string, shelf: ShelfId, message: string) => {
    const book = books.find((item) => item.id === id)
    if (!book || book.shelf === shelf) return

    const previousShelf = book.shelf
    moveBook(id, shelf)
    setMovingBookId(id)
    setToast({
      message,
      undo: () => {
        moveBook(id, previousShelf)
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
      setMovingBookId(previous.id)
      setToast({ message: `Moved to ${shelfCopy[shelf].label}` })
      return
    }

    addBook(result, shelf)
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
    setMovingBookId(id)
    openSheet({ kind: 'finished', bookId: id })
  }

  return (
    <div className="library-app">
      <div className="app-content" inert={sheet ? true : undefined} aria-hidden={sheet ? true : undefined}>
        {view === 'library' ? (
          <div className="library-page" data-motion-event="navigate">
            <header className="app-header" id="top">
              <div className="title-row">
                <h1 tabIndex={-1}>My Books</h1>
                <button
                  className={`header-search${librarySearchOpen ? ' is-open' : ''}`}
                  type="button"
                  onClick={() => {
                    setLibrarySearchOpen((value) => !value)
                    if (librarySearchOpen) setLibraryQuery('')
                  }}
                  aria-label={librarySearchOpen ? 'Close library search' : 'Search my library'}
                  aria-expanded={librarySearchOpen}
                >
                  {librarySearchOpen ? <X aria-hidden="true" /> : <Search aria-hidden="true" />}
                </button>
              </div>

              {librarySearchOpen && (
                <div className="library-search" data-motion-event="reveal">
                  <Search aria-hidden="true" />
                  <input
                    autoFocus
                    type="search"
                    value={libraryQuery}
                    onChange={(event) => setLibraryQuery(event.target.value)}
                    placeholder="Search your books"
                    aria-label="Search your books by title or author"
                    autoCapitalize="none"
                    enterKeyHint="search"
                  />
                  <small aria-live="polite">
                    {normalizedLibraryQuery ? `${visibleBooks.length} found` : 'On this device'}
                  </small>
                  {libraryQuery && (
                    <button type="button" onClick={() => setLibraryQuery('')} aria-label="Clear library search">
                      <X aria-hidden="true" />
                    </button>
                  )}
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
            </header>

            <main className="shelf-stack">
              {normalizedLibraryQuery && visibleBooks.length === 0 ? (
                <div className="library-no-results">
                  <Search aria-hidden="true" />
                  <div>
                    <strong>No books found</strong>
                    <span>Try another title or author.</span>
                  </div>
                </div>
              ) : (
                SHELVES.filter(
                  (shelf) => !normalizedLibraryQuery || booksByShelf[shelf.id].length > 0,
                ).map((shelf) => (
                  <ShelfSection
                    key={shelf.id}
                    shelf={shelf.id}
                    books={booksByShelf[shelf.id]}
                    isFiltering={Boolean(normalizedLibraryQuery)}
                    movingBookId={movingBookId}
                    onAdd={(targetShelf) => openSheet({ kind: 'search', shelf: targetShelf })}
                    onDetails={(bookId) => openSheet({ kind: 'detail', bookId })}
                    onProgress={(bookId) => openSheet({ kind: 'progress', bookId })}
                    onNext={handleNext}
                    onStart={handleStart}
                    onFinish={handleFinish}
                    onRate={(id, rating) => updateBook(id, { rating })}
                  />
                ))
              )}
            </main>
          </div>
        ) : (
          <SettingsPage
            books={books}
            appearance={appearance}
            onBack={showLibrary}
            onAppearanceChange={setAppearance}
            onManualAdd={() => openSheet({ kind: 'search', shelf: 'tbr', manual: true })}
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
          onClose={closeSheet}
          onMove={(shelf) => {
            if (shelf === 'finished') {
              handleFinish(selectedBook.id)
            } else {
              moveBook(selectedBook.id, shelf)
              setMovingBookId(selectedBook.id)
              setToast({ message: `Moved to ${shelfCopy[shelf].label}` })
            }
          }}
          onProgress={() => openSheet({ kind: 'progress', bookId: selectedBook.id })}
          onFinish={() => handleFinish(selectedBook.id)}
          onRate={(rating) => updateBook(selectedBook.id, { rating })}
          onNotes={(notes) => updateBook(selectedBook.id, { notes })}
          onRemove={() => {
            removeBook(selectedBook.id)
            closeSheet()
            setToast({ message: 'Removed from your library' })
          }}
        />
      )}
    </div>
  )
}

export default App
