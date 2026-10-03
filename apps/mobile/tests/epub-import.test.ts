import { seedFreeLibrary } from './fixtures/purchases'
import { LibraryUpgradeRequired } from '../src/purchases/model'
import { describe, expect, test } from 'bun:test'
import JSZip from 'jszip'
import {
  EpubImportError,
  EpubImportService,
  MAX_EPUB_ARCHIVE_BYTES,
  MemoryManagedAssetStore,
  epubSourceFromFile,
  inspectEpub,
  type EpubImportSource,
} from '../src/epub'
import { CatalogRepository } from '../src/storage/catalog-repository'
import { migrateStorage } from '../src/storage/migrations'
import { readLibraryBooks, writeLibraryBook } from '../src/storage/library-repository'
import { BunSqliteDatabase } from './storage-test-database'

describe('safe EPUB inspection', () => {
  test('refuses an oversized browser file before reading it into memory', async () => {
    let read = false
    const file = {
      name: 'oversized.epub',
      type: 'application/epub+zip',
      size: MAX_EPUB_ARCHIVE_BYTES + 1,
      async arrayBuffer() {
        read = true
        return new ArrayBuffer(0)
      },
    } as File

    await expect(epubSourceFromFile(file)).rejects.toMatchObject({ code: 'archive-too-large' })
    expect(read).toBe(false)
  })

  test.each(['2', '3'] as const)('accepts an offline EPUB %s package and extracts provenance', async (version) => {
    const bytes = await createEpub({ version, title: `Offline EPUB ${version}`, cover: true })
    const inspected = await inspectEpub(bytes, {
      fileName: `offline-${version}.epub`,
      mediaType: 'application/epub+zip',
    })

    expect(inspected.packageVersion).toBe(version)
    expect(inspected.title).toBe(`Offline EPUB ${version}`)
    expect(inspected.creators).toEqual(['Ada Reader'])
    expect(inspected.language).toBe('en')
    expect(inspected.identifiers).toContainEqual({
      scheme: 'isbn-13',
      value: '9781234567897',
      normalizedValue: '9781234567897',
    })
    expect(inspected.cover?.mediaType).toBe('image/png')
    expect(inspected.contentHash).toMatch(/^[a-f0-9]{64}$/)
  })

  test('rejects archive path traversal before inflating package resources', async () => {
    const bytes = await createEpub({ hostilePath: '../outside.txt' })

    await expect(inspectEpub(bytes, { fileName: 'hostile.epub' })).rejects.toMatchObject({
      code: 'unsafe-path',
    })
  })

  test('rejects highly compressed archive bombs before package extraction', async () => {
    const bytes = await createEpub({ bomb: true })

    await expect(inspectEpub(bytes, { fileName: 'compressed.epub' })).rejects.toMatchObject({
      code: 'archive-bomb',
    })
  })

  test('rejects protected content explicitly without offering circumvention', async () => {
    const bytes = await createEpub({ drm: true })

    try {
      await inspectEpub(bytes, { fileName: 'protected.epub' })
      throw new Error('Expected protected EPUB to be rejected')
    } catch (error) {
      expect(error).toBeInstanceOf(EpubImportError)
      expect(error).toMatchObject({ code: 'drm-protected' })
      expect((error as Error).message).toContain('does not offer circumvention')
    }
  })

  test('allows standard EPUB font obfuscation without treating it as DRM', async () => {
    const bytes = await createEpub({ fontObfuscation: true })

    await expect(inspectEpub(bytes, { fileName: 'obfuscated-font.epub' })).resolves.toMatchObject({
      title: 'Fixture Book',
      packageVersion: '3',
    })
  })

  test('rejects malformed packages with an actionable reason', async () => {
    const archive = new JSZip()
    archive.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
    archive.file('book.txt', 'not an EPUB package')
    const bytes = await archive.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })

    await expect(inspectEpub(bytes, { fileName: 'malformed.epub' })).rejects.toMatchObject({
      code: 'invalid-package',
      message: expect.stringContaining('META-INF/container.xml'),
    })
  })
})

