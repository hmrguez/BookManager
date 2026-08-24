import { describe, expect, test } from 'bun:test'
import {
  LEGACY_LIBRARY_STORAGE_KEYS,
  LIBRARY_STORAGE_KEY,
  readLibrary,
  type LibraryBook,
  type LibraryStorage,
} from '../src/library'

class MemoryStorage implements LibraryStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }

  removeItem(key: string) {
    this.values.delete(key)
  }
}

const savedLibrary: LibraryBook[] = [
  {
    id: 'existing-development-book',
    title: 'The Left Hand of Darkness',
    authors: ['Ursula K. Le Guin'],
    pageCount: 304,
    shelf: 'reading',
    progress: 42,
    currentPage: 128,
    rating: 0,
    notes: 'Keep this note through the rename.',
    addedAt: '2026-08-20T10:00:00.000Z',
    startedAt: '2026-08-21T10:00:00.000Z',
    lastUpdatedAt: '2026-08-24T10:00:00.000Z',
  },
]

describe('Wovenleaf library storage', () => {
  test('migrates the existing development library without changing its data', () => {
    const storage = new MemoryStorage()
    const legacyKey = LEGACY_LIBRARY_STORAGE_KEYS[0]
    storage.setItem(legacyKey, JSON.stringify(savedLibrary))

    expect(readLibrary(storage)).toEqual(savedLibrary)
    expect(JSON.parse(storage.getItem(LIBRARY_STORAGE_KEY) ?? 'null')).toEqual(savedLibrary)
    expect(storage.getItem(legacyKey)).toBeNull()
  })

  test('uses a legacy recovery copy when the new key is malformed', () => {
    const storage = new MemoryStorage()
    storage.setItem(LIBRARY_STORAGE_KEY, '{not valid json')
    storage.setItem(LEGACY_LIBRARY_STORAGE_KEYS[0], JSON.stringify(savedLibrary))

    expect(readLibrary(storage)).toEqual(savedLibrary)
  })
})
