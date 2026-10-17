/** Simulator-only bootstrap; the runner then loads the unchanged production app entry. */
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { getStorageRuntime } from '../src/storage/runtime'

type Fixture = { view: 'list' | 'grid'; entry: string }
const report = (value: object) => Filesystem.writeFile({
  path: 'library-scroll-verification.json', directory: Directory.Cache,
  encoding: Encoding.UTF8, data: JSON.stringify(value),
})
const frames = async (count: number) => {
  for (let index = 0; index < count; index++) await new Promise(requestAnimationFrame)
}

void (async () => {
  await report({ stage: 'starting' })
  const fixture: Fixture = await (await fetch('/library-scroll-fixture.json')).json()
  const runtime = await getStorageRuntime()
  const initial = await runtime.library.list()
  if (initial.some(({ title }) => !/^Scroll volume \d{3}$/.test(title))) {
    throw new Error('Use an isolated simulator containing only this verification fixture')
  }
  if (!initial.length) {
    const csv = ['external_id,title,authors,shelf,rating', ...Array.from({ length: 89 }, (_, index) =>
      `native-scroll-${index},Scroll volume ${String(index).padStart(3, '0')},Library Author,${index < 45 ? 'tbr' : 'finished'},3`,
    )].join('\n')
    const preview = await runtime.imports.previewCsv('library-scroll.csv', csv)
    await runtime.imports.commit(preview.id, [])
  }
  const books = await runtime.library.list()
  if (books.length !== 89) throw new Error(`Expected 89 persisted books; found ${books.length}`)
  localStorage.setItem('wovenleaf.library-view.v1', fixture.view)
  for (const shelf of ['tbr', 'finished']) {
    localStorage.setItem(`wovenleaf.shelf-collapsed.v1.status:${shelf}`, 'false')
  }
  const errors: string[] = []
  window.addEventListener('error', (event) => errors.push(event.message))
  window.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)))
  await import(/* @vite-ignore */ fixture.entry)
  for (let attempt = 0; attempt < 600 && document.querySelectorAll('[data-virtual-book-list]').length !== 2; attempt++) await frames(1)
  if (document.querySelectorAll('[data-virtual-book-list]').length !== 2) throw new Error('The production shelves did not render')
  await document.fonts.ready
  await frames(30)
  // Make measurement corrections immediate so CSS smooth scrolling cannot hide them.
  const originalScrollBehavior = document.documentElement.style.scrollBehavior
  document.documentElement.style.scrollBehavior = 'auto'
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' })
  await frames(12)
  const samples: { requested: number; actual: number; mounted: number }[] = []
  for (let index = 0; index < 100; index++) {
    const requested = Math.max(0, window.scrollY - 120)
    window.scrollTo({ top: requested, behavior: 'instant' })
    await frames(3)
    samples.push({ requested, actual: window.scrollY, mounted: document.querySelectorAll('[data-library-book]').length })
    if (!requested) break
  }
  document.documentElement.style.scrollBehavior = originalScrollBehavior
  const maxDrift = Math.max(...samples.map(({ requested, actual }) => Math.abs(actual - requested)))
  const maxMounted = Math.max(...samples.map(({ mounted }) => mounted))
  await report({
    stage: 'complete', passed: maxDrift <= 1 && maxMounted < 89 && !errors.length,
    view: fixture.view, userAgent: navigator.userAgent, viewport: { width: innerWidth, height: innerHeight },
    books: books.length, shelves: { tbr: books.filter(({ shelf }) => shelf === 'tbr').length, finished: books.filter(({ shelf }) => shelf === 'finished').length },
    maxDrift, maxMounted, errors, samples,
  })
})().catch(async (error) => { await report({ stage: 'error', message: String(error) }) })
