/** Read-only, resumable Open Library cover audit. Private results stay in the supplied output directory.
 * bun scripts/audit-goodreads-covers.ts /path/to/goodreads.csv /path/to/output [saved-metadata-evidence.json]
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { goodreadsCsvParser } from '../src/imports/csv-parser'
import { canonicalEditionIsbn, metadataSearchCacheEntrySchema, normalizeSearchText } from '../src/metadata/model'

const [input, output, savedEvidence] = process.argv.slice(2)
if (!input || !output) throw new Error('Supply a Goodreads CSV and a private output directory')
await mkdir(join(output, 'responses'), { recursive: true })
const content = await readFile(input, 'utf8')
const books = goodreadsCsvParser.parse(content).map((row) => {
  const normalized = goodreadsCsvParser.normalize(row)
  if (!normalized.ok) throw new Error(`CSV row ${row.rowNumber}: ${normalized.errors.join('; ')}`)
  const book = normalized.record
  return { goodreadsId: book.externalKey, title: book.title, authors: book.authors,
    isbns: [...new Set((book.identifiers ?? []).flatMap((id) => canonicalEditionIsbn(id) ?? []))],
    coverUrl: '', openLibraryUrl: '', match: '', checked: false }
})
type Book = (typeof books)[number]
type Document = { key: string; title: string; author_name?: string[]; isbn?: string[]; cover_i?: number }
let requests = 0
let nextRequestAt = 0
const failures: string[] = []
const warnings: string[] = []
async function json(url: URL): Promise<any> {
  const file = join(output, 'responses', `${createHash('sha256').update(url.href).digest('hex')}.json`)
  try { return JSON.parse(await readFile(file, 'utf8')) } catch { /* No saved response. */ }
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, nextRequestAt - Date.now())))
  nextRequestAt = Date.now() + 1_100
  requests++
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { 'User-Agent': 'Wovenleaf-Cover-Audit/1.0', Accept: 'application/json' } })
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url.pathname}`)
  const value = await response.json()
  await writeFile(file, JSON.stringify(value))
  return value
}
async function search(query: string): Promise<Document[]> {
  const documents: Document[] = []
  for (let offset = 0; ; offset += 100) {
    const url = new URL('https://openlibrary.org/search.json')
    url.search = new URLSearchParams({ q: query, fields: 'key,title,author_name,isbn,cover_i', limit: '100', offset: String(offset) }).toString()
    const value = await json(url)
    if (!Array.isArray(value.docs)) throw new Error('Invalid search response')
    documents.push(...value.docs)
    if (offset + 100 >= (value.numFound ?? value.num_found ?? 0)) break
  }
  return documents
}
const isbns = [...new Set(books.flatMap((book) => book.isbns))]
for (let offset = 0; offset < isbns.length; offset += 40) {
  const batch = new Set(isbns.slice(offset, offset + 40))
  try {
    const documents = await search(`isbn:(${[...batch].join(' OR ')})`)
    for (const book of books.filter((book) => book.isbns.some((isbn) => batch.has(isbn)))) {
      book.checked = true
      const found = documents.find((document) => document.cover_i && (document.isbn ?? []).some((isbn) => book.isbns.includes(canonicalEditionIsbn(isbn) ?? '')))
      if (found) assign(book, found, 'ISBN-linked work cover')
    }
  } catch (error) { failures.push(`ISBN batch ${offset / 40 + 1}: ${String(error)}`); break }
  console.log(JSON.stringify({ stage: 'isbn', checkedIsbns: Math.min(offset + 40, isbns.length), totalIsbns: isbns.length, coveredBooks: books.filter((book) => book.coverUrl).length }))
}

// The Read API also exposes covers missing from the search index. Keep failures
// separate from successful search matches instead of throwing away the whole batch.
const unresolved = [...new Set(books.filter((book) => !book.coverUrl).flatMap((book) => book.isbns))]
for (let offset = 0; !failures.length && offset < unresolved.length; offset += 40) {
  const batch = unresolved.slice(offset, offset + 40)
  try {
    const result = await json(new URL(`https://openlibrary.org/api/volumes/brief/json/${batch.map((isbn) => `isbn:${isbn}`).join('|')}`))
    for (const book of books.filter((book) => !book.coverUrl && book.isbns.some((isbn) => batch.includes(isbn)))) {
      for (const isbn of book.isbns) {
        const entry = result[`isbn:${isbn}`]
        if (!entry) continue
        const records = Object.values(entry.records ?? {}) as Array<{ data?: { key?: string; cover?: Record<string, string> } }>
        const record = records.find((record) => cover(record.data?.cover))
        const item = (entry.items ?? []).find((item: any) => item.match === 'exact' && cover(item.cover))
          ?? (entry.items ?? []).find((item: any) => item.match === 'similar' && cover(item.cover))
        const image = cover(record?.data?.cover) || cover(item?.cover)
        if (!image) continue
        book.coverUrl = image.replace(/^http:/, 'https:')
        book.openLibraryUrl = `https://openlibrary.org${record?.data?.key ?? item?.fromRecord ?? `/isbn/${isbn}`}`
        book.match = record || item?.match === 'exact' ? 'ISBN record cover' : 'Related edition cover'
        break
      }
    }
  } catch (error) {
    warnings.push(`Optional Read API unavailable: ${String(error)}`)
    break
  }
  console.log(JSON.stringify({ stage: 'read-api', checkedIsbns: Math.min(offset + 40, unresolved.length), totalIsbns: unresolved.length, coveredBooks: books.filter((book) => book.coverUrl).length }))
}

