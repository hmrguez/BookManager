import { describe, expect, test } from 'bun:test'

const tokenCssUrl = new URL('../src/design-system/tokens.css', import.meta.url)
const productStyleUrls = [
  new URL('../src/index.css', import.meta.url),
  new URL('../src/design-system/motion.css', import.meta.url),
  new URL('../src/tailwind/custom.css', import.meta.url),
  new URL('../src/tailwind/motion.ts', import.meta.url),
  new URL('../src/tailwind/styles.ts', import.meta.url),
]

const themeSelectors = {
  warm: ':root',
  cool: ":root[data-paper-mode='cool']",
  print: ":root[data-paper-mode='print']",
  night: ":root[data-paper-mode='night']",
} as const

const requiredTokens = [
  '--surface-page',
  '--surface-raised',
  '--surface-sunken',
  '--surface-inverse',
  '--surface-scrim',
  '--text-primary',
  '--text-secondary',
  '--text-tertiary',
  '--text-on-inverse',
  '--text-accent',
  '--text-destructive',
  '--border-subtle',
  '--border-strong',
  '--edge-cover',
  '--edge-highlight',
  '--edge-shadow',
  '--depth-resting',
  '--depth-floating',
  '--depth-modal',
  '--focus-ring',
  '--selection-background',
  '--selection-text',
  '--state-selected-surface',
  '--state-selected-text',
  '--state-destructive-surface',
  '--state-destructive-text',
  '--texture-fibers',
  '--texture-opacity',
] as const

function selectorBlock(css: string, selector: string) {
  const marker = `${selector} {`
  const start = css.indexOf(marker)
  if (start < 0) throw new Error(`Missing selector: ${selector}`)

  const openingBrace = css.indexOf('{', start)
  let depth = 0
  for (let index = openingBrace; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    if (css[index] === '}') depth -= 1
    if (depth === 0) return css.slice(openingBrace + 1, index)
  }

  throw new Error(`Unclosed selector: ${selector}`)
}

function hexTokens(block: string) {
  return Object.fromEntries(
    [...block.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)]
      .map(([, name, value]) => [name, value.toLowerCase()]),
  )
}

function channelToLinear(value: number) {
  const channel = value / 255
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string) {
  const [red, green, blue] = hex.match(/[0-9a-f]{2}/gi)?.map((value) => Number.parseInt(value, 16)) ?? []
  return 0.2126 * channelToLinear(red) + 0.7152 * channelToLinear(green) + 0.0722 * channelToLinear(blue)
}

function contrast(foreground: string, background: string) {
  const foregroundLuminance = luminance(foreground)
  const backgroundLuminance = luminance(background)
  const lighter = Math.max(foregroundLuminance, backgroundLuminance)
  const darker = Math.min(foregroundLuminance, backgroundLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

describe('Pulp design-token contract', () => {
  test('defines the complete semantic surface contract and fallback modes', async () => {
    const css = await Bun.file(tokenCssUrl).text()
    const root = selectorBlock(css, ':root')

    requiredTokens.forEach((token) => expect(root).toContain(`${token}:`))
    expect(css).toContain('@media (prefers-contrast: more)')
    expect(css).toContain('@media (prefers-reduced-transparency: reduce)')
    expect(css).toContain('@media (forced-colors: active)')
    expect(css).toContain('@media print')
  })

  test('keeps raw brand colors inside the token layer', async () => {
    const productStyles = (await Promise.all(productStyleUrls.map((url) => Bun.file(url).text()))).join('\n')

    expect(productStyles).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(productStyles).not.toMatch(/\brgba?\(/i)
    expect(productStyles).not.toMatch(/var\(--(?:brand|stock)-/i)
  })

  test('holds every intended foreground/background pairing at WCAG AA', async () => {
    const css = await Bun.file(tokenCssUrl).text()
    const base = hexTokens(selectorBlock(css, ':root'))
    const highContrast = hexTokens(selectorBlock(css, ":root[data-contrast='high']"))
    const nightHighContrast = hexTokens(
      selectorBlock(css, ":root[data-paper-mode='night'][data-contrast='high']"),
    )

    const pairings = [
      ...(['--surface-page', '--surface-raised', '--surface-sunken'] as const).flatMap((surface) => [
        ['--text-primary', surface, 4.5],
        ['--text-secondary', surface, 4.5],
        ['--text-tertiary', surface, 4.5],
        ['--text-accent', surface, 4.5],
        ['--text-destructive', surface, 4.5],
      ] as const),
      ['--text-on-inverse', '--surface-inverse', 4.5],
      ['--selection-text', '--selection-background', 4.5],
      ['--state-selected-text', '--state-selected-surface', 4.5],
      ['--state-destructive-text', '--state-destructive-surface', 4.5],
      ['--focus-ring', '--surface-page', 3],
      ['--focus-ring', '--surface-raised', 3],
      ['--border-strong', '--surface-page', 3],
    ] as const

    for (const [theme, selector] of Object.entries(themeSelectors)) {
      const standard = {
        ...base,
        ...(theme === 'warm' ? {} : hexTokens(selectorBlock(css, selector))),
      }
      const variants = {
        standard,
        high: {
          ...standard,
          ...highContrast,
          ...(theme === 'night' ? nightHighContrast : {}),
        },
      }

      for (const [variant, tokens] of Object.entries(variants)) {
        for (const [foreground, background, minimum] of pairings) {
          const ratio = contrast(tokens[foreground], tokens[background])
          expect(
            ratio,
            `${theme}/${variant}: ${foreground} on ${background} is ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(minimum)
        }

        const subtleRule = contrast(tokens['--border-subtle'], tokens['--surface-page'])
        expect(
          subtleRule,
          `${theme}/${variant}: decorative rule disappeared at ${subtleRule.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(1.5)
      }
    }
  })

  test('stays inside the procedural texture budget', async () => {
    const css = await Bun.file(tokenCssUrl).text()
    const root = selectorBlock(css, ':root')
    const texture = root.slice(root.indexOf('--texture-fibers:'))

    expect(texture.match(/repeating-linear-gradient\(/g)).toHaveLength(2)
    expect(texture).not.toMatch(/url\(/)
    expect(css).toContain("data-texture='off'")
  })
})
