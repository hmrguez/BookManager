import { z } from 'zod'
import {
  bookTagSchema,
  customShelfEntrySchema,
  customShelfSchema,
  libraryOrganizationSchema,
  ORGANIZATION_POSITION_STEP,
  organizationTagSchema,
  type BookTag,
  type CustomShelf,
  type CustomShelfEntry,
  type LibraryOrganization,
  type OrganizationTag,
} from '../organization-model'
import type { SqlDatabase } from './database'
import { readText } from './database'

export class OrganizationRepository {
  readonly #database: SqlDatabase

  constructor(database: SqlDatabase) {
    this.#database = database
  }

  async read(): Promise<LibraryOrganization> {
    const [shelves, entries, tags, bookTags] = await Promise.all([
      readPayloads(this.#database, 'custom_shelves', customShelfSchema, 'position, id'),
      readPayloads(
        this.#database,
        'custom_shelf_entries',
        customShelfEntrySchema,
        'shelf_id, position, id',
      ),
      readPayloads(this.#database, 'organization_tags', organizationTagSchema, 'normalized_name, id'),
      readPayloads(this.#database, 'library_book_tags', bookTagSchema, 'book_id, tag_id'),
    ])
    return libraryOrganizationSchema.parse({ shelves, entries, tags, bookTags })
  }

  async saveShelf(shelf: CustomShelf): Promise<void> {
    await writeShelf(this.#database, customShelfSchema.parse(shelf))
    await this.#database.persist()
  }

  async removeShelf(id: string): Promise<void> {
    await this.#database.transaction(async (database) => {
      await database.run('DELETE FROM custom_shelf_entries WHERE shelf_id = ?', [id])
      await database.run('DELETE FROM custom_shelves WHERE id = ?', [id])
    })
  }

  async replaceShelfMembers(shelfId: string, bookIds: readonly string[]): Promise<void> {
    const requestedIds = uniqueNonEmpty(bookIds)
    await this.#assertShelfExists(shelfId)
    const current = await this.#entriesForShelf(shelfId)
    const retainedIds = new Set(requestedIds)
    const existingIds = new Set(current.map(({ bookId }) => bookId))
    const timestamp = new Date().toISOString()
    let position = current.reduce((maximum, entry) => Math.max(maximum, entry.position), 0)

    await this.#database.transaction(async (database) => {
      for (const entry of current) {
        if (!retainedIds.has(entry.bookId)) {
          await database.run('DELETE FROM custom_shelf_entries WHERE id = ?', [entry.id])
        }
      }
      for (const bookId of requestedIds) {
        if (existingIds.has(bookId)) continue
        position += ORGANIZATION_POSITION_STEP
        await writeEntry(database, {
          id: organizationId('shelf-entry'),
          shelfId,
          bookId,
          position,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
      }
    })
  }

  async replaceShelfMembersInOrder(shelfId: string, bookIds: readonly string[]): Promise<void> {
    const requestedIds = uniqueNonEmpty(bookIds)
    await this.#assertShelfExists(shelfId)
    const existing = await this.#entriesForShelf(shelfId)
    const existingByBookId = new Map(existing.map((entry) => [entry.bookId, entry]))
    const requested = new Set(requestedIds)
    const timestamp = new Date().toISOString()

    await this.#database.transaction(async (database) => {
      await database.run(
        'UPDATE custom_shelf_entries SET position = position + ? WHERE shelf_id = ?',
        [1_000_000_000, shelfId],
      )
      for (const entry of existing) {
        if (!requested.has(entry.bookId)) {
          await database.run('DELETE FROM custom_shelf_entries WHERE id = ?', [entry.id])
        }
      }
      for (const [index, bookId] of requestedIds.entries()) {
        const previous = existingByBookId.get(bookId)
        await writeEntry(database, {
          id: previous?.id ?? organizationId('shelf-entry'),
          shelfId,
          bookId,
          position: (index + 1) * ORGANIZATION_POSITION_STEP,
          createdAt: previous?.createdAt ?? timestamp,
          updatedAt: timestamp,
        })
      }
    })
  }

