import { assertCredentialFree } from '../security'
import { CatalogRepository } from './catalog-repository'
import type { SqlDatabase, SqlRow } from './database'
import { readText } from './database'
import { readLibraryBooks } from './library-repository'
import { readLibraryOrganization } from './organization-repository'
import {
  PortableArchiveCompatibilityError,
  PortableArchiveIntegrityError,
  PortableArchiveService,
  type PortableArchiveInspection,
} from './portable-archive'
import {
  createRecoveryArtifactStore,
  type PendingRestore,
  type RecoveryArtifactKind,
  type RecoveryArtifactMetadata,
  type RecoveryArtifactStore,
  type StoredRecoveryArtifact,
} from './recovery-store'
import { readSavedSmartLists } from './smart-list-repository'
import { readUpNextState } from './up-next-repository'

export const RECOVERY_ROTATION_LIMIT = 3
export const RECOVERY_SNAPSHOT_INTERVAL_MS = 24 * 60 * 60 * 1_000

export type RecoveryValidationCode =
  | 'ok'
  | 'stale'
  | 'future-version'
  | 'truncated'
  | 'tampered'
  | 'missing-asset'
  | 'low-storage'
  | 'corrupt-database'
  | 'invalid'

export type RecoveryValidation = {
  readonly status: 'valid' | 'warning' | 'invalid'
  readonly code: RecoveryValidationCode
  readonly message: string
}

export type RecoveryBackupPreview = {
  readonly artifactId?: string
  readonly kind?: Exclude<RecoveryArtifactKind, 'staging'>
  readonly createdAt?: string
  readonly formatVersion?: number
  readonly schemaVersion?: number
  readonly byteSize: number
  readonly bookCount?: number
  readonly includedAssetCount: number
  readonly relinkAssetCount: number
  readonly validation: RecoveryValidation
  readonly canRestore: boolean
}

export type RecoveryRestoreResult = {
  readonly preview: RecoveryBackupPreview
  readonly rollbackArtifactId: string
  readonly pendingLaunchConfirmation: true
}

export type RecoveryLaunchResult =
  | { readonly status: 'none' }
  | { readonly status: 'testing-restored-library'; readonly rollbackArtifactId: string }
  | { readonly status: 'rolled-back'; readonly rollbackArtifactId: string }

export type RecoverySupportReport = {
  readonly generatedAt: string
  readonly database: {
    readonly integrity: 'ok' | 'failed'
    readonly schemaVersion: number
  }
  readonly artifacts: readonly {
    readonly id: string
    readonly kind: RecoveryArtifactKind
    readonly createdAt: string
    readonly byteSize: number
    readonly formatVersion: number
    readonly schemaVersion: number
    readonly validationCode: RecoveryValidationCode
  }[]
  readonly pendingRestore?: {
    readonly id: string
    readonly rollbackArtifactId: string
    readonly createdAt: string
    readonly launchAttempted: boolean
  }
}

export type RecoveryServiceOptions = {
  readonly store?: RecoveryArtifactStore
  readonly now?: () => Date
  readonly createId?: (kind: RecoveryArtifactKind | 'restore') => string
  readonly availableBytes?: () => Promise<number | undefined>
}

type SnapshotArtifactMetadata = RecoveryArtifactMetadata & {
  readonly kind: Exclude<RecoveryArtifactKind, 'staging'>
}

export class RecoveryError extends Error {
  readonly code: Exclude<RecoveryValidationCode, 'ok'>

  constructor(code: Exclude<RecoveryValidationCode, 'ok'>, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'RecoveryError'
    this.code = code
  }
}

export class RecoveryService {
  readonly #database: SqlDatabase
  readonly #portableArchives: PortableArchiveService
  readonly #store: RecoveryArtifactStore
  readonly #now: () => Date
  readonly #createId: (kind: RecoveryArtifactKind | 'restore') => string
  readonly #availableBytes: () => Promise<number | undefined>

  constructor(database: SqlDatabase, options: RecoveryServiceOptions = {}) {
    this.#database = database
    this.#portableArchives = new PortableArchiveService(database)
    this.#store = options.store ?? createRecoveryArtifactStore()
    this.#now = options.now ?? (() => new Date())
    this.#createId = options.createId
      ?? ((kind) => `${kind}:${crypto.randomUUID()}`)
    this.#availableBytes = options.availableBytes ?? estimateAvailableBrowserStorage
  }

