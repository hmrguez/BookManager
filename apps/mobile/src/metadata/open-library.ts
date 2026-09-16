import { z } from 'zod'
import {
  canonicalEditionIsbn,
  editionIdentifiers,
  metadataProviderNames,
  metadataSearchQuerySchema,
  normalizeIsbn,
  normalizeSearchText,
  providerBookVariantSchema,
  providerVariantKey,
  type MetadataSearchQuery,
  type ProviderBookVariant,
} from './model'
import type { MetadataBookIdentity, MetadataProvider } from './provider'
import { isAbortError, MetadataPartialBatchError, MetadataProviderError } from './provider'
import { ProviderTransport } from './transport'

const openLibraryEditionSchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1).optional(),
  isbn: z.array(z.string()).optional(),
  language: z.array(z.string()).optional(),
  publisher: z.array(z.string()).optional(),
  publish_date: z.array(z.string()).optional(),
  number_of_pages: z.number().int().positive().optional().catch(undefined),
  cover_i: z.number().int().positive().optional().catch(undefined),
})

const openLibraryDocumentSchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  author_name: z.array(z.string()).optional(),
  cover_i: z.number().int().positive().optional().catch(undefined),
  first_publish_year: z.number().int().optional(),
  isbn: z.array(z.string()).optional(),
  number_of_pages_median: z.number().int().positive().optional().catch(undefined),
  language: z.array(z.string()).optional(),
  editions: z.object({ docs: z.array(openLibraryEditionSchema) }).optional(),
})

const openLibraryResponseSchema = z.object({
  docs: z.array(openLibraryDocumentSchema).default([]),
  numFound: z.number().optional(),
  num_found: z.number().optional(),
})

const openLibraryReadCoverSchema = z.object({
  small: z.string().nullish(),
  medium: z.string().nullish(),
  large: z.string().nullish(),
})

const openLibraryReadRecordSchema = z.object({
  data: z.object({
    key: z.string().nullish(),
    title: z.string().min(1).nullish(),
    authors: z.array(z.object({ name: z.string().min(1).nullish() })).nullish(),
    cover: openLibraryReadCoverSchema.nullish(),
  }).nullish(),
})

const openLibraryReadEntrySchema = z.object({
  records: z.record(z.string(), openLibraryReadRecordSchema).default({}),
  items: z.array(z.object({
    match: z.string().nullish(),
    fromRecord: z.string().nullish(),
    cover: openLibraryReadCoverSchema.nullish(),
  })).default([]),
})

const openLibraryReadResponseSchema = z.record(z.string(), openLibraryReadEntrySchema)

const OPEN_LIBRARY_FIELDS = [
  'key',
  'title',
  'author_name',
  'cover_i',
  'first_publish_year',
  'isbn',
  'number_of_pages_median',
  'language',
  'editions',
  'editions.key',
  'editions.title',
  'editions.isbn',
  'editions.language',
  'editions.publisher',
  'editions.publish_date',
  'editions.number_of_pages',
  'editions.cover_i',
].join(',')

export const OPEN_LIBRARY_ISBN_BATCH_SIZE = 40
export const OPEN_LIBRARY_TITLE_BATCH_SIZE = 10

export function coverSearchTitle(title: string): string {
  return title.replace(/\s*\([^)]*\)\s*$/, '').trim()
}

export class OpenLibraryProvider implements MetadataProvider {
  readonly id = 'open-library' as const
  readonly name = metadataProviderNames[this.id]
  readonly configured = true
  readonly #transport: ProviderTransport
  readonly #now: () => Date
  #readCoversUnavailable = false

  constructor(options: { readonly transport?: ProviderTransport; readonly now?: () => Date } = {}) {
    this.#transport = options.transport ?? new ProviderTransport()
    this.#now = options.now ?? (() => new Date())
  }

