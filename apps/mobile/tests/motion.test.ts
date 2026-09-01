import { describe, expect, test } from 'bun:test'
import {
  MOTION_FRAME_BUDGET,
  MOTION_GRAMMAR,
  SHELF_MOTION_TIMING,
  motionScrollBehavior,
  shelfMotionTiming,
  shouldReduceMotion,
  type MotionFamily,
} from '../src/design-system'
import {
  shelfMotionDelays,
  shouldAnimateShelfChange,
  type ShelfMotionEvent,
} from '../src/library/shelf-motion'

const motionCssUrl = new URL('../src/design-system/motion.css', import.meta.url)
const tokenCssUrl = new URL('../src/design-system/tokens.css', import.meta.url)

const requiredFamilies: MotionFamily[] = [
  'navigate',
  'reveal',
  'reorder',
  'move-shelf',
  'progress',
  'complete',
  'undo',
  'sync',
]

describe('Pulp motion grammar', () => {
  test('defines a bounded, reversible, information-preserving rule for every semantic event', () => {
    expect(Object.keys(MOTION_GRAMMAR)).toEqual(requiredFamilies)

    for (const family of requiredFamilies) {
      const rule = MOTION_GRAMMAR[family]
      expect(rule.purpose.length).toBeGreaterThan(20)
      expect(rule.trigger.length).toBeGreaterThan(20)
      expect(rule.durationMs).toBeGreaterThan(0)
      expect(rule.durationMs).toBeLessThanOrEqual(300)
      expect(rule.interruption).toMatch(/immediate|retarget|first frame/i)
      expect(rule.reversal.length).toBeGreaterThan(20)
      expect(rule.gestureCoupling.length).toBeGreaterThan(15)
      expect(rule.reducedReplacement.length).toBeGreaterThan(20)
      expect(rule.informationSource.length).toBeGreaterThan(20)
      expect(rule.maxConcurrentElements).toBeLessThanOrEqual(2)
    }
  })

  test('uses the device-floor frame budget for every representative implemented flow', () => {
    expect(MOTION_FRAME_BUDGET.deviceFloor).toContain('4× CPU slowdown')
    expect(MOTION_FRAME_BUDGET.frameBudgetMs).toBe(16.7)
    expect(MOTION_FRAME_BUDGET.longFrameThresholdMs).toBeLessThanOrEqual(25)
    expect(MOTION_FRAME_BUDGET.requiredPercentile).toBe(95)

    for (const family of MOTION_FRAME_BUDGET.representativeFlows) {
      expect(MOTION_GRAMMAR[family]).toBeDefined()
    }
  })

  test('honors both the OS preference and the explicit global test mode in JavaScript motion', () => {
    expect(shouldReduceMotion('system', false)).toBe(false)
    expect(shouldReduceMotion('system', true)).toBe(true)
    expect(shouldReduceMotion('reduced', false)).toBe(true)
    expect(motionScrollBehavior('system', false)).toBe('smooth')
    expect(motionScrollBehavior('system', true)).toBe('auto')
    expect(motionScrollBehavior('reduced', false)).toBe('auto')
    expect(shelfMotionTiming('system', false)).toEqual(SHELF_MOTION_TIMING)
    expect(shelfMotionTiming('reduced', false)).toEqual({
      focusMs: 0,
      eraseMs: 0,
      settleMs: 0,
      writeMs: 0,
    })
  })

  test('sequences a shelf move through source focus, erase, settle, destination focus, and write', () => {
    const event: ShelfMotionEvent = {
      sequence: 1,
      bookId: 'book-1',
      from: 'tbr',
      to: 'reading',
    }

    expect(shelfMotionDelays(event, 'tbr', SHELF_MOTION_TIMING)).toEqual({
      eraseDelayMs: SHELF_MOTION_TIMING.focusMs,
      writeDelayMs: 0,
    })
    expect(shelfMotionDelays(event, 'reading', SHELF_MOTION_TIMING)).toEqual({
      eraseDelayMs: 0,
      writeDelayMs: SHELF_MOTION_TIMING.focusMs
        + SHELF_MOTION_TIMING.eraseMs
        + SHELF_MOTION_TIMING.settleMs
        + SHELF_MOTION_TIMING.focusMs,
    })
  })

  test('treats initial library hydration as state restoration rather than a shelf change', () => {
    expect(shouldAnimateShelfChange(false, false)).toBe(false)
    expect(shouldAnimateShelfChange(false, true)).toBe(false)
    expect(shouldAnimateShelfChange(true, true)).toBe(true)
  })

  test('globally shortens motion without hiding final information or introducing decorative loops', async () => {
    const [motionCss, tokenCss] = await Promise.all([
      Bun.file(motionCssUrl).text(),
      Bun.file(tokenCssUrl).text(),
    ])

    expect(motionCss).toContain(":root[data-motion='reduced']")
    expect(motionCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(motionCss).toContain('animation-duration: 1ms !important')
    expect(motionCss).toContain('transition-duration: 1ms !important')
    expect(motionCss).not.toMatch(/display:\s*none/)
    expect(motionCss).not.toMatch(/visibility:\s*hidden/)
    expect(motionCss).not.toMatch(/\binfinite\b/)
    expect(motionCss).toContain("[data-shelf-motion='erase']::after")
    expect(motionCss).toContain("[data-shelf-motion='write']::after")
    expect(motionCss).toContain('@keyframes motion-shelf-erase')
    expect(motionCss).toContain('@keyframes motion-shelf-write')
    expect(motionCss).not.toContain('motion-shelf-eraser')
    expect(motionCss).not.toContain('motion-shelf-pencil')

    for (const token of [
      '--motion-duration-feedback',
      '--motion-duration-progress',
      '--motion-duration-reveal',
      '--motion-duration-move',
      '--motion-duration-shelf-ink',
      '--motion-duration-navigate',
      '--motion-duration-complete',
      '--motion-ease-enter',
      '--motion-ease-exit',
      '--motion-ease-move',
    ]) {
      expect(tokenCss).toContain(`${token}:`)
    }
  })

  test('keeps implemented transforms compositable and state available from the first frame', async () => {
    const css = await Bun.file(motionCssUrl).text()

    expect(css).not.toMatch(/@keyframes[\s\S]*?(?:width|height|top|right|bottom|left|background):/)
    expect(MOTION_GRAMMAR.reveal.interruption).toContain('interactive on the first frame')
    expect(MOTION_GRAMMAR.complete.interruption).toContain('work immediately')
  })
})
