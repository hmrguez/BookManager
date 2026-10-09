import { QuarterlyReviewRepository } from '../reviews/repository'
import { PrivateErasureService } from './private-erasure'
import { LibbyRepository } from '../libby/repository'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { ReviewKeepsakeRepository } from '../reviews/keepsake-repository'
import { reconcileOriginalFiles } from '../files/original-files'
import { AudiobookImportService } from '../audiobooks'
import { EpubImportService } from '../epub'
import { EpubAssetLifecycleService } from '../epub/lifecycle'
import { CapacitorManagedAssetStore } from '../epub/managed-store'
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
import { setLibraryCapacityPolicy } from '../purchases/capacity'
import { purchases, startPurchases } from '../purchases/runtime'

export type StorageRuntime = {
  readonly privateErasure: PrivateErasureService
  readonly database: SqlDatabase
  readonly catalog: CatalogRepository
  readonly readingLedger: ReadingLedgerRepository
  readonly duplicateReviews: DuplicateReviewRepository
  readonly libby: LibbyRepository
  readonly reviewKeepsakes: ReviewKeepsakeRepository
  readonly readingStats: QuarterlyReviewRepository
  readonly library: LibraryRepository
  readonly metadataSearchCache: MetadataSearchCacheRepository
  readonly organization: OrganizationRepository
  readonly smartLists: SmartListRepository
  readonly upNext: UpNextRepository
  readonly imports: ImportRepository
  readonly audiobooks: AudiobookImportService
  readonly epubs: EpubImportService
  readonly epubAssets: EpubAssetLifecycleService
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
  const epubAssetStore = new CapacitorManagedAssetStore()
  const recovery = new RecoveryService(database, { epubAssetStore })
  const recoveryLaunch = await recovery.beginPendingLaunch()
  await migrateStorage(database, { backupStore: createMigrationBackupStore() })
  const evidenceOptions = {
    voiceExists: async (path: string) => {
      if (!/^annotations\/audiobooks\/[\w.:-]+$/.test(path) || path.includes('..')) return false
      return Filesystem.stat({ path, directory: Directory.LibraryNoCloud }).then(file => file.type === 'file', () => false)
    },
  }
  const reviewKeepsakes = new ReviewKeepsakeRepository(database, evidenceOptions)
  const readingStats = new QuarterlyReviewRepository(database, evidenceOptions)
  await reviewKeepsakes.settings()
  const library = new LibraryRepository(database)
  const legacyStorage = getLegacyLibraryStorage()
  const legacyMigration = legacyStorage && !await recovery.hasPendingErasure()
    ? await migrateLegacyLibrary(database, legacyStorage)
    : ({ status: 'not-found' } as const)
  await library.retireUntouchedStarterBooks()
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
  await reconcileOriginalFiles(database).catch(() => undefined)
  let recoveryWarning: string | undefined
  try {
    await recovery.ensureAutomaticSnapshot()
  } catch (error) {
    recoveryWarning = error instanceof Error ? error.message : String(error)
  }

  const readingLedger = new ReadingLedgerRepository(database)
  startPurchases()
  setLibraryCapacityPolicy(database, purchases.assertCapacity)
  return {
    database,
    privateErasure: new PrivateErasureService(database, recovery),
    catalog: new CatalogRepository(database),
    readingLedger,
    duplicateReviews: new DuplicateReviewRepository(database),
    library,
    libby: new LibbyRepository(database),
    reviewKeepsakes,
    readingStats,
    metadataSearchCache: new MetadataSearchCacheRepository(database),
    organization: new OrganizationRepository(database),
    smartLists: new SmartListRepository(database),
    upNext: new UpNextRepository(database),
    imports: new ImportRepository(database),
    audiobooks: new AudiobookImportService(database),
    epubs: new EpubImportService(database, { managedStore: epubAssetStore }),
    epubAssets: new EpubAssetLifecycleService(database, { managedStore: epubAssetStore }),
    reader: new EpubReaderService(database, readingLedger),
    playback: new AudiobookPlaybackService(database),
    portableArchives: new PortableArchiveService(database, { epubAssetStore }),
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
