export const SYSTEM_MEDIA_PREFERENCES_STORAGE_KEY = 'wovenleaf.system-media.preferences.v1'

export type SystemMediaPreferences = {
  readonly showBookDetailsWhenLocked: boolean
}

export const DEFAULT_SYSTEM_MEDIA_PREFERENCES: SystemMediaPreferences = {
  showBookDetailsWhenLocked: false,
}

export function readSystemMediaPreferences(storage?: Storage): SystemMediaPreferences {
  if (!storage) return DEFAULT_SYSTEM_MEDIA_PREFERENCES
  try {
    const stored = JSON.parse(storage.getItem(SYSTEM_MEDIA_PREFERENCES_STORAGE_KEY) ?? 'null') as unknown
    if (!isObject(stored) || typeof stored.showBookDetailsWhenLocked !== 'boolean') {
      return DEFAULT_SYSTEM_MEDIA_PREFERENCES
    }
    return { showBookDetailsWhenLocked: stored.showBookDetailsWhenLocked }
  } catch {
    return DEFAULT_SYSTEM_MEDIA_PREFERENCES
  }
}

export function writeSystemMediaPreferences(
  storage: Storage | undefined,
  preferences: SystemMediaPreferences,
): void {
  if (!storage) return
  try {
    storage.setItem(SYSTEM_MEDIA_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences))
  } catch {
    // The native engine still applies the choice for this session when browser storage is unavailable.
  }
}

export function getSystemMediaPreferencesStorage(): Storage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
