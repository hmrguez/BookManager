import type { CatalogRecords } from '../domain/catalog'
import type { LibraryBook } from '../library-model'
import type { LocalSearchDocument, SearchEdition } from './local-search'

const shelfNames: Record<LibraryBook['shelf'], string> = {
  tbr: 'To Be Read',
  next: 'Up Next',
  reading: 'Reading',
  finished: 'Finished',
}

export function libraryBookSearchDocument(book: LibraryBook): LocalSearchDocument {
  const edition = book.editionTitle || book.format || book.identifiers?.length
    ? [{
        id: book.id,
        title: book.editionTitle,
        format: book.format,
        identifiers: book.identifiers,
      }]
    : undefined

  return {
    id: book.id,
    title: book.title,
    alternateTitles: book.alternateTitles,
    contributors: book.authors,
    series: book.series,
    identifiers: book.identifiers,
    tags: book.tags,
    listNames: unique([shelfNames[book.shelf], ...(book.listNames ?? [])]),
    notes: book.notes.trim() ? [book.notes] : undefined,
    sourceNames: book.sourceNames,
    editions: edition,
    shelf: book.shelf,
    rating: book.rating,
    addedAt: book.addedAt,
    updatedAt: book.lastUpdatedAt,
  }
}

/**
 * Builds the same search contract from canonical catalog records. The current UI still reads the
 * compatibility library repository, but providers and future catalog views can share this index.
 */
export function catalogSearchDocuments(catalog: CatalogRecords): LocalSearchDocument[] {
  const people = new Map(catalog.people.map((person) => [person.id, person.displayName.value]))
  const editionsByWork = groupBy(catalog.editions, ({ workId }) => workId)
  const identifiersByOwner = groupBy(
    catalog.identifiers,
    ({ owner }) => `${owner.type}:${owner.id}`,
  )
  const sourceNamesById = new Map<string, string>(
    catalog.sourceRecords.map((record) => [record.id, record.source.name]),
  )
  const listNames = new Map(catalog.lists.map((list) => [list.id, list.name]))
  const listsByWork = new Map<string, string[]>()
  for (const entry of catalog.listEntries) {
    const name = listNames.get(entry.listId)
    if (!name) continue
    const names = listsByWork.get(entry.workId) ?? []
    names.push(name)
    listsByWork.set(entry.workId, names)
  }

  return catalog.works.map((work) => {
    const editions = editionsByWork.get(work.id) ?? []
    const contributors = catalog.contributors
      .filter(({ target }) => target.type === 'work' && target.id === work.id)
      .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
      .map((contributor) => contributor.creditedAs || people.get(contributor.personId))
      .filter(isPresent)
    const workIdentifiers = identifiersByOwner.get(`work:${work.id}`) ?? []
    const searchEditions: SearchEdition[] = editions.map((edition) => ({
      id: edition.id,
      title: edition.title.value,
      format: edition.medium,
      identifiers: (identifiersByOwner.get(`edition:${edition.id}`) ?? [])
        .flatMap((identifier) => [identifier.value, identifier.normalizedValue]),
    }))
    const allIdentifiers = [
      ...workIdentifiers.flatMap((identifier) => [identifier.value, identifier.normalizedValue]),
      ...searchEditions.flatMap((edition) => edition.identifiers ?? []),
    ]
    const sourceNames = unique([
      ...sourceIdsFor(work.title).map((id) => sourceNamesById.get(id)).filter(isPresent),
      ...editions.flatMap((edition) =>
        sourceIdsFor(edition.title).map((id) => sourceNamesById.get(id)).filter(isPresent),
      ),
    ])

    return {
      id: work.id,
      title: work.title.value,
      alternateTitles: unique(
        editions.map(({ title }) => title.value).filter((title) => title !== work.title.value),
      ),
      contributors,
      identifiers: unique(allIdentifiers),
      listNames: unique(listsByWork.get(work.id) ?? []),
      sourceNames,
      editions: searchEditions,
      updatedAt: work.updatedAt,
    }
  })
}

function groupBy<Value, Key>(
  values: readonly Value[],
  keyFor: (value: Value) => Key,
): Map<Key, Value[]> {
  const grouped = new Map<Key, Value[]>()
  for (const value of values) {
    const key = keyFor(value)
    const group = grouped.get(key) ?? []
    group.push(value)
    grouped.set(key, group)
  }
  return grouped
}

function unique<Value>(values: readonly Value[]): Value[] {
  return [...new Set(values)]
}

function isPresent<Value>(value: Value | undefined): value is Value {
  return value !== undefined
}

function sourceIdsFor(field: {
  readonly candidate: { readonly kind: 'source'; readonly sourceRecordId: string } | { readonly kind: 'local' }
}): string[] {
  return field.candidate.kind === 'source' ? [field.candidate.sourceRecordId] : []
}
