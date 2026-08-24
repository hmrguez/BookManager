import {
  useEffect,
  useMemo,
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
  ChevronRight,
  CirclePlus,
  Clock3,
  FolderInput,
  Library,
  Minus,
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
import './App.css'

type SheetState =
  | { kind: 'search'; shelf: ShelfId; manual?: boolean }
  | { kind: 'detail'; bookId: string }
  | { kind: 'progress'; bookId: string }
  | { kind: 'finished'; bookId: string }
  | null

type CoverData = Pick<LibraryBook, 'id' | 'title' | 'authors' | 'thumbnail'>
type AppView = 'library' | 'settings'

const MANUAL_ENTRY_ENABLED =
  import.meta.env.DEV || import.meta.env.VITE_ENABLE_MANUAL_BOOKS === 'true'
const GOOGLE_BOOKS_KEY_CONFIGURED = Boolean(import.meta.env.VITE_GOOGLE_BOOKS_API_KEY)

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
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [onClose])

  return (
    <div className="sheet-layer" role="presentation" onMouseDown={onClose}>
      <section
        className={`bottom-sheet${tall ? ' bottom-sheet--tall' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="sheet-handle" aria-hidden="true" />
        <header className="sheet-header">
          <div>
            <span className="sheet-kicker">BookManager</span>
            <h2>{title}</h2>
          </div>
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
  onAdd,
  onDetails,
  onProgress,
  onNext,
  onStart,
  onFinish,
  onRate,
}: {
  shelf: ShelfId
  books: LibraryBook[]
  onAdd: (shelf: ShelfId) => void
  onDetails: (id: string) => void
  onProgress: (id: string) => void
  onNext: (id: string) => void
  onStart: (id: string) => void
  onFinish: (id: string) => void
  onRate: (id: string, rating: number) => void
}) {
  const meta = shelfCopy[shelf]

  return (
    <section className={`shelf shelf--${shelf}`} id={`shelf-${shelf}`} data-shelf={shelf}>
      <header className="shelf-header">
        <div>
          <span>{meta.eyebrow}</span>
          <h2>
            {meta.label} <i>·</i> {books.length}
          </h2>
        </div>
        <button
          type="button"
          className="shelf-add"
          onClick={() => onAdd(shelf)}
          aria-label={`Add a book to ${meta.label}`}
        >
          <Plus aria-hidden="true" />
        </button>
      </header>

      <div className="shelf-books">
        {books.length === 0 ? (
          <button className="empty-shelf" type="button" onClick={() => onAdd(shelf)}>
            <CirclePlus aria-hidden="true" />
            <span>
              <strong>{meta.empty}</strong>
              <small>Search by title, author, or ISBN</small>
            </span>
          </button>
        ) : (
          books.map((book) => (
            <article className="book-row" key={book.id}>
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
        <output>{book.progress}<span>%</span></output>
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
      <div className="finish-celebration">
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
          <div className="move-choices">
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
  onBack,
  onManualAdd,
}: {
  books: LibraryBook[]
  onBack: () => void
  onManualAdd: () => void
}) {
  const ratedBooks = books.filter((book) => book.rating > 0).length
  const notedBooks = books.filter((book) => book.notes.trim()).length

  return (
    <main className="settings-page">
      <header className="settings-header">
        <div className="app-header__meta">
          <span>BookManager</span>
          <i aria-hidden="true" />
          <span>Local preferences</span>
        </div>
        <div className="title-row">
          <div>
            <p>Quiet controls for a private library</p>
            <h1>Settings</h1>
          </div>
          <button className="header-search" type="button" onClick={onBack} aria-label="Back to my books">
            <Library aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="settings-ledger">
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
  activeShelf,
  onLibrary,
  onShelf,
  onAdd,
  onSettings,
}: {
  view: AppView
  activeShelf: ShelfId
  onLibrary: () => void
  onShelf: (shelf: ShelfId) => void
  onAdd: () => void
  onSettings: () => void
}) {
  return (
    <nav className="bottom-nav" aria-label="App shortcuts">
      <button
        className={view === 'library' && activeShelf === 'tbr' ? 'is-active' : ''}
        type="button"
        onClick={onLibrary}
        aria-current={view === 'library' && activeShelf === 'tbr' ? 'page' : undefined}
      >
        <Library aria-hidden="true" /><span>My Books</span>
      </button>
      <button
        className={view === 'library' && activeShelf === 'reading' ? 'is-active' : ''}
        type="button"
        onClick={() => onShelf('reading')}
        aria-current={view === 'library' && activeShelf === 'reading' ? 'page' : undefined}
      >
        <BookOpen aria-hidden="true" /><span>Reading</span>
      </button>
      <button className="bottom-nav__add" type="button" onClick={onAdd}>
        <Plus aria-hidden="true" /><span>Add Book</span>
      </button>
      <button
        className={view === 'library' && activeShelf === 'finished' ? 'is-active' : ''}
        type="button"
        onClick={() => onShelf('finished')}
        aria-current={view === 'library' && activeShelf === 'finished' ? 'page' : undefined}
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
  const [activeShelf, setActiveShelf] = useState<ShelfId>('tbr')
  const [toast, setToast] = useState('')

  const booksByShelf = useMemo(
    () => Object.fromEntries(SHELVES.map(({ id }) => [id, books.filter((book) => book.shelf === id)])) as Record<ShelfId, LibraryBook[]>,
    [books],
  )

  const selectedBook = sheet && 'bookId' in sheet
    ? books.find((book) => book.id === sheet.bookId)
    : undefined

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 2400)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (view !== 'library') return
    const sections = SHELVES.map(({ id }) => document.getElementById(`shelf-${id}`)).filter(Boolean)
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        const shelf = visible?.target.getAttribute('data-shelf') as ShelfId | null
        if (shelf) setActiveShelf(shelf)
      },
      { rootMargin: '-22% 0px -58% 0px', threshold: [0, 0.25, 0.6] },
    )
    sections.forEach((section) => observer.observe(section as Element))
    return () => observer.disconnect()
  }, [view])

  const scrollToShelf = (shelf: ShelfId) => {
    setActiveShelf(shelf)
    document.getElementById(`shelf-${shelf}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const showLibrary = () => {
    setView('library')
    window.setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 0)
  }

  const showShelf = (shelf: ShelfId) => {
    setView('library')
    window.setTimeout(() => scrollToShelf(shelf), 0)
  }

  const showSettings = () => {
    setView('settings')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleAdd = (result: BookSearchResult, shelf: ShelfId) => {
    const previous = books.find((book) => book.id === result.id)
    addBook(result, shelf)
    setToast(previous ? `Moved to ${shelfCopy[shelf].label}` : `Added to ${shelfCopy[shelf].label}`)
  }

  const handleStart = (id: string) => {
    const book = books.find((item) => item.id === id)
    moveBook(id, 'reading')
    setToast(`${book?.title ?? 'Book'} is now being read`)
  }

  const handleNext = (id: string) => {
    const book = books.find((item) => item.id === id)
    moveBook(id, 'next')
    setToast(`${book?.title ?? 'Book'} moved to Up Next`)
  }

  const handleFinish = (id: string) => {
    finishBook(id)
    setSheet({ kind: 'finished', bookId: id })
  }

  return (
    <div className="library-app">
      <div className="app-content" inert={sheet ? true : undefined} aria-hidden={sheet ? true : undefined}>
        {view === 'library' ? (
          <>
            <header className="app-header" id="top">
              <div className="app-header__meta">
                <span>Private library</span>
                <i aria-hidden="true" />
                <span>Stored on this device</span>
              </div>
              <div className="title-row">
                <div>
                  <p>{books.length} books, no noise</p>
                  <h1>My Books</h1>
                </div>
                <button
                  className="header-search"
                  type="button"
                  onClick={() => setSheet({ kind: 'search', shelf: 'tbr' })}
                  aria-label="Search and add a book"
                >
                  <Search aria-hidden="true" />
                </button>
              </div>

              <nav className="shelf-tabs" aria-label="Jump to a shelf">
                {SHELVES.map((shelf) => (
                  <button
                    className={activeShelf === shelf.id ? 'is-active' : ''}
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
              {SHELVES.map((shelf) => (
                <ShelfSection
                  key={shelf.id}
                  shelf={shelf.id}
                  books={booksByShelf[shelf.id]}
                  onAdd={(targetShelf) => setSheet({ kind: 'search', shelf: targetShelf })}
                  onDetails={(bookId) => setSheet({ kind: 'detail', bookId })}
                  onProgress={(bookId) => setSheet({ kind: 'progress', bookId })}
                  onNext={handleNext}
                  onStart={handleStart}
                  onFinish={handleFinish}
                  onRate={(id, rating) => updateBook(id, { rating })}
                />
              ))}
            </main>

            <footer className="local-note">
              <Library aria-hidden="true" />
              <p><strong>Yours alone.</strong> Your shelves, progress, ratings, and notes stay on this device.</p>
            </footer>
          </>
        ) : (
          <SettingsPage
            books={books}
            onBack={showLibrary}
            onManualAdd={() => setSheet({ kind: 'search', shelf: 'tbr', manual: true })}
          />
        )}

        <BottomNavigation
          view={view}
          activeShelf={activeShelf}
          onLibrary={showLibrary}
          onShelf={showShelf}
          onAdd={() => setSheet({ kind: 'search', shelf: 'tbr' })}
          onSettings={showSettings}
        />
      </div>

      <div className={`toast${toast ? ' is-visible' : ''}`} role="status" aria-live="polite">
        <Check aria-hidden="true" /> {toast}
      </div>

      {sheet?.kind === 'search' && (
        <SearchSheet
          shelf={sheet.shelf}
          books={books}
          onAdd={handleAdd}
          onClose={() => setSheet(null)}
          initialManual={sheet.manual}
        />
      )}

      {sheet?.kind === 'progress' && selectedBook && (
        <ProgressSheet
          book={selectedBook}
          onClose={() => setSheet(null)}
          onProgress={(progress) => setProgress(selectedBook.id, progress)}
          onPage={(page) => setCurrentPage(selectedBook.id, page)}
          onFinish={() => handleFinish(selectedBook.id)}
        />
      )}

      {sheet?.kind === 'finished' && selectedBook && (
        <FinishedSheet
          book={selectedBook}
          onClose={() => setSheet(null)}
          onRate={(rating) => updateBook(selectedBook.id, { rating })}
        />
      )}

      {sheet?.kind === 'detail' && selectedBook && (
        <DetailSheet
          book={selectedBook}
          onClose={() => setSheet(null)}
          onMove={(shelf) => {
            moveBook(selectedBook.id, shelf)
            setToast(`Moved to ${shelfCopy[shelf].label}`)
            if (shelf === 'finished') setSheet({ kind: 'finished', bookId: selectedBook.id })
          }}
          onProgress={() => setSheet({ kind: 'progress', bookId: selectedBook.id })}
          onFinish={() => handleFinish(selectedBook.id)}
          onRate={(rating) => updateBook(selectedBook.id, { rating })}
          onNotes={(notes) => updateBook(selectedBook.id, { notes })}
          onRemove={() => {
            removeBook(selectedBook.id)
            setSheet(null)
            setToast('Removed from your library')
          }}
        />
      )}
    </div>
  )
}

export default App
