import { getStorageRuntime } from '../storage'
import { OpenLibraryProvider } from './open-library'
import { MetadataSearchService } from './service'
import { ProviderTransport } from './transport'

let servicePromise: Promise<MetadataSearchService> | undefined

export function getMetadataSearchService(): Promise<MetadataSearchService> {
  servicePromise ??= createMetadataSearchService()
  return servicePromise
}

async function createMetadataSearchService(): Promise<MetadataSearchService> {
  const storage = await getStorageRuntime()
  const transport = new ProviderTransport()
  return new MetadataSearchService({
    provider: new OpenLibraryProvider({ transport }),
    cache: storage.metadataSearchCache,
  })
}