describe('managed EPUB import', () => {

  test.each([
    { existing: undefined, overwrite: false, cover: true },
    { existing: 'data:image/png;base64,bWFudWFs', overwrite: false, cover: true },
    { existing: 'data:image/png;base64,bWFudWFs', overwrite: true, cover: true },
    { existing: 'data:image/png;base64,bWFudWFs', overwrite: true, cover: false },
  ])('applies attachment cover policy %j and supports reattachment', async ({ existing, overwrite, cover }) => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    await writeLibraryBook(database, {
      id: 'cover-book', title: 'Chosen title', authors: ['Chosen author'],
      pageCount: 100, shelf: 'next', progress: 0, currentPage: 0,
      rating: 0, notes: '', thumbnail: existing,
      addedAt: '2026-08-01T12:00:00.000Z', lastUpdatedAt: '2026-08-01T12:00:00.000Z',
    })
    const service = new EpubImportService(database, {
      managedStore: new MemoryManagedAssetStore(),
      createId: sequentialIds(),
    })
    const source = await sourceFor({ title: 'Cover book', cover })
    const importFile = () => service.import(source, {
      targetBookId: 'cover-book', overwriteCover: overwrite,
    })
    await importFile()
    const [book] = await readLibraryBooks(database)
    expect(book?.title).toBe('Chosen title')
    if (cover && (!existing || overwrite)) {
      expect(book?.thumbnail).toStartWith('data:image/png;base64,')
      expect(book?.thumbnail).not.toBe(existing)
    } else {
      expect(book?.thumbnail).toBe(existing)
    }
    // Simulate an older import whose cover was never applied, then attach the same file again.
    await writeLibraryBook(database, { ...book!, thumbnail: existing })
    expect((await importFile()).outcome).toBe('duplicate')
    const books = await readLibraryBooks(database)
    expect(books).toHaveLength(1)
    expect(books[0]?.thumbnail).toBe(book?.thumbnail)
    await database.close()
  })
  test('attaches a selected EPUB to the existing library book', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    await writeLibraryBook(database, {
      id: 'selected-book',
      title: 'My Chosen Title',
      authors: ['My Chosen Author'],
      pageCount: 300,
      shelf: 'reading',
      progress: 12,
      currentPage: 36,
      rating: 0,
      notes: '',
      addedAt: '2026-08-01T12:00:00.000Z',
      lastUpdatedAt: '2026-08-01T12:00:00.000Z',
    })
    const service = new EpubImportService(database, {
      managedStore: new MemoryManagedAssetStore(),
      createId: sequentialIds(),
    })

    const result = await service.import(await sourceFor({ title: 'Different Package Title' }), {
      targetBookId: 'selected-book',
    })

    expect(result.bookId).toBe('selected-book')
    const rows = await database.query<{ readonly payload_json: string }>('SELECT payload_json FROM library_books')
    expect(rows).toHaveLength(1)
    expect(JSON.parse(rows[0]!.payload_json)).toMatchObject({
      id: 'selected-book',
      title: 'My Chosen Title',
      shelf: 'reading',
      progress: 12,
      format: 'EPUB',
    })
    await database.close()
  })

  test('catalogs a new asset, deduplicates exact content, and links a revision to the edition', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const managedStore = new MemoryManagedAssetStore()
    const service = new EpubImportService(database, {
      managedStore,
      now: () => new Date('2026-08-27T12:00:00.000Z'),
      createId: sequentialIds(),
    })
    const first = await sourceFor({ title: 'A Managed Book', cover: true })
    const original = await service.import(first)
    const duplicate = await service.import(first)
    const revised = await service.import(await sourceFor({
      title: 'A Managed Book — revised package title',
      cover: true,
      extra: 'revision two',
    }))

    expect(original.outcome).toBe('imported')
    expect(duplicate).toMatchObject({ outcome: 'duplicate', assetId: original.assetId })
    expect(revised).toMatchObject({ outcome: 'revision', editionId: original.editionId, bookId: original.bookId })
    expect(revised.assetId).not.toBe(original.assetId)
    expect(managedStore.files.size).toBe(3)

    const catalog = await new CatalogRepository(database).read()
    expect(catalog.works).toHaveLength(1)
    expect(catalog.editions).toHaveLength(1)
    expect(catalog.assets.filter(({ role }) => role === 'content')).toHaveLength(2)
    expect(catalog.sourceRecords).toHaveLength(2)
    expect(catalog.ownerships).toHaveLength(1)
    expect(catalog.accessGrants).toHaveLength(1)
    await database.close()
  })

  test('an interrupted managed write leaves no partial asset and can be retried', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const managedStore = new MemoryManagedAssetStore()
    managedStore.failNextWrite = true
    const service = new EpubImportService(database, { managedStore, createId: sequentialIds() })
    const source = await sourceFor({ title: 'Retry Me' })

    await expect(service.import(source)).rejects.toMatchObject({ code: 'storage-failed' })
    expect(managedStore.files.size).toBe(0)
    expect(await database.query('SELECT id FROM epub_imports')).toHaveLength(0)
    expect(await database.query('SELECT id FROM assets')).toHaveLength(0)

    const retried = await service.import(source)
    expect(retried.outcome).toBe('imported')
    expect(await database.query('SELECT id FROM epub_imports')).toHaveLength(1)
    await database.close()
  })

  test('an interrupted catalog transaction removes newly managed files and retries cleanly', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    await database.execute(`
      CREATE TRIGGER interrupt_epub_commit
      BEFORE INSERT ON epub_imports
      BEGIN
        SELECT RAISE(ABORT, 'simulated catalog interruption');
      END;
    `)
    const managedStore = new MemoryManagedAssetStore()
    const service = new EpubImportService(database, { managedStore, createId: sequentialIds() })
    const source = await sourceFor({ title: 'Catalog Retry', cover: true })

    await expect(service.import(source)).rejects.toMatchObject({ code: 'storage-failed' })
    expect(managedStore.files.size).toBe(0)
    expect(await database.query('SELECT id FROM works')).toHaveLength(0)
    expect(await database.query('SELECT id FROM assets')).toHaveLength(0)

    await database.execute('DROP TRIGGER interrupt_epub_commit')
    expect((await service.import(source)).outcome).toBe('imported')
    expect(managedStore.files.size).toBe(2)
    await database.close()
  })

  test('canceling before storage leaves the catalog and managed store unchanged', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const managedStore = new MemoryManagedAssetStore()
    const service = new EpubImportService(database, { managedStore, createId: sequentialIds() })
    const controller = new AbortController()
    const source = await sourceFor({ title: 'Canceled Book' })

    await expect(service.import(source, {
      signal: controller.signal,
      onProgress: ({ stage }) => {
        if (stage === 'storing') controller.abort()
      },
    })).rejects.toMatchObject({ code: 'canceled' })
    expect(managedStore.files.size).toBe(0)
    expect(await database.query('SELECT id FROM epub_imports')).toHaveLength(0)
    expect(await database.query('SELECT id FROM assets')).toHaveLength(0)
    await database.close()
  })
})

