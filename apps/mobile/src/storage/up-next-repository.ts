import {
  createDefaultUpNextState,
  upNextStateSchema,
  type UpNextState,
} from '../up-next-model'
import type { SqlDatabase } from './database'
import { readText } from './database'

const UP_NEXT_STATE_ID = 'primary'

export class UpNextRepository {
  readonly #database: SqlDatabase

  constructor(database: SqlDatabase) {
    this.#database = database
  }

  async read(): Promise<UpNextState> {
    return readUpNextState(this.#database)
  }

  async save(state: UpNextState): Promise<void> {
    // Shelf moves update the library and queue together. Serialize both writes before
    // exporting web storage so a queue save cannot interrupt the book transaction.
    await this.#database.transaction((database) => writeUpNextState(database, state))
  }

  async replace(state: UpNextState): Promise<void> {
    await replaceUpNextState(this.#database, state)
  }
}

export async function readUpNextState(database: SqlDatabase): Promise<UpNextState> {
  const [row] = await database.query(
    'SELECT payload_json FROM up_next_state WHERE id = ?',
    [UP_NEXT_STATE_ID],
  )
  return row
    ? upNextStateSchema.parse(JSON.parse(readText(row, 'payload_json')))
    : createDefaultUpNextState()
}

export async function writeUpNextState(
  database: SqlDatabase,
  input: UpNextState,
): Promise<void> {
  const state = upNextStateSchema.parse(input)
  await database.run(
    `INSERT INTO up_next_state(id, updated_at, payload_json)
     VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       updated_at = excluded.updated_at,
       payload_json = excluded.payload_json`,
    [UP_NEXT_STATE_ID, state.updatedAt, JSON.stringify(state)],
  )
}

export async function replaceUpNextState(
  database: SqlDatabase,
  input: UpNextState,
): Promise<void> {
  const state = upNextStateSchema.parse(input)
  await database.run('DELETE FROM up_next_state')
  await writeUpNextState(database, state)
}
