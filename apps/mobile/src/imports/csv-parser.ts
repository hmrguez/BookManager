import { normalizedLibraryBookSchema, type NormalizedLibraryBook } from './model'
import { canonicalEditionIsbn, normalizeIsbn } from '../metadata/model'

export type ParsedImportRow = {
  readonly rowNumber: number
  readonly raw: Readonly<Record<string, string>>
  readonly errors: readonly string[]
}

export type NormalizedImportResult =
  | { readonly ok: true; readonly record: NormalizedLibraryBook }
  | { readonly ok: false; readonly errors: readonly string[] }

export interface ImportParser {
  readonly id: string
  readonly version: string
  accepts(fileName: string, content?: string): boolean
  parse(content: string): readonly ParsedImportRow[]
  normalize(row: ParsedImportRow): NormalizedImportResult
}

const HEADER_ALIASES = {
  externalKey: ['external_id', 'external_key', 'id'],
  title: ['title'],
  authors: ['authors', 'author'],
  pageCount: ['page_count', 'pages'],
  shelf: ['shelf', 'status'],
  progress: ['progress', 'progress_percent'],
  currentPage: ['current_page', 'page'],
  rating: ['rating'],
  notes: ['notes', 'review'],
  addedAt: ['added_at', 'date_added'],
  startedAt: ['started_at', 'date_started'],
  finishedAt: ['finished_at', 'date_finished'],
} as const

export const wovenleafCsvParser: ImportParser = {
  id: 'wovenleaf-library-csv',
  version: '1',
  accepts(fileName) {
    return fileName.toLocaleLowerCase().endsWith('.csv')
  },
  parse(content) {
    const parsed = parseCsv(content.replace(/^\uFEFF/, ''))
    if (!parsed.rows.length) return []
    const headers = parsed.rows[0]!.map(normalizeHeader)
    const dataRows = parsed.rows.slice(1)

    return dataRows.flatMap((values, index) => {
      if (values.every((value) => !value.trim())) return []
      const errors: string[] = []
      if (parsed.unclosedQuote && index === dataRows.length - 1) {
        errors.push('The final quoted field is not closed')
      }
      if (values.length > headers.length) {
        errors.push(`Expected ${headers.length} columns but found ${values.length}`)
      }
      const raw = Object.fromEntries(headers.map((header, column) => [header, values[column]?.trim() ?? '']))
      return [{ rowNumber: index + 2, raw, errors }]
    })
  },
  normalize(row) {
    const errors = [...row.errors]
    const value = (field: keyof typeof HEADER_ALIASES) =>
      HEADER_ALIASES[field].map((header) => row.raw[header]).find((entry) => entry !== undefined)?.trim()

    const title = value('title') ?? ''
    const authors = (value('authors') ?? '')
      .split(/\s*;\s*/)
      .map((author) => author.trim())
      .filter(Boolean)
    if (!title) errors.push('Title is required')
    if (!authors.length) errors.push('At least one author is required')

    const externalKey = value('externalKey') || identityKey(title, authors)
    const pageCount = parseInteger(value('pageCount'), 'Page count', 0, undefined, errors)
    const progress = parseNumber(value('progress'), 'Progress', 0, 100, errors)
    const currentPage = parseInteger(value('currentPage'), 'Current page', 0, undefined, errors)
    const rating = parseInteger(value('rating'), 'Rating', 0, 5, errors)
    const shelf = parseShelf(value('shelf'), errors)
    const addedAt = parseDate(value('addedAt'), 'Added date', errors)
    const startedAt = parseDate(value('startedAt'), 'Started date', errors)
    const finishedAt = parseDate(value('finishedAt'), 'Finished date', errors)

    if (pageCount !== undefined && currentPage !== undefined && currentPage > pageCount) {
      errors.push('Current page cannot exceed page count')
    }
    if (errors.length) return { ok: false, errors }

    const parsed = normalizedLibraryBookSchema.safeParse({
      externalKey,
      title,
      authors,
      pageCount,
      shelf,
      progress,
      currentPage,
      rating,
      notes: optional(value('notes')),
      addedAt,
      startedAt,
      finishedAt,
    })
    if (!parsed.success) {
      return { ok: false, errors: parsed.error.issues.map(({ message }) => message) }
    }
    return { ok: true, record: parsed.data }
  },
}

