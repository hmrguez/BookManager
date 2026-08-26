import { getStorageRuntime } from '../storage'
import { GoogleBooksProvider } from './google-books'
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
    primary: new OpenLibraryProvider({ transport }),
    secondary: new GoogleBooksProvider({
      apiKey: import.meta.env.VITE_GOOGLE_BOOKS_API_KEY,
      transport,
    }),
    cache: storage.metadataSearchCache,
  })
}
