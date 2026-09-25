import { getMetadataSearchService } from '../metadata/runtime'
import { getStorageRuntime } from '../storage/runtime'
import { LibbyEnrichment } from './enrichment'

let enrichment: Promise<LibbyEnrichment> | undefined
export function getLibbyEnrichment(): Promise<LibbyEnrichment> {
  enrichment ??= Promise.all([getStorageRuntime(), getMetadataSearchService()])
    .then(([storage, metadata]) => new LibbyEnrichment(storage.libby, metadata))
    .catch(error => { enrichment = undefined; throw error })
  return enrichment
}
