import type { SqlDatabase, SqlRow, SqlRunResult, SqlStatement, SqlValue } from './database'

/** Collect writes whose results are not needed; preserve SQL order and the outer transaction. */
export class SqlWriteBuffer implements SqlDatabase {
  readonly #database: SqlDatabase
  #pending: SqlStatement[] = []
  readonly #inserts = new Map<string, { columns: readonly string[]; rows: (readonly SqlValue[])[] }>()

  constructor(database: SqlDatabase) { this.#database = database }

  async run(statement: string, values: readonly SqlValue[] = []): Promise<SqlRunResult> {
    this.#pending.push({ statement, values })
    return { changes: 0 }
  }

  /** Import audit tables are append-only here and depend only on the already-staged batch/rows.
   * They can safely be inserted after the entity writes, using bounded multi-value statements.
   */
  insert(table: 'import_rows' | 'import_changes' | 'import_row_receipts', columns: readonly string[], values: readonly SqlValue[]): void {
    if (columns.length !== values.length || columns.some((column) => !/^[a-z_]+$/.test(column))) {
      throw new Error('Invalid buffered import insert')
    }
    let group = this.#inserts.get(table)
    if (!group) { group = { columns, rows: [] }; this.#inserts.set(table, group) }
    if (group.columns.join(',') !== columns.join(',')) throw new Error('Buffered insert columns must agree')
    group.rows.push(values)
  }

  async flush(): Promise<void> {
    const statements = this.#pending
    this.#pending = []
    for (const [table, { columns, rows }] of this.#inserts) {
      // Stay below SQLite's conservative 999-variable limit, including on older mobile builds.
      const rowLimit = Math.floor(900 / columns.length)
      const placeholders = `(${columns.map(() => '?').join(',')})`
      for (let offset = 0; offset < rows.length; offset += rowLimit) {
        const batch = rows.slice(offset, offset + rowLimit)
        statements.push({
          statement: `INSERT INTO ${table}(${columns.join(',')}) VALUES ${batch.map(() => placeholders).join(',')}`,
          values: batch.flat(),
        })
      }
    }
    this.#inserts.clear()
    // Bound native message size without opening partial transactions.
    for (let offset = 0; offset < statements.length; offset += 2_000) {
      const batch = statements.slice(offset, offset + 2_000)
      if (this.#database.runBatch) await this.#database.runBatch(batch)
      else for (const { statement, values } of batch) await this.#database.run(statement, values)
    }
  }

  async query<Row extends SqlRow = SqlRow>(statement: string, values?: readonly SqlValue[]): Promise<Row[]> {
    await this.flush()
    return this.#database.query<Row>(statement, values)
  }

  async execute(statements: string): Promise<void> {
    await this.flush()
    await this.#database.execute(statements)
  }

  async transaction<Result>(_work: (database: SqlDatabase) => Promise<Result>): Promise<Result> {
    throw new Error('A write buffer must run inside an existing transaction')
  }

  async persist(): Promise<void> { await this.flush() }
  async exportSnapshot(): Promise<string> {
    await this.flush()
    return this.#database.exportSnapshot()
  }
  async close(): Promise<void> { await this.flush() }
}
