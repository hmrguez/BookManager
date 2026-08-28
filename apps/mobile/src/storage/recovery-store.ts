import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { z } from 'zod'

export type RecoveryArtifactKind = 'automatic' | 'manual' | 'rollback' | 'staging'

export type RecoveryArtifactMetadata = {
  readonly id: string
  readonly kind: RecoveryArtifactKind
  readonly createdAt: string
  readonly byteSize: number
  readonly formatVersion: number
  readonly schemaVersion: number
  readonly bookCount: number
  readonly includedAssetCount: number
}

export type StoredRecoveryArtifact = RecoveryArtifactMetadata & {
  readonly archive: string
}

export type PendingRestore = {
  readonly id: string
  readonly rollbackArtifactId: string
  readonly stagingArtifactId: string
  readonly createdAt: string
  readonly launchAttemptedAt?: string
}

export interface RecoveryArtifactStore {
  list(): Promise<readonly RecoveryArtifactMetadata[]>
  read(id: string): Promise<StoredRecoveryArtifact | undefined>
  write(artifact: StoredRecoveryArtifact): Promise<void>
  remove(id: string): Promise<void>
  readPendingRestore(): Promise<PendingRestore | undefined>
  writePendingRestore(pending: PendingRestore | undefined): Promise<void>
}

const artifactMetadataSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['automatic', 'manual', 'rollback', 'staging']),
  createdAt: z.iso.datetime({ offset: true }),
  byteSize: z.number().int().nonnegative(),
  formatVersion: z.number().int().positive(),
  schemaVersion: z.number().int().positive(),
  bookCount: z.number().int().nonnegative(),
  includedAssetCount: z.number().int().nonnegative(),
})

const storedArtifactSchema = artifactMetadataSchema.extend({ archive: z.string().min(1) })
const pendingRestoreSchema = z.object({
  id: z.string().min(1),
  rollbackArtifactId: z.string().min(1),
  stagingArtifactId: z.string().min(1),
  createdAt: z.iso.datetime({ offset: true }),
  launchAttemptedAt: z.iso.datetime({ offset: true }).optional(),
})
const nativeIndexSchema = z.object({
  version: z.literal(1),
  artifacts: z.array(artifactMetadataSchema),
  pendingRestore: pendingRestoreSchema.optional(),
})

export function createRecoveryArtifactStore(): RecoveryArtifactStore {
  return Capacitor.getPlatform() === 'web'
    ? new IndexedDbRecoveryArtifactStore()
    : new NativeRecoveryArtifactStore()
}

export class MemoryRecoveryArtifactStore implements RecoveryArtifactStore {
  readonly artifacts = new Map<string, StoredRecoveryArtifact>()
  pendingRestore?: PendingRestore
  failNextWrite = false

  async list(): Promise<readonly RecoveryArtifactMetadata[]> {
    return [...this.artifacts.values()].map(({ archive: _archive, ...metadata }) => metadata)
  }

  async read(id: string): Promise<StoredRecoveryArtifact | undefined> {
    const artifact = this.artifacts.get(id)
    return artifact ? { ...artifact } : undefined
  }

  async write(artifact: StoredRecoveryArtifact): Promise<void> {
    if (this.failNextWrite) {
      this.failNextWrite = false
      throw new Error('Simulated recovery storage failure')
    }
    this.artifacts.set(artifact.id, storedArtifactSchema.parse(artifact))
  }

  async remove(id: string): Promise<void> {
    this.artifacts.delete(id)
  }

  async readPendingRestore(): Promise<PendingRestore | undefined> {
    return this.pendingRestore ? { ...this.pendingRestore } : undefined
  }

  async writePendingRestore(pending: PendingRestore | undefined): Promise<void> {
    this.pendingRestore = pending ? pendingRestoreSchema.parse(pending) : undefined
  }
}

const NATIVE_RECOVERY_DIRECTORY = 'recovery'
const NATIVE_INDEX_PATH = `${NATIVE_RECOVERY_DIRECTORY}/index.json`

