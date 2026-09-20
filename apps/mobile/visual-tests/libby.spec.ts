import { expect, test } from '@playwright/test'

const coverUrl = 'https://img1.od-cdn.com/ImageType-400/1234-1/{ABC-123}IMG400.JPG'

for (const shelf of ['tbr', 'reading'] as const) {
  test(`Libby links an existing ${shelf} book through the collapsed settings panel`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.route('https://img1.od-cdn.com/**', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1sAAAAASUVORK5CYII=', 'base64') }))
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'My Books', exact: true })).toBeVisible()
    // Fixture setup uses the real storage repository in an isolated browser profile.
    await page.evaluate(async ({ shelf }) => {
      const modulePath = '/src/storage/runtime.ts'
      const { getStorageRuntime } = await import(/* @vite-ignore */ modulePath)
      const runtime = await getStorageRuntime()
      const at = new Date().toISOString()
      await runtime.library.save({ id: 'book:libby-existing', title: 'An existing Libby book', authors: ['Test Author'],
        shelf, progress: 2, currentPage: 4, pageCount: 200, rating: 3, notes: 'Keep this note', addedAt: at, lastUpdatedAt: at })
    }, { shelf })
    await page.reload()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const panel = page.locator('details.libby-settings')
    const summary = panel.locator(':scope > summary')
    await expect(panel).not.toHaveAttribute('open')
    await panel.screenshot({ path: testInfo.outputPath('libby-collapsed.png') })
    expect(await panel.evaluate(el => {
      const goodreads = [...document.querySelectorAll('section')].find(section => section.textContent?.includes('Your old library, without the spreadsheet work.'))
      return !!(goodreads && goodreads.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
    })).toBe(true)
    await summary.click()
    await page.getByRole('button', { name: 'Enable Libby progress' }).click()
    const capture = (percent: number) => ({ kind: 'wovenleaf-libby', version: 1, id: crypto.randomUUID(), capturedAt: new Date().toISOString(),
      observations: [{ titleId: '123', format: 'audiobook', title: 'An existing Libby book', author: 'Test Author', percent, coverUrl }] })
    const importCapture = async (percent: number) => {
      await page.getByLabel('Import Libby progress file').setInputFiles({ name: 'capture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(capture(percent))) })
    }
    await importCapture(10)
    await expect(summary).toContainText('1 book to review')
    const match = page.locator('.libby-match')
    await expect(match).toContainText('already in your library')
    await match.getByLabel('Book in Wovenleaf').selectOption('book:libby-existing')
    if (shelf === 'tbr') await expect(match).toContainText('from To Be Read to Reading')
    await match.screenshot({ path: testInfo.outputPath('libby-review.png') })
    await match.getByRole('button', { name: shelf === 'tbr' ? 'Move to Reading & link' : 'Link & apply progress', exact: true }).click()
    await expect(match).toHaveCount(0)
    const bookState = () => page.evaluate(async () => {
      const modulePath = '/src/storage/runtime.ts'
      const { getStorageRuntime } = await import(/* @vite-ignore */ modulePath)
      return (await getStorageRuntime()).library.list()
    })
    await expect.poll(bookState).toMatchObject([{ id: 'book:libby-existing', shelf: 'reading', progress: 10, notes: 'Keep this note', rating: 3, currentPage: 4, thumbnail: coverUrl }])
    expect(await bookState()).toHaveLength(1)
    // Undo must also reverse the explicit TBR→Reading move and added cover.
    await panel.getByText('Recent updates', { exact: true }).click()
    await panel.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect.poll(bookState).toMatchObject([{ shelf, progress: 2 }])
    expect((await bookState())[0].thumbnail).toBeUndefined()
    await importCapture(15)
    await match.getByRole('button', { name: shelf === 'tbr' ? 'Move to Reading & link' : 'Link & apply progress', exact: true }).click()
    await importCapture(25)
    await expect.poll(bookState).toMatchObject([{ shelf: 'reading', progress: 25 }])
    expect(await bookState()).toHaveLength(1)
    await summary.click()
    await expect(panel).not.toHaveAttribute('open')
    await summary.focus(); await page.keyboard.press('Enter')
    await expect(panel).toHaveAttribute('open', '')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await panel.screenshot({ path: testInfo.outputPath('libby-linked.png') })
  })
}
