import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

const titles = [
  'The Creative Act', 'The Mountain Is You', 'My Year of Rest and Relaxation', 'The Midnight Library',
  'A Field Guide to Getting Lost', 'The Left Hand of Darkness', 'A Very Long Book Title That Wraps Gracefully',
  'Piranesi', 'The Dispossessed', 'Small Things Like These', 'A Room of One’s Own', 'The Waves',
]
const authors = ['Rick Rubin', 'Brianna Wiest', 'Ottessa Moshfegh', 'Matt Haig', 'Rebecca Solnit', 'Ursula K. Le Guin']
const covers = [1, 2, 3, 4].map((number) => `data:image/jpeg;base64,${readFileSync(new URL(`../tests/fixtures/original-cover-${number}.jpg`, import.meta.url)).toString('base64')}`)
const books = titles.map((title, index) => ({
  id: `grid-test-${index}`, title, authors: [authors[index % authors.length]],
  thumbnail: index === 6 ? 'data:image/png;base64,broken' : covers[index % covers.length],
  pageCount: 300, currentPage: index === 10 ? 126 : index === 11 ? 300 : 0,
  progress: index === 10 ? 42 : index === 11 ? 100 : 0,
  rating: index === 11 ? 4 : 0, notes: '',
  shelf: index < 7 ? 'tbr' : index < 10 ? 'next' : index === 10 ? 'reading' : 'finished',
  addedAt: '2026-09-01T10:00:00.000Z', lastUpdatedAt: '2026-09-01T10:00:00.000Z',
}))

test.beforeEach(async ({ page }) => {
  await page.addInitScript((seed) => {
    if (!localStorage.getItem('grid-test-seeded')) {
      localStorage.setItem('wovenleaf.library.v1', JSON.stringify(seed))
      localStorage.setItem('grid-test-seeded', 'true')
    }
  }, books)
  await page.goto('/')
  await expect(page.locator('#shelf-tbr .book-row')).toHaveCount(7)
  await page.getByRole('button', { name: 'Grid view', exact: true }).click()
})

const book = (page: Page, id: number) => page.locator(`[data-library-book="grid-test-${id}"]`).first()

test('cover view wraps, stays accessible, and remembers its selection', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await expect(page.getByRole('button', { name: 'Grid view', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('#shelf-tbr .row-action')).toHaveCount(0)
  await expect(page.locator('#shelf-tbr .book-grid')).toHaveCSS('display', 'flex')
  await expect(page.locator('#shelf-tbr .book-grid')).toHaveCSS('flex-wrap', 'wrap')
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(() => document.fonts.ready)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const cover = await book(page, 0).locator('.book-cover').boundingBox()
    expect(cover!.width).toBeGreaterThan(70)
    expect(cover!.width).toBeLessThan(110)
    await page.screenshot({ path: testInfo.outputPath(`grid-${width}.png`) })
  }
  await page.locator('#shelf-reading').scrollIntoViewIfNeeded()
  await expect(book(page, 10)).toBeInViewport()
  await expect(book(page, 10).locator('.book-cover')).toHaveCSS('width', '96px')
  await page.screenshot({ path: testInfo.outputPath('grid-progress-and-rating.png') })
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }))
  await page.setViewportSize({ width: 320, height: 720 })
  await page.evaluate(() => {
    document.documentElement.dataset.typeScale = 'x-large'
    document.documentElement.dataset.paperMode = 'night'
    document.documentElement.dataset.contrast = 'high'
  })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(page.locator('body')).toHaveCSS('color', 'rgb(255, 253, 247)')
  await page.screenshot({ path: testInfo.outputPath('grid-night-large.png') })
  await page.reload()
  await expect(page.locator('#shelf-tbr .book-tile')).toHaveCount(7)
  await book(page, 0).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Book details', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Update progress', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(book(page, 0)).toBeFocused()
  await page.getByRole('button', { name: 'Search my library' }).click()
  await page.getByRole('searchbox', { name: 'Search your local library' }).fill('Creative')
  await expect(page.locator('.book-tile')).toHaveCount(1)
  await page.getByRole('button', { name: 'Close library search' }).click()
  await page.getByRole('button', { name: 'List view', exact: true }).click()
  await expect(page.locator('#shelf-tbr .row-action')).toHaveCount(7)
  expect(errors).toEqual([])
})

