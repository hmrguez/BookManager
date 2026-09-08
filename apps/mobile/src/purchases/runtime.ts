import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { App } from '@capacitor/app'
import type { PurchaseStore } from './model'
import { PurchaseService } from './service'

interface NativePurchaseStore extends PurchaseStore {
  addListener(event: 'purchaseChanged', listener: () => void): Promise<PluginListenerHandle>
}

const nativeStore = registerPlugin<NativePurchaseStore>('WovenleafPurchases')
const platform = Capacitor.getPlatform()
const webStore: PurchaseStore = {
  getStatus: async () => ({ platform: 'web', owned: false, pending: false, available: false }),
  purchase: async () => { throw new Error('Use the iOS or Android app to purchase.') },
  restore: async () => { throw new Error('Use the iOS or Android app to restore.') },
  redeem: async () => { throw new Error('Use the iOS or Android app to redeem.') },
}

export const purchases = new PurchaseService(
  Capacitor.isNativePlatform() ? nativeStore : webStore,
  platform === 'ios' || platform === 'android' ? platform : 'web',
)

let started = false
export function startPurchases() {
  if (started) return
  started = true
  if (Capacitor.isNativePlatform()) {
    void nativeStore.addListener('purchaseChanged', () => { void purchases.refreshAfterChange() }).catch(() => {})
    void App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void purchases.refreshAfterChange()
    }).catch(() => {})
  }
  void purchases.refresh()
}
