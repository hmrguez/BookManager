import { useEffect, useId, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { ArrowUpRight, BookOpen, Check, ChevronDown, Upload } from 'lucide-react'
import type { LibraryBook } from '../library-model'
import { shelfCopy } from '../app/config'
import { BookCover } from '../design-system/components'
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

export function LibbySettings({ controller: c, books, reveal = false, onRevealed }: { controller: LibbyController; books: LibraryBook[]; reveal?: boolean; onRevealed?: () => void }) {
  const panel = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    if (!reveal || !panel.current) return
    panel.current.open = true
    panel.current.scrollIntoView({ block: 'start', behavior: 'instant' })
    panel.current.querySelector('summary')?.focus({ preventScroll: true })
    onRevealed?.()
  }, [reveal, onRevealed])
  const [platform, setPlatform] = useState<'safari' | 'quetta'>(Capacitor.getPlatform() === 'android' ? 'quetta' : 'safari')
  const [guideOpen, setGuideOpen] = useState(!c.state.enabled)
  const [disconnecting, setDisconnecting] = useState(false)
  const id = useId()
  const pending = c.state.items.filter(item => item.status === 'pending').slice().reverse()
  const listing = storeUrl()
  return <details ref={panel} className="libby-settings">
    <summary className="libby-summary"><BookOpen size={22} aria-hidden="true" /><span><strong>Libby</strong><small role="status">{c.error ? 'Needs attention' : pending.length ? `${pending.length} ${pending.length === 1 ? 'book' : 'books'} to review` : c.state.enabled ? 'Connected reading · enabled' : 'Connect your books and reading progress'}</small></span><ChevronDown className="libby-chevron" size={18} aria-hidden="true" /></summary>
    <div className="libby-panel" aria-labelledby={`${id}-heading`}>
    <h2 id={`${id}-heading`}>Your place, kept.</h2>
    <p className="libby-intro">Your Libby books, automatically on Reading. Your progress follows.</p>
    <p className="libby-caption">Visit your Libby web Shelf once to capture your loans. Audiobook progress then follows the visible web player automatically. For ebooks, visit the Shelf after reading. Open Wovenleaf to see your updates.</p>
    {c.error && <p className="libby-error" role="alert">{c.error}</p>}
    {!c.state.enabled ? <button className="libby-primary" disabled={!c.ready || c.busy} onClick={() => { void c.configure(true); setGuideOpen(true) }}>Enable Libby progress <ArrowUpRight size={18} aria-hidden="true" /></button>
      : <>
        <div className="libby-status" role="status"><Check size={16} aria-hidden="true" /><span>{c.state.lastReceivedAt ? `Last received ${new Date(c.state.lastReceivedAt).toLocaleString()}` : 'Enabled · waiting for your first shelf capture'}</span></div>
        <label className="libby-toggle"><span><strong>Add new loans to Reading</strong><small>New titles arrive automatically. If a title is already in your library, you choose its matching edition once.</small></span><input type="checkbox" checked={c.state.autoAdd} disabled={c.busy} onChange={event => void c.configure(true, c.state.automatic, event.target.checked)} /></label>
        <label className="libby-toggle"><span><strong>Update progress automatically</strong><small>Forward progress applies when Wovenleaf opens. Backward positions and manual edits stay in review.</small></span><input type="checkbox" checked={c.state.automatic} disabled={c.busy} onChange={event => void c.configure(true, event.target.checked)} /></label>
        {Capacitor.getPlatform() === 'android' && <div className="libby-connection">
          <h3>Connect Quetta once</h3>
          <p className="libby-caption">Captures travel directly on this phone, with no share sheet. Android keeps a visible Libby connection notification. Reopen Wovenleaf after a phone restart or force-stop.</p>
          <p role="status">{c.connection?.paired ? (c.connection.running ? 'Connected · ready for captures' : 'Connection paused') : 'Your browser is not connected yet'}</p>
          {c.connection?.error && <p className="libby-error">{c.connection.error}</p>}
          {c.connection?.paired && !c.connection.running && <button onClick={() => void c.resumeConnection()} disabled={c.busy}>Resume connection</button>}
          <button onClick={() => void c.pair()} disabled={c.busy}>{c.connection?.paired ? 'Connect a different companion' : 'Get connection code'}</button>
          {c.pairingCode && <div><output className="libby-code" aria-label="One-time connection code">{c.pairingCode.match(/.{1,4}/g)?.join(' ')}</output><button onClick={() => void c.copyCode()} disabled={c.busy}>Copy code</button><p className="libby-caption">Paste this into the Wovenleaf companion in Quetta and choose Connect automatically. It expires after five minutes. This is a Wovenleaf connection code, separate from Libby’s device setup code.</p></div>}
        </div>}
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
        <li><strong>Allow this shelf</strong><p>On Libby’s website, open Safari’s page menu → Manage Extensions. Allow Wovenleaf Libby on libbyapp.com and the OverDrive audio player when Safari asks. Open the companion and turn on “Capture Libby web progress”.</p></li>
        <li><strong>Let your shelf arrive</strong><p>Open Libby’s Shelf in Safari once, then listen in its web player. Audiobook percentages are captured there automatically. For ebooks, revisit the Shelf after reading. Open Wovenleaf to see your updates. Existing-title ambiguities and conflicts need review.</p></li>
      </ol> : <ol>
        <li><strong>Add the companion in Quetta</strong>{listing ? <><p>Open the companion listing in Quetta. Install “Wovenleaf · Libby progress” and enable it with access to libbyapp.com.</p><a href={listing} target="_blank" rel="noreferrer">Open companion listing <ArrowUpRight size={14} aria-hidden="true" /></a></> : <><p>The public store listing is not available yet. This build needs the Wovenleaf companion ZIP.</p><p className="libby-caption">Save the ZIP on your phone. In Quetta, open Extensions → Manage Extensions → Developer options. Turn on Developer mode, choose “from .zip/.crx/.user.js”, then select the ZIP. These steps were checked in Quetta 2.0.5.</p></>}</li>
        <li><strong>Link your Libby shelf</strong><p>Open <b>libbyapp.com</b> in Quetta. Choose “Yes, I Have A Library Card” → “Recover Your Data” → “Display Setup Code”. In the Libby app, open Menu → Copy To Another Device and enter the code shown in Quetta. Return to Quetta and wait for the transfer to finish.</p></li>
        <li><strong>Connect Wovenleaf</strong><p>Get a connection code above. In Quetta’s Wovenleaf companion, paste the code and choose Connect automatically. Turn on “Capture Libby web progress”. This setup is needed only once.</p></li>
        <li><strong>Capture your loans, then listen</strong><p>Visit Libby’s Shelf in Quetta once, then listen in its web player. Audiobook progress arrives automatically. For ebooks, revisit the Shelf after reading. Open Wovenleaf: new loans appear on Reading and forward progress updates without a review tap.</p></li>
        <li><strong>If the connection is paused</strong><p>Open Wovenleaf to resume it, then return to your web Shelf. “Save progress file” and the import below remain available as a fallback.</p></li>
      </ol>}
      <div className="libby-guide-footnote"><strong>If progress hasn’t arrived</strong><p>After updating the companion, refresh Libby. Visit its Shelf once, then open your audiobook’s web player and leave its percentage visible briefly. Keep access to the OverDrive audio player enabled. A lower position needs review in the book’s Libby link.</p><p>For ebooks or native-app reading, use Shelf → Actions → Synchronize Shelf and wait for its percentage to update. Native-to-web sync timing is controlled by Libby. Missing progress stays unknown.</p></div>
      <a href="https://help.libbyapp.com/en-us/6023.htm" target="_blank" rel="noreferrer">Libby’s guide to syncing devices <ArrowUpRight size={14} aria-hidden="true" /></a>
    </div>}
    {c.state.enabled && <>
      <div className="libby-import"><label className={c.busy ? 'is-busy' : ''}><Upload size={16} aria-hidden="true" /> Import progress file<input type="file" accept=".json,application/json" aria-label="Import Libby progress file" disabled={c.busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void c.receiveFile(file) }} /></label><button disabled={c.busy} onClick={() => void c.refresh()}>Check received captures</button></div>
      <div aria-live="polite" aria-busy={c.busy}>{c.busy && <p className="libby-caption">Receiving your progress…</p>}</div>
      {pending.length > 0 && <div className="libby-review"><h3>Ready to review <span>{pending.length}</span></h3>{pending.map(item => <MatchRow key={`${item.key}:${item.snapshotId}:${books.find(book => book.id === c.state.mappings.find(mapping => mapping.key === item.key)?.bookId)?.lastUpdatedAt ?? 'unlinked'}`} item={item} books={books} controller={c} />)}</div>}
      {c.state.receipts.length > 0 && <details className="libby-details"><summary>Recent updates</summary>{c.state.receipts.slice().reverse().slice(0, 10).map(receipt => <div className="libby-history" key={receipt.id}><div><strong>{receipt.title}</strong><small>{receipt.before.progress}% → {receipt.after.progress}% · {new Date(receipt.at).toLocaleDateString()}</small></div><button disabled={c.busy || receipt.undone || books.find(book => book.id === receipt.bookId)?.lastUpdatedAt !== receipt.after.lastUpdatedAt} onClick={() => void c.undo(receipt.id)}>{receipt.undone ? 'Undone' : 'Undo'}</button></div>)}</details>}
      {c.state.mappings.length > 0 && <details className="libby-details"><summary>Linked books · {c.state.mappings.length}</summary>{c.state.mappings.map(mapping => <div className="libby-history" key={mapping.key}><span>{books.find(book => book.id === mapping.bookId)?.title ?? 'Book no longer in your library'}{mapping.paused ? ' · paused' : ''}</span><button disabled={c.busy} onClick={() => void c.unlink(mapping.key)}>Unlink</button></div>)}</details>}
      <p className="libby-caption">Only book details, public cover links and percentages are received. No library card, login, book text or reading history. Covers load from OverDrive when online; no image file is imported. A 100% capture leaves finishing the book to you.</p>
      {disconnecting ? <div className="libby-disconnect"><p>Disconnect and erase Libby matches, captures and undo history? Your books and their current progress stay in your library. Turn off the browser companion too to erase its last capture.</p><button disabled={c.busy} onClick={() => { void c.configure(false).then(ok => { if (ok) setDisconnecting(false) }) }}>Disconnect & erase</button><button onClick={() => setDisconnecting(false)}>Keep connected</button></div> : <button className="libby-disconnect-button" disabled={c.busy} onClick={() => setDisconnecting(true)}>Disconnect Libby</button>}
    </>}
    </div>
  </details>
}

