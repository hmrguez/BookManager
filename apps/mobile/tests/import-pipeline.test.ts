import { describe, expect, test } from 'bun:test'
import {
  goodreadsCsvParser,
  isGoodreadsCsv,
  selectCsvParser,
  wovenleafCsvParser,
} from '../src/imports/csv-parser'
import { importedLibraryBookId } from '../src/imports/commit-rules'
import {
  goodreadsCsvFromIncomingUrl,
  IncomingFileDeliveryGuard,
  UnrecognizedGoodreadsCsvError,
} from '../src/imports/incoming'
import {
  createImportPreview,
  GOODREADS_CSV_SOURCE,
  WOVENLEAF_CSV_SOURCE,
} from '../src/imports/pipeline'
import { libraryBookSchema } from '../src/library-model'
import { ImportRepository } from '../src/storage/import-repository'
import { LibraryRepository } from '../src/storage/library-repository'
import { migrateStorage } from '../src/storage/migrations'
import { CatalogRepository } from '../src/storage/catalog-repository'
import { BunSqliteDatabase } from './storage-test-database'

const timestamp = '2026-08-25T10:00:00.000Z'
const laterTimestamp = '2026-08-25T12:00:00.000Z'
const fixtureUrl = new URL('./fixtures/imports/wovenleaf-library.csv', import.meta.url)
const goodreadsFixtureUrl = new URL('./fixtures/imports/goodreads-library.csv', import.meta.url)
const goodreadsEdgeFixtureUrl = new URL('./fixtures/imports/goodreads-edge-cases.csv', import.meta.url)

const existingBook = libraryBookSchema.parse({
  id: 'fixture-left-hand',
  title: 'The Left Hand of Darkness',
  authors: ['Ursula K. Le Guin'],
  pageCount: 304,
  shelf: 'tbr',
  progress: 0,
  currentPage: 0,
  rating: 0,
  notes: 'A local note that the import omits.',
  addedAt: '2026-08-20T10:00:00.000Z',
  lastUpdatedAt: '2026-08-24T10:00:00.000Z',
})

