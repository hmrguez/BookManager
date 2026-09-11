import { Capacitor } from '@capacitor/core'
import { ReviewAccessService, type ReviewAccessStore } from './review-access'
import { nativePurchases } from './native'

export const reviewAccessSupported = Capacitor.isNativePlatform()
const browserReviewAccess: ReviewAccessStore = {
  getReviewAccess: async () => ({ active: false }),
  activateReviewAccess: async () => { throw new Error('Review access requires the native app.') },
  endReviewAccess: async () => ({ active: false }),
}

export const reviewAccess = new ReviewAccessService(
  reviewAccessSupported ? nativePurchases : browserReviewAccess,
)