const GOODREADS_REQUIRED_HEADERS = [
  'book_id',
  'title',
  'author',
  'exclusive_shelf',
] as const

/** Goodreads' own library export, recognized by its header contract rather than its filename. */
export const goodreadsCsvParser: ImportParser = {
  id: 'goodreads-library-export',
  version: '1',
  accepts(fileName, content) {
    if (!fileName.toLocaleLowerCase().endsWith('.csv') && !content) return false
    return content ? isGoodreadsCsv(content) : true
  },
  parse(content) {
    const parsed = parseCsv(content.replace(/^\uFEFF/, ''))
    if (!parsed.rows.length) return []
    const headers = parsed.rows[0]!.map(normalizeHeader)
    const dataRows = parsed.rows.slice(1)

    return dataRows.flatMap((values, index) => {
      if (values.every((value) => !value.trim())) return []
      const errors: string[] = []
      if (parsed.unclosedQuote && index === dataRows.length - 1) {
        errors.push('The final quoted field is not closed')
      }
      if (values.length > headers.length) {
        errors.push(`Expected ${headers.length} columns but found ${values.length}`)
      }
      return [{
        rowNumber: index + 2,
        raw: Object.fromEntries(headers.map((header, column) => [header, values[column]?.trim() ?? ''])),
        errors,
      }]
    })
  },
  normalize(row) {
    const errors = [...row.errors]
    const value = (header: string) => optional(row.raw[header]?.trim())
    const title = value('title') ?? ''
    const primaryAuthor = value('author') ?? ''
    const additionalAuthors = splitGoodreadsList(value('additional_authors'))
    const authors = unique([primaryAuthor, ...additionalAuthors].filter(Boolean))
    const bookId = value('book_id') ?? ''
    const exclusiveShelf = value('exclusive_shelf') ?? ''
    if (!bookId) errors.push('Book Id is required')
    if (!title) errors.push('Title is required')
    if (!authors.length) errors.push('At least one author is required')
    if (!exclusiveShelf) errors.push('Exclusive Shelf is required')

    const isbn10 = parseGoodreadsIsbn(value('isbn'), 10, errors)
    const isbn13 = parseGoodreadsIsbn(value('isbn13'), 13, errors)
    const identifiers = unique([isbn10, isbn13].filter((entry): entry is string => Boolean(entry)))
    const pageCount = parseInteger(value('number_of_pages'), 'Number of Pages', 0, undefined, errors)
    const ratingValue = parseGoodreadsRating(value('my_rating'), errors)
    const averageRating = parseNumber(value('average_rating'), 'Average Rating', 0, 5, errors)
    const yearPublished = parseInteger(value('year_published'), 'Year Published', 1, undefined, errors)
    const originalPublicationYear = parseGoodreadsOriginalPublicationYear(
      value('original_publication_year'),
      errors,
    )
    const readCount = parseInteger(value('read_count'), 'Read Count', 0, undefined, errors)
    const ownedCopies = parseInteger(value('owned_copies'), 'Owned Copies', 0, undefined, errors)
    const addedAt = parseGoodreadsDate(value('date_added'), 'Date Added', errors)
    const finishedAt = parseGoodreadsDate(value('date_read'), 'Date Read', errors)
    const shelf = parseGoodreadsShelf(exclusiveShelf)
    const bookshelves = unique(splitGoodreadsList(value('bookshelves')))
    const notes = combineGoodreadsNotes(value('my_review'), value('private_notes'))
    const spoiler = parseGoodreadsBoolean(value('spoiler'))

    if (errors.length) return { ok: false, errors }
    const parsed = normalizedLibraryBookSchema.safeParse({
      externalKey: bookId,
      title,
      authors,
      pageCount,
      shelf,
      rating: ratingValue && ratingValue > 0 ? ratingValue : undefined,
      notes,
      identifiers: identifiers.length ? identifiers : undefined,
      listNames: bookshelves.length ? bookshelves : undefined,
      sourceNames: ['Goodreads'],
      editionTitle: title,
      format: value('binding'),
      publisher: value('publisher'),
      publicationDate: yearPublished ? String(yearPublished) : undefined,
      addedAt,
      finishedAt: shelf === 'finished' ? finishedAt : undefined,
      goodreads: {
        bookId,
        authorSort: value('author_l_f'),
        additionalAuthors,
        isbn10,
        isbn13,
        averageRating,
        publisher: value('publisher'),
        binding: value('binding'),
        yearPublished,
        originalPublicationYear,
        dateRead: finishedAt,
        dateAdded: addedAt,
        bookshelves,
        bookshelvesWithPositions: value('bookshelves_with_positions'),
        exclusiveShelf,
        review: value('my_review'),
        privateNotes: value('private_notes'),
        spoiler,
        readCount,
        ownedCopies,
      },
    })
    return parsed.success
      ? { ok: true, record: parsed.data }
      : { ok: false, errors: parsed.error.issues.map(({ message }) => message) }
  },
}

