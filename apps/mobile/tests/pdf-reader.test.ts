import { describe, expect, test } from 'bun:test'
import { inspectPdf } from '../src/pdf/inspect'
import { inspectBook } from '../src/epub/inspect-book'
import { EpubImportService } from '../src/epub/service'
import { MemoryManagedAssetStore } from '../src/epub/managed-store'
import { EpubAssetLifecycleService } from '../src/epub/lifecycle'
import { EpubReaderRepository } from '../src/reader/repository'
import { nativeReaderEventSchema } from '../src/reader/model'
import { CatalogRepository } from '../src/storage/catalog-repository'
import { LibraryRepository } from '../src/storage/library-repository'
import { migrateStorage, STORAGE_MIGRATIONS } from '../src/storage/migrations'
import { PortableArchiveService } from '../src/storage/portable-archive'
import { BunSqliteDatabase } from './storage-test-database'
import { createPdf } from './fixtures/pdf'
import { createCorpusEpub, EPUB_CORPUS_CASES } from './fixtures/epub-corpus'

const now = '2026-09-17T17:00:00.000Z'

async function setup() {
  const database = new BunSqliteDatabase()
  await migrateStorage(database)
  const store = new MemoryManagedAssetStore()
  const importer = new EpubImportService(database, { managedStore: store, now: () => new Date(now) })
  const lifecycle = new EpubAssetLifecycleService(database, { managedStore: store, importer, platform: 'web' })
  const reader = new EpubReaderRepository(database)
  return { database, store, importer, lifecycle, reader }
}

async function source(options: Parameters<typeof createPdf>[0] = {}) {
  return { name: 'quiet.pdf', mediaType: 'application/pdf', bytes: await createPdf(options) }
}

