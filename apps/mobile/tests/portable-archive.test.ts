import { describe, expect, test } from 'bun:test'
import { catalogSchema } from '../src/domain/catalog'
import { createStarterLibrary } from '../src/library-model'
import { CatalogRepository } from '../src/storage/catalog-repository'
import { LibraryRepository } from '../src/storage/library-repository'
import { migrateStorage } from '../src/storage/migrations'
import {
  createPortableArchive,
  inspectPortableArchive,
  PortableArchiveIntegrityError,
  PortableArchiveService,
} from '../src/storage/portable-archive'
import { representativeCatalog } from './fixtures/catalog'
import { BunSqliteDatabase } from './storage-test-database'

const exportedAt = '2026-08-25T16:30:00.000Z'
const representativeLibrary = createStarterLibrary(exportedAt).slice(0, 3).map((book, index) => ({
  ...book,
  rating: index === 0 ? 5 : book.rating,
  notes: index === 0 ? 'A private note, with a comma and "quotation".' : book.notes,
}))

describe('portable archive contract', () => {
  test('reconstructs a representative library on a clean install after validating every entry', async () => {
    const source = new BunSqliteDatabase()
    await migrateStorage(source)
    await new CatalogRepository(source).replace(representativeCatalog)
    await new LibraryRepository(source).replace(representativeLibrary)

    const bundle = await new PortableArchiveService(source).create({
      createdAt: exportedAt,
      producerVersion: '1.0.0-test',
    })
    const target = new BunSqliteDatabase()
    await migrateStorage(target)
    const restored = await new PortableArchiveService(target).restore(bundle.archive)

    expect(await new LibraryRepository(target).list()).toEqual(representativeLibrary)
    expect(await new CatalogRepository(target).read()).toEqual(restored.catalog)
    expect(restored.manifest).toMatchObject({
      format: 'wovenleaf-portable-library',
      formatVersion: 1,
      schemaVersion: 1,
      scope: { kind: 'complete-library', bookCount: 3 },
      redactions: {
        privateAnnotations: 'included',
        credentialMaterial: 'excluded',
        localAssetHandles: 'excluded',
      },
    })
    expect(bundle.archive).not.toContain('bookmark:left-hand-audio')
    expect(bundle.archive).not.toContain('books/left-hand.epub')
    expect(restored.manifest.entries.every(({ sha256 }) => sha256.length === 64)).toBe(true)

    await source.close()
    await target.close()
  })

  test('identifies the exact entry when truncation or tampering changes its bytes', async () => {
    const bundle = await createPortableArchive(representativeCatalog, representativeLibrary, {
      createdAt: exportedAt,
    })
    const tampered = JSON.parse(bundle.archive) as {
      entries: Record<string, string>
    }
    tampered.entries['data/library.json'] = tampered.entries['data/library.json'].slice(0, -8)

    const inspection = inspectPortableArchive(JSON.stringify(tampered))
    await expect(inspection).rejects.toBeInstanceOf(PortableArchiveIntegrityError)
    await expect(inspection).rejects.toThrow('data/library.json')
  })

  test('redacts private annotations consistently and labels readable views as lossy', async () => {
    const bundle = await createPortableArchive(representativeCatalog, representativeLibrary, {
      includeAnnotations: false,
      createdAt: exportedAt,
    })
    const inspected = await inspectPortableArchive(bundle.archive)
    const manifestEntries = inspected.manifest.entries

    expect(bundle.archive).not.toContain('A private note')
    expect(inspected.books[0]).toMatchObject({ notes: '', rating: 0 })
    expect(inspected.manifest.redactions.privateAnnotations).toBe('excluded')
    expect(manifestEntries.find(({ path }) => path === 'views/library.csv')?.fidelity).toBe('lossy')
    expect(manifestEntries.find(({ path }) => path === 'views/reading-journal.md')?.fidelity).toBe('lossy')
    expect(bundle.markdown).toContain('Human-readable view only')
    expect(bundle.csv).toContain('Title,Authors,Shelf,Progress')
  })

  test('excludes credential-like source payloads by default and fails closed on explicit inclusion', async () => {
    const catalogWithSecretPayload = catalogSchema.parse({
      ...representativeCatalog,
      sourceRecords: representativeCatalog.sourceRecords.map((record, index) =>
        index === 0
          ? { ...record, rawPayload: { accessToken: 'provider-secret-must-not-leave' } }
          : record,
      ),
    })

    const safe = await createPortableArchive(catalogWithSecretPayload, representativeLibrary, {
      createdAt: exportedAt,
    })
    expect(safe.archive).not.toContain('provider-secret-must-not-leave')
    await expect(createPortableArchive(catalogWithSecretPayload, representativeLibrary, {
      createdAt: exportedAt,
      includeSourcePayloads: true,
    })).rejects.toThrow('Credential material is forbidden')
  })

  test('includes asset bytes only when they are explicitly supplied', async () => {
    const asset = representativeCatalog.assets[0]
    const bytes = new TextEncoder().encode('fixture asset bytes')
    const bundle = await createPortableArchive(representativeCatalog, representativeLibrary, {
      createdAt: exportedAt,
      assetContents: [{
        assetId: asset.id,
        filename: 'cover fixture.jpg',
        mediaType: 'image/jpeg',
        bytes,
      }],
    })
    const inspected = await inspectPortableArchive(bundle.archive)

    expect(inspected.manifest.assets).toEqual({
      records: 'included',
      contents: 'selected',
      includedIds: [asset.id],
    })
    expect(inspected.assetContents).toHaveLength(1)
    expect(inspected.assetContents[0].assetId).toBe(asset.id)
    expect(inspected.assetContents[0].bytes).toEqual(bytes)
  })
})
