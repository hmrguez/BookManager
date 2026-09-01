import { WebPlugin } from '@capacitor/core'
import type { WovenleafFeedbackPlugin } from './bridge'
import type {
  FeedbackCapabilities,
  FeedbackEvent,
  FeedbackRequest,
  FeedbackResult,
} from './model'

const SOUND_FILES: Readonly<Record<FeedbackEvent, string>> = {
  selection: 'graphite-tick.wav',
  'successful-move': 'paper-slide.wav',
  boundary: 'paper-edge.wav',
  completion: 'page-settle.wav',
  error: 'soft-error.wav',
}

export class WovenleafFeedbackWeb extends WebPlugin implements WovenleafFeedbackPlugin {
  #activeAudio?: HTMLAudioElement

  async getCapabilities(): Promise<FeedbackCapabilities> {
    return { platform: 'web', haptics: false, sound: true }
  }

  async emit(options: FeedbackRequest): Promise<FeedbackResult> {
    if (!options.sound) {
      return {
        hapticPlayed: false,
        soundPlayed: false,
        reason: options.haptics ? 'unsupported' : 'disabled',
      }
    }

    this.#activeAudio?.pause()
    const filename = options.soundProfile === 'shelf-transfer'
      ? 'shelf-transfer.wav'
      : SOUND_FILES[options.event]
    const audio = new Audio(new URL(`feedback/${filename}`, document.baseURI).href)
    audio.preload = 'auto'
    this.#activeAudio = audio
    try {
      await audio.play()
      return { hapticPlayed: false, soundPlayed: true }
    } catch {
      if (this.#activeAudio === audio) this.#activeAudio = undefined
      return { hapticPlayed: false, soundPlayed: false, reason: 'unsupported' }
    }
  }
}
