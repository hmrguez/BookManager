import { describe, expect, test } from 'bun:test'
import { createStarterLibrary, libraryBookSchema } from '../src/library-model'
import { LibraryRepository } from '../src/storage/library-repository'
import { migrateStorage } from '../src/storage/migrations'
import { BunSqliteDatabase } from './storage-test-database'

const savedBook = libraryBookSchema.parse({
  id: 'existing-development-book',
  title: 'The Left Hand of Darkness',
  authors: ['Ursula K. Le Guin'],
  pageCount: 304,
  shelf: 'reading',
  progress: 42,
  currentPage: 128,
  rating: 0,
  notes: 'Keep this note in SQLite.',
  addedAt: '2026-08-20T10:00:00.000Z',
  startedAt: '2026-08-21T10:00:00.000Z',
  lastUpdatedAt: '2026-08-24T10:00:00.000Z',
})

describe('Wovenleaf library repository', () => {
  test('keeps a new library empty until the reader adds a book', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const repository = new LibraryRepository(database)

    expect(await repository.list()).toEqual([])
    await database.close()
  })

  test('retires untouched placeholder books without deleting reader changes', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const repository = new LibraryRepository(database)
    const [untouched, changed] = createStarterLibrary('2026-08-20T10:00:00.000Z')
    if (!untouched || !changed) throw new Error('Expected two starter books')
    const changedByReader = {
      ...changed,
      notes: 'Keep my progress and notes.',
    }

    await repository.save(untouched)
    await repository.save(changedByReader)
    await repository.save(savedBook)

    expect(await repository.retireUntouchedStarterBooks()).toBe(1)
    expect((await repository.list()).map(({ id }) => id)).toEqual([changedByReader.id, savedBook.id])
    await database.close()
  })

  test('upserts and removes without exposing SQL to the caller', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const repository = new LibraryRepository(database)

    await repository.save(savedBook)
    await repository.save({ ...savedBook, shelf: 'finished', progress: 100 })
    expect(await repository.list()).toEqual([{ ...savedBook, shelf: 'finished', progress: 100 }])

    await repository.remove(savedBook.id)
    expect(await repository.list()).toEqual([])
    await database.close()
  })
})
