import { describe, expect, test } from 'bun:test'
import JSZip from 'jszip'
import type { EpubImportSource } from '../src/epub'
import { EpubImportService } from '../src/epub/service'
import { EpubAssetLifecycleService } from '../src/epub/lifecycle'
import { MemoryManagedAssetStore } from '../src/epub/managed-store'
import { EpubReaderRepository } from '../src/reader/repository'
import { LibraryRepository } from '../src/storage/library-repository'
import { migrateStorage } from '../src/storage/migrations'
import { PortableArchiveService } from '../src/storage/portable-archive'
import { BunSqliteDatabase } from './storage-test-database'

const now = '2026-08-29T09:00:00.000Z'

describe('EPUB asset lifecycle', () => {
  test('previews active-copy removal without deleting history or notes, then restores by exact fingerprint', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const store = new MemoryManagedAssetStore()
    const importer = new EpubImportService(database, {
      managedStore: store,
      createId: sequentialIds(),
      now: () => new Date(now),
    })
    const lifecycle = new EpubAssetLifecycleService(database, {
      managedStore: store,
      importer,
      platform: 'ios',
    })
    const source = await epubSource({ title: 'The Retained Page' })
    const imported = await importer.import(source)
    const managedPath = `assets/epub/${imported.fingerprint}.epub`
    store.files.set(managedPath, Uint8Array.from([1, 2, 3, 4]))
    expect((await lifecycle.inventory()).items[0]?.state).toBe('replaced')
    const replacedPreview = await lifecycle.previewRelink(imported.assetId, source)
    await lifecycle.relink(replacedPreview, source)
    expect((await lifecycle.inventory()).items[0]?.state).toBe('available')
    const reader = new EpubReaderRepository(database)
    await reader.ingest({
      id: 'reader-lifecycle-start',
      kind: 'start',
      sequence: 1,
      bookId: imported.bookId,
      editionId: imported.editionId,
      assetId: imported.assetId,
      assetFingerprint: imported.fingerprint,
      sessionId: 'reading-session:lifecycle',
      emittedAt: now,
      platform: 'ios',
      toolkitVersion: '3.11.0',
      locator: {
        href: 'OPS/chapter.xhtml',
        type: 'application/xhtml+xml',
        locations: { fragments: ['epubcfi(/6/2!/4/2)'], progression: 0.25, totalProgression: 0.25 },
        text: { highlight: 'A retained line.' },
      },
    })
    const library = new LibraryRepository(database)
    const [book] = (await library.list()).filter(({ id }) => id === imported.bookId)
    if (!book) throw new Error('Imported book missing from library')
    await library.save({ ...book, notes: 'Keep this private note.', lastUpdatedAt: now })

    const inventory = await lifecycle.inventory()
    expect(inventory.policy).toMatchObject({ mode: 'original-file', systemBackup: 'excluded' })
    expect(inventory.items).toHaveLength(1)
    expect(inventory.items[0]).toMatchObject({ state: 'available', active: true })

    const preview = await lifecycle.previewCleanup([imported.assetId])
    expect(preview).toMatchObject({
      offlineBookCount: 1,
      retainedReadingEventCount: 1,
      retainedCheckpointCount: 1,
    })
    expect(preview.freedBytes).toBe(source.bytes.byteLength)
    await lifecycle.cleanup(preview)

    expect((await lifecycle.inventory()).items[0]?.state).toBe('missing')
    expect((await library.list()).find(({ id }) => id === imported.bookId)?.notes).toBe('Keep this private note.')
    expect(await database.query('SELECT id FROM reading_events')).toHaveLength(1)
    expect(await database.query('SELECT asset_id FROM epub_reader_checkpoints')).toHaveLength(1)
    expect(await database.query('SELECT id FROM assets')).not.toHaveLength(0)

    const relinkPreview = await lifecycle.previewRelink(imported.assetId, source)
    expect(relinkPreview).toMatchObject({ match: 'exact-fingerprint', canRelink: true })
    const restored = await lifecycle.relink(relinkPreview, source)
    expect(restored).toEqual({
      kind: 'restored',
      assetId: imported.assetId,
      editionId: imported.editionId,
      fingerprint: imported.fingerprint,
    })
    expect((await lifecycle.inventory()).items[0]).toMatchObject({ state: 'available', active: true })
    await database.close()
  })

  test('requires review for a metadata-matched revision and refuses an unrelated package', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const store = new MemoryManagedAssetStore()
    const importer = new EpubImportService(database, {
      managedStore: store,
      createId: sequentialIds(),
      now: increasingClock(),
    })
    const lifecycle = new EpubAssetLifecycleService(database, {
      managedStore: store,
      importer,
      platform: 'android',
    })
    const original = await epubSource({ title: 'Revision House', body: 'First setting.' })
    const imported = await importer.import(original)
    await store.remove(`assets/epub/${imported.fingerprint}.epub`)

    const revision = await epubSource({ title: 'Revision House', body: 'Second setting.' })
    const preview = await lifecycle.previewRelink(imported.assetId, revision)
    expect(preview).toMatchObject({ match: 'edition-metadata', canRelink: true })
    expect(preview.candidateFingerprint).not.toBe(preview.expectedFingerprint)
    const linked = await lifecycle.relink(preview, revision)
    expect(linked.kind).toBe('revision')
    expect(linked.editionId).toBe(imported.editionId)
    expect(linked.assetId).not.toBe(imported.assetId)
    const inventory = await lifecycle.inventory()
    expect(inventory.items.find(({ assetId }) => assetId === linked.assetId)).toMatchObject({
      active: true,
      state: 'available',
    })

    const unrelated = await epubSource({
      title: 'A Different Book',
      body: 'Nothing in common.',
      packageIdentifier: 'urn:uuid:unrelated',
    })
    const rejected = await lifecycle.previewRelink(imported.assetId, unrelated)
    expect(rejected).toMatchObject({ match: 'incompatible', canRelink: false })
    await expect(lifecycle.relink(rejected, unrelated)).rejects.toThrow('cannot be safely linked')
    await database.close()
  })

  test('embeds only selected EPUB bytes and restores their operational asset mapping', async () => {
    const sourceDatabase = new BunSqliteDatabase()
    await migrateStorage(sourceDatabase)
    const sourceStore = new MemoryManagedAssetStore()
    const importer = new EpubImportService(sourceDatabase, {
      managedStore: sourceStore,
      createId: sequentialIds(),
      now: () => new Date(now),
    })
    const lifecycle = new EpubAssetLifecycleService(sourceDatabase, {
      managedStore: sourceStore,
      importer,
      platform: 'web',
    })
    const imported = await importer.import(await epubSource({ title: 'A Portable Copy' }))
    const assetContents = await lifecycle.backupContents()
    const bundle = await new PortableArchiveService(sourceDatabase).create({
      createdAt: now,
      assetContents,
    })
    expect(bundle.manifest.assets).toMatchObject({
      contents: 'selected',
      includedIds: [imported.assetId],
    })

    const targetDatabase = new BunSqliteDatabase()
    await migrateStorage(targetDatabase)
    const targetStore = new MemoryManagedAssetStore()
    const restored = await new PortableArchiveService(targetDatabase, {
      epubAssetStore: targetStore,
    }).restore(bundle.archive)
    expect(restored.epubImports).toHaveLength(1)
    expect(restored.epubImports[0]).toMatchObject({
      bookId: imported.bookId,
      editionId: imported.editionId,
      contentAssetId: imported.assetId,
    })
    const targetLifecycle = new EpubAssetLifecycleService(targetDatabase, {
      managedStore: targetStore,
      platform: 'web',
    })
    expect((await targetLifecycle.inventory()).items[0]).toMatchObject({
      assetId: imported.assetId,
      active: true,
      state: 'available',
    })

    await sourceDatabase.close()
    await targetDatabase.close()
  })
})

