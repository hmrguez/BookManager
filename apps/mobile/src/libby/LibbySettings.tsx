import { useId, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { ArrowUpRight, BookOpen, Check, Upload } from 'lucide-react'
import type { LibraryBook } from '../library-model'
import type { LibbyController } from './use-libby'
import type { LibbyItem } from './model'
import './libby.css'

function storeUrl(): string | undefined {
  try {
    const url = new URL(import.meta.env.VITE_LIBBY_EXTENSION_STORE_URL ?? '')
    if (url.protocol === 'https:' && ['chromewebstore.google.com', 'microsoftedge.microsoft.com'].includes(url.hostname)) return url.href
  } catch { /* The release has no published companion listing yet. */ }
  return undefined
}

export function LibbySettings({ controller: c, books }: { controller: LibbyController; books: LibraryBook[] }) {
  const [platform, setPlatform] = useState<'safari' | 'quetta'>(Capacitor.getPlatform() === 'android' ? 'quetta' : 'safari')
  const [guideOpen, setGuideOpen] = useState(!c.state.enabled)
  const [disconnecting, setDisconnecting] = useState(false)
  const id = useId()
  const pending = c.state.items.filter(item => item.status === 'pending').slice().reverse()
  const listing = storeUrl()
  return <section className="libby-settings" aria-labelledby={`${id}-heading`}>
    <div className="libby-masthead"><span>LIBBY · CONNECTED READING</span><BookOpen size={20} aria-hidden="true" /></div>
    <h2 id={`${id}-heading`}>Your place, kept.</h2>
    <p className="libby-intro">Keep reading in Libby. Bring your place back to Wovenleaf through your browser.</p>
    <p className="libby-caption">Libby updates its web shelf when you visit. Safari saves that snapshot for Wovenleaf; Quetta lets you send it. This does not track the native Libby app in the background.</p>
    {c.error && <p className="libby-error" role="alert">{c.error}</p>}
    {!c.state.enabled ? <button className="libby-primary" disabled={!c.ready || c.busy} onClick={() => { void c.configure(true); setGuideOpen(true) }}>Enable Libby progress <ArrowUpRight size={18} aria-hidden="true" /></button>
      : <>
        <div className="libby-status" role="status"><Check size={16} aria-hidden="true" /><span>{c.state.lastReceivedAt ? `Last received ${new Date(c.state.lastReceivedAt).toLocaleString()}` : 'Enabled · waiting for your first shelf capture'}</span></div>
        <label className="libby-toggle"><span><strong>Update linked books automatically</strong><small>Forward progress applies when Wovenleaf opens. New matches and conflicts always need your review.</small></span><input type="checkbox" checked={c.state.automatic} disabled={c.busy} onChange={event => void c.configure(true, event.target.checked)} /></label>
      </>}
    <button className="libby-row-action" aria-expanded={guideOpen} aria-controls={`${id}-guide`} onClick={() => setGuideOpen(!guideOpen)}>{guideOpen ? 'Close setup guide' : 'Safari & Quetta setup guide'} <span aria-hidden="true">{guideOpen ? '−' : '+'}</span></button>
    {guideOpen && <div id={`${id}-guide`} className="libby-guide">
      <div className="libby-platforms" role="group" aria-label="Choose your browser">
        <button aria-pressed={platform === 'safari'} onClick={() => setPlatform('safari')}>Safari <small>iOS 15.4 or later</small></button>
        <button aria-pressed={platform === 'quetta'} onClick={() => setPlatform('quetta')}>Quetta <small>Android</small></button>
      </div>
      {platform === 'safari' ? <ol>
        <li><strong>Enable the companion</strong><p>In iPhone or iPad Settings, open Apps → Safari → Extensions → Wovenleaf Libby and turn it on. On older iOS versions, Safari is directly in Settings.</p></li>
        <li><strong>Link your Libby shelf</strong><p>Open <b>libbyapp.com</b> in Safari. Choose “Yes, I Have A Library Card” → “Recover Your Data” → “Display Setup Code”. In the Libby app, open Menu → Copy To Another Device and enter the code shown in Safari. Return to Safari and wait for the transfer to finish.</p></li>
        <li><strong>Allow this shelf</strong><p>On Libby’s website, open Safari’s page menu → Manage Extensions. Allow Wovenleaf Libby on libbyapp.com. Open the companion and turn on “Capture this browser’s Libby shelf”.</p></li>
        <li><strong>Make your first match</strong><p>Open Libby’s Shelf in Safari and wait for the percentages. Capture the shelf, then open Wovenleaf and choose the matching book below. Future eligible updates apply automatically.</p></li>
      </ol> : <ol>
        <li><strong>Add the companion in Quetta</strong>{listing ? <><p>Open the companion listing in Quetta. Install “Wovenleaf · Libby progress” and enable it with access to libbyapp.com.</p><a href={listing} target="_blank" rel="noreferrer">Open companion listing <ArrowUpRight size={14} aria-hidden="true" /></a></> : <><p>The public store listing is not available yet. This build needs the Wovenleaf companion ZIP.</p><p className="libby-caption">Save the ZIP on your phone. In Quetta, open Extensions → Manage Extensions → Developer options. Turn on Developer mode, choose “from .zip/.crx/.user.js”, then select the ZIP. These steps were checked in Quetta 2.0.5.</p></>}</li>
        <li><strong>Link your Libby shelf</strong><p>Open <b>libbyapp.com</b> in Quetta. Choose “Yes, I Have A Library Card” → “Recover Your Data” → “Display Setup Code”. In the Libby app, open Menu → Copy To Another Device and enter the code shown in Quetta. Return to Quetta and wait for the transfer to finish.</p></li>
        <li><strong>Capture your shelf</strong><p>Open your web Shelf, then the Wovenleaf companion from Quetta’s Extensions menu. Turn on capture and choose “Capture shelf now”.</p></li>
        <li><strong>Bring it to Wovenleaf</strong><p>Choose “Save progress file” and finish the download. Import that file below, or open it from Quetta’s Downloads and share it with Wovenleaf. Direct “Send to Wovenleaf” sharing may work in other versions; it is unavailable in Quetta 2.0.5.</p></li>
        <li><strong>Match once</strong><p>Choose the matching book below. After each later web-shelf visit, save and import a fresh capture. Linked books can then update automatically.</p></li>
      </ol>}
      <div className="libby-guide-footnote"><strong>After reading in the Libby app</strong><p>Let Libby sync online, then visit the web Shelf in {platform === 'safari' ? 'Safari' : 'Quetta'}. If the percentage is old, use Shelf → Actions → Synchronize Shelf. Capture again and {platform === 'safari' ? 'open Wovenleaf' : 'send it to Wovenleaf'}.</p><p>A capture records what the shelf displays, including 0%. Missing progress stays unknown. Reading in the browser works too; return to its Shelf when you finish.</p></div>
      <a href="https://help.libbyapp.com/en-us/6023.htm" target="_blank" rel="noreferrer">Libby’s guide to syncing devices <ArrowUpRight size={14} aria-hidden="true" /></a>
    </div>}
    {c.state.enabled && <>
      <div className="libby-import"><label className={c.busy ? 'is-busy' : ''}><Upload size={16} aria-hidden="true" /> Import progress file<input type="file" accept=".json,application/json" aria-label="Import Libby progress file" disabled={c.busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void c.receiveFile(file) }} /></label><button disabled={c.busy} onClick={() => void c.refresh()}>Check received captures</button></div>
      <div aria-live="polite" aria-busy={c.busy}>{c.busy && <p className="libby-caption">Receiving your progress…</p>}</div>
      {pending.length > 0 && <div className="libby-review"><h3>Ready to review <span>{pending.length}</span></h3>{pending.map(item => <MatchRow key={`${item.key}:${item.snapshotId}:${books.find(book => book.id === c.state.mappings.find(mapping => mapping.key === item.key)?.bookId)?.lastUpdatedAt ?? 'unlinked'}`} item={item} books={books} controller={c} />)}</div>}
      {c.state.receipts.length > 0 && <details className="libby-details"><summary>Recent updates</summary>{c.state.receipts.slice().reverse().slice(0, 10).map(receipt => <div className="libby-history" key={receipt.id}><div><strong>{receipt.title}</strong><small>{receipt.before.progress}% → {receipt.after.progress}% · {new Date(receipt.at).toLocaleDateString()}</small></div><button disabled={c.busy || receipt.undone || books.find(book => book.id === receipt.bookId)?.lastUpdatedAt !== receipt.after.lastUpdatedAt} onClick={() => void c.undo(receipt.id)}>{receipt.undone ? 'Undone' : 'Undo'}</button></div>)}</details>}
      {c.state.mappings.length > 0 && <details className="libby-details"><summary>Linked books · {c.state.mappings.length}</summary>{c.state.mappings.map(mapping => <div className="libby-history" key={mapping.key}><span>{books.find(book => book.id === mapping.bookId)?.title ?? 'Book no longer in your library'}{mapping.paused ? ' · paused' : ''}</span><button disabled={c.busy} onClick={() => void c.unlink(mapping.key)}>Unlink</button></div>)}</details>}
      <p className="libby-caption">Only titles, authors, formats and percentages are received. No library card, login, book text or reading history. Progress stays on this device. A 100% capture leaves finishing the book to you.</p>
      {disconnecting ? <div className="libby-disconnect"><p>Disconnect and erase Libby matches, captures and undo history? Your books and their current progress stay in your library. Turn off the browser companion too to erase its last capture.</p><button disabled={c.busy} onClick={() => { void c.configure(false).then(ok => { if (ok) setDisconnecting(false) }) }}>Disconnect & erase</button><button onClick={() => setDisconnecting(false)}>Keep connected</button></div> : <button className="libby-disconnect-button" disabled={c.busy} onClick={() => setDisconnecting(true)}>Disconnect Libby</button>}
    </>}
  </section>
}

