import { revealShelfBook } from './reveal-book'
import { useEffect } from 'react'
import {
  Archive,
  ChevronRight,
  Command as CommandIcon,
  FolderPlus,
  ListFilter,
  Pin,
  Search,
  X,
} from 'lucide-react'
import {
  FeedbackNotice,
  motionScrollBehavior,
  shelfMotionTiming,
  type AppearancePreferences,
} from '../design-system'
import { SHELVES, type LibraryBook, type ShelfId } from '../library'
import type { LibraryOrganization } from '../organization-model'
import type { LocalSearchSort } from '../search'
import { SmartListSection } from '../smart-lists'
import { UpNextSection } from '../UpNext'
import type { UpNextCriterion, UpNextState } from '../up-next-model'
import type { SheetState } from '../app/model'
import { CustomShelfSection } from '../organization/CustomShelfComponents'
import { tw } from '../tailwind/styles'
import { motionStyles } from '../tailwind/motion'
import { FEATURES } from '../app/feature-flags'
import { ShelfSection } from './ShelfSection'
import type { ShelfMotionEvent } from './shelf-motion'
import type { LibraryViewModel } from './useLibraryViewModel'
import { LibraryPresentation, LibraryViewControl, LibraryViewHint } from './LibraryPresentation'
import { libraryDropTarget, type LibraryDropTarget } from './library-drag'

type OpenSheet = (sheet: Exclude<SheetState, null>) => void

export type CoverEnrichmentStatus = {
  readonly state: 'checking' | 'paused' | 'unresolved'
  readonly pending: number
}

