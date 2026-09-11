import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'
import type { PurchaseStore } from './model'
import { PurchaseService } from './service'
import { reviewAccess } from './review-runtime'
import { nativePurchases } from './native'
const platform = Capacitor.getPlatform()
const webStore: PurchaseStore = {
  getStatus: async () => ({ platform: 'web', owned: false, pending: false, available: false }),
  purchase: async () => { throw new Error('Use the iOS or Android app to purchase.') },
  restore: async () => { throw new Error('Use the iOS or Android app to restore.') },
  redeem: async () => { throw new Error('Use the iOS or Android app to redeem.') },
}

export const purchases = new PurchaseService(
  Capacitor.isNativePlatform() ? nativePurchases : webStore,
  platform === 'ios' || platform === 'android' ? platform : 'web',
  reviewAccess,
)

let started = false
export function startPurchases() {
  if (started) return
  started = true
  if (Capacitor.isNativePlatform()) {
    void nativePurchases.addListener('purchaseChanged', () => { void purchases.refreshAfterChange() }).catch(() => {})
    void App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        void reviewAccess.refresh()
        void purchases.refreshAfterChange()
      }
    }).catch(() => {})
  }
  void reviewAccess.refresh()
  void purchases.refresh()
}
