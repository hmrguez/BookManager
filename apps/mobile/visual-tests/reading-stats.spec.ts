import { expect, test } from '@playwright/test'

test('live almanac updates, explores activity, opens books and survives all paper themes', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.clock.setFixedTime(new Date('2026-10-09T12:00:00Z'))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Stats', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'A chapter waiting to be written' })).toBeVisible()
  await page.evaluate(async () => {
    const r = await (await import('/src/storage/runtime.ts')).getStorageRuntime()
    const { readingEventSchema } = await import('/src/domain/catalog/index.ts')
    const { upsertImportableCatalogEntity } = await import('/src/storage/catalog-repository.ts')
    for (const [i, title, author, format] of [[0, 'The Paper Garden', 'Molly Peacock', 'ebook'], [1, 'The Living Mountain', 'Nan Shepherd', 'audiobook'], [2, 'A Month in the Country', 'J. L. Carr', 'ebook']] as const) {
      const at = '2026-10-01T12:00:00Z'
      const book = { id: `stats-${i}`, title, authors: [author], format, shelf: 'reading' as const, pageCount: 240, currentPage: 30, progress: 12.5, rating: 0, notes: '', addedAt: at, lastUpdatedAt: at }
      await r.library.save(book)
      await r.library.saveManual(book, { ...book, shelf: 'finished', progress: 100, finishedAt: `2026-10-0${i + 2}T12:00:00Z` }, { id: `stats-finish-${i}` })
      const current = (await r.library.list()).find(b => b.id === book.id)!
      const edition = (await r.catalog.read()).editions.find(e => e.id === current.readingEditionId)!
      await r.database.transaction(async db => {
        const personId = `person:stats-${i}`
        await upsertImportableCatalogEntity(db, 'person', { id: personId, displayName: { value: author, winner: 'candidate', candidate: { kind: 'local', target: { type: 'person', id: personId }, field: 'person.displayName', value: author, recordedAt: at, method: 'manual-entry' }, resolvedAt: at }, createdAt: at, updatedAt: at })
        await upsertImportableCatalogEntity(db, 'contributor', { id: `contributor:stats-${i}`, personId, role: 'author', target: { type: 'work', id: edition.workId }, creditedAs: author, position: 0 })
        await upsertImportableCatalogEntity(db, 'edition', { ...edition, language: { ...edition.language, value: 'en', candidate: { ...edition.language.candidate, value: 'en' } } })
      })
      const events = []
      for (let day = 1; day <= 8; day++) {
        const minutes = 8 + (day * 7 + i * 11) % 48
        const slices = i === 1 ? 1 : minutes * 2
        for (let slice = 0; slice < slices; slice++) {
          const start = Date.parse(`2026-10-0${day}T${i === 1 ? '18' : '10'}:00:00Z`) + slice * 30_000
          const end = start + (i === 1 ? minutes * 60_000 : 30_000)
          const stamp = new Date(end).toISOString()
          events.push(readingEventSchema.parse({ id: `reading-event:stats-${i}-${day}-${slice}`, editionId: current.readingEditionId, kind: 'session', sessionId: `reading-session:stats-${i}-${day}-${slice}`, startedAt: new Date(start).toISOString(), endedAt: stamp, activeDurationMs: end - start,
            ...(i !== 1 ? { activeCapture: { kind: 'epub-foreground', version: 1, captureId: `stats:${i}:${day}`, intervalIndex: slice, startReason: slice ? 'checkpoint' : 'open', endReason: slice === slices - 1 ? 'close' : 'checkpoint' } } : {}),
            source: { kind: 'local', method: i === 1 ? 'audio-player' : 'epub-reader' }, deviceId: 'reading-device:stats', observedAt: stamp, recordedAt: stamp, effectiveAt: stamp, timeConfidence: 1 }))
        }
      }
      await r.readingLedger.append({ events })
    }
  })
  const stats = page.locator('.stats-page')
  await expect(stats.locator('.stats-totals').getByText('3', { exact: true })).toBeVisible()
  // Direct fixture writes bypass React's library state; reload after proving live stats updated.
  await page.reload()
  await page.getByRole('button', { name: 'Stats', exact: true }).click()
  await expect(stats.getByRole('heading', { name: 'Your reading rhythm' })).toBeVisible()
  await expect(stats.locator('.stats-chart-bars button')).toHaveCount(9)
  const point = stats.locator('.stats-chart-bars button[tabindex="0"]')
  await point.focus()
  await page.keyboard.press('Home')
  await expect(stats.getByRole('combobox', { name: 'Explore recorded activity' })).toHaveValue('0')
  await page.keyboard.press('ArrowRight')
  await expect(stats.getByRole('combobox', { name: 'Explore recorded activity' })).toHaveValue('1')
  await stats.getByRole('checkbox', { name: 'Compare with the previous period' }).check()
  await expect(stats.getByRole('heading', { name: 'The previous chapter' })).toBeVisible()
  for (const mode of ['warm', 'cool', 'print', 'night']) {
    await page.evaluate(mode => { document.documentElement.dataset.paperMode = mode }, mode)
    await expect(stats.locator('.stats-bar-stack .stats-ink-text').first()).toHaveCSS('background-color', await stats.evaluate(el => getComputedStyle(el).color))
    await page.screenshot({ path: info.outputPath(`stats-${mode}-phone.png`), fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.setViewportSize({ width: 320, height: 740 })
  await page.evaluate(() => { document.documentElement.dataset.typeScale = 'x-large'; document.documentElement.dataset.contrast = 'high' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('stats-large-text.png'), fullPage: true })
  await page.evaluate(() => { document.documentElement.dataset.typeScale = 'standard'; document.documentElement.dataset.paperMode = 'warm'; document.documentElement.dataset.contrast = 'standard' })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  await page.screenshot({ path: info.outputPath('stats-wide.png'), fullPage: true })
  await page.screenshot({ path: info.outputPath('stats-wide-viewport.png') })
  await stats.getByRole('button', { name: /The Paper Garden Molly Peacock/ }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await stats.getByRole('button', { name: 'Quarter', exact: true }).click()
  await expect(stats.getByRole('heading', { name: 'Quarter 4 · 2026', exact: true })).toBeVisible()
  await stats.getByRole('button', { name: 'Previous period' }).click()
  await expect(stats.getByRole('heading', { name: 'Quarter 3 · 2026', exact: true })).toBeVisible()
  await stats.getByRole('button', { name: 'Next period' }).click()
  await expect(stats.getByRole('heading', { name: 'Quarter 4 · 2026', exact: true })).toBeVisible()
  await stats.getByRole('button', { name: 'Year', exact: true }).click()
  await expect(stats.getByRole('heading', { name: '2026', exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Stats', exact: true }).click()
  await expect(stats.getByRole('button', { name: 'Year', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await stats.getByRole('button', { name: 'All time', exact: true }).click()
  await expect(stats.getByRole('checkbox')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('storage notifications exclude reads and rolled-back writes', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Stats', exact: true }).waitFor()
  const counts = await page.evaluate(async () => {
    const r = await (await import('/src/storage/runtime.ts')).getStorageRuntime()
    const { subscribeStorageChanges } = await import('/src/storage/changes.ts')
    const rollbackBook = { id: 'rollback', title: 'Before rollback', authors: ['Author'], shelf: 'tbr' as const, pageCount: 100, currentPage: 0, progress: 0, rating: 0, notes: '', addedAt: new Date().toISOString(), lastUpdatedAt: new Date().toISOString() }
    await r.library.save(rollbackBook)
    let count = 0
    const unsubscribe = subscribeStorageChanges(() => { count++ })
    await r.readingStats.stats({ period: 'month', offset: 0, timezone: 'UTC', knownAt: new Date().toISOString() })
    const reads = count
    await r.database.transaction(async db => { await db.run("UPDATE library_books SET title_sort = 'Rolled back' WHERE id = 'rollback'"); throw new Error('rollback') }).catch(() => {})
    const rollback = count
    const row = await r.database.query("SELECT title_sort FROM library_books WHERE id = ?", [rollbackBook.id])
    if (row[0]?.title_sort !== 'Before rollback') throw new Error('Write was not rolled back')
    const book = { id: 'notification', title: 'A recorded book', authors: ['Author'], shelf: 'tbr' as const, pageCount: 100, currentPage: 0, progress: 0, rating: 0, notes: '', addedAt: new Date().toISOString(), lastUpdatedAt: new Date().toISOString() }
    await r.library.save(book)
    const writes = count
    unsubscribe()
    return { reads, rollback, writes }
  })
  expect(counts).toEqual({ reads: 0, rollback: 0, writes: 1 })
})