describe('isolated CSV parser', () => {
  test('parses quoted fixture rows and quarantines invalid values during normalization', async () => {
    const rows = wovenleafCsvParser.parse(await Bun.file(fixtureUrl).text())

    expect(rows).toHaveLength(3)
    expect(wovenleafCsvParser.normalize(rows[0]!)).toEqual({
      ok: true,
      record: {
        externalKey: 'fixture-left-hand',
        title: 'The Left Hand of Darkness',
        authors: ['Ursula K. Le Guin'],
        shelf: 'reading',
        pageCount: 304,
        progress: 52,
        currentPage: 158,
        rating: 0,
        notes: 'A careful, quoted note',
      },
    })
    expect(wovenleafCsvParser.normalize(rows[2]!)).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        'Title is required',
        'Page count must be a whole number',
        'Progress must be between 0 and 100',
        'Rating must be between 0 and 5',
        'Unknown shelf “unknown”',
      ]),
    })

    const [unclosed] = wovenleafCsvParser.parse('external_id,title,authors\nbroken,"Unclosed,Author')
    expect(wovenleafCsvParser.normalize(unclosed!)).toEqual({
      ok: false,
      errors: expect.arrayContaining(['The final quoted field is not closed']),
    })
  })

  test('recognizes a renamed Goodreads export by its contract and preserves its migration data', async () => {
    const content = await Bun.file(goodreadsFixtureUrl).text()
    expect(isGoodreadsCsv(content)).toBe(true)
    expect(selectCsvParser('anything.csv', content)).toBe(goodreadsCsvParser)
    expect(isGoodreadsCsv('title,author\nPiranesi,Susanna Clarke')).toBe(false)

    const rows = goodreadsCsvParser.parse(content)
    expect(rows).toHaveLength(2)
    expect(goodreadsCsvParser.normalize(rows[0]!)).toEqual({
      ok: true,
      record: expect.objectContaining({
        externalKey: '18423',
        title: 'The Left Hand of Darkness',
        authors: ['Ursula K. Le Guin'],
        identifiers: ['0441478123', '9780441478125'],
        shelf: 'finished',
        rating: 5,
        pageCount: 304,
        addedAt: '2024-01-03T00:00:00.000Z',
        finishedAt: '2025-02-14T00:00:00.000Z',
        listNames: ['science-fiction', 'favorites'],
        notes: 'Review\nCold, humane, and beautifully strange.\n\nPrivate note\nRevisit the ice crossing.',
        goodreads: expect.objectContaining({
          bookId: '18423',
          averageRating: 4.09,
          readCount: 1,
          ownedCopies: 1,
        }),
      }),
    })
  })

  test('content-detects provider URLs without filenames and rejects unrelated CSVs', async () => {
    const content = await Bun.file(goodreadsFixtureUrl).text()
    const received = await goodreadsCsvFromIncomingUrl(
      `data:text/plain;base64,${btoa(content)}`,
      'download-without-extension',
    )

    expect(received).toEqual({ name: 'download-without-extension', content })
    await expect(goodreadsCsvFromIncomingUrl(
      `data:text/csv;base64,${btoa('title,author\nPiranesi,Susanna Clarke')}`,
    )).rejects.toBeInstanceOf(UnrecognizedGoodreadsCsvError)
  })

  test('coalesces duplicate native delivery callbacks without blocking a later deliberate open', () => {
    const guard = new IncomingFileDeliveryGuard(1_000)

    expect(guard.accept('content://provider/export', 10_000)).toBe(true)
    expect(guard.accept('content://provider/export', 10_100)).toBe(false)
    expect(guard.accept('content://provider/other', 10_100)).toBe(true)
    expect(guard.accept('content://provider/export', 11_000)).toBe(true)
  })

  test('rejects calendar dates that JavaScript would otherwise roll into the next month', () => {
    const [row] = goodreadsCsvParser.parse([
      'Book Id,Title,Author,Exclusive Shelf,Date Added,ISBN',
      '1,Piranesi,Susanna Clarke,read,2025/02/30,',
    ].join('\n'))

    expect(goodreadsCsvParser.normalize(row!)).toEqual({
      ok: false,
      errors: expect.arrayContaining(['Date Added is not a valid date']),
    })
  })

  test('preserves missing identifiers, additional contributors, DNF evidence, and reread counts', async () => {
    const [row] = goodreadsCsvParser.parse(await Bun.file(goodreadsEdgeFixtureUrl).text())
    const normalized = goodreadsCsvParser.normalize(row!)

    expect(normalized).toEqual({
      ok: true,
      record: expect.objectContaining({
        externalKey: '99001',
        title: 'A Book, With a Comma',
        authors: ['Primary Author', 'Second Contributor', 'Third Contributor'],
        identifiers: undefined,
        shelf: 'tbr',
        listNames: ['did-not-finish', 'owned'],
        addedAt: '2026-01-31T00:00:00.000Z',
        goodreads: expect.objectContaining({ readCount: 2, ownedCopies: 0, spoiler: true }),
      }),
    })
  })

  test('accepts current Goodreads numeric formatting and historical publication years', () => {
    const [row] = goodreadsCsvParser.parse([
      'Book Id,Title,Author,Exclusive Shelf,ISBN,ISBN13,My Rating,Original Publication Year',
      '314,An Ancient Work,A. Writer,to-read,="",="",3.0,-399',
    ].join('\n'))

    expect(goodreadsCsvParser.normalize(row!)).toEqual({
      ok: true,
      record: expect.objectContaining({
        externalKey: '314',
        rating: 3,
        identifiers: undefined,
        goodreads: expect.objectContaining({
          isbn10: undefined,
          isbn13: undefined,
          originalPublicationYear: -399,
        }),
      }),
    })
  })

  test('fails a Goodreads-like schema closed and handles a large export deterministically', () => {
    const changedSchema = [
      'Book Id,Title,Author,Author l-f,ISBN13,My Rating,Bookshelves with positions,Read Count,Owned Copies',
      '1,Piranesi,Susanna Clarke,"Clarke, Susanna",9781635575637,5,,1,1',
    ].join('\n')
    expect(() => selectCsvParser('library.csv', changedSchema)).toThrow(
      'missing: exclusive_shelf',
    )

    const header = 'Book Id,Title,Author,Exclusive Shelf,Date Added'
    const content = [
      header,
      ...Array.from({ length: 10_000 }, (_, index) =>
        `${index + 1},Book ${index + 1},Author ${index + 1},to-read,2026/01/01`),
    ].join('\n')
    const rows = goodreadsCsvParser.parse(content)
    expect(rows).toHaveLength(10_000)
    expect(goodreadsCsvParser.normalize(rows.at(-1)!)).toMatchObject({
      ok: true,
      record: { externalKey: '10000', title: 'Book 10000' },
    })
  })
})