async function sourceFor(options: EpubFixtureOptions): Promise<EpubImportSource> {
  return {
    name: `${options.title ?? 'Fixture'}.epub`,
    mediaType: 'application/epub+zip',
    bytes: await createEpub(options),
  }
}

type EpubFixtureOptions = {
  readonly version?: '2' | '3'
  readonly title?: string
  readonly cover?: boolean
  readonly hostilePath?: string
  readonly bomb?: boolean
  readonly drm?: boolean
  readonly fontObfuscation?: boolean
  readonly extra?: string
}

async function createEpub(options: EpubFixtureOptions = {}): Promise<Uint8Array> {
  const version = options.version ?? '3'
  const title = options.title ?? 'Fixture Book'
  const archive = new JSZip()
  archive.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  archive.file('META-INF/container.xml', `<?xml version="1.0"?>
    <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
      <rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml" /></rootfiles>
    </container>`)
  const coverMetadata = options.cover
    ? version === '3'
      ? '<item id="cover" href="cover.png" media-type="image/png" properties="cover-image" />'
      : '<item id="cover" href="cover.png" media-type="image/png" />'
    : ''
  const epub2CoverMeta = options.cover && version === '2' ? '<meta name="cover" content="cover" />' : ''
  archive.file('OPS/package.opf', `<?xml version="1.0" encoding="UTF-8"?>
    <package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf" version="${version}.0" unique-identifier="book-id">
      <metadata>
        <dc:identifier id="book-id" opf:scheme="ISBN">9781234567897</dc:identifier>
        <dc:title>${title}</dc:title>
        <dc:creator>Ada Reader</dc:creator>
        <dc:language>en</dc:language>
        <dc:publisher>Fixture Press</dc:publisher>
        ${epub2CoverMeta}
      </metadata>
      <manifest>
        <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml" />
        ${coverMetadata}
      </manifest>
      <spine><itemref idref="chapter" /></spine>
    </package>`)
  archive.file('OPS/chapter.xhtml', `<html xmlns="http://www.w3.org/1999/xhtml"><body><p>${options.extra ?? 'Hello'}</p></body></html>`)
  if (options.cover) archive.file('OPS/cover.png', Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if (options.hostilePath) archive.file(options.hostilePath, 'escape')
  if (options.bomb) archive.file('OPS/bomb.txt', new Uint8Array(2 * 1024 * 1024))
  if (options.drm) {
    archive.file('META-INF/encryption.xml', `<?xml version="1.0"?>
      <encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
        <enc:EncryptedData><enc:EncryptionMethod Algorithm="http://example.com/drm" /><enc:CipherData><enc:CipherReference URI="OPS/chapter.xhtml" /></enc:CipherData></enc:EncryptedData>
      </encryption>`)
  }
  if (options.fontObfuscation) {
    archive.file('OPS/font.otf', Uint8Array.from([79, 84, 84, 79]))
    archive.file('META-INF/encryption.xml', `<?xml version="1.0"?>
      <encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
        <enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding" /><enc:CipherData><enc:CipherReference URI="OPS/font.otf" /></enc:CipherData></enc:EncryptedData>
      </encryption>`)
  }
  return archive.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 9 } })
}

function sequentialIds(): (prefix: string) => string {
  let next = 0
  return (prefix) => `${prefix}:test:${++next}`
}

test('free limit rolls back EPUB bytes and catalog, while attachments remain free', async () => {
  const database = new BunSqliteDatabase()
  await migrateStorage(database)
  const { library } = await seedFreeLibrary(database)
  const managedStore = new MemoryManagedAssetStore()
  const service = new EpubImportService(database, { managedStore })
  const source = { name: 'capacity.epub', bytes: await createEpub({ title: 'New EPUB', cover: true }) }
  await expect(service.import(source)).rejects.toBeInstanceOf(LibraryUpgradeRequired)
  expect(await library.list()).toHaveLength(30)
  expect(managedStore.files.size).toBe(0)
  expect((await new CatalogRepository(database).read()).works).toHaveLength(0)
  await service.import(source, { targetBookId: 'capacity-1' })
  expect(await library.list()).toHaveLength(30)
  expect(managedStore.files.size).toBeGreaterThan(0)
  await database.close()
})
