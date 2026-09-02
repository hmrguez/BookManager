import type { ShelfId } from '../library'

export const appearanceLabels = {
  paperMode: {
    warm: 'Warm',
    cool: 'Cool',
    print: 'Print',
    night: 'Night',
  },
  contrast: {
    system: 'System',
    standard: 'Standard',
    high: 'High',
  },
  typeScale: {
    standard: '100%',
    large: '113%',
    'x-large': '125%',
  },
  motion: {
    system: 'System',
    reduced: 'Reduced',
  },
} as const

export const shelfCopy: Record<ShelfId, { label: string; eyebrow: string; empty: string }> = {
  tbr: {
    label: 'To Be Read',
    eyebrow: 'A home for every maybe',
    empty: 'Save something for later',
  },
  next: {
    label: 'Up Next',
    eyebrow: 'Your shortest shortlist',
    empty: 'Choose what comes next',
  },
  reading: {
    label: 'Reading',
    eyebrow: 'The books in your hands',
    empty: 'Start your next read',
  },
  finished: {
    label: 'Finished',
    eyebrow: 'A private reading record',
    empty: 'Finished books land here',
  },
}
