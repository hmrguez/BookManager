import { FileAccessError, originalFileUri } from '../files/original-files'
import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { nativeReader } from '../reader/bridge'
import { sha256 as sha256Hex } from '../audiobooks/binary'
import type { EpubCover } from '../epub/model'

export async function pdfCover(relativePath: string, referenceId?: string): Promise<EpubCover | undefined> {
  if (!Capacitor.isNativePlatform()) return undefined
  const uri = referenceId ? originalFileUri(referenceId)
    : (await Filesystem.getUri({ path: relativePath, directory: Directory.LibraryNoCloud })).uri
  const { jpeg } = await nativeReader.pdfCover({ fileUri: uri }).catch((error: unknown) => {
    if (error && typeof error === 'object' && 'code' in error && String(error.code).startsWith('FILE_')) throw new FileAccessError(error)
    throw error
  })
  const bytes = Uint8Array.from(atob(jpeg), (character) => character.charCodeAt(0))
  return { path: 'first-page.jpg', mediaType: 'image/jpeg', bytes, sha256: await sha256Hex(bytes) }
}
