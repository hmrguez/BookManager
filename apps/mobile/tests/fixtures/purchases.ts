import { libraryBookSchema } from '../../src/library-model'
import { FREE_BOOK_LIMIT } from '../../src/purchases/model'
import { PurchaseService } from '../../src/purchases/service'
import { setLibraryCapacityPolicy } from '../../src/purchases/capacity'
import { LibraryRepository } from '../../src/storage/library-repository'
import type { SqlDatabase } from '../../src/storage/database'

export function capacityBook(number: number) {
  return libraryBookSchema.parse({
    id: `capacity-${number}`, title: `Capacity book ${number}`, authors: ['A Reader'],
    pageCount: 100, shelf: 'tbr', progress: 0, currentPage: 0, rating: 0, notes: '',
    addedAt: '2026-09-08T12:00:00.000Z', lastUpdatedAt: '2026-09-08T12:00:00.000Z',
  })
}

export async function seedFreeLibrary(database: SqlDatabase, count = FREE_BOOK_LIMIT) {
  const store = { owned: false }
  const purchases = new PurchaseService({
    getStatus: async () => ({ platform: 'ios', owned: store.owned, pending: false, available: true }),
    restore: async () => ({ platform: 'ios', owned: store.owned, pending: false, available: true }),
    purchase: async () => ({ outcome: 'cancelled' }),
    redeem: async () => {},
  }, 'ios')
  const library = new LibraryRepository(database)
  await library.replace(Array.from({ length: count }, (_, i) => capacityBook(i + 1)))
  setLibraryCapacityPolicy(database, purchases.assertCapacity)
  return { library, store, purchases }
}
