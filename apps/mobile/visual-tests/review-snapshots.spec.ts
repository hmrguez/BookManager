import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

async function setup(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Reviews', exact: true }).waitFor()
  await page.evaluate(async () => {
    const runtime = await (await import('/src/storage/runtime.ts')).getStorageRuntime()
    for (let i = 0; i < 6; i++) {
      const book = { id: `snapshot-book-${i}`, title: `PRIVATE BOOK ${i}`, authors: [`PRIVATE AUTHOR ${i}`], pageCount: 380, rating: 5, notes: 'PRIVATE NOTE',
        shelf: 'tbr' as const, progress: 0, currentPage: 0, addedAt: '2026-04-01T00:00:00.000Z', lastUpdatedAt: '2026-04-01T00:00:00.000Z' }
      await runtime.library.save(book)
      await runtime.library.saveManual(book, { ...book, shelf: 'finished', progress: 100, finishedAt: '2026-05-01T12:00:00.000Z' }, { id: `snapshot-finish-${i}` })
    }
    const period = { year: 2026, quarter: 2 }
    const { reviewArtwork } = await import('/src/reviews/presentation.ts')
    await runtime.reviewKeepsakes.open(period, reviewArtwork)
    await runtime.reviewKeepsakes.setIdentity(period, { status: 'chosen', genre: 'fantasy' })
    await runtime.reviewKeepsakes.complete(period)
  })
  await page.getByRole('button', { name: 'Reviews', exact: true }).click()
  await page.getByRole('button', { name: /April–June 2026.*View keepsake/ }).click()
  await page.getByRole('button', { name: 'Make an image' }).click()
  await expect(page.getByRole('button', { name: 'Save image', exact: true })).toBeEnabled()
}
async function saved(page: Page) {
  return page.evaluate(async () => (await (await import('/src/storage/runtime.ts')).getStorageRuntime()).reviewKeepsakes.get({ year: 2026, quarter: 2 }))
}

test('selection 0–4, identity-only, badge-only and empty; choices never change the keepsake', async ({ page }) => {
  await setup(page)
  const before = await saved(page)
  const badges = page.locator('.snapshot-options fieldset input')
  expect(await badges.count()).toBeGreaterThan(3)
  await expect(page.locator('.snapshot-options fieldset input:checked')).toHaveCount(Math.min(3, before!.facts.featuredIds.length))
  while (await page.locator('.snapshot-options fieldset input:checked').count() < 3) await page.locator('.snapshot-options fieldset input:not(:checked)').first().check()
  await expect(page.locator('.snapshot-options fieldset input:not(:checked)').first()).toBeDisabled()
  for (const checkbox of await badges.all()) if (await checkbox.isChecked()) await checkbox.uncheck()
  await expect(page.getByRole('button', { name: 'Save image', exact: true })).toBeEnabled()
  await page.getByLabel('Include chosen pathway').uncheck()
  await expect(page.getByRole('button', { name: 'Save image', exact: true })).toBeDisabled()
  for (let i = 0; i < 3; i++) {
    await badges.nth(i).check()
    await expect(page.getByRole('button', { name: 'Save image', exact: true })).toBeEnabled()
  }
  expect(await saved(page)).toEqual(before)
})

test('exact exported PNG bytes match preview, both pixel sizes and large-text controls', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await setup(page)
  for (const format of ['post', 'story']) {
    await page.getByLabel('Image format').selectOption(format)
    await expect(page.getByRole('button', { name: 'Save image', exact: true })).toBeEnabled()
    const url = await page.locator('.snapshot-image img').getAttribute('src')
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save image', exact: true }).click()])
    const destination = info.outputPath(`${format}.png`); await download.saveAs(destination)
    const bytes = await readFile(destination)
    expect(bytes.toString('base64')).toBe(url!.split(',')[1])
    expect(bytes.readUInt32BE(16)).toBe(1080)
    expect(bytes.readUInt32BE(20)).toBe(format === 'post' ? 1080 : 1920)
    await expect(page.locator('.review-snapshot [role=status]')).toContainText('Download requested')
  }
  await page.getByRole('button', { name: 'Enlarge image preview' }).click()
  await expect(page.getByRole('region', { name: 'Enlarged image, scroll to explore' })).toBeVisible()
  await page.getByRole('button', { name: 'Reduce image preview' }).click()
  await page.getByText('Read image text', { exact: true }).click()
  await expect(page.locator('.snapshot-equivalent')).not.toContainText('PRIVATE')
  await page.setViewportSize({ width: 320, height: 740 })
  await page.evaluate(() => { document.documentElement.dataset.typeScale = 'x-large' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('large-text.png'), fullPage: true })
})

