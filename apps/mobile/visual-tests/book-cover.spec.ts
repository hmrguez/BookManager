import { expect, test } from '@playwright/test'

const title = 'Cover interaction test'
const coverFile = '../../branding/marketing/covers/book-1.jpg'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Add Book', exact: true }).click()
  await page.getByRole('button', { name: /No ISBN\? No problem/ }).click()
  await page.getByRole('textbox', { name: 'Book title', exact: true }).fill(title)
  await page.getByRole('button', { name: 'Add to To Be Read', exact: true }).click()
  await page.locator('.book-identity').filter({ hasText: title }).click()
  await expect(page.getByRole('dialog', { name: 'Book details', exact: true })).toBeVisible()
})

test('tapping previews the whole cover, offers replacement, and saves it after reopening', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  let pickerCount = 0
  page.on('filechooser', () => pickerCount++)
  const cover = page.getByRole('button', { name: `View cover for ${title}` })
  await cover.tap()
  const preview = page.getByRole('dialog', { name: `Cover of ${title}`, exact: true })
  await expect(preview).toBeVisible()
  expect(pickerCount).toBe(0)
  await expect(preview.getByRole('button', { name: 'Add cover', exact: true })).toBeVisible()
  expect((await preview.getByRole('button', { name: 'Add cover', exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44)
  expect((await preview.getByRole('button', { name: 'Close cover preview' }).boundingBox())!.height).toBeGreaterThanOrEqual(44)

  const pickerPromise = page.waitForEvent('filechooser')
  await preview.getByRole('button', { name: 'Add cover', exact: true }).click()
  await (await pickerPromise).setFiles(coverFile)
  await expect(preview.getByRole('status')).toHaveText('Cover saved on this device.')
  await expect(preview.getByRole('button', { name: 'Change cover', exact: true })).toBeEnabled()
  const image = preview.getByRole('img', { name: `Cover of ${title}` })
  await expect(image).toHaveAttribute('src', /^data:image\/jpeg/)
  await expect(image).toHaveCSS('object-fit', 'contain')
  await expect(image).toHaveCSS('filter', 'none')
  expect((await image.boundingBox())!.width).toBeGreaterThan(200)
  await page.screenshot({ path: testInfo.outputPath('expanded-cover-mobile.png') })

  await preview.getByRole('button', { name: 'Close cover preview' }).click()
  await expect(page.getByRole('dialog', { name: 'Book details', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.reload()
  await page.locator('.book-identity').filter({ hasText: title }).click()
  await cover.click()
  await expect(image).toHaveAttribute('src', /^data:image\/jpeg/)
  await page.setViewportSize({ width: 320, height: 568 })
  await expect(image).toBeInViewport()
  await expect(preview.getByRole('button', { name: 'Change cover', exact: true })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.screenshot({ path: testInfo.outputPath('expanded-cover-desktop.png') })
  expect(errors).toEqual([])
})

test('keyboard and backdrop dismissal keep book details open and restore focus', async ({ page }) => {
  const cover = page.getByRole('button', { name: `View cover for ${title}` })
  const preview = page.getByRole('dialog', { name: `Cover of ${title}`, exact: true })
  await cover.focus()
  await page.keyboard.press('Enter')
  await expect(preview).toBeVisible()
  await expect(preview.getByRole('button', { name: 'Close cover preview' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(preview.getByRole('button', { name: 'Add cover', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(preview).toBeHidden()
  await expect(cover).toBeFocused()
  await expect(page.getByRole('dialog', { name: 'Book details', exact: true })).toBeVisible()

  await page.keyboard.press('Space')
  await expect(preview).toBeVisible()
  await page.mouse.click(2, 2)
  await expect(preview).toBeHidden()
  await expect(cover).toBeFocused()
})

test('mouse and touch holds open the picker directly; dragging or cancelling does not', async ({ page, context }) => {
  const cover = page.getByRole('button', { name: `View cover for ${title}` })
  const preview = page.getByRole('dialog', { name: `Cover of ${title}`, exact: true })
  let pickerCount = 0
  page.on('filechooser', () => pickerCount++)
  const box = (await cover.boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.waitForTimeout(600)
  const mousePicker = page.waitForEvent('filechooser')
  await page.mouse.up()
  await (await mousePicker).setFiles([])
  await expect(preview).toBeHidden()
  expect(pickerCount).toBe(1)

  const touch = await context.newCDPSession(page)
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  await page.waitForTimeout(600)
  const touchPicker = page.waitForEvent('filechooser')
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await (await touchPicker).setFiles(coverFile)
  await expect(page.locator('.editable-book-cover').getByRole('status')).toHaveText('Cover saved on this device.')
  await expect(preview).toBeHidden()
  expect(pickerCount).toBe(2)

  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 25, y)
  await page.waitForTimeout(600)
  await page.mouse.up()
  await expect(preview).toBeHidden()
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
  await page.waitForTimeout(600)
  expect(pickerCount).toBe(2)
  await expect(preview).toBeHidden()

  await cover.tap()
  await expect(preview).toBeVisible()
})
