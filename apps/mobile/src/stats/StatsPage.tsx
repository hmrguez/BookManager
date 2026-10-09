import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { BookOpen, ChevronLeft, ChevronRight } from 'lucide-react'
import { BookCover } from '../design-system'
import type { LibraryBook } from '../library-model'
import { formatNumber, getLocale, t, useLanguage } from '../localization'
import { useReadingStats } from './useReadingStats'
import { STATS_PERIODS, statsRange, type ReadingStats, type StatsBucket, type StatsPeriod } from './model'
import './stats.css'

const selectionKey = 'wovenleaf.stats.period.v1'
function savedSelection(): { period: StatsPeriod; offset: number } {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(selectionKey) ?? 'null')
    if (saved && typeof saved === 'object' && 'period' in saved && 'offset' in saved
      && STATS_PERIODS.some(period => period === saved.period) && typeof saved.offset === 'number'
      && Number.isInteger(saved.offset) && saved.offset <= 0 && saved.offset >= -120_000) {
      const period = STATS_PERIODS.find(period => period === saved.period)!
      statsRange({ period, offset: saved.offset, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, knownAt: new Date().toISOString() })
      return { period, offset: saved.offset }
    }
  } catch { /* A private browsing session still has a usable default. */ }
  return { period: 'month', offset: 0 }
}
function duration(minutes: number | undefined) {
  if (minutes === undefined) return '—'
  const hours = Math.floor(minutes / 60), remainder = Math.floor(minutes % 60)
  return hours ? t('{{hours}}h {{minutes}}m', { hours: formatNumber(hours), minutes: formatNumber(remainder) }) : t('{{minutes}}m', { minutes: formatNumber(remainder) })
}
function periodTitle(data: ReadingStats, period: StatsPeriod) {
  if (period === 'all') return t('All time')
  const start = new Date(data.period.start)
  if (period === 'quarter') return t('Quarter {{quarter}} · {{year}}', { quarter: Math.floor(Number(new Intl.DateTimeFormat('en', { month: 'numeric', timeZone: data.period.timezone }).format(start)) / 3) + 1, year: new Intl.DateTimeFormat(getLocale(), { year: 'numeric', timeZone: data.period.timezone }).format(start) })
  return new Intl.DateTimeFormat(getLocale(), { month: period === 'month' ? 'long' : undefined, year: 'numeric', timeZone: data.period.timezone }).format(start)
}
function dateLabel(date: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) {
  return new Intl.DateTimeFormat(getLocale(), { ...options, timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z'))
}
function bucketLabel(bucket: StatsBucket, period: StatsPeriod) {
  if (period === 'year') return dateLabel(bucket.date, { month: 'long', year: 'numeric' })
  if (period === 'all') return bucket.date.slice(0, 4)
  return bucket.date === bucket.endDate ? dateLabel(bucket.date) : `${dateLabel(bucket.date)} – ${dateLabel(bucket.endDate)}`
}

export function StatsPage({ books, refresh, onBook }: { books: readonly LibraryBook[]; refresh: unknown; onBook: (id: string) => void }) {
  useLanguage()
  const [selection, setSelection] = useState(savedSelection)
  const [compare, setCompare] = useState(false)
  const { period, offset } = selection
  const { data, error, retry } = useReadingStats(period, offset, compare, refresh)
  useEffect(() => { try { localStorage.setItem(selectionKey, JSON.stringify(selection)) } catch { /* Optional preference. */ } }, [selection])
  let canGoBack = period !== 'all'
  try { statsRange({ period, offset: offset - 1, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, knownAt: new Date().toISOString() }) } catch { canGoBack = false }
  const labels = { month: t('Month'), quarter: t('Quarter'), year: t('Year'), all: t('All time') }
  return <main className="stats-page" aria-labelledby="stats-title">
    <header className="stats-heading"><div><p className="stats-eyebrow">{t('A reading life')}</p><h1 id="stats-title">{t('Stats')}</h1></div><BookOpen strokeWidth={1} aria-hidden="true" /></header>
    <div className="stats-periods" role="group" aria-label={t('Reading period')}>
      {STATS_PERIODS.map(value => <button type="button" key={value} aria-pressed={period === value} onClick={() => setSelection({ period: value, offset: 0 })}>{labels[value]}</button>)}
    </div>
    <div className="stats-period-heading">
      <h2>{data ? periodTitle(data, period) : labels[period]}</h2>
      {period !== 'all' && <div className="stats-period-arrows"><button type="button" aria-label={t('Previous period')} disabled={!canGoBack} onClick={() => setSelection({ period, offset: offset - 1 })}><ChevronLeft size={20} aria-hidden="true" /></button><button type="button" aria-label={t('Next period')} disabled={!offset} onClick={() => setSelection({ period, offset: offset + 1 })}><ChevronRight size={20} aria-hidden="true" /></button></div>}
    </div>
    {error && <div className="stats-notice" role="alert"><p>{t('Your stats could not be refreshed. Please try again.')}</p><button type="button" onClick={retry}>{t('Try again')}</button></div>}
    {!data && !error && <p className="stats-loading" role="status">{t('Gathering your reading story…')}</p>}
    {data && <StatsContent key={`${period}:${offset}`} data={data} period={period} books={books} onBook={onBook} />}
    {data && period !== 'all' && <label className="stats-compare"><input type="checkbox" checked={compare} onChange={event => setCompare(event.target.checked)} />{t('Compare with the previous period')}</label>}
    {data?.prior && <section className="stats-comparison" aria-labelledby="stats-compare-title"><h3 id="stats-compare-title">{t('The previous chapter')}</h3><p>{t('Equivalent elapsed period. Tracking may differ between periods.')}</p>
      <dl><div><dt>{t('Books finished')}</dt><dd>{formatNumber(data.prior.metrics['01']?.value ?? 0)}</dd></div><div><dt>{t('Tracked time')}</dt><dd>{duration(data.prior.activity.refs.length ? data.prior.activity.totalMinutes : undefined)}</dd></div><div><dt>{t('Active days')}</dt><dd>{data.prior.metrics['11']?.value === undefined ? '—' : formatNumber(data.prior.metrics['11'].value)}</dd></div></dl>
    </section>}
    {data && <footer className="stats-footer">{t('Updated {{time}} · Refreshes as reading is saved', { time: new Intl.DateTimeFormat(getLocale(), { hour: 'numeric', minute: '2-digit' }).format(new Date(data.knownAt)) })}</footer>}
  </main>
}

function StatsContent({ data, period, books, onBook }: { data: ReadingStats; period: StatsPeriod; books: readonly LibraryBook[]; onBook: (id: string) => void }) {
  const { facts } = data
  const completed = facts.metrics['01']?.value ?? 0
  const tracked = facts.activity.refs.length > 0
  const empty = !facts.supportingBooks.length
  const finished = facts.supportingBooks.filter(work => facts.metrics['01']?.workIds.includes(work.workId))
  const ongoing = facts.supportingBooks.filter(work => !facts.metrics['01']?.workIds.includes(work.workId) && facts.activity.workIds.includes(work.workId))
  const authors = [...new Set(finished.flatMap(work => work.authors.map(author => author.name)))]
  const languages = (facts.metrics['19']?.detail ?? '').split(', ').filter(Boolean)
  const languageNames = new Intl.DisplayNames([getLocale()], { type: 'language' })
  const passages = facts.metrics['22']?.value ?? 0
  const notes = (facts.metrics['25']?.value ?? 0) + (facts.metrics['26']?.value ?? 0) + (facts.metrics['27']?.value ?? 0)
  const bookmarks = (facts.metrics['20']?.value ?? 0) + (facts.metrics['21']?.value ?? 0)
  const hasMarginalia = authors.length + languages.length + passages + notes + bookmarks > 0
  const summary = completed ? t('A little more of the world, between the covers.') : tracked ? t('Time well spent, one page at a time.') : t('Your next chapter starts here.')
  const bookSection = (works: typeof finished, title: string) => works.length > 0 && <section className="stats-books"><h3>{title}</h3><div className="stats-book-grid">{works.map(work => {
    const book = books.find(book => work.books.some(link => link.id === book.id))
    return book ? <button type="button" key={work.workId} onClick={() => onBook(book.id)}><BookCover book={book} /><span><strong>{book.title}</strong><small>{book.authors.join(', ')}</small></span></button> : <div key={work.workId}><strong>{work.title}</strong></div>
  })}</div></section>
  return <>
    <section className="stats-opening" aria-label={t('Reading summary')}><p className="stats-intro">{summary}</p>
      <dl className="stats-totals" data-lead={completed ? 'books' : 'time'}><div><dt>{t('Books finished')}</dt><dd>{formatNumber(completed)}</dd></div><div><dt>{t('Tracked time')}</dt><dd>{duration(tracked ? facts.activity.totalMinutes : undefined)}</dd></div><div><dt>{t('Active days')}</dt><dd>{tracked ? formatNumber(facts.activity.activeDays) : '—'}</dd></div></dl>
      <p className="stats-caption">{t('Tracked time includes recorded reading and listening. An active day has at least five minutes. Unrecorded activity is unknown.')}</p>
    </section>
    {empty && <section className="stats-empty"><BookOpen size={36} strokeWidth={1} aria-hidden="true" /><h3>{t('A chapter waiting to be written')}</h3><p>{t('Read, listen, or mark a book finished. Your reading story will gather here.')}</p></section>}
    {!empty && <div className="stats-spread" data-marginalia={hasMarginalia}><div className="stats-main-column">
      <section className="stats-rhythm" aria-labelledby="stats-rhythm-title"><div className="stats-section-heading"><h3 id="stats-rhythm-title">{t('Your reading rhythm')}</h3><span>{period === 'month' ? t('Day by day') : period === 'quarter' ? t('Week by week') : period === 'year' ? t('Month by month') : t('Year by year')}</span></div>
        {tracked ? <RhythmChart buckets={data.buckets} period={period} /> : <p className="stats-no-time">{t('Your finished books are here. A reading rhythm will appear when reading or listening time is recorded.')}</p>}
      </section>
      {bookSection(finished, t('Between the covers'))}
      {bookSection(ongoing, t('Keeping you company'))}
    </div><aside className="stats-marginalia" aria-label={t('Reading discoveries')} hidden={!hasMarginalia}>
      {(authors.length > 0 || languages.length > 0) && <section><p className="stats-eyebrow">{t('A wider world')}</p><h3>{t('Voices & places')}</h3>{authors.length > 0 && <><h4>{t('Authors')}</h4><ul>{authors.map(author => <li key={author}>{author}</li>)}</ul></>}{languages.length > 0 && <><h4>{t('Languages explored')}</h4><ul>{languages.map(language => <li key={language}>{languageNames.of(language) ?? language}</li>)}</ul><p className="stats-caption">{t('At least ten tracked minutes in each language.')}</p></>}</section>}
      {passages + notes + bookmarks > 0 && <section className="stats-reflections"><p className="stats-eyebrow">{t('In the margins')}</p><h3>{t('Words you kept')}</h3><dl>{[[t('Passages'), passages], [t('Notes'), notes], [t('Bookmarks'), bookmarks]].map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{formatNumber(Number(count))}</dd></div>)}</dl><p className="stats-caption">{t('Surviving passages, notes, and bookmarks created in this period.')}</p></section>}
    </aside></div>}
  </>
}

function RhythmChart({ buckets, period }: { buckets: StatsBucket[]; period: StatsPeriod }) {
  const [selected, setSelected] = useState(() => Math.max(0, buckets.findLastIndex(bucket => bucket.totalMs > 0)))
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const index = Math.min(selected, buckets.length - 1)
  const bucket = buckets[index]
  if (!bucket) return null
  const maximum = Math.max(60_000, ...buckets.map(bucket => bucket.totalMs))
  const hasUnclassified = buckets.some(bucket => bucket.unclassifiedMs > 0)
  const focus = (value: number) => { const next = Math.max(0, Math.min(buckets.length - 1, value)); setSelected(next); buttons.current[next]?.focus() }
  return <div className="stats-chart">
    <div className="stats-chart-legend"><span><i className="stats-ink-text" />{t('Reading')}</span><span><i className="stats-ink-audio" />{t('Listening')}</span>{hasUnclassified && <span><i className="stats-ink-other" />{t('Unclassified')}</span>}</div>
    <p className="stats-caption">{t('Tallest bar: {{duration}}', { duration: duration(maximum / 60_000) })}</p>
    <div className="stats-chart-bars" role="group" aria-label={t('Recorded activity. Use arrow keys to explore.')} style={{ '--bucket-count': buckets.length } as CSSProperties}>
      {buckets.map((point, i) => <button type="button" ref={element => { buttons.current[i] = element }} key={point.date} tabIndex={i === index ? 0 : -1} aria-pressed={i === index} aria-label={t('{{date}}: {{duration}} tracked', { date: bucketLabel(point, period), duration: duration(point.totalMs / 60_000) })} onClick={() => setSelected(i)} onKeyDown={event => {
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); focus(event.key === 'Home' ? 0 : event.key === 'End' ? buckets.length - 1 : index + (event.key === 'ArrowLeft' ? -1 : 1)) }
      }}><span className="stats-bar-stack" aria-hidden="true" style={{ height: `${point.totalMs / maximum * 100}%` }}>
        {(['textMs', 'audioMs', 'unclassifiedMs'] as const).map((field, layer) => point[field] > 0 && <i key={field} className={['stats-ink-text', 'stats-ink-audio', 'stats-ink-other'][layer]} style={{ flex: point[field] }} />)}
      </span><span className="stats-bar-dot" aria-hidden="true" /></button>)}
    </div>
    <div className="stats-chart-axis" aria-hidden="true"><span>{bucketLabel(buckets[0]!, period)}</span><span>{bucketLabel(buckets.at(-1)!, period)}</span></div>
    <div className="stats-chart-detail"><label><span className="stats-sr-only">{t('Explore recorded activity')}</span><select value={index} onChange={event => setSelected(Number(event.target.value))}>{buckets.map((point, i) => <option value={i} key={point.date}>{bucketLabel(point, period)}</option>)}</select></label>
      <p aria-live="polite">{t('Reading {{reading}} · Listening {{listening}}', { reading: duration(bucket.textMs / 60_000), listening: duration(bucket.audioMs / 60_000) })}{bucket.unclassifiedMs > 0 && <> · {t('Unclassified {{duration}}', { duration: duration(bucket.unclassifiedMs / 60_000) })}</>}</p>
    </div>
    <p className="stats-caption">{t('Blank days have no recorded time; they may include untracked reading.')}</p>
  </div>
}