  async search(query: MetadataSearchQuery, signal?: AbortSignal): Promise<ProviderBookVariant[]> {
    const validated = metadataSearchQuerySchema.parse(query)
    const url = new URL('https://openlibrary.org/search.json')
    url.searchParams.set(isIsbnQuery(validated.query) ? 'isbn' : 'q', validated.query)
    url.searchParams.set('lang', primaryLanguage(validated.locale))
    url.searchParams.set('limit', String(validated.limit))
    url.searchParams.set('fields', OPEN_LIBRARY_FIELDS)

    return this.#search(url, validated.query, signal)
  }

  async searchIsbns(
    inputIsbns: readonly string[],
    locale: string,
    signal?: AbortSignal,
  ): Promise<ProviderBookVariant[]> {
    const isbns = [...new Set(inputIsbns.flatMap((value) => normalizeIsbn(value) ?? []))]
    if (!isbns.length) return []
    if (isbns.length > OPEN_LIBRARY_ISBN_BATCH_SIZE) {
      throw new Error(`Open Library ISBN batches are limited to ${OPEN_LIBRARY_ISBN_BATCH_SIZE} books`)
    }
    const url = new URL('https://openlibrary.org/search.json')
    url.searchParams.set('q', `isbn:(${isbns.join(' OR ')})`)
    url.searchParams.set('lang', primaryLanguage(locale))
    url.searchParams.set('limit', String(OPEN_LIBRARY_ISBN_BATCH_SIZE))
    url.searchParams.set('fields', OPEN_LIBRARY_FIELDS)
    const canonicalIsbns = new Set(isbns.flatMap((isbn) => canonicalEditionIsbn(isbn) ?? []))
    const variants = await this.#search(url, isbns.join(' '), signal, canonicalIsbns)
    const coveredIsbns = new Set(variants.flatMap((variant) => variant.thumbnail
      ? variant.identifiers.flatMap(({ normalizedValue }) => canonicalEditionIsbn(normalizedValue) ?? [])
      : [],
    ))
    const unresolvedIsbns = isbns.filter((isbn) => {
      const canonical = canonicalEditionIsbn(isbn)
      return canonical ? !coveredIsbns.has(canonical) : false
    })
    if (!unresolvedIsbns.length || this.#readCoversUnavailable) return variants

    try {
      const deepCoverVariants = await this.#readCovers(unresolvedIsbns, signal, variants.length)
      return [...variants, ...deepCoverVariants]
    } catch (error) {
      if (isAbortError(error)) throw error
      // The legacy Read API can be absent even while search.json works. Do not
      // discard primary matches or call that unavailable endpoint for every batch.
      if (error instanceof MetadataProviderError && error.httpStatus === 404) {
        this.#readCoversUnavailable = true
        return variants
      }
      if (error instanceof MetadataProviderError) throw new MetadataPartialBatchError(error, variants)
      throw error
    }
  }

  async searchTitles(books: readonly MetadataBookIdentity[], locale: string, signal?: AbortSignal): Promise<ProviderBookVariant[]> {
    if (!books.length) return []
    if (books.length > OPEN_LIBRARY_TITLE_BATCH_SIZE) throw new Error('Open Library title batches are limited to 10 books')
    const quote = (value: string) => `"${value.replace(/[\\"]/g, '\\$&')}"`
    const search = (targets: readonly MetadataBookIdentity[], fields: string) => {
      const query = targets.map((book) => `(title:${quote(coverSearchTitle(book.title))} AND author:${quote(book.authors[0] ?? '')})`).join(' OR ')
      const url = new URL('https://openlibrary.org/search.json')
      url.search = new URLSearchParams({ q: query, lang: primaryLanguage(locale), limit: '100', fields }).toString()
      return this.#search(url, query, signal, undefined, true)
    }
    // Requesting editions changes Open Library's matching behavior and can hide
    // a work that has a cover. Preserve work matches before asking for editions.
    const works = await search(books, 'key,title,author_name,isbn,cover_i')
    const remaining = books.filter((book) => !works.some((variant) => variant.thumbnail
      && normalizeSearchText(coverSearchTitle(variant.title)) === normalizeSearchText(coverSearchTitle(book.title))
      && variant.authors.some((author) => book.authors.some((expected) => normalizeSearchText(author) === normalizeSearchText(expected)))))
    if (!remaining.length) return works
    try {
      return [...works, ...await search(remaining, OPEN_LIBRARY_FIELDS)]
    } catch (error) {
      if (isAbortError(error)) throw error
      if (error instanceof MetadataProviderError) throw new MetadataPartialBatchError(error, works)
      throw error
    }
  }

  async #readCovers(
    isbns: readonly string[],
    signal: AbortSignal | undefined,
    providerRankOffset: number,
  ): Promise<ProviderBookVariant[]> {
    const requestList = isbns.map((isbn) => `isbn:${isbn}`).join('|')
    const url = new URL(`https://openlibrary.org/api/volumes/brief/json/${requestList}`)
    const payload = await this.#transport.json(this.id, url, { signal, minimumIntervalMs: 1_000 })
    const parsed = openLibraryReadResponseSchema.safeParse(payload)
    if (!parsed.success) {
      throw new MetadataProviderError(this.id, 'invalid-response', 'Open Library returned invalid cover data')
    }

    const observedAt = this.#now().toISOString()
    return isbns.flatMap((isbn, index) => {
      const entry = readEntryForIsbn(parsed.data, isbn)
      if (!entry) return []
      const recordEntries = Object.entries(entry.records)
      const coveredRecord = recordEntries.find(([, record]) => preferredCover(record.data?.cover))
        ?? recordEntries[0]
      const exactItem = entry.items.find((item) => item.match === 'exact' && preferredCover(item.cover))
      const similarItem = entry.items.find((item) => item.match === 'similar' && preferredCover(item.cover))
      const thumbnail = preferredCover(coveredRecord?.[1].data?.cover)
        ?? preferredCover(exactItem?.cover)
        ?? preferredCover(similarItem?.cover)
      if (!thumbnail) return []

      const recordKey = coveredRecord?.[1].data?.key ?? coveredRecord?.[0]
        ?? exactItem?.fromRecord ?? similarItem?.fromRecord
      const externalKey = `${trimOpenLibraryKey(recordKey ?? `isbn-${isbn}`)}@${isbn}`
      const title = coveredRecord?.[1].data?.title ?? `ISBN ${isbn}`
      const observedAuthors = coveredRecord?.[1].data?.authors?.flatMap(({ name }) => name ?? [])
      const authors = observedAuthors?.length ? observedAuthors : ['Unknown author']

      return [providerBookVariantSchema.parse({
        id: providerVariantKey(this.id, externalKey),
        provider: this.id,
        providerName: this.name,
        externalKey,
        editionKey: recordKey?.startsWith('/books/') ? trimOpenLibraryKey(recordKey) : undefined,
        title,
        workTitle: title,
        authors,
        identifiers: editionIdentifiers([isbn]),
        thumbnail: ensureHttps(thumbnail),
        confidence: coveredRecord || exactItem ? 0.99 : 0.9,
        providerRank: providerRankOffset + index,
        observedAt,
      })]
    })
  }

