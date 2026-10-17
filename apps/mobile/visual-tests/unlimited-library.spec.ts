import { expect, test, type Page } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

async function seedBooks(page: Page, count: number) {
  await page.goto('/')
  await page.evaluate(async (size) => {
    const modulePath = '/src/storage/runtime.ts'
    const { getStorageRuntime } = await import(/* @vite-ignore */ modulePath)
    const runtime = await getStorageRuntime()
    await runtime.library.replace(Array.from({ length: size }, (_, i) => ({
      id: `limit-${i}`, title: `Library book ${i}`, authors: ['A Reader'], pageCount: 100,
      shelf: 'tbr', progress: 0, currentPage: 0, rating: 0, notes: '',
      addedAt: '2026-09-08T12:00:00.000Z', lastUpdatedAt: '2026-09-08T12:00:00.000Z',
    })))
  }, count)
  await page.reload()
  await expect(page.getByRole('button', { name: `TBR ${count}`, exact: true })).toBeVisible()
}

async function enterBook(page: Page, title: string) {
  await page.getByRole('button', { name: 'Add Book', exact: true }).click()
  await page.getByRole('button', { name: /No ISBN\? No problem/ }).click()
  await page.getByRole('textbox', { name: 'Book title', exact: true }).fill(title)
  await page.getByRole('button', { name: /^Add to\s*To Be Read$/ }).click()
}

test('manual additions beyond 30 persist without a purchase or reviewer token', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await seedBooks(page, 30)
  await enterBook(page, 'The thirty-first book')
  await expect(page.getByRole('dialog', { name: 'Add a book manually' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'TBR 31', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'TBR 31', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Wovenleaf Unlimited', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Upgrade or restore purchase', exact: true })).toHaveCount(0)
  await expect(page.getByText('Review access', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('free-settings-mobile.png') })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(errors).toEqual([])
})
