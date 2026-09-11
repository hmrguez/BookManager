import { expect, test, type Page } from '@playwright/test'
import { generateKeyPairSync } from 'node:crypto'
import { createReviewToken, publicKeyFor, verifyReviewToken } from '../scripts/review-access'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

async function reviewAdapter(page: Page) {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' },
  })
  const publicKey = publicKeyFor(privateKey)
  const token = createReviewToken(privateKey)
  await page.exposeFunction('verifyTestReviewToken', (candidate: string) => verifyReviewToken(candidate, publicKey))
  // Browser-only native adapter. Real native validators are exercised by review-access:test-native.
  await page.route(/\/src\/purchases\/review-runtime\.ts(?:\?.*)?$/, (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `import { ReviewAccessService } from '/src/purchases/review-access.ts';
      export const reviewAccessSupported = true;
      export const reviewAccess = new ReviewAccessService({
        getReviewAccess: async () => ({ active: await window.verifyTestReviewToken(localStorage.getItem('test.review-token') || '') }),
        activateReviewAccess: async ({token}) => {
          if (!await window.verifyTestReviewToken(token)) throw new Error('Invalid token');
          localStorage.setItem('test.review-token', token); return {active:true};
        },
        endReviewAccess: async () => { localStorage.removeItem('test.review-token'); return {active:false}; }
      });`,
  }))
  return token
}

async function openReviewAccess(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.locator('summary').filter({ hasText: 'Review access' }).click()
}

test('signed access activates, survives restart, enables book 21, and ends without losing books', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const token = await reviewAdapter(page)
  await page.goto('/')
  await page.evaluate(async () => {
    const modulePath = '/src/storage/runtime.ts'
    const { getStorageRuntime } = await import(/* @vite-ignore */ modulePath)
    const runtime = await getStorageRuntime()
    await runtime.library.replace(Array.from({ length: 20 }, (_, i) => ({
      id: `review-${i}`, title: `Review book ${i}`, authors: ['A Reader'], pageCount: 100,
      shelf: 'tbr', progress: 0, currentPage: 0, rating: 0, notes: '',
      addedAt: '2026-09-11T12:00:00.000Z', lastUpdatedAt: '2026-09-11T12:00:00.000Z',
    })))
  })
  await page.reload()
  await openReviewAccess(page)
  const activate = page.getByRole('button', { name: 'Activate review access', exact: true })
  await expect(activate).toBeDisabled()
  await page.getByRole('textbox', { name: 'Review token', exact: true }).fill('invalid')
  await activate.click()
  await expect(page.getByRole('alert')).toContainText('could not be activated')
  await page.getByRole('textbox', { name: 'Review token', exact: true }).fill(token)
  await page.screenshot({ path: info.outputPath('review-access-form.png') })
  await activate.click()
  await expect(page.locator('.review-access').getByRole('status')).toContainText('Review access is active')
  await expect(page.locator('summary').filter({ hasText: 'Review access' })).toBeFocused()
  await expect(page.getByText('Unlimited books · review access', { exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath('review-access-active.png') })
  await page.reload()
  await openReviewAccess(page)
  await expect(page.getByRole('button', { name: 'End review access' })).toBeVisible()
  await page.getByRole('button', { name: 'Back to my books', exact: true }).click()
  await page.getByRole('button', { name: 'Add Book', exact: true }).click()
  await page.getByRole('button', { name: /No ISBN\? No problem/ }).click()
  await page.getByRole('textbox', { name: 'Book title', exact: true }).fill('The review addition')
  await page.getByRole('button', { name: 'Add to To Be Read', exact: true }).click()
  await expect(page.getByRole('button', { name: 'TBR 21', exact: true })).toBeVisible()
  await openReviewAccess(page)
  await page.getByRole('button', { name: 'End review access' }).click()
  await expect(page.getByRole('textbox', { name: 'Review token', exact: true })).toHaveValue('')
  await page.reload()
  await expect(page.getByRole('button', { name: 'TBR 21', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Add Book', exact: true }).click()
  await page.getByRole('button', { name: /No ISBN\? No problem/ }).click()
  await page.getByRole('textbox', { name: 'Book title', exact: true }).fill('Requires a purchase')
  await page.getByRole('button', { name: 'Add to To Be Read', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Let your library grow.', exact: true })).toBeVisible()
  expect(errors).toEqual([])
})

test('review form supports small screens, keyboard navigation, and changed stored tokens', async ({ page }, info) => {
  const token = await reviewAdapter(page)
  await page.goto('/')
  await page.evaluate((value) => localStorage.setItem('test.review-token', value), token)
  await page.reload()
  await openReviewAccess(page)
  await expect(page.getByRole('button', { name: 'End review access' })).toBeVisible()
  await page.evaluate(() => localStorage.setItem('test.review-token', 'active=true'))
  await page.reload()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const summary = page.locator('summary').filter({ hasText: 'Review access' })
  await summary.focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('textbox', { name: 'Review token', exact: true })).toBeFocused()
  await page.setViewportSize({ width: 320, height: 568 })
  await page.getByRole('textbox', { name: 'Review token', exact: true }).fill(token)
  await page.locator('.review-access').scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('review-access-small.png') })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.screenshot({ path: info.outputPath('review-access-desktop.png') })
})
