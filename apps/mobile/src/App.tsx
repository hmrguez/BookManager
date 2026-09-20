import { useLibby } from './libby/use-libby'
import { LibbySettings } from './libby/LibbySettings'
import { LibbyBookLink } from './libby/LibbyBookLink'
import { Capacitor } from '@capacitor/core'
import { nativeOriginalFiles, originalFiles, originalSelectionFromUri, pickOriginalFiles, type IncomingOriginalFile } from './files/original-files'
import { isPdfBytes } from './epub/inspect-book'
import { purchases, startPurchases } from './purchases/runtime'
import { LibraryUpgradeRequired } from './purchases/model'
import { UpgradeDialog } from './purchases/UpgradeDialog'
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { AlertTriangle, Check, Download } from 'lucide-react'
import { App as CapacitorApp } from '@capacitor/app'
import type { SharedFile } from '@capgo/capacitor-share-target'
import {
  applyAppearance,
  getAppearanceStorage,
  motionScrollBehavior,
  readAppearance,
  shouldReduceMotion,
  writeAppearance,
} from './design-system'
import { ImportReviewPage } from './imports/ImportReviewPage'
import { IncomingFileOpening, type IncomingFileOpeningState } from './imports/IncomingFileOpening'
import { incomingFileDisplayName } from './imports/incoming'
import type { ImportBatchSummary, ImportPreview, ImportReviewDecision } from './imports'
import type { ImportProgress } from './storage/import-repository'
import { useLibrary, type BookSearchResult, type LibraryBook, type ShelfId } from './library'
import { useOrganization, type ShelfDraft } from './organization'
import { orderedShelfEntries, tagsForBook, type CustomShelf } from './organization-model'
import type { LibraryDropTarget } from './library/library-drag'
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
import { RecommendationSettings } from './recommendations/RecommendationSettings'
import { RecommendationDetails } from './recommendations/RecommendationDetails'
import { useUpNext } from './up-next'
import { shelfCopy } from './app/config'
import { downloadTextFile } from './app/download'
import type { AppView, ExportFormat, SheetState, ToastState } from './app/model'
import { BottomNavigation } from './app/components/BottomNavigation'
import { Sheet } from './app/components/Sheet'
import { LibraryPage, type CoverEnrichmentStatus } from './library/LibraryPage'
import type { ShelfMotionEvent } from './library/shelf-motion'
import { useLibraryViewModel } from './library/useLibraryViewModel'
import { SearchSheet } from './search/SearchSheet'
import { CustomShelfEditorSheet } from './organization/CustomShelfComponents'
import { FinishedSheet, ProgressSheet } from './reading/ReadingSheets'
import { ReaderRecoverySheet, type ReaderRecovery } from './reading/ReaderRecoverySheet'
import {
  SettingsPage,
  type AudiobookImportViewState,
  type EpubImportViewState,
  type RecoveryViewState,
} from './settings/SettingsPage'
import type { EpubStorageViewState } from './settings/EpubStorageCard'
import { DetailSheet } from './work-detail/DetailSheet'
import { AudiobookPlayer } from './playback/AudiobookPlayer'
import {
  getSystemMediaPreferencesStorage,
  readSystemMediaPreferences,
  writeSystemMediaPreferences,
} from './playback'
import {
  feedback,
  getFeedbackPreferencesStorage,
  readFeedbackPreferences,
  writeFeedbackPreferences,
  type FeedbackPreferences,
} from './feedback'
import { tw } from './tailwind/styles'
import { motionStyles } from './tailwind/motion'
import {
  epubImportErrorMessage,
  epubSourceFromFile,
  epubSourceFromIncomingUrl,
  type EpubImportSource,
  type EpubImportResult,
} from './epub'
import { EpubReaderError } from './reader'
import {
  audiobookImportErrorMessage,
  audiobookSourceFromIncomingUrl,
  audiobookSourcesFromFiles,
  defaultAudiobookReview,
  type AudiobookImportReview,
  type AudiobookImportSource,
} from './audiobooks'
import { FEATURES } from './app/feature-flags'
import { extractValidIsbn, listenForSharedFiles, listenForSharedIsbn } from './capture'
import { enrichCapturedBook } from './capture'
import { getMetadataSearchService } from './metadata'
import {
  GoodreadsCoverEnrichmentService,
  countGoodreadsBooksMissingCovers,
  goodreadsCsvFromIncomingUrl,
  goodreadsCsvFromSharedFile,
  IncomingFileDeliveryGuard,
  looksLikeSharedCsv,
  UnrecognizedGoodreadsCsvError,
} from './imports'

