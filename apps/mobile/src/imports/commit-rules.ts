import { libraryBookSchema, type LibraryBook } from '../library-model'
import type { ImportFieldChange, ImportStoredValue, NormalizedLibraryBook } from './model'

const UPDATE_FIELDS = [
  'title',
  'authors',
  'pageCount',
  'shelf',
  'progress',
  'currentPage',
  'rating',
  'notes',
  'identifiers',
  'listNames',
  'sourceNames',
  'editionTitle',
  'format',
  'addedAt',
  'startedAt',
  'finishedAt',
] as const satisfies readonly (keyof LibraryBook)[]

export type PlannedLibraryCommit = {
  readonly targetId: string
  readonly after: LibraryBook
  readonly changes: readonly ImportFieldChange[]
  readonly createsEntity: boolean
}

/**
 * The one canonical rule set used by preview and commit. Missing import fields never clear local
 * values, and derived progress/date changes are visible in the proposal before they are written.
 */
export function planLibraryBookCommit(
  record: NormalizedLibraryBook,
  sourceKey: string,
  timestamp: string,
  existing?: LibraryBook,
): PlannedLibraryCommit {
  const targetId = existing?.id ?? importedLibraryBookId(sourceKey, record.externalKey)
  if (!existing) {
    const after = createImportedBook(record, targetId, timestamp)
    return {
      targetId,
      after,
      createsEntity: true,
      changes: [{
        field: '$record',
        before: { present: false },
        after: stored(after),
        reason: 'Create one library record for this source-local identity.',
      }],
    }
  }

  const candidate: LibraryBook = { ...existing }
  for (const field of UPDATE_FIELDS) {
    const value = record[field]
    if (value === undefined) continue
    if (ARRAY_MERGE_FIELDS.has(field)) {
      assign(candidate, field, uniqueValues(existing[field] as readonly string[] | undefined, value as readonly string[]) as never)
    } else if (sourceKey === 'goodreads-csv' && (field === 'notes' || field === 'rating') && existing[field]) {
      // Goodreads is migration evidence. An existing local note or rating remains authoritative.
    } else {
      assign(candidate, field, value)
    }
  }

  if (record.shelf === 'finished') {
    candidate.progress = 100
    if (candidate.pageCount) candidate.currentPage = candidate.pageCount
    candidate.finishedAt = record.finishedAt ?? existing.finishedAt ?? timestamp
  } else if (record.shelf === 'reading') {
    candidate.startedAt = record.startedAt ?? existing.startedAt ?? timestamp
    candidate.finishedAt = undefined
  } else if (record.shelf !== undefined) {
    candidate.finishedAt = undefined
  }
  if (record.progress !== undefined && record.currentPage === undefined && candidate.pageCount) {
    candidate.currentPage = Math.round((candidate.pageCount * record.progress) / 100)
  }
  if (record.currentPage !== undefined && record.progress === undefined && candidate.pageCount) {
    candidate.progress = Math.min(100, Math.round((record.currentPage / candidate.pageCount) * 100))
  }

  const changedFields = UPDATE_FIELDS.filter((field) => !sameJson(existing[field], candidate[field]))
  if (changedFields.length) candidate.lastUpdatedAt = timestamp
  const after = libraryBookSchema.parse(candidate)
  const changes: ImportFieldChange[] = changedFields.map((field) => ({
    field,
    before: stored(existing[field]),
    after: stored(after[field]),
    reason: reasonFor(field),
  }))
  if (!sameJson(existing.lastUpdatedAt, after.lastUpdatedAt)) {
    changes.push({
      field: 'lastUpdatedAt',
      before: stored(existing.lastUpdatedAt),
      after: stored(after.lastUpdatedAt),
      reason: 'Record when the reviewed import changed this book.',
    })
  }

  return { targetId, after, changes, createsEntity: false }
}

export function importedLibraryBookId(sourceKey: string, externalKey: string): string {
  const encodedExternalKey = [...new TextEncoder().encode(externalKey)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  return `import:${safeKey(sourceKey)}:${encodedExternalKey}`
}

function createImportedBook(
  record: NormalizedLibraryBook,
  id: string,
  timestamp: string,
): LibraryBook {
  const shelf = record.shelf ?? 'tbr'
  const pageCount = record.pageCount ?? 0
  const progress = shelf === 'finished' ? 100 : record.progress ?? 0
  const currentPage = shelf === 'finished' && pageCount
    ? pageCount
    : record.currentPage ?? (pageCount ? Math.round((pageCount * progress) / 100) : 0)

  return libraryBookSchema.parse({
    id,
    title: record.title,
    authors: record.authors,
    pageCount,
    shelf,
    progress,
    currentPage,
    rating: record.rating ?? 0,
    notes: record.notes ?? '',
    identifiers: record.identifiers,
    listNames: record.listNames,
    sourceNames: record.sourceNames,
    editionTitle: record.editionTitle,
    format: record.format,
    addedAt: record.addedAt ?? timestamp,
    startedAt: record.startedAt ?? (shelf === 'reading' ? timestamp : undefined),
    finishedAt: record.finishedAt ?? (shelf === 'finished' ? timestamp : undefined),
    lastUpdatedAt: timestamp,
  })
}

const ARRAY_MERGE_FIELDS = new Set<keyof LibraryBook>(['identifiers', 'listNames', 'sourceNames'])

function uniqueValues(left: readonly string[] | undefined, right: readonly string[]): string[] {
  return [...new Set([...(left ?? []), ...right])]
}

function stored(value: unknown): ImportStoredValue {
  return value === undefined ? { present: false } : { present: true, value: toJson(value) }
}

function toJson(value: unknown): NonNullable<ImportStoredValue['value']> {
  return JSON.parse(JSON.stringify(value)) as NonNullable<ImportStoredValue['value']>
}

function assign<Field extends keyof LibraryBook>(
  book: LibraryBook,
  field: Field,
  value: LibraryBook[Field],
): void {
  Object.assign(book, { [field]: value })
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function reasonFor(field: keyof LibraryBook): string {
  if (field === 'shelf') return 'Apply the reviewed source shelf without changing local notes.'
  if (field === 'progress' || field === 'currentPage') {
    return 'Apply the reviewed position while keeping it bounded to this book.'
  }
  if (field === 'finishedAt' || field === 'startedAt') {
    return 'Keep the source date as reviewed reading-history evidence.'
  }
  return `Apply the reviewed ${field} value; omitted fields remain untouched.`
}

function safeKey(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'source'
}
