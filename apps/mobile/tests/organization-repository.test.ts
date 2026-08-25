import { describe, expect, test } from 'bun:test'
import { libraryBookSchema } from '../src/library-model'
import {
  customShelfSchema,
  normalizeTagName,
  organizationTagSchema,
} from '../src/organization-model'
import { LibraryRepository } from '../src/storage/library-repository'
import { migrateStorage, STORAGE_MIGRATIONS } from '../src/storage/migrations'
import { OrganizationRepository } from '../src/storage/organization-repository'
import { BunSqliteDatabase } from './storage-test-database'

const timestamp = '2026-08-26T10:00:00.000Z'

describe('custom shelf and tag organization', () => {
  test('adds organization storage without changing any existing default-shelf state', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database, { migrations: STORAGE_MIGRATIONS.slice(0, 3) })
    const library = new LibraryRepository(database)
    const existing = libraryBookSchema.parse({
      id: 'book:before-organization-migration',
      title: 'Parable of the Sower',
      authors: ['Octavia E. Butler'],
      pageCount: 345,
      shelf: 'next',
      progress: 12,
      currentPage: 41,
      rating: 0,
      notes: '',
      addedAt: timestamp,
      lastUpdatedAt: timestamp,
    })
    await library.save(existing)

    await migrateStorage(database)

    expect(await library.list()).toEqual([existing])
    expect(await new OrganizationRepository(database).read()).toEqual({
      shelves: [], entries: [], tags: [], bookTags: [],
    })
    await database.close()
  })

  test('keeps reading status independent while a book belongs to multiple ordered shelves', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const library = new LibraryRepository(database)
    const organization = new OrganizationRepository(database)
    const book = libraryBookSchema.parse({
      id: 'book:independent-status',
      title: 'The Dispossessed',
      authors: ['Ursula K. Le Guin'],
      pageCount: 387,
      shelf: 'reading',
      progress: 36,
      currentPage: 139,
      rating: 0,
      notes: '',
      addedAt: timestamp,
      startedAt: timestamp,
      lastUpdatedAt: timestamp,
    })
    await library.save(book)
    const favorites = shelf('shelf:favorites', 'Favorites', 1_024)
    const speculative = shelf('shelf:speculative', 'Speculative fiction', 2_048)
    await organization.saveShelf(favorites)
    await organization.saveShelf(speculative)

    await organization.replaceBookMemberships(book.id, [favorites.id, speculative.id])

    expect((await organization.read()).entries.map(({ shelfId }) => shelfId)).toEqual([
      favorites.id,
      speculative.id,
    ])
    expect((await library.list())[0]).toMatchObject({ shelf: 'reading', progress: 36 })
    await database.close()
  })

  test('batch membership and numeric ordering remain bounded for thousands of entries', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const organization = new OrganizationRepository(database)
    const collection = shelf('shelf:scale', 'Longlist', 1_024)
    await organization.saveShelf(collection)
    const bookIds = Array.from({ length: 2_500 }, (_, index) => `book:scale:${index.toString().padStart(4, '0')}`)

    await organization.replaceShelfMembersInOrder(collection.id, bookIds)
    await organization.moveShelfEntry(collection.id, bookIds.at(-1)!, 0)

    const stored = await organization.read()
    const orderedIds = stored.entries
      .filter(({ shelfId }) => shelfId === collection.id)
      .sort((left, right) => left.position - right.position)
      .map(({ bookId }) => bookId)
    expect(orderedIds).toHaveLength(2_500)
    expect(orderedIds[0]).toBe(bookIds.at(-1))
    expect(new Set(stored.entries.map(({ position }) => position)).size).toBe(2_500)

    const plan = await database.query<{ readonly detail: string }>(
      `EXPLAIN QUERY PLAN
       SELECT payload_json FROM custom_shelf_entries
       WHERE shelf_id = ? ORDER BY position, id LIMIT 80`,
      [collection.id],
    )
    const planText = plan.map(({ detail }) => detail).join('\n')
    expect(planText).toContain('USING INDEX')
    expect(planText).not.toContain('TEMP B-TREE')
    await database.close()
  })

  test('supports multi-value tags and deleting a shelf removes membership but not books', async () => {
    const database = new BunSqliteDatabase()
    await migrateStorage(database)
    const library = new LibraryRepository(database)
    const organization = new OrganizationRepository(database)
    const book = libraryBookSchema.parse({
      id: 'book:tags',
      title: 'Piranesi',
      authors: ['Susanna Clarke'],
      pageCount: 272,
      shelf: 'finished',
      progress: 100,
      currentPage: 272,
      rating: 5,
      notes: '',
      addedAt: timestamp,
      finishedAt: timestamp,
      lastUpdatedAt: timestamp,
    })
    await library.save(book)
    const collection = shelf('shelf:strange-houses', 'Strange houses', 1_024)
    await organization.saveShelf(collection)
    await organization.replaceShelfMembers(collection.id, [book.id])
    await organization.replaceBookTags(book.id, [tag('tag:dreamlike', 'Dreamlike'), tag('tag:short', 'Short')])

    expect((await organization.read()).bookTags).toHaveLength(2)
    await organization.saveShelf({ ...collection, archived: true, updatedAt: '2026-08-26T11:00:00.000Z' })
    expect(await organization.read()).toMatchObject({
      shelves: [{ id: collection.id, archived: true }],
      entries: [{ bookId: book.id, shelfId: collection.id }],
    })
    await organization.removeShelf(collection.id)

    const stored = await organization.read()
    expect(stored.shelves).toEqual([])
    expect(stored.entries).toEqual([])
    expect(stored.tags.map(({ name }) => name)).toEqual(['Dreamlike', 'Short'])
    expect(await library.list()).toEqual([book])
    await database.close()
  })
})

function shelf(id: string, name: string, position: number) {
  return customShelfSchema.parse({
    id,
    name,
    notes: '',
    pinned: false,
    archived: false,
    position,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
}

function tag(id: string, name: string) {
  return organizationTagSchema.parse({
    id,
    name,
    normalizedName: normalizeTagName(name),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
}
