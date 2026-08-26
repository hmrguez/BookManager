import { z } from 'zod'
import {
  editionIdentifiers,
  metadataProviderNames,
  metadataSearchQuerySchema,
  providerBookVariantSchema,
  providerVariantKey,
  type MetadataSearchQuery,
  type ProviderBookVariant,
} from './model'
import type { MetadataProvider } from './provider'
import { MetadataProviderError } from './provider'
import { ProviderTransport } from './transport'

const googleVolumeSchema = z.object({
  id: z.string().min(1),
  volumeInfo: z.object({
    title: z.string().min(1),
    authors: z.array(z.string().min(1)).optional(),
    publisher: z.string().min(1).optional(),
    publishedDate: z.string().min(4).optional(),
    language: z.string().min(2).optional(),
    pageCount: z.number().int().positive().optional(),
    industryIdentifiers: z.array(z.object({
      type: z.string().optional(),
      identifier: z.string().optional(),
    })).optional(),
    imageLinks: z.object({
      smallThumbnail: z.string().optional(),
      thumbnail: z.string().optional(),
    }).optional(),
  }).optional(),
})

const googleBooksResponseSchema = z.object({
  items: z.array(googleVolumeSchema).default([]),
})

export class GoogleBooksProvider implements MetadataProvider {
  readonly id = 'google-books' as const
  readonly name = metadataProviderNames[this.id]
  readonly #apiKey?: string
  readonly #transport: ProviderTransport
  readonly #now: () => Date

  constructor(options: {
    readonly apiKey?: string
    readonly transport?: ProviderTransport
    readonly now?: () => Date
  } = {}) {
    this.#apiKey = options.apiKey?.trim() || undefined
    this.#transport = options.transport ?? new ProviderTransport()
    this.#now = options.now ?? (() => new Date())
  }

  get configured(): boolean {
    return Boolean(this.#apiKey)
  }

  async search(query: MetadataSearchQuery, signal?: AbortSignal): Promise<ProviderBookVariant[]> {
    if (!this.#apiKey) {
      throw new MetadataProviderError(this.id, 'not-configured', 'Google Books is not configured')
    }
    const validated = metadataSearchQuerySchema.parse(query)
    const url = new URL('https://www.googleapis.com/books/v1/volumes')
    url.searchParams.set('q', validated.query)
    url.searchParams.set('maxResults', String(validated.limit))
    url.searchParams.set('orderBy', 'relevance')
    url.searchParams.set('printType', 'books')
    url.searchParams.set('langRestrict', primaryLanguage(validated.locale))
    url.searchParams.set('key', this.#apiKey)

    const payload = await this.#transport.json(this.id, url, { signal, minimumIntervalMs: 250 })
    const parsed = googleBooksResponseSchema.safeParse(payload)
    if (!parsed.success) {
      throw new MetadataProviderError(this.id, 'invalid-response', 'Google Books returned invalid metadata')
    }

    const observedAt = this.#now().toISOString()
    return parsed.data.items.flatMap((volume, providerRank) => {
      const info = volume.volumeInfo
      if (!info?.title) return []
      const identifiers = editionIdentifiers(
        info.industryIdentifiers?.flatMap(({ identifier }) => identifier ? [identifier] : []),
      )
      const thumbnail = secureImage(info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail)
      const confidence = Math.min(
        0.93,
        0.7 + (info.authors?.length ? 0.06 : 0) + (identifiers.length ? 0.09 : 0) +
          (thumbnail ? 0.03 : 0),
      )

      return [providerBookVariantSchema.parse({
        id: providerVariantKey(this.id, volume.id),
        provider: this.id,
        providerName: this.name,
        externalKey: volume.id,
        editionKey: volume.id,
        title: info.title,
        workTitle: info.title,
        authors: info.authors?.length ? info.authors : ['Unknown author'],
        identifiers,
        language: info.language,
        publisher: info.publisher,
        publicationDate: info.publishedDate,
        pageCount: info.pageCount,
        thumbnail,
        confidence,
        providerRank,
        observedAt,
      })]
    })
  }
}

function secureImage(value?: string): string | undefined {
  return value?.replace(/^http:\/\//, 'https://')
}

function primaryLanguage(locale: string): string {
  return locale.split(/[-_]/)[0]?.toLocaleLowerCase() || 'en'
}
