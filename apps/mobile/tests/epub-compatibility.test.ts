import { describe, expect, test } from 'bun:test'
import {
  EpubImportService,
  MemoryManagedAssetStore,
  epubUnsupportedMessage,
  inspectEpub,
} from '../src/epub'
import { EpubReaderRepository } from '../src/reader'
import { migrateStorage } from '../src/storage/migrations'
import { EPUB_CORPUS_CASES, createCorpusEpub } from './fixtures/epub-corpus'
import { BunSqliteDatabase } from './storage-test-database'

describe('licensed EPUB accessibility and typography corpus', () => {
  test('records unique provenance and high-severity regression coverage', () => {
    expect(new Set(EPUB_CORPUS_CASES.map(({ id }) => id)).size).toBe(EPUB_CORPUS_CASES.length)
    expect(EPUB_CORPUS_CASES.every(({ provenance }) =>
      provenance.source === 'wovenleaf-authored' && provenance.license === 'CC0-1.0',
    )).toBe(true)
    expect(EPUB_CORPUS_CASES.filter(({ severity }) => severity === 'high').map(({ id }) => id))
      .toEqual(expect.arrayContaining([
        'rtl-bidi',
        'cjk-vertical-ruby',
        'fixed-layout',
        'media-overlay',
        'scripted-content',
        'foreign-spine-without-fallback',
        'auditory-only',
      ]))
  })

  test.each(EPUB_CORPUS_CASES)('classifies $id before native open', async (fixture) => {
    const inspection = await inspectEpub(await createCorpusEpub(fixture), {
      fileName: `${fixture.id}.epub`,
      mediaType: 'application/epub+zip',
    })

    expect(inspection.compatibility).toMatchObject({
      layout: fixture.expected.layout,
      pageProgressionDirection: fixture.expected.direction,
      support: { level: fixture.expected.level },
    })
    if (fixture.expected.features) {
      expect(inspection.compatibility.features).toMatchObject(fixture.expected.features)
    }
    if (fixture.expected.unsupportedSpineMediaTypes) {
      expect(inspection.compatibility.unsupportedSpineMediaTypes)
        .toEqual(fixture.expected.unsupportedSpineMediaTypes)
    }
    if (fixture.expected.level === 'supported') {
      expect(epubUnsupportedMessage(inspection.compatibility)).toBeUndefined()
    } else {
      expect(inspection.compatibility.support.notices.length).toBeGreaterThan(0)
    }
  })

  test('persists the profile with import provenance and reader capability', async () => {
    const fixture = EPUB_CORPUS_CASES.find(({ id }) => id === 'cjk-vertical-ruby')
    if (!fixture) throw new Error('Missing CJK corpus fixture')
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const service = new EpubImportService(database, {
      managedStore: new MemoryManagedAssetStore(),
      now: () => new Date('2026-08-29T10:00:00.000Z'),
      createId: sequenceIds(),
    })
    const imported = await service.import({
      name: `${fixture.id}.epub`,
      mediaType: 'application/epub+zip',
      bytes: await createCorpusEpub(fixture),
    })

    const capability = await new EpubReaderRepository(database).capabilityForBook(imported.bookId)
    expect(capability?.compatibility).toMatchObject({
      layout: 'reflowable',
      pageProgressionDirection: 'rtl',
      features: { verticalWriting: true, ruby: true },
      support: { level: 'limited' },
    })
    const [row] = await database.query<{ readonly payload_json: string }>(
      'SELECT payload_json FROM epub_imports WHERE id = ?',
      [imported.importId],
    )
    const payload = JSON.parse(row?.payload_json ?? '{}') as {
      readonly provenance?: { readonly compatibility?: unknown }
    }
    expect(payload.provenance?.compatibility).toEqual(capability?.compatibility)
    await database.close()
  })

  test('returns an actionable block reason for unreadable and auditory-only books', async () => {
    for (const id of ['foreign-spine-without-fallback', 'auditory-only']) {
      const fixture = EPUB_CORPUS_CASES.find((candidate) => candidate.id === id)
      if (!fixture) throw new Error(`Missing ${id} corpus fixture`)
      const profile = (await inspectEpub(await createCorpusEpub(fixture), {
        fileName: `${id}.epub`,
      })).compatibility
      expect(profile.support.level).toBe('unsupported')
      expect(epubUnsupportedMessage(profile)).toMatch(/Wovenleaf|publication|content/i)
    }
  })
})

function sequenceIds(): (prefix: string) => string {
  let index = 0
  return (prefix) => `${prefix}:compatibility:${String(++index).padStart(3, '0')}`
}