  async inspectArchive(serializedArchive: string): Promise<RecoveryBackupPreview> {
    const byteSize = utf8ByteSize(serializedArchive)
    try {
      const inspection = await this.#portableArchives.inspect(serializedArchive)
      const stale = await this.#isStale(inspection.manifest.createdAt)
      return previewFromInspection(inspection, byteSize, stale)
    } catch (error) {
      return invalidPreview(byteSize, error)
    }
  }

  async listSnapshots(): Promise<readonly RecoveryBackupPreview[]> {
    const artifacts = (await this.#store.list())
      .filter(isSnapshotArtifact)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    return Promise.all(artifacts.map(async (metadata) => {
      try {
        const artifact = await this.#store.read(metadata.id)
        if (!artifact) throw new Error('Artifact contents are missing')
        const preview = await this.inspectArchive(artifact.archive)
        return {
          ...preview,
          artifactId: metadata.id,
          kind: metadata.kind,
        }
      } catch (error) {
        return {
          artifactId: metadata.id,
          kind: metadata.kind,
          createdAt: metadata.createdAt,
          formatVersion: metadata.formatVersion,
          schemaVersion: metadata.schemaVersion,
          byteSize: metadata.byteSize,
          bookCount: metadata.bookCount,
          includedAssetCount: metadata.includedAssetCount,
          relinkAssetCount: 0,
          validation: validationFromError(error),
          canRestore: false,
        }
      }
    }))
  }

  async createSnapshot(kind: 'automatic' | 'manual' | 'rollback' = 'manual'): Promise<RecoveryBackupPreview> {
    await assertDatabaseHealthy(this.#database)
    const bundle = await this.#portableArchives.create({
      includeAnnotations: true,
      includeSourcePayloads: false,
      createdAt: this.#now().toISOString(),
    })
    const inspection = await this.#portableArchives.inspect(bundle.archive)
    const artifact = artifactFromInspection(
      this.#createId(kind),
      kind,
      bundle.archive,
      inspection,
    )
    await this.#assertCapacity(artifact.byteSize)
    await this.#store.write(artifact)
    await this.#rotate()
    return {
      ...previewFromInspection(inspection, artifact.byteSize, false),
      artifactId: artifact.id,
      kind,
    }
  }