test('complete English fallback preserves saved quarter and qualifiers', async ({ page }) => {
  await setup(page)
  await page.evaluate(() => { document.documentElement.lang = 'es' })
  await page.getByLabel('Image format').selectOption('story')
  await expect(page.getByText(/This image is in English/)).toBeVisible()
  await page.getByText('Read image text', { exact: true }).click()
  await expect(page.locator('.snapshot-equivalent')).toContainText('April–June 2026')
  const text = await page.evaluate(async () => {
    const { snapshotContent, snapshotDefaults } = await import('/src/reviews/snapshot.ts')
    const runtime = await (await import('/src/storage/runtime.ts')).getStorageRuntime()
    const review = (await runtime.reviewKeepsakes.get({ year: 2026, quarter: 2 }))!
    return snapshotContent(review, { ...snapshotDefaults(review), badgeIds: ['02'] }, 'es-ES')
  })
  expect(text.badges[0].caption).toBe('2,280 pages across the books you finished')
  expect(JSON.stringify(text)).not.toContain('PRIVATE')
  const legacy = await page.evaluate(async () => {
    const { snapshotContent, snapshotDefaults } = await import('/src/reviews/snapshot.ts')
    const review = (await (await (await import('/src/storage/runtime.ts')).getStorageRuntime()).reviewKeepsakes.get({ year: 2026, quarter: 2 }))!
    review.artwork.pathways.fantasy.version = 'approved-concept-preview-v1'
    review.artwork.pathways.fantasy.finishedStill = '/reviews/concepts/01-fantasy-artwork.png'
    return snapshotContent(review, snapshotDefaults(review)).artwork
  })
  expect(legacy).toBe('/reviews/ink-v1/01-fantasy-artwork.png')
  await page.getByLabel('Image language').selectOption('en')
  await expect(page.getByText(/This image is in English/)).toHaveCount(0)
})

test('stale identity requires refresh and deletion closes preview', async ({ page }) => {
  await setup(page)
  await page.evaluate(async () => {
    const runtime = await (await import('/src/storage/runtime.ts')).getStorageRuntime()
    await runtime.reviewKeepsakes.setIdentity({ year: 2026, quarter: 2 }, { status: 'chosen', genre: 'history' })
  })
  await expect(page.getByRole('button', { name: 'Refresh preview' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save image', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Refresh preview' }).click()
  await expect(page.getByRole('button', { name: 'Save image', exact: true })).toBeEnabled()
  await page.getByText('Read image text', { exact: true }).click()
  await expect(page.locator('.snapshot-equivalent')).toContainText('The Timekeeper')
  await page.evaluate(async () => {
    const runtime = await (await import('/src/storage/runtime.ts')).getStorageRuntime()
    await runtime.reviewKeepsakes.delete({ year: 2026, quarter: 2 })
  })
  await expect(page.getByRole('region', { name: 'Keepsake image preview' })).toHaveCount(0)
})

test('corrupt artwork requires explicit badge-only fallback and can be retried', async ({ page }) => {
  await setup(page)
  await page.route('**/reviews/ink-v1/01-fantasy-artwork.png', route => route.fulfill({ contentType: 'image/png', body: 'corrupt' }))
  await page.getByLabel('Image format').selectOption('story')
  await expect(page.getByRole('button', { name: 'Use badge-only image' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save image', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Use badge-only image' }).click()
  await expect(page.getByRole('button', { name: 'Save image', exact: true })).toBeEnabled()
  expect((await saved(page))!.identity).toEqual({ status: 'chosen', genre: 'fantasy' })
})

test('cancel and failed sharing retain preview and selections, never report saved', async ({ page }) => {
  await setup(page)
  const before = await page.locator('.snapshot-image img').getAttribute('src')
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true })
    Object.defineProperty(navigator, 'share', { configurable: true, value: () => Promise.reject(new DOMException('Cancelled', 'AbortError')) })
  })
  await page.getByRole('button', { name: 'Share image', exact: true }).click()
  await expect(page.locator('.review-snapshot [role=status]')).toContainText('Cancelled')
  await page.evaluate(() => { Object.defineProperty(navigator, 'share', { configurable: true, value: () => Promise.reject(new Error('denied')) }) })
  await page.getByRole('button', { name: 'Share image', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('could not be exported')
  expect(await page.locator('.snapshot-image img').getAttribute('src')).toBe(before)
  await expect(page.getByText('Image saved.', { exact: true })).toHaveCount(0)
})