function MatchRow({ item, books, controller: c }: { item: LibbyItem; books: LibraryBook[]; controller: LibbyController }) {
  const linked = c.state.mappings.find(mapping => mapping.key === item.key)
  const [selected, setSelected] = useState(linked?.bookId ?? '')
  const [expected, setExpected] = useState(books.find(book => book.id === linked?.bookId)?.lastUpdatedAt)
  const id = useId()
  const book = books.find(entry => entry.id === selected)
  const normalized = (value: string) => value.normalize('NFKC').toLocaleLowerCase().trim()
  const sorted = [...books].sort((a, b) => Number(normalized(b.title) === normalized(item.observation.title)) - Number(normalized(a.title) === normalized(item.observation.title)) || a.title.localeCompare(b.title))
  const movesShelf = !!book && book.shelf !== 'reading'
  return <article className="libby-match">
    <div className="libby-match-heading">{item.observation.coverUrl && <div className="libby-match-cover"><BookCover book={{ id: item.key, title: item.observation.title, authors: [item.observation.author], thumbnail: item.observation.coverUrl }} /></div>}<div className="libby-match-title"><small>{item.observation.format === 'audiobook' ? 'AUDIOBOOK' : 'EBOOK'}</small><h4>{item.observation.title}</h4><p>{item.observation.author}</p></div><span className="libby-percent">{item.observation.percent}<small>%</small></span></div>
    <p className="libby-caption">{item.reason} Captured {new Date(item.capturedAt).toLocaleString()}.</p>
    <label htmlFor={id}>Book in Wovenleaf</label>
    <select id={id} value={selected} disabled={c.busy} onChange={event => { setSelected(event.target.value); setExpected(books.find(entry => entry.id === event.target.value)?.lastUpdatedAt) }}>
      <option value="">Choose an existing book</option>{sorted.map(entry => <option key={entry.id} value={entry.id}>{entry.title} · {shelfCopy[entry.shelf].label} · {entry.progress}%{entry.format ? ` · ${entry.format}` : ''}</option>)}<option value="__new">Add as a new book on Reading</option>
    </select>
    {book && <p className="libby-caption">Wovenleaf {book.progress}% → Libby {item.observation.percent}%. Page markers stay unchanged.</p>}
    {movesShelf && <p className="libby-caption">This moves your existing book from {shelfCopy[book.shelf].label} to Reading and links it to Libby. Your notes, rating and cover stay. Undo restores its previous shelf and progress.</p>}
    <div className="libby-match-actions"><button className="libby-primary" disabled={c.busy || !selected} onClick={() => void c.apply(item.key, item.snapshotId, selected === '__new' ? null : selected, expected, movesShelf)}>{selected === '__new' ? 'Add & link book' : movesShelf ? 'Move to Reading & link' : 'Link & apply progress'}</button><button disabled={c.busy} onClick={() => void c.dismiss(item.key, item.snapshotId)}>Dismiss</button></div>
  </article>
}
