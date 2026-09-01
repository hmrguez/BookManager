import { describe, expect, test } from 'bun:test'
import { CatalogRepository } from '../src/storage/catalog-repository'
import { migrateStorage } from '../src/storage/migrations'
import {
  DEFAULT_READER_PREFERENCES,
  MAX_FORCE_QUIT_POSITION_LOSS_MS,
  annotationForReplacement,
  fallbackLocatorForReplacement,
  nativeReaderEventSchema,
  normalizeAnnotationTags,
  readerAnnotationSchema,
  readerNavigationStateSchema,
  readerPreferencesSchema,
  readiumLocatorSchema,
  type EpubReaderCapability,
  type NativeReaderEvent,
  type ReaderAnnotation,
  uniqueAnnotationReanchorCandidate,
} from '../src/reader/model'
import { EpubReaderRepository } from '../src/reader/repository'
import { libraryBookSchema } from '../src/library-model'
import { LibraryRepository } from '../src/storage/library-repository'
import { fixtureIds, representativeCatalog } from './fixtures/catalog'
import { BunSqliteDatabase } from './storage-test-database'

const fingerprint = 'a'.repeat(64)
const semanticLocator = readiumLocatorSchema.parse({
  href: 'Text/chapter-08.xhtml',
  type: 'application/xhtml+xml',
  title: 'Chapter Eight',
  locations: {
    fragments: ['epubcfi(/6/24!/4/2/14)'],
    progression: 0.42,
    totalProgression: 0.42,
    position: 128,
    cssSelector: '#the-camp-at-dawn',
  },
  text: {
    before: 'The wind had fallen.',
    highlight: 'Estraven looked east.',
    after: 'Dawn found them awake.',
  },
  vendorExtension: { semanticAnchor: 'camp-at-dawn' },
})