class NativeRecoveryArtifactStore implements RecoveryArtifactStore {
  async list(): Promise<readonly RecoveryArtifactMetadata[]> {
    return (await this.#readIndex()).artifacts
  }

  async read(id: string): Promise<StoredRecoveryArtifact | undefined> {
    const index = await this.#readIndex()
    if (!index.artifacts.some((artifact) => artifact.id === id)) return undefined
    try {
      const result = await Filesystem.readFile({
        path: artifactPath(id),
        directory: Directory.LibraryNoCloud,
        encoding: Encoding.UTF8,
      })
      if (typeof result.data !== 'string') throw new Error('Recovery artifact was not text')
      const metadata = index.artifacts.find((artifact) => artifact.id === id)
      if (!metadata) return undefined
      return storedArtifactSchema.parse({ ...metadata, archive: result.data })
    } catch (error) {
      throw new Error(`Recovery artifact ${safeId(id)} is unavailable`, { cause: error })
    }
  }

  async write(artifactInput: StoredRecoveryArtifact): Promise<void> {
    const artifact = storedArtifactSchema.parse(artifactInput)
    const temporaryPath = `${artifactPath(artifact.id)}.partial`
    await Filesystem.writeFile({
      path: temporaryPath,
      data: artifact.archive,
      directory: Directory.LibraryNoCloud,
      encoding: Encoding.UTF8,
      recursive: true,
    })
    try {
      await Filesystem.rename({
        from: temporaryPath,
        to: artifactPath(artifact.id),
        directory: Directory.LibraryNoCloud,
        toDirectory: Directory.LibraryNoCloud,
      })
      const index = await this.#readIndex()
      const { archive: _archive, ...metadata } = artifact
      await this.#writeIndex({
        ...index,
        artifacts: [...index.artifacts.filter(({ id }) => id !== artifact.id), metadata],
      })
    } catch (error) {
      await deleteNativeFile(temporaryPath)
      throw error
    }
  }

  async remove(id: string): Promise<void> {
    const index = await this.#readIndex()
    if (index.artifacts.some((artifact) => artifact.id === id)) {
      await this.#writeIndex({
        ...index,
        artifacts: index.artifacts.filter((artifact) => artifact.id !== id),
      })
    }
    await deleteNativeFile(artifactPath(id))
  }

  async readPendingRestore(): Promise<PendingRestore | undefined> {
    return (await this.#readIndex()).pendingRestore
  }

  async writePendingRestore(pending: PendingRestore | undefined): Promise<void> {
    const index = await this.#readIndex()
    await this.#writeIndex({
      ...index,
      ...(pending ? { pendingRestore: pendingRestoreSchema.parse(pending) } : {}),
      ...(!pending ? { pendingRestore: undefined } : {}),
    })
  }

  async #readIndex(): Promise<z.infer<typeof nativeIndexSchema>> {
    try {
      const result = await Filesystem.readFile({
        path: NATIVE_INDEX_PATH,
        directory: Directory.LibraryNoCloud,
        encoding: Encoding.UTF8,
      })
      if (typeof result.data !== 'string') throw new Error('Recovery index was not text')
      return nativeIndexSchema.parse(JSON.parse(result.data))
    } catch (error) {
      if (isMissingFileError(error)) return { version: 1, artifacts: [] }
      throw new Error('The local recovery index is damaged', { cause: error })
    }
  }

  async #writeIndex(index: z.input<typeof nativeIndexSchema>): Promise<void> {
    const validated = nativeIndexSchema.parse(index)
    await Filesystem.writeFile({
      path: NATIVE_INDEX_PATH,
      data: JSON.stringify(validated),
      directory: Directory.LibraryNoCloud,
      encoding: Encoding.UTF8,
      recursive: true,
    })
  }
}

class IndexedDbRecoveryArtifactStore implements RecoveryArtifactStore {
  async list(): Promise<readonly RecoveryArtifactMetadata[]> {
    return this.#withDatabase(async (database) => {
      const transaction = database.transaction('artifacts', 'readonly')
      const artifacts = await requestResult(transaction.objectStore('artifacts').getAll())
      await transactionDone(transaction)
      return z.array(storedArtifactSchema).parse(artifacts).map(({ archive: _archive, ...metadata }) => metadata)
    })
  }

  async read(id: string): Promise<StoredRecoveryArtifact | undefined> {
    return this.#withDatabase(async (database) => {
      const transaction = database.transaction('artifacts', 'readonly')
      const artifact = await requestResult(transaction.objectStore('artifacts').get(id))
      await transactionDone(transaction)
      return artifact === undefined ? undefined : storedArtifactSchema.parse(artifact)
    })
  }

  async write(artifact: StoredRecoveryArtifact): Promise<void> {
    await this.#withDatabase(async (database) => {
      const transaction = database.transaction('artifacts', 'readwrite')
      transaction.objectStore('artifacts').put(storedArtifactSchema.parse(artifact))
      await transactionDone(transaction)
    })
  }

  async remove(id: string): Promise<void> {
    await this.#withDatabase(async (database) => {
      const transaction = database.transaction('artifacts', 'readwrite')
      transaction.objectStore('artifacts').delete(id)
      await transactionDone(transaction)
    })
  }

  async readPendingRestore(): Promise<PendingRestore | undefined> {
    return this.#withDatabase(async (database) => {
      const transaction = database.transaction('state', 'readonly')
      const row = await requestResult(transaction.objectStore('state').get('pending-restore'))
      await transactionDone(transaction)
      if (!row || typeof row !== 'object' || !('value' in row)) return undefined
      return pendingRestoreSchema.parse(row.value)
    })
  }

  async writePendingRestore(pending: PendingRestore | undefined): Promise<void> {
    await this.#withDatabase(async (database) => {
      const transaction = database.transaction('state', 'readwrite')
      const store = transaction.objectStore('state')
      if (pending) store.put({ key: 'pending-restore', value: pendingRestoreSchema.parse(pending) })
      else store.delete('pending-restore')
      await transactionDone(transaction)
    })
  }

  async #withDatabase<Result>(work: (database: IDBDatabase) => Promise<Result>): Promise<Result> {
    const database = await openRecoveryDatabase()
    try {
      return await work(database)
    } finally {
      database.close()
    }
  }
}

function artifactPath(id: string): string {
  return `${NATIVE_RECOVERY_DIRECTORY}/artifacts/${safeId(id)}.wovenleaf.json`
}

function safeId(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]/g, '-')
}

function isMissingFileError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /(?:not found|does not exist|ENOENT)/i.test(message)
}

async function deleteNativeFile(path: string): Promise<void> {
  try {
    await Filesystem.deleteFile({ path, directory: Directory.LibraryNoCloud })
  } catch {
    // Recovery cleanup is intentionally idempotent.
  }
}

function openRecoveryDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('wovenleaf-recovery', 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('artifacts')) {
        request.result.createObjectStore('artifacts', { keyPath: 'id' })
      }
      if (!request.result.objectStoreNames.contains('state')) {
        request.result.createObjectStore('state', { keyPath: 'key' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open recovery storage'))
  })
}

function requestResult<Result>(request: IDBRequest<Result>): Promise<Result> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Recovery storage request failed'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Recovery storage transaction failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Recovery storage transaction was aborted'))
  })
}
