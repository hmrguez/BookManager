import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import {
  BookOpen,
  BookPlus,
  Check,
  ChevronRight,
  Database,
  Plus,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'
import { ActionButton, BookCover } from '../design-system'
import type { BookSearchResult, LibraryBook, ShelfId } from '../library'
import { findLibraryBookForSearchResult } from '../library-model'
import {
  getMetadataSearchService,
  metadataConfidenceLabel,
  selectMetadataVariant,
  type ProviderSearchState,
} from '../metadata'
import { shelfCopy } from '../app/config'
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
  const [results, setResults] = useState<readonly BookSearchResult[]>([])
  const [providerStates, setProviderStates] = useState<readonly ProviderSearchState[]>([])
  const [canBroaden, setCanBroaden] = useState(false)
  const [usedFallback, setUsedFallback] = useState(false)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [manualMode, setManualMode] = useState(initialManual)
  const [manualTitle, setManualTitle] = useState('')
  const [manualAuthor, setManualAuthor] = useState('')
  const [manualPages, setManualPages] = useState('')
  const requestIdRef = useRef(0)

  const performSearch = useCallback(async (
    cleanQuery: string,
    options: { readonly includeSecondary?: boolean; readonly refresh?: boolean } = {},
    signal?: AbortSignal,
  ) => {
    const requestId = ++requestIdRef.current
    setStatus('loading')
    try {
      const service = await getMetadataSearchService()
      const response = await service.search({
        query: cleanQuery,
        locale: navigator.language || 'en',
        limit: 16,
      }, { ...options, signal })
      if (requestId !== requestIdRef.current) return
      setResults(response.results)
      setProviderStates(response.providers)
      setCanBroaden(response.canBroaden)
      setUsedFallback(response.usedFallback)
      const available = response.providers.some(({ state }) =>
        state === 'live' || state === 'saved' || state === 'empty',
      )
      setStatus(available ? 'ready' : 'error')
    } catch (error) {
      if (requestId !== requestIdRef.current || isAbortError(error)) return
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    const cleanQuery = query.trim()
    if (cleanQuery.length < 2) return

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void performSearch(cleanQuery, {}, controller.signal)
    }, 500)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [performSearch, query])

  const addFirstResult = (event: FormEvent) => {
    event.preventDefault()
    if (results[0]) onAdd(results[0], shelf)
  }

  const updateQuery = (value: string) => {
    setQuery(value)
    if (value.trim().length < 2) {
      requestIdRef.current += 1
      setResults([])
      setProviderStates([])
      setCanBroaden(false)
      setUsedFallback(false)
      setStatus('idle')
    }
  }

  const openManualEntry = () => {
    setManualTitle(query.trim())
    setManualMode(true)
  }

  const addManualBook = (event: FormEvent) => {
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

  const broadenSearch = () => {
    const cleanQuery = query.trim()
    if (cleanQuery.length >= 2) void performSearch(cleanQuery, { includeSecondary: true })
  }

  const refreshSearch = () => {
    const cleanQuery = query.trim()
    if (cleanQuery.length >= 2) void performSearch(cleanQuery, { refresh: true })
  }

  const hasSavedResults = providerStates.some(({ state }) => state === 'saved')

  return (
    <Sheet title={manualMode ? 'Add a book manually' : `Add to ${shelfCopy[shelf].label}`} onClose={onClose} tall>
      {manualMode ? (
        <form className={tw('manual-book-form')} onSubmit={addManualBook}>
          <div className={tw('manual-notice')}>
            <BookPlus aria-hidden="true" />
            <p>
              <strong>A personal record</strong>
              This book stays on your device. You can enrich its metadata later.
            </p>
          </div>
          <label>
            <span>Book title</span>
            <input
              autoFocus
              required
              value={manualTitle}
              onChange={(event) => setManualTitle(event.target.value)}
              placeholder="Book title"
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
              type="search"
              value={query}
              onChange={(event) => updateQuery(event.target.value)}
              placeholder="Title, author, or ISBN"
              aria-label="Search book catalogs"
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
            {status === 'idle' && <span>Open Library is ready. Tap once to add.</span>}
            {status === 'loading' && <span>Looking through the catalogs…</span>}
            {status === 'ready' && (
              <span>
                {results.length ? `${results.length} books found` : 'No matching books found'}
                {usedFallback ? ' · broadened with Google Books' : ''}
              </span>
            )}
            {status === 'error' && (
              <span>Book catalogs are unavailable. You can still add a personal record.</span>
            )}
          </div>

          {(canBroaden || hasSavedResults) && (
            <div className={tw('search-provider-actions')}>
              {canBroaden && (
                <button type="button" onClick={broadenSearch} disabled={status === 'loading'}>
                  <BookOpen aria-hidden="true" /> Also search Google Books
                </button>
              )}
              {hasSavedResults && (
                <button type="button" onClick={refreshSearch} disabled={status === 'loading'}>
                  <RefreshCw aria-hidden="true" /> Refresh saved results
                </button>
              )}
            </div>
          )}

          <button className={tw('manual-entry-trigger')} type="button" onClick={openManualEntry}>
            <BookPlus aria-hidden="true" />
            <span>
              <strong>{query.trim() ? `Can't find “${query.trim()}”?` : 'Know exactly what belongs here?'}</strong>
              Add a personal record on this device
            </span>
            <ChevronRight aria-hidden="true" />
          </button>

          <div className={tw('search-results')}>
            {results.map((result) => {
              const existing = findLibraryBookForSearchResult(books, result)
              const alreadyHere = existing?.shelf === shelf
              const selection = result.metadataSelection
              const selectedVariant = selection?.variants.find(
                ({ provider }) => provider === selection.selectedProvider,
              )
              return (
                <article className={tw('search-result')} key={result.id}>
                  <BookCover book={result} />
                  <div className={tw('search-result__copy')}>
                    <h3>{result.title}</h3>
                    <p>{authorLine(result.authors)}</p>
                    <div className={tw('search-result__evidence')}>
                      {selectedVariant && (
                        <>
                          <span>
                            <a href={providerUrl(selectedVariant)} target="_blank" rel="noreferrer">
                              {selectedVariant.providerName}
                            </a>
                          </span>
                          <span>{metadataConfidenceLabel(selectedVariant.confidence)}</span>
                        </>
                      )}
                      {result.pageCount > 0 && <span>{result.pageCount} pages</span>}
                      {selection?.freshness === 'saved' && <span><Database aria-hidden="true" /> Saved</span>}
                      {selection && selection.conflicts.length > 0 && (
                        <span>{selection.conflicts.length} {selection.conflicts.length === 1 ? 'detail differs' : 'details differ'}</span>
                      )}
                    </div>
                    {selection && selection.variants.length > 1 && (
                      <div className={tw('search-result__sources')} aria-label={`Metadata source for ${result.title}`}>
                        {selection.variants.map((variant) => (
                          <button
                            type="button"
                            key={variant.id}
                            aria-pressed={variant.provider === selection.selectedProvider}
                            onClick={() => setResults((current) => current.map((candidate) =>
                              candidate.id === result.id
                                ? selectMetadataVariant(candidate, variant.provider)
                                : candidate,
                            ))}
                          >
                            {variant.providerName}
                          </button>
                        ))}
                      </div>
                    )}
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

          <p className={tw('search-attribution')}>
            Book data from <a href="https://openlibrary.org/" target="_blank" rel="noreferrer">Open Library</a>
            {providerStates.some(({ provider, state }) => provider === 'google-books' && state !== 'not-configured') && (
              <> and <a href="https://books.google.com/" target="_blank" rel="noreferrer">Google Books</a></>
            )}.
          </p>
        </>
      )}
    </Sheet>
  )
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function providerUrl(variant: NonNullable<BookSearchResult['metadataSelection']>['variants'][number]): string {
  if (variant.provider === 'google-books') {
    return `https://books.google.com/books?id=${encodeURIComponent(variant.externalKey)}`
  }
  const path = variant.editionKey ? `books/${variant.editionKey}` : `works/${variant.workKey}`
  return `https://openlibrary.org/${path}`
}
