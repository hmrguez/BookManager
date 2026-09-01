import { registerPlugin } from '@capacitor/core'
import type { FeedbackCapabilities, FeedbackRequest, FeedbackResult } from './model'

export interface WovenleafFeedbackPlugin {
  getCapabilities(): Promise<FeedbackCapabilities>
  emit(options: FeedbackRequest): Promise<FeedbackResult>
}

export const nativeFeedback = registerPlugin<WovenleafFeedbackPlugin>('WovenleafFeedback', {
  web: () => import('./web').then(({ WovenleafFeedbackWeb }) => new WovenleafFeedbackWeb()),
})
