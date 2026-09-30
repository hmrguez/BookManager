import { setLanguagePreference, type Language } from '../src/localization'
/** Simulator-only entry point. Bundle into a copy of the app, never production. */
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { getStorageRuntime } from '../src/storage/runtime'
import { DEFAULT_READER_PREFERENCES, EpubReaderRepository } from '../src/reader'
import { createCorpusEpub, EPUB_CORPUS_CASES } from '../tests/fixtures/epub-corpus'

const report = (value: object) => Filesystem.writeFile({
  path: 'responsive-reader.json', directory: Directory.Cache, encoding: Encoding.UTF8, data: JSON.stringify(value),
})
async function preview() {
  await report({ stage: 'preparing' })
  const passages = [
    'The room was quiet enough to hear the pages turn. Morning light moved across the wooden table, finding the narrow spaces between the books. Outside, the city had already begun its ordinary work; inside, there was time to follow a sentence all the way to its end.',
    'She opened the book where the ribbon rested. A good reading room asked very little of its visitor: a comfortable chair, a clear page, and permission to stay. The shelves held journeys that could wait until tomorrow. Today, this one story was enough.',
    'Across the spread, one thought gave way to another. The space between the pages offered a small pause, like the silence between two familiar voices. Nothing needed to compete with the words. Even the afternoon could arrive without an announcement.',
  ]
  const bytes = await createCorpusEpub({
    ...EPUB_CORPUS_CASES[0]!, id: 'responsive-preview', title: 'A Quiet Reading Room',
    resources: [{ id: 'chapter', href: 'chapter.xhtml', mediaType: 'application/xhtml+xml', spine: true,
      content: `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>A Quiet Reading Room</title></head><body><h1>A Quiet Reading Room</h1>${Array.from({ length: 60 }, (_, i) => `<p>${passages[i % passages.length]}</p>`).join('')}</body></html>` }],
  })
  const runtime = await getStorageRuntime()
  const book = await runtime.epubs.import({ name: 'quiet-reading-room.epub', mediaType: 'application/epub+zip', bytes })
  const scenario = await (await fetch('/reader-scenario.json')).json() as { fontSize?: number; columnCount?: 'auto' | 'one' | 'two'; language?: Language }
  if (scenario.language) setLanguagePreference(scenario.language)
  await new EpubReaderRepository(runtime.database).savePreferences('book', book.bookId, {
    ...DEFAULT_READER_PREFERENCES, fontSize: scenario.fontSize ?? 1, columnCount: scenario.columnCount ?? 'auto',
  })
  await runtime.reader.installEventListener(() => {})
  await runtime.reader.open(book.bookId)
  await report({ stage: 'opened', bookId: book.bookId, scenario })
}
void preview().catch(async (error: unknown) => {
  document.body.textContent = String(error)
  await report({ stage: 'error', message: String(error) })
})
