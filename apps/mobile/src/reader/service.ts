import { getLocale, waitForNativeLanguage } from '../localization'
import { originalFileUri, originalFileError } from '../files/original-files'
import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import type { ReadingLedgerRepository } from '../storage/catalog-repository'
import type { SqlDatabase } from '../storage/database'
import { nativeReader } from './bridge'
import { EpubReaderError, nativeReaderEventSchema } from './model'
import { EpubReaderRepository } from './repository'
import { epubUnsupportedMessage } from '../epub/compatibility'

export class EpubReaderService {
  readonly #repository: EpubReaderRepository
  #eventQueue: Promise<void> = Promise.resolve()

  constructor(database: SqlDatabase, ledger?: ReadingLedgerRepository) {
    this.#repository = new EpubReaderRepository(database, ledger)
  }

  async closeForIncomingFile(): Promise<void> {
    // Android's singleTask file handoff already returns to MainActivity. On iOS,
    // dismiss the native presentation before showing an import review or player.
    if (Capacitor.getPlatform() !== 'ios') return
    await nativeReader.closeForIncomingFile()
    await this.drainOutbox()
  }

  async open(bookId: string): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      throw new EpubReaderError('unavailable', 'Reading is available in the iOS and Android app.')
    }
    const capability = await this.#repository.capabilityForBook(bookId)
    if (!capability) {
      throw new EpubReaderError('not-found', 'No readable ebook is attached to this book.')
    }
    const unsupportedMessage = capability.compatibility
      ? epubUnsupportedMessage(capability.compatibility)
      : undefined
    if (unsupportedMessage) {
      throw new EpubReaderError('unsupported-content', unsupportedMessage)
    }
    let uri: string
    if (capability.referenceId) {
      uri = originalFileUri(capability.referenceId)
    } else {
      try {
        if (!capability.relativePath) throw new Error('Missing file reference')
        await Filesystem.stat({ path: capability.relativePath, directory: Directory.LibraryNoCloud })
      } catch (error) {
        throw new EpubReaderError(
          'missing-asset',
          'This book file is missing. Choose it again to continue; your notes and history are safe.',
          { cause: error },
        )
      }
      uri = (await Filesystem.getUri({
        path: capability.relativePath,
        directory: Directory.LibraryNoCloud,
      })).uri
    }
    const initialLocator = await this.#repository.resumeLocator(capability)
    const preferences = await this.#repository.preferencesForBook(bookId)
    const navigationState = await this.#repository.navigationStateForBook(capability)
    const annotationState = await this.#repository.annotationStateForBook(capability)
    try {
      await waitForNativeLanguage()
      await nativeReader.open({
        interfaceLocale: getLocale(),
        ...capability,
        fileUri: uri,
        globalPreferences: preferences.global,
        navigationState,
        annotationState,
        ...(preferences.book ? { bookPreferences: preferences.book } : {}),
        ...(initialLocator ? { initialLocator } : {}),
      })
    } catch (error) {
      const code = nativeErrorCode(error)
      if (code?.startsWith('FILE_') || code === 'MISSING_ASSET') {
        throw new EpubReaderError('missing-asset', originalFileError(error), { cause: error })
      }
      throw new EpubReaderError(
        code === 'CORRUPT_ASSET' ? 'corrupt-asset' : 'open-failed',
        code === 'CORRUPT_ASSET'
          ? 'This book can no longer be opened safely. Re-import the edition; notes and reading history were kept.'
          : 'Wovenleaf could not open this book. Your notes and reading history are safe.',
        { cause: error },
      )
    }
  }

  async installEventListener(onApplied?: () => void): Promise<() => Promise<void>> {
    if (!Capacitor.isNativePlatform()) return async () => {}
    const handle = await nativeReader.addListener('readerEvent', (candidate) => {
      const event = nativeReaderEventSchema.parse(candidate)
      void this.#ingestQueued(event, onApplied).catch(() => {
        // The durable native outbox intentionally retains the event for the next drain.
      })
    })
    await this.drainOutbox(onApplied)
    return async () => {
      await this.#eventQueue
      await handle.remove()
    }
  }

  async drainOutbox(onApplied?: () => void): Promise<void> {
    if (!Capacitor.isNativePlatform()) return
    const { events } = await nativeReader.drainOutbox()
    const acknowledged: string[] = []
    for (const candidate of events) {
      const event = nativeReaderEventSchema.parse(candidate)
      await this.#ingestQueued(event, onApplied, false)
      acknowledged.push(event.id)
    }
    if (acknowledged.length) await nativeReader.acknowledge({ ids: acknowledged })
  }

  #ingestQueued(
    event: ReturnType<typeof nativeReaderEventSchema.parse>,
    onApplied?: () => void,
    acknowledge = true,
  ): Promise<void> {
    const next = this.#eventQueue.then(async () => {
      await this.#repository.ingest(event)
      if (acknowledge) await nativeReader.acknowledge({ ids: [event.id] })
      onApplied?.()
    })
    this.#eventQueue = next.catch(() => {})
    return next
  }

  checkpointForBook(bookId: string) {
    return this.#repository.checkpointForBook(bookId)
  }
}

function nativeErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  return 'code' in error && typeof error.code === 'string' ? error.code : undefined
}
