import { useMemo, useState } from 'react'
import { Check, ChevronDown, RotateCcw } from 'lucide-react'
import type { LibraryBook } from '../library-model'
import {
  recommendationPreset, UP_NEXT_CRITERIA, UP_NEXT_CRITERION_COPY,
  type UpNextCriterion, type UpNextPreferences, type UpNextState,
} from '../up-next-model'
import { tw } from '../tailwind/styles'

const presets = [
  { id: 'balanced', title: 'Balanced', detail: 'A little of what you love. A little of what’s been waiting.' },
  { id: 'short', title: 'A shorter read', detail: 'Make room for a book you can finish sooner.' },
  { id: 'series', title: 'Continue a series', detail: 'Pick up a familiar world, in reading order.' },
] as const

export function RecommendationSettings({ state, books, tags, onSave, onRestoreSuggestion, onRestoreReason }: {
  state: UpNextState
  books: readonly LibraryBook[]
  tags: readonly string[]
  onSave: (mode: UpNextState['mode'], preferences: UpNextPreferences) => Promise<void>
  onRestoreSuggestion: (bookId: string) => void
  onRestoreReason: (criterion: UpNextCriterion) => void
}) {
  const [mode, setMode] = useState(state.mode)
  const [preferences, setPreferences] = useState(state.preferences)
  const [advanced, setAdvanced] = useState(false)
  const [saving, setSaving] = useState(false)
  const byId = useMemo(() => new Map(books.map((book) => [book.id, book])), [books])
  const change = (update: Partial<UpNextPreferences>) => setPreferences((current) => ({ ...current, ...update, preset: 'custom' }))

  return (
    <form className={tw('recommendation-settings')} onSubmit={async (event) => {
      event.preventDefault()
      setSaving(true)
      try { await onSave(mode, preferences) } finally { setSaving(false) }
    }}>
      <p className={tw('recommendation-intro')}>A few good places to start, picked from your TBR.</p>
      <label className={tw('recommendation-toggle')}>
        <span>Recommend books</span>
        <input type="checkbox" role="switch" checked={mode === 'assisted'} onChange={(event) => setMode(event.target.checked ? 'assisted' : 'manual')} />
      </label>
      {mode === 'assisted' && <>
        <div className={tw('recommendation-presets')} role="group" aria-label="Recommendation preset">
          {presets.map(({ id, title, detail }) => (
            <button key={id} type="button" aria-pressed={preferences.preset === id} onClick={() => setPreferences(recommendationPreset(id))}>
              <span><strong>{title}{id === 'balanced' && <small>Recommended</small>}</strong><span>{detail}</span></span>
              {preferences.preset === id && <Check aria-hidden="true" />}
            </button>
          ))}
        </div>
        <button className={tw('recommendation-disclosure')} type="button" aria-expanded={advanced} aria-controls="recommendation-tuning" onClick={() => setAdvanced(!advanced)}>
          <span>{preferences.preset === 'custom' ? 'Custom preferences' : 'Fine-tune the details'}</span><ChevronDown aria-hidden="true" />
        </button>
        {advanced && <section id="recommendation-tuning" className={tw('recommendation-tuning')} aria-label="Recommendation signals">
          <p>Every matching signal adds to the score. 0 is off; 3 is strongest.</p>
          <label className={tw('recommendation-field')}><span>Series order</span>
            <select value={preferences.seriesOrder} onChange={(event) => change({ seriesOrder: event.target.value as UpNextPreferences['seriesOrder'] })}>
              <option value="in-order">Read in order</option><option value="first">Starting volumes only</option><option value="any">Any installment</option>
            </select>
            <small>Known sequels wait for earlier books to be finished. Unknown order stays neutral.</small>
          </label>
          <label className={tw('recommendation-check')}><input type="checkbox" checked={preferences.useReadingTaste} onChange={(event) => change({ useReadingTaste: event.target.checked })} /><span>Use tags from books I finished and rated 4–5 stars</span></label>
          {UP_NEXT_CRITERIA.map((criterion) => <SignalEditor key={criterion} criterion={criterion} preferences={preferences} tags={tags} onChange={change} />)}
        </section>}
      </>}
      {(state.dismissedCriteria.length > 0 || state.dismissedSuggestions.length > 0) && (
        <details className={tw('recommendation-restores')}>
          <summary>Hidden books & signals</summary>
          {state.dismissedCriteria.map((criterion) => <button type="button" key={criterion} onClick={() => onRestoreReason(criterion)}><span>{UP_NEXT_CRITERION_COPY[criterion].label}</span><RotateCcw aria-label="Restore signal" /></button>)}
          {state.dismissedSuggestions.map(({ bookId }) => <button type="button" key={bookId} onClick={() => onRestoreSuggestion(bookId)}><span>{byId.get(bookId)?.title ?? 'Removed book'}</span><RotateCcw aria-label="Restore book" /></button>)}
        </details>
      )}
      <p className={tw('recommendation-footnote')}>Compared on this device. Your Up Next order stays yours.</p>
      <button className={tw('primary-action recommendation-save')} type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save preferences'}</button>
    </form>
  )
}

