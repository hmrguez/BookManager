import { t, translateCopy, useLanguage } from '../localization'
import { Pin, SlidersHorizontal } from 'lucide-react'
import { BookCover } from '../design-system'
import { UP_NEXT_CRITERION_COPY, type UpNextCriterion, type UpNextSuggestion } from '../up-next-model'
import { tw } from '../tailwind/styles'

export function RecommendationDetails({ suggestion, onQueue, onDismiss, onManage, onReasonState }: {
  suggestion: UpNextSuggestion
  onQueue: () => void
  onDismiss: () => void
  onManage: () => void
  onReasonState: (criterion: UpNextCriterion, state: 'neutral' | 'pinned' | 'dismissed') => void
}) {
  useLanguage()
  return <div className={tw('recommendation-details')}>
    <header><BookCover book={suggestion.book} /><div><h3>{suggestion.book.title}</h3><p>{suggestion.book.authors.join(', ')}</p></div><div className={tw('recommendation-score')}><strong>{suggestion.score}</strong><span>{t("points")}</span></div></header>
    <p className={tw('recommendation-intro')}>{t("A match for your preferences. The score adds up these local signals.")}</p>
    <ul className={tw('recommendation-reasons')}>
      {suggestion.reasons.map((reason) => <li key={reason.criterion}>
        <div><strong>{reason.label}</strong><p>{translateCopy(reason.detail ?? '')}</p></div><span>+{reason.contribution}</span>
        <button type="button" aria-label={t("{{v0}} {{v1}} explanation", { v0: reason.pinned ? 'Unpin' : 'Pin', v1: UP_NEXT_CRITERION_COPY[reason.criterion].label })} aria-pressed={reason.pinned} onClick={() => onReasonState(reason.criterion, reason.pinned ? 'neutral' : 'pinned')}><Pin aria-hidden="true" /></button>
      </li>)}
    </ul>
    <button className={tw('primary-action recommendation-save')} type="button" onClick={onQueue}>{t("Add to Up Next")}</button>
    <div className={tw('recommendation-detail-actions')}><button type="button" onClick={onDismiss}>{t("Hide this suggestion")}</button><button type="button" onClick={onManage}><SlidersHorizontal aria-hidden="true" /> {t(" Preferences")}</button></div>
    <p className={tw('recommendation-footnote')}>{t("A comparison score, not a prediction or a percentage. Hidden books can be restored in preferences.")}</p>
  </div>
}
