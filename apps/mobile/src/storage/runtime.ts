import { createStarterLibrary } from '../library-model'
import { openCapacitorDatabase } from './capacitor-database'
import { CatalogRepository, ReadingLedgerRepository } from './catalog-repository'
import type { SqlDatabase } from './database'
import { DuplicateReviewRepository } from './duplicate-review-repository'
import { installDevelopmentInspector } from './inspection'
import { ImportRepository } from './import-repository'
import {
  createLegacyLibraryRecoveryFile,
  migrateLegacyLibrary,
  type LegacyLibraryMigrationResult,
  type LegacyLibraryRecoveryFile,
  type LegacyLibraryStorage,
} from './legacy-library-migration'
import { LibraryRepository } from './library-repository'
import { createMigrationBackupStore } from './migration-backup'
import { migrateStorage } from './migrations'
import { OrganizationRepository } from './organization-repository'
import { PortableArchiveService } from './portable-archive'
import { CatalogQueryService } from './query-services'
import { UpNextRepository } from './up-next-repository'

export type StorageRuntime = {
  readonly database: SqlDatabase
  readonly catalog: CatalogRepository
  readonly readingLedger: ReadingLedgerRepository
  readonly duplicateReviews: DuplicateReviewRepository
  readonly library: LibraryRepository
  readonly organization: OrganizationRepository
  readonly upNext: UpNextRepository
  readonly imports: ImportRepository
  readonly portableArchives: PortableArchiveService
  readonly queries: CatalogQueryService
  readonly legacyMigration: LegacyLibraryMigrationResult
  exportLegacyLibraryRecovery(): Promise<LegacyLibraryRecoveryFile | undefined>
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
  const legacyStorage = getLegacyLibraryStorage()
  const legacyMigration = legacyStorage
    ? await migrateLegacyLibrary(database, legacyStorage)
    : ({ status: 'not-found' } as const)
  if (legacyMigration.status === 'not-found') {
    await library.seedIfEmpty(createStarterLibrary())
  }
  const queries = new CatalogQueryService(database)
  installDevelopmentInspector(database, queries)

  return {
    database,
    catalog: new CatalogRepository(database),
    readingLedger: new ReadingLedgerRepository(database),
    duplicateReviews: new DuplicateReviewRepository(database),
    library,
    organization: new OrganizationRepository(database),
    upNext: new UpNextRepository(database),
    imports: new ImportRepository(database),
    portableArchives: new PortableArchiveService(database),
    queries,
    legacyMigration,
    exportLegacyLibraryRecovery: () =>
      legacyStorage
        ? createLegacyLibraryRecoveryFile(database, legacyStorage)
        : Promise.resolve(undefined),
  }
}

function getLegacyLibraryStorage(): LegacyLibraryStorage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}