const baseTitle = (title: string) => title.replace(/\s*\([^)]*\)\s*$/, '').trim()
const quote = (value: string) => `"${value.replace(/[\\"]/g, '\\$&')}"`
const remaining = books.filter((book) => !book.coverUrl)
for (let offset = 0; !failures.length && offset < remaining.length; offset += 10) {
  const batch = remaining.slice(offset, offset + 10)
  try {
    const documents = await search(batch.map((book) => `(title:${quote(baseTitle(book.title))} AND author:${quote(book.authors[0] ?? '')})`).join(' OR '))
    for (const book of batch) {
      book.checked = true
      const found = documents.find((document) => document.cover_i
        && normalizeSearchText(baseTitle(document.title)) === normalizeSearchText(baseTitle(book.title))
        && (document.author_name ?? []).some((author) => book.authors.some((expected) => normalizeSearchText(author) === normalizeSearchText(expected))))
      if (found) assign(book, found, 'Title and author work cover')
    }
  } catch (error) { failures.push(`Title batch ${offset / 10 + 1}: ${String(error)}`) }
  console.log(JSON.stringify({ stage: 'title-author', checkedBooks: Math.min(offset + 10, remaining.length), totalBooks: remaining.length, coveredBooks: books.filter((book) => book.coverUrl).length }))
}

