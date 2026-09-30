import { useLanguage } from '../localization'
import { useEffect, useMemo, useState } from 'react'
import { App } from '@capacitor/app'
import type { LibraryBook } from '../library-model'
import type { UpNextState, UpNextSuggestionSet } from '../up-next-model'
import { RecommendationCache } from './cache'

const waitingForLibrary: UpNextSuggestionSet = { suggestions: [], eligibleCount: 0, certainty: 'none', guidance: '' }

export function useRecommendations(books: readonly LibraryBook[], state: UpNextState, ready: boolean) {
  const languageRevision = useLanguage()
  const [cache] = useState(() => {
    try { return new RecommendationCache(window.localStorage) } catch { return new RecommendationCache() }
  })
  const [clock, setClock] = useState(Date.now)
  // The clock invalidates the memo on expiry/resume; get reads the current time for library edits too.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const result = useMemo(() => ready ? cache.get(books, state, undefined, languageRevision) : waitingForLibrary, [books, state, cache, clock, ready, languageRevision])

  useEffect(() => {
    // Hydration must not replace a useful persisted cache with the initial empty library.
    if (!ready) return
    cache.persist()
    const timer = window.setTimeout(() => setClock(Date.now()), Math.max(1, cache.expiresAt - Date.now()))
    return () => window.clearTimeout(timer)
  }, [cache, ready, result])

  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') setClock(Date.now()) }
    document.addEventListener('visibilitychange', refresh)
    const listener = App.addListener('appStateChange', ({ isActive }) => { if (isActive) setClock(Date.now()) })
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      void listener.then((handle) => handle.remove())
    }
  }, [])

  return result
}
