import { Filesystem } from '@capacitor/filesystem'
import type { SharedFile } from '@capgo/capacitor-share-target'
import {
  isGoodreadsCsv,
  looksLikeGoodreadsCsv,
  missingGoodreadsRequiredHeaders,
} from './csv-parser'

const MAX_INCOMING_CSV_BYTES = 10 * 1024 * 1024
const CSV_MEDIA_TYPES = new Set([
  'application/csv',
  'application/vnd.ms-excel',
  'text/comma-separated-values',
  'text/csv',
])

export type IncomingGoodreadsCsv = {
  readonly name: string
  readonly content: string
}

export class UnrecognizedGoodreadsCsvError extends Error {
  constructor(message = 'This CSV is not a Goodreads library export, so Wovenleaf left it untouched.') {
    super(message)
    this.name = 'UnrecognizedGoodreadsCsvError'
  }
}

export class IncomingFileDeliveryGuard {
  readonly #retentionMs: number
  readonly #seenAt = new Map<string, number>()

  constructor(retentionMs = 30_000) {
    this.#retentionMs = retentionMs
  }

  accept(key: string, now = Date.now()): boolean {
    for (const [candidate, seenAt] of this.#seenAt) {
      if (now - seenAt >= this.#retentionMs) this.#seenAt.delete(candidate)
    }
    if (this.#seenAt.has(key)) return false
    this.#seenAt.set(key, now)
    return true
  }

  release(key: string): void {
    this.#seenAt.delete(key)
  }
}

export function looksLikeSharedCsv(file: SharedFile): boolean {
  return file.name.toLocaleLowerCase().endsWith('.csv')
    || CSV_MEDIA_TYPES.has(file.mimeType.toLocaleLowerCase().split(';', 1)[0] ?? '')
}

export async function goodreadsCsvFromSharedFile(file: SharedFile): Promise<IncomingGoodreadsCsv> {
  try {
    return await goodreadsCsvFromIncomingUrl(file.uri, file.name)
  } finally {
    await removeTemporaryIosShare(file.uri)
  }
}

export async function goodreadsCsvFromIncomingUrl(
  url: string,
  suggestedName?: string,
): Promise<IncomingGoodreadsCsv> {
  if (!/^(?:data|file|content|capacitor):/i.test(url) && !url.startsWith('/')) {
    throw new Error('Wovenleaf ignored a non-file link. Share the Goodreads export itself.')
  }
  const bytes = await readIncomingBytes(url)
  if (bytes.byteLength > MAX_INCOMING_CSV_BYTES) {
    throw new Error('This library file is larger than the 10 MB local import limit.')
  }
  let content: string
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    throw new Error('This file is not a readable UTF-8 library export.', { cause: error })
  }
  if (!isGoodreadsCsv(content)) {
    if (looksLikeGoodreadsCsv(content)) {
      const missing = missingGoodreadsRequiredHeaders(content)
      throw new UnrecognizedGoodreadsCsvError(
        missing.length
          ? `This Goodreads-like file is missing ${missing.join(', ')}. Create a fresh Goodreads export and try again.`
          : 'Goodreads appears to have changed its export. Wovenleaf left the file untouched.',
      )
    }
    throw new UnrecognizedGoodreadsCsvError()
  }
  return { name: suggestedName || incomingName(url), content }
}

async function readIncomingBytes(url: string): Promise<Uint8Array> {
  if (/^data:/i.test(url)) {
    const response = await fetch(url)
    return new Uint8Array(await response.arrayBuffer())
  }
  try {
    const metadata = await Filesystem.stat({ path: url })
    if (metadata.size > MAX_INCOMING_CSV_BYTES) {
      throw new Error('This library file is larger than the 10 MB local import limit.')
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('10 MB')) throw error
    // Some document providers do not expose metadata; the byte limit is enforced after reading.
  }
  try {
    const result = await Filesystem.readFile({ path: url })
    return result.data instanceof Blob
      ? new Uint8Array(await result.data.arrayBuffer())
      : base64ToBytes(result.data)
  } catch (error) {
    throw new Error('The shared Goodreads file could not be read. Choose it again to grant access.', {
      cause: error,
    })
  }
}

function incomingName(url: string): string {
  const rawName = url.split(/[\\/]/).at(-1)?.split(/[?#]/, 1)[0] ?? 'goodreads-library.csv'
  try {
    return decodeURIComponent(rawName) || 'goodreads-library.csv'
  } catch {
    return 'goodreads-library.csv'
  }
}

function base64ToBytes(encoded: string): Uint8Array {
  const binary = atob(encoded.replace(/^data:[^,]+,/, ''))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

async function removeTemporaryIosShare(uri: string): Promise<void> {
  const path = uri.split(/[?#]/, 1)[0] ?? ''
  if (!/[\\/]Containers[\\/]Shared[\\/]AppGroup[\\/][^\\/]+[\\/]IncomingShares[\\/][^\\/]+$/.test(path)) {
    return
  }
  try {
    await Filesystem.deleteFile({ path: uri })
  } catch {
    // Intake already owns the bytes. A provider can briefly keep its temporary file locked.
  }
}
