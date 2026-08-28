import { createStarterLibrary } from '../library-model'
import { AudiobookImportService } from '../audiobooks'
import { EpubImportService } from '../epub'
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
import { MetadataSearchCacheRepository } from './metadata-search-cache'
import { createMigrationBackupStore } from './migration-backup'
import { migrateStorage } from './migrations'
import { OrganizationRepository } from './organization-repository'
import { PortableArchiveService } from './portable-archive'
import { CatalogQueryService } from './query-services'
import { RecoveryService, type RecoveryLaunchResult } from './recovery'
import { SmartListRepository } from './smart-list-repository'
import { UpNextRepository } from './up-next-repository'
import { EpubReaderService } from '../reader'
import { AudiobookPlaybackService } from '../playback'

export type StorageRuntime = {
  readonly database: SqlDatabase
  readonly catalog: CatalogRepository
  readonly readingLedger: ReadingLedgerRepository
  readonly duplicateReviews: DuplicateReviewRepository
  readonly library: LibraryRepository
  readonly metadataSearchCache: MetadataSearchCacheRepository
  readonly organization: OrganizationRepository
  readonly smartLists: SmartListRepository
  readonly upNext: UpNextRepository
  readonly imports: ImportRepository
  readonly audiobooks: AudiobookImportService
  readonly epubs: EpubImportService
  readonly reader: EpubReaderService
  readonly playback: AudiobookPlaybackService
  readonly portableArchives: PortableArchiveService
  readonly recovery: RecoveryService
  readonly recoveryLaunch: RecoveryLaunchResult
  readonly recoveryWarning?: string
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
  const recovery = new RecoveryService(database)
  const recoveryLaunch = await recovery.beginPendingLaunch()
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
  installDevelopmentInspector(database, queries, recovery)

  await Promise.all([
    new CatalogRepository(database).read(),
    library.list(),
    new OrganizationRepository(database).read(),
    new SmartListRepository(database).read(),
    new UpNextRepository(database).read(),
  ])
  await recovery.confirmPendingLaunch()
  let recoveryWarning: string | undefined
  try {
    await recovery.ensureAutomaticSnapshot()
  } catch (error) {
    recoveryWarning = error instanceof Error ? error.message : String(error)
  }

  const readingLedger = new ReadingLedgerRepository(database)
  return {
    database,
    catalog: new CatalogRepository(database),
    readingLedger,
    duplicateReviews: new DuplicateReviewRepository(database),
    library,
    metadataSearchCache: new MetadataSearchCacheRepository(database),
    organization: new OrganizationRepository(database),
    smartLists: new SmartListRepository(database),
    upNext: new UpNextRepository(database),
    imports: new ImportRepository(database),
    audiobooks: new AudiobookImportService(database),
    epubs: new EpubImportService(database),
    reader: new EpubReaderService(database, readingLedger),
    playback: new AudiobookPlaybackService(database),
    portableArchives: new PortableArchiveService(database),
    recovery,
    recoveryLaunch,
    ...(recoveryWarning ? { recoveryWarning } : {}),
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
