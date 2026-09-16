import { describe, expect, test } from 'bun:test'
import { ImportRepository, type ImportProgress } from '../src/storage/import-repository'
import { LibraryRepository } from '../src/storage/library-repository'
import { CatalogRepository } from '../src/storage/catalog-repository'
import { migrateStorage } from '../src/storage/migrations'
import type { SqlRow, SqlStatement, SqlValue } from '../src/storage/database'
import { goodreadsCsvParser } from '../src/imports/csv-parser'
import { BunSqliteDatabase } from './storage-test-database'

class InstrumentedDatabase extends BunSqliteDatabase {
  queries = 0
  batches = 0
  failAfterBatch = Infinity

  override async query<Row extends SqlRow = SqlRow>(statement: string, values?: readonly SqlValue[]): Promise<Row[]> {
    this.queries += 1
    return super.query<Row>(statement, values)
  }

  async runBatch(statements: readonly SqlStatement[]): Promise<void> {
    this.batches += 1
    if (this.batches > this.failAfterBatch) throw new Error('Simulated native batch failure')
    for (const { statement, values } of statements) await super.run(statement, values)
  }
}

function exportCsv(count: number): string {
  return [
    'Book Id,Title,Author,Exclusive Shelf,Date Added,My Rating,Bookshelves,ISBN13,Number of Pages',
    ...Array.from({ length: count }, (_, index) => {
      const digits = `978000${String(index).padStart(6, '0')}`
      const sum = [...digits].reduce((value, digit, position) => value + Number(digit) * (position % 2 ? 3 : 1), 0)
      const isbn = `${digits}${(10 - sum % 10) % 10}`
      return `${index + 1},Book ${index + 1},Author ${index % 200},${index % 3 ? 'to-read' : 'read'},2026/01/01,${index % 3 ? 0 : 4},favorites,${isbn},320`
    }),
  ].join('\n')
}

describe('bounded Goodreads import', () => {
  test('imports 1,820 books with bounded reads, batched writes, progressive preview, and accurate history', async () => {
    const database = new InstrumentedDatabase()
    await migrateStorage(database)
    const imports = new ImportRepository(database)
    database.queries = 0
    const start = performance.now()
    const previewSizes: number[] = []
    const preview = await imports.previewCsv('library.csv', exportCsv(1_820), {
      onPreview: (partial) => previewSizes.push(partial.proposals.length),
    })
    const progress: ImportProgress[] = []
    const result = await imports.commit(preview.id, [], { onProgress: (update) => progress.push(update) })
    const books = await new LibraryRepository(database).list()
    const catalog = await new CatalogRepository(database).read()
    const history = await imports.listRecentBatches()
    expect(performance.now() - start).toBeLessThan(10_000)
    expect(books).toHaveLength(1_820)
    expect(catalog.editions).toHaveLength(1_820)
    expect(catalog.people).toHaveLength(200)
    expect(result).toMatchObject({ appliedRows: 1_820, excludedRows: 0, duplicateRows: 0 })
    expect(history[0]).toMatchObject({ totalRows: 1_820, appliedRows: 1_820, changeCount: result.appliedChanges })
    expect(database.queries).toBeLessThan(75)
    expect(database.batches).toBeLessThan(150)
    expect(previewSizes[0]).toBe(0)
    expect(previewSizes).toContain(100)
    expect(previewSizes.at(-1)).toBe(1_820)
    expect(progress.filter(({ stage }) => stage === 'complete')).toHaveLength(1)
    expect(progress.at(-1)).toEqual({ stage: 'complete', completed: 1_820, total: 1_820 })
    await database.close()
  }, 30_000)

  test('a failure after native chunks have been written rolls back data, receipts, and completion', async () => {
    const database = new InstrumentedDatabase()
    await migrateStorage(database)
    const imports = new ImportRepository(database)
    const preview = await imports.previewCsv('library.csv', exportCsv(220))
    database.failAfterBatch = database.batches + 2
    const progress: ImportProgress[] = []
    await expect(imports.commit(preview.id, [], { onProgress: (update) => progress.push(update) })).rejects.toThrow('Simulated native batch failure')
    expect(await new LibraryRepository(database).list()).toHaveLength(0)
    expect((await new CatalogRepository(database).read()).works).toHaveLength(0)
    expect(await database.query('SELECT id FROM import_row_receipts')).toHaveLength(0)
    expect(await database.query('SELECT id FROM import_changes')).toHaveLength(0)
    expect(progress.some(({ stage }) => stage === 'complete')).toBe(false)
    expect((await imports.listRecentBatches())[0]?.status).toBe('review')
    database.failAfterBatch = Infinity
    expect((await imports.commit(preview.id)).appliedRows).toBe(220)
    await database.close()
  }, 30_000)

  test('two previews staged before the first commit still claim each source row only once', async () => {
    const database = new InstrumentedDatabase()
    await migrateStorage(database)
    const imports = new ImportRepository(database)
    const first = await imports.previewCsv('library.csv', exportCsv(3))
    const second = await imports.previewCsv('library.csv', exportCsv(3))
    await imports.commit(first.id)
    expect(await imports.commit(second.id)).toMatchObject({ appliedChanges: 0, duplicateRows: 3 })
    expect(await new LibraryRepository(database).list()).toHaveLength(3)
    await database.close()
  })

  test('normalizes a valid ISBN-10 copied into the ISBN13 column without losing the source value', () => {
    const [row] = goodreadsCsvParser.parse('Book Id,Title,Author,Exclusive Shelf,ISBN,ISBN13\n1,Example,Author,to-read,9968920312,9968920312')
    expect(goodreadsCsvParser.normalize(row!)).toMatchObject({ ok: true, record: {
      identifiers: ['9968920312', '9789968920315'],
    } })
    expect(row?.raw.isbn13).toBe('9968920312')
    const [invalid] = goodreadsCsvParser.parse('Book Id,Title,Author,Exclusive Shelf,ISBN13\n1,Example,Author,to-read,9968920313')
    expect(goodreadsCsvParser.normalize(invalid!).ok).toBe(false)
  })
})
