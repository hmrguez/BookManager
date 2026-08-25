export const SEARCH_PREFERENCES_STORAGE_KEY = 'wovenleaf.search.preferences.v1'

export type SearchPreferences = {
  readonly includePrivateNotes: boolean
}

export const DEFAULT_SEARCH_PREFERENCES: SearchPreferences = {
  includePrivateNotes: false,
}

export function readSearchPreferences(storage?: Storage): SearchPreferences {
  if (!storage) return DEFAULT_SEARCH_PREFERENCES
  try {
    const stored = JSON.parse(storage.getItem(SEARCH_PREFERENCES_STORAGE_KEY) ?? 'null') as unknown
    if (!isObject(stored) || typeof stored.includePrivateNotes !== 'boolean') {
      return DEFAULT_SEARCH_PREFERENCES
    }
    return { includePrivateNotes: stored.includePrivateNotes }
  } catch {
    return DEFAULT_SEARCH_PREFERENCES
  }
}

export function writeSearchPreferences(
  storage: Storage | undefined,
  preferences: SearchPreferences,
): void {
  if (!storage) return
  try {
    storage.setItem(SEARCH_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences))
  } catch {
    // Search remains available for the session when browser storage is unavailable.
  }
}

export function getSearchPreferencesStorage(): Storage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
