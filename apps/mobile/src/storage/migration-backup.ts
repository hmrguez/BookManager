import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Capacitor } from '@capacitor/core'
import type { MigrationBackupStore } from './migrations'

export function createMigrationBackupStore(): MigrationBackupStore {
  return Capacitor.getPlatform() === 'web'
    ? new IndexedDbMigrationBackupStore()
    : new NativeMigrationBackupStore()
}

class NativeMigrationBackupStore implements MigrationBackupStore {
  async save(key: string, snapshot: string): Promise<string> {
    const path = `storage-backups/${safeKey(key)}.json`
    await Filesystem.writeFile({
      path,
      data: snapshot,
      directory: Directory.LibraryNoCloud,
      encoding: Encoding.UTF8,
      recursive: true,
    })
    return `library-no-cloud://${path}`
  }
}

class IndexedDbMigrationBackupStore implements MigrationBackupStore {
  async save(key: string, snapshot: string): Promise<string> {
    const database = await openBackupDatabase()
    try {
      const transaction = database.transaction('snapshots', 'readwrite')
      transaction.objectStore('snapshots').put({
        key,
        createdAt: new Date().toISOString(),
        snapshot,
      })
      await transactionDone(transaction)
      return `indexeddb://wovenleaf-migration-backups/snapshots/${encodeURIComponent(key)}`
    } finally {
      database.close()
    }
  }
}

function safeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, '-')
}

function openBackupDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('wovenleaf-migration-backups', 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('snapshots')) {
        request.result.createObjectStore('snapshots', { keyPath: 'key' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open migration backup store'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not save migration backup'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Migration backup was aborted'))
  })
}

/** Erasure removes every managed pre-migration copy, never merely its index. */
export async function eraseMigrationBackups(): Promise<void> {
  if (Capacitor.getPlatform() === 'web') {
    const database = await openBackupDatabase()
    try {
      const transaction = database.transaction('snapshots', 'readwrite')
      transaction.objectStore('snapshots').clear()
      await transactionDone(transaction)
    } finally { database.close() }
  } else {
    try { await Filesystem.rmdir({ path: 'storage-backups', directory: Directory.LibraryNoCloud, recursive: true }) }
    catch (error) { if (!/not found|does not exist|ENOENT/i.test(String(error))) throw error }
  }
}
