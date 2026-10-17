import { expect, test } from 'bun:test'
import { ImportRepository } from '../src/storage/import-repository'
import { PortableArchiveService } from '../src/storage/portable-archive'
import { migrateStorage } from '../src/storage/migrations'
import { BunSqliteDatabase } from './storage-test-database'
import { capacityBook, seedLibrary } from './fixtures/library'

test('books beyond the former limit can be added, edited, replaced and restored', async () => {
  const database = new BunSqliteDatabase()
  try {
    await migrateStorage(database)
    const { library } = await seedLibrary(database)
    for (let i = 31; i <= 100; i++) await library.save(capacityBook(i))
    await library.save({ ...capacityBook(31), shelf: 'finished', notes: 'No purchase needed' })
    expect(await library.list()).toHaveLength(100)
    const archives = new PortableArchiveService(database)
    const backup = await archives.create()
    await library.replace([capacityBook(1)])
    await archives.restore(backup.archive)
    expect(await library.list()).toHaveLength(100)
    expect((await library.list()).find(({ id }) => id === 'capacity-31')?.notes).toBe('No purchase needed')
    await library.save(capacityBook(101))
    expect(await library.list()).toHaveLength(101)
  } finally {
    await database.close()
  }
})

test('CSV batches crossing the former limit commit, undo and retry normally', async () => {
  const database = new BunSqliteDatabase()
  try {
    await migrateStorage(database)
    const { library } = await seedLibrary(database, 29)
    const imports = new ImportRepository(database)
    const preview = await imports.previewCsv('library.csv', 'external_id,title,authors,shelf\na,First addition,A Reader,tbr\nb,Second addition,A Reader,tbr')
    await imports.commit(preview.id)
    expect(await library.list()).toHaveLength(31)
    expect(await database.query('SELECT * FROM import_row_receipts')).toHaveLength(2)
    await imports.undo(preview.id)
    expect(await library.list()).toHaveLength(29)
    const retry = await imports.previewCsv('library.csv', 'external_id,title,authors,shelf\na,First addition,A Reader,tbr\nb,Second addition,A Reader,tbr')
    await imports.commit(retry.id)
    expect(await library.list()).toHaveLength(31)
  } finally {
    await database.close()
  }
})