describe('native EPUB resume checkpoints', () => {
  test('keeps the Android reader chrome inside system bars and display cutouts', async () => {
    const source = await Bun.file(
      new URL(
        '../android/app/src/main/java/com/hmrguez/wovenleaf/WovenleafReaderActivity.kt',
        import.meta.url,
      ),
    ).text()

    expect(source).toContain('WindowCompat.setDecorFitsSystemWindows(window, false)')
    expect(source).toContain('ViewCompat.setOnApplyWindowInsetsListener(chrome)')
    expect(source).toContain(
      'WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()',
    )
    expect(source).toContain(
      'view.setPadding(safeArea.left, safeArea.top, safeArea.right, safeArea.bottom)',
    )
  })

  test('keeps the canonical toolkit locator opaque and layout-independent', () => {
    expect(semanticLocator).toMatchObject({
      href: 'Text/chapter-08.xhtml',
      locations: {
        fragments: ['epubcfi(/6/24!/4/2/14)'],
        cssSelector: '#the-camp-at-dawn',
      },
      vendorExtension: { semanticAnchor: 'camp-at-dawn' },
    })
    expect(MAX_FORCE_QUIT_POSITION_LOSS_MS).toBe(750)
  })

  test('rejects stale native events before they can move progress backwards', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    await new CatalogRepository(database).replace(representativeCatalog)
    const repository = new EpubReaderRepository(database)

    expect(await repository.ingest(readerEvent({ sequence: 2, progression: 0.62 }))).toBe('applied')
    expect(await repository.ingest(readerEvent({ sequence: 1, progression: 0.18 }))).toBe('stale')

    const checkpoint = await repository.checkpointForBook('book:left-hand-reader')
    expect(checkpoint).toMatchObject({
      lastSequence: 2,
      assetFingerprint: fingerprint,
      locator: { locations: { totalProgression: 0.62 } },
    })
    const staleRows = await database.query(
      "SELECT id FROM reading_events WHERE id = 'reading-event:reader:test-1'",
    )
    expect(staleRows).toEqual([])
    await database.close()
  })

  test('starts an Up Next book at zero and then tracks publication-wide EPUB progress', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    await new CatalogRepository(database).replace(representativeCatalog)
    const library = new LibraryRepository(database)
    await library.save(libraryBookSchema.parse({
      id: 'book:left-hand-reader',
      title: 'The Left Hand of Darkness',
      authors: ['Ursula K. Le Guin'],
      pageCount: 304,
      shelf: 'next',
      progress: 0,
      currentPage: 0,
      rating: 0,
      notes: '',
      addedAt: '2026-08-20T10:00:00.000Z',
      lastUpdatedAt: '2026-08-20T10:00:00.000Z',
    }))
    const repository = new EpubReaderRepository(database)

    expect(await repository.ingest(nativeReaderEventSchema.parse({
      ...nativeEnvelope(1),
      id: 'reading-event:reader:start-1',
      kind: 'start',
    }))).toBe('applied')
    expect((await library.list())[0]).toMatchObject({
      shelf: 'reading',
      progress: 0,
      startedAt: '2026-08-28T12:00:01.000Z',
    })

    expect(await repository.ingest(readerEvent({
      sequence: 2,
      progression: 0.27,
      resourceProgression: 0.81,
    }))).toBe('applied')
    expect((await library.list())[0]).toMatchObject({ shelf: 'reading', progress: 27 })

    const catalog = await new CatalogRepository(database).read()
    expect(catalog.readingEvents.find(({ id }) => id === 'reading-event:reader:test-2'))
      .toMatchObject({
        position: {
          locator: { kind: 'epub', progression: 0.81, totalProgression: 0.27 },
          normalizedProgress: 0.27,
        },
      })
    await database.close()
  })

  test('resumes the exact locator until replacement, then falls back to its semantic passage', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    await new CatalogRepository(database).replace(representativeCatalog)
    const repository = new EpubReaderRepository(database)
    await repository.ingest(readerEvent({ sequence: 3, progression: 0.42, locator: semanticLocator }))

    const capability = readerCapability(fingerprint)
    expect(await repository.resumeLocator(capability)).toEqual(semanticLocator)

    const replacementResume = await repository.resumeLocator(readerCapability('b'.repeat(64)))
    expect(replacementResume).toEqual(fallbackLocatorForReplacement(semanticLocator))
    expect(replacementResume).toMatchObject({
      href: semanticLocator.href,
      title: semanticLocator.title,
      locations: { fragments: [], totalProgression: 0.42 },
      text: semanticLocator.text,
    })
    expect(replacementResume?.locations).not.toHaveProperty('cssSelector')
    await database.close()
  })

  test('replayed outbox events are idempotent while advancing their checkpoint', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    await new CatalogRepository(database).replace(representativeCatalog)
    const repository = new EpubReaderRepository(database)
    const event = readerEvent({ sequence: 4, progression: 0.71 })

    expect(await repository.ingest(event)).toBe('applied')
    expect(await repository.ingest(event)).toBe('stale')
    const rows = await database.query(
      "SELECT COUNT(*) AS count FROM reading_events WHERE id = 'reading-event:reader:test-4'",
    )
    expect(rows).toEqual([{ count: 1 }])
    await database.close()
  })

  test('events from a replaced asset cannot outrank the active import', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    await new CatalogRepository(database).replace(representativeCatalog)
    await seedImport(database, {
      id: 'epub-import:reader:old',
      assetId: fixtureIds.assets.leftHandEpub,
      editionId: fixtureIds.editions.leftHandEbook,
      fingerprint,
      importedAt: '2026-08-28T10:00:00.000Z',
    })
    await seedImport(database, {
      id: 'epub-import:reader:replacement',
      assetId: fixtureIds.assets.translatedEpub,
      editionId: fixtureIds.editions.translated,
      fingerprint: 'b'.repeat(64),
      importedAt: '2026-08-28T11:00:00.000Z',
    })
    const repository = new EpubReaderRepository(database)

    expect(await repository.ingest(readerEvent({ sequence: 9, progression: 0.18 }))).toBe('stale')
    expect(await repository.ingest(readerEvent({
      sequence: 5,
      progression: 0.73,
      editionId: fixtureIds.editions.translated,
      assetId: fixtureIds.assets.translatedEpub,
      assetFingerprint: 'b'.repeat(64),
    }))).toBe('applied')
    expect(await repository.checkpointForBook('book:left-hand-reader')).toMatchObject({
      assetId: fixtureIds.assets.translatedEpub,
      locator: { locations: { totalProgression: 0.73 } },
    })
    await database.close()
  })
})