function MatchRow({ item, books, controller: c }: { item: LibbyItem; books: LibraryBook[]; controller: LibbyController }) {
  const linked = c.state.mappings.find(mapping => mapping.key === item.key)
  const [selected, setSelected] = useState(linked?.bookId ?? '')
  const [expected, setExpected] = useState(books.find(book => book.id === linked?.bookId)?.lastUpdatedAt)
  const id = useId()
  const book = books.find(entry => entry.id === selected)
  const reading = books.filter(entry => entry.shelf === 'reading')
  const normalized = (value: string) => value.normalize('NFKC').toLocaleLowerCase().trim()
  const sorted = [...reading].sort((a, b) => Number(normalized(b.title) === normalized(item.observation.title)) - Number(normalized(a.title) === normalized(item.observation.title)))
  return <article className="libby-match">
    <div className="libby-match-heading"><div><small>{item.observation.format === 'audiobook' ? 'AUDIOBOOK' : 'EBOOK'}</small><h4>{item.observation.title}</h4><p>{item.observation.author}</p></div><span className="libby-percent">{item.observation.percent}<small>%</small></span></div>
    <p className="libby-caption">{item.reason} Captured {new Date(item.capturedAt).toLocaleString()}.</p>
    <label htmlFor={id}>Book in Wovenleaf</label>
    <select id={id} value={selected} disabled={c.busy} onChange={event => { setSelected(event.target.value); setExpected(books.find(entry => entry.id === event.target.value)?.lastUpdatedAt) }}>
      <option value="">Choose a book on your Reading shelf</option>{sorted.map(entry => <option key={entry.id} value={entry.id}>{entry.title} · {entry.progress}%{entry.format ? ` · ${entry.format}` : ''}</option>)}<option value="__new">Add as a new book on Reading</option>
    </select>
    {book && <p className="libby-caption">Wovenleaf {book.progress}% → Libby {item.observation.percent}%. Page markers stay unchanged.</p>}
    <div className="libby-match-actions"><button className="libby-primary" disabled={c.busy || !selected || (!!book && book.shelf !== 'reading')} onClick={() => void c.apply(item.key, item.snapshotId, selected === '__new' ? null : selected, expected)}>{selected === '__new' ? 'Add & link book' : 'Link & apply progress'}</button><button disabled={c.busy} onClick={() => void c.dismiss(item.key, item.snapshotId)}>Dismiss</button></div>
  </article>
}