export function isGoodreadsCsv(content: string): boolean {
  const headers = csvHeaders(content)
  return GOODREADS_REQUIRED_HEADERS.every((required) => headers.has(required))
    && (headers.has('isbn') || headers.has('isbn13') || headers.has('date_added') || headers.has('bookshelves'))
}

export function missingGoodreadsRequiredHeaders(content: string): string[] {
  const headers = csvHeaders(content)
  return GOODREADS_REQUIRED_HEADERS.filter((required) => !headers.has(required))
}

export function looksLikeGoodreadsCsv(content: string): boolean {
  const headers = csvHeaders(content)
  const signatures = [
    'book_id',
    'author_l_f',
    'additional_authors',
    'isbn13',
    'my_rating',
    'bookshelves_with_positions',
    'exclusive_shelf',
    'read_count',
    'owned_copies',
  ]
  return signatures.filter((header) => headers.has(header)).length >= 3
}

export function selectCsvParser(fileName: string, content: string): ImportParser {
  if (goodreadsCsvParser.accepts(fileName, content)) return goodreadsCsvParser
  if (looksLikeGoodreadsCsv(content)) {
    const missing = missingGoodreadsRequiredHeaders(content)
    throw new Error(
      missing.length
        ? `This looks like a Goodreads export, but it is missing: ${missing.join(', ')}. Create a fresh export in Goodreads and try again.`
        : 'This looks like a changed Goodreads export that Wovenleaf cannot safely recognize yet.',
    )
  }
  if (wovenleafCsvParser.accepts(fileName, content)) return wovenleafCsvParser
  throw new Error('This file is not a recognized Goodreads or Wovenleaf library export')
}

function csvHeaders(content: string): Set<string> {
  const [header] = parseCsv(content.replace(/^\uFEFF/, '')).rows
  return new Set((header ?? []).map(normalizeHeader))
}

function normalizeHeader(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[\s-]+/g, '_')
}

function identityKey(title: string, authors: readonly string[]): string {
  return [title, ...authors].map(normalizeIdentityPart).filter(Boolean).join('|') || 'missing-identity'
}

function normalizeIdentityPart(value: string): string {
  return value.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function optional(value: string | undefined): string | undefined {
  return value ? value : undefined
}

function splitGoodreadsList(value: string | undefined): string[] {
  return (value ?? '').split(/\s*,\s*/).map((entry) => entry.trim()).filter(Boolean)
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function parseGoodreadsIsbn(
  value: string | undefined,
  length: 10 | 13,
  errors: string[],
): string | undefined {
  if (!value) return undefined
  const unwrapped = value.replace(/^=\s*"(.*)"$/, '$1')
  if (!unwrapped) return undefined
  const normalized = normalizeIsbn(unwrapped)
  // Some official exports repeat a valid ISBN-10 in the ISBN13 column. Convert the
  // checksum-validated identifier; preserve the original cell in the source revision.
  if (normalized?.length === 10 && length === 13) return canonicalEditionIsbn(normalized)
  if (!normalized || normalized.length !== length) {
    errors.push(`ISBN${length} is not a valid ISBN-${length}`)
    return undefined
  }
  return normalized
}

function parseGoodreadsRating(value: string | undefined, errors: string[]): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) {
    errors.push('My Rating must be a whole number')
    return undefined
  }
  return parseBoundedNumber(parsed, 'My Rating', 0, 5, errors)
}

function parseGoodreadsOriginalPublicationYear(
  value: string | undefined,
  errors: string[],
): number | undefined {
  if (!value) return undefined
  if (!/^-?\d+$/.test(value)) {
    errors.push('Original Publication Year must be a whole number')
    return undefined
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    errors.push('Original Publication Year is outside the supported range')
    return undefined
  }
  return parsed
}

