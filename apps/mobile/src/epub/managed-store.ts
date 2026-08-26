import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { EpubImportError, throwIfEpubImportCanceled } from './model'

export type ManagedFileWrite = {
  readonly relativePath: string
  readonly created: boolean
}

export interface ManagedAssetStore {
  putAtomically(relativePath: string, bytes: Uint8Array, signal?: AbortSignal): Promise<ManagedFileWrite>
  remove(relativePath: string): Promise<void>
}

export class CapacitorManagedAssetStore implements ManagedAssetStore {
  async putAtomically(
    relativePath: string,
    bytes: Uint8Array,
    signal?: AbortSignal,
  ): Promise<ManagedFileWrite> {
    assertManagedPath(relativePath)
    throwIfEpubImportCanceled(signal)
    if (await fileExists(relativePath)) return { relativePath, created: false }

    const temporaryPath = `${relativePath}.partial-${crypto.randomUUID()}`
    try {
      await Filesystem.writeFile({
        path: temporaryPath,
        directory: Directory.LibraryNoCloud,
        recursive: true,
        data: Capacitor.getPlatform() === 'web' ? new Blob([copyBuffer(bytes)]) : bytesToBase64(bytes),
      })
      throwIfEpubImportCanceled(signal)
      if (await fileExists(relativePath)) {
        await deleteIfPresent(temporaryPath)
        return { relativePath, created: false }
      }
      await Filesystem.rename({
        from: temporaryPath,
        to: relativePath,
        directory: Directory.LibraryNoCloud,
        toDirectory: Directory.LibraryNoCloud,
      })
      return { relativePath, created: true }
    } catch (error) {
      await deleteIfPresent(temporaryPath)
      if (error instanceof EpubImportError) throw error
      throw new EpubImportError(
        'storage-failed',
        'The EPUB passed validation but could not be copied into private app storage. No library asset was added.',
        { cause: error },
      )
    }
  }

  async remove(relativePath: string): Promise<void> {
    assertManagedPath(relativePath)
    await deleteIfPresent(relativePath)
  }
}

export class MemoryManagedAssetStore implements ManagedAssetStore {
  readonly files = new Map<string, Uint8Array>()
  failNextWrite = false

  async putAtomically(
    relativePath: string,
    bytes: Uint8Array,
    signal?: AbortSignal,
  ): Promise<ManagedFileWrite> {
    assertManagedPath(relativePath)
    throwIfEpubImportCanceled(signal)
    if (this.failNextWrite) {
      this.failNextWrite = false
      throw new EpubImportError('storage-failed', 'Simulated managed-storage interruption.')
    }
    if (this.files.has(relativePath)) return { relativePath, created: false }
    this.files.set(relativePath, bytes.slice())
    return { relativePath, created: true }
  }

  async remove(relativePath: string): Promise<void> {
    this.files.delete(relativePath)
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await Filesystem.stat({ path, directory: Directory.LibraryNoCloud })
    return true
  } catch {
    return false
  }
}

async function deleteIfPresent(path: string): Promise<void> {
  try {
    await Filesystem.deleteFile({ path, directory: Directory.LibraryNoCloud })
  } catch {
    // Cleanup is deliberately idempotent.
  }
}

function assertManagedPath(path: string): void {
  const segments = path.split('/')
  if (!path || path.startsWith('/') || path.includes('\\') || segments.includes('..') || segments.includes('.')) {
    throw new EpubImportError('storage-failed', 'Wovenleaf refused an unsafe managed-file path.')
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 32_768
  const chunks: string[] = []
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length))
    chunks.push(String.fromCharCode(...chunk))
  }
  return btoa(chunks.join(''))
}

function copyBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
