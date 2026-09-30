import { t, useLanguage } from '../localization'
import { useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react'
import { AlertTriangle, LoaderCircle, Star } from 'lucide-react'
import type { LibraryBook } from '../library'
import { tw } from '../tailwind/styles'
import { motionStyles } from '../tailwind/motion'

type CoverData = Pick<LibraryBook, 'id' | 'title' | 'authors' | 'thumbnail'>

export function ActionButton({
  variant = 'primary',
  isLoading = false,
  children,
  className = '',
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary'
  isLoading?: boolean
}) {
  const classes = `pulp-button ${variant}-button${className ? ` ${className}` : ''}`

  return (
    <button
      {...props}
      className={tw(classes)}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
    >
      {isLoading && <LoaderCircle className={tw("pulp-button__spinner")} aria-hidden="true" />}
      {children}
    </button>
  )
}

export function BookCover({ book, large = false }: { book: CoverData; large?: boolean }) {
  useLanguage()
  const [failedThumbnail, setFailedThumbnail] = useState<string>()
  const colorIndex = [...book.title].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 6
  const initials = book.title
    .replace(/^(the|a|an)\s+/i, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')

  return (
    <div
      className={tw(`book-cover tone-${colorIndex}${large ? ' book-cover--large' : ''}`)}
      style={{ '--cover-index': colorIndex } as CSSProperties}
      aria-hidden="true"
    >
      {book.thumbnail && failedThumbnail !== book.thumbnail ? (
        <img referrerPolicy="no-referrer" src={book.thumbnail} alt="" loading="lazy" decoding="async" onError={() => setFailedThumbnail(book.thumbnail)} />
      ) : (
        <>
          <span className={tw("cover-rule")} />
          <strong>{initials || 'BK'}</strong>
          <small>{book.authors[0]?.split(' ').at(-1) ?? t("Book")}</small>
        </>
      )}
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className={tw("pulp-empty-state")}>
      <span className={tw("pulp-empty-state__mark")} aria-hidden="true">{icon}</span>
      <div className={tw("grid gap-[3px]")}>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      {action && <div className={tw("pulp-empty-state__action")}>{action}</div>}
    </div>
  )
}

export function FeedbackNotice({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'loading' | 'error'
  title: string
  children: ReactNode
}) {
  return (
    <div
      className={tw(`pulp-feedback-notice pulp-feedback-notice--${tone}`)}
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live="polite"
    >
      {tone === 'loading' ? (
        <LoaderCircle className={tw("pulp-feedback-notice__spinner")} aria-hidden="true" />
      ) : tone === 'error' ? (
        <AlertTriangle aria-hidden="true" />
      ) : (
        <span className={tw("pulp-feedback-notice__rule")} aria-hidden="true" />
      )}
      <div>
        <strong>{title}</strong>
        <p>{children}</p>
      </div>
    </div>
  )
}

export function ProgressMeter({
  value,
  label = t("Reading progress"),
}: {
  value: number
  label?: string
}) {
  useLanguage()
  const boundedValue = Math.min(100, Math.max(0, value))

  return (
    <span
      className={tw("pulp-progress-meter")}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={boundedValue}
    >
      <span className={tw(motionStyles.progressFill)} style={{ width: `${boundedValue}%` }} />
    </span>
  )
}

export function RatingStars({
  value,
  onChange,
  compact = false,
  disabled = false,
}: {
  value: number
  onChange?: (rating: number) => void
  compact?: boolean
  disabled?: boolean
}) {
  useLanguage()
  return (
    <div className={tw(`stars${compact ? ' stars--compact' : ''}`)} aria-label={t("{{v0}} out of 5 stars", { v0: value })}>
      {[1, 2, 3, 4, 5].map((rating) =>
        onChange ? (
          <button
            type="button"
            key={rating}
            className={tw(rating <= value ? 'is-filled' : '')}
            aria-label={t("Rate {{v0}} out of 5", { v0: rating })}
            onClick={() => onChange(rating)}
            disabled={disabled}
          >
            <Star aria-hidden="true" />
          </button>
        ) : (
          <Star key={rating} className={tw(rating <= value ? 'is-filled' : '')} aria-hidden="true" />
        ),
      )}
    </div>
  )
}

export function StatusBadge({
  icon,
  children,
  tone = 'neutral',
}: {
  icon?: ReactNode
  children: ReactNode
  tone?: 'neutral' | 'accent' | 'destructive'
}) {
  return (
    <span className={tw(`status-pill status-pill--${tone}`)}>
      {icon}
      {children}
    </span>
  )
}
