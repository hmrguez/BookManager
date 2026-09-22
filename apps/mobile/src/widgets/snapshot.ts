import type { LibraryBook } from '../library-model'
import { readActivity } from './activity'
import { readLibraryBooks } from '../storage/library-repository'
import type { SqlDatabase } from '../storage/database'

export function usesPages(book: LibraryBook, source?: string): boolean {
  if (book.pageCount <= 0) return false
  if (source === 'manual-page') return true
  if (source === 'manual-percent' || source === 'audio-player' || source === 'libby') return false
  return !/epub|ebook|e-book|audiobook/i.test(book.format ?? '')
}

export function widgetBooks(books: readonly LibraryBook[], recent: ReadonlyMap<string, string>, sources: ReadonlyMap<string, string> = new Map()) {
  return books.filter((book) => book.shelf === 'reading').sort((a, b) =>
    (recent.get(b.id) ?? '').localeCompare(recent.get(a.id) ?? '')
    || (b.startedAt ?? b.addedAt).localeCompare(a.startedAt ?? a.addedAt)
    || a.id.localeCompare(b.id),
  ).map((book) => ({
    id: book.id, lastActivity: recent.get(book.id) ?? '', title: book.title, author: book.authors.join(', '),
    progress: book.progress, currentPage: book.currentPage, pageCount: book.pageCount,
    thumbnail: book.thumbnail ?? '',
    progressLabel: usesPages(book, sources.get(book.id)) ? `Page ${book.currentPage} of ${book.pageCount}` : `${book.progress}%`,
    url: `wovenleaf://widgets/reading?book=${encodeURIComponent(book.id)}`,
  }))
}

export async function widgetSnapshot(database: SqlDatabase) {
  const books = await readLibraryBooks(database)
  const activity = await readActivity(database)
  return { version: 1, books: widgetBooks(books, activity.recent, activity.sources), days: activity.days }
}

export function widgetRoute(raw: string): { bookId?: string; streak: boolean } | undefined {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'wovenleaf:' || url.hostname !== 'widgets') return undefined
    if (url.pathname !== '/reading' && url.pathname !== '/streak') return undefined
    return { bookId: url.searchParams.get('book') || undefined, streak: url.pathname === '/streak' }
  } catch { return undefined }
}
