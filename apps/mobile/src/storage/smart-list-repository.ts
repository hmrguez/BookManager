import { savedSmartListSchema, type SavedSmartList } from '../smart-lists/model'
import type { SqlDatabase } from './database'
import { readText } from './database'

export class SmartListRepository {
  readonly #database: SqlDatabase

  constructor(database: SqlDatabase) {
    this.#database = database
  }

  async read(): Promise<SavedSmartList[]> {
    return readSavedSmartLists(this.#database)
  }

  async save(list: SavedSmartList): Promise<void> {
    await writeSavedSmartList(this.#database, savedSmartListSchema.parse(list))
    await this.#database.persist()
  }

  async remove(id: string): Promise<void> {
    await this.#database.run('DELETE FROM smart_lists WHERE id = ?', [id])
    await this.#database.persist()
  }

  async replace(lists: readonly SavedSmartList[]): Promise<void> {
    await this.#database.transaction(async (database) => replaceSavedSmartLists(database, lists))
  }
}

export async function readSavedSmartLists(database: SqlDatabase): Promise<SavedSmartList[]> {
  const rows = await database.query<{ readonly payload_json: string }>(
    `SELECT payload_json FROM smart_lists
     ORDER BY archived, pinned DESC, position, name COLLATE NOCASE, id`,
  )
  return rows.map((row, index) => {
    const payload = readText(row, 'payload_json')
    try {
      return savedSmartListSchema.parse(JSON.parse(payload))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Invalid smart list row ${index + 1}: ${message}`)
    }
  })
}

export async function replaceSavedSmartLists(
  database: SqlDatabase,
  input: readonly SavedSmartList[],
): Promise<void> {
  const lists = input.map((list) => savedSmartListSchema.parse(list))
  const ids = new Set<string>()
  for (const list of lists) {
    if (ids.has(list.id)) throw new Error(`Duplicate smart list ID ${list.id}`)
    ids.add(list.id)
  }
  await database.run('DELETE FROM smart_lists')
  for (const list of lists) await writeSavedSmartList(database, list)
}

async function writeSavedSmartList(database: SqlDatabase, list: SavedSmartList): Promise<void> {
  const definitionJson = JSON.stringify(list.definition)
  if (definitionJson === undefined) throw new Error('Smart list definition must be JSON-serializable')
  await database.run(
    `INSERT INTO smart_lists(
       id, name, pinned, archived, position, rule_schema_version,
       created_at, updated_at, definition_json, payload_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       pinned = excluded.pinned,
       archived = excluded.archived,
       position = excluded.position,
       rule_schema_version = excluded.rule_schema_version,
       updated_at = excluded.updated_at,
       definition_json = excluded.definition_json,
       payload_json = excluded.payload_json`,
    [
      list.id,
      list.name,
      Number(list.pinned),
      Number(list.archived),
      list.position,
      ruleSchemaVersion(list.definition),
      list.createdAt,
      list.updatedAt,
      definitionJson,
      JSON.stringify(list),
    ],
  )
}

function ruleSchemaVersion(definition: unknown): number {
  if (!definition || typeof definition !== 'object') return 0
  const version = Reflect.get(definition, 'schemaVersion')
  return typeof version === 'number' && Number.isInteger(version) && version >= 0 ? version : 0
}
