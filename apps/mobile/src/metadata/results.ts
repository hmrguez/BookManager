import type { BookSearchResult } from '../library-model'
import {
  canonicalEditionIsbn,
  metadataSelectionSchema,
  normalizeSearchText,
  type MetadataConflict,
  type MetadataProviderId,
  type ProviderBookVariant,
} from './model'

const PROVIDER_ORDER: Record<MetadataProviderId, number> = {
  'open-library': 0,
  'google-books': 1,
}

export function combineProviderResults(
  variants: readonly ProviderBookVariant[],
  query: string,
  freshness: 'live' | 'saved' | 'mixed',
): BookSearchResult[] {
  const groups = new Map<string, ProviderBookVariant[]>()
  for (const variant of variants) {
    const key = identityKey(variant)
    groups.set(key, [...(groups.get(key) ?? []), variant])
  }

  return [...groups.entries()]
    .map(([key, group]) => createSearchResult(key, group, freshness === 'live' ? 'live' : 'saved'))
    .sort((left, right) => {
      const difference = resultScore(right, query) - resultScore(left, query)
      if (difference !== 0) return difference
      const title = left.title.localeCompare(right.title, undefined, { sensitivity: 'base' })
      return title !== 0 ? title : left.id.localeCompare(right.id)
    })
}

export function selectMetadataVariant(
  result: BookSearchResult,
  provider: MetadataProviderId,
): BookSearchResult {
  const selection = result.metadataSelection
  const variant = selection?.variants.find((candidate) => candidate.provider === provider)
  if (!selection || !variant) return result
  return {
    ...resultFromVariant(result.id, variant, {
      ...selection,
      selectedProvider: provider,
    }),
    capture: result.capture,
  }
}

export function metadataConfidenceLabel(confidence: number): string {
  if (confidence >= 0.92) return 'Strong match'
  if (confidence >= 0.82) return 'Good match'
  return 'Possible match'
}

function createSearchResult(
  identity: string,
  variants: readonly ProviderBookVariant[],
  freshness: 'live' | 'saved',
): BookSearchResult {
  const ordered = [...variants].sort(compareVariants)
  const selected = ordered[0]
  if (!selected) throw new Error('A metadata result group must contain a provider variant')
  const selection = metadataSelectionSchema.parse({
    selectedProvider: selected.provider,
    variants: ordered,
    conflicts: detectConflicts(ordered),
    freshness,
  })
  return resultFromVariant(`metadata:${stableHash(identity)}`, selected, selection)
}

function resultFromVariant(
  id: string,
  variant: ProviderBookVariant,
  metadataSelection: NonNullable<BookSearchResult['metadataSelection']>,
): BookSearchResult {
  return {
    id,
    title: variant.title,
    editionTitle: variant.title !== variant.workTitle ? variant.title : undefined,
    authors: variant.authors,
    identifiers: variant.identifiers.map(({ normalizedValue }) => normalizedValue),
    sourceNames: metadataSelection.variants.map(({ providerName }) => providerName),
    thumbnail: variant.thumbnail,
    pageCount: variant.pageCount ?? 0,
    metadataSelection,
  }
}

function compareVariants(left: ProviderBookVariant, right: ProviderBookVariant): number {
  const provider = PROVIDER_ORDER[left.provider] - PROVIDER_ORDER[right.provider]
  if (provider !== 0) return provider
  const confidence = right.confidence - left.confidence
  if (confidence !== 0) return confidence
  return left.providerRank - right.providerRank || left.id.localeCompare(right.id)
}

function identityKey(variant: ProviderBookVariant): string {
  const isbn13 = variant.identifiers.find(({ scheme }) => scheme === 'isbn-13')?.normalizedValue
  if (isbn13) return `isbn-13:${isbn13}`
  const isbn10 = variant.identifiers.find(({ scheme }) => scheme === 'isbn-10')?.normalizedValue
  if (isbn10) return `isbn-13:${canonicalEditionIsbn(isbn10)}`
  return `source:${variant.provider}:${variant.editionKey ?? variant.externalKey}`
}

function detectConflicts(variants: readonly ProviderBookVariant[]): MetadataConflict[] {
  if (variants.length < 2) return []
  const fields = ['title', 'authors', 'language', 'publisher', 'publicationDate', 'pageCount'] as const
  return fields.flatMap((field) => {
    const values = variants.flatMap((variant) => {
      const value = variant[field]
      return value === undefined ? [] : [{ provider: variant.provider, value }]
    })
    const unique = new Set(values.map(({ value }) => normalizeConflictValue(value)))
    return unique.size > 1 ? [{ field, values }] : []
  })
}

function normalizeConflictValue(value: string | number | string[]): string {
  if (Array.isArray(value)) return value.map(normalizeSearchText).join('|')
  return typeof value === 'string' ? normalizeSearchText(value) : String(value)
}

function resultScore(result: BookSearchResult, query: string): number {
  const selection = result.metadataSelection
  const selected = selection?.variants.find(({ provider }) => provider === selection.selectedProvider)
  if (!selected) return 0
  const normalizedQuery = normalizeSearchText(query)
  const normalizedTitle = normalizeSearchText(selected.title)
  const normalizedWorkTitle = normalizeSearchText(selected.workTitle)
  const compactQuery = normalizedQuery.replace(/\s/g, '')
  const exactIsbn = selected.identifiers.some(({ normalizedValue }) => normalizedValue === compactQuery)
  const titleScore = normalizedTitle === normalizedQuery || normalizedWorkTitle === normalizedQuery
    ? 100
    : normalizedTitle.startsWith(normalizedQuery) || normalizedWorkTitle.startsWith(normalizedQuery)
      ? 50
      : normalizedQuery.split(' ').filter(Boolean).filter((token) => normalizedTitle.includes(token)).length * 8
  return (exactIsbn ? 180 : 0) + titleScore + selected.confidence * 20 - selected.providerRank * 0.2 -
    PROVIDER_ORDER[selected.provider] * 0.1
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}
