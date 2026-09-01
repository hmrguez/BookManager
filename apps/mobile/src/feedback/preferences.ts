import type { FeedbackPreferences } from './model'

export const FEEDBACK_PREFERENCES_STORAGE_KEY = 'wovenleaf.feedback.preferences.v1'

export const DEFAULT_FEEDBACK_PREFERENCES: FeedbackPreferences = {
  haptics: 'system',
  sound: 'off',
}

export function readFeedbackPreferences(storage?: Storage): FeedbackPreferences {
  if (!storage) return DEFAULT_FEEDBACK_PREFERENCES
  try {
    const saved = JSON.parse(storage.getItem(FEEDBACK_PREFERENCES_STORAGE_KEY) ?? 'null') as unknown
    if (!isObject(saved)) return DEFAULT_FEEDBACK_PREFERENCES
    return {
      haptics: saved.haptics === 'off' ? 'off' : 'system',
      sound: saved.sound === 'quiet' ? 'quiet' : 'off',
    }
  } catch {
    return DEFAULT_FEEDBACK_PREFERENCES
  }
}

export function writeFeedbackPreferences(
  storage: Storage | undefined,
  preferences: FeedbackPreferences,
): void {
  if (!storage) return
  try {
    storage.setItem(FEEDBACK_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences))
  } catch {
    // The current session keeps the preference when durable browser storage is unavailable.
  }
}

export function getFeedbackPreferencesStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
