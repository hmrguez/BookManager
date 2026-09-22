import { expect, test, type Page } from '@playwright/test'

async function seedBook(page: Page, shelf: 'tbr' | 'reading', enabled = true) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My Books', exact: true })).toBeVisible()
  await page.evaluate(async ({ shelf, enabled }) => {
    const modulePath = '/src/storage/runtime.ts'
    const runtime = await (await import(/* @vite-ignore */ modulePath)).getStorageRuntime()
    const at = new Date().toISOString()
    await runtime.library.save({ id: 'book:detail-libby', title: 'The library book', authors: ['A. Reader'], shelf,
      progress: 2, currentPage: 4, pageCount: 200, rating: 3, notes: 'Keep my note', addedAt: at, lastUpdatedAt: at })
    if (enabled) {
      await runtime.libby.configure(true, true, true)
      await runtime.libby.ingest(JSON.stringify({ kind: 'wovenleaf-libby', version: 1, id: crypto.randomUUID(), capturedAt: at,
        observations: [{ titleId: '123', format: 'audiobook', title: 'The library book', author: 'A. Reader', percent: 15 }] }))
    }
  }, { shelf, enabled })
  await page.reload()
  await page.getByRole('button', { name: /The library book/ }).first().click()
  await expect(page.getByRole('dialog', { name: 'Book details', exact: true })).toBeVisible()
}

const stored = (page: Page) => page.evaluate(async () => {
  const modulePath = '/src/storage/runtime.ts'
  const runtime = await (await import(/* @vite-ignore */ modulePath)).getStorageRuntime()
  return { books: await runtime.library.list(), libby: await runtime.libby.read() }
})

for (const shelf of ['tbr', 'reading'] as const) {
  test(`link a captured loan from the existing ${shelf} book's details`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await seedBook(page, shelf)
    await page.getByLabel('Attach to').selectOption('libby')
    const card = page.locator('.libby-book-link')
    await expect(card).not.toHaveAttribute('open')
    await card.locator('summary').focus()
    await page.keyboard.press('Enter')
    await expect(card).toHaveAttribute('open', '')
    const picker = card.getByLabel('Book in Libby')
    await expect(picker).toHaveValue('')
    await picker.selectOption({ index: 1 })
    await expect(card).toContainText('Wovenleaf 2% → Libby 15%')
    if (shelf === 'tbr') await expect(card).toContainText('from To Be Read to Reading')
    await card.screenshot({ path: testInfo.outputPath('book-libby-review.png') })
    await card.getByRole('button', { name: shelf === 'tbr' ? 'Move to Reading & link' : 'Link & apply progress', exact: true }).click()
    await expect(card.locator('summary')).toContainText('Linked to Libby')
    await expect.poll(() => stored(page)).toMatchObject({ books: [{ id: 'book:detail-libby', shelf: 'reading', progress: 15, notes: 'Keep my note', currentPage: 4, rating: 3 }], libby: { mappings: [{ bookId: 'book:detail-libby', key: 'audiobook:123' }] } })
    expect((await stored(page)).books).toHaveLength(1)
    await card.screenshot({ path: testInfo.outputPath('book-libby-linked.png') })
    // The shared repository's Undo remains reachable from this entry point.
    await card.locator('summary').click()
    await card.getByRole('button', { name: 'Libby settings', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Book details', exact: true })).toHaveCount(0)
    const settings = page.locator('details.libby-settings')
    await expect(settings).toHaveAttribute('open', '')
    await expect(settings.locator(':scope > summary')).toBeInViewport()
    await settings.getByText('Recent updates', { exact: true }).click()
    await settings.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect.poll(() => stored(page)).toMatchObject({ books: [{ shelf, progress: 2 }], libby: { mappings: [{ paused: true }] } })
    await page.getByRole('button', { name: 'My Books', exact: true }).click()
    await page.getByRole('button', { name: /The library book/ }).first().click()
    await card.locator('summary').click()
    await expect(card).toContainText('Review to resume progress updates')
    await card.getByRole('button', { name: 'Unlink from Libby' }).click()
    await page.getByLabel('Attach to').selectOption('libby')
    await card.locator('summary').click()
    await expect(card.locator('summary')).toContainText('Link to Libby')
    expect((await stored(page)).libby.mappings).toHaveLength(0)
    expect((await stored(page)).books).toHaveLength(1)
    await expect(card).toContainText('No unlinked loans are ready yet')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

test('book details directs an unconfigured reader to the expanded Libby setup panel', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await seedBook(page, 'tbr', false)
  await page.getByLabel('Attach to').selectOption('libby')
  const card = page.locator('.libby-book-link')
  await card.locator('summary').click()
  await card.getByRole('button', { name: 'Set up Libby' }).click()
  const settings = page.locator('details.libby-settings')
  await expect(settings).toHaveAttribute('open', '')
  await expect(settings.locator(':scope > summary')).toBeInViewport()
  await expect(settings.getByRole('button', { name: 'Enable Libby progress' })).toBeVisible()
  // Following the setup link alone must not grant automatic tracking consent.
  expect((await stored(page)).libby.enabled).toBe(false)
})