test('dragging moves books, accepts collapsed shelves, and preserves custom membership and queue order', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1600 })
  await page.locator('#shelf-reading .shelf-toggle').click()
  await book(page, 0).dragTo(page.locator('#shelf-reading .shelf-header'))
  await expect(page.locator('#shelf-reading [data-library-book="grid-test-0"]')).toBeVisible()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.locator('#shelf-tbr [data-library-book="grid-test-0"]')).toBeVisible()

  await book(page, 9).dragTo(book(page, 7))
  await expect(page.locator('#shelf-next [data-library-book]').first()).toHaveAttribute('data-library-book', 'grid-test-9')
  await book(page, 9).focus()
  await page.keyboard.press('Alt+ArrowRight')
  await expect(page.locator('#shelf-next [data-library-book]').nth(1)).toHaveAttribute('data-library-book', 'grid-test-9')
  await page.getByRole('button', { name: 'New shelf', exact: true }).click()
  await page.getByLabel('Shelf name').fill('Quiet weekends')
  await page.getByRole('checkbox', { name: /Pin this shelf/ }).check()
  await page.getByRole('button', { name: 'Create shelf', exact: true }).click()
  const custom = page.locator('.custom-shelf').filter({ hasText: 'Quiet weekends' })
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }))
  await book(page, 0).dragTo(page.getByRole('navigation', { name: 'Pinned custom shelves' }).getByRole('button', { name: /Quiet weekends/ }))
  await expect(custom.locator('[data-library-book="grid-test-0"]')).toBeVisible()
  await expect(page.locator('#shelf-tbr [data-library-book="grid-test-0"]')).toBeVisible()
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }))
  await book(page, 0).dragTo(page.getByRole('navigation', { name: 'Pinned custom shelves' }).getByRole('button', { name: /Quiet weekends/ }))
  await expect(custom.locator('[data-library-book]')).toHaveCount(1)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.reload()
  await expect(custom.locator('[data-library-book]')).toHaveCount(1)
  await expect(page.locator('#shelf-next [data-library-book]').nth(1)).toHaveAttribute('data-library-book', 'grid-test-9')
})

test('touch holds move covers while taps, scrolling, cancellation, and invalid drops stay safe', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const touch = await context.newCDPSession(page)
  const cover = (await book(page, 0).boundingBox())!
  const source = { x: cover.x + cover.width / 2, y: cover.y + 40 }
  const next = (await page.getByRole('navigation', { name: 'Jump to a shelf' }).getByRole('button', { name: /Next/ }).boundingBox())!
  const destination = { x: next.x + next.width / 2, y: next.y + next.height / 2 }
  const start = () => touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [source] })
  const move = (point: { x: number; y: number }) => touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point] })
  await start()
  await move({ x: source.x, y: source.y - 30 })
  await page.waitForTimeout(400)
  await expect(page.locator('.library-drag-preview')).toHaveCount(0)
  await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }))
  await start()
  await page.waitForTimeout(400)
  await expect(page.locator('.library-drag-preview')).toBeVisible()
  await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
  await expect(page.locator('.library-drag-preview')).toHaveCount(0)
  await start()
  await page.waitForTimeout(400)
  await move({ x: 2, y: 100 })
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(page.locator('#shelf-tbr [data-library-book]')).toHaveCount(7)
  await start()
  await page.waitForTimeout(400)
  await move(destination)
  await expect(page.locator('[data-drop-active]')).toHaveAttribute('data-library-drop', 'status:next')
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(page.locator('#shelf-next [data-library-book="grid-test-0"]')).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
