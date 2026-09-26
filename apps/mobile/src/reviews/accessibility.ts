import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { useEffect, useState } from 'react'
interface ReviewAccessibility {
  getPreferences(): Promise<{ manual: boolean }>
  addListener(name: 'preferencesChanged', callback: (state: { manual: boolean }) => void): Promise<PluginListenerHandle>
}
const native = registerPlugin<ReviewAccessibility>('WovenleafReviewAccessibility')
/** Unknown native accessibility state is manual until positively identified. */
export function useReviewManualMode(reduced: boolean) {
  const [systemReduced, setSystemReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const change = () => setSystemReduced(query.matches)
    query.addEventListener('change', change)
    return () => query.removeEventListener('change', change)
  }, [])
  const [manual, setManual] = useState(Capacitor.isNativePlatform())
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let disposed = false
    let handle: PluginListenerHandle | undefined
    void (async () => {
      handle = await native.addListener('preferencesChanged', state => { if (!disposed) setManual(state.manual) })
      const state = await native.getPreferences()
      if (!disposed) setManual(state.manual)
      else await handle.remove()
    })().catch(() => { if (!disposed) setManual(true) })
    return () => { disposed = true; void handle?.remove() }
  }, [])
  return reduced || systemReduced || manual
}
