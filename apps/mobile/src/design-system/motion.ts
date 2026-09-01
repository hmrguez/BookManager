export const MOTION_MODES = ['system', 'reduced'] as const

export type MotionMode = (typeof MOTION_MODES)[number]
export type MotionFamily =
  | 'navigate'
  | 'reveal'
  | 'reorder'
  | 'move-shelf'
  | 'progress'
  | 'complete'
  | 'undo'
  | 'sync'

export interface MotionRule {
  purpose: string
  trigger: string
  durationMs: number
  easing: 'enter' | 'exit' | 'move' | 'linear'
  transformOrigin: string
  interruption: string
  reversal: string
  gestureCoupling: string
  reducedReplacement: string
  informationSource: string
  maxConcurrentElements: 1 | 2
}

export interface ShelfMotionTiming {
  readonly focusMs: number
  readonly eraseMs: number
  readonly settleMs: number
  readonly writeMs: number
}

export const SHELF_MOTION_TIMING: ShelfMotionTiming = {
  focusMs: 220,
  eraseMs: 520,
  settleMs: 220,
  writeMs: 520,
}

const REDUCED_SHELF_MOTION_TIMING: ShelfMotionTiming = {
  focusMs: 0,
  eraseMs: 0,
  settleMs: 0,
  writeMs: 0,
}

/**
 * The reviewable source of truth for Wovenleaf motion. Product motion must name one of these
 * semantic families; a visual flourish without a state-change trigger does not belong here.
 */
