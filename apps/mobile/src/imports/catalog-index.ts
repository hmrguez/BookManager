import type { Catalog, Identifier, Person } from '../domain/catalog'
import { canonicalEditionIsbn } from '../metadata/model'
import type { ImportEntityProposal } from './model'

export const importCatalogCollections = {
  work: 'works', edition: 'editions', 'source-record': 'sourceRecords', identifier: 'identifiers',
  person: 'people', contributor: 'contributors', list: 'lists', 'list-entry': 'listEntries',
  'integration-checkpoint': 'integrationCheckpoints', 'reading-event': 'readingEvents',
  'progress-snapshot': 'progressSnapshots',
} as const

type EntityType = ImportEntityProposal['entityType']

export const catalogNameKey = (value: string): string =>
  value.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Batch-local indexes avoid re-normalizing every existing ISBN and author for every row. */
export class ImportCatalogIndex {
  readonly peopleByName = new Map<string, Person>()
  readonly identifiersByIsbn = new Map<string, Identifier>()
  readonly #entities = new Map<EntityType, Map<string, unknown>>()

  constructor(catalog: Catalog) {
    for (const [type, key] of Object.entries(importCatalogCollections)) {
      for (const entity of catalog[key]) this.set(type as EntityType, entity.id, entity)
    }
  }

  get(type: EntityType, id: string): unknown { return this.#entities.get(type)?.get(id) }

  set(type: EntityType, id: string, entity: unknown): void {
    let entities = this.#entities.get(type)
    if (!entities) { entities = new Map(); this.#entities.set(type, entities) }
    const previous = entities.get(id)
    entities.set(id, entity)
    if (type === 'person') {
      const person = entity as Person
      if (previous) {
        const oldKey = catalogNameKey((previous as Person).displayName.value)
        if (this.peopleByName.get(oldKey)?.id === id) this.peopleByName.delete(oldKey)
      }
      const key = catalogNameKey(person.displayName.value)
      if (!this.peopleByName.has(key)) this.peopleByName.set(key, person)
    }
    if (type === 'identifier') {
      const identifier = entity as Identifier
      if (previous) {
        const oldKey = canonicalEditionIsbn((previous as Identifier).normalizedValue)
        if (oldKey && this.identifiersByIsbn.get(oldKey)?.id === id) this.identifiersByIsbn.delete(oldKey)
      }
      const key = canonicalEditionIsbn(identifier.normalizedValue)
      if (key && identifier.owner.type === 'edition' && !this.identifiersByIsbn.has(key)) {
        this.identifiersByIsbn.set(key, identifier)
      }
    }
  }
}