async function epubSource(options: {
  readonly title: string
  readonly body?: string
  readonly packageIdentifier?: string
}): Promise<EpubImportSource> {
  const archive = new JSZip()
  archive.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  archive.file('META-INF/container.xml', `<?xml version="1.0"?>
    <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
      <rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml" /></rootfiles>
    </container>`)
  archive.file('OPS/package.opf', `<?xml version="1.0" encoding="UTF-8"?>
    <package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="book-id">
      <metadata>
        <dc:identifier id="book-id">${options.packageIdentifier ?? 'urn:uuid:lifecycle-fixture'}</dc:identifier>
        <dc:title>${options.title}</dc:title>
        <dc:creator>Ada Reader</dc:creator>
        <dc:language>en</dc:language>
      </metadata>
      <manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml" /></manifest>
      <spine><itemref idref="chapter" /></spine>
    </package>`)
  archive.file('OPS/chapter.xhtml', `<html xmlns="http://www.w3.org/1999/xhtml"><body><p>${options.body ?? 'A retained line.'}</p></body></html>`)
  return {
    name: `${options.title}.epub`,
    mediaType: 'application/epub+zip',
    bytes: await archive.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }),
  }
}

function sequentialIds(): (prefix: string) => string {
  let next = 0
  return (prefix) => `${prefix}:lifecycle:${++next}`
}

function increasingClock(): () => Date {
  let tick = 0
  return () => new Date(Date.parse(now) + tick++ * 1_000)
}
