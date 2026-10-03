import { expect, test } from '@playwright/test'

const timestamp = '2026-09-01T10:00:00.000Z'
const books = Array.from({ length: 89 }, (_, index) => ({
  id: `scroll-${index}`, title: `Volume ${String(index).padStart(3, '0')}`, authors: ['Library Author'],
  shelf: index < 45 ? 'tbr' : 'finished', pageCount: 300, currentPage: 0, progress: 0,
  rating: 3, notes: '', addedAt: timestamp, lastUpdatedAt: timestamp,
}))

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript((seed) => {
    if (localStorage.getItem('scroll-test-seeded')) return
    localStorage.setItem('wovenleaf.library.v1', JSON.stringify(seed))
    for (const shelf of ['tbr', 'finished']) {
      localStorage.setItem(`wovenleaf.shelf-collapsed.v1.status:${shelf}`, 'false')
    }
    localStorage.setItem('scroll-test-seeded', 'true')
  }, books)
  await page.goto('/')
  await expect(page.locator('#shelf-tbr [data-library-book="scroll-0"]')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
})

for (const { view, motion } of [
  { view: 'List', motion: 'reduce' }, { view: 'Grid', motion: 'reduce' },
  { view: 'List', motion: 'no-preference' }, { view: 'Grid', motion: 'no-preference' },
] as const) {
  test(`${view} shelves keep upward scrolling stable with 89 books (${motion})`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
    await page.emulateMedia({ reducedMotion: motion })
    await page.getByRole('button', { name: `${view} view`, exact: true }).click()
    await expect(page.locator('[data-virtual-book-list]')).toHaveCount(2)
    const samples = await page.evaluate(async () => {
      const frames = async (count: number) => {
        for (let index = 0; index < count; index++) await new Promise(requestAnimationFrame)
      }
      await frames(8)
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' })
      await frames(8)
      const samples: { requested: number; actual: number; mounted: number }[] = []
      for (let index = 0; index < 60; index++) {
        const requested = Math.max(0, window.scrollY - 120)
        window.scrollTo({ top: requested, behavior: 'instant' })
        await frames(3)
        samples.push({ requested, actual: window.scrollY, mounted: document.querySelectorAll('[data-library-book]').length })
        if (requested === 0) break
      }
      return samples
    })
    expect(Math.max(...samples.map(({ requested, actual }) => Math.abs(actual - requested)))).toBeLessThanOrEqual(1)
    expect(Math.max(...samples.map(({ mounted }) => mounted))).toBeLessThan(89)
    await expect(page.locator('#shelf-tbr [data-library-book="scroll-0"]')).toBeInViewport()
    expect(errors).toEqual([])
  })
}
