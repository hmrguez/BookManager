import { expect, test } from '@playwright/test'

test('local fuzzy search, privacy, filters, and command menu work by keyboard', async ({ context, page }, testInfo) => {
  const consoleErrors: string[] = []
  const providerRequests: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))
  page.on('request', (request) => {
    if (request.url().includes('googleapis.com/books')) providerRequests.push(request.url())
  })

  await page.setViewportSize({ width: 430, height: 932 })
  await page.goto('/')
  await page.evaluate(() => document.fonts.ready)
  await page.waitForLoadState('networkidle')

  await expect(page.getByRole('heading', { name: 'My Books', level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: /Mistborn/ })).toBeVisible()
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Search my library' }).click()
  const search = page.getByRole('searchbox', { name: 'Search your local library' })
  await search.fill('mitsborn')
  await expect(page.getByRole('button', { name: /Mistborn/ })).toBeVisible()
  await expect(page.locator('.book-row mark').filter({ hasText: 'Mistborn' })).toBeVisible()

  await search.fill('atmosphere')
  await expect(page.getByText('No books found')).toBeVisible()
  await page.getByRole('button', { name: 'Close library search' }).click()
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: /Search private notes/ }).click()
  await page.getByRole('button', { name: 'Back to my books' }).click()
  await page.getByRole('button', { name: 'Search my library' }).click()
  await page.getByRole('searchbox', { name: 'Search your local library' }).fill('atmosphere')
  await expect(page.getByRole('button', { name: /The Tainted Cup/ })).toBeVisible()
  await expect(page.getByText(/Private note · Loving the atmosphere/)).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('local-search.png'), fullPage: true })

  await page.getByLabel('Filter by shelf').selectOption('finished')
  await expect(page.getByText('No books found')).toBeVisible()
  await page.getByLabel('Filter by shelf').selectOption('all')

  await page.keyboard.press('Control+K')
  const dialog = page.getByRole('dialog', { name: 'Wovenleaf command menu' })
  await expect(dialog).toBeVisible()
  const commandInput = page.getByRole('combobox', { name: 'Wovenleaf command menu' })
  await commandInput.fill('Piranesi')
  const piranesiOption = dialog.getByRole('option', { name: /Piranesi/ })
  await expect(piranesiOption).toBeVisible()
  await page.waitForTimeout(50)
  await page.screenshot({ path: testInfo.outputPath('command-palette.png'), fullPage: true })
  await page.keyboard.press('Shift+Tab')
  await expect(piranesiOption).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(commandInput).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Book details' })).toBeVisible()
  await page.getByRole('button', { name: 'Close' }).click()

  await page.keyboard.press('Control+K')
  await page.getByRole('combobox', { name: 'Wovenleaf command menu' }).fill('finish Mistborn')
  await expect(page.getByRole('option', { name: /Mark finished · Mistborn/ })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Finished' })).toBeVisible()

  expect(providerRequests).toEqual([])
  expect(consoleErrors.filter((error) => !error.includes('ERR_INTERNET_DISCONNECTED'))).toEqual([])
})

test('catalog search uses Open Library, reuses saved results offline, and keeps manual entry available', async ({ context, page }, testInfo) => {
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))
  await page.route('https://openlibrary.org/search.json**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        docs: [{
          key: '/works/OL15297W',
          title: 'Le città invisibili',
          author_name: ['Italo Calvino'],
          editions: {
            docs: [{
              key: '/books/OL26350002M',
              title: 'Invisible Cities',
              isbn: ['9780156453806'],
              language: ['eng'],
              publisher: ['Mariner Books'],
              publish_date: ['1978'],
              number_of_pages: 176,
              cover_i: 8032342,
            }],
          },
        }],
      }),
    })
  })

  await page.setViewportSize({ width: 430, height: 932 })
  await page.goto('/')
  await page.evaluate(() => document.fonts.ready)
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'Add Book' }).click()
  await expect(page.getByPlaceholder('Book title or author')).toBeFocused()
  await expect(page.getByRole('textbox', { name: 'ISBN-10 or ISBN-13' })).toBeHidden()
  await page.getByRole('searchbox', { name: 'Search Open Library' }).fill('Invisible Cities')

  await expect(page.getByRole('heading', { name: 'Invisible Cities' })).toBeVisible()
  await expect(page.getByText('Open Library', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Strong match')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open Library' }).first()).toHaveAttribute(
    'href',
    'https://openlibrary.org/books/OL26350002M',
  )
  await page.getByRole('button', { name: 'Add Invisible Cities' }).click()
  await expect(page.getByRole('button', { name: 'Invisible Cities already added' })).toBeDisabled()
  await page.getByRole('button', { name: /Use an ISBN/ }).click()
  await page.getByRole('textbox', { name: 'ISBN-10 or ISBN-13' }).fill('9780156453806')
  await page.getByRole('button', { name: 'Use ISBN' }).click()
  await expect(page.getByRole('heading', { name: 'This ISBN is already in your library' })).toBeVisible()
  await expect(page.getByText('Wovenleaf will not create a second copy or move it without your review.')).toBeVisible()
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await page.screenshot({ path: testInfo.outputPath('catalog-search.png'), fullPage: true })
  await page.getByRole('button', { name: 'Close' }).click()

  await context.setOffline(true)
  await page.getByRole('button', { name: 'Add Book' }).click()
  await page.getByRole('searchbox', { name: 'Search Open Library' }).fill('Invisible Cities')
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Refresh saved results' })).toBeVisible()

  await page.getByRole('button', { name: /Can't find “Invisible Cities”/ }).click()
  await expect(page.getByRole('heading', { name: 'Add a book manually' })).toBeVisible()
  await expect(page.getByText('Title is enough, even offline. ISBN and other details can be added now or enriched later.')).toBeVisible()
  await page.getByRole('textbox', { name: 'Book title' }).fill('Airplane Mode Book')
  await page.getByRole('button', { name: 'Add to To Be Read' }).click()
  await expect(page.getByRole('button', { name: /Airplane Mode Book/ })).toBeVisible()
  await page.getByRole('button', { name: /Airplane Mode Book/ }).click()
  await expect(page.getByRole('heading', { name: 'Personal record' })).toBeVisible()
  await page.getByRole('button', { name: 'Edit local details' }).click()
  await page.getByLabel('Author', { exact: true }).fill('Offline Author')
  await page.getByRole('button', { name: 'Save local details' }).click()
  await expect(page.getByLabel('Book details').getByText('Offline Author')).toBeVisible()

  expect(consoleErrors.filter((error) => !error.includes('ERR_INTERNET_DISCONNECTED'))).toEqual([])
})