  async #search(
    url: URL,
    query: string,
    signal?: AbortSignal,
    exactIsbns?: ReadonlySet<string>,
    paginate = false,
  ): Promise<ProviderBookVariant[]> {
    const payload = await this.#transport.json(this.id, url, { signal, minimumIntervalMs: 1_000 })
    const parsed = openLibraryResponseSchema.safeParse(payload)
    if (!parsed.success) {
      throw new MetadataProviderError(this.id, 'invalid-response', 'Open Library returned invalid metadata')
    }

    const observedAt = this.#now().toISOString()
    const offset = Number(url.searchParams.get('offset') ?? 0)
    const variants = parsed.data.docs.map((document, providerRank) => {
      const edition = document.editions?.docs[0]
      const identifiers = editionIdentifiers([...(edition?.isbn ?? []), ...(document.isbn ?? [])])
      const coverId = edition?.cover_i ?? document.cover_i
      const observedAuthors = document.author_name?.map((name) => name.trim()).filter(Boolean)
      const authors = observedAuthors?.length ? observedAuthors : ['Unknown author']
      const externalKey = trimOpenLibraryKey(edition?.key ?? document.key)
      const confidence = confidenceFor(document, edition, identifiers, query, exactIsbns)

      return providerBookVariantSchema.parse({
        id: providerVariantKey(this.id, externalKey),
        provider: this.id,
        providerName: this.name,
        externalKey,
        workKey: trimOpenLibraryKey(document.key),
        editionKey: edition ? trimOpenLibraryKey(edition.key) : undefined,
        title: edition?.title ?? document.title,
        workTitle: document.title,
        authors,
        identifiers,
        language: firstText(edition?.language) ?? firstText(document.language),
        publisher: firstText(edition?.publisher),
        publicationDate: firstText(edition?.publish_date) ??
          (document.first_publish_year ? String(document.first_publish_year) : undefined),
        pageCount: edition?.number_of_pages ?? document.number_of_pages_median,
        thumbnail: coverId
          ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg?default=false`
          : undefined,
        confidence,
        providerRank: offset + providerRank,
        observedAt,
      })
    })
    if (paginate && parsed.data.docs.length && offset + parsed.data.docs.length < (parsed.data.numFound ?? parsed.data.num_found ?? 0)) {
      const next = new URL(url)
      next.searchParams.set('offset', String(offset + parsed.data.docs.length))
      return [...variants, ...await this.#search(next, query, signal, exactIsbns, true)]
    }
    return variants
  }
}

function firstText(values: readonly string[] | undefined): string | undefined {
  return values?.map((value) => value.trim()).find(Boolean)
}

function trimOpenLibraryKey(value: string): string {
  return value.replace(/^\/(?:works|books)\//, '')
}

function readEntryForIsbn(
  response: z.infer<typeof openLibraryReadResponseSchema>,
  isbn: string,
): z.infer<typeof openLibraryReadEntrySchema> | undefined {
  const exact = response[`isbn:${isbn}`]
  if (exact) return exact
  return Object.entries(response).find(([key]) => normalizeIsbn(key.replace(/^isbn:/, '')) === isbn)?.[1]
}

function preferredCover(cover: z.infer<typeof openLibraryReadCoverSchema> | null | undefined): string | undefined {
  return cover?.medium ?? cover?.large ?? cover?.small ?? undefined
}

function ensureHttps(value: string): string {
  return value.replace(/^http:\/\//, 'https://')
}

function primaryLanguage(locale: string): string {
  return locale.split(/[-_]/)[0]?.toLocaleLowerCase() || 'en'
}

function isIsbnQuery(query: string): boolean {
  return /^\s*(?:97[89][\s-]*)?\d[\d\s-]{8,}[\dX]\s*$/i.test(query)
}

function confidenceFor(
  document: z.infer<typeof openLibraryDocumentSchema>,
  edition: z.infer<typeof openLibraryEditionSchema> | undefined,
  identifiers: ReturnType<typeof editionIdentifiers>,
  query: string,
  exactIsbns?: ReadonlySet<string>,
): number {
  if (exactIsbns && identifiers.some(({ normalizedValue }) => {
    const canonical = canonicalEditionIsbn(normalizedValue)
    return canonical ? exactIsbns.has(canonical) : false
  })) return 0.98
  if (isIsbnQuery(query) && identifiers.length) return 0.98
  let confidence = 0.76
  if (edition) confidence += 0.07
  if (document.author_name?.length) confidence += 0.05
  if (identifiers.length) confidence += 0.04
  if (edition?.cover_i ?? document.cover_i) confidence += 0.03
  return Math.min(0.95, confidence)
}