function assign(book: Book, document: Document, match: string) {
  book.coverUrl = `https://covers.openlibrary.org/b/id/${document.cover_i}-M.jpg?default=false`
  book.openLibraryUrl = `https://openlibrary.org${document.key}`
  book.match = match
}
function cover(value?: Record<string, string>): string { return value?.medium || value?.large || value?.small || '' }
// Optional saved Open Library responses can contain edition titles/covers absent
// from the work-level search fields. Recheck identity against each single variant.
let additionalEditionMatches = 0
if (savedEvidence) {
  const entries: unknown[] = JSON.parse(await readFile(savedEvidence, 'utf8'))
  const variants = entries.flatMap((entry) => metadataSearchCacheEntrySchema.parse(entry).variants)
  for (const book of books.filter((book) => !book.coverUrl)) {
    const variant = variants.find((variant) => variant.provider === 'open-library' && variant.thumbnail
      && [variant.title, variant.workTitle].some((title) => normalizeSearchText(baseTitle(title)) === normalizeSearchText(baseTitle(book.title)))
      && variant.authors.some((author) => book.authors.some((expected) => normalizeSearchText(author) === normalizeSearchText(expected))))
    if (!variant?.thumbnail) continue
    book.coverUrl = variant.thumbnail
    book.openLibraryUrl = `https://openlibrary.org/${variant.editionKey ? `books/${variant.editionKey}` : `works/${variant.workKey}`}`
    book.match = 'Title and author edition cover'
    additionalEditionMatches++
  }
}
const summary = { checkedAt: new Date().toISOString(), sourceSha256: createHash('sha256').update(content).digest('hex'), total: books.length,
  covered: books.filter((book) => book.coverUrl).length, withoutConfidentCoverMatch: books.filter((book) => !book.coverUrl).length,
  withIsbn: books.filter((book) => book.isbns.length).length, requests, complete: !failures.length, failures, warnings, additionalEditionMatches,
  matches: Object.fromEntries([...new Set(books.map((book) => book.match).filter(Boolean))].map((match) => [match, books.filter((book) => book.match === match).length])) }
await writeFile(join(output, 'cover-audit.json'), JSON.stringify({ summary, books }, null, 2))
const escape = (value: unknown) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!))
const rows = [...books].sort((a, b) => a.title.localeCompare(b.title)).map((book) => `<tr data-covered="${!!book.coverUrl}"><td>${escape(book.title)}</td><td>${escape(book.authors.join(', '))}</td><td>${escape(book.isbns.join(', '))}</td><td>${book.coverUrl ? `<a href="${escape(book.coverUrl)}">Cover</a> · <a href="${escape(book.openLibraryUrl)}">Open Library</a><br><small>${escape(book.match)}</small>` : summary.complete ? 'No confident match found' : 'Unresolved; audit incomplete'}</td></tr>`).join('')
await writeFile(join(output, 'cover-audit.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Goodreads cover availability</title><style>body{font:16px/1.5 system-ui;margin:32px;color:#25241f;background:#faf8f2}h1{font-family:Georgia,serif}table{border-collapse:collapse;width:100%;table-layout:fixed}th:nth-child(1){width:34%}th:nth-child(2){width:24%}th:nth-child(3){width:17%}th:nth-child(4){width:25%}td{overflow-wrap:anywhere}#query{width:320px;max-width:100%;box-sizing:border-box}td,th{padding:12px;text-align:left;border-bottom:1px solid #d9d3c5;vertical-align:top}input,select{font:inherit;padding:8px;margin:8px 12px 20px 0}small{color:#646158}a{color:#845024}thead{position:sticky;top:0;background:#faf8f2}</style><h1>Goodreads cover availability</h1><p><strong>${summary.covered.toLocaleString()} of ${summary.total.toLocaleString()}</strong> books have an Open Library cover match in this audit.</p><p>Checked ${escape(summary.checkedAt)}. ${summary.complete ? 'All rows checked.' : `Incomplete: ${escape(failures.join('; '))}`}</p><p>Availability is reported by Open Library search metadata; images were not downloaded in bulk. ${warnings.length ? 'The optional legacy Read API returned an error and was skipped. ' : ''} A work or related-edition cover may differ from the exact Goodreads edition. “No confident match” does not prove no cover exists.</p><input id="query" placeholder="Find a title, author or ISBN"><select id="status"><option value="">All books</option><option value="true">Cover found</option><option value="false">No confident match</option></select><table><thead><tr><th>Title</th><th>Author</th><th>ISBN</th><th>Availability</th></tr></thead><tbody>${rows}</tbody></table><script>const q=document.querySelector('#query'),s=document.querySelector('#status');function filter(){for(const row of document.querySelectorAll('tbody tr'))row.hidden=!row.textContent.toLowerCase().includes(q.value.toLowerCase())||(s.value&&row.dataset.covered!==s.value)}q.addEventListener('input',filter);s.addEventListener('change',filter);</script></html>`)
console.log(JSON.stringify(summary, null, 2))
