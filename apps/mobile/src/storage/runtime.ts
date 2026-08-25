import { createStarterLibrary } from '../library-model'
import { openCapacitorDatabase } from './capacitor-database'
import { CatalogRepository, ReadingLedgerRepository } from './catalog-repository'
import type { SqlDatabase } from './database'
import { installDevelopmentInspector } from './inspection'
import { LibraryRepository } from './library-repository'
import { createMigrationBackupStore } from './migration-backup'
import { migrateStorage } from './migrations'
import { CatalogQueryService } from './query-services'

export type StorageRuntime = {
  readonly database: SqlDatabase
  readonly catalog: CatalogRepository
  readonly readingLedger: ReadingLedgerRepository
  readonly library: LibraryRepository
  readonly queries: CatalogQueryService
}

let runtimePromise: Promise<StorageRuntime> | undefined

export function getStorageRuntime(): Promise<StorageRuntime> {
  runtimePromise ??= initializeStorageRuntime()
  return runtimePromise
}

async function initializeStorageRuntime(): Promise<StorageRuntime> {
  const database = await openCapacitorDatabase()
  await migrateStorage(database, { backupStore: createMigrationBackupStore() })
  const library = new LibraryRepository(database)
  await library.seedIfEmpty(createStarterLibrary())
  const queries = new CatalogQueryService(database)
  installDevelopmentInspector(database, queries)

  return {
    database,
    catalog: new CatalogRepository(database),
    readingLedger: new ReadingLedgerRepository(database),
    library,
    queries,
  }
}
