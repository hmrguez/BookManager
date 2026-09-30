import { t, useLanguage } from '../localization'
import { useLayoutEffect, useRef, useSyncExternalStore, type KeyboardEvent } from 'react'
import { BookOpen, Check, X } from 'lucide-react'
import type { PurchaseView } from './service'
import { purchases } from './runtime'
import { FREE_BOOK_LIMIT } from './model'
import { reviewAccess } from './review-runtime'
import './purchases.css'

export function UpgradeDialog({ open, onClose, view, bookCount }: {
  open: boolean
  onClose: () => void
  view: PurchaseView
  bookCount: number
}) {
  useLanguage()
  const dialog = useRef<HTMLDialogElement>(null)
  const reviewView = useSyncExternalStore(reviewAccess.subscribe, reviewAccess.getSnapshot)
  const hasAccess = view.owned || reviewView.active
  useLayoutEffect(() => {
    const element = dialog.current
    if (!open || !element) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    const siblings = [...(element.parentElement?.children ?? [])].filter((item) => item !== element)
      .map((item) => ({ item, hidden: item.getAttribute('aria-hidden') }))
    siblings.forEach(({ item }) => item.setAttribute('aria-hidden', 'true'))
    // iOS 15.0–15.3 has StoreKit 2 but predates HTMLDialogElement.showModal.
    const nativeDialog = typeof element.showModal === 'function'
    if (nativeDialog) element.showModal()
    else {
      element.classList.add('upgrade-dialog--fallback')
      element.setAttribute('open', '')
    }
    element.querySelector<HTMLElement>('button')?.focus({ preventScroll: true })
    return () => {
      if (nativeDialog) element.close()
      else element.removeAttribute('open')
      siblings.forEach(({ item, hidden }) => {
        if (hidden === null) item.removeAttribute('aria-hidden')
        else item.setAttribute('aria-hidden', hidden)
      })
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [open])
  const containFocus = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    if (event.key !== 'Tab') return
    const buttons = [...(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
    const first = buttons[0]
    const last = buttons.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }
  const store = view.platform === 'ios' ? t("Apple Account") : t("Google account")
  const unavailable = !view.loading && !view.available && !hasAccess

  return (
    <dialog ref={dialog} className="upgrade-dialog" aria-modal="true" aria-labelledby="upgrade-title"
      onKeyDown={containFocus} onCancel={(event) => { event.preventDefault(); onClose() }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="upgrade-content">
        <button type="button" className="upgrade-close" aria-label={t("Close upgrade")} onClick={onClose}><X aria-hidden="true" /></button>
        <BookOpen className="upgrade-mark" aria-hidden="true" />
        <p className="upgrade-eyebrow">{t("Wovenleaf · Unlimited")}</p>
        <h2 id="upgrade-title">{hasAccess ? t("Room for every book.") : t("Let your library grow.")}</h2>
        <p className="upgrade-intro">{view.owned
          ? t("Your library is unlimited. Keep collecting the books that matter to you.")
          : reviewView.active ? t("Review access is active on this device. You can add unlimited books.")
          : t("Your first {{v0}} books are free. Make room for every book after that with one simple purchase.", { v0: FREE_BOOK_LIMIT })}</p>
        <div className="upgrade-terms">
          <span><Check aria-hidden="true" /> {t(" Unlimited books, on every shelf")}</span>
          <span><Check aria-hidden="true" /> {t(" Pay once. No subscription.")}</span>
          <span><Check aria-hidden="true" /> {t(" Restore on devices using the same store account")}</span>
        </div>
        {!hasAccess && <p className="upgrade-count">{bookCount} {t(" of")}{FREE_BOOK_LIMIT} {t(" free books in your library")}</p>}
        {reviewView.active && !view.owned && <p className="upgrade-note">{t("To test checkout, end review access in Settings → Advanced.")}</p>}
        {(view.message || view.pending) && <p className="upgrade-message" role="status">{view.message || t("Your purchase is awaiting approval. We’ll unlock your library when it completes.")}</p>}
        {view.error && <p className="upgrade-message" role="alert">{view.error}</p>}
        {unavailable && <p className="upgrade-note">{view.platform === 'web'
          ? t("Purchase and restore are available in the iPhone and Android apps.")
          : t("The upgrade is currently unavailable from the store. Please try again shortly.")}</p>}
        {hasAccess ? (
          <button type="button" className="upgrade-primary" onClick={onClose}>{t("Continue to my library")}</button>
        ) : (
          <button type="button" className="upgrade-primary" disabled={view.busy || view.loading || !view.available || view.pending}
            onClick={() => { void purchases.purchase() }}>
            {view.busy ? t("Contacting the store…") : view.loading ? t("Checking the store…")
              : view.pending ? t("Awaiting approval") : view.price ? t("Unlock unlimited · {{v0}}", { v0: view.price }) : t("Unlock unlimited")}
          </button>
        )}
        {view.platform !== 'web' && <>
          <div className="upgrade-actions">
            <button type="button" disabled={view.busy || view.loading} onClick={() => { void purchases.restore() }}>{t("Restore purchase")}</button>
            {view.canRedeem !== false && <button type="button" disabled={view.busy} onClick={() => { void purchases.redeem() }}>{t("Redeem a code")}</button>}
            {unavailable && <button type="button" disabled={view.busy} onClick={() => { void purchases.refresh() }}>{t("Try again")}</button>}
          </div>
          <p className="upgrade-note">{t("Linked to your")}{store}{t(". Purchases stay within")}{view.platform === 'ios' ? t("the App Store") : t("Google Play")}.</p>
        </>}
        {!hasAccess && <button type="button" className="upgrade-later" onClick={onClose}>{t("Keep my free library")}</button>}
      </div>
    </dialog>
  )
}