  async ensureAutomaticSnapshot(): Promise<RecoveryBackupPreview | undefined> {
    const artifacts = (await this.#store.list())
      .filter((artifact) => artifact.kind !== 'staging')
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    const newest = artifacts[0]
    if (newest && this.#now().getTime() - Date.parse(newest.createdAt) < RECOVERY_SNAPSHOT_INTERVAL_MS) {
      return undefined
    }
    return this.createSnapshot('automatic')
  }

  async restore(
    serializedArchive: string,
    options: { readonly allowStale?: boolean } = {},
  ): Promise<RecoveryRestoreResult> {
    const preview = await this.inspectArchive(serializedArchive)
    if (!preview.canRestore) {
      throw new RecoveryError(
        preview.validation.code === 'ok' ? 'invalid' : preview.validation.code,
        preview.validation.message,
      )
    }
    if (preview.validation.code === 'stale' && !options.allowStale) {
      throw new RecoveryError('stale', 'This backup predates a local recovery point. Review it before restoring.')
    }

    const inspection = await this.#portableArchives.inspect(serializedArchive)
    await assertDatabaseHealthy(this.#database)
    const rollbackBundle = await this.#portableArchives.create({
      includeAnnotations: true,
      includeSourcePayloads: false,
      createdAt: this.#now().toISOString(),
    })
    const rollbackInspection = await this.#portableArchives.inspect(rollbackBundle.archive)
    const stagingArtifact = artifactFromInspection(
      this.#createId('staging'),
      'staging',
      serializedArchive,
      inspection,
    )
    const rollbackArtifact = artifactFromInspection(
      this.#createId('rollback'),
      'rollback',
      rollbackBundle.archive,
      rollbackInspection,
    )
    await this.#assertCapacity(stagingArtifact.byteSize + rollbackArtifact.byteSize + 65_536)

    let pending: PendingRestore | undefined
    try {
      await this.#store.write(stagingArtifact)
      await this.#store.write(rollbackArtifact)
      pending = {
        id: this.#createId('restore'),
        rollbackArtifactId: rollbackArtifact.id,
        stagingArtifactId: stagingArtifact.id,
        createdAt: this.#now().toISOString(),
      }
      await this.#store.writePendingRestore(pending)

      // Portable restore reparses the staged bytes, then replaces every canonical table
      // inside one SQLite transaction. No live row is touched before this call.
      await this.#portableArchives.restore(stagingArtifact.archive)
      await verifyRestoredDatabase(this.#database, inspection)
      await this.#rotate()
      return {
        preview,
        rollbackArtifactId: rollbackArtifact.id,
        pendingLaunchConfirmation: true,
      }
    } catch (error) {
      if (pending) {
        try {
          await this.#portableArchives.restore(rollbackArtifact.archive)
          await verifyRestoredDatabase(this.#database, rollbackInspection)
          await this.#store.writePendingRestore(undefined)
        } catch (rollbackError) {
          throw new RecoveryError(
            'corrupt-database',
            'Restore failed and the rollback point could not be applied. Keep the recovery artifacts for support.',
            { cause: new AggregateError([error, rollbackError]) },
          )
        }
      }
      await this.#store.remove(stagingArtifact.id)
      throw normalizeRecoveryError(error)
    }
  }

  async beginPendingLaunch(): Promise<RecoveryLaunchResult> {
    const pending = await this.#store.readPendingRestore()
    if (!pending) return { status: 'none' }
    if (!pending.launchAttemptedAt) {
      await this.#store.writePendingRestore({
        ...pending,
        launchAttemptedAt: this.#now().toISOString(),
      })
      return {
        status: 'testing-restored-library',
        rollbackArtifactId: pending.rollbackArtifactId,
      }
    }
    await this.rollbackPendingLaunch()
    return { status: 'rolled-back', rollbackArtifactId: pending.rollbackArtifactId }
  }

  async confirmPendingLaunch(): Promise<void> {
    const pending = await this.#store.readPendingRestore()
    if (!pending) return
    await this.#store.writePendingRestore(undefined)
    await this.#store.remove(pending.stagingArtifactId)
    await this.#rotate()
  }

