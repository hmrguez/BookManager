import { useCallback, useEffect, useRef, useState } from 'react'
import {
  findLibraryBookForSearchResult,
  type BookSearchResult,
  type LibraryBook,
  type ShelfId,
} from './library-model'
import type { LibraryRepository } from './storage/library-repository'
import { getStorageRuntime } from './storage/runtime'

export type { BookSearchResult, LibraryBook, ShelfId } from './library-model'

export const SHELVES: Array<{ id: ShelfId; label: string; shortLabel: string }> = [
  { id: 'tbr', label: 'To Be Read', shortLabel: 'TBR' },
  { id: 'next', label: 'Up Next', shortLabel: 'Next' },
  { id: 'reading', label: 'Reading', shortLabel: 'Reading' },
  { id: 'finished', label: 'Finished', shortLabel: 'Done' },
]

export function useLibrary() {
  const [books, setBooks] = useState<LibraryBook[]>([])
  const [hydrated, setHydrated] = useState(false)
  const [storageError, setStorageError] = useState<string>()
  const [legacyRecoveryAvailable, setLegacyRecoveryAvailable] = useState(false)
  const booksRef = useRef(books)
  const hasMutatedRef = useRef(false)
  const persistenceTailRef = useRef(Promise.resolve())

  const showBooks = useCallback((next: LibraryBook[]) => {
    booksRef.current = next
    setBooks(next)
  }, [])

  const enqueuePersistence = useCallback(
    (operation: (repository: LibraryRepository) => Promise<void>) => {
      persistenceTailRef.current = persistenceTailRef.current
        .then(async () => operation((await getStorageRuntime()).library))
        .catch((error: unknown) => {
          setStorageError(error instanceof Error ? error.message : String(error))
        })
    },
    [],
  )

  useEffect(() => {
    let active = true
    void getStorageRuntime()
      .then(async ({ legacyMigration, library }) => {
        if (legacyMigration.status === 'recovery-required') {
          setLegacyRecoveryAvailable(true)
          setStorageError(legacyMigration.message)
        }
        return library.list()
      })
      .then((persistedBooks) => {
        if (!active) return
        if (!hasMutatedRef.current) showBooks(persistedBooks)
        setHydrated(true)
      })
      .catch((error: unknown) => {
        if (active) {
          setStorageError(error instanceof Error ? error.message : String(error))
          setHydrated(true)
        }
      })
    return () => {
      active = false
    }
  }, [showBooks])

  const saveChangedBook = useCallback(
    (id: string, update: (book: LibraryBook) => LibraryBook) => {
      const current = booksRef.current
      const index = current.findIndex((book) => book.id === id)
      if (index === -1) return
      const changed = update(current[index])
      const next = [...current]
      next[index] = changed
      hasMutatedRef.current = true
      showBooks(next)
      enqueuePersistence((repository) => repository.save(changed))
    },
    [enqueuePersistence, showBooks],
  )

  const updateBook = useCallback(
    (id: string, changes: Partial<LibraryBook>) => {
      saveChangedBook(id, (book) => ({
        ...book,
        ...changes,
        lastUpdatedAt: new Date().toISOString(),
      }))
    },
    [saveChangedBook],
  )

  const addBook = useCallback(
    (result: BookSearchResult, shelf: ShelfId) => {
      const current = booksRef.current
      const existing = findLibraryBookForSearchResult(current, result)
      if (existing) {
        saveChangedBook(existing.id, (book) => ({
          ...book,
          shelf,
          startedAt: shelf === 'reading' ? book.startedAt ?? new Date().toISOString() : book.startedAt,
          lastUpdatedAt: new Date().toISOString(),
        }))
        return { bookId: existing.id, existed: true }
      }

      const timestamp = new Date().toISOString()
      const added: LibraryBook = {
        ...result,
        id: result.metadataSelection ? createLibraryBookId() : result.id,
        shelf,
        progress: shelf === 'finished' ? 100 : 0,
        currentPage: shelf === 'finished' ? result.pageCount : 0,
        rating: 0,
        notes: '',
        addedAt: timestamp,
        startedAt: shelf === 'reading' ? timestamp : undefined,
        finishedAt: shelf === 'finished' ? timestamp : undefined,
        lastUpdatedAt: timestamp,
      }
      hasMutatedRef.current = true
      showBooks([...current, added])
      enqueuePersistence((repository) => repository.save(added))
      return { bookId: added.id, existed: false }
    },
    [enqueuePersistence, saveChangedBook, showBooks],
  )

  const moveBook = useCallback(
    (id: string, shelf: ShelfId) => {
      saveChangedBook(id, (book) => {
        const timestamp = new Date().toISOString()
        return {
          ...book,
          shelf,
          progress: shelf === 'finished' ? 100 : book.progress,
          currentPage: shelf === 'finished' && book.pageCount ? book.pageCount : book.currentPage,
          startedAt: shelf === 'reading' ? book.startedAt ?? timestamp : book.startedAt,
          finishedAt: shelf === 'finished' ? timestamp : undefined,
          lastUpdatedAt: timestamp,
        }
      })
    },
    [saveChangedBook],
  )

  const setProgress = useCallback(
    (id: string, progress: number) => {
      saveChangedBook(id, (book) => {
        const boundedProgress = Math.max(0, Math.min(99, Math.round(progress)))
        return {
          ...book,
          progress: boundedProgress,
          currentPage: book.pageCount
            ? Math.round((book.pageCount * boundedProgress) / 100)
            : book.currentPage,
          lastUpdatedAt: new Date().toISOString(),
        }
      })
    },
    [saveChangedBook],
  )

  const setCurrentPage = useCallback(
    (id: string, page: number) => {
      saveChangedBook(id, (book) => {
        if (!book.pageCount) return book
        const boundedPage = Math.max(0, Math.min(book.pageCount, Math.round(page)))
        return {
          ...book,
          currentPage: boundedPage,
          progress: Math.min(99, Math.round((boundedPage / book.pageCount) * 100)),
          lastUpdatedAt: new Date().toISOString(),
        }
      })
    },
    [saveChangedBook],
  )

  const finishBook = useCallback((id: string) => moveBook(id, 'finished'), [moveBook])

  const removeBook = useCallback(
    (id: string) => {
      const next = booksRef.current.filter((book) => book.id !== id)
      if (next.length === booksRef.current.length) return
      hasMutatedRef.current = true
      showBooks(next)
      enqueuePersistence((repository) => repository.remove(id))
    },
    [enqueuePersistence, showBooks],
  )

  const clearBooks = useCallback(() => {
    const bookIds = booksRef.current.map(({ id }) => id)
    if (bookIds.length === 0) return
    hasMutatedRef.current = true
    showBooks([])
    enqueuePersistence(async (repository) => {
      for (const id of bookIds) await repository.remove(id)
    })
  }, [enqueuePersistence, showBooks])

  const reload = useCallback(async () => {
    await persistenceTailRef.current
    try {
      const persistedBooks = await (await getStorageRuntime()).library.list()
      hasMutatedRef.current = false
      showBooks(persistedBooks)
      setStorageError(undefined)
      return persistedBooks
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setStorageError(message)
      throw error
    }
  }, [showBooks])

  const downloadLegacyRecovery = useCallback(async () => {
    try {
      const recovery = await (await getStorageRuntime()).exportLegacyLibraryRecovery()
      if (!recovery) throw new Error('No legacy recovery copy is available')
      const url = URL.createObjectURL(new Blob([recovery.contents], { type: recovery.mediaType }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = recovery.filename
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : String(error))
    }
  }, [])

  return {
    books,
    hydrated,
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
    clearBooks,
    reload,
  }
}

function createLibraryBookId(): string {
  const unique = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `book:${unique}`
}
