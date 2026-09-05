import type {
  MetadataProviderId,
  MetadataSearchQuery,
  ProviderBookVariant,
} from './model'

export type MetadataProvider = {
  readonly id: MetadataProviderId
  readonly name: string
  readonly configured: boolean
  search(query: MetadataSearchQuery, signal?: AbortSignal): Promise<ProviderBookVariant[]>
  searchIsbns?(
    isbns: readonly string[],
    locale: string,
    signal?: AbortSignal,
  ): Promise<ProviderBookVariant[]>
}

export type MetadataProviderErrorCode =
  | 'aborted'
  | 'invalid-response'
  | 'not-configured'
  | 'rate-limit'
  | 'unavailable'

export class MetadataProviderError extends Error {
  readonly provider: MetadataProviderId
  readonly code: MetadataProviderErrorCode
  readonly retryAfterMs?: number

  constructor(
    provider: MetadataProviderId,
    code: MetadataProviderErrorCode,
    message: string,
    retryAfterMs?: number,
  ) {
    super(message)
    this.name = 'MetadataProviderError'
    this.provider = provider
    this.code = code
    this.retryAfterMs = retryAfterMs
  }
}

export function isAbortError(error: unknown): boolean {
  return (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError') ||
    (error instanceof MetadataProviderError && error.code === 'aborted')
}
