export const REQUIRED_GALLERY_STATES = [
  'default',
  'hover',
  'focus',
  'pressed',
  'disabled',
  'loading',
  'empty',
  'error',
  'long-content',
  'dark',
  'high-contrast',
  'reduced-motion',
  'large-text',
] as const

export type GalleryState = (typeof REQUIRED_GALLERY_STATES)[number]
export type GalleryKind = 'primitive' | 'composite' | 'feedback'

export interface GalleryCatalogEntry {
  component: string
  story: string
  kind: GalleryKind
  states: readonly GalleryState[]
  summary: string
}

export const GALLERY_CATALOG: readonly GalleryCatalogEntry[] = [
  {
    component: 'ActionButton',
    story: 'action-button',
    kind: 'primitive',
    states: ['default', 'hover', 'focus', 'pressed', 'disabled', 'loading', 'long-content'],
    summary: 'Primary and secondary actions, including deterministic interaction poses.',
  },
  {
    component: 'BookCover',
    story: 'book-cover',
    kind: 'primitive',
    states: ['default', 'long-content', 'dark', 'high-contrast'],
    summary: 'Generated cover stock without a network image dependency.',
  },
  {
    component: 'EmptyState',
    story: 'empty-state',
    kind: 'feedback',
    states: ['default', 'empty', 'large-text'],
    summary: 'Quiet, actionable absence with a text-first explanation.',
  },
  {
    component: 'FeedbackNotice',
    story: 'feedback-notice',
    kind: 'feedback',
    states: ['default', 'loading', 'error', 'reduced-motion'],
    summary: 'Stable inline loading and failure feedback with live-region semantics.',
  },
  {
    component: 'ProgressMeter',
    story: 'progress-meter',
    kind: 'primitive',
    states: ['default', 'dark', 'high-contrast', 'reduced-motion'],
    summary: 'A proportional reading state paired with a numeric value.',
  },
  {
    component: 'RatingStars',
    story: 'rating-stars',
    kind: 'primitive',
    states: ['default', 'hover', 'focus', 'pressed', 'disabled'],
    summary: 'Readable and keyboard-focusable private rating control.',
  },
  {
    component: 'StatusBadge',
    story: 'status-badge',
    kind: 'primitive',
    states: ['default', 'error', 'dark', 'high-contrast'],
    summary: 'Compact status language that retains text in every color mode.',
  },
] as const

export const COMPOSITE_STORIES = [
  {
    story: 'book-row',
    kind: 'composite',
    states: ['default', 'hover', 'focus', 'pressed', 'long-content', 'large-text'],
  },
  {
    story: 'progress-sheet',
    kind: 'composite',
    states: ['default', 'disabled', 'long-content', 'dark', 'high-contrast', 'large-text'],
  },
] as const satisfies readonly Pick<GalleryCatalogEntry, 'story' | 'kind' | 'states'>[]

export const REVIEW_SCENARIOS = [
  {
    id: 'warm-interactions',
    label: 'Warm · interactions',
    query: 'view=primitives&paper=warm&contrast=standard&type=standard&motion=reduced&texture=off',
  },
  {
    id: 'night-high-composites',
    label: 'Night · high contrast',
    query: 'view=composites&paper=night&contrast=high&type=standard&motion=reduced&texture=off',
  },
  {
    id: 'large-feedback',
    label: 'Large text · feedback',
    query: 'view=feedback&paper=print&contrast=standard&type=x-large&motion=reduced&texture=off',
  },
] as const
