import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem, type FilesystemPlugin } from '@capacitor/filesystem'
import { AUDIOBOOK_FILE_CHUNK_BYTES, bytesToBase64 } from './file-transfer'
import { AudiobookImportError, throwIfAudiobookImportCanceled } from './model'

export type ManagedAudiobookWrite = {
  readonly relativePath: string
  readonly created: boolean
}

export interface ManagedAudiobookStore {
  putAtomically(relativePath: string, bytes: Uint8Array, signal?: AbortSignal): Promise<ManagedAudiobookWrite>
  remove(relativePath: string): Promise<void>
}

type AudiobookFilesystem = Pick<FilesystemPlugin, 'writeFile' | 'appendFile' | 'stat' | 'rename' | 'deleteFile'>

export class CapacitorManagedAudiobookStore implements ManagedAudiobookStore {
  readonly #filesystem: AudiobookFilesystem
  readonly #platform: string

  constructor(options: {
    readonly filesystem?: AudiobookFilesystem
    readonly platform?: string
  } = {}) {
    this.#filesystem = options.filesystem ?? Filesystem
    this.#platform = options.platform ?? Capacitor.getPlatform()
  }

  async putAtomically(
    relativePath: string,
    bytes: Uint8Array,
    signal?: AbortSignal,
  ): Promise<ManagedAudiobookWrite> {
    assertManagedPath(relativePath)
    throwIfAudiobookImportCanceled(signal)
    if (await this.#fileExists(relativePath)) return { relativePath, created: false }

    const temporaryPath = `${relativePath}.partial-${crypto.randomUUID()}`
    try {
      if (this.#platform === 'web') {
        await this.#filesystem.writeFile({
          path: temporaryPath,
          directory: Directory.LibraryNoCloud,
          recursive: true,
          data: new Blob([copyBuffer(bytes)]),
        })
      } else {
        // Decode each chunk into the same native file. Never concatenate base64
        // across the bridge: an audiobook can exceed the WebView's string limit.
        for (let offset = 0; offset < bytes.byteLength || offset === 0; offset += AUDIOBOOK_FILE_CHUNK_BYTES) {
          throwIfAudiobookImportCanceled(signal)
          const data = bytesToBase64(bytes.subarray(offset, offset + AUDIOBOOK_FILE_CHUNK_BYTES))
          const options = { path: temporaryPath, directory: Directory.LibraryNoCloud, data }
          if (offset === 0) {
            await this.#filesystem.writeFile({ ...options, recursive: true })
          } else {
            await this.#filesystem.appendFile(options)
          }
        }
      }
      throwIfAudiobookImportCanceled(signal)
      const stored = await this.#filesystem.stat({ path: temporaryPath, directory: Directory.LibraryNoCloud })
      if (stored.size !== bytes.byteLength) throw new Error('The managed audiobook copy is incomplete.')
      if (await this.#fileExists(relativePath)) {
        await this.#deleteIfPresent(temporaryPath)
        return { relativePath, created: false }
      }
      throwIfAudiobookImportCanceled(signal)
      await this.#filesystem.rename({
        from: temporaryPath,
        to: relativePath,
        directory: Directory.LibraryNoCloud,
        toDirectory: Directory.LibraryNoCloud,
      })
      return { relativePath, created: true }
    } catch (error) {
      await this.#deleteIfPresent(temporaryPath)
      if (error instanceof AudiobookImportError) throw error
      throw new AudiobookImportError(
        'storage-failed',
        'The audiobook passed inspection but could not be copied into private app storage.',
        { cause: error },
      )
    }
  }

  async remove(relativePath: string): Promise<void> {
    assertManagedPath(relativePath)
    await this.#deleteIfPresent(relativePath)
  }

  async #fileExists(path: string): Promise<boolean> {
    try {
      await this.#filesystem.stat({ path, directory: Directory.LibraryNoCloud })
      return true
    } catch {
      return false
    }
  }

  async #deleteIfPresent(path: string): Promise<void> {
    try {
      await this.#filesystem.deleteFile({ path, directory: Directory.LibraryNoCloud })
    } catch {
      // Cleanup is deliberately idempotent.
    }
  }
}

export class MemoryManagedAudiobookStore implements ManagedAudiobookStore {
  readonly files = new Map<string, Uint8Array>()
  failNextWrite = false

  async putAtomically(
    relativePath: string,
    bytes: Uint8Array,
    signal?: AbortSignal,
  ): Promise<ManagedAudiobookWrite> {
    assertManagedPath(relativePath)
    throwIfAudiobookImportCanceled(signal)
    if (this.failNextWrite) {
      this.failNextWrite = false
      throw new AudiobookImportError('storage-failed', 'Simulated managed audiobook storage interruption.')
    }
    if (this.files.has(relativePath)) return { relativePath, created: false }
    this.files.set(relativePath, bytes.slice())
    return { relativePath, created: true }
  }

  async remove(relativePath: string): Promise<void> {
    this.files.delete(relativePath)
  }
}

function assertManagedPath(path: string): void {
  const segments = path.split('/')
  if (!path || path.startsWith('/') || path.includes('\\') || segments.includes('..') || segments.includes('.')) {
    throw new AudiobookImportError('storage-failed', 'Wovenleaf refused an unsafe managed audiobook path.')
  }
}

function copyBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
