import { libraryBookSchema, type LibraryBook } from '../library-model'
import type { SqlDatabase } from './database'
import { readText } from './database'

export class LibraryRepository {
  readonly #database: SqlDatabase

  constructor(database: SqlDatabase) {
    this.#database = database
  }

  async list(): Promise<LibraryBook[]> {
    const rows = await this.#database.query(
      'SELECT payload_json FROM library_books ORDER BY position, id',
    )
    return rows.map((row) => libraryBookSchema.parse(JSON.parse(readText(row, 'payload_json'))))
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
        await upsert(database, book)
      }
    })
  }

  async save(book: LibraryBook): Promise<void> {
    await upsert(this.#database, libraryBookSchema.parse(book))
    await this.#database.persist()
  }

  async remove(id: string): Promise<void> {
    await this.#database.run('DELETE FROM library_books WHERE id = ?', [id])
    await this.#database.persist()
  }
}

async function upsert(database: SqlDatabase, book: LibraryBook): Promise<void> {
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
    [book.id, book.shelf, book.title, book.addedAt, book.lastUpdatedAt, JSON.stringify(book)],
  )
}
