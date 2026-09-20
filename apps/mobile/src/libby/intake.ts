import { Filesystem } from '@capacitor/filesystem'
import { LIBBY_MAX_BYTES, parseLibbySnapshot } from './model'

export async function readLibbyFile(source: File | string): Promise<string> {
  if (typeof source !== 'string') {
    if (source.size > LIBBY_MAX_BYTES) throw new Error('This progress file is too large (128 KB maximum).')
    const text = await source.text()
    parseLibbySnapshot(text)
    return text
  }
  if (!/^(?:file:|content:|capacitor:|\/|data:application\/json[;,])/i.test(source)) throw new Error('Choose a local Wovenleaf Libby progress file.')
  let bytes: Uint8Array
  if (source.startsWith('data:')) {
    if (source.length > LIBBY_MAX_BYTES * 2) throw new Error('This progress file is too large.')
    bytes = new Uint8Array(await (await fetch(source)).arrayBuffer())
  } else {
    const metadata = await Filesystem.stat({ path: source }).catch(() => undefined)
    if (!metadata) throw new Error('This file provider cannot report the progress file’s size. Save it locally, then import it from Libby Settings.')
    if (metadata.size > LIBBY_MAX_BYTES) throw new Error('This progress file is too large.')
    const { data } = await Filesystem.readFile({ path: source })
    if (typeof data === 'string' && data.length > LIBBY_MAX_BYTES * 2) throw new Error('This progress file is too large.')
    bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : Uint8Array.from(atob(data), c => c.charCodeAt(0))
  }
  if (bytes.byteLength > LIBBY_MAX_BYTES) throw new Error('This progress file is too large.')
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  parseLibbySnapshot(text)
  return text
}

export async function removeLibbyShareCopy(source: string) {
  const iosCopy = /[/]Containers[/]Shared[/]AppGroup[/][^/]+[/]IncomingShares[/][^/]+$/.test(source)
  const androidCopy = /[/]data[/](?:user[/]0|data)[/]com\.hmrguez\.wovenleaf[/]cache[/]shared_files[/][^/]+$/.test(source)
  if (!iosCopy && !androidCopy) return
  await Filesystem.deleteFile({ path: source }).catch(() => undefined)
}
