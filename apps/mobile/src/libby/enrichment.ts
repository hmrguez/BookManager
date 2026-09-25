import { canonicalEditionIsbn } from '../metadata/model'
import type { MetadataSearchService } from '../metadata/service'
import type { LibbyRepository } from './repository'

/** No private observation, link ID, progress, or credential crosses the provider boundary. */
export class LibbyEnrichment {
  private running?: Promise<void>
  private readonly repository: LibbyRepository
  private readonly metadata: MetadataSearchService
  constructor(repository: LibbyRepository, metadata: MetadataSearchService) {
    this.repository = repository
    this.metadata = metadata
  }

  run(locale: string, beforeCommit: () => Promise<unknown> = async () => {}): Promise<void> {
    if (this.running) return this.running
    this.running = this.process(locale, beforeCommit).finally(() => { this.running = undefined })
    return this.running
  }

  private async process(locale: string, beforeCommit: () => Promise<unknown>) {
    const batch = await this.repository.prepareEnrichment()
    for (const { job, book } of batch) {
      const isbn = book.identifiers?.flatMap(value => canonicalEditionIsbn(value) ?? [])[0]
      const quote = (value: string) => `"${value.replace(/[\\"]/g, '\\$&')}"`
      const query = isbn ?? `title:${quote(book.title)} AND author:${quote(book.authors[0] ?? '')}`
      try {
        if (!isbn && (!book.authors.length || query.length > 240)) {
          await this.repository.finishEnrichment(job.id, [], true)
          continue
        }
        const response = await this.metadata.searchEnrichment({ query, locale, limit: 16 }, AbortSignal.timeout(20_000))
        const available = response.providers.every(provider => ['live', 'saved', 'empty'].includes(provider.state) && !provider.message)
        await beforeCommit()
        await this.repository.finishEnrichment(job.id, response.results.flatMap(result => result.metadataSelection?.variants ?? []), available)
      } catch {
        // Persisted lease resumes later; network/cache/write errors never reject progress capture.
      }
    }
  }
}
