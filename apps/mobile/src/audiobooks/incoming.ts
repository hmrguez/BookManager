import { Filesystem } from '@capacitor/filesystem'
import { extension, safeRelativePath } from './binary'
import { AUDIOBOOK_IMPORT_LIMITS } from './inspect'
import { AudiobookImportError, type AudiobookImportSource } from './model'

type FileWithRelativePath = File & { readonly webkitRelativePath?: string }

export async function audiobookSourceFromFile(file: File): Promise<AudiobookImportSource> {
  const relativePath = (file as FileWithRelativePath).webkitRelativePath || file.name
  return {
    name: file.name,
    relativePath: safeRelativePath(relativePath),
    mediaType: file.type,
    bytes: new Uint8Array(await file.arrayBuffer()),
  }
}

export function audiobookSourcesFromFiles(files: FileList | readonly File[]): Promise<AudiobookImportSource[]> {
  const supported = Array.from(files).filter(isSupportedSelectionFile)
  const totalBytes = supported.reduce((total, file) => total + file.size, 0)
  if (totalBytes > AUDIOBOOK_IMPORT_LIMITS.maxTotalBytes) {
    throw new AudiobookImportError('unsupported-format', 'This audiobook is larger than the managed import limit.')
  }
  const oversizedSidecar = supported.find((file) =>
    !isAudioFile(file) && file.size > AUDIOBOOK_IMPORT_LIMITS.maxSidecarBytes,
  )
  if (oversizedSidecar) {
    throw new AudiobookImportError(
      'unsupported-format',
      `“${oversizedSidecar.name}” is too large to use as audiobook metadata or cover art.`,
    )
  }
  return Promise.all(supported.map(audiobookSourceFromFile))
}

export async function audiobookSourceFromIncomingUrl(url: string): Promise<AudiobookImportSource> {
  if (!/^(?:file|content|capacitor):/i.test(url)) {
    throw new AudiobookImportError(
      'unsupported-format',
      'Wovenleaf ignored a non-file link. Share a local, unprotected M4B or MP3 file instead.',
    )
  }
  try {
    const result = await Filesystem.readFile({ path: url })
    const bytes = result.data instanceof Blob
      ? new Uint8Array(await result.data.arrayBuffer())
      : base64ToBytes(result.data)
    const name = incomingName(url)
    return { name, relativePath: name, mediaType: mediaTypeFromName(name), bytes }
  } catch (error) {
    throw new AudiobookImportError(
      'storage-failed',
      'The shared audiobook file could not be read. Choose it again to grant Wovenleaf access.',
      { cause: error },
    )
  }
}

function incomingName(url: string): string {
  const rawName = url.split(/[\\/]/).at(-1)?.split(/[?#]/, 1)[0] ?? 'Shared audiobook'
  try {
    return decodeURIComponent(rawName) || 'Shared audiobook'
  } catch {
    return 'Shared audiobook'
  }
}

function mediaTypeFromName(name: string): string {
  return ({
    m4b: 'audio/mp4',
    m4a: 'audio/mp4',
    mp4: 'audio/mp4',
    mp3: 'audio/mpeg',
  } as Record<string, string>)[extension(name)] ?? 'application/octet-stream'
}

function isSupportedSelectionFile(file: File): boolean {
  const suffix = extension(file.name)
  return isAudioFile(file)
    || ['cue', 'json', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif'].includes(suffix)
    || SUPPORTED_IMAGE_TYPES.has(file.type.toLocaleLowerCase())
}

function isAudioFile(file: File): boolean {
  return ['m4b', 'm4a', 'mp4', 'mp3'].includes(extension(file.name)) || file.type.startsWith('audio/')
}

const SUPPORTED_IMAGE_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
])

function base64ToBytes(encoded: string): Uint8Array {
  const binary = atob(encoded.replace(/^data:[^,]+,/, ''))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}
