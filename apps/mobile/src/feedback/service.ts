import { nativeFeedback, type WovenleafFeedbackPlugin } from './bridge'
import {
  FEEDBACK_GRAMMAR,
  type FeedbackEmitOptions,
  type FeedbackEvent,
  type FeedbackPreferences,
  type FeedbackResult,
} from './model'
import { DEFAULT_FEEDBACK_PREFERENCES } from './preferences'

type FeedbackControllerOptions = {
  readonly plugin?: WovenleafFeedbackPlugin
  readonly now?: () => number
  readonly isBackground?: () => boolean
}

export class FeedbackController {
  readonly #plugin: WovenleafFeedbackPlugin
  readonly #now: () => number
  readonly #isBackground: () => boolean
  readonly #lastPlayedAt = new Map<FeedbackEvent, number>()
  readonly #operationIds = new Set<string>()
  #preferences = DEFAULT_FEEDBACK_PREFERENCES

  constructor(options: FeedbackControllerOptions = {}) {
    this.#plugin = options.plugin ?? nativeFeedback
    this.#now = options.now ?? (() => performance.now())
    this.#isBackground = options.isBackground ?? (() => typeof document !== 'undefined' && document.hidden)
  }

  configure(preferences: FeedbackPreferences): void {
    this.#preferences = preferences
  }

  async emit(event: FeedbackEvent, options: FeedbackEmitOptions = {}): Promise<FeedbackResult> {
    const haptics = this.#preferences.haptics === 'system'
    const sound = this.#preferences.sound === 'quiet'
    if (!haptics && !sound) return skipped('disabled')
    if (this.#isBackground()) return skipped('background')

    if (options.operationId) {
      if (this.#operationIds.has(options.operationId)) return skipped('duplicate')
      this.#rememberOperation(options.operationId)
    }

    const now = this.#now()
    const previous = this.#lastPlayedAt.get(event)
    if (previous !== undefined && now - previous < FEEDBACK_GRAMMAR[event].cooldownMs) {
      return skipped('throttled')
    }
    this.#lastPlayedAt.set(event, now)

    try {
      return await this.#plugin.emit({
        event,
        haptics,
        sound,
        soundProfile: options.soundProfile ?? 'semantic',
      })
    } catch {
      return { hapticPlayed: false, soundPlayed: false, reason: 'unsupported' }
    }
  }

  #rememberOperation(operationId: string): void {
    this.#operationIds.add(operationId)
    if (this.#operationIds.size <= 64) return
    const oldest = this.#operationIds.values().next().value
    if (oldest) this.#operationIds.delete(oldest)
  }
}

function skipped(reason: NonNullable<FeedbackResult['reason']>): FeedbackResult {
  return { hapticPlayed: false, soundPlayed: false, reason }
}

export const feedback = new FeedbackController()
