import { libraryBookSchema } from '../../src/library-model'
import { LibraryRepository } from '../../src/storage/library-repository'
import type { SqlDatabase } from '../../src/storage/database'

export function capacityBook(number: number) {
  return libraryBookSchema.parse({
    id: `capacity-${number}`, title: `Capacity book ${number}`, authors: ['A Reader'],
    pageCount: 100, shelf: 'tbr', progress: 0, currentPage: 0, rating: 0, notes: '',
    addedAt: '2026-09-08T12:00:00.000Z', lastUpdatedAt: '2026-09-08T12:00:00.000Z',
  })
}

export async function seedLibrary(database: SqlDatabase, count = 30) {
  const library = new LibraryRepository(database)
  await library.replace(Array.from({ length: count }, (_, i) => capacityBook(i + 1)))
  return { library }
}
