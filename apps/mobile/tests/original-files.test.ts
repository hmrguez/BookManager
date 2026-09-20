import { Capacitor } from '@capacitor/core'
import { epubSourceFromFile } from '../src/epub/incoming'
import { audiobookSourceFromFile } from '../src/audiobooks/incoming'
import { describe, expect, spyOn, test } from 'bun:test'
import JSZip from 'jszip'
import { EpubImportService } from '../src/epub/service'
import { MemoryManagedAssetStore } from '../src/epub/managed-store'
import { EpubAssetLifecycleService } from '../src/epub/lifecycle'
import { EpubReaderRepository } from '../src/reader/repository'
import { CatalogRepository } from '../src/storage/catalog-repository'
import { PortableArchiveService } from '../src/storage/portable-archive'
import { migrateStorage } from '../src/storage/migrations'
import { FileAccessError, originalFileError, originalFiles } from '../src/files/original-files'
import { inspectEpub, inspectOriginalEpub } from '../src/epub/inspect'
import { BunSqliteDatabase } from './storage-test-database'
import { createPdf } from './fixtures/pdf'
import { MemoryOriginalFiles } from './fixtures/original-files'

async function epub() {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip')
  zip.file('META-INF/container.xml', '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
  zip.file('book.opf', '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">original-file-test</dc:identifier><dc:title>Original Book</dc:title><dc:creator>Ada Reader</dc:creator><dc:language>en</dc:language><meta property="dcterms:modified">2026-09-20T00:00:00Z</meta></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="chapter"/></spine></package>')
  zip.file('chapter.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Original Book</title></head><body><p>A page kept in its original home.</p></body></html>')
  zip.file('nav.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">Chapter</a></li></ol></nav></body></html>')
  return zip.generateAsync({ type: 'uint8array' })
}

describe('original ebook files', () => {
  test('inspects selected ZIP entries with the same metadata and safety checks as a complete EPUB', async () => {
    const original = await epub()
    const zip = await JSZip.loadAsync(original)
    zip.file('unused-image.bin', crypto.getRandomValues(new Uint8Array(65_536)))
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
    // EPUB requires its first mimetype to remain uncompressed.
    const validZip = await JSZip.loadAsync(bytes)
    validZip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
    const valid = await validZip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
    const access = new MemoryOriginalFiles()
    const source = access.link({ name: 'book.epub', bytes: valid })
    let transferred = 0
    access.read = async () => { throw new Error('Do not preload the archive') }
    access.readRange = async (_reference, start, length) => { transferred += length; return valid.slice(start, start + length) }
    const options = { fileName: source.name }
    expect(await inspectOriginalEpub(source.reference, options, access)).toEqual(await inspectEpub(valid, options))
    // A fixed-size directory tail and small publication resources; no image body request.
    expect(transferred).toBeLessThan(75_000)
  })

  test.each(['unsafe-path', 'archive-bomb', 'drm-protected'] as const)('preserves %s rejection when inspecting the original ZIP by range', async (code) => {
    const zip = await JSZip.loadAsync(await epub())
    if (code === 'unsafe-path') zip.file('../outside.txt', 'unsafe')
    if (code === 'archive-bomb') zip.file('compressed.txt', 'a'.repeat(1_000_000), { compression: 'DEFLATE' })
    if (code === 'drm-protected') zip.file('META-INF/encryption.xml', '<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#"><EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes256-cbc"/></EncryptedData></encryption>')
    const access = new MemoryOriginalFiles()
    const source = access.link({ name: 'unsafe.epub', bytes: await zip.generateAsync({ type: 'uint8array' }) })
    await expect(inspectOriginalEpub(source.reference, { fileName: source.name }, access)).rejects.toMatchObject({ code })
  })

  test('rejects a ZIP directory pointing a publication resource outside the original', async () => {
    const bytes = await epub()
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const directory = view.getUint32(bytes.length - 6, true)
    let offset = directory
    while (offset < bytes.length - 22) {
      const nameSize = view.getUint16(offset + 28, true)
      const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameSize))
      if (name === 'META-INF/container.xml') { view.setUint32(offset + 42, bytes.length, true); break }
      offset += 46 + nameSize + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true)
    }
    const access = new MemoryOriginalFiles()
    const source = access.link({ name: 'bad-offset.epub', bytes })
    await expect(inspectOriginalEpub(source.reference, { fileName: source.name }, access)).rejects.toMatchObject({ code: 'invalid-container' })
  })

  test.each(['epub', 'pdf'] as const)('imports and opens a %s reference without storing content', async (format) => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const originals = new MemoryOriginalFiles()
    const store = new MemoryManagedAssetStore()
    let coverReference: string | undefined
    const service = new EpubImportService(database, { originalFiles: originals, managedStore: store,
      pdfCover: async (_path, id) => { coverReference = id; return undefined } })
    const source = originals.link({ name: `book.${format}`, mediaType: format === 'epub' ? 'application/epub+zip' : 'application/pdf',
      bytes: format === 'epub' ? await epub() : await createPdf() })
    const result = await service.import(source)
    expect(store.files.size).toBe(0)
    const catalog = await new CatalogRepository(database).read()
    expect(catalog.assets.find(({ id }) => id === result.assetId)?.location).toMatchObject({ kind: 'linked-file', bookmarkId: source.reference.id })
    expect(await new EpubReaderRepository(database).capabilityForBook(result.bookId)).toMatchObject({ referenceId: source.reference.id, relativePath: '', format })
    if (format === 'pdf') expect(coverReference).toBe(source.reference.id)

    const lifecycle = new EpubAssetLifecycleService(database, { originalFiles: originals, managedStore: store })
    const inventory = await lifecycle.inventory()
    expect(inventory.totalManagedBytes).toBe(0)
    expect(inventory.linkedBytes).toBe(source.bytes.length)
    expect(inventory.items[0]).toMatchObject({ state: 'available', managed: false })
    expect((await lifecycle.previewCleanup()).selections).toEqual([])
    await expect(lifecycle.previewCleanup([result.assetId])).rejects.toThrow('cannot be removed')
    await expect(lifecycle.cleanup({ selections: [{ assetId: result.assetId, relativePath: inventory.items[0]!.relativePath,
      actualFingerprint: result.fingerprint, byteSize: source.bytes.length, active: true }], freedBytes: source.bytes.length,
      offlineBookCount: 1, retainedReadingEventCount: 0, retainedCheckpointCount: 0, retainedAnnotationCount: 0, consequence: '' })).rejects.toThrow('stale')
    expect(originals.files.has(source.reference.id)).toBe(true)
    expect((await lifecycle.backupContents())[0]?.bytes).toEqual(source.bytes)

    originals.files.delete(source.reference.id)
    expect((await lifecycle.inventory()).items[0]?.state).toBe('missing')
    await expect(lifecycle.backupContents()).rejects.toThrow('unavailable')
    const replacement = originals.link(source, 'original:reselected')
    const restored = await service.import(replacement)
    expect(restored.assetId).toBe(result.assetId)
    expect(restored.bookId).toBe(result.bookId)
    expect(restored.outcome).toBe('duplicate')
    expect(await new EpubReaderRepository(database).capabilityForBook(result.bookId)).toMatchObject({ referenceId: replacement.reference.id })
    expect(store.files.size).toBe(0)
  })

  test('rejects an original changed after inspection without committing a library entry', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const originals = new MemoryOriginalFiles()
    const source = originals.link({ name: 'book.epub', mediaType: 'application/epub+zip', bytes: await epub() })
    originals.files.set(source.reference.id, new Uint8Array(source.bytes.length))
    const store = new MemoryManagedAssetStore()
    await expect(new EpubImportService(database, { originalFiles: originals, managedStore: store }).import(source)).rejects.toBeInstanceOf(FileAccessError)
    expect((await new CatalogRepository(database).read()).assets).toHaveLength(0)
    expect(store.files.size).toBe(0)
  })

  test('relinking a managed copy preserves the copy until explicit cleanup and strips references from export', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const originals = new MemoryOriginalFiles()
    const store = new MemoryManagedAssetStore()
    const service = new EpubImportService(database, { originalFiles: originals, managedStore: store })
    const source = { name: 'legacy.epub', mediaType: 'application/epub+zip', bytes: await epub() }
    const managed = await service.import(source)
    const linked = await service.import(originals.link(source))
    expect(linked.assetId).toBe(managed.assetId)
    expect(store.files.size).toBe(1)
    const archives = new PortableArchiveService(database)
    const archive = await archives.create()
    const inspected = await archives.inspect(archive.archive)
    expect(inspected.catalog.assets.find(({ id }) => id === linked.assetId)?.location.kind).toBe('missing')
    expect(archive.archive).not.toContain('original:0')
    const lifecycle = new EpubAssetLifecycleService(database, { originalFiles: originals, managedStore: store })
    const cleanup = await lifecycle.previewCleanup()
    expect(cleanup.offlineBookCount).toBe(0)
    expect(cleanup.freedBytes).toBe(source.bytes.length)
    await lifecycle.cleanup(cleanup)
    expect(store.files.size).toBe(0)
    expect(originals.files.size).toBe(1)
    expect((await lifecycle.inventory()).items[0]?.state).toBe('available')
  })

  test('explains lost permission, changed contents, and offline providers separately', () => {
    expect(originalFileError({ code: 'FILE_PERMISSION' })).toContain('expired')
    expect(originalFileError({ code: 'FILE_CHANGED' })).toContain('changed')
    expect(originalFileError({ code: 'FILE_OFFLINE' })).toContain('offline')
    expect(originalFileError({ code: 'RESELECT_FILE' })).toContain('temporary')
  })
})


test('native HTML file handoffs require the durable picker instead of falling back to copying', async () => {
  const native = spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true)
  const access = new MemoryOriginalFiles()
  const source = access.link({ name: 'selected.epub', bytes: await epub() }, 'picker-reference')
  const ranges = spyOn(originalFiles, 'readRange').mockImplementation((reference, start, length) => access.readRange(reference, start, length))
  const inspect = spyOn(originalFiles, 'inspect').mockImplementation((id) => access.inspect(id))
  try {
    const file = new File(['temporary provider representation'], 'shared.epub')
    await expect(epubSourceFromFile(file)).rejects.toThrow('temporary file')
    await expect(audiobookSourceFromFile(file)).rejects.toThrow('temporary file')
    Object.defineProperty(file, 'originalReference', { value: source.reference })
    expect((await epubSourceFromFile(file)).reference?.id).toBe('picker-reference')
    expect((await audiobookSourceFromFile(file)).reference?.id).toBe('picker-reference')
  } finally { native.mockRestore(); ranges.mockRestore(); inspect.mockRestore() }
})
