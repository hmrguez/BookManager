import { useEffect, useState } from 'react'
import { App } from '@capacitor/app'
import { getStorageRuntime } from '../storage/runtime'
import { subscribeStorageChanges } from '../storage/changes'
import type { ReadingStats, StatsPeriod } from './model'

export function useReadingStats(period: StatsPeriod, offset: number, compare: boolean, refresh: unknown) {
  const key = `${period}:${offset}:${compare}`
  const [result, setResult] = useState<{ key: string; data: ReadingStats }>()
  const [failedKey, setFailedKey] = useState<string>()
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true, running = false, pending = false
    let debounce: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      if (!active || document.visibilityState === 'hidden') return
      if (running) { pending = true; return }
      running = true
      try {
        const runtime = await getStorageRuntime()
        const stats = await runtime.readingStats.stats({ period, offset, compare,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, knownAt: new Date().toISOString() })
        if (active) { setResult({ key, data: stats }); setFailedKey(undefined) }
      } catch { if (active) setFailedKey(key) }
      finally {
        running = false
        if (pending && active) { pending = false; void load() }
      }
    }
    const schedule = () => { clearTimeout(debounce); debounce = setTimeout(() => { void load() }, 150) }
    void load()
    const unsubscribe = subscribeStorageChanges(schedule)
    const foreground = () => { if (document.visibilityState === 'visible') schedule() }
    document.addEventListener('visibilitychange', foreground)
    window.addEventListener('focus', schedule)
    const native = App.addListener('appStateChange', ({ isActive }) => { if (isActive) schedule() })
    // Advance calendar boundaries even when the reader leaves the dashboard open.
    const timer = setInterval(schedule, 60_000)
    return () => {
      active = false; clearTimeout(debounce); clearInterval(timer); unsubscribe()
      document.removeEventListener('visibilitychange', foreground)
      window.removeEventListener('focus', schedule)
      void native.then(handle => handle.remove()).catch(() => {})
    }
  }, [period, offset, compare, refresh, retry, key])
  return { data: result?.key === key ? result.data : undefined, error: failedKey === key, retry: () => setRetry(value => value + 1) }
}
