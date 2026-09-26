import { expect, test } from '@playwright/test'

test('manual finish, date correction, reread and unfinish persist through the real app', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    if (localStorage.getItem('manual-reading-seeded')) return
    localStorage.setItem('wovenleaf.library.v1', JSON.stringify([{
      id: 'manual-browser', title: 'A reader’s book', authors: ['Someone'], shelf: 'reading',
      pageCount: 100, currentPage: 42, progress: 42, rating: 0, notes: '',
      addedAt: '2026-03-01T12:00:00.000Z', startedAt: '2026-03-10T12:00:00.000Z', lastUpdatedAt: '2026-03-10T12:00:00.000Z',
    }]))
    localStorage.setItem('manual-reading-seeded', 'true')
  })
  await page.goto('/')
  const evidence = async () => page.evaluate(async () => {
    // Read production repositories after all queued writes, not an alternate test persistence path.
    const { getStorageRuntime } = await import('/src/storage/runtime.ts')
    const runtime = await getStorageRuntime()
    return { books: await runtime.library.list(), catalog: await runtime.catalog.read() }
  })
  await page.locator('#shelf-reading').getByRole('button', { name: 'Finish', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Finished', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await expect.poll(async () => (await evidence()).catalog.readingEvents.filter((event) => event.kind === 'finish' && event.source.kind === 'local').length).toBe(1)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(async () => (await evidence()).books[0]?.shelf).toBe('reading')
  await page.locator('#shelf-reading').getByRole('button', { name: 'Finish', exact: true }).click()
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await expect.poll(async () => (await evidence()).books[0]?.shelf).toBe('finished')
  await page.reload()
  await page.locator('.book-identity').filter({ hasText: 'A reader’s book' }).click()
  await page.getByRole('button', { name: 'Change finish date' }).click()
  await page.getByLabel('Finish date', { exact: true }).fill('2026-03-31')
  await page.evaluate(() => { document.documentElement.dataset.typeScale = 'x-large' })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('finish-date-large-text.png') })
  await page.getByRole('button', { name: 'Save finish date' }).click()
  await expect.poll(async () => (await evidence()).books[0]?.finishedAt).toBe('2026-03-31T12:00:00.000Z')
  await page.screenshot({ path: testInfo.outputPath('reading-history-mobile.png') })
  await page.getByRole('button', { name: 'Read again', exact: true }).click()
  await expect.poll(async () => (await evidence()).books[0]?.shelf).toBe('reading')
  await page.getByRole('button', { name: 'Mark finished', exact: true }).click()
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await expect.poll(async () => (await evidence()).catalog.readingEvents.filter((event) => event.kind === 'finish' && event.source.kind === 'local').length).toBe(3)
  await page.reload()
  await page.locator('.book-identity').filter({ hasText: 'A reader’s book' }).click()
  await page.getByRole('button', { name: 'Reading', exact: true }).click()
  await expect.poll(async () => (await evidence()).books[0]?.shelf).toBe('reading')
  const final = await evidence()
  expect(final.catalog.readingEvents.some((event) => event.kind === 'correction' && event.reason === 'Reader undid completion')).toBe(true)
  expect(final.catalog.progressSnapshots.every((snapshot) => snapshot.status === 'reading')).toBe(true)
  expect(errors).toEqual([])
})
