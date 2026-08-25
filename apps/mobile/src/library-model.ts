import { z } from 'zod'

export const shelfIdSchema = z.enum(['tbr', 'next', 'reading', 'finished'])

export const libraryBookSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  authors: z.array(z.string().min(1)),
  thumbnail: z.url().optional(),
  pageCount: z.number().int().nonnegative(),
  shelf: shelfIdSchema,
  progress: z.number().min(0).max(100),
  currentPage: z.number().int().nonnegative(),
  rating: z.number().int().min(0).max(5),
  notes: z.string(),
  addedAt: z.iso.datetime({ offset: true }),
  startedAt: z.iso.datetime({ offset: true }).optional(),
  finishedAt: z.iso.datetime({ offset: true }).optional(),
  lastUpdatedAt: z.iso.datetime({ offset: true }),
})

export type ShelfId = z.infer<typeof shelfIdSchema>
export type LibraryBook = z.infer<typeof libraryBookSchema>

export type BookSearchResult = Pick<
  LibraryBook,
  'id' | 'title' | 'authors' | 'thumbnail' | 'pageCount'
>

export const STARTER_LIBRARY_BOOK_IDS = [
  'starter-will-of-the-many',
  'starter-mistborn',
  'starter-assassins-apprentice',
  'starter-vita-nostra',
  'starter-tainted-cup',
  'starter-blade-itself',
  'starter-jonathan-strange',
  'starter-piranesi',
] as const

const starterLibraryBookIds = new Set<string>(STARTER_LIBRARY_BOOK_IDS)

export function isStarterLibraryBookId(id: string): boolean {
  return starterLibraryBookIds.has(id)
}

export function createStarterLibrary(timestamp = new Date().toISOString()): LibraryBook[] {
  return libraryBookSchema.array().parse([
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
      addedAt: timestamp,
      lastUpdatedAt: timestamp,
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
      addedAt: timestamp,
      lastUpdatedAt: timestamp,
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
      addedAt: timestamp,
      lastUpdatedAt: timestamp,
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
      addedAt: timestamp,
      lastUpdatedAt: timestamp,
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
      addedAt: timestamp,
      startedAt: timestamp,
      lastUpdatedAt: timestamp,
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
      addedAt: timestamp,
      startedAt: timestamp,
      lastUpdatedAt: timestamp,
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
      addedAt: timestamp,
      finishedAt: timestamp,
      lastUpdatedAt: timestamp,
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
      addedAt: timestamp,
      finishedAt: timestamp,
      lastUpdatedAt: timestamp,
    },
  ])
}