describe('paper-aware reader preferences', () => {
  test('ships a bounded monochrome reading surface', () => {
    expect(DEFAULT_READER_PREFERENCES).toMatchObject({
      fontFamily: 'literary',
      fontSize: 1,
      fontWeight: 1,
      lineHeight: 1.5,
      textAlign: 'justify',
      hyphens: true,
      layout: 'paginated',
      theme: 'paper',
      publisherStyles: false,
    })
    expect(() => readerPreferencesSchema.parse({
      ...DEFAULT_READER_PREFERENCES,
      fontSize: 3,
    })).toThrow()
  })

  test('merges a persistent per-book override over the global reading surface', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const repository = new EpubReaderRepository(database)
    const global = readerPreferencesSchema.parse({
      ...DEFAULT_READER_PREFERENCES,
      theme: 'white',
      fontSize: 1.1,
    })
    const book = readerPreferencesSchema.parse({
      ...global,
      theme: 'graphite',
      fontSize: 1.3,
      layout: 'scroll',
    })

    await repository.savePreferences('global', 'ignored', global)
    await repository.savePreferences('book', 'book:left-hand-reader', book)
    expect(await repository.preferencesForBook('book:left-hand-reader')).toEqual({ global, book })
    expect(await repository.preferencesForBook('book:another')).toEqual({ global })

    await repository.savePreferences('book', 'book:left-hand-reader', null)
    expect(await repository.preferencesForBook('book:left-hand-reader')).toEqual({ global })
    await database.close()
  })

  test('ingests native preference mutations without creating reading events', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    await new CatalogRepository(database).replace(representativeCatalog)
    const repository = new EpubReaderRepository(database)
    await repository.ingest(readerEvent({ sequence: 1, progression: 0.42, locator: semanticLocator }))
    const preferences = readerPreferencesSchema.parse({
      ...DEFAULT_READER_PREFERENCES,
      fontFamily: 'accessible',
      publisherStyles: true,
    })
    const event = nativeReaderEventSchema.parse({
      id: 'reading-event:reader:preference-2',
      sequence: 2,
      kind: 'preference',
      preferenceScope: 'book',
      preferences,
      bookId: 'book:left-hand-reader',
      editionId: fixtureIds.editions.leftHandEbook,
      assetId: fixtureIds.assets.leftHandEpub,
      assetFingerprint: fingerprint,
      sessionId: 'reading-session:reader:test',
      emittedAt: '2026-08-28T12:00:01.000Z',
      platform: 'ios',
      toolkitVersion: '3.11.0',
    })

    expect(await repository.ingest(event)).toBe('applied')
    expect(await repository.preferencesForBook('book:left-hand-reader')).toEqual({
      global: DEFAULT_READER_PREFERENCES,
      book: preferences,
    })
    expect(await database.query(
      "SELECT id FROM reading_events WHERE id = 'reading-event:reader:preference-2'",
    )).toEqual([])
    expect(await repository.checkpointForBook('book:left-hand-reader')).toMatchObject({
      lastSequence: 2,
      locator: semanticLocator,
    })
    expect(await repository.ingest(event)).toBe('stale')
    await database.close()
  })
})

describe('portable reader navigation', () => {
  test('persists TOC context and bookmark mutations without replacing the reading checkpoint', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    await new CatalogRepository(database).replace(representativeCatalog)
    const repository = new EpubReaderRepository(database)
    await repository.ingest(readerEvent({ sequence: 1, progression: 0.42, locator: semanticLocator }))

    const bookmark = nativeReaderEventSchema.parse({
      ...nativeEnvelope(2),
      kind: 'bookmark',
      action: 'upsert',
      bookmarkId: 'reader-bookmark:camp-at-dawn',
      locator: semanticLocator,
      createdAt: '2026-08-28T12:00:02.000Z',
    })
    const toc = nativeReaderEventSchema.parse({
      ...nativeEnvelope(3),
      kind: 'toc',
      locator: semanticLocator,
    })
    expect(await repository.ingest(bookmark)).toBe('applied')
    expect(await repository.ingest(toc)).toBe('applied')

    const state = await repository.navigationStateForBook(readerCapability(fingerprint))
    expect(state).toMatchObject({
      version: 1,
      bookId: 'book:left-hand-reader',
      toc: { locator: semanticLocator },
      bookmarks: [{ id: 'reader-bookmark:camp-at-dawn', locator: semanticLocator }],
    })
    expect(readerNavigationStateSchema.parse(state)).toEqual(state)
    expect(await repository.checkpointForBook('book:left-hand-reader')).toMatchObject({
      lastSequence: 3,
      locator: semanticLocator,
    })

    const replacement = await repository.navigationStateForBook(readerCapability('b'.repeat(64)))
    expect(replacement.bookmarks[0]?.locator.locations.fragments).toEqual([])
    expect(replacement.toc?.locator.locations.fragments).toEqual([])

    expect(await repository.ingest(nativeReaderEventSchema.parse({
      ...nativeEnvelope(4),
      kind: 'bookmark',
      action: 'delete',
      bookmarkId: 'reader-bookmark:camp-at-dawn',
    }))).toBe('applied')
    expect((await repository.navigationStateForBook(readerCapability(fingerprint))).bookmarks).toEqual([])
    await database.close()
  })
})

