import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, Download } from 'lucide-react'
import {
  applyAppearance,
  getAppearanceStorage,
  motionScrollBehavior,
  readAppearance,
  writeAppearance,
} from './design-system'
import { ImportReviewPage } from './imports/ImportReviewPage'
import type { ImportBatchSummary, ImportPreview, ImportReviewDecision } from './imports'
import { useLibrary, type BookSearchResult, type ShelfId } from './library'
import { useOrganization, type ShelfDraft } from './organization'
import { tagsForBook, type CustomShelf } from './organization-model'
import {
  CommandPalette,
  getSearchPreferencesStorage,
  readSearchPreferences,
  writeSearchPreferences,
  type LocalSearchSort,
} from './search'
import {
  SmartListEditor,
  useSmartLists,
  type SavedSmartList,
  type SmartListDraft,
} from './smart-lists'
import { getStorageRuntime } from './storage/runtime'
import type { Catalog } from './domain/catalog'
import { UpNextSettings } from './UpNext'
import { useUpNext } from './up-next'
import { shelfCopy } from './app/config'
import { downloadTextFile } from './app/download'
import type { AppView, ExportFormat, SheetState, ToastState } from './app/model'
import { BottomNavigation } from './app/components/BottomNavigation'
import { Sheet } from './app/components/Sheet'
import { LibraryPage } from './library/LibraryPage'
import { useLibraryViewModel } from './library/useLibraryViewModel'
import { SearchSheet } from './search/SearchSheet'
import { CustomShelfEditorSheet } from './organization/CustomShelfComponents'
import { FinishedSheet, ProgressSheet } from './reading/ReadingSheets'
import { SettingsPage } from './settings/SettingsPage'
import { DetailSheet } from './work-detail/DetailSheet'
import { tw } from './tailwind/styles'
import { motionStyles } from './tailwind/motion'

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
    smartLists,
    smartListError,
    saveSmartList,
    saveStoredSmartList,
    removeSmartList,
  } = useSmartLists()
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
  const [smartListCatalog, setSmartListCatalog] = useState<Catalog>()
  const sheetTriggerRef = useRef<HTMLElement | null>(null)

  const libraryViewModel = useLibraryViewModel({
    books,
    organization,
    smartLists,
    upNext,
    smartListCatalog,
    librarySearchOpen,
    libraryQuery,
    libraryShelfFilter,
    librarySort,
    searchPreferences,
  })
  const {
    activeCustomShelves,
    archivedCustomShelves,
    librarySearchIndex,
    smartListDocuments,
  } = libraryViewModel

  const selectedBook = sheet && 'bookId' in sheet
    ? books.find((book) => book.id === sheet.bookId)
    : undefined
  const selectedCustomShelf = sheet?.kind === 'custom-shelf' && sheet.shelfId
    ? organization.shelves.find((customShelf) => customShelf.id === sheet.shelfId)
    : undefined
  const selectedSmartList = sheet?.kind === 'smart-list' && sheet.smartListId
    ? smartLists.find((list) => list.id === sheet.smartListId)
    : undefined

  useEffect(() => {
    let active = true
    void getStorageRuntime().then(({ catalog }) => catalog.read()).then((stored) => {
      if (active) setSmartListCatalog(stored)
    }).catch(() => {
      // Library-book fields remain fully queryable when canonical enrichment is unavailable.
    })
    return () => {
      active = false
    }
  }, [])

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

  const archiveCustomShelf = (customShelf: CustomShelf) => {
    saveShelf({
      id: customShelf.id,
      name: customShelf.name,
      notes: customShelf.notes,
      pinned: customShelf.pinned,
      archived: !customShelf.archived,
    })
    closeSheet()
    setToast({
      message: customShelf.archived
        ? `${customShelf.name} restored`
        : `${customShelf.name} archived; its books remain in your library`,
    })
  }

  const deleteCustomShelf = (customShelf: CustomShelf) => {
    removeShelf(customShelf.id)
    closeSheet()
    setToast({ message: `${customShelf.name} deleted; no books were removed` })
  }

  const saveSmartListEditor = (draft: SmartListDraft) => {
    saveSmartList(draft)
    closeSheet()
    setToast({ message: draft.id ? 'Smart list saved and recalculated' : 'Smart list created' })
  }

  const archiveSmartList = (list: SavedSmartList) => {
    saveStoredSmartList({
      ...list,
      archived: !list.archived,
      updatedAt: new Date().toISOString(),
    })
    closeSheet()
    setToast({
      message: list.archived
        ? `${list.name} restored and recalculated`
        : `${list.name} archived; its rules are preserved`,
    })
  }

  const deleteSmartList = (list: SavedSmartList) => {
    removeSmartList(list.id)
    closeSheet()
    setToast({ message: `${list.name} deleted; no books were removed` })
  }

  return (
    <div className={tw('library-app')}>
      <div
        className={tw('app-content')}
        inert={sheet || commandMenuOpen ? true : undefined}
        aria-hidden={sheet || commandMenuOpen ? true : undefined}
      >
        {(storageError || organizationError || smartListError || upNextError) && (
          <section className={tw('storage-recovery')} role="alert" aria-live="assertive">
            <AlertTriangle aria-hidden="true" />
            <div>
              <strong>{legacyRecoveryAvailable ? 'Previous library needs recovery' : 'Library storage error'}</strong>
              <p>{storageError ?? organizationError ?? smartListError ?? upNextError}</p>
              {legacyRecoveryAvailable && (
                <button type="button" onClick={() => { void downloadLegacyRecovery() }}>
                  <Download aria-hidden="true" /> Download recovery copy
                </button>
              )}
            </div>
          </section>
        )}

        {view === 'library' ? (
          <LibraryPage
            books={books}
            organization={organization}
            appearance={appearance}
            upNext={upNext}
            viewModel={libraryViewModel}
            movingBookId={movingBookId}
            librarySearchOpen={librarySearchOpen}
            libraryQuery={libraryQuery}
            libraryShelfFilter={libraryShelfFilter}
            librarySort={librarySort}
            onLibrarySearchOpenChange={setLibrarySearchOpen}
            onLibraryQueryChange={setLibraryQuery}
            onLibraryShelfFilterChange={setLibraryShelfFilter}
            onLibrarySortChange={setLibrarySort}
            onCloseLibrarySearch={closeLibrarySearch}
            onOpenCommandMenu={() => setCommandMenuOpen(true)}
            onScrollToShelf={scrollToShelf}
            onOpenSheet={openSheet}
            onNext={handleNext}
            onStart={handleStart}
            onFinish={handleFinish}
            onRate={(id, rating) => updateBook(id, { rating })}
            onMoveQueueBook={moveQueueBook}
            onTogglePinnedBook={togglePinnedBook}
            onDismissSuggestion={dismissSuggestion}
            onReasonState={setReasonState}
          />
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
        className={tw(`toast${toast ? ' is-visible' : ''}`, motionStyles.undo)}
        data-motion-event={toast?.family}
        role="status"
        aria-live="polite"
      >
        <Check aria-hidden="true" />
        <span>{toast?.message}</span>
        {toast?.undo && <button type="button" onClick={toast.undo}>Undo</button>}
      </div>

      {sheet?.kind === 'search' && (
        <SearchSheet shelf={sheet.shelf} books={books} onAdd={handleAdd} onClose={closeSheet} initialManual={sheet.manual} />
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
        <FinishedSheet book={selectedBook} onClose={closeSheet} onRate={(rating) => updateBook(selectedBook.id, { rating })} />
      )}
      {sheet?.kind === 'detail' && selectedBook && (
        <DetailSheet
          book={selectedBook}
          customShelves={activeCustomShelves}
          customShelfIds={organization.entries
            .filter((entry) => entry.bookId === selectedBook.id
              && activeCustomShelves.some(({ id }) => id === entry.shelfId))
            .map(({ shelfId: customShelfId }) => customShelfId)}
          tags={tagsForBook(organization, selectedBook.id).map(({ name }) => name)}
          tagSuggestions={organization.tags.map(({ name }) => name)}
          onClose={closeSheet}
          onMove={(targetShelf) => {
            if (targetShelf === 'finished') {
              handleFinish(selectedBook.id)
            } else {
              moveToShelf(selectedBook.id, targetShelf)
              setMovingBookId(selectedBook.id)
              setToast({ message: `Moved to ${shelfCopy[targetShelf].label}` })
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
              .map(({ shelfId: customShelfId }) => customShelfId)
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
      {sheet?.kind === 'smart-list' && (
        <Sheet title={selectedSmartList ? `Edit ${selectedSmartList.name}` : 'New smart list'} onClose={closeSheet} tall>
          <SmartListEditor
            key={sheet.smartListId ?? 'new-smart-list'}
            list={selectedSmartList}
            documents={smartListDocuments}
            onSave={saveSmartListEditor}
            onArchive={archiveSmartList}
            onDelete={deleteSmartList}
          />
          <datalist id="smart-list-format-suggestions">
            <option value="print" /><option value="ebook" /><option value="epub" /><option value="pdf" />
            <option value="audiobook" /><option value="m4b" /><option value="mp3" />
          </datalist>
        </Sheet>
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
        onBookAction={(bookId, targetShelf) => {
          setView('library')
          if (targetShelf === 'finished') {
            handleFinish(bookId)
          } else {
            moveToShelf(bookId, targetShelf)
            setMovingBookId(bookId)
            setToast({ message: `Moved to ${shelfCopy[targetShelf].label}` })
          }
        }}
      />
    </div>
  )
}

export default App
