import { useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  Pin,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react'
import { BookCover } from './design-system'
import type { LibraryBook } from './library-model'
import {
  UP_NEXT_CRITERIA,
  UP_NEXT_CRITERION_COPY,
  type UpNextCriterion,
  type UpNextPreferences,
  type UpNextState,
  type UpNextSuggestionSet,
} from './up-next-model'
import { tw } from './tailwind/styles'
import { FEATURES } from './app/feature-flags'

type ReasonState = 'neutral' | 'pinned' | 'dismissed'

export function UpNextSection({
  books,
  state,
  suggestions,
  isFiltering,
  onAdd,
  onDetails,
  onStart,
  onMove,
  onManage,
  onAddSuggestion,
  onDismissSuggestion,
  onReasonState,
}: {
  books: readonly LibraryBook[]
  state: UpNextState
  suggestions: UpNextSuggestionSet
  isFiltering: boolean
  onAdd: () => void
  onDetails: (bookId: string) => void
  onStart: (bookId: string) => void
  onMove: (bookId: string, targetIndex: number) => void
  onManage: () => void
  onAddSuggestion: (bookId: string) => void
  onDismissSuggestion: (bookId: string) => void
  onReasonState: (criterion: UpNextCriterion, state: ReasonState) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const isCollapsed = collapsed && !isFiltering

  return (
    <section className={tw("shelf shelf--next up-next")} id="shelf-next" data-shelf="next">
      <header className={tw("shelf-header up-next__header")}>
        <button
          type="button"
          className={tw("shelf-toggle")}
          onClick={() => setCollapsed((value) => !value)}
          aria-expanded={!isCollapsed}
          aria-controls="shelf-books-next"
        >
          <h2>Up Next <i>·</i> {books.length}</h2>
          <ChevronDown className={tw(isCollapsed ? 'is-collapsed' : '')} aria-hidden="true" />
        </button>
        {FEATURES.assistedUpNext && (
          <>
            <span className={tw(`up-next__mode up-next__mode--${state.mode}`)}>
              {state.mode === 'manual' ? 'Manual' : 'Guided'}
            </span>
            <button
              className={tw("shelf-add up-next__manage")}
              type="button"
              onClick={onManage}
              aria-label="Choose how Up Next suggestions work"
            >
              <SlidersHorizontal aria-hidden="true" />
            </button>
          </>
        )}
        <button
          type="button"
          className={tw("shelf-add")}
          onClick={onAdd}
          aria-label="Add a book to Up Next"
        >
          <Plus aria-hidden="true" />
        </button>
      </header>

      <div className={tw("shelf-books")} id="shelf-books-next" hidden={isCollapsed}>
        {FEATURES.assistedUpNext && (
          <div className={tw("up-next__principle")}>
            <span>{state.mode === 'manual' ? 'Your order, exactly' : 'Your order stays in charge'}</span>
            <small>
              {state.mode === 'manual'
                ? 'No ranking or algorithm is active.'
                : 'Suggestions use only the signals you selected.'}
            </small>
          </div>
        )}

        {books.length === 0 ? (
          <button className={tw("empty-shelf")} type="button" onClick={onAdd}>
            <Plus aria-hidden="true" />
            <span>
              <strong>Choose what comes next</strong>
              <small>Add a title, then arrange it your way</small>
            </span>
          </button>
        ) : (
          <div className={tw("up-next__queue")}>
            {books.map((book, index) => {
              return (
                <article
                  className={tw('up-next-book')}
                  key={book.id}
                  data-motion-event="reorder"
                >
                  <span className={tw("up-next-book__number")} aria-label={`Position ${index + 1}`}>
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <button className={tw("book-identity")} type="button" onClick={() => onDetails(book.id)}>
                    <BookCover book={book} />
                    <span className={tw("book-copy")}>
                      <strong>{book.title}</strong>
                      <small>{book.authors.join(', ')}</small>
                      <em className={tw("up-next-book__note")}>
                        {book.format ?? 'Format not recorded'}
                      </em>
                    </span>
                  </button>
                  <div className={tw("up-next-book__actions")}>
                    <button
                      type="button"
                      onClick={() => onMove(book.id, index - 1)}
                      disabled={index === 0}
                      aria-label={`Move ${book.title} earlier`}
                    >
                      <ArrowUp aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onMove(book.id, index + 1)}
                      disabled={index === books.length - 1}
                      aria-label={`Move ${book.title} later`}
                    >
                      <ArrowDown aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className={tw("up-next-book__start")}
                      onClick={() => onStart(book.id)}
                      aria-label={`Start reading ${book.title}`}
                    >
                      Start <ArrowRight aria-hidden="true" />
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        )}

        {FEATURES.assistedUpNext && state.mode === 'assisted' && !isFiltering && (
          <aside className={tw(`choice-notes choice-notes--${suggestions.certainty}`)}>
            <header>
              <span><Sparkles aria-hidden="true" /> Choice notes</span>
              <button type="button" onClick={onManage}>Adjust signals</button>
            </header>
            <p>{suggestions.guidance}</p>
            {suggestions.suggestions.length > 0 && (
              <div className={tw("choice-notes__list")}>
                {suggestions.suggestions.map((suggestion, index) => (
                  <article className={tw("suggestion")} key={suggestion.book.id}>
                    <span className={tw("suggestion__rank")}>{String(index + 1).padStart(2, '0')}</span>
                    <button
                      className={tw("suggestion__book")}
                      type="button"
                      onClick={() => onDetails(suggestion.book.id)}
                    >
                      <strong>{suggestion.book.title}</strong>
                      <small>{suggestion.book.authors.join(', ')}</small>
                    </button>
                    <div className={tw("suggestion__actions")}>
                      <button type="button" onClick={() => onAddSuggestion(suggestion.book.id)}>
                        <Plus aria-hidden="true" /> Queue
                      </button>
                      <button
                        type="button"
                        onClick={() => onDismissSuggestion(suggestion.book.id)}
                        aria-label={`Dismiss ${suggestion.book.title} from suggestions`}
                      >
                        <X aria-hidden="true" />
                      </button>
                    </div>
                    <div className={tw("suggestion__reasons")}>
                      {suggestion.reasons.length ? suggestion.reasons.map((reason) => (
                        <div className={tw(`reason${reason.pinned ? ' is-pinned' : ''}`)} key={reason.criterion}>
                          <span>
                            {reason.pinned && <Pin aria-label="Pinned reason" />}
                            <strong>{reason.label}</strong>
                            <small>{reason.detail}</small>
                          </span>
                          <div>
                            <button
                              type="button"
                              className={tw(reason.pinned ? 'is-active' : '')}
                              onClick={() => onReasonState(reason.criterion, reason.pinned ? 'neutral' : 'pinned')}
                              aria-label={`${reason.pinned ? 'Unpin' : 'Pin'} ${UP_NEXT_CRITERION_COPY[reason.criterion].label} reason`}
                              aria-pressed={reason.pinned}
                            >
                              <Pin aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onReasonState(reason.criterion, 'dismissed')}
                              aria-label={`Dismiss ${UP_NEXT_CRITERION_COPY[reason.criterion].label} reason`}
                            >
                              <X aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                      )) : (
                        <div className={tw("reason reason--empty")}>
                          <span>
                            <strong>No strong preference match</strong>
                            <small>Shown alphabetically; no score is being implied</small>
                          </span>
                        </div>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </aside>
        )}
      </div>
    </section>
  )
}

export function UpNextSettings({
  state,
  books,
  onSave,
  onRestoreSuggestion,
  onRestoreReason,
}: {
  state: UpNextState
  books: readonly LibraryBook[]
  onSave: (mode: UpNextState['mode'], preferences: UpNextPreferences) => void
  onRestoreSuggestion: (bookId: string) => void
  onRestoreReason: (criterion: UpNextCriterion) => void
}) {
  const [mode, setMode] = useState(state.mode)
  const [preferences, setPreferences] = useState(state.preferences)
  const byId = useMemo(() => new Map(books.map((book) => [book.id, book])), [books])

  const setWeight = (criterion: UpNextCriterion, weight: number) => {
    setPreferences((current) => ({
      ...current,
      weights: { ...current.weights, [criterion]: weight },
      requiredCriteria: weight === 0
        ? current.requiredCriteria.filter((item) => item !== criterion)
        : current.requiredCriteria,
    }))
  }
  const setList = (field: 'formats' | 'moodTags' | 'series', value: string) => {
    const limit = field === 'formats' ? 12 : 20
    setPreferences((current) => ({ ...current, [field]: commaList(value).slice(0, limit) }))
  }
  const setRequired = (criterion: UpNextCriterion, required: boolean) => {
    setPreferences((current) => ({
      ...current,
      requiredCriteria: required
        ? [...current.requiredCriteria.filter((item) => item !== criterion), criterion]
        : current.requiredCriteria.filter((item) => item !== criterion),
    }))
  }

  return (
    <form
      className={tw("up-next-settings")}
      onSubmit={(event) => {
        event.preventDefault()
        onSave(mode, preferences)
      }}
    >
      <fieldset className={tw("choice-mode")}>
        <legend>Who decides the order?</legend>
        <div>
          <button
            type="button"
            className={tw(mode === 'manual' ? 'is-active' : '')}
            onClick={() => setMode('manual')}
            aria-pressed={mode === 'manual'}
          >
            <strong>Just me</strong>
            <small>Pure manual queue</small>
          </button>
          <button
            type="button"
            className={tw(mode === 'assisted' ? 'is-active' : '')}
            onClick={() => setMode('assisted')}
            aria-pressed={mode === 'assisted'}
          >
            <strong>Help me choose</strong>
            <small>Explainable suggestions</small>
          </button>
        </div>
      </fieldset>

      {mode === 'manual' ? (
        <div className={tw("manual-promise")}>
          <span>Manual means manual.</span>
          <p>No ranking runs, and no reading behavior is optimized. Your queue order is the whole decision.</p>
        </div>
      ) : (
        <>
          <div className={tw("assistant-disclosure")}>
            <Sparkles aria-hidden="true" />
            <p><strong>A small, local comparison.</strong> Only the signals below affect suggestions. Nothing leaves this device, and every contributing signal is shown beside the book.</p>
          </div>

          <section className={tw("signal-list")} aria-labelledby="signal-list-title">
            <header>
              <span id="signal-list-title">Signals</span>
              <small>Off · Light · Medium · Strong</small>
            </header>
            {UP_NEXT_CRITERIA.map((criterion) => (
              <SignalEditor
                key={criterion}
                criterion={criterion}
                preferences={preferences}
                onWeight={(weight) => setWeight(criterion, weight)}
                onList={setList}
                onMaximumPages={(maximumPages) => setPreferences((current) => ({
                  ...current,
                  maximumPages,
                }))}
                onRecencyDirection={(recencyDirection) => setPreferences((current) => ({
                  ...current,
                  recencyDirection,
                }))}
                onRequired={(required) => setRequired(criterion, required)}
              />
            ))}
          </section>
        </>
      )}

      {(state.dismissedCriteria.length > 0 || state.dismissedSuggestions.length > 0) && (
        <section className={tw("up-next-decisions")}>
          <header>
            <span>Editable decisions</span>
            <small>Included in portable exports</small>
          </header>
          {state.dismissedCriteria.map((criterion) => (
            <button type="button" key={criterion} onClick={() => onRestoreReason(criterion)}>
              <span><strong>{UP_NEXT_CRITERION_COPY[criterion].label}</strong><small>Reason dismissed</small></span>
              <span><RotateCcw aria-hidden="true" /> Restore</span>
            </button>
          ))}
          {state.dismissedSuggestions.map(({ bookId }) => (
            <button type="button" key={bookId} onClick={() => onRestoreSuggestion(bookId)}>
              <span><strong>{byId.get(bookId)?.title ?? 'Removed book'}</strong><small>Suggestion dismissed</small></span>
              <span><RotateCcw aria-hidden="true" /> Restore</span>
            </button>
          ))}
        </section>
      )}

      <button className={tw("primary-action up-next-settings__save")} type="submit">
        Save choice settings
      </button>
    </form>
  )
}

function SignalEditor({
  criterion,
  preferences,
  onWeight,
  onList,
  onMaximumPages,
  onRecencyDirection,
  onRequired,
}: {
  criterion: UpNextCriterion
  preferences: UpNextPreferences
  onWeight: (weight: number) => void
  onList: (field: 'formats' | 'moodTags' | 'series', value: string) => void
  onMaximumPages: (maximumPages: number | null) => void
  onRecencyDirection: (direction: UpNextPreferences['recencyDirection']) => void
  onRequired: (required: boolean) => void
}) {
  const copy = UP_NEXT_CRITERION_COPY[criterion]
  const canRequire = ['format', 'length', 'mood', 'series'].includes(criterion)
  const enabled = preferences.weights[criterion] > 0

  return (
    <article className={tw(`signal${enabled ? ' is-enabled' : ''}`)}>
      <div className={tw("signal__heading")}>
        <span><strong>{copy.label}</strong><small>{copy.description}</small></span>
        <div className={tw("signal__weights")} role="group" aria-label={`${copy.label} importance`}>
          {[0, 1, 2, 3].map((weight) => (
            <button
              type="button"
              key={weight}
              className={tw(preferences.weights[criterion] === weight ? 'is-active' : '')}
              onClick={() => onWeight(weight)}
              aria-label={`${copy.label}: ${['Off', 'Light', 'Medium', 'Strong'][weight]}`}
              aria-pressed={preferences.weights[criterion] === weight}
            >
              {weight}
            </button>
          ))}
        </div>
      </div>
      {enabled && criterion === 'format' && (
        <input
          value={preferences.formats.join(', ')}
          onChange={(event) => onList('formats', event.target.value)}
          placeholder="eBook, Paperback"
          aria-label="Preferred formats, separated by commas"
        />
      )}
      {enabled && criterion === 'length' && (
        <label className={tw("signal__number")}>
          <span>Up to</span>
          <input
            type="number"
            min="1"
            max="20000"
            inputMode="numeric"
            value={preferences.maximumPages ?? ''}
            onChange={(event) => onMaximumPages(event.target.value
              ? Math.max(1, Math.min(20_000, Number(event.target.value)))
              : null)}
            placeholder="400"
          />
          <span>pages</span>
        </label>
      )}
      {enabled && criterion === 'mood' && (
        <input
          value={preferences.moodTags.join(', ')}
          onChange={(event) => onList('moodTags', event.target.value)}
          placeholder="Hopeful, Surreal, Cozy"
          aria-label="Preferred mood tags, separated by commas"
        />
      )}
      {enabled && criterion === 'series' && (
        <input
          value={preferences.series.join(', ')}
          onChange={(event) => onList('series', event.target.value)}
          placeholder="Mistborn, The Farseer Trilogy"
          aria-label="Preferred series, separated by commas"
        />
      )}
      {enabled && criterion === 'recency' && (
        <select
          value={preferences.recencyDirection}
          onChange={(event) => onRecencyDirection(event.target.value as UpNextPreferences['recencyDirection'])}
          aria-label="Recency preference"
        >
          <option value="long-waiting">Books waiting longest</option>
          <option value="recently-added">Recently added books</option>
        </select>
      )}
      {enabled && criterion === 'loan-expiry' && (
        <p className={tw("signal__source")}>Uses due dates already recorded for Libby or other loans.</p>
      )}
      {enabled && canRequire && (
        <label className={tw("signal__required")}>
          <input
            type="checkbox"
            checked={preferences.requiredCriteria.includes(criterion)}
            onChange={(event) => onRequired(event.target.checked)}
          />
          <span>Require this match</span>
        </label>
      )}
    </article>
  )
}

function commaList(value: string): string[] {
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))]
}
