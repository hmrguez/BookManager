import { t, useLanguage } from '../localization'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import {
  AlertTriangle,
  BookPlus,
  Camera,
  Check,
  ChevronRight,
  ClipboardPaste,
  Database,
  Flashlight,
  Library,
  Plus,
  RefreshCw,
  ScanLine,
  Search,
  X,
} from 'lucide-react'
import { ActionButton, BookCover } from '../design-system'
import type { BookSearchResult, LibraryBook, ShelfId } from '../library'
import { findLibraryBookForSearchResult } from '../library-model'
import {
  createManualBookResult,
  inspectIsbnInput,
  proposeCaptureDuplicate,
  readClipboardIsbn,
  scanIsbnBarcode,
  type CaptureMethod,
  type DuplicateProposal,
  type ValidIsbn,
} from '../capture'
import {
  getMetadataSearchService,
  metadataConfidenceLabel,
  selectMetadataVariant,
  type MetadataSearchResponse,
  type ProviderSearchState,
} from '../metadata'
import { shelfCopy } from '../app/config'
import { Sheet } from '../app/components/Sheet'
import { tw } from '../tailwind/styles'

type InitialCapture = {
  readonly isbn: ValidIsbn
  readonly method: Extract<CaptureMethod, 'share-sheet'>
}

type CaptureReview = {
  readonly candidate: BookSearchResult
  readonly proposal: DuplicateProposal
}

function authorLine(authors: string[]) {
  return authors.join(', ')
}

