import { expect, test, type Page } from '@playwright/test'

const readingBook = {
  id: 'dnf-test-reading', title: 'The Left Hand of Darkness', authors: ['Ursula K. Le Guin'],
  pageCount: 300, currentPage: 126, progress: 42, rating: 0, notes: 'Keep my place.',
  shelf: 'reading', addedAt: '2026-09-01T10:00:00.000Z', startedAt: '2026-09-02T10:00:00.000Z',
  lastUpdatedAt: '2026-09-03T10:00:00.000Z',
}
const finishedBook = {
  ...readingBook, id: 'dnf-test-finished', title: 'Piranesi', authors: ['Susanna Clarke'],
  shelf: 'finished', currentPage: 300, progress: 100, finishedAt: '2026-09-03T10:00:00.000Z',
}

const finish = (page: Page) => page.locator('#shelf-reading').getByRole('button', { name: 'Finish', exact: true })
const menu = (page: Page) => page.getByRole('menu', { name: 'Reading status' })
const dnfBook = (page: Page) => page.locator('#shelf-dnf [data-library-book="dnf-test-reading"]')
const resume = (page: Page) => page.getByRole('button', { name: `Return ${readingBook.title} to Reading` })

async function holdFinish(page: Page) {
  await finish(page).scrollIntoViewIfNeeded()
  const bounds = (await finish(page).boundingBox())!
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await expect(menu(page)).toBeVisible()
  await page.mouse.up()
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript((seed) => {
    if (localStorage.getItem('dnf-test-seeded')) return
    localStorage.setItem('wovenleaf.library.v1', JSON.stringify(seed))
    localStorage.setItem('dnf-test-seeded', 'true')
  }, [readingBook, finishedBook])
  await page.goto('/')
  await expect(finish(page)).toBeVisible()
})

test('quick finish stays the default and DNF follows Finished', async ({ page }) => {
  expect(await page.locator('section[data-shelf]').evaluateAll((shelves) => shelves.map((shelf) => shelf.getAttribute('data-shelf'))))
    .toEqual(['tbr', 'next', 'reading', 'finished', 'dnf'])
  await finish(page).click()
  await expect(page.getByRole('dialog', { name: 'Finished', exact: true })).toBeVisible()
  await expect(menu(page)).toHaveCount(0)
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await page.reload()
  await expect(page.locator('#shelf-finished [data-library-book="dnf-test-reading"]')).toBeVisible()
  await expect(dnfBook(page)).toHaveCount(0)
})

test('holding offers DNF, keeps progress after reload, and resumes with undo', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await holdFinish(page)
  await expect(menu(page)).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(finish(page)).toHaveAttribute('aria-expanded', 'true')
  await menu(page).getByRole('menuitem', { name: /DNF/ }).click()
  await expect(dnfBook(page)).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(finish(page)).toBeVisible()
  await expect(page.locator('#shelf-reading .progress-button')).toHaveText('42%')
  await holdFinish(page)
  await menu(page).getByRole('menuitem', { name: /DNF/ }).click()
  await expect(dnfBook(page)).toBeVisible()
  await page.reload()
  await expect(dnfBook(page)).toBeVisible()
  await page.getByRole('button', { name: 'Search my library' }).click()
  await page.getByRole('searchbox', { name: 'Search your local library' }).fill('DNF')
  await page.getByLabel('Filter by shelf').selectOption('dnf')
  await expect(dnfBook(page)).toBeVisible()
  await expect(page.locator('.book-row')).toHaveCount(1)
  await page.getByRole('button', { name: 'Close library search' }).click()
  await resume(page).click()
  await expect(page.locator('#shelf-reading .progress-button')).toHaveText('42%')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(dnfBook(page)).toBeVisible()
  await page.getByRole('button', { name: 'Grid view', exact: true }).click()
  await resume(page).click()
  await expect(page.locator('#shelf-reading .book-tile__meta')).toHaveText('42%')
  await page.getByRole('button', { name: 'List view', exact: true }).click()
  await page.locator('#shelf-reading .progress-button').click()
  await expect(page.getByRole('spinbutton', { name: 'Or set by page' })).toHaveValue('126')
  expect(errors).toEqual([])
})

test('keyboard and custom context menu support selection and safe dismissal', async ({ page }) => {
  await finish(page).focus()
  await page.keyboard.press('ArrowDown')
  await expect(menu(page).getByRole('menuitem', { name: /Finish Mark/ })).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(menu(page).getByRole('menuitem', { name: /DNF/ })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu(page)).toHaveCount(0)
  await expect(finish(page)).toBeFocused()
  await finish(page).click({ button: 'right' })
  await expect(menu(page)).toBeVisible()
  await page.getByRole('heading', { name: 'My Books', exact: true }).click()
  await expect(menu(page)).toHaveCount(0)
  await finish(page).focus()
  await page.keyboard.press('Shift+F10')
  await page.keyboard.press('Tab')
  await expect(menu(page)).toHaveCount(0)
  await finish(page).focus()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Finished', exact: true })).toBeVisible()
})

test('touch holds open the menu without finishing; movement and cancellation abandon the hold', async ({ page, context }) => {
  const touch = await context.newCDPSession(page)
  const point = async () => {
    const bounds = (await finish(page).boundingBox())!
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
  }
  let source = await point()
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [source] })
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: source.x, y: source.y - 35 }] })
  await page.waitForTimeout(550)
  await expect(menu(page)).toHaveCount(0)
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(finish(page)).toBeVisible()
  await finish(page).scrollIntoViewIfNeeded()
  source = await point()
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [source] })
  await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
  await page.waitForTimeout(550)
  await expect(menu(page)).toHaveCount(0)
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [source] })
  await expect(menu(page)).toBeVisible()
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(menu(page)).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await menu(page).getByRole('menuitem', { name: /DNF/ }).click()
  await expect(dnfBook(page)).toBeVisible()
  await resume(page).click()
  await finish(page).scrollIntoViewIfNeeded()
  source = await point()
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [source] })
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(page.getByRole('dialog', { name: 'Finished', exact: true })).toBeVisible()
})

test('menu fits narrow, large-type, and night layouts and dismisses on scroll', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 })
    await page.evaluate(() => {
      document.documentElement.dataset.typeScale = 'x-large'
      document.documentElement.dataset.paperMode = 'night'
      document.documentElement.dataset.contrast = 'high'
    })
    await finish(page).scrollIntoViewIfNeeded()
    await finish(page).focus()
    await page.keyboard.press('ArrowDown')
    await expect(menu(page)).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    const bounds = (await menu(page).boundingBox())!
    expect(bounds.x).toBeGreaterThanOrEqual(12)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width - 12)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(844)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`dnf-menu-${width}.png`), animations: 'disabled' })
    await page.keyboard.press('Escape')
  }
  await holdFinish(page)
  await page.mouse.wheel(0, 120)
  await expect(menu(page)).toHaveCount(0)
  await expect(finish(page)).toBeVisible()
})