  async rollbackPendingLaunch(): Promise<void> {
    const pending = await this.#store.readPendingRestore()
    if (!pending) return
    const rollback = await this.#store.read(pending.rollbackArtifactId)
    if (!rollback) {
      throw new RecoveryError(
        'corrupt-database',
        'The pending restore needs rollback, but its recovery point is missing.',
      )
    }
    const inspection = await this.#portableArchives.inspect(rollback.archive)
    await this.#portableArchives.restore(rollback.archive)
    await verifyRestoredDatabase(this.#database, inspection)
    await this.#store.writePendingRestore(undefined)
    await this.#store.remove(pending.stagingArtifactId)
  }

  async createSupportReport(): Promise<RecoverySupportReport> {
    let databaseIntegrity: 'ok' | 'failed' = 'ok'
    let schemaVersion = 0
    try {
      const health = await readDatabaseHealth(this.#database)
      databaseIntegrity = health.integrity === 'ok' && health.foreignKeyFailures === 0 ? 'ok' : 'failed'
      schemaVersion = health.schemaVersion
    } catch {
      databaseIntegrity = 'failed'
    }
    const artifacts = await this.#store.list()
    const previews = new Map(
      (await this.listSnapshots()).flatMap((preview) => preview.artifactId ? [[preview.artifactId, preview]] : []),
    )
    const pending = await this.#store.readPendingRestore()
    const report: RecoverySupportReport = {
      generatedAt: this.#now().toISOString(),
      database: { integrity: databaseIntegrity, schemaVersion },
      artifacts: artifacts.map((artifact) => ({
        id: artifact.id,
        kind: artifact.kind,
        createdAt: artifact.createdAt,
        byteSize: artifact.byteSize,
        formatVersion: artifact.formatVersion,
        schemaVersion: artifact.schemaVersion,
        validationCode: previews.get(artifact.id)?.validation.code ?? (artifact.kind === 'staging' ? 'ok' : 'invalid'),
      })),
      ...(pending ? {
        pendingRestore: {
          id: pending.id,
          rollbackArtifactId: pending.rollbackArtifactId,
          createdAt: pending.createdAt,
          launchAttempted: Boolean(pending.launchAttemptedAt),
        },
      } : {}),
    }
    assertCredentialFree(report)
    return report
  }

  async #isStale(createdAt: string): Promise<boolean> {
    const newest = (await this.#store.list())
      .filter((artifact) => artifact.kind !== 'staging')
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
    return Boolean(newest && createdAt < newest.createdAt)
  }

  async #assertCapacity(requiredBytes: number): Promise<void> {
    const availableBytes = await this.#availableBytes()
    if (availableBytes !== undefined && availableBytes < requiredBytes) {
      throw new RecoveryError(
        'low-storage',
        `Restore needs ${formatBytes(requiredBytes)} of temporary space; only ${formatBytes(availableBytes)} is available.`,
      )
    }
  }

  async #rotate(): Promise<void> {
    const pending = await this.#store.readPendingRestore()
    const protectedIds = new Set([
      pending?.rollbackArtifactId,
      pending?.stagingArtifactId,
    ].filter((id): id is string => Boolean(id)))
    const artifacts = (await this.#store.list())
      .filter((artifact) => artifact.kind !== 'staging')
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    const retained = new Set(artifacts.slice(0, RECOVERY_ROTATION_LIMIT).map(({ id }) => id))
    for (const artifact of artifacts) {
      if (!retained.has(artifact.id) && !protectedIds.has(artifact.id)) {
        await this.#store.remove(artifact.id)
      }
    }
  }
}

function artifactFromInspection(
  id: string,
  kind: RecoveryArtifactKind,
  archive: string,
  inspection: PortableArchiveInspection,
): StoredRecoveryArtifact {
  return {
    id,
    kind,
    archive,
    createdAt: inspection.manifest.createdAt,
    byteSize: utf8ByteSize(archive),
    formatVersion: inspection.manifest.formatVersion,
    schemaVersion: inspection.manifest.schemaVersion,
    bookCount: inspection.manifest.scope.bookCount,
    includedAssetCount: inspection.manifest.assets.includedIds.length,
  }
}

function isSnapshotArtifact(
  artifact: RecoveryArtifactMetadata,
): artifact is SnapshotArtifactMetadata {
  return artifact.kind !== 'staging'
}

function previewFromInspection(
  inspection: PortableArchiveInspection,
  byteSize: number,
  stale: boolean,
): RecoveryBackupPreview {
  const includedAssetCount = inspection.manifest.assets.includedIds.length
  const relinkAssetCount = Math.max(0, inspection.catalog.assets.length - includedAssetCount)
  return {
    createdAt: inspection.manifest.createdAt,
    formatVersion: inspection.manifest.formatVersion,
    schemaVersion: inspection.manifest.schemaVersion,
    byteSize,
    bookCount: inspection.manifest.scope.bookCount,
    includedAssetCount,
    relinkAssetCount,
    validation: stale
      ? {
          status: 'warning',
          code: 'stale',
          message: 'Valid, but older than the newest local recovery point.',
        }
      : {
          status: 'valid',
          code: 'ok',
          message: 'Checksums, schema, relationships, and redaction boundary are valid.',
        },
    canRestore: true,
  }
}

function invalidPreview(byteSize: number, error: unknown): RecoveryBackupPreview {
  return {
    byteSize,
    includedAssetCount: 0,
    relinkAssetCount: 0,
    validation: validationFromError(error),
    canRestore: false,
  }
}

function validationFromError(error: unknown): RecoveryValidation {
  const normalized = normalizeRecoveryError(error)
  return { status: 'invalid', code: normalized.code, message: normalized.message }
}

function normalizeRecoveryError(error: unknown): RecoveryError {
  if (error instanceof RecoveryError) return error
  if (error instanceof PortableArchiveCompatibilityError) {
    return new RecoveryError(
      /newer than supported/i.test(error.message) ? 'future-version' : 'invalid',
      error.message,
      { cause: error },
    )
  }
  if (error instanceof PortableArchiveIntegrityError) {
    const code = error.entryPath === 'archive.json'
      ? 'truncated'
      : error.entryPath === 'manifest.assets' || error.entryPath.startsWith('assets/')
        ? 'missing-asset'
        : /checksum|byte/i.test(error.message)
          ? 'tampered'
          : 'invalid'
    return new RecoveryError(code, error.message, { cause: error })
  }
  const message = error instanceof Error ? error.message : String(error)
  if (/ENOSPC|no space left|quota exceeded|not enough (?:free )?storage/i.test(message)) {
    return new RecoveryError(
      'low-storage',
      'There is not enough temporary storage to stage and verify this recovery point.',
      { cause: error },
    )
  }
  return new RecoveryError('invalid', message, { cause: error })
}

async function assertDatabaseHealthy(database: SqlDatabase): Promise<void> {
  const health = await readDatabaseHealth(database)
  if (health.integrity !== 'ok' || health.foreignKeyFailures > 0) {
    throw new RecoveryError(
      'corrupt-database',
      'The current library failed SQLite integrity checks. No recovery artifact was overwritten.',
    )
  }
}

async function readDatabaseHealth(database: SqlDatabase): Promise<{
  readonly integrity: string
  readonly foreignKeyFailures: number
  readonly schemaVersion: number
}> {
  const [integrityRows, foreignKeyRows, versionRows] = await Promise.all([
    database.query('PRAGMA integrity_check'),
    database.query('PRAGMA foreign_key_check'),
    database.query<SqlRow & { readonly version: number }>(
      'SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations',
    ),
  ])
  const integrityRow = integrityRows[0]
  const integrityColumn = integrityRow ? Object.keys(integrityRow)[0] : undefined
  const version = versionRows[0]?.version
  return {
    integrity: integrityRow && integrityColumn ? readText(integrityRow, integrityColumn) : 'unknown',
    foreignKeyFailures: foreignKeyRows.length,
    schemaVersion: typeof version === 'number' ? version : 0,
  }
}

async function verifyRestoredDatabase(
  database: SqlDatabase,
  expected: PortableArchiveInspection,
): Promise<void> {
  await assertDatabaseHealthy(database)
  const [catalog, books, organization, upNext, smartLists] = await Promise.all([
    new CatalogRepository(database).read(),
    readLibraryBooks(database),
    readLibraryOrganization(database),
    readUpNextState(database),
    readSavedSmartLists(database),
  ])
  assertSameIds('Works', catalog.works, expected.catalog.works)
  assertSameIds('Editions', catalog.editions, expected.catalog.editions)
  assertSameIds('Assets', catalog.assets, expected.catalog.assets)
  assertSameIds('library books', books, expected.books)
  assertSameIds('custom shelves', organization.shelves, expected.organization.shelves)
  assertSameIds('smart lists', smartLists, expected.smartLists)
  if (upNext.queueBookIds.length !== expected.upNext.queueBookIds.length) {
    throw new RecoveryError('corrupt-database', 'Restored Up Next state did not pass post-swap validation.')
  }
}

function assertSameIds(
  label: string,
  actual: readonly { readonly id: string }[],
  expected: readonly { readonly id: string }[],
): void {
  const actualIds = actual.map(({ id }) => id).sort()
  const expectedIds = expected.map(({ id }) => id).sort()
  if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
    throw new RecoveryError('corrupt-database', `Restored ${label} did not pass post-swap validation.`)
  }
}

async function estimateAvailableBrowserStorage(): Promise<number | undefined> {
  try {
    const estimate = await navigator.storage?.estimate()
    if (estimate?.quota === undefined || estimate.usage === undefined) return undefined
    return Math.max(0, estimate.quota - estimate.usage)
  } catch {
    return undefined
  }
}

function utf8ByteSize(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_048_576) return `${Math.ceil(bytes / 1_024)} KB`
  return `${(bytes / 1_048_576).toFixed(1)} MB`
}

export function recoveryArtifactMetadata(artifact: StoredRecoveryArtifact): RecoveryArtifactMetadata {
  const { archive: _archive, ...metadata } = artifact
  return metadata
}