function parseGoodreadsDate(value: string | undefined, label: string, errors: string[]): string | undefined {
  if (!value) return undefined
  const match = /^(\d{4})[/-](\d{2})[/-](\d{2})$/.exec(value)
  if (!match) {
    errors.push(`${label} must use Goodreads' YYYY/MM/DD format`)
    return undefined
  }
  return parseDate(`${match[1]}-${match[2]}-${match[3]}`, label, errors)
}

function parseGoodreadsShelf(value: string): 'tbr' | 'reading' | 'finished' {
  const shelf = value.toLocaleLowerCase().replace(/[\s_]+/g, '-')
  if (shelf === 'read') return 'finished'
  if (shelf === 'currently-reading') return 'reading'
  return 'tbr'
}

function parseGoodreadsBoolean(value: string | undefined): boolean | undefined {
  if (!value) return undefined
  return ['1', 'true', 'yes'].includes(value.toLocaleLowerCase())
}

function combineGoodreadsNotes(review: string | undefined, privateNotes: string | undefined): string | undefined {
  if (review && privateNotes) return `Review\n${review}\n\nPrivate note\n${privateNotes}`
  return review ?? privateNotes
}

function parseShelf(value: string | undefined, errors: string[]) {
  if (!value) return undefined
  const normalized = value.toLocaleLowerCase().replace(/[\s_-]+/g, '')
  const shelves = {
    tbr: 'tbr',
    wanttoread: 'tbr',
    next: 'next',
    upnext: 'next',
    reading: 'reading',
    currentlyreading: 'reading',
    finished: 'finished',
    read: 'finished',
  } as const
  const shelf = shelves[normalized as keyof typeof shelves]
  if (!shelf) errors.push(`Unknown shelf “${value}”`)
  return shelf
}

function parseInteger(
  value: string | undefined,
  label: string,
  minimum: number,
  maximum: number | undefined,
  errors: string[],
): number | undefined {
  if (!value) return undefined
  if (!/^-?\d+$/.test(value)) {
    errors.push(`${label} must be a whole number`)
    return undefined
  }
  return parseBoundedNumber(Number(value), label, minimum, maximum, errors)
}

function parseNumber(
  value: string | undefined,
  label: string,
  minimum: number,
  maximum: number,
  errors: string[],
): number | undefined {
  if (!value) return undefined
  const parsed = Number(value.replace(/%$/, ''))
  if (!Number.isFinite(parsed)) {
    errors.push(`${label} must be a number`)
    return undefined
  }
  return parseBoundedNumber(parsed, label, minimum, maximum, errors)
}

function parseBoundedNumber(
  value: number,
  label: string,
  minimum: number,
  maximum: number | undefined,
  errors: string[],
): number | undefined {
  if (value < minimum || (maximum !== undefined && value > maximum)) {
    errors.push(
      maximum === undefined
        ? `${label} must be at least ${minimum}`
        : `${label} must be between ${minimum} and ${maximum}`,
    )
    return undefined
  }
  return value
}

function parseDate(value: string | undefined, label: string, errors: string[]): string | undefined {
  if (!value) return undefined
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T00:00:00.000Z`
    : value
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(normalized)) {
    errors.push(`${label} must be an ISO 8601 date with a timezone`)
    return undefined
  }
  const parsed = new Date(normalized)
  if (
    Number.isNaN(parsed.getTime())
    || (/^\d{4}-\d{2}-\d{2}$/.test(value) && parsed.toISOString().slice(0, 10) !== value)
  ) {
    errors.push(`${label} is not a valid date`)
    return undefined
  }
  return parsed.toISOString()
}

/** RFC 4180-compatible enough for exports: quotes, escaped quotes, commas, and embedded newlines. */
function parseCsv(content: string): { rows: string[][]; unclosedQuote: boolean } {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]!
    if (quoted) {
      if (character === '"' && content[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
      } else {
        field += character
      }
      continue
    }
    if (character === '"' && field === '') {
      quoted = true
    } else if (character === ',') {
      row.push(field)
      field = ''
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && content[index + 1] === '\n') index += 1
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += character
    }
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  return { rows, unclosedQuote: quoted }
}
