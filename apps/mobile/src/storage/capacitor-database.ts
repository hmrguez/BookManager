import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from '@capacitor-community/sqlite'
import { Capacitor } from '@capacitor/core'
import { defineCustomElements } from 'jeep-sqlite/loader'
import type { SqlDatabase, SqlRow, SqlRunResult, SqlStatement, SqlValue } from './database'

const DATABASE_NAME = 'wovenleaf'

export async function openCapacitorDatabase(): Promise<SqlDatabase> {
  const platform = Capacitor.getPlatform()
  const sqlite = new SQLiteConnection(CapacitorSQLite)

  if (platform === 'web') {
    await initializeWebStore(sqlite)
  }

  const consistent = await sqlite.checkConnectionsConsistency()
  const existing = await sqlite.isConnection(DATABASE_NAME, false)
  const connection = consistent.result && existing.result
    ? await sqlite.retrieveConnection(DATABASE_NAME, false)
    : await sqlite.createConnection(DATABASE_NAME, false, 'no-encryption', 1, false)

  if (!(await connection.isDBOpen()).result) {
    await connection.open()
  }

  return new CapacitorSqlDatabase(sqlite, connection, platform === 'web')
}

async function initializeWebStore(sqlite: SQLiteConnection): Promise<void> {
  defineCustomElements(window)
  let element = document.querySelector('jeep-sqlite')
  if (!element) {
    element = document.createElement('jeep-sqlite')
    element.setAttribute('wasm-path', '/assets')
    document.body.appendChild(element)
  }
  await customElements.whenDefined('jeep-sqlite')
  await sqlite.initWebStore()
}

class CapacitorSqlDatabase implements SqlDatabase {
  readonly #sqlite: SQLiteConnection
  readonly #connection: SQLiteDBConnection
  readonly #isWeb: boolean
  #transactionTail: Promise<void> = Promise.resolve()

  constructor(sqlite: SQLiteConnection, connection: SQLiteDBConnection, isWeb: boolean) {
    this.#sqlite = sqlite
    this.#connection = connection
    this.#isWeb = isWeb
  }

  async execute(statements: string): Promise<void> {
    await this.#connection.execute(statements, false)
  }

  async run(statement: string, values: readonly SqlValue[] = []): Promise<SqlRunResult> {
    const result = await this.#connection.run(statement, [...values], false)
    return {
      changes: result.changes?.changes ?? 0,
      lastInsertId: result.changes?.lastId,
    }
  }

  async query<Row extends SqlRow = SqlRow>(
    statement: string,
    values: readonly SqlValue[] = [],
  ): Promise<Row[]> {
    const result = await this.#connection.query(statement, [...values])
    return (result.values ?? []).map((row) => normalizeRow(row) as Row)
  }

  async runBatch(statements: readonly SqlStatement[]): Promise<void> {
    if (!statements.length) return
    await this.#connection.executeSet(
      statements.map(({ statement, values }) => ({ statement, values: [...values] })),
      false,
    )
  }

  async transaction<Result>(work: (database: SqlDatabase) => Promise<Result>): Promise<Result> {
    let release: () => void = () => {}
    const previous = this.#transactionTail
    this.#transactionTail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous

    try {
      await this.#connection.beginTransaction()
      try {
        const result = await work(this)
        await this.#connection.commitTransaction()
        await this.persist()
        return result
      } catch (error) {
        if ((await this.#connection.isTransactionActive()).result) {
          await this.#connection.rollbackTransaction()
        }
        throw error
      }
    } finally {
      release()
    }
  }

  async persist(): Promise<void> {
    if (this.#isWeb) {
      await this.#sqlite.saveToStore(DATABASE_NAME)
    }
  }

  async exportSnapshot(): Promise<string> {
    const snapshot = await this.#connection.exportToJson('full', false)
    if (!snapshot.export) throw new Error('SQLite did not return a full backup snapshot')
    return JSON.stringify(snapshot.export)
  }

  async close(): Promise<void> {
    await this.persist()
    if ((await this.#connection.isDBOpen()).result) {
      await this.#connection.close()
    }
    if ((await this.#sqlite.isConnection(DATABASE_NAME, false)).result) {
      await this.#sqlite.closeConnection(DATABASE_NAME, false)
    }
  }
}

function normalizeRow(value: unknown): SqlRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('SQLite returned an invalid row')
  }

  const row: Record<string, SqlValue> = {}
  for (const [column, field] of Object.entries(value)) {
    if (field === null || typeof field === 'string' || typeof field === 'number') {
      row[column] = field
      continue
    }
    throw new Error(`SQLite returned unsupported data in column ${column}`)
  }
  return row
}
