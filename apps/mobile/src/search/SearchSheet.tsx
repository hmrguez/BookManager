import { useEffect, useState, type FormEvent } from 'react'
import { Check, ChevronRight, BookPlus, Plus, Search, Wrench, X } from 'lucide-react'
import { ActionButton, BookCover } from '../design-system'
import { searchGoogleBooks } from '../googleBooks'
import type { BookSearchResult, LibraryBook, ShelfId } from '../library'
import { MANUAL_ENTRY_ENABLED, shelfCopy } from '../app/config'
import { Sheet } from '../app/components/Sheet'
import { tw } from '../tailwind/styles'

function authorLine(authors: string[]) {
  return authors.join(', ')
}

export function SearchSheet({
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
    if (cleanQuery.length < 2) return

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
    <Sheet title={manualMode ? 'Force add a book' : `Add to ${shelfCopy[shelf].label}`} onClose={onClose} tall>
      {manualMode ? (
        <form className={tw('manual-book-form')} onSubmit={forceAddBook}>
          <div className={tw('manual-notice')}>
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
          <div className={tw('manual-form-actions')}>
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
          <form className={tw('book-search')} onSubmit={addFirstResult}>
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

          <div className={tw('search-meta')} aria-live="polite">
            {status === 'idle' && <span>Search Google Books. Tap once to add.</span>}
            {status === 'loading' && <span>Looking through the stacks…</span>}
            {status === 'ready' && (
              <span>{results.length ? `${results.length} books found` : 'No matching books found'}</span>
            )}
            {status === 'error' && <span>Google Books is unavailable right now. Try again shortly.</span>}
          </div>

          {MANUAL_ENTRY_ENABLED && (
            <button className={tw('manual-entry-trigger')} type="button" onClick={openManualEntry}>
              <Wrench aria-hidden="true" />
              <span>
                <strong>{query.trim() ? `Can't find “${query.trim()}”?` : 'Google Books missing something?'}</strong>
                Force add it locally
              </span>
              <ChevronRight aria-hidden="true" />
            </button>
          )}

          <div className={tw('search-results')}>
            {results.map((result) => {
              const existing = books.find((book) => book.id === result.id)
              const alreadyHere = existing?.shelf === shelf
              return (
                <article className={tw('search-result')} key={result.id}>
                  <BookCover book={result} />
                  <div className={tw('search-result__copy')}>
                    <h3>{result.title}</h3>
                    <p>{authorLine(result.authors)}</p>
                    {result.pageCount > 0 && <small>{result.pageCount} pages</small>}
                  </div>
                  <button
                    className={tw(`result-add${alreadyHere ? ' is-added' : ''}`)}
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
