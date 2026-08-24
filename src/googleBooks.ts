import type { BookSearchResult } from './library'

type GoogleVolume = {
  id: string
  volumeInfo?: {
    title?: string
    authors?: string[]
    pageCount?: number
    imageLinks?: {
      smallThumbnail?: string
      thumbnail?: string
    }
  }
}

type GoogleBooksResponse = {
  items?: GoogleVolume[]
}

function secureImage(url?: string) {
  return url?.replace(/^http:\/\//, 'https://')
}

export async function searchGoogleBooks(query: string, signal?: AbortSignal) {
  const params = new URLSearchParams({
    q: query,
    maxResults: '16',
    orderBy: 'relevance',
    printType: 'books',
  })

  const apiKey = import.meta.env.VITE_GOOGLE_BOOKS_API_KEY as string | undefined
  if (apiKey) params.set('key', apiKey)

  const response = await fetch(`https://www.googleapis.com/books/v1/volumes?${params}`, {
    signal,
  })

  if (!response.ok) {
    throw new Error(response.status === 429 ? 'rate-limit' : `google-books-${response.status}`)
  }

  const data = (await response.json()) as GoogleBooksResponse
  return (data.items ?? [])
    .filter((item) => item.volumeInfo?.title)
    .map<BookSearchResult>((item) => ({
      id: item.id,
      title: item.volumeInfo?.title ?? 'Untitled',
      authors: item.volumeInfo?.authors?.length ? item.volumeInfo.authors : ['Unknown author'],
      pageCount: item.volumeInfo?.pageCount ?? 0,
      thumbnail: secureImage(
        item.volumeInfo?.imageLinks?.thumbnail ?? item.volumeInfo?.imageLinks?.smallThumbnail,
      ),
    }))
}