describe('full-fidelity EPUB annotations', () => {
  test('persists highlight context and keeps deletion tombstones without moving the reading position', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    await new CatalogRepository(database).replace(representativeCatalog)
    const repository = new EpubReaderRepository(database)
    await repository.ingest(readerEvent({ sequence: 1, progression: 0.42, locator: semanticLocator }))
    const annotation = readerAnnotation()

    expect(await repository.ingest(nativeReaderEventSchema.parse({
      ...nativeEnvelope(2),
      kind: 'annotation',
      action: 'upsert',
      annotationId: annotation.id,
      annotation,
    }))).toBe('applied')
    expect(await repository.annotationStateForBook(readerCapability(fingerprint))).toMatchObject({
      annotations: [{
        id: annotation.id,
        quote: 'Estraven looked east.',
        prefix: 'The wind had fallen.',
        suffix: 'Dawn found them awake.',
        tags: ['Character', 'Revisit'],
        anchor: { status: 'exact' },
      }],
    })

    expect(await repository.ingest(nativeReaderEventSchema.parse({
      ...nativeEnvelope(3),
      kind: 'annotation',
      action: 'delete',
      annotationId: annotation.id,
    }))).toBe('applied')
    const deleted = await repository.annotationStateForBook(readerCapability(fingerprint))
    expect(deleted.annotations[0]?.deletedAt).toBe('2026-08-28T12:00:03.000Z')
    expect(await repository.checkpointForBook('book:left-hand-reader')).toMatchObject({
      lastSequence: 3,
      locator: semanticLocator,
    })

    expect(await repository.ingest(nativeReaderEventSchema.parse({
      ...nativeEnvelope(4),
      kind: 'annotation',
      action: 'restore',
      annotationId: annotation.id,
    }))).toBe('applied')
    expect((await repository.annotationStateForBook(readerCapability(fingerprint))).annotations[0])
      .not.toHaveProperty('deletedAt')
    await database.close()
  })

  test('routes every changed EPUB fingerprint to explicit review without trusting its old range', () => {
    const annotation = readerAnnotation()
    const replacement = annotationForReplacement(annotation, {
      editionId: fixtureIds.editions.translated,
      assetId: fixtureIds.assets.translatedEpub,
      assetFingerprint: 'b'.repeat(64),
    })

    expect(replacement).toMatchObject({
      editionId: fixtureIds.editions.translated,
      assetId: fixtureIds.assets.translatedEpub,
      assetFingerprint: 'b'.repeat(64),
      quote: annotation.quote,
      prefix: annotation.prefix,
      suffix: annotation.suffix,
      anchor: {
        status: 'review',
        previousAssetFingerprint: fingerprint,
        reason: 'asset-revision',
      },
    })
    expect(replacement.locator.locations.fragments).toEqual([])
    expect(replacement.locator.locations).not.toHaveProperty('cssSelector')
    expect(annotation.anchor.status).toBe('exact')
  })

  test('auto-reanchors only a unique quote or a unique surrounding-context match', () => {
    const annotation = readerAnnotation()
    const otherContext = readiumLocatorSchema.parse({
      ...semanticLocator,
      locations: { ...semanticLocator.locations, fragments: ['epubcfi(/6/30!/4/8)'] },
      text: {
        before: 'Across the ice, hours later.',
        highlight: annotation.quote,
        after: 'They packed in silence.',
      },
    })
    expect(uniqueAnnotationReanchorCandidate(annotation, [semanticLocator]))
      .toEqual(semanticLocator)
    expect(uniqueAnnotationReanchorCandidate(annotation, [semanticLocator, otherContext]))
      .toEqual(semanticLocator)
    expect(uniqueAnnotationReanchorCandidate(
      { ...annotation, prefix: '', suffix: '' },
      [semanticLocator, otherContext],
    )).toBeUndefined()
  })

  test('normalizes tag identity into a stable, bounded export order', () => {
    expect(normalizeAnnotationTags([' revisit ', 'Character', 'character', '', 'World   building']))
      .toEqual(['Character', 'revisit', 'World building'])
  })
})