export function SearchSheet({
  shelf,
  books,
  onAdd,
  onOpenBook,
  onClose,
  initialManual = false,
  initialCapture,
}: {
  shelf: ShelfId
  books: LibraryBook[]
  onAdd: (book: BookSearchResult, shelf: ShelfId) => void | Promise<boolean>
  onOpenBook: (bookId: string) => void
  onClose: () => void
  initialManual?: boolean
  initialCapture?: InitialCapture
}) {
  useLanguage()
  const [selectedResultId, setSelectedResultId] = useState<string>()
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const addingRef = useRef(false)
  const [results, setResults] = useState<readonly BookSearchResult[]>([])
  const selectedResult = results.find(({ id }) => id === selectedResultId)
  const [providerStates, setProviderStates] = useState<readonly ProviderSearchState[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [manualMode, setManualMode] = useState(initialManual)
  const [manualTitle, setManualTitle] = useState('')
  const [manualAuthor, setManualAuthor] = useState('')
  const [manualPages, setManualPages] = useState('')
  const [isbnInput, setIsbnInput] = useState(initialCapture?.isbn.normalized ?? '')
  const [isbnToolsOpen, setIsbnToolsOpen] = useState(Boolean(initialCapture))
  const [captureMethod, setCaptureMethod] = useState<CaptureMethod>(
    initialCapture?.method ?? 'manual-entry',
  )
  const [captureBusy, setCaptureBusy] = useState(false)
  const [captureIssue, setCaptureIssue] = useState<string>()
  const [captureReview, setCaptureReview] = useState<CaptureReview>()
  const requestIdRef = useRef(0)
  const skipQueryEffectRef = useRef<string | undefined>(undefined)
  const initialCaptureHandledRef = useRef(false)
  const isbnInputRef = useRef<HTMLInputElement>(null)

  const performSearch = useCallback(async (
    cleanQuery: string,
    options: { readonly refresh?: boolean } = {},
    signal?: AbortSignal,
  ): Promise<MetadataSearchResponse<BookSearchResult> | undefined> => {
    const requestId = ++requestIdRef.current
    setStatus("loading")
    try {
      const service = await getMetadataSearchService()
      const response = await service.search({
        query: cleanQuery,
        locale: navigator.language || 'en',
        limit: 16,
      }, { ...options, signal })
      if (requestId !== requestIdRef.current) return undefined
      setResults(response.results)
      setProviderStates(response.providers)
      const available = response.providers.some(({ state }) =>
        state === 'live' || state === 'saved' || state === 'empty',
      )
      setStatus(available ? 'ready' : 'error')
      return response
    } catch (error) {
      if (requestId !== requestIdRef.current || isAbortError(error)) return undefined
      setStatus("error")
      return undefined
    }
  }, [])

  useEffect(() => {
    const cleanQuery = query.trim()
    if (cleanQuery.length < 2) return
    if (skipQueryEffectRef.current === cleanQuery) {
      skipQueryEffectRef.current = undefined
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void performSearch(cleanQuery, {}, controller.signal)
    }, 500)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [performSearch, query])

  const acceptCapturedIsbn = useCallback(async (isbn: ValidIsbn, method: CaptureMethod) => {
    setCaptureBusy(true)
    setCaptureIssue(undefined)
    setCaptureMethod(method)
    setIsbnInput(isbn.normalized)
    skipQueryEffectRef.current = isbn.normalized
    setQuery(isbn.normalized)
    try {
      const response = await performSearch(isbn.normalized)
      const result = response?.results.find((candidate) => candidateHasIsbn(candidate, isbn))
        ?? response?.results[0]
      if (!result) {
        setManualMode(true)
        setManualTitle('')
        setCaptureIssue(
          'ISBN saved locally. Catalog details are unavailable, so add a title now and enrich this record later.',
        )
        window.setTimeout(() => isbnInputRef.current?.focus(), 0)
        return
      }

      const capturedCandidate: BookSearchResult = {
        ...result,
        capture: {
          method,
          capturedAt: new Date().toISOString(),
          manualOverrides: [],
        },
      }
      setResults((current) => current.map((candidate) =>
        candidate.id === result.id ? capturedCandidate : candidate,
      ))
      setManualMode(false)
      const proposal = proposeCaptureDuplicate(books, capturedCandidate)
      if (proposal) setCaptureReview({ candidate: capturedCandidate, proposal })
    } finally {
      setCaptureBusy(false)
    }
  }, [books, performSearch])

  useEffect(() => {
    if (!initialCapture || initialCaptureHandledRef.current) return
    initialCaptureHandledRef.current = true
    void acceptCapturedIsbn(initialCapture.isbn, initialCapture.method)
  }, [acceptCapturedIsbn, initialCapture])

  const submitAddition = async (candidate: BookSearchResult, closeAfter = false) => {
    if (addingRef.current) return
    addingRef.current = true
    setAdding(true)
    try {
      if (await onAdd(candidate, shelf) !== false && closeAfter) onClose()
    } finally {
      addingRef.current = false
      setAdding(false)
    }
  }

  const addFirstResult = (event: FormEvent) => {
    event.preventDefault()
    if (results[0]) void submitAddition(results[0])
  }

  const updateQuery = (value: string) => {
    setQuery(value)
    if (value.trim().length < 2) {
      requestIdRef.current += 1
      setResults([])
      setProviderStates([])
      setStatus("idle")
    }
  }

  const openManualEntry = () => {
    const inspection = inspectIsbnInput(query)
    if (inspection.state === 'valid') {
      setIsbnInput(inspection.isbn.normalized)
      setCaptureMethod('manual-entry')
    } else {
      setManualTitle(query.trim())
    }
    setCaptureIssue(undefined)
    setManualMode(true)
  }

  const addManualBook = async (event: FormEvent) => {
    event.preventDefault()
    const cleanTitle = manualTitle.trim()
    if (!cleanTitle) return

    const inspection = inspectIsbnInput(isbnInput)
    if (isbnInput.trim() && inspection.state !== 'valid') {
      setCaptureIssue(inspection.state === 'invalid' ? inspection.message : t("Enter a valid ISBN."))
      isbnInputRef.current?.focus()
      return
    }
    const candidate = createManualBookResult({
      title: cleanTitle,
      author: manualAuthor,
      pageCount: Number.parseInt(manualPages, 10) || 0,
      isbn: inspection.state === 'valid' ? inspection.isbn : undefined,
      method: captureMethod,
    })
    const proposal = inspection.state === 'valid'
      ? proposeCaptureDuplicate(books, candidate)
      : undefined
    if (proposal) {
      setCaptureReview({ candidate, proposal })
      return
    }

    await submitAddition(candidate, true)
  }

  const submitIsbn = (event: FormEvent) => {
    event.preventDefault()
    const inspection = inspectIsbnInput(isbnInput)
    if (inspection.state !== 'valid') {
      setCaptureIssue(inspection.state === 'invalid' ? inspection.message : t("Enter an ISBN first."))
      return
    }
    void acceptCapturedIsbn(inspection.isbn, 'manual-entry')
  }

  const scanBarcode = async () => {
    setCaptureBusy(true)
    setCaptureIssue(undefined)
    const result = await scanIsbnBarcode()
    if (result.state === 'scanned') {
      await acceptCapturedIsbn(result.isbn, 'isbn-camera')
    } else if (result.state !== 'cancelled') {
      setCaptureIssue(result.message)
      if (result.state === 'denied' || result.state === 'unavailable') {
        setManualMode(true)
        window.setTimeout(() => isbnInputRef.current?.focus(), 0)
      }
    }
    setCaptureBusy(false)
  }

  const pasteIsbn = async () => {
    setCaptureBusy(true)
    setCaptureIssue(undefined)
    const inspection = await readClipboardIsbn()
    if (inspection.state === 'valid') {
      await acceptCapturedIsbn(inspection.isbn, 'isbn-paste')
    } else {
      setCaptureIssue(inspection.state === 'invalid' ? inspection.message : t("The clipboard is empty."))
      window.setTimeout(() => isbnInputRef.current?.focus(), 0)
    }
    setCaptureBusy(false)
  }

  const refreshSearch = () => {
    const cleanQuery = query.trim()
    if (cleanQuery.length >= 2) void performSearch(cleanQuery, { refresh: true })
  }

  const hasSavedResults = providerStates.some(({ state }) => state === 'saved')

  if (captureReview) {
    return (
      <Sheet title={t("Check this edition")} onClose={onClose} tall>
        <CaptureDuplicateReview
          review={captureReview}
          shelf={shelf}
          onAdd={() => { void submitAddition(captureReview.candidate, true) }}
          onOpen={() => onOpenBook(captureReview.proposal.book.id)}
          onCancel={() => setCaptureReview(undefined)}
        />
      </Sheet>
    )
  }

  return (
    <Sheet title={manualMode ? t("Add a book manually") : t("Add to {{v0}}", { v0: shelfCopy[shelf].label })} onClose={onClose} tall wide={!manualMode}>
      {manualMode ? (
        <form className={tw('manual-book-form')} onSubmit={addManualBook}>
          <div className={tw('manual-notice')}>
            <BookPlus aria-hidden="true" />
            <p>
              <strong>{t("Saved here first")}</strong>
              {t("Title is enough, even offline. ISBN and other details can be added now or enriched later.")}</p>
          </div>
          {captureIssue && <CaptureIssue message={captureIssue} />}
          <label>
            <span>{t("Book title")}</span>
            <input
              autoFocus
              required
              value={manualTitle}
              onChange={(event) => setManualTitle(event.target.value)}
              placeholder={t("Book title")}
            />
          </label>
          <label>
            <span>{t("Author")}<i>{t("optional")}</i></span>
            <input
              value={manualAuthor}
              onChange={(event) => setManualAuthor(event.target.value)}
              placeholder={t("Unknown author")}
            />
          </label>
          <label>
            <span>{t("ISBN-10 or ISBN-13")}<i>{t("optional")}</i></span>
            <span className={tw('manual-isbn-field')}>
              <input
                ref={isbnInputRef}
                value={isbnInput}
                onChange={(event) => setIsbnInput(event.target.value)}
                placeholder="978-…"
                inputMode="numeric"
                autoCapitalize="characters"
              />
              <button type="button" onClick={() => { void pasteIsbn() }} disabled={captureBusy}>
                <ClipboardPaste aria-hidden="true" /> {t(" Paste")}</button>
            </span>
          </label>
          <label>
            <span>{t("Page count")}<i>{t("optional")}</i></span>
            <input
              type="number"
              inputMode="numeric"
              min="0"
              value={manualPages}
              onChange={(event) => setManualPages(event.target.value)}
              placeholder="0"
            />
          </label>
          <p className={tw('capture-provenance')}>
            <Database aria-hidden="true" />
            {captureMethod === 'isbn-camera' && t("ISBN captured by camera · fields stay editable")}
            {captureMethod === 'isbn-paste' && t("ISBN pasted from your clipboard · fields stay editable")}
            {captureMethod === 'share-sheet' && t("ISBN received from the share sheet · fields stay editable")}
            {captureMethod === 'manual-entry' && t("Personal record · fields stay editable")}
          </p>
          <div className={tw('manual-form-actions')}>
            {!initialManual && (
              <ActionButton type="button" variant="secondary" onClick={() => setManualMode(false)}>
                {t("Back to search")}</ActionButton>
            )}
            <ActionButton type="submit" disabled={!manualTitle.trim()} aria-disabled={adding} aria-busy={adding}>
              <BookPlus aria-hidden="true" /> {t(" Add to")}{shelfCopy[shelf].label}
            </ActionButton>
          </div>
        </form>
      ) : (
        <>
          <form className={tw('book-search')} onSubmit={addFirstResult}>
            <Search aria-hidden="true" />
            <input
              autoFocus={!isbnInput}
              type="search"
              value={query}
              onChange={(event) => updateQuery(event.target.value)}
              placeholder={t("Book title or author")}
              aria-label={t("Search Open Library")}
              autoCapitalize="none"
              enterKeyHint="search"
            />
            {query && (
              <button type="button" aria-label={t("Clear search")} onClick={() => updateQuery('')}>
                <X aria-hidden="true" />
              </button>
            )}
          </form>

          <div className={tw('search-meta')} aria-live="polite">
            {status === 'idle' && <span>{t("Open Library is ready. Tap once to add.")}</span>}
            {status === 'loading' && <span>{t("Looking through Open Library…")}</span>}
            {status === 'ready' && (
              <span>{results.length ? t("{{v0}} books found", { v0: results.length }) : t("No matching books found")}</span>
            )}
            {status === 'error' && (
              <span>{t("Open Library is unavailable. You can still add a personal record.")}</span>
            )}
          </div>

          {hasSavedResults && (
            <div className={tw('search-provider-actions')}>
              <button type="button" onClick={refreshSearch} disabled={status === 'loading'}>
                <RefreshCw aria-hidden="true" /> {t(" Refresh saved results")}</button>
            </div>
          )}

          <div className={tw('isbn-tools')}>
            <button
              type="button"
              aria-expanded={isbnToolsOpen}
              aria-controls="isbn-tools-panel"
              onClick={() => setIsbnToolsOpen((open) => !open)}
            >
              <ScanLine aria-hidden="true" />
              <span>
                <strong>{t("Use an ISBN")}</strong>
                <small>{t("Scan, paste, or type")}</small>
              </span>
              <ChevronRight className={isbnToolsOpen ? 'is-open' : undefined} aria-hidden="true" />
            </button>
            {isbnToolsOpen && (
              <div id="isbn-tools-panel" className={tw('capture-desk')}>
                <div className={tw('capture-desk__actions')}>
                  <button type="button" onClick={() => { void scanBarcode() }} disabled={captureBusy}>
                    <Camera aria-hidden="true" /><span><strong>{t("Scan barcode")}</strong><small>{t("Camera · ISBN-10/13")}</small></span>
                  </button>
                  <button type="button" onClick={() => { void pasteIsbn() }} disabled={captureBusy}>
                    <ClipboardPaste aria-hidden="true" /><span><strong>{t("Paste ISBN")}</strong><small>{t("From clipboard")}</small></span>
                  </button>
                </div>
                <p className={tw('capture-torch-note')}>
                  <Flashlight aria-hidden="true" /> {t(" Camera opens full screen. Use the torch control when the cover is dark or glossy.")}</p>
                <form className={tw('capture-isbn-entry')} onSubmit={submitIsbn}>
                  <input
                    ref={isbnInputRef}
                    value={isbnInput}
                    onChange={(event) => setIsbnInput(event.target.value)}
                    placeholder={t("Type ISBN-10 or ISBN-13")}
                    aria-label={t("ISBN-10 or ISBN-13")}
                    inputMode="numeric"
                    autoCapitalize="characters"
                  />
                  <button type="submit" disabled={captureBusy || !isbnInput.trim()}>{t("Use ISBN")}</button>
                </form>
              </div>
            )}
          </div>

          {captureIssue && <CaptureIssue message={captureIssue} />}

          <button className={tw('manual-entry-trigger')} type="button" onClick={openManualEntry}>
            <BookPlus aria-hidden="true" />
            <span>
              <strong>{query.trim() ? t("Can't find “{{v0}}”?", { v0: query.trim() }) : t("No ISBN? No problem.")}</strong>
              {t("Add a title-first personal record on this device")}</span>
            <ChevronRight aria-hidden="true" />
          </button>

          <div className="search-browser">
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
                    <button className="search-inspect" type="button" aria-pressed={selectedResultId === result.id} onClick={() => setSelectedResultId(result.id)}>{t("Inspect book")}</button>
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
                      {result.pageCount > 0 && <span>{result.pageCount} {t(" pages")}</span>}
                      {selection?.freshness === 'saved' && <span><Database aria-hidden="true" /> {t(" Saved")}</span>}
                      {selection && selection.conflicts.length > 0 && (
                        <span>{selection.conflicts.length} {selection.conflicts.length === 1 ? t("detail differs") : t("details differ")}</span>
                      )}
                    </div>
                    {selection && selection.variants.length > 1 && (
                      <div className={tw('search-result__sources')} aria-label={t("Metadata source for {{v0}}", { v0: result.title })}>
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
                    onClick={() => { void submitAddition(result) }}
                    disabled={alreadyHere}
                    aria-disabled={adding || alreadyHere}
                    aria-busy={adding}
                    aria-label={alreadyHere ? t("{{v0}} already added", { v0: result.title }) : t("Add {{v0}}", { v0: result.title })}
                  >
                    {alreadyHere ? <Check aria-hidden="true" /> : <Plus aria-hidden="true" />}
                    <span>{alreadyHere ? t("Added") : existing ? t("Move") : t("Add")}</span>
                  </button>
                </article>
              )
            })}
          </div>

          <aside className="search-selection" aria-label={t("Selected search result")}>
            {selectedResult ? <>
              <BookCover book={selectedResult} />
              <h3>{selectedResult.title}</h3>
              <p>{authorLine(selectedResult.authors)}</p>
              <p>{selectedResult.pageCount ? t("{{v0}} pages", { v0: selectedResult.pageCount }) : t("Page count unavailable")}</p>
              <p>{selectedResult.editionTitle || selectedResult.identifiers?.join(' · ') || t("No edition identifier available.")}</p>
              <button className={tw('primary-button')} type="button" disabled={adding || findLibraryBookForSearchResult(books, selectedResult)?.shelf === shelf} onClick={() => { void submitAddition(selectedResult) }}>{t("Add to")}{shelfCopy[shelf].label}</button>
            </> : <p>{t("Select a book to inspect its details.")}</p>}
          </aside>
          </div>
          <p className={tw('search-attribution')}>
            {t("Book data from ")}<a href="https://openlibrary.org/" target="_blank" rel="noreferrer">{t("Open Library")}</a>.
          </p>
        </>
      )}
    </Sheet>
  )
}

