import { useCallback, useEffect, useState } from 'react'

export type ShelfId = 'tbr' | 'next' | 'reading' | 'finished'

export type LibraryBook = {
  id: string
  title: string
  authors: string[]
  thumbnail?: string
  pageCount: number
  shelf: ShelfId
  progress: number
  currentPage: number
  rating: number
  notes: string
  addedAt: string
  startedAt?: string
  finishedAt?: string
  lastUpdatedAt: string
}

export type BookSearchResult = Pick<
  LibraryBook,
  'id' | 'title' | 'authors' | 'thumbnail' | 'pageCount'
>

export const SHELVES: Array<{ id: ShelfId; label: string; shortLabel: string }> = [
  { id: 'tbr', label: 'To Be Read', shortLabel: 'TBR' },
  { id: 'next', label: 'Up Next', shortLabel: 'Next' },
  { id: 'reading', label: 'Reading', shortLabel: 'Reading' },
  { id: 'finished', label: 'Finished', shortLabel: 'Done' },
]

const STORAGE_KEY = 'bookmanager.library.v1'
const now = new Date().toISOString()

const starterLibrary: LibraryBook[] = [
  {
    id: 'starter-will-of-the-many',
    title: 'The Will of the Many',
    authors: ['James Islington'],
    pageCount: 639,
    shelf: 'tbr',
    progress: 0,
    currentPage: 0,
    rating: 0,
    notes: '',
    addedAt: now,
    lastUpdatedAt: now,
  },
  {
    id: 'starter-mistborn',
    title: 'Mistborn',
    authors: ['Brandon Sanderson'],
    pageCount: 541,
    shelf: 'tbr',
    progress: 0,
    currentPage: 0,
    rating: 0,
    notes: '',
    addedAt: now,
    lastUpdatedAt: now,
  },
  {
    id: 'starter-assassins-apprentice',
    title: "Assassin's Apprentice",
    authors: ['Robin Hobb'],
    pageCount: 448,
    shelf: 'next',
    progress: 0,
    currentPage: 0,
    rating: 0,
    notes: '',
    addedAt: now,
    lastUpdatedAt: now,
  },
  {
    id: 'starter-vita-nostra',
    title: 'Vita Nostra',
    authors: ['Marina & Sergey Dyachenko'],
    pageCount: 416,
    shelf: 'next',
    progress: 0,
    currentPage: 0,
    rating: 0,
    notes: '',
    addedAt: now,
    lastUpdatedAt: now,
  },
  {
    id: 'starter-tainted-cup',
    title: 'The Tainted Cup',
    authors: ['Robert Jackson Bennett'],
    pageCount: 400,
    shelf: 'reading',
    progress: 67,
    currentPage: 268,
    rating: 0,
    notes: 'Loving the atmosphere and the layered world-building.',
    addedAt: now,
    startedAt: now,
    lastUpdatedAt: now,
  },
  {
    id: 'starter-blade-itself',
    title: 'The Blade Itself',
    authors: ['Joe Abercrombie'],
    pageCount: 515,
    shelf: 'reading',
    progress: 31,
    currentPage: 160,
    rating: 0,
    notes: '',
    addedAt: now,
    startedAt: now,
    lastUpdatedAt: now,
  },
  {
    id: 'starter-jonathan-strange',
    title: 'Jonathan Strange & Mr Norrell',
    authors: ['Susanna Clarke'],
    pageCount: 1006,
    shelf: 'finished',
    progress: 100,
    currentPage: 1006,
    rating: 5,
    notes: '',
    addedAt: now,
    finishedAt: now,
    lastUpdatedAt: now,
  },
  {
    id: 'starter-piranesi',
    title: 'Piranesi',
    authors: ['Susanna Clarke'],
    pageCount: 272,
    shelf: 'finished',
    progress: 100,
    currentPage: 272,
    rating: 4,
    notes: '',
    addedAt: now,
    finishedAt: now,
    lastUpdatedAt: now,
  },
]

function readLibrary() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (!saved) return starterLibrary
    const parsed = JSON.parse(saved) as unknown
    return Array.isArray(parsed) ? (parsed as LibraryBook[]) : starterLibrary
  } catch {
    return starterLibrary
  }
}

export function useLibrary() {
  const [books, setBooks] = useState<LibraryBook[]>(readLibrary)

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(books))
  }, [books])

  const updateBook = useCallback((id: string, changes: Partial<LibraryBook>) => {
    setBooks((current) =>
      current.map((book) =>
        book.id === id
          ? { ...book, ...changes, lastUpdatedAt: new Date().toISOString() }
          : book,
      ),
    )
  }, [])

  const addBook = useCallback((result: BookSearchResult, shelf: ShelfId) => {
    let wasExisting = false
    setBooks((current) => {
      const existing = current.find((book) => book.id === result.id)
      if (existing) {
        wasExisting = true
        return current.map((book) =>
          book.id === result.id
            ? {
                ...book,
                shelf,
                startedAt: shelf === 'reading' ? book.startedAt ?? new Date().toISOString() : book.startedAt,
                lastUpdatedAt: new Date().toISOString(),
              }
            : book,
        )
      }

      const timestamp = new Date().toISOString()
      return [
        ...current,
        {
          ...result,
          shelf,
          progress: shelf === 'finished' ? 100 : 0,
          currentPage: shelf === 'finished' ? result.pageCount : 0,
          rating: 0,
          notes: '',
          addedAt: timestamp,
          startedAt: shelf === 'reading' ? timestamp : undefined,
          finishedAt: shelf === 'finished' ? timestamp : undefined,
          lastUpdatedAt: timestamp,
        },
      ]
    })
    return wasExisting
  }, [])

  const moveBook = useCallback((id: string, shelf: ShelfId) => {
    setBooks((current) =>
      current.map((book) => {
        if (book.id !== id) return book
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
      }),
    )
  }, [])

  const setProgress = useCallback((id: string, progress: number) => {
    setBooks((current) =>
      current.map((book) => {
        if (book.id !== id) return book
        const boundedProgress = Math.max(0, Math.min(99, Math.round(progress)))
        return {
          ...book,
          progress: boundedProgress,
          currentPage: book.pageCount
            ? Math.round((book.pageCount * boundedProgress) / 100)
            : book.currentPage,
          lastUpdatedAt: new Date().toISOString(),
        }
      }),
    )
  }, [])

  const setCurrentPage = useCallback((id: string, page: number) => {
    setBooks((current) =>
      current.map((book) => {
        if (book.id !== id || !book.pageCount) return book
        const boundedPage = Math.max(0, Math.min(book.pageCount, Math.round(page)))
        return {
          ...book,
          currentPage: boundedPage,
          progress: Math.min(99, Math.round((boundedPage / book.pageCount) * 100)),
          lastUpdatedAt: new Date().toISOString(),
        }
      }),
    )
  }, [])

  const finishBook = useCallback((id: string) => moveBook(id, 'finished'), [moveBook])

  const removeBook = useCallback((id: string) => {
    setBooks((current) => current.filter((book) => book.id !== id))
  }, [])

  return {
    books,
    addBook,
    updateBook,
    moveBook,
    setProgress,
    setCurrentPage,
    finishBook,
    removeBook,
  }
}
