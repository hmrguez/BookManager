import { z } from 'zod'

export const metadataProviderIdSchema = z.enum(['open-library', 'google-books'])
export type MetadataProviderId = z.infer<typeof metadataProviderIdSchema>

export const metadataProviderNames: Record<MetadataProviderId, string> = {
  'open-library': 'Open Library',
  'google-books': 'Google Books',
}

export const editionIdentifierSchema = z.object({
  owner: z.literal('edition'),
  scheme: z.enum(['isbn-10', 'isbn-13']),
  value: z.string().min(1),
  normalizedValue: z.string().min(1),
})

export type EditionIdentifier = z.infer<typeof editionIdentifierSchema>

export const providerBookVariantSchema = z.object({
  id: z.string().min(1),
  provider: metadataProviderIdSchema,
  providerName: z.string().min(1),
  externalKey: z.string().min(1),
  workKey: z.string().min(1).optional(),
  editionKey: z.string().min(1).optional(),
  /** Only identifiers reported on this edition, never the work's ISBN union. */
  verifiedEditionIdentifiers: z.array(editionIdentifierSchema).optional(),
  medium: z.enum(['ebook', 'audiobook', 'print']).optional(),
  editionPageCount: z.number().int().positive().optional(),
  editionThumbnail: z.url().optional(),
  subjects: z.array(z.object({
    scope: z.enum(['work', 'edition']),
    sourceKey: z.string().min(1),
    values: z.array(z.string().min(1)).max(1000),
  })).optional(),
  title: z.string().min(1),
  workTitle: z.string().min(1),
  authors: z.array(z.string().min(1)).min(1),
  identifiers: z.array(editionIdentifierSchema),
  language: z.string().min(2).optional(),
  publisher: z.string().min(1).optional(),
  publicationDate: z.string().min(4).optional(),
  pageCount: z.number().int().positive().optional(),
  thumbnail: z.url().optional(),
  confidence: z.number().min(0).max(1),
  providerRank: z.number().int().nonnegative(),
  observedAt: z.iso.datetime({ offset: true }),
})

export type ProviderBookVariant = z.infer<typeof providerBookVariantSchema>

export const metadataConflictSchema = z.object({
  field: z.enum(['title', 'authors', 'language', 'publisher', 'publicationDate', 'pageCount']),
  values: z.array(z.object({
    provider: metadataProviderIdSchema,
    value: z.union([z.string(), z.number(), z.array(z.string())]),
  })).min(2),
})

export type MetadataConflict = z.infer<typeof metadataConflictSchema>

export const metadataSelectionSchema = z.object({
  selectedProvider: metadataProviderIdSchema,
  variants: z.array(providerBookVariantSchema).min(1),
  conflicts: z.array(metadataConflictSchema),
  freshness: z.enum(['live', 'saved']),
})

export type MetadataSelection = z.infer<typeof metadataSelectionSchema>

export const metadataSearchCacheEntrySchema = z.object({
  provider: metadataProviderIdSchema,
  queryKey: z.string().min(1),
  locale: z.string().min(2),
  observedAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
  variants: z.array(providerBookVariantSchema),
})

export type MetadataSearchCacheEntry = z.infer<typeof metadataSearchCacheEntrySchema>

export const metadataSearchQuerySchema = z.object({
  query: z.string().trim().min(2).max(240),
  locale: z.string().trim().min(2).max(35),
  limit: z.number().int().min(1).max(40).default(16),
})

export type MetadataSearchQuery = z.infer<typeof metadataSearchQuerySchema>

export type ProviderSearchState = {
  readonly provider: MetadataProviderId
  readonly state: 'live' | 'saved' | 'empty' | 'unavailable' | 'not-configured'
  readonly message?: string
}

export type MetadataSearchResponse<Result> = {
  readonly results: readonly Result[]
  readonly providers: readonly ProviderSearchState[]
}

export function normalizeIsbn(value: string): string | undefined {
  const normalized = value.toUpperCase().replace(/[^0-9X]/g, '')
  if (/^\d{13}$/.test(normalized) && isValidIsbn13(normalized)) return normalized
  if (/^\d{9}[\dX]$/.test(normalized) && isValidIsbn10(normalized)) return normalized
  return undefined
}

export function canonicalEditionIsbn(value: string): string | undefined {
  const normalized = normalizeIsbn(value)
  if (!normalized || normalized.length === 13) return normalized
  const body = `978${normalized.slice(0, 9)}`
  const weighted = [...body].reduce(
    (sum, digit, index) => sum + Number(digit) * (index % 2 === 0 ? 1 : 3),
    0,
  )
  return `${body}${(10 - (weighted % 10)) % 10}`
}

export function editionIdentifiers(values: readonly string[] | undefined): EditionIdentifier[] {
  const unique = new Set<string>()
  const identifiers: EditionIdentifier[] = []
  for (const value of values ?? []) {
    const normalizedValue = normalizeIsbn(value)
    if (!normalizedValue || unique.has(normalizedValue)) continue
    unique.add(normalizedValue)
    identifiers.push({
      owner: 'edition',
      scheme: normalizedValue.length === 13 ? 'isbn-13' : 'isbn-10',
      value,
      normalizedValue,
    })
  }
  return identifiers
}

export function providerVariantKey(provider: MetadataProviderId, externalKey: string): string {
  return `${provider}:${externalKey}`
}

export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export function metadataQueryKey(query: string, locale: string, limit: number): string {
  return `${normalizeSearchText(query)}|${locale.toLocaleLowerCase()}|${limit}`
}

function isValidIsbn13(value: string): boolean {
  return [...value].reduce(
    (sum, digit, index) => sum + Number(digit) * (index % 2 === 0 ? 1 : 3),
    0,
  ) % 10 === 0
}

function isValidIsbn10(value: string): boolean {
  const weighted = [...value].reduce((sum, character, index) => {
    const digit = character === 'X' ? 10 : Number(character)
    return sum + digit * (10 - index)
  }, 0)
  return weighted % 11 === 0
}
