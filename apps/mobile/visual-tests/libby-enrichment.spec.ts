import { expect, test } from '@playwright/test'

for (const width of [390, 320]) {
  test(`Libby metadata review preserves reading and identity at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    let lookups = 0
    await page.route('https://openlibrary.org/**', route => {
      lookups++
      return route.fulfill({ json: { docs: [
        { key: '/works/OL1W', title: 'A quiet book', author_name: ['A. Reader'], subject: ['Fiction, fantasy, general'] },
        { key: '/works/OL2W', title: 'A quiet book', author_name: ['A. Reader'], subject: ['Mystery & Detective - Hard-Boiled'] },
      ] } })
    })
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'My Books', exact: true })).toBeVisible()
    await page.evaluate(async () => {
      const path = '/src/storage/runtime.ts'
      const runtime = await (await import(/* @vite-ignore */ path)).getStorageRuntime()
      await runtime.libby.configure(true, true, true)
      await runtime.libby.ingest(JSON.stringify({ kind: 'wovenleaf-libby', version: 1, id: crypto.randomUUID(), capturedAt: new Date().toISOString(),
        observations: [{ titleId: '12345', format: 'ebook', title: 'A quiet book', author: 'A. Reader', percent: 20 }] }))
    })
    await page.reload()
    if (width === 320) await page.addStyleTag({ content: 'html { font-size: 24px !important; }' })
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.locator('.libby-entry').click()
    await expect.poll(async () => page.evaluate(async () => {
      const path = '/src/storage/runtime.ts'
      return (await (await import(/* @vite-ignore */ path)).getStorageRuntime()).libby.read()
    })).toMatchObject({ enrichment: [{ status: 'review' }] })
    await page.getByText('Book details to review', { exact: true }).click()
    const review = page.locator('.libby-metadata')
    await expect(review).toBeVisible()
    await expect(review.getByRole('button', { name: 'Use this match' })).toBeDisabled()
    await expect(review.getByLabel('Matching book')).toHaveValue('')
    await expect(review.getByRole('option')).toHaveCount(3)
    await review.getByLabel('Matching book').selectOption({ index: 2 })
    await expect(review).toContainText('Edition is unverified')
    await expect(review).toContainText('Mystery & Detective - Hard-Boiled')
    await expect(review.getByRole('link', { name: 'Review this work on Open Library' })).toHaveAttribute('href', 'https://openlibrary.org/works/OL2W')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await review.screenshot({ path: testInfo.outputPath(`metadata-review-${width}.png`) })
    await review.getByRole('button', { name: 'Use this match' }).focus()
    await page.keyboard.press('Enter')
    const read = () => page.evaluate(async () => {
      const path = '/src/storage/runtime.ts'
      const runtime = await (await import(/* @vite-ignore */ path)).getStorageRuntime()
      return { books: await runtime.library.list(), state: await runtime.libby.read() }
    })
    await expect.poll(read).toMatchObject({ books: [{ title: 'A quiet book', progress: 20, pageCount: 0,
      metadataSelection: { variants: [{ workKey: 'OL2W', subjects: [{ values: ['Mystery & Detective - Hard-Boiled'] }] }] } }], state: { enrichment: [{ status: 'applied' }] } })
    const before = await read()
    await page.getByText('Recent updates', { exact: true }).click()
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect.poll(read).toMatchObject({ books: [{ id: before.books[0].id, progress: 0, metadataSelection: before.books[0].metadataSelection }], state: { mappings: [{ paused: true }] } })
    await page.reload()
    expect((await read()).books).toHaveLength(1)
    expect(lookups).toBe(1)
    expect(errors).toEqual([])
  })
}
