import { Capacitor } from '@capacitor/core'
import { Clipboard } from '@capacitor/clipboard'
import {
  CapacitorShareTarget,
  type SharedFile,
  type ShareReceivedEvent,
} from '@capgo/capacitor-share-target'
import { extractValidIsbn, inspectIsbnInput, type IsbnInspection, type ValidIsbn } from './isbn'

export async function readClipboardIsbn(): Promise<IsbnInspection> {
  try {
    const { value } = await Clipboard.read()
    return inspectIsbnInput(value)
  } catch {
    return {
      state: 'invalid',
      normalized: '',
      message: 'Clipboard access is unavailable. Type the ISBN below instead.',
    }
  }
}

export async function listenForSharedIsbn(
  listener: (isbn: ValidIsbn) => void,
): Promise<() => Promise<void>> {
  if (!Capacitor.isNativePlatform()) return async () => undefined
  const handle = await CapacitorShareTarget.addListener('shareReceived', (event) => {
    const isbn = isbnFromShare(event)
    if (isbn) listener(isbn)
  })
  return () => handle.remove()
}

export function isbnFromShare(event: Pick<ShareReceivedEvent, 'title' | 'texts'>): ValidIsbn | undefined {
  return extractValidIsbn([event.title, ...event.texts].join('\n'))
}

export async function listenForSharedFiles(
  listener: (files: readonly SharedFile[]) => void,
): Promise<() => Promise<void>> {
  if (!Capacitor.isNativePlatform()) return async () => undefined
  const handle = await CapacitorShareTarget.addListener('shareReceived', (event) => {
    if (event.files.length) listener(event.files)
  })
  return () => handle.remove()
}
