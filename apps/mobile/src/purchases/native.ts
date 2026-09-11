import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { PurchaseStore } from './model'
import type { ReviewAccessStore } from './review-access'

interface NativePurchaseStore extends PurchaseStore, ReviewAccessStore {
  addListener(event: 'purchaseChanged', listener: () => void): Promise<PluginListenerHandle>
}

// Both services share one Capacitor registration for this native plugin.
export const nativePurchases = registerPlugin<NativePurchaseStore>('WovenleafPurchases')
