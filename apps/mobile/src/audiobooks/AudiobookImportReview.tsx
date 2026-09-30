import { t, translateCopy, useLanguage } from '../localization'
import { useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Check,
  Clock3,
  Headphones,
  ListMusic,
  X,
} from 'lucide-react'
import { tw } from '../tailwind/styles'
import { defaultAudiobookReview } from './inspect'
import type { AudiobookImportDraft, AudiobookImportReview } from './model'

export function AudiobookImportReviewPanel({
  draft,
  busy,
  onImport,
  onDismiss,
}: {
  draft: AudiobookImportDraft
  busy: boolean
  onImport: (review: AudiobookImportReview) => void
  onDismiss: () => void
}) {
  useLanguage()
  const [review, setReview] = useState(() => defaultAudiobookReview(draft))
  const updateContributors = (field: 'authors' | 'narrators', value: string) => {
    setReview((current) => ({
      ...current,
      [field]: value.split(/[;,]/).map((part) => part.trim()).filter(Boolean),
    }))
  }
  const moveSegment = (id: string, direction: -1 | 1) => {
    setReview((current) => {
      const index = current.segmentIds.indexOf(id)
      const nextIndex = index + direction
      if (index < 0 || nextIndex < 0 || nextIndex >= current.segmentIds.length) return current
      const segmentIds = [...current.segmentIds]
      const [moved] = segmentIds.splice(index, 1)
      if (!moved) return current
      segmentIds.splice(nextIndex, 0, moved)
      return { ...current, segmentIds, orderConfirmed: !draft.requiresOrderReview }
    })
  }
  const segments = review.segmentIds.map((id) => draft.segments.find((segment) => segment.id === id))
    .filter((segment): segment is AudiobookImportDraft['segments'][number] => Boolean(segment))
  const canImport = review.title.trim().length > 0 && (!draft.requiresOrderReview || review.orderConfirmed)

  return (
    <section className={tw('audio-review')} aria-labelledby="audio-review-title">
      <header className={tw('audio-review__header')}>
        <div className={tw('audio-review__mark')}><Headphones aria-hidden="true" /></div>
        <div>
          <span>{t('oneBookFiles', { count: segments.length, value: segments.length })}</span>
          <h3 id="audio-review-title">{t("Check the listening order.")}</h3>
          <p>{t("Review the sequence and shared details before adding this audiobook.")}</p>
        </div>
        <button type="button" onClick={onDismiss} disabled={busy} aria-label={t("Dismiss audiobook review")}>
          <X aria-hidden="true" />
        </button>
      </header>

      {draft.issues.length > 0 && (
        <div className={tw('audio-review__issues')} role="status">
          {draft.issues.map((issue) => (
            <p key={`${issue.code}:${issue.segmentIds.join(':')}`} data-severity={issue.severity}>
              <span>{issue.severity === 'review' ? t("Review") : t("Note")}</span>{translateCopy(issue.message ?? '')}
            </p>
          ))}
        </div>
      )}

      <fieldset className={tw('audio-review__metadata')} disabled={busy}>
        <legend>{t("Shared book details")}</legend>
        <label>
          <span>{t("Title")}</span>
          <input
            value={review.title}
            required
            onChange={(event) => setReview((current) => ({ ...current, title: event.currentTarget.value }))}
          />
        </label>
        <label>
          <span>{t("Author")}</span>
          <input
            value={review.authors.join(', ')}
            placeholder={t("Add if the files do not say")}
            onChange={(event) => updateContributors('authors', event.currentTarget.value)}
          />
        </label>
        <label>
          <span>{t("Narrator")}</span>
          <input
            value={review.narrators.join(', ')}
            placeholder={t("Optional")}
            onChange={(event) => updateContributors('narrators', event.currentTarget.value)}
          />
        </label>
        <label>
          <span>{t("Series")}</span>
          <input
            value={review.series ?? ''}
            placeholder={t("Optional")}
            onChange={(event) => setReview((current) => ({ ...current, series: event.currentTarget.value || undefined }))}
          />
        </label>
      </fieldset>

      <div className={tw('audio-sequence__heading')}>
        <span><ListMusic aria-hidden="true" />{t("Playback sequence")}</span>
        <span><Clock3 aria-hidden="true" />{formatDuration(draft.totalDurationMs)}</span>
      </div>
      <ol className={tw('audio-sequence')} aria-label={t("Audiobook file order")} aria-live="polite">
        {segments.map((segment, index) => (
          <li key={segment.id}>
            <span className={tw('audio-sequence__number')}>{String(index + 1).padStart(2, '0')}</span>
            <span className={tw('audio-sequence__file')}>
              <strong>{segment.title ?? segment.fileName}</strong>
              <small>
                {segment.title ? segment.fileName : t("No embedded track title")} · {formatDuration(segment.durationMs)}
                {segment.trackNumber ? t(" · track {{v0}}{{v1}}", { v0: segment.trackNumber, v1: segment.trackTotal ? ` of ${segment.trackTotal}` : '' }) : ''}
              </small>
            </span>
            {segments.length > 1 && (
              <span className={tw('audio-sequence__moves')}>
                <button
                  type="button"
                  disabled={busy || index === 0}
                  onClick={() => moveSegment(segment.id, -1)}
                  aria-label={t("Move {{v0}} earlier", { v0: segment.fileName })}
                >
                  <ArrowUp aria-hidden="true" />
                </button>
                <button
                  type="button"
                  disabled={busy || index === segments.length - 1}
                  onClick={() => moveSegment(segment.id, 1)}
                  aria-label={t("Move {{v0}} later", { v0: segment.fileName })}
                >
                  <ArrowDown aria-hidden="true" />
                </button>
              </span>
            )}
          </li>
        ))}
      </ol>

      <footer className={tw('audio-review__footer')}>
        {draft.requiresOrderReview ? (
          <label className={tw('audio-order-confirmation')}>
            <input
              type="checkbox"
              checked={review.orderConfirmed}
              disabled={busy}
              onChange={(event) => setReview((current) => ({ ...current, orderConfirmed: event.currentTarget.checked }))}
            />
            <span><strong>{t("This order is correct")}</strong><small>{t("Required because the file evidence was ambiguous.")}</small></span>
          </label>
        ) : (
          <p className={tw('audio-order-proof')}><Check aria-hidden="true" />{t("Ordered from unique disc/track tags or numbered filenames.")}</p>
        )}
        <button
          className={tw('audio-import-commit')}
          type="button"
          disabled={busy || !canImport}
          onClick={() => onImport(review)}
        >
          {busy ? t("Building the book…") : t("Import as one audiobook")}
        </button>
      </footer>
    </section>
  )
}

function formatDuration(durationMs: number): string {
  const totalMinutes = Math.max(0, Math.round(durationMs / 60_000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0 ? `${hours}h ${String(minutes).padStart(2, '0')}m` : `${minutes}m`
}
