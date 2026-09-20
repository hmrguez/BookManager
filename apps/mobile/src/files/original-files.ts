import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { AUDIOBOOK_IMPORT_LIMITS } from '../audiobooks/inspect'
import { MAX_EPUB_ARCHIVE_BYTES } from '../epub/model'

export type OriginalFileReference = { readonly id: string; readonly name: string; readonly size: number }
export type OriginalSelection = OriginalFileReference & { readonly mediaType: string; readonly relativePath?: string }
export type OriginalFile = File & { readonly originalReference?: OriginalFileReference }
export type IncomingOriginalFile = { readonly uri?: string; readonly name: string; readonly kind: 'ebook' | 'audio'; readonly needsSelection?: boolean }

interface OriginalFilesPlugin {
  pick(options: { kind: 'ebook' | 'audio'; folder: boolean }): Promise<{ files: OriginalSelection[] }>
  register(options: { uri: string }): Promise<OriginalSelection>
  stat(options: { id: string; fingerprint?: string; byteSize?: number; hash?: boolean }): Promise<{ size: number; fingerprint?: string }>
  read(options: { id: string; offset: number; length: number }): Promise<{ data: string }>
  reconcile(options: { ids: string[] }): Promise<void>
  incoming(): Promise<{ files: IncomingOriginalFile[] }>
  addListener(event: 'incoming', listener: () => void): Promise<PluginListenerHandle>
}

export const nativeOriginalFiles = registerPlugin<OriginalFilesPlugin>('WovenleafFiles')
export const originalFileUri = (id: string) => `wovenleaf-file://${encodeURIComponent(id)}`

export function originalFileError(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
  if (code === 'FILE_CHANGED') return 'This file has changed. Choose the original again or attach the updated edition. Your progress and notes are safe.'
  if (code === 'FILE_PERMISSION') return 'Access to this file has expired. Choose it again to continue. Your progress and notes are safe.'
  if (code === 'FILE_OFFLINE') return 'This file is not available offline. Download it in Files, then try again.'
  if (code === 'RESELECT_FILE') return 'This app shared a temporary file. Choose the original in Files to keep reading it here.'
  if (code === 'FILE_UNSUPPORTED') return 'This file provider cannot open the book directly. Download it in Files and choose the local file.'
  return 'This file is no longer available. It may have been moved or deleted. Choose it again to continue. Your progress and notes are safe.'
}

export class FileAccessError extends Error {
  constructor(error: unknown) {
    super(originalFileError(error), { cause: error })
    this.name = 'FileAccessError'
  }
}

export interface OriginalFileAccess {
  inspect(id: string): Promise<{ size: number; fingerprint?: string }>
  verify(reference: OriginalFileReference, fingerprint: string, size: number): Promise<void>
  read(reference: OriginalFileReference): Promise<Uint8Array>
}

export const originalFiles: OriginalFileAccess = {
  inspect(id) { return nativeOriginalFiles.stat({ id, hash: true }) },
  async verify(reference, fingerprint, byteSize) {
    try { await nativeOriginalFiles.stat({ id: reference.id, fingerprint, byteSize }) }
    catch (error) { throw new FileAccessError(error) }
  },
  async read(reference) {
    try {
      const { size } = await nativeOriginalFiles.stat({ id: reference.id })
      if (!Number.isSafeInteger(size) || size < 0 || size !== reference.size) throw { code: 'FILE_CHANGED' }
      const bytes = new Uint8Array(size)
      for (let offset = 0; offset < size;) {
        const length = Math.min(1024 * 1024, size - offset)
        const { data } = await nativeOriginalFiles.read({ id: reference.id, offset, length })
        const binary = atob(data)
        if (!binary.length || binary.length > length) throw { code: 'FILE_CHANGED' }
        for (let index = 0; index < binary.length; index++) bytes[offset + index] = binary.charCodeAt(index)
        offset += binary.length
      }
      return bytes
    } catch (error) { throw new FileAccessError(error) }
  },
}

export async function originalSelectionFromUri(uri: string): Promise<OriginalSelection> {
  try { return await nativeOriginalFiles.register({ uri }) }
  catch (error) { throw new FileAccessError(error) }
}

export async function pickOriginalFiles(kind: 'ebook' | 'audio', folder = false): Promise<File[]> {
  if (!Capacitor.isNativePlatform()) return []
  let selections: OriginalSelection[]
  try { selections = (await nativeOriginalFiles.pick({ kind, folder })).files }
  catch (error) { throw new FileAccessError(error) }
  if (kind === 'audio') {
    const audio = selections.filter(({ name, mediaType }) => /\.(mp3|m4b|m4a|mp4)$/i.test(name) || mediaType.startsWith('audio/'))
    if (audio.length > AUDIOBOOK_IMPORT_LIMITS.maxAudioFiles || selections.reduce((size, file) => size + file.size, 0) > AUDIOBOOK_IMPORT_LIMITS.maxTotalBytes) {
      throw new Error('This selection exceeds the audiobook import limit.')
    }
    const oversized = selections.find((file) => !audio.includes(file) && file.size > AUDIOBOOK_IMPORT_LIMITS.maxSidecarBytes)
    if (oversized) throw new Error(`“${oversized.name}” is too large to use as audiobook metadata or cover art.`)
  }
  // Keep the existing metadata inspection and order review, without ever writing content to app storage.
  const result: File[] = []
  for (const selection of selections) {
    const limit = kind === 'ebook' ? MAX_EPUB_ARCHIVE_BYTES : AUDIOBOOK_IMPORT_LIMITS.maxTotalBytes
    if (selection.size > limit) throw new Error(`“${selection.name}” is too large to open.`)
    const bytes = await originalFiles.read(selection)
    const file = new File([bytes as Uint8Array<ArrayBuffer>], selection.name, { type: selection.mediaType })
    Object.defineProperty(file, 'originalReference', { value: selection })
    Object.defineProperty(file, 'webkitRelativePath', { value: selection.relativePath ?? selection.name })
    result.push(file)
  }
  return result
}

/** Reconcile only after database migration/recovery has completed. Native code retains active sessions too. */
export async function reconcileOriginalFiles(database: import('../storage/database').SqlDatabase): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  const [assets, segments] = await Promise.all([
    database.query('SELECT payload_json FROM assets'),
    database.query('SELECT reference_id FROM audiobook_files WHERE reference_id IS NOT NULL'),
  ])
  const ids = new Set<string>()
  for (const asset of assets) {
    const value = JSON.parse(String(asset.payload_json)) as { location?: { kind?: string; bookmarkId?: string } }
    if (value.location?.kind === 'linked-file' && value.location.bookmarkId) ids.add(value.location.bookmarkId)
  }
  for (const segment of segments) if (typeof segment.reference_id === 'string') ids.add(segment.reference_id)
  await nativeOriginalFiles.reconcile({ ids: [...ids] })
}
