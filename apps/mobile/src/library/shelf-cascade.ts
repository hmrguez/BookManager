import {
  useCallback,
  useEffect,
  useState,
  type AnimationEventHandler,
  type CSSProperties,
} from 'react'
import { shouldReduceMotion, type MotionMode } from '../design-system'

const CASCADE_STAGGER_MS = 20
const CASCADE_MAX_ORDER = 7
const CASCADE_FALLBACK_MS = 360

type ShelfCascadePhase = 'open' | 'opening' | 'closing' | 'closed'

type UseShelfCascadeOptions = {
  readonly itemCount: number
  readonly motionMode: MotionMode
  readonly forceOpen?: boolean
  readonly expansionKey?: number
}

export function shelfCascadeItem(index: number, itemCount: number) {
  const lastIndex = Math.max(0, itemCount - 1)
  const openOrder = Math.min(index, CASCADE_MAX_ORDER)
  const closeOrder = Math.min(Math.max(0, lastIndex - index), CASCADE_MAX_ORDER)

  return {
    'data-shelf-cascade-item': '',
    'data-shelf-cascade-index': index,
    style: {
      '--shelf-cascade-open-delay': `${openOrder * CASCADE_STAGGER_MS}ms`,
      '--shelf-cascade-close-delay': `${closeOrder * CASCADE_STAGGER_MS}ms`,
    } as CSSProperties,
  }
}

export function useShelfCascade({
  itemCount,
  motionMode,
  forceOpen = false,
  expansionKey,
}: UseShelfCascadeOptions) {
  const [collapsed, setCollapsed] = useState(false)
  const [phase, setPhase] = useState<ShelfCascadePhase>('open')
  const isCollapsed = collapsed && !forceOpen
  const reduceMotion = shouldReduceMotion(motionMode)
  const [renderedCollapsed, setRenderedCollapsed] = useState(isCollapsed)
  const [renderedReduceMotion, setRenderedReduceMotion] = useState(reduceMotion)
  const [handledExpansionKey, setHandledExpansionKey] = useState(expansionKey)

  if (expansionKey !== undefined && expansionKey !== handledExpansionKey) {
    setHandledExpansionKey(expansionKey)
    setCollapsed(false)
  }

  if (reduceMotion !== renderedReduceMotion) {
    setRenderedReduceMotion(reduceMotion)
    setRenderedCollapsed(isCollapsed)
    setPhase(isCollapsed ? 'closed' : 'open')
  } else if (isCollapsed !== renderedCollapsed) {
    setRenderedCollapsed(isCollapsed)
    setPhase(reduceMotion ? (isCollapsed ? 'closed' : 'open') : (isCollapsed ? 'closing' : 'opening'))
  }

  useEffect(() => {
    if (phase !== 'opening' && phase !== 'closing') return
    const fallback = window.setTimeout(() => {
      setPhase((current) => current === 'opening' ? 'open' : current === 'closing' ? 'closed' : current)
    }, CASCADE_FALLBACK_MS)
    return () => window.clearTimeout(fallback)
  }, [phase])

  const onAnimationEnd = useCallback<AnimationEventHandler<HTMLElement>>((event) => {
    const itemIndex = Number((event.target as HTMLElement).dataset.shelfCascadeIndex)
    if (phase === 'opening'
      && event.animationName === 'motion-shelf-cascade-open'
      && itemIndex === itemCount - 1) {
      setPhase('open')
    }
    if (phase === 'closing'
      && event.animationName === 'motion-shelf-cascade-close'
      && itemIndex === 0) {
      setPhase('closed')
    }
  }, [itemCount, phase])

  return {
    isCollapsed,
    toggle: () => setCollapsed((current) => !current),
    cascadeProps: {
      'data-shelf-cascade': phase,
      hidden: phase === 'closed',
      'aria-hidden': isCollapsed || undefined,
      inert: isCollapsed || undefined,
      onAnimationEnd,
    },
  }
}
