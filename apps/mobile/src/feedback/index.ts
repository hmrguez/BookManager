export { nativeFeedback, type WovenleafFeedbackPlugin } from './bridge'
export {
  FEEDBACK_EVENTS,
  FEEDBACK_GRAMMAR,
  FEEDBACK_PLATFORM_MATRIX,
  type FeedbackCapabilities,
  type FeedbackEmitOptions,
  type FeedbackEvent,
  type FeedbackPreferences,
  type FeedbackResult,
  type FeedbackSoundProfile,
} from './model'
export {
  DEFAULT_FEEDBACK_PREFERENCES,
  FEEDBACK_PREFERENCES_STORAGE_KEY,
  getFeedbackPreferencesStorage,
  readFeedbackPreferences,
  writeFeedbackPreferences,
} from './preferences'
export { FeedbackController, feedback } from './service'
