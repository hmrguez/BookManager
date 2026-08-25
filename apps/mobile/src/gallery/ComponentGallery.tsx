import { useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CirclePlus,
  FlaskConical,
  Gauge,
  LoaderCircle,
  Minus,
  Plus,
  Search,
  ShieldCheck,
} from 'lucide-react'
import {
  ActionButton,
  BookCover,
  EmptyState,
  FeedbackNotice,
  ProgressMeter,
  RatingStars,
  StatusBadge,
} from '../design-system'
import type { LibraryBook } from '../library'
import {
  COMPOSITE_STORIES,
  GALLERY_CATALOG,
  REQUIRED_GALLERY_STATES,
  REVIEW_SCENARIOS,
} from './catalog'
import '../App.css'
import './gallery.css'

type GalleryView = 'all' | 'primitives' | 'composites' | 'feedback' | 'review'
type GalleryPaper = 'warm' | 'cool' | 'print' | 'night'
type GalleryContrast = 'standard' | 'high'
type GalleryType = 'standard' | 'large' | 'x-large'
type GalleryMotion = 'system' | 'reduced'
type GalleryTexture = 'quiet' | 'off'

interface GalleryEnvironment {
  paper: GalleryPaper
  contrast: GalleryContrast
  type: GalleryType
  motion: GalleryMotion
  texture: GalleryTexture
}

const viewLabels: Record<GalleryView, string> = {
  all: 'All specimens',
  primitives: 'Primitives',
  composites: 'Composites',
  feedback: 'Feedback',
  review: 'Review gate',
}

const paperOptions: GalleryPaper[] = ['warm', 'cool', 'print', 'night']
const contrastOptions: GalleryContrast[] = ['standard', 'high']
const typeOptions: GalleryType[] = ['standard', 'large', 'x-large']
const motionOptions: GalleryMotion[] = ['system', 'reduced']
const textureOptions: GalleryTexture[] = ['quiet', 'off']

const galleryBook: LibraryBook = {
  id: 'gallery-quiet-archive',
  title: 'The Cartographer’s Quiet Archive of Impossible Shores',
  authors: ['Mara Vellum and the Society of Patient Readers'],
  pageCount: 684,
  shelf: 'reading',
  progress: 67,
  currentPage: 458,
  rating: 4,
  notes: 'A deterministic fixture: no request, clock, storage, or random value.',
  addedAt: '2026-08-25T12:00:00.000Z',
  startedAt: '2026-08-25T12:00:00.000Z',
  lastUpdatedAt: '2026-08-25T12:00:00.000Z',
}

function isOption<T extends string>(options: readonly T[], value: string | null): value is T {
  return value !== null && options.includes(value as T)
}

function readGalleryState() {
  const params = new URLSearchParams(window.location.search)
  const requestedView = params.get('view')

  return {
    view: requestedView && requestedView in viewLabels ? requestedView as GalleryView : 'all',
    environment: {
      paper: isOption(paperOptions, params.get('paper')) ? params.get('paper') : 'warm',
      contrast: isOption(contrastOptions, params.get('contrast')) ? params.get('contrast') : 'standard',
      type: isOption(typeOptions, params.get('type')) ? params.get('type') : 'standard',
      motion: isOption(motionOptions, params.get('motion')) ? params.get('motion') : 'reduced',
      texture: isOption(textureOptions, params.get('texture')) ? params.get('texture') : 'off',
    } as GalleryEnvironment,
  }
}

function Specimen({
  id,
  title,
  states,
  children,
  wide = false,
}: {
  id: string
  title: string
  states: readonly string[]
  children: ReactNode
  wide?: boolean
}) {
  return (
    <article className={`gallery-specimen${wide ? ' gallery-specimen--wide' : ''}`} id={id}>
      <header className="gallery-specimen__header">
        <div>
          <span>#{id}</span>
          <h3>{title}</h3>
        </div>
        <ul aria-label="Covered states">
          {states.map((state) => <li key={state}>{state}</li>)}
        </ul>
      </header>
      <div className="gallery-specimen__canvas">{children}</div>
    </article>
  )
}

function ControlGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: readonly T[]
  onChange: (next: T) => void
}) {
  return (
    <fieldset className="gallery-control">
      <legend>{label}</legend>
      <div>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            onClick={() => onChange(option)}
          >
            {option.replace('-', ' ')}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

function ActionButtonStory() {
  const states = ['default', 'hover', 'focus', 'pressed', 'disabled', 'loading'] as const

  return (
    <div className="gallery-state-grid gallery-state-grid--buttons">
      {states.map((state) => (
        <div className="gallery-state" data-visual-state={state} key={state}>
          <span>{state}</span>
          <ActionButton disabled={state === 'disabled'} isLoading={state === 'loading'}>
            {state === 'loading' ? 'Adding book' : 'Add to library'}
          </ActionButton>
        </div>
      ))}
      <div className="gallery-state gallery-state--wide" data-visual-state="long-content">
        <span>long content</span>
        <ActionButton variant="secondary">
          Move this unusually titled volume into the finished-books archive
        </ActionButton>
      </div>
    </div>
  )
}

function BookCoverStory() {
  return (
    <div className="gallery-cover-line">
      <BookCover book={galleryBook} />
      <BookCover book={{ ...galleryBook, id: 'two', title: 'Piranesi', authors: ['Susanna Clarke'] }} />
      <BookCover book={{ ...galleryBook, id: 'three', title: 'Vita Nostra', authors: ['Marina Dyachenko'] }} />
      <BookCover book={galleryBook} large />
    </div>
  )
}

function RatingStory() {
  const [rating, setRating] = useState(3)

  return (
    <div className="gallery-state-grid gallery-state-grid--rating">
      <div className="gallery-state"><span>default</span><RatingStars value={4} /></div>
      <div className="gallery-state" data-visual-state="focus"><span>focus</span><RatingStars value={rating} onChange={setRating} /></div>
      <div className="gallery-state"><span>disabled</span><RatingStars value={2} onChange={setRating} disabled /></div>
    </div>
  )
}

function StatusStory() {
  return (
    <div className="gallery-inline-specimens">
      <StatusBadge icon={<BookOpen aria-hidden="true" />}>Reading</StatusBadge>
      <StatusBadge tone="accent" icon={<Check aria-hidden="true" />}>Finished</StatusBadge>
      <StatusBadge tone="destructive" icon={<AlertTriangle aria-hidden="true" />}>Sync failed</StatusBadge>
    </div>
  )
}

function ProgressStory() {
  return (
    <div className="gallery-progress-set">
      {[0, 31, 67, 100].map((value) => (
        <div key={value}>
          <span>{value}%</span>
          <ProgressMeter value={value} label={`Progress at ${value} percent`} />
        </div>
      ))}
    </div>
  )
}

function FieldStory() {
  return (
    <div className="gallery-field-grid">
      <label className="gallery-field">
        <span>Default</span>
        <input value="The Left Hand of Darkness" readOnly />
        <small>Title as it appears on the cover.</small>
      </label>
      <label className="gallery-field" data-visual-state="focus">
        <span>Focus</span>
        <input value="Ursula K. Le Guin" readOnly />
        <small>Visible ring is held for review.</small>
      </label>
      <label className="gallery-field gallery-field--error">
        <span>Error</span>
        <input value="-4" aria-invalid="true" readOnly />
        <small>Page count must be zero or greater.</small>
      </label>
      <label className="gallery-field">
        <span>Disabled</span>
        <input value="Synced metadata" disabled />
        <small>Read-only from the source edition.</small>
      </label>
    </div>
  )
}

function BookRowStory() {
  return (
    <div className="gallery-book-stack">
      <article className="book-row">
        <button className="book-identity" type="button">
          <BookCover book={galleryBook} />
          <span className="book-copy">
            <strong>{galleryBook.title}</strong>
            <small>{galleryBook.authors.join(', ')}</small>
          </span>
        </button>
        <div className="reading-actions">
          <button className="progress-button" type="button">
            <span>{galleryBook.progress}%</span>
            <ProgressMeter value={galleryBook.progress} label={`${galleryBook.title} reading progress`} />
          </button>
          <button className="row-action row-action--finish" type="button">
            Finish <Check aria-hidden="true" />
          </button>
        </div>
      </article>
      <article className="search-result">
        <BookCover book={{ ...galleryBook, title: 'Piranesi', authors: ['Susanna Clarke'] }} />
        <div className="search-result__copy">
          <h3>Piranesi</h3>
          <p>Susanna Clarke</p>
          <small>272 pages</small>
        </div>
        <button className="result-add" type="button"><Plus aria-hidden="true" /><span>Add</span></button>
      </article>
    </div>
  )
}

function SheetStory() {
  return (
    <div className="gallery-sheet-frame">
      <section className="bottom-sheet" role="dialog" aria-label="Update progress specimen">
        <div className="sheet-handle" aria-hidden="true" />
        <header className="sheet-header"><h2>Update progress</h2><span>Fixed state</span></header>
        <div className="sheet-book-line">
          <BookCover book={galleryBook} />
          <div><strong>{galleryBook.title}</strong><small>{galleryBook.authors.join(', ')}</small></div>
        </div>
        <div className="progress-editor">
          <button type="button" aria-label="Decrease by 5 percent"><Minus aria-hidden="true" /></button>
          <output>67<span>%</span></output>
          <button type="button" aria-label="Increase by 5 percent"><Plus aria-hidden="true" /></button>
        </div>
        <div className="progress-presets" aria-label="Progress presets">
          <button type="button">25%</button><button type="button">50%</button>
          <button type="button">75%</button><button type="button">Finished</button>
        </div>
      </section>
    </div>
  )
}

function FeedbackStories() {
  return (
    <>
      <Specimen id="feedback-notice" title="Feedback notices" states={['loading', 'error', 'reduced motion']} wide>
        <div className="gallery-feedback-stack">
          <FeedbackNotice tone="loading" title="Looking through the stacks">
            Results will replace this message without moving the search field.
          </FeedbackNotice>
          <FeedbackNotice tone="error" title="Google Books is unavailable">
            Your library is still here. Try the search again shortly.
          </FeedbackNotice>
        </div>
      </Specimen>
      <Specimen id="empty-state" title="Empty shelf" states={['empty', 'large text']} wide>
        <EmptyState
          icon={<CirclePlus />}
          title="Save something for later"
          description="This shelf is empty. Add a title when one catches your attention."
          action={<ActionButton variant="secondary"><Plus aria-hidden="true" /> Add a book</ActionButton>}
        />
      </Specimen>
    </>
  )
}

function ReviewGate() {
  const checks = [
    ['Visual', 'Compare all three stable baselines; explain every intentional diff.'],
    ['Keyboard', 'Tab through the changed story; focus order and focus ring remain visible.'],
    ['Semantics', 'Names, roles, live regions, errors, and disabled states match the visible state.'],
    ['Contrast', 'Review standard, night, and explicit high contrast without relying on subtle rules.'],
    ['Text', 'Check 125% type and long fixtures without clipping, hiding, or shrinking labels.'],
    ['Motion', 'Review the reduced-motion replacement; state and hierarchy remain understandable.'],
    ['Performance', 'No remote requests, raster texture, unbounded animation, or avoidable layout shift.'],
  ] as const

  return (
    <section className="gallery-review" id="review-gate" data-testid="review-gate">
      <header>
        <span>Completion contract</span>
        <h2>Visual approval is accessibility approval.</h2>
        <p>A reusable component is unfinished until its catalog entry and affected baseline are reviewed.</p>
      </header>
      <ol>
        {checks.map(([name, detail]) => (
          <li key={name}><span><Check aria-hidden="true" /></span><div><strong>{name}</strong><p>{detail}</p></div></li>
        ))}
      </ol>
      <div className="gallery-review__commands">
        <code>bun run gallery:test</code>
        <code>bun run gallery:update</code>
      </div>
      <div className="gallery-review__scenarios">
        {REVIEW_SCENARIOS.map((scenario) => (
          <a key={scenario.id} href={`/__gallery?${scenario.query}`}>{scenario.label}<ArrowRight aria-hidden="true" /></a>
        ))}
      </div>
    </section>
  )
}

function StateLedger() {
  const stateCounts = useMemo(() => {
    const catalog = [...GALLERY_CATALOG, ...COMPOSITE_STORIES]
    return Object.fromEntries(REQUIRED_GALLERY_STATES.map((state) => [
      state,
      catalog.filter((entry) => entry.states.some((coveredState) => coveredState === state)).length,
    ]))
  }, [])

  return (
    <section className="gallery-ledger" aria-labelledby="gallery-ledger-title">
      <div><Gauge aria-hidden="true" /><h2 id="gallery-ledger-title">Coverage ledger</h2></div>
      <ul>
        {REQUIRED_GALLERY_STATES.map((state) => (
          <li key={state}><span>{state}</span><strong>{stateCounts[state]}</strong></li>
        ))}
      </ul>
    </section>
  )
}

export function ComponentGallery() {
  const initial = useMemo(() => readGalleryState(), [])
  const [view, setView] = useState<GalleryView>(initial.view)
  const [environment, setEnvironment] = useState<GalleryEnvironment>(initial.environment)

  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.paperMode = environment.paper
    root.dataset.contrast = environment.contrast
    root.dataset.typeScale = environment.type
    root.dataset.texture = environment.texture
    if (environment.motion === 'reduced') root.dataset.motion = 'reduced'
    else delete root.dataset.motion

    const params = new URLSearchParams({ view, ...environment })
    window.history.replaceState(null, '', `/__gallery?${params.toString()}`)
    document.title = `Pulp gallery · ${viewLabels[view]}`
  }, [environment, view])

  const updateEnvironment = <Key extends keyof GalleryEnvironment>(
    key: Key,
    value: GalleryEnvironment[Key],
  ) => setEnvironment((current) => ({ ...current, [key]: value }))

  const showPrimitives = view === 'all' || view === 'primitives'
  const showComposites = view === 'all' || view === 'composites'
  const showFeedback = view === 'all' || view === 'feedback'
  const showReview = view === 'all' || view === 'review'

  return (
    <div className="component-gallery">
      <header className="gallery-masthead">
        <div className="gallery-masthead__brand">
          <a href="/" aria-label="Back to Wovenleaf"><ArrowLeft aria-hidden="true" /></a>
          <div><span>Pulp · development ledger</span><h1>Component gallery</h1></div>
        </div>
        <p>Every state laid flat, like a printer’s proof before the pages are bound.</p>
        <StatusBadge tone="accent" icon={<FlaskConical aria-hidden="true" />}>Development only</StatusBadge>
      </header>

      <aside className="gallery-toolbar" aria-label="Gallery controls">
        <nav aria-label="Gallery views">
          {(Object.keys(viewLabels) as GalleryView[]).map((option) => (
            <button type="button" key={option} aria-pressed={view === option} onClick={() => setView(option)}>
              {viewLabels[option]}
            </button>
          ))}
        </nav>
        <div className="gallery-toolbar__modes">
          <ControlGroup label="Paper" value={environment.paper} options={paperOptions} onChange={(value) => updateEnvironment('paper', value)} />
          <ControlGroup label="Contrast" value={environment.contrast} options={contrastOptions} onChange={(value) => updateEnvironment('contrast', value)} />
          <ControlGroup label="Type" value={environment.type} options={typeOptions} onChange={(value) => updateEnvironment('type', value)} />
          <ControlGroup label="Motion" value={environment.motion} options={motionOptions} onChange={(value) => updateEnvironment('motion', value)} />
          <ControlGroup label="Texture" value={environment.texture} options={textureOptions} onChange={(value) => updateEnvironment('texture', value)} />
        </div>
      </aside>

      <main className="gallery-main" data-testid="gallery-canvas">
        {view === 'all' && <StateLedger />}

        {showPrimitives && (
          <section className="gallery-chapter" aria-labelledby="primitives-title" data-gallery-chapter="primitives">
            <header className="gallery-chapter__header"><span>Chapter 01</span><h2 id="primitives-title">Primitives</h2><p>Interaction and meaning at their smallest reusable scale.</p></header>
            <div className="gallery-grid">
              <Specimen id="action-button" title="Action button" states={['default', 'hover', 'focus', 'pressed', 'disabled', 'loading', 'long content']} wide><ActionButtonStory /></Specimen>
              <Specimen id="book-cover" title="Book cover" states={['fallback', 'large', 'long content']}><BookCoverStory /></Specimen>
              <Specimen id="rating-stars" title="Rating stars" states={['default', 'focus', 'disabled']}><RatingStory /></Specimen>
              <Specimen id="status-badge" title="Status badge" states={['default', 'selected', 'error']}><StatusStory /></Specimen>
              <Specimen id="progress-meter" title="Progress meter" states={['0%', '31%', '67%', '100%']}><ProgressStory /></Specimen>
              <Specimen id="text-field" title="Text field" states={['default', 'focus', 'error', 'disabled']} wide><FieldStory /></Specimen>
            </div>
          </section>
        )}

        {showComposites && (
          <section className="gallery-chapter" aria-labelledby="composites-title" data-gallery-chapter="composites">
            <header className="gallery-chapter__header"><span>Chapter 02</span><h2 id="composites-title">Composites</h2><p>Production-shaped arrangements with fixed local fixtures.</p></header>
            <div className="gallery-grid">
              <Specimen id="book-row" title="Book and search rows" states={['default', 'long content', 'large text']} wide><BookRowStory /></Specimen>
              <Specimen id="progress-sheet" title="Progress sheet" states={['default', 'disabled', 'large text']} wide><SheetStory /></Specimen>
            </div>
          </section>
        )}

        {showFeedback && (
          <section className="gallery-chapter" aria-labelledby="feedback-title" data-gallery-chapter="feedback">
            <header className="gallery-chapter__header"><span>Chapter 03</span><h2 id="feedback-title">Feedback</h2><p>Empty, loading, and error states that keep the reader oriented.</p></header>
            <div className="gallery-grid"><FeedbackStories /></div>
          </section>
        )}

        {showReview && <ReviewGate />}
      </main>

      <footer className="gallery-footer">
        <ShieldCheck aria-hidden="true" />
        <span>Fixtures are local. Motion is reduced by default. Time and network do not enter the frame.</span>
        <Search aria-hidden="true" />
        <span>{GALLERY_CATALOG.length} reusable components registered</span>
        <LoaderCircle aria-hidden="true" />
        <span>3 stable baselines</span>
      </footer>
    </div>
  )
}