export function LibraryPage({
  books,
  libraryHydrated,
  organization,
  appearance,
  upNext,
  viewModel,
  shelfMotion,
  coverEnrichmentStatus,
  librarySearchOpen,
  libraryQuery,
  libraryShelfFilter,
  librarySort,
  onLibrarySearchOpenChange,
  onLibraryQueryChange,
  onLibraryShelfFilterChange,
  onLibrarySortChange,
  onCloseLibrarySearch,
  onOpenCommandMenu,
  onScrollToShelf,
  onOpenSheet,
  onDropBook,
  onNext,
  onStart,
  onFinish,
  onDnf,
  onRate,
  onMoveQueueBook,
  onDismissSuggestion,
  onReasonState,
}: {
  books: LibraryBook[]
  libraryHydrated: boolean
  organization: LibraryOrganization
  appearance: AppearancePreferences
  upNext: UpNextState
  viewModel: LibraryViewModel
  shelfMotion?: ShelfMotionEvent
  coverEnrichmentStatus?: CoverEnrichmentStatus
  librarySearchOpen: boolean
  libraryQuery: string
  libraryShelfFilter: ShelfId | 'all'
  librarySort: LocalSearchSort
  onLibrarySearchOpenChange: (open: boolean) => void
  onLibraryQueryChange: (query: string) => void
  onLibraryShelfFilterChange: (shelf: ShelfId | 'all') => void
  onLibrarySortChange: (sort: LocalSearchSort) => void
  onCloseLibrarySearch: () => void
  onOpenCommandMenu: () => void
  onScrollToShelf: (shelf: ShelfId) => void
  onOpenSheet: OpenSheet
  onDropBook: (bookId: string, target: LibraryDropTarget) => void
  onNext: (bookId: string) => void
  onStart: (bookId: string) => void
  onFinish: (bookId: string) => void
  onDnf: (bookId: string) => void
  onRate: (bookId: string, rating: number) => void
  onMoveQueueBook: (bookId: string, targetIndex: number, visibleIds: readonly string[]) => void
  onDismissSuggestion: (bookId: string) => void
  onReasonState: (criterion: UpNextCriterion, state: 'neutral' | 'pinned' | 'dismissed') => void
}) {
  const {
    activeCustomShelves,
    activeSmartLists,
    archivedCustomShelves,
    archivedSmartLists,
    bookById,
    booksByCustomShelf,
    booksByShelf,
    indexing,
    librarySearchActive,
    librarySearchResultById,
    orderedNextBooks,
    searchCheckpoint,
    smartListQueries,
    upNextSuggestions,
    visibleBooks,
  } = viewModel

  useEffect(() => {
    if (!shelfMotion) return
    const timing = shelfMotionTiming(appearance.motion)
    const scrollToMotionShelf = (shelf: ShelfId) => {
      revealShelfBook(shelf, shelfMotion.bookId)
    }

    if (shelfMotion.from) scrollToMotionShelf(shelfMotion.from)
    else if (shelfMotion.to) scrollToMotionShelf(shelfMotion.to)

    if (!shelfMotion.to || !shelfMotion.from || shelfMotion.to === shelfMotion.from) return
    const timer = window.setTimeout(
      () => scrollToMotionShelf(shelfMotion.to!),
      timing.focusMs + timing.eraseMs + timing.settleMs,
    )
    return () => window.clearTimeout(timer)
  }, [appearance.motion, shelfMotion])

  return (
    <LibraryPresentation books={books} onDropBook={onDropBook}>
      <header className={tw('app-header')} id="top">
        <div className={tw('title-row')}>
          <h1 tabIndex={-1}>My Books</h1>
          <div className={tw('header-actions library-header-actions')}>
            <LibraryViewControl />
            <button
              className={tw('header-search command-trigger')}
              type="button"
              onClick={() => {
                onCloseLibrarySearch()
                onOpenCommandMenu()
              }}
              aria-label="Open command menu"
              aria-keyshortcuts="Meta+K Control+K"
            >
              <CommandIcon aria-hidden="true" />
            </button>
            <button
              className={tw(`header-search${librarySearchOpen ? ' is-open' : ''}`)}
              type="button"
              onClick={() => librarySearchOpen
                ? onCloseLibrarySearch()
                : onLibrarySearchOpenChange(true)}
              aria-label={librarySearchOpen ? 'Close library search' : 'Search my library'}
              aria-expanded={librarySearchOpen}
            >
              {librarySearchOpen ? <X aria-hidden="true" /> : <Search aria-hidden="true" />}
            </button>
          </div>
        </div>

        {librarySearchOpen && (
          <div className={tw('library-search-panel', motionStyles.reveal)} data-motion-event="reveal">
            <div className={tw('library-search')}>
              <Search aria-hidden="true" />
              <input
                autoFocus
                type="search"
                value={libraryQuery}
                onChange={(event) => onLibraryQueryChange(event.target.value)}
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
                <button type="button" onClick={() => onLibraryQueryChange('')} aria-label="Clear library search">
                  <X aria-hidden="true" />
                </button>
              )}
            </div>
            <div className={tw('library-search-controls')}>
              <label>
                <span className={tw('sr-only')}>Filter by shelf</span>
                <select
                  value={libraryShelfFilter}
                  onChange={(event) => onLibraryShelfFilterChange(event.target.value as ShelfId | 'all')}
                >
                  <option value="all">All shelves</option>
                  {SHELVES.map((shelf) => <option key={shelf.id} value={shelf.id}>{shelf.label}</option>)}
                </select>
              </label>
              <label>
                <span className={tw('sr-only')}>Sort library search results</span>
                <select
                  value={librarySort}
                  onChange={(event) => onLibrarySortChange(event.target.value as LocalSearchSort)}
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

        <nav className={tw('shelf-tabs')} aria-label="Jump to a shelf">
          {SHELVES.map((shelf) => (
            <button type="button" key={shelf.id} onClick={() => onScrollToShelf(shelf.id)} {...libraryDropTarget('status', shelf.id, shelf.label)}>
              <span>{shelf.shortLabel}</span><strong>{booksByShelf[shelf.id].length}</strong>
            </button>
          ))}
        </nav>
        {FEATURES.smartLists && activeSmartLists.some(({ pinned }) => pinned) && (
          <nav className={tw('pinned-shelf-tabs')} aria-label="Pinned smart lists">
            <span><ListFilter aria-hidden="true" /> Smart</span>
            <div>
              {activeSmartLists.filter(({ pinned }) => pinned).map((list) => {
                const result = smartListQueries.get(list.id)
                return (
                  <button
                    type="button"
                    key={list.id}
                    onClick={() => document.getElementById(`smart-list-${list.id}`)?.scrollIntoView({
                      behavior: motionScrollBehavior(appearance.motion),
                      block: 'start',
                    })}
                  >
                    {list.name}<strong>{result?.ok ? result.items.length : '!'}</strong>
                  </button>
                )
              })}
            </div>
          </nav>
        )}
        {activeCustomShelves.some(({ pinned }) => pinned) && (
          <nav className={tw('pinned-shelf-tabs')} aria-label="Pinned custom shelves">
            <span><Pin aria-hidden="true" /> Pinned</span>
            <div>
              {activeCustomShelves.filter(({ pinned }) => pinned).map((shelf) => (
                <button
                  type="button"
                  key={shelf.id}
                  {...libraryDropTarget('custom', shelf.id, shelf.name)}
                  onClick={() => document.getElementById(`custom-shelf-${shelf.id}`)?.scrollIntoView({
                    behavior: motionScrollBehavior(appearance.motion),
                    block: 'start',
                  })}
                >
                  {shelf.name}<strong>{booksByCustomShelf.get(shelf.id)?.length ?? 0}</strong>
                </button>
              ))}
            </div>
          </nav>
        )}
        {books.length > 0 && <LibraryViewHint />}
      </header>

      <main className={tw('shelf-stack')}>
        {coverEnrichmentStatus && (
          <FeedbackNotice
            tone={coverEnrichmentStatus.state === 'checking' ? 'loading' : 'info'}
            title={coverEnrichmentStatus.state === 'checking'
              ? 'Picking up covers'
              : coverEnrichmentStatus.state === 'paused'
                ? 'Cover search paused'
                : 'Covers checked'}
          >
            {coverEnrichmentCopy(coverEnrichmentStatus)}
          </FeedbackNotice>
        )}
        {librarySearchActive && visibleBooks.length === 0 ? (
          <div className={tw('library-no-results')}>
            <Search aria-hidden="true" />
            <div><strong>No books found</strong><span>Try another title, contributor, tag, identifier, or shelf.</span></div>
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
                onAdd={() => onOpenSheet({ kind: 'search', shelf: 'next' })}
                onDetails={(bookId) => onOpenSheet({ kind: 'detail', bookId })}
                onStart={onStart}
                onMove={(bookId, targetIndex) => onMoveQueueBook(
                  bookId,
                  targetIndex,
                  orderedNextBooks.map(({ id }) => id),
                )}
                onManage={() => onOpenSheet({ kind: 'up-next' })}
                onAddSuggestion={onNext}
                onDismissSuggestion={onDismissSuggestion}
                onReasonState={onReasonState}
                shelfMotion={shelfMotion}
                motionMode={appearance.motion}
                libraryHydrated={libraryHydrated}
              />
            ) : (
              <ShelfSection
                key={shelf.id}
                shelf={shelf.id}
                books={booksByShelf[shelf.id]}
                isFiltering={librarySearchActive}
                searchResults={librarySearchResultById}
                shelfMotion={shelfMotion}
                motionMode={appearance.motion}
                libraryHydrated={libraryHydrated}
                onAdd={(targetShelf) => onOpenSheet({ kind: 'search', shelf: targetShelf })}
                onDetails={(bookId) => onOpenSheet({ kind: 'detail', bookId })}
                onProgress={(bookId) => onOpenSheet({ kind: 'progress', bookId })}
                onNext={onNext}
                onStart={onStart}
                onFinish={onFinish}
                onDnf={onDnf}
                onRate={onRate}
              />
            ))}

            {FEATURES.smartLists && !librarySearchActive && (
              <>
                <div className={tw('smart-lists-heading')}>
                  <div>
                    <span>Live from your library</span><h2>Smart lists</h2>
                    <p>Saved rules recalculate locally—and every match can explain itself.</p>
                  </div>
                  <button type="button" onClick={() => onOpenSheet({ kind: 'smart-list' })} aria-label="New smart list">
                    <ListFilter aria-hidden="true" /> <span>New smart list</span>
                  </button>
                </div>
                <div className={tw('smart-list-stack')}>
                  {activeSmartLists.map((list) => (
                    <SmartListSection
                      key={list.id}
                      list={list}
                      query={smartListQueries.get(list.id)!}
                      booksById={bookById}
                      motionMode={appearance.motion}
                      onDetails={(bookId) => onOpenSheet({ kind: 'detail', bookId })}
                      onManage={() => onOpenSheet({ kind: 'smart-list', smartListId: list.id })}
                    />
                  ))}
                </div>
                {!activeSmartLists.length && (
                  <button className={tw('smart-list-empty')} type="button" onClick={() => onOpenSheet({ kind: 'smart-list' })}>
                    <ListFilter aria-hidden="true" />
                    <span><strong>Let the library organize itself</strong><small>Start from a template or compose rules of your own</small></span>
                    <i>5 templates</i>
                  </button>
                )}
                {archivedSmartLists.length > 0 && (
                  <section className={tw('archived-shelves')}>
                    <header><Archive aria-hidden="true" /><span>Archived smart lists</span><strong>{archivedSmartLists.length}</strong></header>
                    <div>
                      {archivedSmartLists.map((list) => (
                        <button type="button" key={list.id} onClick={() => onOpenSheet({ kind: 'smart-list', smartListId: list.id })}>
                          <span><strong>{list.name}</strong><small>Saved rules remain intact</small></span>
                          <ChevronRight aria-hidden="true" />
                        </button>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}

            {!librarySearchActive && (
              <div className={tw('custom-shelves-heading')}>
                <div><span>Your collections</span><h2>Custom shelves</h2><p>Collect freely. Reading status still belongs to the shelves above.</p></div>
                <button type="button" onClick={() => onOpenSheet({ kind: 'custom-shelf' })}>
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
                  motionMode={appearance.motion}
                  onDetails={(bookId) => onOpenSheet({ kind: 'detail', bookId })}
                  onManage={() => onOpenSheet({ kind: 'custom-shelf', shelfId: shelf.id })}
                />
              ))}
            {!librarySearchActive && !activeCustomShelves.length && (
              <button className={tw('custom-shelf-empty')} type="button" onClick={() => onOpenSheet({ kind: 'custom-shelf' })}>
                <FolderPlus aria-hidden="true" />
                <span><strong>Make a shelf of your own</strong><small>A book can belong to as many as you like</small></span>
              </button>
            )}
            {!librarySearchActive && archivedCustomShelves.length > 0 && (
              <section className={tw('archived-shelves')}>
                <header><Archive aria-hidden="true" /><span>Archived shelves</span><strong>{archivedCustomShelves.length}</strong></header>
                <div>
                  {archivedCustomShelves.map((shelf) => (
                    <button type="button" key={shelf.id} onClick={() => onOpenSheet({ kind: 'custom-shelf', shelfId: shelf.id })}>
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
    </LibraryPresentation>
  )
}

function coverEnrichmentCopy(status: CoverEnrichmentStatus): string {
  const books = `${status.pending} ${status.pending === 1 ? 'book' : 'books'}`
  if (status.state === 'checking') {
    return `${books} still to check. Keep Wovenleaf open for a moment.`
  }
  if (status.state === 'paused') {
    return `${books} still to check. Wovenleaf will continue when the catalog is available.`
  }
  return `${books} still need a cover. Open a book and tap its cover to add one.`
}
