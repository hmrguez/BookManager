import { describe, expect, test } from 'bun:test'
import { LibraryUpgradeRequired, type PurchaseOutcome, type PurchaseStatus, type PurchaseStore } from '../src/purchases/model'
import { PurchaseService } from '../src/purchases/service'
import { setLibraryCapacityPolicy } from '../src/purchases/capacity'
import { LibraryRepository } from '../src/storage/library-repository'
import { ImportRepository } from '../src/storage/import-repository'
import { PortableArchiveService } from '../src/storage/portable-archive'
import { migrateStorage } from '../src/storage/migrations'
import { BunSqliteDatabase } from './storage-test-database'
import { capacityBook, seedFreeLibrary } from './fixtures/purchases'

class Store implements PurchaseStore {
  status: PurchaseStatus = { platform: 'ios', owned: false, available: true, pending: false, price: '€10.00' }
  outcome: PurchaseOutcome = 'cancelled'
  failure = false
  calls = 0
  async getStatus() {
    if (this.failure) throw new Error('Offline')
    return this.status
  }
  async purchase() { this.calls++; return { outcome: this.outcome } }
  async restore() { return this.getStatus() }
  async redeem() { }
}

describe('permanent store purchase', () => {
  test('does not lose an external purchase update during an older status request', async () => {
    const store = new Store()
    let finishOld: (status: PurchaseStatus) => void = () => {}
    let requests = 0
    store.getStatus = () => ++requests === 1
      ? new Promise((resolve) => { finishOld = resolve }) : Promise.resolve(store.status)
    const service = new PurchaseService(store, 'ios')
    const old = service.refresh()
    const update = service.refreshAfterChange()
    store.status = { ...store.status, owned: true }
    finishOld({ ...store.status, owned: false })
    await Promise.all([old, update])
    expect(requests).toBe(2)
    expect(service.getSnapshot().owned).toBe(true)
  })
  test.each(['cancelled', 'pending', 'purchased'] as const)('%s alone never grants access without a store entitlement', async (outcome) => {
    const store = new Store()
    store.outcome = outcome
    const service = new PurchaseService(store, 'ios')
    await service.refresh()
    await service.purchase()
    expect(service.getSnapshot().owned).toBe(false)
    await expect(service.assertCapacity(30, 31, 1)).rejects.toBeInstanceOf(LibraryUpgradeRequired)
  })

  test('restores ownership and removes it when the store reports a refund/account change', async () => {
    const store = new Store()
    const service = new PurchaseService(store, 'ios')
    store.status = { ...store.status, owned: true }
    await service.restore()
    await expect(service.assertCapacity(30, 31, 1)).resolves.toBeUndefined()
    store.status = { ...store.status, owned: false }
    await service.refresh()
    await expect(service.assertCapacity(30, 31, 1)).rejects.toBeInstanceOf(LibraryUpgradeRequired)
  })

  test('retains known ownership on transport failure but never unlocks an unknown customer', async () => {
    const store = new Store()
    store.status = { ...store.status, owned: true, available: false }
    const service = new PurchaseService(store, 'ios')
    await service.refresh()
    store.failure = true
    await service.refresh()
    expect(service.getSnapshot().owned).toBe(true)
    const fresh = new PurchaseService(store, 'ios')
    await expect(fresh.assertCapacity(30, 31, 1)).rejects.toBeInstanceOf(LibraryUpgradeRequired)
    expect(fresh.getSnapshot().owned).toBe(false)
  })

  test('serializes rapid purchase taps and keeps errors recoverable', async () => {
    const store = new Store()
    const service = new PurchaseService(store, 'ios')
    await service.refresh()
    await Promise.all([service.purchase(), service.purchase(), service.purchase()])
    expect(store.calls).toBe(1)
    store.failure = true
    await service.restore()
    expect(service.getSnapshot().busy).toBe(false)
    expect(service.getSnapshot().error).toBeDefined()
    store.failure = false
    await service.restore()
    expect(service.getSnapshot().error).toBeUndefined()
  })
})

describe('shared library capacity boundary', () => {
  test('a trusted recovery rollback can preserve an oversized library without granting a purchase', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const library = new LibraryRepository(database)
    await library.replace(Array.from({ length: 35 }, (_, i) => capacityBook(i + 1)))
    const archives = new PortableArchiveService(database)
    const rollback = await archives.create()
    const service = new PurchaseService(new Store(), 'ios')
    setLibraryCapacityPolicy(database, service.assertCapacity)
    await library.replace([capacityBook(1)])
    await expect(archives.restore(rollback.archive)).rejects.toBeInstanceOf(LibraryUpgradeRequired)
    await archives.restore(rollback.archive, { trustedRecoveryRollback: true })
    expect(await library.list()).toHaveLength(35)
    await expect(library.save(capacityBook(36))).rejects.toBeInstanceOf(LibraryUpgradeRequired)
    expect(service.getSnapshot().owned).toBe(false)
    await database.close()
  })
  test('allows book 30, rejects 31, permits edits and frees a slot on deletion', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const { library } = await seedFreeLibrary(database, 29)
    await library.save(capacityBook(30))
    await expect(library.save(capacityBook(31))).rejects.toBeInstanceOf(LibraryUpgradeRequired)
    expect(await library.list()).toHaveLength(30)
    await library.save({ ...capacityBook(1), shelf: 'finished', notes: 'Still editable' })
    await library.remove(capacityBook(2).id)
    await library.save(capacityBook(31))
    expect(await library.list()).toHaveLength(30)
    await database.close()
  })

  test('rolls back the entire CSV batch and its receipts, then retries after purchasing', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const { library, store, purchases } = await seedFreeLibrary(database, 29)
    const imports = new ImportRepository(database)
    const preview = await imports.previewCsv('library.csv', 'external_id,title,authors,shelf\na,First addition,A Reader,tbr\nb,Second addition,A Reader,tbr')
    await expect(imports.commit(preview.id)).rejects.toBeInstanceOf(LibraryUpgradeRequired)
    expect(await library.list()).toHaveLength(29)
    expect(await database.query('SELECT * FROM import_row_receipts')).toHaveLength(0)
    expect(await database.query('SELECT * FROM import_changes')).toHaveLength(0)
    expect((await imports.readPreview(preview.id)).id).toBe(preview.id)
    store.owned = true
    await purchases.restore()
    await imports.commit(preview.id)
    expect(await library.list()).toHaveLength(31)
    await database.close()
  })

  test('checks archive replacement before deleting any existing library data', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const { library } = await seedFreeLibrary(database, 30)
    const before = await library.list()
    await expect(library.replace([...before, capacityBook(31)])).rejects.toBeInstanceOf(LibraryUpgradeRequired)
    expect(await library.list()).toEqual(before)
    await library.replace(before)
    expect(await library.list()).toEqual(before)
    await database.close()
  })

  test('keeps an existing oversized library readable/editable and gates only new entries', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const library = new LibraryRepository(database)
    await library.replace(Array.from({ length: 35 }, (_, i) => capacityBook(i + 1)))
    const service = new PurchaseService(new Store(), 'ios')
    setLibraryCapacityPolicy(database, service.assertCapacity)
    await library.save({ ...capacityBook(1), notes: 'Kept after refund' })
    await expect(library.save(capacityBook(36))).rejects.toBeInstanceOf(LibraryUpgradeRequired)
    await expect(library.replace(Array.from({ length: 34 }, (_, i) => capacityBook(i + 100)))).rejects.toBeInstanceOf(LibraryUpgradeRequired)
    expect(await library.list()).toHaveLength(35)
    await database.close()
  })
})
