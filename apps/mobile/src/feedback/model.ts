export const FEEDBACK_EVENTS = [
  'selection',
  'successful-move',
  'boundary',
  'completion',
  'error',
] as const

export type FeedbackEvent = (typeof FEEDBACK_EVENTS)[number]
export type FeedbackHapticsPreference = 'system' | 'off'
export type FeedbackSoundPreference = 'off' | 'quiet'
export type FeedbackSoundProfile = 'semantic' | 'shelf-transfer'

export type FeedbackPreferences = {
  readonly haptics: FeedbackHapticsPreference
  readonly sound: FeedbackSoundPreference
}

export type FeedbackEmitOptions = {
  readonly operationId?: string
  readonly soundProfile?: FeedbackSoundProfile
}

export type FeedbackRequest = {
  readonly event: FeedbackEvent
  readonly haptics: boolean
  readonly sound: boolean
  readonly soundProfile: FeedbackSoundProfile
}

export type FeedbackResult = {
  readonly hapticPlayed: boolean
  readonly soundPlayed: boolean
  readonly reason?: 'disabled' | 'throttled' | 'duplicate' | 'background' | 'unsupported'
}

export type FeedbackCapabilities = {
  readonly platform: 'ios' | 'android' | 'web'
  readonly haptics: boolean
  readonly sound: boolean
}

export type FeedbackRule = {
  readonly purpose: string
  readonly hapticIntent: string
  readonly sound: string
  readonly cooldownMs: number
  readonly informationSource: string
}

export const FEEDBACK_GRAMMAR: Readonly<Record<FeedbackEvent, FeedbackRule>> = {
  selection: {
    purpose: 'Confirm one discrete value or choice change without rewarding every ordinary tap.',
    hapticIntent: 'The lightest native selection tick available on the device.',
    sound: 'A brief graphite touch, omitted when input repeats faster than the cooldown.',
    cooldownMs: 90,
    informationSource: 'The selected control state, value, and accessible name carry the choice.',
  },
  'successful-move': {
    purpose: 'Confirm that a book committed to a new shelf or position.',
    hapticIntent: 'One soft settle at commit; never one haptic per animation phase.',
    sound: 'A paper slide, or an eraser-to-pencil sequence synchronized with a full shelf transfer.',
    cooldownMs: 280,
    informationSource: 'Shelf membership, row position, and the undoable status message carry the result.',
  },
  boundary: {
    purpose: 'Indicate that a direct manipulation has reached its valid limit.',
    hapticIntent: 'One dry edge impact on entering the boundary, not while remaining against it.',
    sound: 'A muted pencil-to-paper edge with no alarm-like pitch.',
    cooldownMs: 360,
    informationSource: 'The unchanged bounded value and its visible minimum or maximum carry the limit.',
  },
  completion: {
    purpose: 'Mark a meaningful finished state once, without turning it into spectacle.',
    hapticIntent: 'The platform success primitive.',
    sound: 'A quiet page turn and final paper settle.',
    cooldownMs: 700,
    informationSource: 'The Finished heading, check, book identity, and shelf membership carry completion.',
  },
  error: {
    purpose: 'Distinguish a failed user-requested operation from an ordinary boundary or warning.',
    hapticIntent: 'The platform error or reject primitive.',
    sound: 'Two low dry paper taps; no siren, buzz loop, or destructive eraser metaphor.',
    cooldownMs: 700,
    informationSource: 'Visible error text, alert semantics, and recovery actions explain the failure.',
  },
}

export const FEEDBACK_PLATFORM_MATRIX = [
  {
    platform: 'iPhone',
    haptics: 'UIKit selection, impact, success, and error generators when the system permits them.',
    sound: 'Bundled generated WAV through a quiet ambient audio session.',
  },
  {
    platform: 'iPad',
    haptics: 'No substitute when the device has no supported haptic hardware.',
    sound: 'Bundled generated WAV; visual and textual feedback remain authoritative.',
  },
  {
    platform: 'Android',
    haptics: 'View.performHapticFeedback semantic constants with API-level fallbacks.',
    sound: 'Bundled generated WAV through SoundPool sonification without requesting audio focus.',
  },
  {
    platform: 'Web',
    haptics: 'Intentionally unsupported; raw browser vibration is not a semantic substitute.',
    sound: 'Bundled generated WAV after a direct user action when Paper sounds is enabled.',
  },
] as const
