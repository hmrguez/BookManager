import { describe, expect, test } from 'bun:test'
import { wovenleafCsvParser } from '../src/imports/csv-parser'
import { importedLibraryBookId } from '../src/imports/commit-rules'
import { createImportPreview, WOVENLEAF_CSV_SOURCE } from '../src/imports/pipeline'
import { libraryBookSchema } from '../src/library-model'
import { ImportRepository } from '../src/storage/import-repository'
import { LibraryRepository } from '../src/storage/library-repository'
import { migrateStorage } from '../src/storage/migrations'
import { BunSqliteDatabase } from './storage-test-database'

const timestamp = '2026-08-25T10:00:00.000Z'
const laterTimestamp = '2026-08-25T12:00:00.000Z'
const fixtureUrl = new URL('./fixtures/imports/wovenleaf-library.csv', import.meta.url)

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
})

describe('durable import repository', () => {
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
