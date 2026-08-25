export type SqlValue = string | number | null

export type SqlRow = Readonly<Record<string, SqlValue>>

export type SqlRunResult = {
  readonly changes: number
  readonly lastInsertId?: number
}

/**
 * Smallest database contract used by Wovenleaf. Capacitor, Bun tests, and future
 * tooling adapt to this boundary; domain repositories do not depend on a SQLite plugin.
 */
export interface SqlDatabase {
  execute(statements: string): Promise<void>
  run(statement: string, values?: readonly SqlValue[]): Promise<SqlRunResult>
  query<Row extends SqlRow = SqlRow>(
    statement: string,
    values?: readonly SqlValue[],
  ): Promise<Row[]>
  transaction<Result>(work: (database: SqlDatabase) => Promise<Result>): Promise<Result>
  persist(): Promise<void>
  exportSnapshot(): Promise<string>
  close(): Promise<void>
}

export function readText(row: SqlRow, column: string): string {
  const value = row[column]
  if (typeof value !== 'string') {
    throw new Error(`Expected text in SQLite column ${column}`)
  }
  return value
}

export function readNumber(row: SqlRow, column: string): number {
  const value = row[column]
  if (typeof value !== 'number') {
    throw new Error(`Expected number in SQLite column ${column}`)
  }
  return value
}