test('long copy wraps or blocks with a roomier composition', async ({ page }) => {
  await setup(page)
  const result = await page.evaluate(async () => {
    const { renderSnapshot } = await import('/src/reviews/snapshot-render.tsx')
    const { snapshotContent, snapshotDefaults } = await import('/src/reviews/snapshot.ts')
    const runtime = await (await import('/src/storage/runtime.ts')).getStorageRuntime()
    const review = (await runtime.reviewKeepsakes.get({ year: 2026, quarter: 2 }))!
    const content = snapshotContent(review, snapshotDefaults(review))
    content.badges.forEach(b => { b.title += ' A season of extraordinary stories'; b.caption += ' These figures describe the saved records for this quarter.' })
    let square = 'rendered'
    try { await renderSnapshot(content) } catch (error) { square = (error as { reason: string }).reason }
    const story = await renderSnapshot({ ...content, height: 1920 })
    let overflow = ''
    try { await renderSnapshot({ ...content, title: 'UnbrokenVeryLongTitle'.repeat(200) }) } catch (error) { overflow = (error as { reason: string }).reason }
    return { square, story: story.startsWith('data:image/png;'), overflow }
  })
  expect(['rendered', 'overflow']).toContain(result.square)
  expect(result.story).toBe(true); expect(result.overflow).toBe('overflow')
})

test('explicit facts update removes unsupported selections and requires another reviewed preview', async ({ page }) => {
  await setup(page)
  await page.evaluate(async () => {
    const runtime = await (await import('/src/storage/runtime.ts')).getStorageRuntime()
    const books = await runtime.library.list()
    for (const book of books.filter(b => b.id.startsWith('snapshot-book-'))) {
      await runtime.library.saveManual(book, { ...book, shelf: 'tbr', progress: 0, finishedAt: undefined }, { id: `snapshot-unfinish-${book.id}` })
    }
    const period = { year: 2026, quarter: 2 }
    const candidate = await runtime.reviewKeepsakes.previewUpdate(period)
    if (!candidate) throw new Error('Expected changed facts')
    await runtime.reviewKeepsakes.applyUpdate(period, candidate.token)
  })
  // Even before the polling interval, the export action reads current persisted facts.
  await page.getByRole('button', { name: 'Save image', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Refresh preview' })).toBeVisible()
  await page.getByRole('button', { name: 'Refresh preview' }).click()
  await expect(page.locator('.snapshot-options fieldset input:checked')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Save image', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Back to keepsake' }).click()
  await expect(page.getByRole('heading', { name: 'The Worldwanderer', exact: true })).toBeVisible()
})

test('render/storage failure disables export and retry regenerates the current selection only', async ({ page }) => {
  await setup(page)
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toDataURL
    HTMLCanvasElement.prototype.toDataURL = function () {
      HTMLCanvasElement.prototype.toDataURL = original
      throw new DOMException('Test storage failure', 'QuotaExceededError')
    }
  })
  await page.getByLabel('Image format').selectOption('story')
  await expect(page.getByRole('button', { name: 'Retry rendering' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save image', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Retry rendering' }).click()
  await expect(page.getByRole('button', { name: 'Save image', exact: true })).toBeEnabled()
  const dimensions = await page.locator('.snapshot-image img').evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])
  expect(dimensions).toEqual([1080, 1920])
})
