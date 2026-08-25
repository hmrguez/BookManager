import { Database } from 'bun:sqlite'
import type {
  SqlDatabase,
  SqlRow,
  SqlRunResult,
  SqlValue,
} from '../src/storage/database'

export class BunSqliteDatabase implements SqlDatabase {
  readonly #database: Database

  constructor(path = ':memory:') {
    this.#database = new Database(path)
  }

  async execute(statements: string): Promise<void> {
    this.#database.exec(statements)
  }

  async run(statement: string, values: readonly SqlValue[] = []): Promise<SqlRunResult> {
    const result = this.#database.query(statement).run(...values)
    return {
      changes: result.changes,
      lastInsertId: Number(result.lastInsertRowid),
    }
  }

  async query<Row extends SqlRow = SqlRow>(
    statement: string,
    values: readonly SqlValue[] = [],
  ): Promise<Row[]> {
    return this.#database.query(statement).all(...values) as Row[]
  }

  async transaction<Result>(work: (database: SqlDatabase) => Promise<Result>): Promise<Result> {
    this.#database.exec('BEGIN IMMEDIATE')
    try {
      const result = await work(this)
      this.#database.exec('COMMIT')
      return result
    } catch (error) {
      this.#database.exec('ROLLBACK')
      throw error
    }
  }

  async persist(): Promise<void> {}

  async exportSnapshot(): Promise<string> {
    return Buffer.from(this.#database.serialize()).toString('base64')
  }

  async close(): Promise<void> {
    this.#database.close()
  }
}
