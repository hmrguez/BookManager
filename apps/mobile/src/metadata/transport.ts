import type { MetadataProviderId } from './model'
import { MetadataProviderError, isAbortError } from './provider'

type Fetch = typeof globalThis.fetch

export type ProviderTransportOptions = {
  readonly fetch?: Fetch
  readonly now?: () => number
  readonly sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>
  readonly maxRetries?: number
}

const RETRYABLE_STATUS = new Set([429, 502, 503, 504])

export class ProviderTransport {
  readonly #fetch: Fetch
  readonly #now: () => number
  readonly #sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>
  readonly #maxRetries: number
  readonly #nextRequestAt = new Map<MetadataProviderId, number>()

  constructor(options: ProviderTransportOptions = {}) {
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.#now = options.now ?? Date.now
    this.#sleep = options.sleep ?? abortableSleep
    this.#maxRetries = options.maxRetries ?? 1
  }

  async json(
    provider: MetadataProviderId,
    url: URL,
    options: {
      readonly signal?: AbortSignal
      readonly minimumIntervalMs?: number
      readonly headers?: HeadersInit
    } = {},
  ): Promise<unknown> {
    const minimumIntervalMs = options.minimumIntervalMs ?? 0
    let attempt = 0

    while (true) {
      await this.#reserve(provider, minimumIntervalMs, options.signal)
      try {
        const response = await this.#fetch(url, {
          headers: options.headers,
          signal: options.signal,
        })
        if (response.ok) return await response.json()

        const retryAfterMs = retryDelay(response.headers.get('retry-after'), attempt)
        if (RETRYABLE_STATUS.has(response.status) && attempt < this.#maxRetries) {
          attempt += 1
          await this.#sleep(retryAfterMs, options.signal)
          continue
        }

        throw new MetadataProviderError(
          provider,
          response.status === 429 ? 'rate-limit' : 'unavailable',
          `${provider} returned HTTP ${response.status}`,
          response.status === 429 ? retryAfterMs : undefined,
          response.status,
        )
      } catch (error) {
        if (isAbortError(error)) throw error
        if (error instanceof MetadataProviderError) throw error
        if (attempt < this.#maxRetries) {
          attempt += 1
          await this.#sleep(retryDelay(undefined, attempt - 1), options.signal)
          continue
        }
        throw new MetadataProviderError(provider, 'unavailable', `${provider} is unavailable`)
      }
    }
  }

  async #reserve(
    provider: MetadataProviderId,
    minimumIntervalMs: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const current = this.#now()
    const reservedAt = Math.max(current, this.#nextRequestAt.get(provider) ?? current)
    this.#nextRequestAt.set(provider, reservedAt + minimumIntervalMs)
    if (reservedAt > current) await this.#sleep(reservedAt - current, signal)
  }
}

function retryDelay(retryAfter: string | null | undefined, attempt: number): number {
  if (retryAfter) {
    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 10_000)
    const date = Date.parse(retryAfter)
    if (Number.isFinite(date)) return Math.min(Math.max(0, date - Date.now()), 10_000)
  }
  return Math.min(400 * 2 ** attempt, 3_200)
}

function abortableSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve()
  if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))

  return new Promise((resolve, reject) => {
    const handleAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort)
      resolve()
    }, milliseconds)
    signal?.addEventListener('abort', handleAbort, { once: true })
  })
}