describe('PDF import and reading lifecycle', () => {
  test('inspects real PDFs by signature, extracts metadata, and falls back to the filename', async () => {
    expect(await inspectBook(await createPdf(), { fileName: 'download', mediaType: 'application/octet-stream' }))
      .toMatchObject({ packageVersion: 'pdf', title: 'The Quiet Page', pageCount: 4, creators: ['Wovenleaf Test Library'], language: 'en' })
    expect(await inspectPdf(await createPdf({ title: '' }), { fileName: 'My notes.pdf' })).toMatchObject({ title: 'My notes' })
    await expect(inspectPdf(new TextEncoder().encode('not a pdf'), { fileName: 'fake.pdf' })).rejects.toMatchObject({ code: 'invalid-package' })
    await expect(inspectPdf(await createPdf({ pages: 0 }), { fileName: 'empty.pdf' })).rejects.toMatchObject({ code: 'invalid-package' })
    await expect(inspectPdf(await createPdf({ encrypted: true }), { fileName: 'locked.pdf' })).rejects.toMatchObject({ code: 'drm-protected' })
  })

  test('deduplicates identical bytes without merging distinct PDFs that share metadata', async () => {
    const { database, importer, lifecycle } = await setup()
    const file = await source()
    const first = await importer.import(file)
    expect(await importer.import(file)).toMatchObject({ outcome: 'duplicate', bookId: first.bookId })
    const other = await importer.import(await source({ variant: 'revised' }))
    expect(other.bookId).not.toBe(first.bookId)
    const catalog = await new CatalogRepository(database).read()
    expect(catalog.assets.filter(({ format }) => format === 'pdf')).toHaveLength(2)
    expect(catalog.editions[0]).toMatchObject({ medium: 'ebook', pageCount: { value: 4 } })
    expect((await lifecycle.inventory()).items.every(({ format, state }) => format === 'pdf' && state === 'available')).toBe(true)
    await database.close()
  })

  test('saves pages, rejects stale events, restores backups, and relinks an exact missing copy', async () => {
    const { database, importer, store, lifecycle, reader } = await setup()
    const file = await source()
    const imported = await importer.import(file)
    const capability = (await reader.capabilityForBook(imported.bookId))!
    expect(capability.format).toBe('pdf')
    const event = nativeReaderEventSchema.parse({
      id: 'pdf-location-2', kind: 'location', sequence: 2,
      bookId: imported.bookId, editionId: imported.editionId, assetId: imported.assetId,
      assetFingerprint: imported.fingerprint, sessionId: 'reading-session:pdf-test',
      emittedAt: now, platform: 'ios', toolkitVersion: 'PDFKit', reachedEnd: false,
      locator: { href: 'document.pdf', type: 'application/pdf', locations: { position: 3, pageCount: 4, totalProgression: 0.75 } },
    })
    expect(await reader.ingest(event)).toBe('applied')
    expect(await reader.ingest({ ...event, sequence: 1 })).toBe('stale')
    expect((await reader.resumeLocator(capability))?.locations.position).toBe(3)
    expect((await new LibraryRepository(database).list())[0]).toMatchObject({ currentPage: 3, pageCount: 4, progress: 75, shelf: 'reading' })
    const bundle = await new PortableArchiveService(database).create({ createdAt: now, assetContents: await lifecycle.backupContents() })
    const restored = await setup()
    await new PortableArchiveService(restored.database, { epubAssetStore: restored.store }).restore(bundle.archive)
    const restoredCapability = (await restored.reader.capabilityForBook(imported.bookId))!
    expect(restoredCapability.format).toBe('pdf')
    expect(await restored.store.read(restoredCapability.relativePath)).toEqual(file.bytes)
    expect((await restored.reader.resumeLocator(restoredCapability))?.locations.position).toBe(3)
    await lifecycle.cleanup(await lifecycle.previewCleanup([imported.assetId]))
    expect(await store.read(capability.relativePath)).toBeUndefined()
    expect((await reader.resumeLocator(capability))?.locations.position).toBe(3)
    const preview = await lifecycle.previewRelink(imported.assetId, file)
    expect(preview.match).toBe('exact-fingerprint')
    await lifecycle.relink(preview, file)
    expect(await store.read(capability.relativePath)).toEqual(file.bytes)
    await lifecycle.cleanup(await lifecycle.previewCleanup([imported.assetId]))
    expect((await importer.import(file)).outcome).toBe('duplicate')
    expect((await lifecycle.inventory()).items[0].state).toBe('available')
    expect((await reader.resumeLocator(capability))?.locations.position).toBe(3)
    const last = nativeReaderEventSchema.parse({ ...event, id: 'pdf-last', sequence: 3, reachedEnd: true, locator: { ...event.locator, locations: { position: 4, pageCount: 4, totalProgression: 1 } } })
    await reader.ingest(last)
    expect((await new LibraryRepository(database).list())[0]).toMatchObject({ progress: 100, currentPage: 4, shelf: 'reading' })
    await reader.ingest({ ...event, id: 'pdf-back', sequence: 4 })
    expect((await new LibraryRepository(database).list())[0]).toMatchObject({ progress: 75, currentPage: 3 })
    await database.close(); await restored.database.close()
  })

  test('rolls back files and catalog when native rendering fails or import is canceled', async () => {
    const { database, store } = await setup()
    const importer = new EpubImportService(database, { managedStore: store, pdfCover: async () => { throw new Error('Native PDF parse failed') } })
    await expect(importer.import(await source())).rejects.toMatchObject({ code: 'storage-failed' })
    expect(store.files.size).toBe(0)
    expect(await new LibraryRepository(database).list()).toHaveLength(0)
    const controller = new AbortController(); controller.abort()
    await expect(importer.import(await source(), { signal: controller.signal })).rejects.toMatchObject({ code: 'canceled' })
    expect(store.files.size).toBe(0)
    await database.close()
  })

  test('widens an existing database without losing its imported records', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database, { migrations: STORAGE_MIGRATIONS.filter(({ version }) => version < 17) })
    const store = new MemoryManagedAssetStore()
    const importer = new EpubImportService(database, { managedStore: store })
    const epub = await importer.import({ name: 'existing.epub', mediaType: 'application/epub+zip', bytes: await createCorpusEpub(EPUB_CORPUS_CASES[0]) })
    const before = await database.query('SELECT * FROM epub_imports')
    await migrateStorage(database)
    expect(await database.query('SELECT * FROM epub_imports')).toEqual(before)
    expect((await new EpubReaderRepository(database).capabilityForBook(epub.bookId))?.format).toBe('epub')
    expect(await database.query('PRAGMA foreign_key_check')).toHaveLength(0)
    const imported = await new EpubImportService(database, { managedStore: new MemoryManagedAssetStore() }).import(await source())
    expect(imported.outcome).toBe('imported')
    await database.close()
  })
})
