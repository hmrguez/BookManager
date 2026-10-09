import { t, useLanguage } from '../../localization'
import { Notebook, ChartNoAxesColumn, Library, Plus, Settings } from 'lucide-react'
import { tw } from '../../tailwind/styles'
import type { AppView } from '../model'

export function BottomNavigation({
  view,
  onLibrary,
  onStats,
  onAdd,
  onSettings,
  onReviews,
  hasNewReview,
}: {
  view: AppView
  onLibrary: () => void
  onStats: () => void
  onAdd: () => void
  onSettings: () => void
  onReviews: () => void
  hasNewReview: boolean
}) {
  useLanguage()
  return (
    <nav className={tw('bottom-nav')} aria-label={t("App shortcuts")}>
      <button
        className={tw(view === 'library' ? 'is-active' : '')}
        type="button"
        onClick={onLibrary}
        aria-current={view === 'library' ? 'page' : undefined}
      >
        <Library aria-hidden="true" /><span>{t("My Books")}</span>
      </button>
      <button type="button" onClick={onStats} className={tw(view === 'stats' ? 'is-active' : '')} aria-current={view === 'stats' ? 'page' : undefined}>
        <ChartNoAxesColumn aria-hidden="true" /><span>{t("Stats")}</span>
      </button>
      <button className={tw('bottom-nav__add')} type="button" onClick={onAdd}>
        <Plus aria-hidden="true" /><span>{t("Add Book")}</span>
      </button>
      <button type="button" onClick={onReviews} aria-label={t("Reviews")} className={tw(view === 'reviews' ? 'is-active' : '')} aria-current={view === 'reviews' ? 'page' : undefined} aria-describedby={hasNewReview ? 'new-review-notice' : undefined}>
        <span className="review-nav-icon"><Notebook aria-hidden="true" />{hasNewReview && <span className="review-nav-dot" aria-hidden="true" />}</span><span>{t("Reviews")}</span>
        {hasNewReview && <span id="new-review-notice" className="review-sr-only">{t("New quarterly review available")}</span>}
      </button>
      <button
        className={tw(view === 'settings' ? 'is-active' : '')}
        type="button"
        onClick={onSettings}
        aria-current={view === 'settings' ? 'page' : undefined}
      >
        <Settings aria-hidden="true" /><span>{t("Settings")}</span>
      </button>
    </nav>
  )
}