  async replaceBookMemberships(bookId: string, shelfIds: readonly string[]): Promise<void> {
    const requestedIds = uniqueNonEmpty(shelfIds)
    const knownShelfIds = new Set(
      (await this.#database.query('SELECT id FROM custom_shelves')).map((row) => readText(row, 'id')),
    )
    for (const shelfId of requestedIds) {
      if (!knownShelfIds.has(shelfId)) throw new Error(`Unknown custom shelf ${shelfId}`)
    }

    const current = await this.#database.query('SELECT shelf_id FROM custom_shelf_entries WHERE book_id = ?', [bookId])
    const currentIds = new Set(current.map((row) => readText(row, 'shelf_id')))
    const requested = new Set(requestedIds)
    const timestamp = new Date().toISOString()

    await this.#database.transaction(async (database) => {
      for (const shelfId of currentIds) {
        if (!requested.has(shelfId)) {
          await database.run(
            'DELETE FROM custom_shelf_entries WHERE shelf_id = ? AND book_id = ?',
            [shelfId, bookId],
          )
        }
      }
      for (const shelfId of requestedIds) {
        if (currentIds.has(shelfId)) continue
        const [{ maximum = 0 } = {}] = await database.query<{ readonly maximum: number }>(
          'SELECT COALESCE(MAX(position), 0) AS maximum FROM custom_shelf_entries WHERE shelf_id = ?',
          [shelfId],
        )
        await writeEntry(database, {
          id: organizationId('shelf-entry'),
          shelfId,
          bookId,
          position: maximum + ORGANIZATION_POSITION_STEP,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
      }
    })
  }

  async moveShelfEntry(shelfId: string, bookId: string, targetIndex: number): Promise<void> {
    const current = await this.#entriesForShelf(shelfId)
    const sourceIndex = current.findIndex((entry) => entry.bookId === bookId)
    if (sourceIndex === -1) throw new Error('That book is not on this custom shelf')
    const boundedTarget = Math.max(0, Math.min(current.length - 1, Math.round(targetIndex)))
    if (sourceIndex === boundedTarget) return

    const [moved] = current.splice(sourceIndex, 1)
    current.splice(boundedTarget, 0, moved)
    let nextPosition = positionForIndex(current, boundedTarget)

    await this.#database.transaction(async (database) => {
      if (nextPosition === undefined) {
        await rebalanceEntries(database, current)
        nextPosition = (boundedTarget + 1) * ORGANIZATION_POSITION_STEP
      }
      await writeEntry(database, {
        ...moved,
        position: nextPosition,
        updatedAt: new Date().toISOString(),
      })
    })
  }

  async replaceBookTags(bookId: string, tags: readonly OrganizationTag[]): Promise<void> {
    const validatedTags = tags.map((tag) => organizationTagSchema.parse(tag))
    const normalizedNames = new Set<string>()
    for (const tag of validatedTags) {
      if (normalizedNames.has(tag.normalizedName)) throw new Error(`Duplicate tag ${tag.name}`)
      normalizedNames.add(tag.normalizedName)
    }
    const timestamp = new Date().toISOString()

    await this.#database.transaction(async (database) => {
      await database.run('DELETE FROM library_book_tags WHERE book_id = ?', [bookId])
      for (const tag of validatedTags) {
        await writeTag(database, tag)
        await writeBookTag(database, { tagId: tag.id, bookId, createdAt: timestamp })
      }
      await database.run(
        `DELETE FROM organization_tags
         WHERE NOT EXISTS (
           SELECT 1 FROM library_book_tags WHERE library_book_tags.tag_id = organization_tags.id
         )`,
      )
    })
  }

  async removeBook(bookId: string): Promise<void> {
    await this.#database.transaction(async (database) => {
      await database.run('DELETE FROM custom_shelf_entries WHERE book_id = ?', [bookId])
      await database.run('DELETE FROM library_book_tags WHERE book_id = ?', [bookId])
      await database.run(
        `DELETE FROM organization_tags
         WHERE NOT EXISTS (
           SELECT 1 FROM library_book_tags WHERE library_book_tags.tag_id = organization_tags.id
         )`,
      )
    })
  }

  async replace(organization: LibraryOrganization): Promise<void> {
    const validated = libraryOrganizationSchema.parse(organization)
    await this.#database.transaction(async (database) => {
      await replaceOrganization(database, validated)
    })
  }

  async #assertShelfExists(shelfId: string): Promise<void> {
    const rows = await this.#database.query('SELECT id FROM custom_shelves WHERE id = ?', [shelfId])
    if (!rows.length) throw new Error(`Unknown custom shelf ${shelfId}`)
  }

  async #entriesForShelf(shelfId: string): Promise<CustomShelfEntry[]> {
    const rows = await this.#database.query(
      `SELECT payload_json FROM custom_shelf_entries
       WHERE shelf_id = ? ORDER BY position, id`,
      [shelfId],
    )
    return rows.map((row) => customShelfEntrySchema.parse(JSON.parse(readText(row, 'payload_json'))))
  }
}

export async function readLibraryOrganization(database: SqlDatabase): Promise<LibraryOrganization> {
  return new OrganizationRepository(database).read()
}

