import { libraryBookSchema, type LibraryBook } from '../library-model'
import { upNextStateSchema } from '../up-next-model'
import type { SqlDatabase } from './database'
import { readText } from './database'
import { writeUpNextState } from './up-next-repository'

export class LibraryRepository {
  readonly #database: SqlDatabase

  constructor(database: SqlDatabase) {
    this.#database = database
  }

  async list(): Promise<LibraryBook[]> {
    return readLibraryBooks(this.#database)
  }

  async seedIfEmpty(books: readonly LibraryBook[]): Promise<void> {
    const [{ count } = { count: 0 }] = await this.#database.query<{ readonly count: number }>(
      'SELECT COUNT(*) AS count FROM library_books',
    )
    if (count !== 0) return

    const validated = books.map((book) => libraryBookSchema.parse(book))
    await this.#database.transaction(async (database) => {
      const [{ count: transactionCount } = { count: 0 }] = await database.query<{
        readonly count: number
      }>('SELECT COUNT(*) AS count FROM library_books')
      if (transactionCount !== 0) return
      for (const book of validated) {
        await writeLibraryBook(database, book)
      }
    })
  }

  async save(book: LibraryBook): Promise<void> {
    await writeLibraryBook(this.#database, libraryBookSchema.parse(book))
    await this.#database.persist()
  }

  async remove(id: string): Promise<void> {
    await this.#database.transaction(async (database) => {
      await database.run('DELETE FROM custom_shelf_entries WHERE book_id = ?', [id])
      await database.run('DELETE FROM library_book_tags WHERE book_id = ?', [id])
      const [upNextRow] = await database.query('SELECT payload_json FROM up_next_state WHERE id = ?', ['primary'])
      if (upNextRow) {
        const upNext = upNextStateSchema.parse(JSON.parse(readText(upNextRow, 'payload_json')))
        await writeUpNextState(database, {
          ...upNext,
          queueBookIds: upNext.queueBookIds.filter((bookId) => bookId !== id),
          pinnedBookId: upNext.pinnedBookId === id ? null : upNext.pinnedBookId,
          dismissedSuggestions: upNext.dismissedSuggestions.filter(({ bookId }) => bookId !== id),
          updatedAt: new Date().toISOString(),
        })
      }
      await database.run('DELETE FROM library_books WHERE id = ?', [id])
      await database.run(
        `DELETE FROM organization_tags
         WHERE NOT EXISTS (
           SELECT 1 FROM library_book_tags WHERE library_book_tags.tag_id = organization_tags.id
         )`,
      )
    })
  }

  async replace(books: readonly LibraryBook[]): Promise<void> {
    const validated = books.map((book) => libraryBookSchema.parse(book))
    await this.#database.transaction(async (database) => {
      await replaceLibraryBooks(database, validated)
    })
  }
}

export async function readLibraryBooks(database: SqlDatabase): Promise<LibraryBook[]> {
  const rows = await database.query(
    'SELECT payload_json FROM library_books ORDER BY position, id',
  )
  return rows.map((row) => libraryBookSchema.parse(JSON.parse(readText(row, 'payload_json'))))
}

export async function writeLibraryBook(database: SqlDatabase, book: LibraryBook): Promise<void> {
  const validated = libraryBookSchema.parse(book)
  await database.run(
    `INSERT INTO library_books(
       id, position, shelf, title_sort, added_at, updated_at, payload_json
     ) VALUES (
       ?, COALESCE((SELECT MAX(position) + 1 FROM library_books), 0), ?, ?, ?, ?, ?
     )
     ON CONFLICT(id) DO UPDATE SET
       shelf = excluded.shelf,
       title_sort = excluded.title_sort,
       added_at = excluded.added_at,
       updated_at = excluded.updated_at,
       payload_json = excluded.payload_json`,
    [
      validated.id,
      validated.shelf,
      validated.title,
      validated.addedAt,
      validated.lastUpdatedAt,
      JSON.stringify(validated),
    ],
  )
}

export async function replaceLibraryBooks(
  database: SqlDatabase,
  books: readonly LibraryBook[],
): Promise<void> {
  const validated = books.map((book) => libraryBookSchema.parse(book))
  await database.run('DELETE FROM library_books')
  for (const book of validated) await writeLibraryBook(database, book)
}
