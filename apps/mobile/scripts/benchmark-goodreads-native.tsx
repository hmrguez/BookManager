/** Simulator-only entry point, bundled by benchmark-goodreads-ios.py; never part of the app build. */
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { openCapacitorDatabase } from '../src/storage/capacitor-database'
import { migrateStorage } from '../src/storage/migrations'
import { ImportRepository, type ImportProgress } from '../src/storage/import-repository'
import { LibraryRepository } from '../src/storage/library-repository'
import { CatalogRepository } from '../src/storage/catalog-repository'
import { ImportReviewPage } from '../src/imports/ImportReviewPage'
import type { ImportPreview } from '../src/imports/model'
import type { LibraryBook } from '../src/library-model'
import { tw } from '../src/tailwind/styles'
import type { SqlRow, SqlValue } from '../src/storage/database'
import { setLibraryCapacityPolicy } from '../src/purchases/capacity'

const paint = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
const report = (data: object) => Filesystem.writeFile({
  path: 'import-benchmark.json', directory: Directory.Cache, encoding: Encoding.UTF8, data: JSON.stringify(data),
})

export function Benchmark() {
  const [preview, setPreview] = useState<ImportPreview>()
  const [progress, setProgress] = useState<ImportProgress>()
  const [books, setBooks] = useState<LibraryBook[]>([])
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string>()

  useEffect(() => {
    void (async () => {
      await report({ stage: 'starting' })
      const database = await openCapacitorDatabase()
      await migrateStorage(database)
      // Model an entitled test library while exercising the same transactional capacity read.
      setLibraryCapacityPolicy(database, async () => {})
      const imports = new ImportRepository(database)
      const initial = await new LibraryRepository(database).list()
      if (initial.length) throw new Error('Use a fresh disposable simulator app installation for a full-import benchmark')
      const metrics = { batchMs: 0, batchCalls: 0, statements: 0, queryMs: 0, queries: 0 }
      const runBatch = database.runBatch!.bind(database)
      database.runBatch = async (statements) => {
        const before = performance.now()
        await runBatch(statements)
        metrics.batchMs += performance.now() - before
        metrics.batchCalls += 1
        metrics.statements += statements.length
      }
      const query = database.query.bind(database)
      database.query = async <Row extends SqlRow = SqlRow>(statement: string, values?: readonly SqlValue[]): Promise<Row[]> => {
        const before = performance.now()
        const result = await query<Row>(statement, values)
        metrics.queryMs += performance.now() - before
        metrics.queries += 1
        return result
      }
      const start = performance.now()
      const content = await (await fetch('/benchmark.csv')).text()
      const ready = await imports.previewCsv('goodreads.csv', content, {
        onPreview: setPreview, onProgress: setProgress,
      })
      setPreview(ready)
      setProgress(undefined)
      setBusy(false)
      await paint()
      const previewMs = performance.now() - start
      await report({ stage: 'preview', rows: ready.proposals.length, previewMs })
      const commitStart = performance.now()
      setBusy(true)
      const result = await imports.commit(ready.id, [], { onProgress: setProgress })
      const commitMs = performance.now() - commitStart
      const persisted = await new LibraryRepository(database).list()
      setBooks(persisted)
      const catalog = await new CatalogRepository(database).read()
      const history = await imports.listRecentBatches()
      setBusy(false)
      await paint()
      await report({
        stage: 'complete', rows: ready.proposals.length, books: persisted.length, works: catalog.works.length,
        previewMs, commitMs, totalMs: performance.now() - start,
        historyRows: history[0]?.appliedRows,
        renderedRows: document.querySelectorAll('.import-book-row').length,
        renderedDetails: document.querySelectorAll('.import-book-details').length,
        metrics,
        result,
      })
    })().catch(async (failure) => {
      setBusy(false)
      setError(String(failure))
      await report({ stage: 'error', message: String(failure) })
    })
  }, [])

  return <div className={tw('library-app')} style={{ paddingTop: 'max(60px, env(safe-area-inset-top))' }}>
    {preview ? <ImportReviewPage preview={preview} books={books} busy={busy} progress={progress} error={error} onBack={() => {}} onCommit={async () => {}} /> : <p>Opening local import benchmark…{error}</p>}
  </div>
}

createRoot(document.getElementById('root')!).render(<Benchmark />)