describe('previewable import pipeline', () => {
  test('shows adds, updates, low-confidence matches, validation errors, rationale, and permissions', async () => {
    const content = [
      'external_id,title,authors,shelf,page_count',
      'fixture-left-hand,The Left Hand of Darkness,Ursula K. Le Guin,reading,304',
      'different-source-id,The Left Hand of Darkness,Ursula K. Le Guin,tbr,304',
      'new-book,Piranesi,Susanna Clarke,tbr,272',
      'broken,,Unknown,invalid,nope',
    ].join('\n')
    const preview = await createImportPreview({
      id: 'import-batch:preview',
      fileName: 'library.csv',
      content,
      createdAt: timestamp,
      parser: wovenleafCsvParser,
      source: WOVENLEAF_CSV_SOURCE,
      existingBooks: [existingBook],
    })

    expect(preview.completedStages).toEqual(['parse', 'normalize', 'match', 'propose', 'review'])
    expect(preview.source.permissions.map(({ scope }) => scope)).toEqual([
      'local-file:read',
      'library:write',
      'network:none',
    ])
    expect(preview.proposals.map(({ kind }) => kind)).toEqual([
      'update',
      'update',
      'add',
      'error',
    ])
    expect(preview.proposals[1]).toMatchObject({
      defaultIncluded: false,
      match: {
        confidence: 'low',
        reasons: ['Normalized titles are identical.', 'At least one normalized author is identical.'],
      },
    })
    expect(preview.proposals[0]?.changes.map(({ field }) => field)).toContain('shelf')
    expect(preview.proposals[3]?.validationErrors.length).toBeGreaterThan(1)
  })

  test('never guesses when title-and-author evidence points to multiple records', async () => {
    const duplicateCandidate = libraryBookSchema.parse({
      ...existingBook,
      id: 'another-left-hand-edition',
      shelf: 'next',
    })
    const preview = await createImportPreview({
      id: 'import-batch:conflict',
      fileName: 'ambiguous.csv',
      content: [
        'external_id,title,authors,shelf,page_count',
        'unrelated-source-id,The Left Hand of Darkness,Ursula K. Le Guin,reading,304',
      ].join('\n'),
      createdAt: timestamp,
      parser: wovenleafCsvParser,
      existingBooks: [existingBook, duplicateCandidate],
    })

    expect(preview.proposals[0]).toMatchObject({
      kind: 'conflict',
      defaultIncluded: false,
      match: { confidence: 'low' },
    })
    expect(preview.proposals[0]?.targetId).toBeUndefined()
    expect(preview.proposals[0]?.match.candidates.map(({ targetId }) => targetId)).toEqual([
      'another-left-hand-edition',
      'fixture-left-hand',
    ])
  })

  test('matches equivalent ISBN-10 and ISBN-13 values before fuzzy title evidence', async () => {
    const localEdition = libraryBookSchema.parse({
      ...existingBook,
      identifiers: ['9780441478125'],
    })
    const content = [
      'Book Id,Title,Author,ISBN,ISBN13,Exclusive Shelf,Date Added',
      '18423,A translated title,Ursula K. Le Guin,0441478123,,read,2024/01/03',
    ].join('\n')
    const preview = await createImportPreview({
      id: 'import-batch:isbn-equivalence',
      fileName: 'renamed.csv',
      content,
      createdAt: timestamp,
      parser: goodreadsCsvParser,
      source: GOODREADS_CSV_SOURCE,
      existingBooks: [localEdition],
    })

    expect(preview.proposals[0]).toMatchObject({
      targetId: localEdition.id,
      defaultIncluded: true,
      match: { confidence: 'high', reasons: ['An edition ISBN matches exactly.'] },
    })
  })
})