function App() {
  const {
    books,
    hydrated: libraryHydrated,
    storageError,
    legacyRecoveryAvailable,
    downloadLegacyRecovery,
    addBook,
    updateBook,
    setThumbnailIfMissing,
    moveBook,
    setProgress,
    setCurrentPage,
    removeBook,
    clearBooks,
    reload,
  } = useLibrary()
  const libby = useLibby(reload)
  const [revealLibby, setRevealLibby] = useState(false)
  const {
    organization,
    hydrated: organizationHydrated,
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
    hydrated: upNextHydrated,
    upNextError,
    savePreferences: saveUpNextPreferences,
    addQueueBook,
    removeQueueBook,
    moveQueueBook,
    setReasonState,
    dismissSuggestion,
    restoreSuggestion,
    reloadUpNext,
  } = useUpNext(books)

  const purchaseView = useSyncExternalStore(purchases.subscribe, purchases.getSnapshot)
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  useEffect(() => {
    const unsubscribe = purchases.onUpgradeRequired(() => setUpgradeOpen(true))
    startPurchases()
    return unsubscribe
  }, [])
  const [sheet, setSheet] = useState<SheetState>(null)
  const [view, setView] = useState<AppView>('library')
  const [librarySearchOpen, setLibrarySearchOpen] = useState(false)
  const [libraryQuery, setLibraryQuery] = useState('')
  const [libraryShelfFilter, setLibraryShelfFilter] = useState<ShelfId | 'all'>('all')
  const [librarySort, setLibrarySort] = useState<LocalSearchSort>('relevance')
  const [commandMenuOpen, setCommandMenuOpen] = useState(false)
  const [toast, setToast] = useState<ToastState>(null)
  const [shelfMotion, setShelfMotion] = useState<ShelfMotionEvent>()
  const [appearance, setAppearance] = useState(() => readAppearance(getAppearanceStorage()))
  const [searchPreferences, setSearchPreferences] = useState(() =>
    readSearchPreferences(getSearchPreferencesStorage()),
  )
  const [systemMediaPreferences, setSystemMediaPreferences] = useState(() =>
    readSystemMediaPreferences(getSystemMediaPreferencesStorage()),
  )
  const [feedbackPreferences, setFeedbackPreferences] = useState(() =>
    readFeedbackPreferences(getFeedbackPreferencesStorage()),
  )
  const [importPreview, setImportPreview] = useState<ImportPreview>()
  const [importHistory, setImportHistory] = useState<ImportBatchSummary[]>([])
  const [importBusy, setImportBusy] = useState(false)
  const [importProgress, setImportProgress] = useState<ImportProgress>()
  const [importError, setImportError] = useState<string>()
  const [epubImport, setEpubImport] = useState<EpubImportViewState>({})
  const [epubBusy, setEpubBusy] = useState(false)
  const [epubStorage, setEpubStorage] = useState<EpubStorageViewState>({ busy: false })
  const [audiobookImport, setAudiobookImport] = useState<AudiobookImportViewState>({})
  const [audiobookBusy, setAudiobookBusy] = useState(false)
  const [incomingFileOpening, setIncomingFileOpening] = useState<IncomingFileOpeningState>()
  const incomingFileOpeningRef = useRef(false)
  const [exportBusy, setExportBusy] = useState(false)
  const [exportError, setExportError] = useState<string>()
  const [recovery, setRecovery] = useState<RecoveryViewState>({ snapshots: [], busy: false })
  const [smartListCatalog, setSmartListCatalog] = useState<Catalog>()
  const [originalRecovery, setOriginalRecovery] = useState<{ name: string; kind: 'ebook' | 'audio' }>()
  const [readerRecovery, setReaderRecovery] = useState<(ReaderRecovery & { readonly bookId: string })>()
  const [readerBusyBookId, setReaderBusyBookId] = useState<string>()
  const [coverEnrichmentStatus, setCoverEnrichmentStatus] = useState<CoverEnrichmentStatus>()
  const sheetTriggerRef = useRef<HTMLElement | null>(null)
  const epubAbortRef = useRef<AbortController | undefined>(undefined)
  const audiobookAbortRef = useRef<AbortController | undefined>(undefined)
  const audiobookSourcesRef = useRef<readonly AudiobookImportSource[]>([])
  const openAudiobookAfterImportRef = useRef(false)
  const recoveryArchiveRef = useRef<string | undefined>(undefined)
  const shelfMotionSequenceRef = useRef(0)
  const incomingDeliveryGuardRef = useRef(new IncomingFileDeliveryGuard())
  const coverEnrichmentRef = useRef<Promise<void> | undefined>(undefined)
  const coverEnrichmentQueuedRef = useRef(false)
  const booksSnapshotRef = useRef(books)

  const libraryViewModel = useLibraryViewModel({
    recommendationsReady: libraryHydrated && organizationHydrated && upNextHydrated,
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
    booksSnapshotRef.current = books
  }, [books])

  const enrichGoodreadsCovers = useEffectEvent(() => {
    if (coverEnrichmentRef.current) {
      coverEnrichmentQueuedRef.current = true
      return
    }
    let pending = countGoodreadsBooksMissingCovers(booksSnapshotRef.current)
    const task = (async () => {
      do {
        coverEnrichmentQueuedRef.current = false
        pending = countGoodreadsBooksMissingCovers(booksSnapshotRef.current)
        if (!pending) {
          setCoverEnrichmentStatus(undefined)
          continue
        }
        setCoverEnrichmentStatus({ state: 'checking', pending })
        const metadata = await getMetadataSearchService()
        const result = await new GoodreadsCoverEnrichmentService(metadata).enrich(booksSnapshotRef.current, {
          locale: navigator.language || 'en',
          onCover: setThumbnailIfMissing,
          onProgress: ({ candidateBooks, resolvedBooks }) => {
            pending = candidateBooks - resolvedBooks
            if (pending > 0) setCoverEnrichmentStatus({ state: 'checking', pending })
          },
        })
        pending = result.unresolvedBooks
        setCoverEnrichmentStatus(pending > 0
          ? { state: result.complete ? 'unresolved' : 'paused', pending }
          : undefined)
      } while (coverEnrichmentQueuedRef.current)
    })().catch(() => {
      setCoverEnrichmentStatus(pending > 0 ? { state: 'paused', pending } : undefined)
    }).finally(() => {
      coverEnrichmentRef.current = undefined
    })
    coverEnrichmentRef.current = task
  })

  useEffect(() => {
    if (libraryHydrated) enrichGoodreadsCovers()
  }, [libraryHydrated, books.length])

  useEffect(() => {
    let removeListener: (() => Promise<void>) | undefined
    void CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive && libraryHydrated) enrichGoodreadsCovers()
    }).then((handle) => {
      removeListener = () => handle.remove()
    })
    return () => {
      if (removeListener) void removeListener()
    }
  }, [libraryHydrated])

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
    let disposed = false
    let removeListener: (() => Promise<void>) | undefined
    void getStorageRuntime().then(async (runtime) => {
      removeListener = await runtime.reader.installEventListener(() => {
        if (!disposed) void reload()
      })
      if (disposed && removeListener) void removeListener()
    }).catch(() => {
      // Reader recovery is also drained before every native open.
    })
    return () => {
      disposed = true
      if (removeListener) void removeListener()
    }
  }, [reload])

  useEffect(() => {
    let disposed = false
    let disconnect: (() => Promise<void>) | undefined
    let unsubscribeProgress: (() => void) | undefined
    let removeLifecycleListener: (() => Promise<void>) | undefined
    void getStorageRuntime().then(async (runtime) => {
      if (disposed) return
      unsubscribeProgress = runtime.playback.subscribeProgress(() => {
        if (!disposed) void reload().catch(() => undefined)
      })
      await runtime.playback.connect()
      disconnect = () => runtime.playback.disconnect()
      const handle = await CapacitorApp.addListener('appStateChange', () => {
        void runtime.playback.flush().catch(() => undefined)
      })
      removeLifecycleListener = () => handle.remove()
      if (disposed) {
        await removeLifecycleListener()
        await disconnect()
      }
    }).catch(() => {
      // Native playback keeps its recovery journal and retries reconciliation next launch.
    })
    return () => {
      disposed = true
      unsubscribeProgress?.()
      if (removeLifecycleListener) void removeLifecycleListener().catch(() => undefined)
      if (disconnect) void disconnect().catch(() => undefined)
    }
  }, [reload])

  const prepareAudiobookSources = async (
    loadSources: () => Promise<readonly AudiobookImportSource[]>,
    targetBook?: LibraryBook,
    overwriteCover = false,
    openAfterImport = false,
  ) => {
    if (audiobookAbortRef.current) return
    const controller = new AbortController()
    audiobookAbortRef.current = controller
    setAudiobookBusy(true)
    setAudiobookImport({})
    openAudiobookAfterImportRef.current = openAfterImport
    try {
      const sources = await loadSources()
      if (sources.length === 0) return
      audiobookSourcesRef.current = sources
      const runtime = await getStorageRuntime()
      if (openAfterImport) setIncomingFileOpening((current) => current && { ...current, phase: 'preparing', audio: true })
      const draft = await runtime.audiobooks.prepare(sources, {
        signal: controller.signal,
        onProgress: (progress) => setAudiobookImport({ progress }),
      })
      if (openAfterImport) {
        const existing = await runtime.audiobooks.findImported(draft)
        if (existing) {
          await runtime.audiobooks.relinkImported(existing, sources, draft)
          await runtime.playback.loadBook(existing.bookId)
          setIncomingFileOpening((current) => current && { ...current, phase: 'opening' })
          audiobookSourcesRef.current = []
          openAudiobookAfterImportRef.current = false
          setAudiobookImport({ result: existing })
          await reload()
          showLibrary()
          setSheet({ kind: 'audiobook-player', bookId: existing.bookId })
          return
        }
      }
      if (!targetBook) {
        setAudiobookImport({ draft })
        return
      }
      const review = {
        ...defaultAudiobookReview(draft),
        title: targetBook.title,
        authors: targetBook.authors,
        orderConfirmed: true,
      }
      const result = await runtime.audiobooks.import(sources, review, {
        signal: controller.signal,
        targetBookId: targetBook.id,
        overwriteCover,
        onProgress: (progress) => setAudiobookImport({ progress }),
      })
      audiobookSourcesRef.current = []
      setAudiobookImport({ result })
      await reload()
      setSmartListCatalog(await runtime.catalog.read())
      setToast({ message: `Audiobook attached to ${targetBook.title}` })
    } catch (error) {
      audiobookSourcesRef.current = []
      openAudiobookAfterImportRef.current = false
      const message = audiobookImportErrorMessage(error)
      setAudiobookImport({ error: message })
      setToast({ message })
      void feedback.emit('error')
    } finally {
      audiobookAbortRef.current = undefined
      setAudiobookBusy(false)
    }
  }

  const prepareAudiobookFiles = (files: readonly File[]) => {
    if (files.length === 0) return
    return prepareAudiobookSources(() => audiobookSourcesFromFiles(files))
  }

  const attachAudiobookFiles = (book: LibraryBook, files: readonly File[], overwriteCover = false) => {
    if (files.length === 0) return
    return prepareAudiobookSources(() => audiobookSourcesFromFiles(files), book, overwriteCover)
  }

  const commitAudiobook = async (review: AudiobookImportReview) => {
    if (audiobookAbortRef.current || audiobookSourcesRef.current.length === 0) return
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
      if (openAudiobookAfterImportRef.current) {
        openAudiobookAfterImportRef.current = false
        showLibrary()
        setSheet({ kind: 'audiobook-player', bookId: result.bookId })
      }
    } catch (error) {
      if (error instanceof LibraryUpgradeRequired) {
        setAudiobookImport((current) => ({ ...current, progress: undefined, error: error.message }))
        return
      }
      audiobookSourcesRef.current = []
      openAudiobookAfterImportRef.current = false
      const message = audiobookImportErrorMessage(error)
      setAudiobookImport({ error: message })
      setToast({ message })
      void feedback.emit('error')
    } finally {
      audiobookAbortRef.current = undefined
      setAudiobookBusy(false)
    }
  }

  const dismissAudiobookImport = () => {
    if (audiobookBusy) return
    audiobookSourcesRef.current = []
    openAudiobookAfterImportRef.current = false
    setAudiobookImport({})
  }

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), toast.undo ? 5000 : 2400)
    return () => window.clearTimeout(timer)
  }, [toast])

  useLayoutEffect(() => {
    applyAppearance(document.documentElement, appearance)
    const storage = getAppearanceStorage()
    if (storage) writeAppearance(storage, appearance)
  }, [appearance])

  useEffect(() => {
    writeSearchPreferences(getSearchPreferencesStorage(), searchPreferences)
  }, [searchPreferences])

  useEffect(() => {
    writeSystemMediaPreferences(getSystemMediaPreferencesStorage(), systemMediaPreferences)
    void getStorageRuntime().then(({ playback }) =>
      playback.setSystemSurfacePrivacy(systemMediaPreferences.showBookDetailsWhenLocked),
    ).catch(() => {
      // The saved privacy choice is retried when the native playback engine reconnects.
    })
  }, [systemMediaPreferences])

  useEffect(() => {
    feedback.configure(feedbackPreferences)
    writeFeedbackPreferences(getFeedbackPreferencesStorage(), feedbackPreferences)
  }, [feedbackPreferences])

  const changeFeedbackPreferences = (preferences: FeedbackPreferences) => {
    const enabledHaptics = feedbackPreferences.haptics === 'off' && preferences.haptics === 'system'
    const enabledSound = feedbackPreferences.sound === 'off' && preferences.sound === 'quiet'
    feedback.configure(preferences)
    setFeedbackPreferences(preferences)
    if (enabledSound) void feedback.emit('completion')
    else if (enabledHaptics) void feedback.emit('selection')
  }

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
    setSheet(null)
    setView('settings')
    void refreshImportHistory()
    void refreshRecovery()
    void refreshEpubStorage()
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

  const refreshEpubStorage = async () => {
    setEpubStorage((current) => ({ ...current, busy: true, error: undefined }))
    try {
      const inventory = await (await getStorageRuntime()).epubAssets.inventory()
      setEpubStorage({ inventory, busy: false })
    } catch (error) {
      setEpubStorage((current) => ({
        ...current,
        busy: false,
        error: error instanceof Error ? error.message : String(error),
      }))
    }
  }

  const previewEpubCleanup = async (assetIds?: readonly string[]) => {
    setEpubStorage((current) => ({ ...current, busy: true, error: undefined }))
    try {
      const cleanupPreview = await (await getStorageRuntime()).epubAssets.previewCleanup(assetIds)
      setEpubStorage((current) => ({ ...current, busy: false, cleanupPreview }))
    } catch (error) {
      setEpubStorage((current) => ({
        ...current,
        busy: false,
        error: error instanceof Error ? error.message : String(error),
      }))
      void feedback.emit('error')
    }
  }

  const confirmEpubCleanup = async () => {
    const preview = epubStorage.cleanupPreview
    if (!preview) return
    setEpubStorage((current) => ({ ...current, busy: true, error: undefined }))
    try {
      const freedBytes = await (await getStorageRuntime()).epubAssets.cleanup(preview)
      setToast({ message: `${formatStorageBytes(freedBytes)} freed; reading history and notes were kept` })
      await refreshEpubStorage()
    } catch (error) {
      setEpubStorage((current) => ({
        ...current,
        busy: false,
        error: error instanceof Error ? error.message : String(error),
      }))
    }
  }

  const cancelEpubReview = () => {
    setEpubStorage((current) => ({
      ...current,
      cleanupPreview: undefined,
      error: undefined,
    }))
  }

  const prepareImportPreview = async (fileName: string, content: string) => {
    setImportBusy(true)
    setImportError(undefined)
    setImportProgress({ stage: 'preparing', completed: 0, total: 0 })
    try {
      await reload()
      const preview = await (await getStorageRuntime()).imports.previewCsv(fileName, content, {
        onProgress: setImportProgress,
        onPreview: (partial) => { setImportPreview(partial); setView('import') },
      })
      setImportPreview(preview)
      setImportProgress(undefined)
      setView('import')
      window.scrollTo({ top: 0, behavior: motionScrollBehavior(appearance.motion) })
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error))
      setImportPreview(undefined)
      setImportProgress(undefined)
      setView('settings')
    } finally {
      setImportBusy(false)
    }
  }

  const handleImportFile = async (file: File) => prepareImportPreview(file.name, await file.text())

  const importEpubSources = async (
    sources: readonly (() => Promise<EpubImportSource>)[],
    targetBookId?: string,
    overwriteCover = false,
    openAfterImport = false,
  ) => {
    if (epubAbortRef.current || sources.length === 0) return
    const controller = new AbortController()
    epubAbortRef.current = controller
    setEpubBusy(true)
    setEpubImport({})
    const results: EpubImportResult[] = []
    try {
      const runtime = await getStorageRuntime()
      for (const loadSource of sources) {
        if (openAfterImport) setIncomingFileOpening((current) => current && { ...current, phase: 'reading' })
        const source = await loadSource()
        if (openAfterImport) setIncomingFileOpening((current) => current && { ...current, phase: 'preparing' })
        const result = await runtime.epubs.import(source, {
          signal: controller.signal,
          ...(targetBookId ? { targetBookId } : {}),
          overwriteCover,
          onProgress: (progress) => setEpubImport({ progress }),
        })
        results.push(result)
        setEpubImport({ result })
        await reload()
        setSmartListCatalog(await runtime.catalog.read())
      }
      await refreshEpubStorage()
      const duplicateCount = results.filter(({ outcome }) => outcome === 'duplicate').length
      const changedCount = results.length - duplicateCount
      const targetBook = targetBookId ? books.find(({ id }) => id === targetBookId) : undefined
      setToast({
        message: targetBook && results.length === 1
          ? `Book attached to ${targetBook.title}`
          : results.length === 1
          ? resultToastMessage(results[0])
          : `${changedCount} book${changedCount === 1 ? '' : 's'} added or revised; ${duplicateCount} already managed`,
      })
      if (openAfterImport && results.length === 1) {
        setIncomingFileOpening((current) => current && { ...current, phase: 'opening' })
        showLibrary()
        await openReader(results[0]!.bookId)
      }
    } catch (error) {
      const message = epubImportErrorMessage(error)
      setEpubImport((current) => ({ ...current, error: message }))
      setToast({ message })
      void feedback.emit('error')
    } finally {
      epubAbortRef.current = undefined
      setEpubBusy(false)
    }
  }

  // Cover the native read as well as import: a large share may take time before
  // either import service has bytes to inspect or can report progress.
  const withIncomingFileOpening = async (name: string | undefined, open: () => Promise<unknown>) => {
    if (incomingFileOpeningRef.current) return
    if (epubAbortRef.current || audiobookAbortRef.current) {
      setToast({ message: 'Please wait for the current import to finish, then open this file again.' })
      return
    }
    incomingFileOpeningRef.current = true
    setIncomingFileOpening({ name, phase: 'reading' })
    setCommandMenuOpen(false)
    showSettings()
    try {
      await (await getStorageRuntime()).reader.closeForIncomingFile()
      await open()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The shared file could not be opened. Please try again.'
      setEpubImport({ error: message })
      setToast({ message })
      void feedback.emit('error')
    } finally {
      incomingFileOpeningRef.current = false
      setIncomingFileOpening(undefined)
    }
  }

  useEffect(() => {
    if (!incomingFileOpening && audiobookImport.draft && openAudiobookAfterImportRef.current) {
      document.querySelector('.audiobook-intake')?.scrollIntoView({ behavior: 'instant', block: 'start' })
    }
  }, [incomingFileOpening, audiobookImport.draft])

  const routeIncomingBookFile = async (url: string) => {
    try {
      if (Capacitor.isNativePlatform()) {
        const reference = await originalSelectionFromUri(url)
        const header = await originalFiles.readRange(reference, 0, Math.min(reference.size, 16))
        if (isPdfBytes(header) || isZipContainer(header)) {
          await importEpubSources([() => epubSourceFromIncomingUrl(url)], undefined, false, true)
        } else {
          await prepareAudiobookSources(async () => [await audiobookSourceFromIncomingUrl(url)], undefined, false, true)
        }
        return
      }
      const source = await audiobookSourceFromIncomingUrl(url)
      if (isPdfBytes(source.bytes)) {
        await importEpubSources([async () => ({ bytes: source.bytes, name: /\.pdf$/i.test(source.name) ? source.name : `${source.name}.pdf`, mediaType: 'application/pdf' })], undefined, false, true)
      } else if (isZipContainer(source.bytes)) {
        const name = source.name.toLocaleLowerCase().endsWith('.epub') ? source.name : `${source.name}.epub`
        await importEpubSources([async () => ({
          name,
          mediaType: 'application/epub+zip',
          bytes: source.bytes,
        })], undefined, false, true)
      } else {
        await prepareAudiobookSources(async () => [source], undefined, false, true)
      }
    } catch (error) {
      const message = audiobookImportErrorMessage(error)
      setAudiobookImport({ error: message })
      setToast({ message })
      void feedback.emit('error')
    }
  }

  const openReader = async (bookId: string) => {
    if (readerBusyBookId) return
    setReaderBusyBookId(bookId)
    setReaderRecovery(undefined)
    try {
      const runtime = await getStorageRuntime()
      await runtime.reader.drainOutbox(() => void reload())
      await runtime.reader.open(bookId)
      closeSheet()
    } catch (error) {
      const book = books.find(({ id }) => id === bookId)
      setReaderRecovery({
        bookId,
        title: book?.title ?? 'Book edition',
        message: error instanceof Error ? error.message : 'This book could not be opened.',
        canRetry: !(error instanceof EpubReaderError)
          || !['not-found', 'unavailable', 'unsupported-content'].includes(error.code),
      })
      closeSheet()
      void feedback.emit('error')
    } finally {
      setReaderBusyBookId(undefined)
    }
  }

  const openBookMedia = (book: typeof books[number]) => {
    if (book.format?.toLocaleUpperCase() === 'AUDIOBOOK') {
      openSheet({ kind: 'audiobook-player', bookId: book.id })
      return
    }
    void openReader(book.id)
  }

  const openSharedIsbn = useEffectEvent((isbn: NonNullable<ReturnType<typeof extractValidIsbn>>) => {
    setView('library')
    setSheet({ kind: 'search', shelf: 'tbr', initialCapture: { isbn, method: 'share-sheet' } })
    setToast({ message: 'Shared ISBN received · checking your library first' })
  })

  const onIncomingBookFile = useEffectEvent((url: string) => {
    const readerBookId = readerBookIdFromUrl(url)
    if (readerBookId) {
      void openReader(readerBookId)
      return
    }
    if (/^wovenleaf:\/\/(?:share|add)/i.test(url)) {
      const isbn = extractValidIsbn(url)
      if (isbn) openSharedIsbn(isbn)
      return
    }
    if (!/^(?:file|content|capacitor):/i.test(url)) return
    if (/\.json(?:[?#]|$)/i.test(url)) { showSettings(); void libby.receiveFile(url); return }
    if (!incomingDeliveryGuardRef.current.accept(`url:${url}`)) return
    const explicitCsv = /\.csv(?:[?#]|$)/i.test(url)
    const explicitBookMedia = /\.(?:epub|pdf|m4b|m4a|mp4|mp3)(?:[?#]|$)/i.test(url)
    const receive = async () => {
      if (explicitBookMedia) return routeIncomingBookFile(url)
      try {
        const { name, content } = await goodreadsCsvFromIncomingUrl(url)
        await prepareImportPreview(name, content)
      } catch (error) {
        if (!explicitCsv && !(error instanceof UnrecognizedGoodreadsCsvError)) {
          await routeIncomingBookFile(url)
          return
        }
        const message = error instanceof Error ? error.message : String(error)
        setImportError(message)
        setToast({ message })
        void feedback.emit('error')
      }
    }
    if (explicitCsv) {
      showSettings()
      void receive()
    } else {
      void withIncomingFileOpening(incomingFileDisplayName(url), receive)
        .finally(() => incomingDeliveryGuardRef.current.release(`url:${url}`))
    }
  })

  const onLibbyText = useEffectEvent((text: string) => { showSettings(); void libby.receiveText(text) })

  const onSharedFiles = useEffectEvent((files: readonly SharedFile[]) => {
    const progressFile = files.find(file => /\.json$/i.test(file.name) || file.mimeType === 'application/json')
    if (progressFile) { showSettings(); void libby.receiveFile(progressFile.uri); return }
    const temporary = files.find((file) => file.uri.startsWith('wovenleaf-reselect://'))
    if (temporary) {
      setOriginalRecovery({ name: temporary.name, kind: /\.(epub|pdf)$/i.test(temporary.name) || ['application/pdf', 'application/epub+zip'].includes(temporary.mimeType) ? 'ebook' : 'audio' })
      return
    }
    const books = files.filter((file) => /\.(epub|pdf)$/i.test(file.name) || ['application/pdf', 'application/epub+zip'].includes(file.mimeType))
    if (books.length) {
      const incoming = books.filter((file) => incomingDeliveryGuardRef.current.accept(`share:${file.uri}:${file.name}:${file.mimeType}`))
      if (!incoming.length) return
      void withIncomingFileOpening(incoming.length === 1 ? incoming[0]!.name : `${incoming.length} books`, () => importEpubSources(incoming.map((file) => async () => {
        const url = file.uri.startsWith('/') ? `file://${file.uri}` : file.uri
        const source = await epubSourceFromIncomingUrl(url)
        return { ...source, name: file.name, mediaType: file.mimeType }
      }), undefined, false, true)).finally(() => {
        for (const file of incoming) incomingDeliveryGuardRef.current.release(`share:${file.uri}:${file.name}:${file.mimeType}`)
      })
      return
    }
    const audio = files.filter((file) => /\.(m4b|m4a|mp4|mp3)$/i.test(file.name) || file.mimeType.startsWith('audio/'))
    if (audio.length) {
      const incoming = audio.filter((file) => incomingDeliveryGuardRef.current.accept(`share:${file.uri}:${file.name}:${file.mimeType}`))
      if (!incoming.length) return
      void withIncomingFileOpening(incoming.length === 1 ? incoming[0]!.name : `${incoming.length} audio files`, () => prepareAudiobookSources(() => Promise.all(incoming.map(async (file) => {
        const url = file.uri.startsWith('/') ? `file://${file.uri}` : file.uri
        const source = await audiobookSourceFromIncomingUrl(url)
        return { ...source, name: file.name, relativePath: file.name, mediaType: file.mimeType }
      })), undefined, false, true)).finally(() => {
        for (const file of incoming) incomingDeliveryGuardRef.current.release(`share:${file.uri}:${file.name}:${file.mimeType}`)
      })
      return
    }
    const file = files.find(looksLikeSharedCsv)
    if (!file) return
    if (!incomingDeliveryGuardRef.current.accept(`share:${file.uri}:${file.name}:${file.mimeType}`)) return
    showSettings()
    setToast({ message: 'Goodreads export received · preparing your private preview' })
    void goodreadsCsvFromSharedFile(file)
      .then(({ name, content }) => prepareImportPreview(name, content))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        setImportError(message)
        setToast({ message })
        void feedback.emit('error')
      })
  })

  const onOriginalIncoming = useEffectEvent((files: IncomingOriginalFile[]) => {
    const unavailable = files.find((file) => file.needsSelection)
    if (unavailable) { setOriginalRecovery(unavailable); return }
    onSharedFiles(files.flatMap((file) => file.uri ? [{ uri: file.uri, name: file.name,
      mimeType: file.kind === 'audio' ? 'audio/mp4' : /\.pdf$/i.test(file.name) ? 'application/pdf' : 'application/epub+zip' }] : []))
  })

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let disposed = false
    let remove: (() => Promise<void>) | undefined
    const drain = async () => {
      const { files } = await nativeOriginalFiles.incoming()
      if (!disposed && files.length) onOriginalIncoming(files)
    }
    void nativeOriginalFiles.addListener('incoming', () => { void drain() }).then(async (handle) => {
      if (disposed) { await handle.remove(); return }
      remove = () => handle.remove()
      await drain()
    })
    return () => { disposed = true; void remove?.() }
  }, [])

  useEffect(() => {
    let disposed = false
    let removeListener: (() => Promise<void>) | undefined
    void CapacitorApp.getLaunchUrl().then((launch) => {
      if (!disposed && launch?.url) onIncomingBookFile(launch.url)
    })
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
    void listenForSharedFiles((files) => onSharedFiles(files), (text) => onLibbyText(text))
      .then((remove) => {
        if (disposed) void remove()
        else removeListener = remove
      })
      .catch(() => {
        // The file picker remains available if a platform share target is unavailable.
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

  const handleExport = async (
    format: ExportFormat,
    includeAnnotations: boolean,
    includeEpubFiles: boolean,
  ) => {
    setExportBusy(true)
    setExportError(undefined)
    try {
      await reload()
      const runtime = await getStorageRuntime()
      const assetContents = includeEpubFiles ? await runtime.epubAssets.backupContents() : []
      const bundle = await runtime.portableArchives.create({
        includeAnnotations,
        includeSourcePayloads: false,
        assetContents,
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
          ? assetContents.length > 0
            ? `Portable archive verified with ${assetContents.length} book file${assetContents.length === 1 ? '' : 's'}`
            : 'Portable archive verified; book files are excluded'
          : `${format === 'csv' ? 'CSV' : 'Reading journal'} saved as a readable, lossy view`,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setExportError(message)
      setToast({ message })
      void feedback.emit('error')
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
      void feedback.emit('error')
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
      void feedback.emit('error')
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
      void feedback.emit('error')
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
      setSmartListCatalog(await (await getStorageRuntime()).catalog.read())
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
      void feedback.emit('error')
    } finally {
      setImportBusy(false)
    }
  }

  const commitImport = async (decisions: readonly ImportReviewDecision[]) => {
    if (!importPreview) return
    setImportBusy(true)
    setImportError(undefined)
    try {
      const result = await (await getStorageRuntime()).imports.commit(importPreview.id, decisions, {
        onProgress: setImportProgress,
      })
      await reload()
      setSmartListCatalog(await (await getStorageRuntime()).catalog.read())
      await refreshImportHistory()
      const migratedLabel = importPreview.source.key === 'goodreads-csv' ? 'books' : 'rows'
      const changedRows = result.appliedRows - result.skippedRows
      const untouched = result.skippedRows + result.duplicateRows
      const remainder = result.excludedRows
      const coverSuffix = importPreview.source.key === 'goodreads-csv' && result.appliedRows
        ? ' · covers filling in quietly'
        : ''
      setToast({
        message: result.appliedChanges
          ? `Imported ${changedRows} ${migratedLabel} · ${untouched} unchanged · ${remainder} left for later${coverSuffix}`
          : `Import checked · ${untouched} unchanged · ${remainder} left for later`,
        undo: result.appliedChanges ? () => { void undoImportBatch(result.batchId) } : undefined,
      })
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error))
      setImportProgress(undefined)
      void feedback.emit('error')
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

  const beginShelfMotion = (bookId: string, from?: ShelfId, to?: ShelfId): ShelfMotionEvent => {
    shelfMotionSequenceRef.current += 1
    const event = { sequence: shelfMotionSequenceRef.current, bookId, from, to }
    setShelfMotion(event)
    return event
  }

  const moveToShelf = (
    id: string,
    shelf: ShelfId,
    feedbackEvent: 'successful-move' | 'completion' = 'successful-move',
  ) => {
    const book = books.find((item) => item.id === id)
    if (!book || book.shelf === shelf) return false
    const motion = beginShelfMotion(id, book.shelf, shelf)
    moveBook(id, shelf)
    if (shelf === 'next') addQueueBook(id)
    else removeQueueBook(id)
    void feedback.emit(feedbackEvent, {
      operationId: `shelf:${motion.sequence}:${id}:${shelf}`,
      soundProfile: feedbackEvent === 'successful-move'
        && !shouldReduceMotion(appearance.motion)
        ? 'shelf-transfer'
        : 'semantic',
    })
    return true
  }

  const moveWithUndo = (id: string, shelf: ShelfId, message: string) => {
    const book = books.find((item) => item.id === id)
    if (!book || book.shelf === shelf) return

    const previousShelf = book.shelf
    moveToShelf(id, shelf)
    setToast({
      message,
      undo: () => {
        beginShelfMotion(id, shelf, previousShelf)
        updateBook(id, {
          shelf: previousShelf,
          progress: book.progress,
          currentPage: book.currentPage,
          startedAt: book.startedAt,
          finishedAt: book.finishedAt,
        })
        if (previousShelf === 'next') addQueueBook(id)
        else removeQueueBook(id)
        if (shelf === 'finished') closeSheet()
        setToast({
          message: `${book.title} returned to ${shelfCopy[previousShelf].label}`,
          family: 'undo',
        })
      },
    })
  }

  const performAdd = async (result: BookSearchResult, shelf: ShelfId) => {
    const previous = findLibraryBookForSearchResult(books, result)
    if (previous && previous.shelf !== shelf) {
      const motion = beginShelfMotion(previous.id, previous.shelf, shelf)
      const { bookId } = await addBook(result, shelf)
      if (shelf === 'next') addQueueBook(bookId)
      else removeQueueBook(bookId)
      void feedback.emit('successful-move', {
        operationId: `shelf:${motion.sequence}:${bookId}:${shelf}`,
        soundProfile: shouldReduceMotion(appearance.motion) ? 'semantic' : 'shelf-transfer',
      })
      setToast({ message: `Moved to ${shelfCopy[shelf].label}` })
      return
    }

    const { bookId } = await addBook(result, shelf)
    if (shelf === 'next') addQueueBook(bookId)
    else removeQueueBook(bookId)
    if (!previous) {
      const motion = beginShelfMotion(bookId, undefined, shelf)
      void feedback.emit('successful-move', {
        operationId: `shelf:${motion.sequence}:${bookId}:${shelf}`,
      })
    }
    setToast({ message: previous ? `Already in ${shelfCopy[shelf].label}` : `Added to ${shelfCopy[shelf].label}` })
  }

  const handleAdd = async (result: BookSearchResult, shelf: ShelfId): Promise<boolean> => {
    try {
      await performAdd(result, shelf)
      return true
    } catch (error) {
      if (!(error instanceof LibraryUpgradeRequired)) {
        setToast({ message: error instanceof Error ? error.message : 'The book could not be saved.' })
      }
      return false
    }
  }

  const enrichBook = async (book: typeof books[number]): Promise<boolean> => {
    const capturedIsbn = extractValidIsbn(book.identifiers?.join(' ') ?? '')
    const query = capturedIsbn?.normalized ?? book.title
    try {
      const response = await (await getMetadataSearchService()).search({
        query,
        locale: navigator.language || 'en',
        limit: 16,
      }, { refresh: true })
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

  const updateReadingProgress = (book: LibraryBook, requested: number) => {
    if (!Number.isFinite(requested)) {
      void feedback.emit('boundary')
      return
    }
    const bounded = Math.max(0, Math.min(100, requested))
    if (requested !== bounded) void feedback.emit('boundary')
    else if (bounded !== book.progress) void feedback.emit('selection')
    setProgress(book.id, bounded)
  }

  const updateReadingPage = (book: LibraryBook, requested: number) => {
    if (!Number.isFinite(requested)) {
      void feedback.emit('boundary')
      return
    }
    const bounded = Math.max(0, Math.min(book.pageCount, requested))
    if (requested !== bounded) void feedback.emit('boundary')
    else if (bounded !== book.currentPage) void feedback.emit('selection')
    setCurrentPage(book.id, bounded)
  }

  const rateBook = (id: string, rating: number) => {
    if (books.find((book) => book.id === id)?.rating !== rating) void feedback.emit('selection')
    updateBook(id, { rating })
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
    moveToShelf(id, 'finished', 'completion')
    openSheet({ kind: 'finished', bookId: id })
  }

  const handleDnf = (id: string) => {
    const book = books.find((item) => item.id === id)
    moveWithUndo(id, 'dnf', `${book?.title ?? 'Book'} moved to DNF`)
  }

  const saveUpNextSettings = async (
    mode: typeof upNext.mode,
    preferences: typeof upNext.preferences,
  ) => {
    try {
      await saveUpNextPreferences(mode, preferences)
    } catch {
      setToast({ message: 'Could not save reading preferences. Please try again.' })
      return
    }
    closeSheet()
    setToast({
      message: mode === 'manual'
        ? 'TBR recommendations turned off'
        : 'Reading preferences saved on this device',
    })
  }

  const saveCustomShelf = (draft: ShelfDraft, orderedBookIds: readonly string[]) => {
    const shelfId = saveShelf(draft)
    setShelfMembersInOrder(shelfId, orderedBookIds)
    closeSheet()
    setToast({ message: draft.id ? 'Custom shelf saved; reading statuses unchanged' : 'Custom shelf created' })
  }

  const dropLibraryBook = (bookId: string, target: LibraryDropTarget) => {
    const book = books.find(({ id }) => id === bookId)
    if (!book || target.beforeBookId === bookId) return
    if (target.kind === 'status') {
      if (target.id === 'next' && book.shelf === 'next') {
        const ids = libraryViewModel.orderedNextBooks.map(({ id }) => id)
        const beforeIndex = ids.indexOf(target.beforeBookId ?? '')
        const sourceIndex = ids.indexOf(bookId)
        const targetIndex = beforeIndex < 0 ? ids.length - 1 : beforeIndex - Number(sourceIndex < beforeIndex)
        moveQueueBook(bookId, targetIndex, ids)
        return
      }
      moveWithUndo(bookId, target.id, `${book.title} moved to ${shelfCopy[target.id].label}`)
      return
    }
    const shelf = organization.shelves.find(({ id, archived }) => id === target.id && !archived)
    if (!shelf) return
    const previous = orderedShelfEntries(organization, shelf.id).map(({ bookId: id }) => id)
    const next = previous.filter((id) => id !== bookId)
    const beforeIndex = next.indexOf(target.beforeBookId ?? '')
    next.splice(beforeIndex < 0 ? next.length : beforeIndex, 0, bookId)
    if (next.every((id, index) => id === previous[index]) && next.length === previous.length) return
    setShelfMembersInOrder(shelf.id, next)
    setToast({
      message: previous.includes(bookId) ? `${book.title} reordered in ${shelf.name}` : `${book.title} added to ${shelf.name}`,
      undo: () => {
        setShelfMembersInOrder(shelf.id, previous)
        setToast({ message: 'Shelf change undone', family: 'undo' })
      },
    })
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
      {incomingFileOpening && <IncomingFileOpening state={incomingFileOpening} />}
      <UpgradeDialog open={upgradeOpen} onClose={() => setUpgradeOpen(false)} view={purchaseView} bookCount={books.length} />
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
            libraryHydrated={libraryHydrated}
            organization={organization}
            appearance={appearance}
            viewModel={libraryViewModel}
            shelfMotion={shelfMotion}
            coverEnrichmentStatus={coverEnrichmentStatus}
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
            onDropBook={dropLibraryBook}
            onNext={handleNext}
            onStart={handleStart}
            onFinish={handleFinish}
            onDnf={handleDnf}
            onRate={rateBook}
            onMoveQueueBook={moveQueueBook}
          />
        ) : view === 'import' && importPreview ? (
          <ImportReviewPage
            key={importPreview.id}
            preview={importPreview}
            books={books}
            busy={importBusy}
            progress={importProgress}
            error={importError}
            onBack={importProgress?.stage === 'complete' ? () => setView('library') : showSettings}
            onCommit={commitImport}
          />
        ) : (
          <SettingsPage
            libby={<LibbySettings controller={libby} books={books} reveal={revealLibby} onRevealed={() => setRevealLibby(false)} />}
            purchaseView={purchaseView}
            onUpgrade={() => { setUpgradeOpen(true); void purchases.refresh() }}
            books={books}
            appearance={appearance}
            searchPreferences={searchPreferences}
            systemMediaPreferences={systemMediaPreferences}
            feedbackPreferences={feedbackPreferences}
            importHistory={importHistory}
            importBusy={importBusy}
            importError={importError}
            epubImport={epubImport}
            epubBusy={epubBusy}
            epubStorage={epubStorage}
            audiobookImport={audiobookImport}
            audiobookBusy={audiobookBusy}
            exportBusy={exportBusy}
            exportError={exportError}
            recovery={recovery}
            onBack={showLibrary}
            onAppearanceChange={setAppearance}
            onSearchPreferencesChange={setSearchPreferences}
            onSystemMediaPreferencesChange={setSystemMediaPreferences}
            onFeedbackPreferencesChange={changeFeedbackPreferences}
            onImportFile={(file) => { void handleImportFile(file) }}
            onOpenGoodreadsExport={() => {
              window.open('https://www.goodreads.com/review/import', '_blank', 'noopener,noreferrer')
            }}
            onImportEpubFiles={(files) => {
              void importEpubSources(files.map((file) => () => epubSourceFromFile(file)))
            }}
            onCancelEpubImport={() => epubAbortRef.current?.abort()}
            onRefreshEpubStorage={() => { void refreshEpubStorage() }}
            onPreviewEpubCleanup={(assetIds) => { void previewEpubCleanup(assetIds) }}
            onConfirmEpubCleanup={() => { void confirmEpubCleanup() }}
            onCancelEpubReview={cancelEpubReview}
            onPrepareAudiobookFiles={(files) => { void prepareAudiobookFiles(files) }}
            onCommitAudiobook={(review) => { void commitAudiobook(review) }}
            onCancelAudiobookImport={() => audiobookAbortRef.current?.abort()}
            onDismissAudiobookImport={dismissAudiobookImport}
            onUndoImport={(batchId) => { void undoImportBatch(batchId) }}
            onExport={(format, includeAnnotations, includeEpubFiles) => { void handleExport(format, includeAnnotations, includeEpubFiles) }}
            onRecoveryFile={(file) => { void handleRecoveryFile(file) }}
            onCreateRecoveryPoint={() => { void createRecoveryPoint() }}
            onRestoreBackup={() => { void restoreBackup() }}
            onClearBooks={() => {
              clearBooks()
              setToast({ message: 'Development library cleared' })
            }}
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
          onProgress={(progress) => updateReadingProgress(selectedBook, progress)}
          onPage={(page) => updateReadingPage(selectedBook, page)}
          onFinish={() => handleFinish(selectedBook.id)}
        />
      )}
      {sheet?.kind === 'finished' && selectedBook && (
        <FinishedSheet book={selectedBook} onClose={closeSheet} onRate={(rating) => rateBook(selectedBook.id, rating)} />
      )}
      {sheet?.kind === 'detail' && selectedBook && (
        <DetailSheet
          book={selectedBook}
          libby={<LibbyBookLink key={selectedBook.id} book={selectedBook} controller={libby} onSettings={() => { showSettings(); setRevealLibby(true) }} />}
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
              setToast({ message: `Moved to ${shelfCopy[targetShelf].label}` })
            }
          }}
          onProgress={() => openSheet({ kind: 'progress', bookId: selectedBook.id })}
          onRead={() => openBookMedia(selectedBook)}
          onFinish={() => handleFinish(selectedBook.id)}
          onRate={(rating) => updateBook(selectedBook.id, { rating })}
          onNotes={(notes) => updateBook(selectedBook.id, { notes })}
          onMetadata={(changes) => {
            updateBook(selectedBook.id, changes)
            setToast({ message: 'Local book details saved as your preferred values' })
          }}
          onCover={(thumbnail) => {
            const resolvedPendingCover = !selectedBook.thumbnail
              && selectedBook.sourceNames?.includes('Goodreads')
            updateBook(selectedBook.id, { thumbnail })
            if (resolvedPendingCover) {
              setCoverEnrichmentStatus((current) => {
                if (!current) return current
                const pending = Math.max(0, current.pending - 1)
                return pending ? { ...current, pending } : undefined
              })
            }
            setToast({ message: 'Cover updated and kept on this device' })
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
            beginShelfMotion(selectedBook.id, selectedBook.shelf, undefined)
            removeBook(selectedBook.id)
            removeQueueBook(selectedBook.id)
            closeSheet()
            setToast({ message: 'Removed from your library' })
          }}
          onAttachEpub={(files, overwriteCover) => {
            void importEpubSources(
              files.map((file) => () => epubSourceFromFile(file)),
              selectedBook.id,
              overwriteCover,
            )
          }}
          onAttachAudiobook={(files, overwriteCover) => { void attachAudiobookFiles(selectedBook, files, overwriteCover) }}
          epubBusy={epubBusy}
          epubImport={epubImport}
          audiobookBusy={audiobookBusy}
          audiobookImport={audiobookImport}
        />
      )}
      {sheet?.kind === 'audiobook-player' && selectedBook && (
        <Sheet title="Audiobook player" onClose={closeSheet} tall>
          <AudiobookPlayer key={selectedBook.id} book={selectedBook} onChooseFile={Capacitor.isNativePlatform() ? () => {
            const book = selectedBook
            closeSheet()
            void pickOriginalFiles('audio').then((files) => {
              if (files.length) return prepareAudiobookSources(() => audiobookSourcesFromFiles(files), book, false, true)
            }).catch((error: unknown) => setToast({ message: error instanceof Error ? error.message : 'The audio could not be opened.' }))
          } : undefined} />
        </Sheet>
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
      {FEATURES.smartLists && sheet?.kind === 'smart-list' && (
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
        <Sheet title="Reading suggestions" onClose={closeSheet} tall>
          <RecommendationSettings
            state={upNext}
            books={books}
            tags={organization.tags.map(({ name }) => name)}
            onSave={saveUpNextSettings}
            onRestoreSuggestion={restoreSuggestion}
            onRestoreReason={(criterion) => setReasonState(criterion, 'neutral')}
          />
        </Sheet>
      )}
      {sheet?.kind === 'recommendation' && (() => {
        const suggestion = libraryViewModel.upNextSuggestions.suggestions.find(({ book }) => book.id === sheet.bookId)
        return <Sheet title="Why this book?" onClose={closeSheet}>
          {suggestion ? <RecommendationDetails suggestion={suggestion}
            onQueue={() => { handleNext(suggestion.book.id); closeSheet() }}
            onDismiss={() => { dismissSuggestion(suggestion.book.id); closeSheet() }}
            onManage={() => setSheet({ kind: 'up-next' })}
            onReasonState={setReasonState}
          /> : <p>This suggestion has changed. Check your TBR for the latest picks.</p>}
        </Sheet>
      })()}
      {originalRecovery && <Sheet title="Choose the original file" onClose={() => setOriginalRecovery(undefined)}>
        <div className={tw('reader-recovery')}>
          <span className={tw('reader-recovery__mark')} aria-hidden="true"><AlertTriangle /></span>
          <div className={tw('reader-recovery__copy')}>
            <h3>{originalRecovery.name}</h3>
            <p>Wovenleaf could not access this file. Choose it below to allow access and open it.</p>
          </div>
          <button type="button" className={tw('primary-button')} onClick={() => {
            const kind = originalRecovery.kind
            setOriginalRecovery(undefined)
            void pickOriginalFiles(kind).then(async (files) => {
              if (!files.length) return
              if (kind === 'ebook') await importEpubSources(files.map((file) => () => epubSourceFromFile(file)), undefined, false, true)
              else await prepareAudiobookSources(() => audiobookSourcesFromFiles(files), undefined, false, true)
            }).catch((error: unknown) => setToast({ message: error instanceof Error ? error.message : 'The file could not be opened.' }))
          }}>Choose file</button>
          <button type="button" onClick={() => setOriginalRecovery(undefined)}>Cancel</button>
        </div>
      </Sheet>}
      {readerRecovery && (
        <ReaderRecoverySheet
          recovery={readerRecovery}
          onClose={() => setReaderRecovery(undefined)}
          onRetry={() => void openReader(readerRecovery.bookId)}
          onChooseFile={Capacitor.isNativePlatform() ? () => {
            const bookId = readerRecovery.bookId
            void pickOriginalFiles('ebook').then(async (files) => {
              if (!files.length) return
              setReaderRecovery(undefined)
              await importEpubSources(files.map((file) => () => epubSourceFromFile(file)), bookId, false, true)
            }).catch((error: unknown) => setToast({ message: error instanceof Error ? error.message : 'The file could not be opened.' }))
          } : undefined}
        />
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
            setToast({ message: `Moved to ${shelfCopy[targetShelf].label}` })
          }
        }}
      />
    </div>
  )
}

function resultToastMessage(result: EpubImportResult): string {
  if (result.outcome === 'duplicate') return `${result.title} is already safely managed`
  if (result.outcome === 'revision') return `Revised book linked to ${result.title}`
  return `${result.title} added from a verified book file`
}

function audiobookResultToastMessage(result: { readonly outcome: string; readonly title: string }): string {
  if (result.outcome === 'duplicate') return `${result.title} is already safely managed`
  if (result.outcome === 'revision') return `Revised audiobook linked to ${result.title} without losing progress`
  return `${result.title} is ready as one audiobook`
}

function formatStorageBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_048_576) return `${Math.ceil(bytes / 1_024)} KB`
  return `${(bytes / 1_048_576).toFixed(1)} MB`
}

function isZipContainer(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
}

function readerBookIdFromUrl(value: string): string | undefined {
  try {
    const url = new URL(value)
    if (url.protocol !== 'wovenleaf:' || !['reader', 'read'].includes(url.hostname)) return undefined
    return url.searchParams.get('book') ?? undefined
  } catch {
    return undefined
  }
}

export default App
