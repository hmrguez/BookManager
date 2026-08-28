import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, Download } from 'lucide-react'
import { App as CapacitorApp } from '@capacitor/app'
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
import { findLibraryBookForSearchResult } from './library-model'
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
import {
  SettingsPage,
  type AudiobookImportViewState,
  type EpubImportViewState,
  type RecoveryViewState,
} from './settings/SettingsPage'
import { DetailSheet } from './work-detail/DetailSheet'
import { tw } from './tailwind/styles'
import { motionStyles } from './tailwind/motion'
import {
  epubImportErrorMessage,
  epubSourceFromFile,
  type EpubImportSource,
  type EpubImportResult,
} from './epub'
import {
  audiobookImportErrorMessage,
  audiobookSourceFromIncomingUrl,
  audiobookSourcesFromFiles,
  type AudiobookImportReview,
  type AudiobookImportSource,
} from './audiobooks'
import { extractValidIsbn, listenForSharedIsbn } from './capture'
import { enrichCapturedBook } from './capture'
import { getMetadataSearchService } from './metadata'

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
    reloadOrganization,
  } = useOrganization()
  const {
    smartLists,
    smartListError,
    saveSmartList,
    saveStoredSmartList,
    removeSmartList,
    reloadSmartLists,
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
    reloadUpNext,
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
  const [epubImport, setEpubImport] = useState<EpubImportViewState>({})
  const [epubBusy, setEpubBusy] = useState(false)
  const [audiobookImport, setAudiobookImport] = useState<AudiobookImportViewState>({})
  const [audiobookBusy, setAudiobookBusy] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)
  const [exportError, setExportError] = useState<string>()
  const [recovery, setRecovery] = useState<RecoveryViewState>({ snapshots: [], busy: false })
  const [smartListCatalog, setSmartListCatalog] = useState<Catalog>()
  const sheetTriggerRef = useRef<HTMLElement | null>(null)
  const epubAbortRef = useRef<AbortController | undefined>(undefined)
  const audiobookAbortRef = useRef<AbortController | undefined>(undefined)
  const audiobookSourcesRef = useRef<readonly AudiobookImportSource[]>([])
  const recoveryArchiveRef = useRef<string | undefined>(undefined)

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

  const prepareAudiobookSources = async (
    loadSources: () => Promise<readonly AudiobookImportSource[]>,
  ) => {
    if (audiobookBusy) return
    const controller = new AbortController()
    audiobookAbortRef.current = controller
    setAudiobookBusy(true)
    setAudiobookImport({})
    try {
      const sources = await loadSources()
      if (sources.length === 0) return
      audiobookSourcesRef.current = sources
      const draft = await (await getStorageRuntime()).audiobooks.prepare(sources, {
        signal: controller.signal,
        onProgress: (progress) => setAudiobookImport({ progress }),
      })
      setAudiobookImport({ draft })
    } catch (error) {
      audiobookSourcesRef.current = []
      const message = audiobookImportErrorMessage(error)
      setAudiobookImport({ error: message })
      setToast({ message })
    } finally {
      audiobookAbortRef.current = undefined
      setAudiobookBusy(false)
    }
  }

  const prepareAudiobookFiles = (files: readonly File[]) => {
    if (files.length === 0) return
    return prepareAudiobookSources(() => audiobookSourcesFromFiles(files))
  }

  const commitAudiobook = async (review: AudiobookImportReview) => {
    if (audiobookBusy || audiobookSourcesRef.current.length === 0) return
    const controller = new AbortController()
    audiobookAbortRef.current = controller
    setAudiobookBusy(true)
    try {
      const result = await (await getStorageRuntime()).audiobooks.import(
        audiobookSourcesRef.current,
        review,
        {
          signal: controller.signal,
          onProgress: (progress) => setAudiobookImport((current) => ({ ...current, progress })),
        },
      )
      audiobookSourcesRef.current = []
      setAudiobookImport({ result })
      await reload()
      setSmartListCatalog(await (await getStorageRuntime()).catalog.read())
      setToast({ message: audiobookResultToastMessage(result) })
    } catch (error) {
      audiobookSourcesRef.current = []
      const message = audiobookImportErrorMessage(error)
      setAudiobookImport({ error: message })
      setToast({ message })
    } finally {
      audiobookAbortRef.current = undefined
      setAudiobookBusy(false)
    }
  }

  const dismissAudiobookImport = () => {
    if (audiobookBusy) return
    audiobookSourcesRef.current = []
    setAudiobookImport({})
  }

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
    void refreshRecovery()
    window.scrollTo({ top: 0, behavior: motionScrollBehavior(appearance.motion) })
  }

  const refreshImportHistory = async () => {
    try {
      setImportHistory(await (await getStorageRuntime()).imports.listRecentBatches())
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error))
    }
  }

  const refreshRecovery = async () => {
    try {
      const runtime = await getStorageRuntime()
      const snapshots = await runtime.recovery.listSnapshots()
      setRecovery((current) => ({
        ...current,
        snapshots,
        error: current.error ?? runtime.recoveryWarning,
      }))
    } catch (error) {
      setRecovery((current) => ({
        ...current,
        error: error instanceof Error ? error.message : String(error),
      }))
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

  const importEpubSources = async (
    sources: readonly (() => Promise<EpubImportSource>)[],
  ) => {
    if (epubBusy || sources.length === 0) return
    const controller = new AbortController()
    epubAbortRef.current = controller
    setEpubBusy(true)
    setEpubImport({})
    const results: EpubImportResult[] = []
    try {
      const runtime = await getStorageRuntime()
      for (const loadSource of sources) {
        const source = await loadSource()
        const result = await runtime.epubs.import(source, {
          signal: controller.signal,
          onProgress: (progress) => setEpubImport({ progress }),
        })
        results.push(result)
        setEpubImport({ result })
        await reload()
        setSmartListCatalog(await runtime.catalog.read())
      }
      const duplicateCount = results.filter(({ outcome }) => outcome === 'duplicate').length
      const changedCount = results.length - duplicateCount
      setToast({
        message: results.length === 1
          ? resultToastMessage(results[0])
          : `${changedCount} EPUB${changedCount === 1 ? '' : 's'} added or revised; ${duplicateCount} already managed`,
      })
    } catch (error) {
      const message = epubImportErrorMessage(error)
      setEpubImport((current) => ({ ...current, error: message }))
      setToast({ message })
    } finally {
      epubAbortRef.current = undefined
      setEpubBusy(false)
    }
  }

  const routeIncomingBookFile = async (url: string) => {
    try {
      const source = await audiobookSourceFromIncomingUrl(url)
      if (isZipContainer(source.bytes)) {
        const name = source.name.toLocaleLowerCase().endsWith('.epub') ? source.name : `${source.name}.epub`
        await importEpubSources([async () => ({
          name,
          mediaType: 'application/epub+zip',
          bytes: source.bytes,
        })])
      } else {
        await prepareAudiobookSources(async () => [source])
      }
    } catch (error) {
      const message = audiobookImportErrorMessage(error)
      setAudiobookImport({ error: message })
      setToast({ message })
    }
  }

  const openSharedIsbn = useEffectEvent((isbn: NonNullable<ReturnType<typeof extractValidIsbn>>) => {
    setView('library')
    setSheet({ kind: 'search', shelf: 'tbr', initialCapture: { isbn, method: 'share-sheet' } })
    setToast({ message: 'Shared ISBN received · checking your library first' })
  })

  const onIncomingBookFile = useEffectEvent((url: string) => {
    if (/^wovenleaf:\/\/(?:share|add)/i.test(url)) {
      const isbn = extractValidIsbn(url)
      if (isbn) openSharedIsbn(isbn)
      return
    }
    if (!/^(?:file|content):/i.test(url)) return
    showSettings()
    void routeIncomingBookFile(url)
  })

  useEffect(() => {
    let disposed = false
    let removeListener: (() => Promise<void>) | undefined
    void CapacitorApp.addListener('appUrlOpen', ({ url }) => onIncomingBookFile(url))
      .then((handle) => {
        if (disposed) void handle.remove()
        else removeListener = () => handle.remove()
      })
    return () => {
      disposed = true
      if (removeListener) void removeListener()
    }
  }, [])

  useEffect(() => {
    let disposed = false
    let removeListener: (() => Promise<void>) | undefined
    void listenForSharedIsbn((isbn) => openSharedIsbn(isbn))
      .then((remove) => {
        if (disposed) void remove()
        else removeListener = remove
      })
      .catch(() => {
        // Deep-link and paste capture remain available if a platform share target is unavailable.
      })
    return () => {
      disposed = true
      if (removeListener) void removeListener()
    }
  }, [])

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

  const handleRecoveryFile = async (file: File) => {
    setRecovery((current) => ({ ...current, busy: true, error: undefined, preview: undefined }))
    try {
      const archive = await file.text()
      const preview = await (await getStorageRuntime()).recovery.inspectArchive(archive)
      recoveryArchiveRef.current = archive
      setRecovery((current) => ({ ...current, busy: false, preview }))
    } catch (error) {
      recoveryArchiveRef.current = undefined
      setRecovery((current) => ({
        ...current,
        busy: false,
        error: error instanceof Error ? error.message : String(error),
      }))
    }
  }

  const createRecoveryPoint = async () => {
    setRecovery((current) => ({ ...current, busy: true, error: undefined }))
    try {
      await Promise.all([reload(), reloadOrganization(), reloadSmartLists(), reloadUpNext()])
      await (await getStorageRuntime()).recovery.createSnapshot('manual')
      await refreshRecovery()
      setToast({ message: 'Verified local recovery point saved' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setRecovery((current) => ({ ...current, error: message }))
      setToast({ message })
    } finally {
      setRecovery((current) => ({ ...current, busy: false }))
    }
  }

  const restoreBackup = async () => {
    const archive = recoveryArchiveRef.current
    if (!archive || !recovery.preview?.canRestore) return
    setRecovery((current) => ({ ...current, busy: true, error: undefined }))
    try {
      await Promise.all([reload(), reloadOrganization(), reloadSmartLists(), reloadUpNext()])
      const runtime = await getStorageRuntime()
      await runtime.recovery.restore(archive, {
        allowStale: recovery.preview.validation.code === 'stale',
      })
      await Promise.all([reload(), reloadOrganization(), reloadSmartLists(), reloadUpNext()])
      setSmartListCatalog(await runtime.catalog.read())
      recoveryArchiveRef.current = undefined
      await refreshRecovery()
      setView('library')
      setToast({ message: 'Backup restored; the previous library remains available for rollback' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setRecovery((current) => ({ ...current, error: message }))
      setToast({ message })
    } finally {
      setRecovery((current) => ({ ...current, busy: false }))
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
    const previous = findLibraryBookForSearchResult(books, result)
    if (previous && previous.shelf !== shelf) {
      const { bookId } = addBook(result, shelf)
      if (shelf === 'next') addQueueBook(bookId)
      else removeQueueBook(bookId)
      setMovingBookId(previous.id)
      setToast({ message: `Moved to ${shelfCopy[shelf].label}` })
      return
    }

    const { bookId } = addBook(result, shelf)
    if (shelf === 'next') addQueueBook(bookId)
    else removeQueueBook(bookId)
    setMovingBookId(bookId)
    setToast({ message: previous ? `Already in ${shelfCopy[shelf].label}` : `Added to ${shelfCopy[shelf].label}` })
  }

  const enrichBook = async (book: typeof books[number]): Promise<boolean> => {
    const capturedIsbn = extractValidIsbn(book.identifiers?.join(' ') ?? '')
    const query = capturedIsbn?.normalized ?? book.title
    try {
      const response = await (await getMetadataSearchService()).search({
        query,
        locale: navigator.language || 'en',
        limit: 16,
      }, { includeSecondary: true, refresh: true })
      const result = capturedIsbn
        ? response.results.find((candidate) =>
            extractValidIsbn(candidate.identifiers?.join(' ') ?? '')?.canonical === capturedIsbn.canonical,
          ) ?? response.results[0]
        : response.results[0]
      if (!result) return false

      updateBook(book.id, enrichCapturedBook(book, result))
      setToast({
        message: book.capture?.manualOverrides.length
          ? 'Catalog gaps filled · your local overrides were preserved'
          : 'Book details enriched from the catalog',
      })
      return true
    } catch {
      return false
    }
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
            epubImport={epubImport}
            epubBusy={epubBusy}
            audiobookImport={audiobookImport}
            audiobookBusy={audiobookBusy}
            exportBusy={exportBusy}
            exportError={exportError}
            recovery={recovery}
            onBack={showLibrary}
            onAppearanceChange={setAppearance}
            onSearchPreferencesChange={setSearchPreferences}
            onManualAdd={() => openSheet({ kind: 'search', shelf: 'tbr', manual: true })}
            onImportFile={(file) => { void handleImportFile(file) }}
            onImportEpubFiles={(files) => {
              void importEpubSources(files.map((file) => () => epubSourceFromFile(file)))
            }}
            onCancelEpubImport={() => epubAbortRef.current?.abort()}
            onPrepareAudiobookFiles={(files) => { void prepareAudiobookFiles(files) }}
            onCommitAudiobook={(review) => { void commitAudiobook(review) }}
            onCancelAudiobookImport={() => audiobookAbortRef.current?.abort()}
            onDismissAudiobookImport={dismissAudiobookImport}
            onUndoImport={(batchId) => { void undoImportBatch(batchId) }}
            onExport={(format, includeAnnotations) => { void handleExport(format, includeAnnotations) }}
            onRecoveryFile={(file) => { void handleRecoveryFile(file) }}
            onCreateRecoveryPoint={() => { void createRecoveryPoint() }}
            onRestoreBackup={() => { void restoreBackup() }}
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
        <SearchSheet
          key={sheet.initialCapture?.isbn.normalized ?? `${sheet.shelf}-${sheet.manual ? 'manual' : 'search'}`}
          shelf={sheet.shelf}
          books={books}
          onAdd={handleAdd}
          onOpenBook={(bookId) => setSheet({ kind: 'detail', bookId })}
          onClose={closeSheet}
          initialManual={sheet.manual}
          initialCapture={sheet.initialCapture}
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
          onMetadata={(changes) => {
            updateBook(selectedBook.id, changes)
            setToast({ message: 'Local book details saved as your preferred values' })
          }}
          onEnrich={() => enrichBook(selectedBook)}
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

function resultToastMessage(result: EpubImportResult): string {
  if (result.outcome === 'duplicate') return `${result.title} is already safely managed`
  if (result.outcome === 'revision') return `Revised EPUB linked to ${result.title}`
  return `${result.title} added from a verified EPUB`
}

function audiobookResultToastMessage(result: { readonly outcome: string; readonly title: string }): string {
  if (result.outcome === 'duplicate') return `${result.title} is already safely managed`
  if (result.outcome === 'revision') return `Revised audiobook linked to ${result.title} without losing progress`
  return `${result.title} is ready as one audiobook`
}

function isZipContainer(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
}

export default App