export async function replaceOrganization(
  database: SqlDatabase,
  organization: LibraryOrganization,
): Promise<void> {
  const validated = libraryOrganizationSchema.parse(organization)
  await database.run('DELETE FROM library_book_tags')
  await database.run('DELETE FROM organization_tags')
  await database.run('DELETE FROM custom_shelf_entries')
  await database.run('DELETE FROM custom_shelves')
  for (const shelf of validated.shelves) await writeShelf(database, shelf)
  for (const entry of validated.entries) await writeEntry(database, entry)
  for (const tag of validated.tags) await writeTag(database, tag)
  for (const bookTag of validated.bookTags) await writeBookTag(database, bookTag)
}

async function writeShelf(database: SqlDatabase, input: CustomShelf): Promise<void> {
  const shelf = customShelfSchema.parse(input)
  await database.run(
    `INSERT INTO custom_shelves(
       id, name, pinned, archived, position, created_at, updated_at, payload_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       pinned = excluded.pinned,
       archived = excluded.archived,
       position = excluded.position,
       updated_at = excluded.updated_at,
       payload_json = excluded.payload_json`,
    [
      shelf.id,
      shelf.name,
      shelf.pinned ? 1 : 0,
      shelf.archived ? 1 : 0,
      shelf.position,
      shelf.createdAt,
      shelf.updatedAt,
      JSON.stringify(shelf),
    ],
  )
}

async function writeEntry(database: SqlDatabase, input: CustomShelfEntry): Promise<void> {
  const entry = customShelfEntrySchema.parse(input)
  await database.run(
    `INSERT INTO custom_shelf_entries(
       id, shelf_id, book_id, position, created_at, updated_at, payload_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       shelf_id = excluded.shelf_id,
       book_id = excluded.book_id,
       position = excluded.position,
       updated_at = excluded.updated_at,
       payload_json = excluded.payload_json`,
    [
      entry.id,
      entry.shelfId,
      entry.bookId,
      entry.position,
      entry.createdAt,
      entry.updatedAt,
      JSON.stringify(entry),
    ],
  )
}

async function writeTag(database: SqlDatabase, input: OrganizationTag): Promise<void> {
  const tag = organizationTagSchema.parse(input)
  await database.run(
    `INSERT INTO organization_tags(
       id, name, normalized_name, created_at, updated_at, payload_json
     ) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       normalized_name = excluded.normalized_name,
       updated_at = excluded.updated_at,
       payload_json = excluded.payload_json`,
    [tag.id, tag.name, tag.normalizedName, tag.createdAt, tag.updatedAt, JSON.stringify(tag)],
  )
}

async function writeBookTag(database: SqlDatabase, input: BookTag): Promise<void> {
  const bookTag = bookTagSchema.parse(input)
  await database.run(
    `INSERT INTO library_book_tags(tag_id, book_id, created_at, payload_json)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(tag_id, book_id) DO UPDATE SET
       created_at = excluded.created_at,
       payload_json = excluded.payload_json`,
    [bookTag.tagId, bookTag.bookId, bookTag.createdAt, JSON.stringify(bookTag)],
  )
}

async function rebalanceEntries(
  database: SqlDatabase,
  entries: readonly CustomShelfEntry[],
): Promise<void> {
  const offset = 1_000_000_000
  if (entries[0]) {
    await database.run(
      'UPDATE custom_shelf_entries SET position = position + ? WHERE shelf_id = ?',
      [offset, entries[0].shelfId],
    )
  }
  const timestamp = new Date().toISOString()
  for (const [index, entry] of entries.entries()) {
    await writeEntry(database, {
      ...entry,
      position: (index + 1) * ORGANIZATION_POSITION_STEP,
      updatedAt: timestamp,
    })
  }
}

function positionForIndex(
  entries: readonly CustomShelfEntry[],
  index: number,
): number | undefined {
  const before = entries[index - 1]?.position
  const after = entries[index + 1]?.position
  if (before === undefined && after === undefined) return ORGANIZATION_POSITION_STEP
  if (before === undefined) return after >= 2 ? Math.floor(after / 2) : undefined
  if (after === undefined) return before + ORGANIZATION_POSITION_STEP
  return after - before >= 2 ? Math.floor((before + after) / 2) : undefined
}

async function readPayloads<Schema extends z.ZodType>(
  database: SqlDatabase,
  table: string,
  schema: Schema,
  orderBy: string,
): Promise<Array<z.infer<Schema>>> {
  const rows = await database.query(`SELECT payload_json FROM ${table} ORDER BY ${orderBy}`)
  return rows.map((row) => schema.parse(JSON.parse(readText(row, 'payload_json'))))
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function organizationId(kind: string): string {
  return `${kind}:${crypto.randomUUID()}`
}
