import { useEffect, useState } from 'react'
import { App } from '@capacitor/app'
import { getStorageRuntime } from '../storage/runtime'
import type { ReviewPeriod } from './keepsake-model'

export function useReviewInvitation(ready: boolean, refresh: unknown) {
  const [invitation, setInvitation] = useState<ReviewPeriod | null>(null)
  useEffect(() => {
    let active = true
    const refreshInvitation = () => {
      if (ready) void getStorageRuntime().then(runtime => runtime.reviewKeepsakes.invitation()).then(period => { if (active) setInvitation(period ? { year: period.year, quarter: period.quarter } : null) }).catch(() => {})
    }
    refreshInvitation()
    const listener = App.addListener('appStateChange', ({ isActive }) => { if (isActive) refreshInvitation() })
    const timer = window.setInterval(refreshInvitation, 60_000)
    return () => { active = false; clearInterval(timer); void listener.then(handle => handle.remove()) }
  }, [ready, refresh])
  return invitation
}