function readerEvent(options: {
  readonly sequence: number
  readonly progression: number
  readonly resourceProgression?: number
  readonly locator?: typeof semanticLocator
  readonly editionId?: string
  readonly assetId?: string
  readonly assetFingerprint?: string
}): NativeReaderEvent {
  const locator = options.locator ?? readiumLocatorSchema.parse({
    ...semanticLocator,
    locations: {
      ...semanticLocator.locations,
      progression: options.resourceProgression ?? options.progression,
      totalProgression: options.progression,
    },
  })
  return nativeReaderEventSchema.parse({
    id: `reading-event:reader:test-${options.sequence}`,
    sequence: options.sequence,
    kind: 'location',
    bookId: 'book:left-hand-reader',
    editionId: options.editionId ?? fixtureIds.editions.leftHandEbook,
    assetId: options.assetId ?? fixtureIds.assets.leftHandEpub,
    assetFingerprint: options.assetFingerprint ?? fingerprint,
    sessionId: 'reading-session:reader:test',
    emittedAt: `2026-08-28T12:00:0${options.sequence}.000Z`,
    locator,
    platform: 'ios',
    toolkitVersion: '3.11.0',
  })
}

function nativeEnvelope(sequence: number) {
  return {
    id: `reading-event:reader:navigation-${sequence}`,
    sequence,
    bookId: 'book:left-hand-reader',
    editionId: fixtureIds.editions.leftHandEbook,
    assetId: fixtureIds.assets.leftHandEpub,
    assetFingerprint: fingerprint,
    sessionId: 'reading-session:reader:test',
    emittedAt: `2026-08-28T12:00:0${sequence}.000Z`,
    platform: 'ios' as const,
    toolkitVersion: '3.11.0',
  }
}

function readerAnnotation(): ReaderAnnotation {
  return readerAnnotationSchema.parse({
    id: 'reader-annotation:camp-at-dawn',
    bookId: 'book:left-hand-reader',
    editionId: fixtureIds.editions.leftHandEbook,
    assetId: fixtureIds.assets.leftHandEpub,
    assetFingerprint: fingerprint,
    locator: semanticLocator,
    quote: 'Estraven looked east.',
    prefix: 'The wind had fallen.',
    suffix: 'Dawn found them awake.',
    chapter: 'Chapter Eight',
    color: 'ochre',
    note: 'A moment of trust.',
    tags: normalizeAnnotationTags(['Revisit', 'Character']),
    createdAt: '2026-08-28T12:00:02.000Z',
    updatedAt: '2026-08-28T12:00:02.000Z',
    anchor: { status: 'exact' },
    provenance: { source: 'epub-reader', platform: 'ios', toolkitVersion: '3.11.0' },
  })
}

async function seedImport(
  database: BunSqliteDatabase,
  options: {
    readonly id: string
    readonly assetId: string
    readonly editionId: string
    readonly fingerprint: string
    readonly importedAt: string
  },
) {
  await database.run(
    `INSERT INTO epub_imports(
       id, content_hash, package_identifier, metadata_key, package_version,
       original_name, book_id, edition_id, content_asset_id, cover_asset_id,
       source_record_id, outcome, imported_at, payload_json
     ) VALUES (?, ?, ?, ?, '3', ?, 'book:left-hand-reader', ?, ?, NULL, ?, 'revision', ?, '{}')`,
    [
      options.id,
      options.fingerprint,
      `urn:reader:${options.id}`,
      options.id,
      `${options.id}.epub`,
      options.editionId,
      options.assetId,
      fixtureIds.sources.google,
      options.importedAt,
    ],
  )
}

function readerCapability(assetFingerprint: string): EpubReaderCapability {
  return {
    bookId: 'book:left-hand-reader',
    editionId: fixtureIds.editions.leftHandEbook,
    assetId: fixtureIds.assets.leftHandEpub,
    assetFingerprint,
    relativePath: 'books/left-hand.epub',
    title: 'The Left Hand of Darkness',
  }
}