function SignalEditor({ criterion, preferences, tags, onChange }: {
  criterion: UpNextCriterion
  preferences: UpNextPreferences
  tags: readonly string[]
  onChange: (update: Partial<UpNextPreferences>) => void
}) {
  const { label, description } = UP_NEXT_CRITERION_COPY[criterion]
  const enabled = preferences.weights[criterion] > 0
  const required = preferences.requiredCriteria.includes(criterion)
  const listField = criterion === 'format' ? 'formats' : criterion === 'mood' ? 'moodTags' : criterion === 'series' ? 'series' : undefined
  return (
    <div className={tw('recommendation-signal')}>
      <div className={tw('recommendation-signal-heading')}>
        <span><strong>{label}</strong><small>{description}</small></span>
        <div role="group" aria-label={`${label} importance`}>
          {[0, 1, 2, 3].map((weight) => <button type="button" key={weight} aria-label={`${label}: ${['Off', 'Light', 'Medium', 'Strong'][weight]}`} aria-pressed={preferences.weights[criterion] === weight}
            onClick={() => onChange({ weights: { ...preferences.weights, [criterion]: weight }, requiredCriteria: weight === 0 ? preferences.requiredCriteria.filter((item) => item !== criterion) : preferences.requiredCriteria })}>{weight}</button>)}
        </div>
      </div>
      {enabled && <>
        {listField && <PreferenceListInput key={listField} values={preferences[listField]} label={`Preferred ${criterion === 'mood' ? 'tags' : listField}, separated by commas`}
          placeholder={criterion === 'mood' ? 'Choose tags, or use your reading history' : criterion === 'series' ? 'Any series, or enter a name' : 'eBook, Paperback'}
          onChange={(values) => onChange({ [listField]: values.slice(0, listField === 'formats' ? 12 : 20) })} />}
        {criterion === 'mood' && tags.length > 0 && <div className={tw('recommendation-tags')} role="group" aria-label="Your tags">
          {tags.map((tag) => {
            const selected = preferences.moodTags.includes(tag)
            return <button type="button" key={tag} aria-pressed={selected} onClick={() => onChange({ moodTags: selected ? preferences.moodTags.filter((item) => item !== tag) : [...preferences.moodTags, tag].slice(0, 20) })}>{tag}</button>
          })}
        </div>}
        {criterion === 'length' && <label className={tw('recommendation-field')}><span>Up to this many pages</span><input type="number" min="1" max="20000" inputMode="numeric" value={preferences.maximumPages ?? ''}
          onChange={(event) => onChange({ maximumPages: event.target.value ? Math.max(1, Math.min(20000, Math.floor(Number(event.target.value)))) : null })} /></label>}
        {criterion === 'recency' && <label className={tw('recommendation-field')}><span>Time waiting</span><select value={preferences.recencyDirection} onChange={(event) => onChange({ recencyDirection: event.target.value as UpNextPreferences['recencyDirection'] })}><option value="long-waiting">Books waiting longest</option><option value="recently-added">Recently added books</option></select></label>}
        {['format', 'length', 'mood', 'series'].includes(criterion) && <label className={tw('recommendation-check')}><input type="checkbox" checked={required} onChange={(event) => onChange({ requiredCriteria: event.target.checked ? [...preferences.requiredCriteria, criterion] : preferences.requiredCriteria.filter((item) => item !== criterion) })} /><span>Require this match</span></label>}
      </>}
    </div>
  )
}

function PreferenceListInput({ values, label, placeholder, onChange }: {
  values: string[]; label: string; placeholder: string; onChange: (values: string[]) => void
}) {
  const [draft, setDraft] = useState(values.join(', '))
  const [editing, setEditing] = useState(false)
  return <input className={tw('recommendation-input')} aria-label={label} placeholder={placeholder} value={editing ? draft : values.join(', ')}
    onFocus={() => { setDraft(values.join(', ')); setEditing(true) }} onBlur={() => setEditing(false)}
    onChange={(event) => {
      setDraft(event.target.value)
      onChange([...new Set(event.target.value.split(',').map((item) => item.trim()).filter(Boolean))])
    }} />
}