describe('durable import repository', () => {
  test('commits and undoes a Goodreads export across compatibility and canonical records', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const repository = createRepository(database)
    const content = await Bun.file(goodreadsFixtureUrl).text()

    const preview = await repository.previewCsv('renamed-library.csv', content)
    expect(preview.source.key).toBe('goodreads-csv')
    expect(preview.proposals).toHaveLength(2)
    expect(preview.proposals[0]?.entities.map(({ entityType }) => entityType)).toEqual(
      expect.arrayContaining([
        'work',
        'edition',
        'source-record',
        'identifier',
        'person',
        'contributor',
        'list',
        'list-entry',
        'integration-checkpoint',
        'reading-event',
        'progress-snapshot',
      ]),
    )
    expect(preview.proposals[0]?.entities[0]).toMatchObject({
      sourceKey: 'goodreads-csv',
      confidence: 'none',
      rationale: expect.any(String),
    })

    const committed = await repository.commit(preview.id)
    expect(committed.appliedRows).toBe(2)
    expect(committed.appliedChanges).toBeGreaterThan(20)
    const books = await new LibraryRepository(database).list()
    expect(books).toHaveLength(2)
    expect(books[0]).toMatchObject({
      shelf: 'finished',
      progress: 100,
      rating: 5,
      sourceNames: ['Goodreads'],
      listNames: ['science-fiction', 'favorites'],
    })
    const catalog = await new CatalogRepository(database).read()
    expect(catalog.works).toHaveLength(2)
    expect(catalog.editions).toHaveLength(2)
    expect(catalog.sourceRecords).toHaveLength(2)
    expect(catalog.integrationCheckpoints).toHaveLength(1)
    expect(catalog.readingEvents.some(({ kind }) => kind === 'finish')).toBe(true)
    expect(catalog.lists.map(({ slug }) => slug)).toEqual(expect.arrayContaining([
      'goodreads-read',
      'goodreads-science-fiction',
      'goodreads-currently-reading',
    ]))

    const undo = await repository.undo(preview.id)
    expect(undo.preservedChanges).toBe(0)
    expect(await new LibraryRepository(database).list()).toEqual([])
    const restoredCatalog = await new CatalogRepository(database).read()
    expect(restoredCatalog.works).toEqual([])
    expect(restoredCatalog.sourceRecords).toEqual([])

    const repeated = await repository.previewCsv('different-name.csv', content)
    expect(repeated.proposals.every(({ kind }) => kind === 'add')).toBe(true)
    await database.close()
  })

  test('maps unknown-role contributors and preserves future source columns without guessing', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const repository = createRepository(database)
    const preview = await repository.previewCsv(
      'edge-cases.csv',
      await Bun.file(goodreadsEdgeFixtureUrl).text(),
    )
    await repository.commit(preview.id)

    const catalog = await new CatalogRepository(database).read()
    expect(catalog.contributors.map(({ role }) => role)).toEqual(['author', 'other', 'other'])
    expect(catalog.lists.map(({ slug }) => slug)).toEqual(expect.arrayContaining([
      'goodreads-to-read',
      'goodreads-did-not-finish',
      'goodreads-owned',
    ]))
    expect(catalog.sourceRecords[0]?.rawPayload).toMatchObject({
      revisions: [{ row: { future_column: 'future evidence' } }],
    })
    await database.close()
  })

  test('treats a revised Goodreads export as new evidence without overwriting an existing local rating', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    let now = timestamp
    let sequence = 0
    const repository = new ImportRepository(database, {
      now: () => new Date(now),
      createId: (kind) => `import-${kind}:revision-${sequence += 1}`,
    })
    const content = await Bun.file(goodreadsFixtureUrl).text()
    const firstContent = [content.split('\n')[0], content.split('\n')[1]].join('\n')
    const first = await repository.previewCsv('first.csv', firstContent)
    await repository.commit(first.id)

    now = laterTimestamp
    const revisedContent = firstContent
      .replace(',5,4.09,', ',4,4.09,')
      .replace('Cold, humane, and beautifully strange.', 'A revised Goodreads review.')
    const revised = await repository.previewCsv('revised.csv', revisedContent)
    expect(revised.proposals[0]).toMatchObject({ kind: 'update', defaultIncluded: true })
    const committed = await repository.commit(revised.id)
    expect(committed.appliedChanges).toBeGreaterThan(0)
    expect((await new LibraryRepository(database).list())[0]?.rating).toBe(5)
    const revisedCatalog = await new CatalogRepository(database).read()
    expect(revisedCatalog.readingEvents.filter(({ kind }) => kind === 'rating')).toHaveLength(2)
    expect(revisedCatalog.sourceRecords[0]?.claims.some(({ observedAt }) => observedAt === timestamp)).toBe(true)
    expect(revisedCatalog.sourceRecords[0]?.claims.some(({ observedAt }) => observedAt === laterTimestamp)).toBe(true)
    expect(revisedCatalog.sourceRecords[0]?.rawPayload).toMatchObject({
      format: 'goodreads-library-export',
      latestRowHash: revised.proposals[0]?.rowHash,
      revisions: [{ rowHash: first.proposals[0]?.rowHash }, { rowHash: revised.proposals[0]?.rowHash }],
    })

    const undone = await repository.undo(revised.id)
    expect(undone.preservedChanges).toBe(0)
    const restoredCatalog = await new CatalogRepository(database).read()
    expect(restoredCatalog.readingEvents.filter(({ kind }) => kind === 'rating')).toHaveLength(1)
    expect(restoredCatalog.sourceRecords[0]?.claims.every(({ observedAt }) => observedAt === timestamp)).toBe(true)
    expect(restoredCatalog.sourceRecords[0]?.rawPayload).toMatchObject({
      latestRowHash: first.proposals[0]?.rowHash,
      revisions: [{ rowHash: first.proposals[0]?.rowHash }],
    })
    await database.close()
  })

  test('commits the same file twice with zero duplicate changes and durable checkpoints', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const repository = createRepository(database)
    const csv = [
      'external_id,title,authors,shelf,page_count',
      'source-piranesi,Piranesi,Susanna Clarke,tbr,272',
    ].join('\n')

    const firstPreview = await repository.previewCsv('library.csv', csv)
    const first = await repository.commit(firstPreview.id)
    const secondPreview = await repository.previewCsv('library.csv', csv)
    const second = await repository.commit(secondPreview.id)

    expect(first).toMatchObject({ appliedRows: 1, appliedChanges: 1, duplicateRows: 0 })
    expect(second).toMatchObject({ appliedRows: 0, appliedChanges: 0, duplicateRows: 1 })
    expect(await new LibraryRepository(database).list()).toHaveLength(1)
    const checkpoints = await database.query(
      'SELECT id, previous_checkpoint_id FROM import_checkpoints ORDER BY committed_at, id',
    )
    expect(checkpoints).toHaveLength(2)
    expect(checkpoints[1]?.previous_checkpoint_id).toBe(checkpoints[0]?.id)
    await database.close()
  })

  test('previews an identical Goodreads export without projecting its reading events twice', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    let now = timestamp
    let sequence = 0
    const repository = new ImportRepository(database, {
      now: () => new Date(now),
      createId: (kind) => `import-${kind}:repeat-goodreads-${sequence += 1}`,
    })
    const content = await Bun.file(goodreadsFixtureUrl).text()

    const firstPreview = await repository.previewCsv('first-goodreads.csv', content)
    await repository.commit(firstPreview.id)
    now = laterTimestamp
    const repeatedPreview = await repository.previewCsv('repeated-goodreads.csv', content)
    const repeated = await repository.commit(repeatedPreview.id)

    expect(repeatedPreview.proposals.every(({ kind, duplicateOfBatchId }) =>
      kind === 'skip' && duplicateOfBatchId,
    )).toBe(true)
    expect(repeated).toMatchObject({ appliedRows: 0, appliedChanges: 0, duplicateRows: 2 })
    const catalog = await new CatalogRepository(database).read()
    expect(new Set(catalog.readingEvents.map(({ id }) => id)).size).toBe(catalog.readingEvents.length)
    await database.close()
  })

  test('allows a low-confidence row to be excluded or explicitly remapped', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const library = new LibraryRepository(database)
    await library.save(existingBook)
    const remapTarget = libraryBookSchema.parse({
      ...existingBook,
      id: 'reader-selected-target',
      title: 'A different local record',
      authors: ['Local Author'],
    })
    await library.save(remapTarget)
    const repository = createRepository(database)
    const csv = [
      'external_id,title,authors,shelf,page_count',
      'foreign-id,The Left Hand of Darkness,Ursula K. Le Guin,reading,304',
    ].join('\n')

    const excludedPreview = await repository.previewCsv('excluded.csv', csv)
    const excluded = await repository.commit(excludedPreview.id)
    expect(excluded).toMatchObject({ appliedRows: 0, excludedRows: 1 })
    expect((await library.list())[0]?.shelf).toBe('tbr')

    const remappedPreview = await repository.previewCsv('remapped.csv', csv)
    const proposal = remappedPreview.proposals[0]!
    const committed = await repository.commit(remappedPreview.id, [{
      rowId: proposal.id,
      included: true,
      targetId: remapTarget.id,
      targetUpdatedAt: remapTarget.lastUpdatedAt,
    }])
    expect(proposal.match.reasons).toContain('Normalized titles are identical.')
    expect(committed.appliedChanges).toBeGreaterThan(0)
    const stored = await library.list()
    expect(stored.find(({ id }) => id === existingBook.id)?.shelf).toBe('tbr')
    expect(stored.find(({ id }) => id === remapTarget.id)).toMatchObject({
      title: 'The Left Hand of Darkness',
      authors: ['Ursula K. Le Guin'],
      shelf: 'reading',
    })
    await database.close()
  })

  test('stops a stale preview instead of overwriting a later edit to an affected field', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const library = new LibraryRepository(database)
    await library.save(existingBook)
    const repository = createRepository(database)
    const preview = await repository.previewCsv('stale.csv', [
      'external_id,title,authors,shelf,page_count',
      'fixture-left-hand,The Left Hand of Darkness,Ursula K. Le Guin,reading,304',
    ].join('\n'))
    await library.save({ ...existingBook, shelf: 'next', lastUpdatedAt: laterTimestamp })

    await expect(repository.commit(preview.id)).rejects.toThrow(
      'shelf changed after preview; review it again',
    )
    expect((await library.list())[0]?.shelf).toBe('next')
    expect(await database.query('SELECT status FROM import_batches WHERE id = ?', [preview.id])).toEqual([
      { status: 'review' },
    ])
    await database.close()
  })

  test('undo restores exact pre-import state while preserving a later unrelated edit', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const library = new LibraryRepository(database)
    await library.save(existingBook)
    const repository = createRepository(database)
    const csv = [
      'external_id,title,authors,shelf,page_count,progress,current_page',
      'fixture-left-hand,The Left Hand of Darkness,Ursula K. Le Guin,reading,304,50,152',
    ].join('\n')
    const preview = await repository.previewCsv('update.csv', csv)
    await repository.commit(preview.id)
    const imported = (await library.list())[0]!
    await library.save({ ...imported, notes: 'Written after the import.', lastUpdatedAt: laterTimestamp })

    const undo = await repository.undo(preview.id)
    const restored = (await library.list())[0]!

    expect(restored).toMatchObject({
      shelf: existingBook.shelf,
      progress: existingBook.progress,
      currentPage: existingBook.currentPage,
      notes: 'Written after the import.',
      lastUpdatedAt: laterTimestamp,
    })
    expect(undo.restoredChanges).toBeGreaterThan(0)
    expect(undo.preservedChanges).toBe(1)
    await database.close()
  })

  test('undo round-trips an updated record exactly when no later edit owns its fields', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const library = new LibraryRepository(database)
    await library.save(existingBook)
    const repository = createRepository(database)
    const preview = await repository.previewCsv('round-trip.csv', [
      'external_id,title,authors,shelf,page_count,progress,current_page,rating',
      'fixture-left-hand,The Left Hand of Darkness,Ursula K. Le Guin,reading,304,50,152,4',
    ].join('\n'))

    await repository.commit(preview.id)
    await repository.undo(preview.id)

    expect(await library.list()).toEqual([existingBook])
    await database.close()
  })

  test('undo removes an unchanged imported add and permits a safe repeat import', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const repository = createRepository(database)
    const csv = [
      'external_id,title,authors,shelf,page_count',
      'source-piranesi,Piranesi,Susanna Clarke,tbr,272',
    ].join('\n')
    const preview = await repository.previewCsv('library.csv', csv)
    await repository.commit(preview.id)

    expect(await repository.undo(preview.id)).toMatchObject({
      restoredChanges: 1,
      preservedChanges: 0,
      deletedEntities: 1,
    })
    expect(await new LibraryRepository(database).list()).toEqual([])

    const repeated = await repository.previewCsv('library.csv', csv)
    expect(repeated.proposals[0]).toMatchObject({
      kind: 'add',
      targetId: importedLibraryBookId('wovenleaf-csv', 'source-piranesi'),
    })
    await database.close()
  })
})

function createRepository(database: BunSqliteDatabase): ImportRepository {
  let sequence = 0
  return new ImportRepository(database, {
    now: () => new Date(timestamp),
    createId: (kind) => `import-${kind}:test-${sequence += 1}`,
  })
}
