import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { nativeReader } from '../reader/bridge'
import { sha256 as sha256Hex } from '../audiobooks/binary'
import type { EpubCover } from '../epub/model'

export async function pdfCover(relativePath: string): Promise<EpubCover | undefined> {
  if (!Capacitor.isNativePlatform()) return undefined
  const { uri } = await Filesystem.getUri({ path: relativePath, directory: Directory.LibraryNoCloud })
  const { jpeg } = await nativeReader.pdfCover({ fileUri: uri })
  const bytes = Uint8Array.from(atob(jpeg), (character) => character.charCodeAt(0))
  return { path: 'first-page.jpg', mediaType: 'image/jpeg', bytes, sha256: await sha256Hex(bytes) }
}
