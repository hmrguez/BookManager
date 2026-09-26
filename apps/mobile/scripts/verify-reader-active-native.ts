/** Test-only native bridge entry point. Install only in a disposable app/container. */
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { EpubImportService } from '../src/epub'
import { nativeReader } from '../src/reader/bridge'
import { EpubReaderService } from '../src/reader/service'
import { EpubReaderRepository } from '../src/reader/repository'
import { openCapacitorDatabase } from '../src/storage/capacitor-database'
import { CatalogRepository } from '../src/storage/catalog-repository'
import { migrateStorage } from '../src/storage/migrations'
import { EPUB_CORPUS_CASES, createCorpusEpub } from '../tests/fixtures/epub-corpus'

const report = (value: object) => Filesystem.writeFile({ path: 'reader-verification.json', directory: Directory.Cache,
  encoding: Encoding.UTF8, data: JSON.stringify(value) })

async function main() {
  const database = await openCapacitorDatabase()
  await migrateStorage(database)
  const imports = new EpubImportService(database)
  const fixture = EPUB_CORPUS_CASES[0]!
  const book = await imports.import({ name: 'active-clock.epub', mediaType: 'application/epub+zip',
    bytes: await createCorpusEpub({ ...fixture, title: 'Foreground interval verification', packageMetadata: '' }) })
  const reader = new EpubReaderService(database)
  let previousCommand = ''
  let busy = false
  await report({ stage: 'ready', bookId: book.bookId })
  // Intentionally leave the outbox unacknowledged until an explicit drain: this
  // exercises real native crash/restart recovery with the production repository.
  setInterval(() => {
    if (busy) return
    busy = true
    void (async () => {
      const raw = await Filesystem.readFile({ path: 'reader-command.json', directory: Directory.Cache, encoding: Encoding.UTF8 }).catch(() => undefined)
      if (!raw || typeof raw.data !== 'string' || raw.data === previousCommand) return
      previousCommand = raw.data
      const command = JSON.parse(raw.data) as { id: string; action: 'open' | 'close' | 'inspect' | 'drain' }
      if (command.action === 'open') await reader.open(book.bookId)
      if (command.action === 'close') await nativeReader.closeForIncomingFile()
      const pending = await nativeReader.drainOutbox()
      if (command.action === 'drain') {
        await reader.drainOutbox()
        // Replayed callbacks must not count again even after native acknowledgement.
        const repository = new EpubReaderRepository(database)
        for (const event of [...pending.events].reverse()) await repository.ingest(event)
      }
      const catalog = await new CatalogRepository(database).read()
      await report({ stage: command.action, commandId: command.id, pending: pending.events,
        events: catalog.readingEvents.filter(event => event.editionId === book.editionId),
        checkpoint: await reader.checkpointForBook(book.bookId) })
    })().catch(error => report({ stage: 'error', error: String(error) })).finally(() => { busy = false })
  }, 500)
}
void main().catch(error => report({ stage: 'error', error: String(error) }))
