import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

// Keep the historical fixture's admission window stable as real dates advance.
test.beforeEach(async ({ page }) => { await page.clock.setFixedTime(new Date('2026-09-28T12:00:00.000Z')) })

test('all eight production pathways fit four themes and recover from missing artwork', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 740 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Reviews', exact: true }).waitFor()
  await page.evaluate(async () => {
    const r = await (await import('/src/storage/runtime.ts')).getStorageRuntime()
    const { reviewArtwork } = await import('/src/reviews/presentation.ts')
    const period = { year: 2026, quarter: 2 }
    await r.reviewKeepsakes.open(period, reviewArtwork)
    await r.reviewKeepsakes.setIdentity(period, { status: 'chosen', genre: 'fantasy' })
    await r.reviewKeepsakes.complete(period)
  })
  await page.getByRole('button', { name: 'Reviews', exact: true }).click()
  await page.getByRole('button', { name: /April–June 2026.*View keepsake/ }).click()
  await page.getByRole('button', { name: 'Pathway details' }).click()
  await page.getByRole('button', { name: 'Choose another pathway' }).click()
  await expect(page.locator('.review-choices img')).toHaveCount(8)
  for (const mode of ['warm', 'cool', 'print', 'night']) {
    await page.evaluate(mode => {
      document.documentElement.dataset.paperMode = mode
      document.documentElement.dataset.typeScale = 'x-large'
    }, mode)
    for (const artwork of await page.locator('.review-choices .review-artwork').all()) {
      await expect(artwork.locator('img')).toHaveJSProperty('naturalWidth', 320)
      await expect(artwork.locator('.review-ink')).toHaveCSS('background-color', await artwork.evaluate(el => getComputedStyle(el).color))
      const box = await artwork.boundingBox()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(320)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`eight-pathways-${mode}.png`), fullPage: true })
  }
  await page.route('**/reviews/vector-v2/08-horror-artwork.svg', route => route.fulfill({ status: 404, body: 'missing' }))
  await page.getByRole('button', { name: 'The Night Reader Horror', exact: true }).click()
  await expect(page.getByText('Illustration unavailable. Your pathway is saved.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'The Night Reader', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await page.unroute('**/reviews/vector-v2/08-horror-artwork.svg')
  await page.getByRole('button', { name: /April–June 2026.*View keepsake/ }).click()
  await expect(page.getByRole('dialog').locator('.review-artwork img')).toHaveJSProperty('naturalWidth', 320)
})

test('offline backup restore retains corrected keepsake and produces the same private-safe image after restart', async ({ page }, info) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Reviews', exact: true }).waitFor()
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.abort())
  const before = await page.evaluate(async () => {
    const r = await (await import('/src/storage/runtime.ts')).getStorageRuntime()
    const { reviewArtwork } = await import('/src/reviews/presentation.ts')
    const book = { id: 'release-fixture', title: 'PRIVATE RELEASE BOOK', authors: ['PRIVATE AUTHOR'], notes: 'PRIVATE NOTE', rating: 5,
      shelf: 'tbr' as const, progress: 0, currentPage: 0, pageCount: 680, addedAt: '2026-04-01T00:00:00.000Z', lastUpdatedAt: '2026-04-01T00:00:00.000Z' }
    await r.library.save(book)
    await r.library.saveManual(book, { ...book, shelf: 'finished', progress: 100, finishedAt: '2026-05-01T12:00:00.000Z' }, { id: 'release-finish' })
    const period = { year: 2026, quarter: 2 }
    await r.reviewKeepsakes.open(period, reviewArtwork)
    await r.reviewKeepsakes.setIdentity(period, { status: 'chosen', genre: 'fantasy' })
    await r.reviewKeepsakes.complete(period)
    const current = (await r.library.list()).find(b => b.id === book.id)!
    await r.library.saveManual(current, { ...current, pageCount: 200, metadataLocks: ['pageCount'] }, { id: 'release-pages' })
    const candidate = await r.reviewKeepsakes.previewUpdate(period)
    if (!candidate) throw new Error('Expected corrected page facts')
    await r.reviewKeepsakes.applyUpdate(period, candidate.token)
    return r.reviewKeepsakes.get(period)
  })
  await page.getByRole('button', { name: 'Reviews', exact: true }).click()
  await page.getByRole('button', { name: /April–June 2026.*View keepsake/ }).click()
  await page.getByRole('button', { name: 'Make an image' }).click()
  await expect(page.getByRole('button', { name: 'Save image', exact: true })).toBeEnabled()
  const preview = await page.locator('.snapshot-image img').getAttribute('src')
  await page.evaluate(async () => {
    const r = await (await import('/src/storage/runtime.ts')).getStorageRuntime()
    const archive = await r.portableArchives.create()
    await r.reviewKeepsakes.delete({ year: 2026, quarter: 2 })
    await r.recovery.restore(archive.archive, { allowStale: true })
  })
  await page.reload()
  await page.getByRole('button', { name: 'Reviews', exact: true }).click()
  await page.getByRole('button', { name: /April–June 2026.*View keepsake/ }).click()
  const after = await page.evaluate(async () => (await (await import('/src/storage/runtime.ts')).getStorageRuntime()).reviewKeepsakes.get({ year: 2026, quarter: 2 }))
  expect(after).toEqual(before)
  await page.getByRole('button', { name: 'Make an image' }).click()
  await expect(page.getByRole('button', { name: 'Save image', exact: true })).toBeEnabled()
  expect(await page.locator('.snapshot-image img').getAttribute('src')).toBe(preview)
  await page.getByText('Read image text', { exact: true }).click()
  await expect(page.locator('.snapshot-equivalent')).not.toContainText('PRIVATE')
  await expect(page.locator('.snapshot-equivalent')).toContainText('200 pages')
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save image', exact: true }).click()])
  const output = info.outputPath('restored-post.png')
  await download.saveAs(output)
  expect((await readFile(output)).toString('base64')).toBe(preview!.split(',')[1])
})
