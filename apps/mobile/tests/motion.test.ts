import { describe, expect, test } from 'bun:test'
import {
  MOTION_FRAME_BUDGET,
  MOTION_GRAMMAR,
  motionScrollBehavior,
  shouldReduceMotion,
  type MotionFamily,
} from '../src/design-system'

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

    for (const token of [
      '--motion-duration-feedback',
      '--motion-duration-progress',
      '--motion-duration-reveal',
      '--motion-duration-move',
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
