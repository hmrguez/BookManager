import { describe, expect, test } from 'bun:test'
import {
  applyManualBookEdits,
  createManualBookResult,
  enrichCapturedBook,
  extractValidIsbn,
  inspectIsbnInput,
  isbnFromShare,
  proposeCaptureDuplicate,
  scanIsbnBarcode,
} from '../src/capture'
import { libraryBookSchema, type BookSearchResult, type LibraryBook } from '../src/library-model'

const NOW = '2026-08-28T12:00:00.000Z'

describe('offline ISBN capture', () => {
  test('validates ISBN-10 and ISBN-13 checksums from typed, pasted, or shared text', () => {
    expect(inspectIsbnInput('0-15-645380-0')).toMatchObject({
      state: 'valid',
      isbn: { normalized: '0156453800', canonical: '9780156453806', scheme: 'isbn-10' },
    })
    expect(extractValidIsbn('Worth reading: ISBN 978-0-15-645380-6')).toEqual({
      normalized: '9780156453806',
      canonical: '9780156453806',
      scheme: 'isbn-13',
    })
    expect(inspectIsbnInput('978-0-15-645380-7')).toEqual({
      state: 'invalid',
      normalized: '9780156453807',
      message: 'That 13-digit ISBN has an invalid checksum. Check the printed number and try again.',
    })
  })

  test('extracts an ISBN from native share-sheet text', () => {
    expect(isbnFromShare({
      title: 'A book recommendation',
      texts: ['https://books.example.test/title?isbn=9780156453806'],
    })).toMatchObject({ normalized: '9780156453806' })
  })

  test('normalizes native camera results and reports permission denial as a complete fallback', async () => {
    await expect(scanIsbnBarcode({
      scanBarcode: async () => ({ ScanResult: '0-15-645380-0', format: 9 }),
    })).resolves.toMatchObject({
      state: 'scanned',
      isbn: { canonical: '9780156453806' },
    })
    await expect(scanIsbnBarcode({
      scanBarcode: async () => { throw new Error('Camera permission denied') },
    })).resolves.toEqual({
      state: 'denied',
      message: 'Camera access is off. Paste or type the ISBN below, or continue with title only.',
    })
  })

  test('creates a title-only record without network metadata', () => {
    const result = createManualBookResult({ title: 'The Left Hand of Darkness', method: 'manual-entry' }, NOW)

    expect(result).toMatchObject({
      title: 'The Left Hand of Darkness',
      authors: ['Unknown author'],
      pageCount: 0,
      capture: {
        method: 'manual-entry',
        capturedAt: NOW,
        manualOverrides: ['title'],
      },
    })
    expect(result.identifiers).toBeUndefined()
  })

  test('proposes the existing edition for equivalent ISBN-10 and ISBN-13 captures', () => {
    const existing = book({ identifiers: ['0156453800'] })
    const candidate = createManualBookResult({
      title: 'Invisible Cities',
      isbn: extractValidIsbn('9780156453806'),
      method: 'isbn-camera',
    }, NOW)

    expect(proposeCaptureDuplicate([existing], candidate)).toEqual({
      kind: 'exact-edition',
      book: existing,
    })
  })

  test('keeps a same-work, different-ISBN edition reviewable instead of silently merging it', () => {
    const existing = book({
      title: 'Invisible Cities',
      authors: ['Italo Calvino'],
      identifiers: ['9780156453806'],
    })
    const candidate = createManualBookResult({
      title: 'Invisible Cities',
      author: 'Italo Calvino',
      isbn: extractValidIsbn('9780099429838'),
      method: 'isbn-paste',
    }, NOW)

    expect(proposeCaptureDuplicate([existing], candidate)).toEqual({
      kind: 'related-edition',
      book: existing,
    })
  })

  test('enrichment fills provider facts without losing manual overrides or the captured ISBN', () => {
    const captured = book({
      title: 'My preferred title',
      authors: ['Unknown author'],
      pageCount: 0,
      identifiers: ['9780156453806'],
      capture: {
        method: 'isbn-paste',
        capturedAt: NOW,
        manualOverrides: ['title'],
      },
    })
    const provider: BookSearchResult = {
      id: 'provider-result',
      title: 'Invisible Cities',
      authors: ['Italo Calvino'],
      pageCount: 176,
      identifiers: ['9780156453806', '0156453800'],
      sourceNames: ['Open Library'],
    }

    expect(enrichCapturedBook(captured, provider, '2026-08-28T13:00:00.000Z')).toMatchObject({
      title: 'My preferred title',
      authors: ['Italo Calvino'],
      pageCount: 176,
      identifiers: ['9780156453806', '0156453800'],
      capture: {
        manualOverrides: ['title'],
        enrichedAt: '2026-08-28T13:00:00.000Z',
      },
    })
  })

  test('editing a captured record marks reader-owned fields as durable overrides', () => {
    const captured = book({ capture: undefined })
    const changes = applyManualBookEdits(captured, {
      title: 'Reader title',
      author: 'Reader author',
      pageCount: 240,
      isbn: extractValidIsbn('9780156453806'),
    }, NOW)

    expect(changes.capture).toMatchObject({
      method: 'manual-entry',
      manualOverrides: ['title', 'authors', 'pageCount'],
    })
    expect(changes.identifiers).toEqual(['9780156453806'])
  })
})

function book(overrides: Partial<LibraryBook>): LibraryBook {
  return libraryBookSchema.parse({
    id: 'book:existing',
    title: 'Invisible Cities',
    authors: ['Italo Calvino'],
    pageCount: 176,
    shelf: 'tbr',
    progress: 0,
    currentPage: 0,
    rating: 0,
    notes: '',
    addedAt: NOW,
    lastUpdatedAt: NOW,
    ...overrides,
  })
}
