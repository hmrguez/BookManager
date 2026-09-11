import { useRef, useState } from 'react'
import { ChevronDown, ShieldCheck } from 'lucide-react'
import { tw } from '../tailwind/styles'
import { reviewAccess, reviewAccessSupported } from './review-runtime'
import type { ReviewAccessView } from './review-access'
import './purchases.css'

export function ReviewAccessSettings({ view }: { view: ReviewAccessView }) {
  const [token, setToken] = useState('')
  const summary = useRef<HTMLElement>(null)
  const busy = view.busy || view.loading

  return (
    <details className="review-access">
      <summary ref={summary} className={tw('settings-action')}>
        <ShieldCheck aria-hidden="true" />
        <span><strong>Review access</strong><small>{view.active ? 'Active on this device' : 'For app store reviewers'}</small></span>
        <ChevronDown aria-hidden="true" />
      </summary>
      <div className="review-access-content">
        {view.active ? <>
          <p role="status">Review access is active. You can add unlimited books on this device.</p>
          <p>End access to return to your store purchase status. Your books will stay readable and editable.</p>
          <button type="button" className="review-access-button" disabled={busy} onClick={async () => {
            await reviewAccess.end()
            if (!reviewAccess.getSnapshot().error) summary.current?.focus()
          }}>{busy ? 'Ending access…' : 'End review access'}</button>
        </> : reviewAccessSupported ? <form onSubmit={async (event) => {
          event.preventDefault()
          if (busy || !token.trim()) return
          await reviewAccess.activate(token)
          if (reviewAccess.getSnapshot().active) {
            setToken('')
            summary.current?.focus()
          }
        }}>
          <p>Paste the token supplied in the app review instructions to access Unlimited without a purchase.</p>
          <label htmlFor="review-access-token">Review token</label>
          <textarea id="review-access-token" value={token} onChange={(event) => setToken(event.target.value)}
            rows={3} maxLength={256} autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}
            disabled={busy} required aria-describedby={view.error ? 'review-access-error' : undefined} />
          <button type="submit" className="review-access-button" disabled={busy || !token.trim()}>
            {busy ? 'Checking access…' : 'Activate review access'}
          </button>
        </form> : <p>Review access is available in the iPhone and Android apps.</p>}
        {view.error && <p id="review-access-error" role="alert">{view.error}</p>}
      </div>
    </details>
  )
}
