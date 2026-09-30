import { t, getLocale, useLanguage } from '../localization'
import type { CSSProperties } from 'react'
import { Check, Clock3, Minus, Plus } from 'lucide-react'
import { ActionButton, BookCover, RatingStars } from '../design-system'
import type { LibraryBook } from '../library'
import { Sheet } from '../app/components/Sheet'
import { tw } from '../tailwind/styles'
import { motionStyles } from '../tailwind/motion'

function authorLine(authors: string[]) {
  return authors.join(', ')
}

function formatUpdated(value: string) {
  const date = new Date(value)
  const today = new Date()
  const isToday = date.toDateString() === today.toDateString()
  return t("{{v0}} at {{v1}}", { v0: isToday ? 'Today' : date.toLocaleDateString(getLocale(), { month: 'short', day: 'numeric' }), v1: date.toLocaleTimeString(getLocale(), { hour: 'numeric', minute: '2-digit' }) })
}

export function ProgressSheet({
  book,
  onClose,
  onProgress,
  onPage,
  onFinish,
}: {
  book: LibraryBook
  onClose: () => void
  onProgress: (progress: number) => void
  onPage: (page: number) => void
  onFinish: () => void
}) {
  useLanguage()
  return (
    <Sheet title={t("Update progress")} onClose={onClose}>
      <div className={tw('sheet-book-line')}>
        <BookCover book={book} />
        <div><strong>{book.title}</strong><small>{authorLine(book.authors)}</small></div>
      </div>

      <div className={tw('progress-editor')}>
        <button type="button" onClick={() => onProgress(book.progress - 5)} aria-label={t("Decrease by 5 percent")}>
          <Minus aria-hidden="true" />
        </button>
        <div className={tw('progress-editor__value')}>
          <output>{book.progress}<span>%</span></output>
          <i className={tw('progress-editor__meter')} aria-hidden="true">
            <b className={tw(motionStyles.progressFill)} style={{ width: t("{{v0}}%", { v0: book.progress }) }} />
          </i>
        </div>
        <button type="button" onClick={() => onProgress(book.progress + 5)} aria-label={t("Increase by 5 percent")}>
          <Plus aria-hidden="true" />
        </button>
      </div>

      <div className={tw('progress-presets')} aria-label={t("Progress presets")}>
        {[25, 50, 75].map((progress) => (
          <button type="button" key={progress} onClick={() => onProgress(progress)}>{progress}%</button>
        ))}
        <button type="button" onClick={onFinish}>{t("Finished")}</button>
      </div>

      {book.pageCount > 0 && (
        <div className={tw('page-progress')}>
          <label htmlFor="current-page">{t("Or set by page")}</label>
          <div className={tw('page-input-line')}>
            <input
              id="current-page"
              type="number"
              inputMode="numeric"
              min="0"
              max={book.pageCount}
              value={book.currentPage}
              onChange={(event) => onPage(Number(event.target.value))}
            />
            <span>/ {book.pageCount} {t(" pages")}</span>
          </div>
          <input
            className={tw('page-range')}
            type="range"
            min="0"
            max={book.pageCount}
            value={book.currentPage}
            aria-label={t("Current page")}
            onChange={(event) => onPage(Number(event.target.value))}
            style={{ '--range-progress': t("{{v0}}%", { v0: (book.currentPage / book.pageCount) * 100 }) } as CSSProperties}
          />
          <div className={tw('range-labels')}><span>0</span><span>{book.pageCount}</span></div>
        </div>
      )}

      <p className={tw('updated-time')}><Clock3 aria-hidden="true" /> {t(" Last updated")}{formatUpdated(book.lastUpdatedAt)}</p>
    </Sheet>
  )
}

export function FinishedSheet({
  book,
  onClose,
  onRate,
}: {
  book: LibraryBook
  onClose: () => void
  onRate: (rating: number) => void
}) {
  useLanguage()
  return (
    <Sheet title={t("Finished")} onClose={onClose}>
      <div className={tw('finish-celebration', motionStyles.complete)} data-motion-event="complete">
        <BookCover book={book} large />
        <div>
          <span className={tw('finish-mark')}><Check aria-hidden="true" /></span>
          <p>{t("Another story, kept.")}</p>
          <h3>{book.title}</h3>
          <small>{authorLine(book.authors)}</small>
        </div>
      </div>
      <div className={tw('finish-rating')}>
        <span>{t("Your rating")}</span>
        <RatingStars value={book.rating} onChange={onRate} />
        <small>{book.rating ? t("{{v0}} out of 5", { v0: book.rating }) : t("Optional — tap a star")}</small>
      </div>
      <ActionButton type="button" onClick={onClose}>{t("Done")}</ActionButton>
    </Sheet>
  )
}