function CaptureIssue({ message }: { readonly message: string }) {
  useLanguage()
  return (
    <div className={tw('capture-issue')} role="alert">
      <AlertTriangle aria-hidden="true" />
      <p><strong>{t("Keep going without the camera")}</strong>{message}</p>
    </div>
  )
}

function CaptureDuplicateReview({
  review,
  shelf,
  onAdd,
  onOpen,
  onCancel,
}: {
  readonly review: CaptureReview
  readonly shelf: ShelfId
  readonly onAdd: () => void
  readonly onOpen: () => void
  readonly onCancel: () => void
}) {
  useLanguage()
  const exact = review.proposal.kind === 'exact-edition'
  const existing = review.proposal.book
  const isbn = review.candidate.identifiers?.[0]
  return (
    <div className={tw('capture-review')}>
      <header>
        <span className={tw('capture-review__mark')}>
          {exact ? <Check aria-hidden="true" /> : <Library aria-hidden="true" />}
        </span>
        <div>
          <span>{exact ? t("Exact edition found") : t("Related edition found")}</span>
          <h3>{exact ? t("This ISBN is already in your library") : t("This may be another edition of the same Work")}</h3>
          <p>
            {exact
              ? t("Wovenleaf will not create a second copy or move it without your review.")
              : t("The ISBN is different, so it can stay separate while sharing the same Work history.")}
          </p>
        </div>
      </header>
      <article className={tw('capture-review__book')}>
        <BookCover book={existing} />
        <div>
          <strong>{existing.title}</strong>
          <span>{existing.authors.join(', ')}</span>
          <small>{isbn ? t("Scanned {{v0}}", { v0: isbn }) : t("Title and author match")} {t(' · Currently in {{shelf}}', { shelf: shelfCopy[existing.shelf].label })}</small>
        </div>
      </article>
      <div className={tw('capture-review__ledger')}>
        <span>{exact ? t("Same ISBN") : t("Different ISBN")}</span>
        <p>{exact ? t("Use the existing edition and keep its reading data intact.") : t("Add a separate edition only after reviewing the existing one.")}</p>
      </div>
      <div className={tw('capture-review__actions')}>
        <ActionButton type="button" variant="secondary" onClick={onCancel}>{t("Back")}</ActionButton>
        <ActionButton type="button" variant="secondary" onClick={onOpen}>{t("Review existing")}</ActionButton>
        {(!exact || existing.shelf !== shelf) && (
          <ActionButton type="button" onClick={onAdd}>
            {exact ? t("Move to {{v0}}", { v0: shelfCopy[shelf].label }) : t("Add separate edition")}
          </ActionButton>
        )}
      </div>
    </div>
  )
}

function candidateHasIsbn(candidate: BookSearchResult, isbn: ValidIsbn): boolean {
  return candidate.identifiers?.some((value) => {
    const inspection = inspectIsbnInput(value)
    return inspection.state === 'valid' && inspection.isbn.canonical === isbn.canonical
  }) ?? false
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function providerUrl(variant: NonNullable<BookSearchResult['metadataSelection']>['variants'][number]): string {
  const path = variant.editionKey ? `books/${variant.editionKey}` : `works/${variant.workKey}`
  return `https://openlibrary.org/${path}`
}