export const MOTION_GRAMMAR: Readonly<Record<MotionFamily, MotionRule>> = {
  navigate: {
    purpose: 'Preserve place while changing the primary app view or jumping to a shelf.',
    trigger: 'A user selects a destination in primary navigation.',
    durationMs: 240,
    easing: 'enter',
    transformOrigin: 'right center',
    interruption: 'The next destination commits immediately and replaces the in-flight view.',
    reversal: 'Back navigation uses the same distance from the opposite inline edge.',
    gestureCoupling: 'If a swipe is added, progress follows the pointer 1:1 and settles from its release velocity.',
    reducedReplacement: 'Swap views immediately, update aria-current, move focus, and jump without smooth scrolling.',
    informationSource: 'Destination heading and aria-current identify the new view.',
    maxConcurrentElements: 1,
  },
  reveal: {
    purpose: 'Expose controls or detail that the user explicitly requested.',
    trigger: 'A user opens search, a disclosure, or a modal sheet.',
    durationMs: 180,
    easing: 'enter',
    transformOrigin: 'top center',
    interruption: 'Controls are interactive on the first frame; dismissing commits immediately.',
    reversal: 'Dismissal uses the exit curve from the current visual state.',
    gestureCoupling: 'A draggable sheet must track the pointer 1:1 and dismiss only past 35% or the velocity threshold.',
    reducedReplacement: 'Show or hide the region immediately while retaining its heading, boundary, and focus order.',
    informationSource: 'Expanded state, dialog semantics, heading, and focus expose the hierarchy.',
    maxConcurrentElements: 2,
  },
  reorder: {
    purpose: 'Keep an item spatially identifiable while its order changes.',
    trigger: 'A user changes a shelf sort or directly reorders an item.',
    durationMs: 180,
    easing: 'move',
    transformOrigin: 'center center',
    interruption: 'A new order retargets from the current positions without queuing transitions.',
    reversal: 'Undo retargets the same items to their measured prior positions.',
    gestureCoupling: 'A dragged item follows the pointer 1:1; surrounding items move only after the insertion target changes.',
    reducedReplacement: 'Commit the order immediately and announce the new position in text.',
    informationSource: 'The final list order and position announcement carry the result.',
    maxConcurrentElements: 2,
  },
  'move-shelf': {
    purpose: 'Connect a book leaving one shelf with its settled state on another through an ink-like erase and rewrite.',
    trigger: 'A book is added, removed, moved, started, or advanced between shelf lists.',
    durationMs: 520,
    easing: 'move',
    transformOrigin: 'left center',
    interruption: 'A second list change retargets the rendered books immediately and replaces the prior sequence.',
    reversal: 'Undo returns the book to its recorded shelf and uses the undo feedback family.',
    gestureCoupling: 'If dragging is added, the book follows 1:1 and the shelf change commits only on a valid drop target.',
    reducedReplacement: 'Place the row immediately, update its shelf label, and show the same undoable status message.',
    informationSource: 'Shelf membership, row actions, and the undoable status message carry the change.',
    maxConcurrentElements: 2,
  },
  progress: {
    purpose: 'Connect a reading-progress input with its numeric and proportional result.',
    trigger: 'A user changes percent or current page.',
    durationMs: 140,
    easing: 'linear',
    transformOrigin: 'left center',
    interruption: 'Every input retargets the bar from its current rendered width.',
    reversal: 'Decreases use the same linear interpolation toward the smaller value.',
    gestureCoupling: 'Range input value and visual fill remain coupled to the pointer on every input event.',
    reducedReplacement: 'Update the number, page count, and bar width on the same frame.',
    informationSource: 'Percent output and page count remain visible independent of the bar.',
    maxConcurrentElements: 1,
  },
  complete: {
    purpose: 'Confirm that a book reached its finished state without turning completion into spectacle.',
    trigger: 'A user marks a book finished.',
    durationMs: 300,
    easing: 'enter',
    transformOrigin: 'left center',
    interruption: 'Rating and Done controls work immediately; dismissal never waits for the emphasis.',
    reversal: 'Moving the book back removes the finished state immediately and offers standard move feedback.',
    gestureCoupling: 'Completion has no gesture-only behavior; it follows the control activation.',
    reducedReplacement: 'Show the check, Finished heading, book identity, and rating controls immediately.',
    informationSource: 'Check, Finished heading, shelf membership, and confirmation copy carry the result.',
    maxConcurrentElements: 2,
  },
  undo: {
    purpose: 'Confirm that the most recent reversible shelf change was rolled back.',
    trigger: 'A user activates Undo in a status message.',
    durationMs: 140,
    easing: 'exit',
    transformOrigin: 'bottom center',
    interruption: 'Undo commits immediately and replaces the previous message.',
    reversal: 'The original action can be performed again as a new move, never by replaying a queued animation.',
    gestureCoupling: 'No gesture is required; the visible Undo control is always available.',
    reducedReplacement: 'Restore the prior shelf immediately and replace the status text with “Move undone.”',
    informationSource: 'Restored shelf membership and status text carry the result.',
    maxConcurrentElements: 2,
  },
  sync: {
    purpose: 'Differentiate active, successful, and failed synchronization when remote sync exists.',
    trigger: 'A user action creates a bounded sync request; local-only idle state never animates.',
    durationMs: 140,
    easing: 'linear',
    transformOrigin: 'center center',
    interruption: 'Cancel, retry, success, and failure replace the active state immediately.',
    reversal: 'Retry begins a new bounded request; it does not reverse a completed indicator.',
    gestureCoupling: 'Not gesture-coupled.',
    reducedReplacement: 'Use explicit “Syncing”, “Synced”, or error text and a static icon.',
    informationSource: 'Visible status text and an aria-live announcement carry every sync state.',
    maxConcurrentElements: 1,
  },
}

export const MOTION_FRAME_BUDGET = {
  deviceFloor: 'Capacitor WebView at 60 Hz under 4× CPU slowdown',
  frameBudgetMs: 16.7,
  longFrameThresholdMs: 25,
  requiredPercentile: 95,
  representativeFlows: ['navigate', 'reveal', 'move-shelf', 'progress', 'complete'] as const,
} as const

export function shouldReduceMotion(
  mode: MotionMode,
  systemPreference = typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
) {
  return mode === 'reduced' || systemPreference
}

export function motionScrollBehavior(mode: MotionMode, systemPreference?: boolean): ScrollBehavior {
  return shouldReduceMotion(mode, systemPreference) ? 'auto' : 'smooth'
}

export function shelfMotionTiming(
  mode: MotionMode,
  systemPreference = typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
): ShelfMotionTiming {
  return shouldReduceMotion(mode, systemPreference)
    ? REDUCED_SHELF_MOTION_TIMING
    : SHELF_MOTION_TIMING
}
