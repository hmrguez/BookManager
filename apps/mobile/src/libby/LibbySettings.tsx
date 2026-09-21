import { useEffect, useId, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { ArrowUpRight, BookOpen, Check, ChevronDown, Upload } from 'lucide-react'
import type { LibraryBook } from '../library-model'
import { shelfCopy } from '../app/config'
import { BookCover } from '../design-system/components'
import type { LibbyController } from './use-libby'
import type { LibbyItem } from './model'
import './libby.css'

function storeUrl(platform: 'safari' | 'quetta' | 'firefox'): string | undefined {
  try {
    const url = new URL((platform === 'firefox' ? import.meta.env.VITE_LIBBY_FIREFOX_STORE_URL : import.meta.env.VITE_LIBBY_EXTENSION_STORE_URL) ?? '')
    if (url.protocol === 'https:' && (platform === 'firefox' ? ['addons.mozilla.org'] : ['chromewebstore.google.com', 'microsoftedge.microsoft.com']).includes(url.hostname)) return url.href
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
  const [platform, setPlatform] = useState<'safari' | 'quetta' | 'firefox'>(() => {
    try { const saved = localStorage.getItem('wovenleaf-libby-browser'); if (saved === 'safari' || saved === 'quetta' || saved === 'firefox') return saved } catch { /* Storage may be unavailable. */ }
    return Capacitor.getPlatform() === 'android' ? 'quetta' : 'safari'
  })
  useEffect(() => { try { localStorage.setItem('wovenleaf-libby-browser', platform) } catch { /* The guide still works without storage. */ } }, [platform])
  const [guideOpen, setGuideOpen] = useState(!c.state.enabled)
  const [disconnecting, setDisconnecting] = useState(false)
  const id = useId()
  const pending = c.state.items.filter(item => item.status === 'pending').slice().reverse()
  const listing = storeUrl(platform)
  const browser = platform === 'firefox' ? 'Firefox' : platform === 'quetta' ? 'Quetta' : 'Safari'
  return <details ref={panel} className="libby-settings">
    <summary className="libby-summary"><BookOpen size={22} aria-hidden="true" /><span><strong>Libby</strong><small role="status">{c.error ? 'Needs attention' : pending.length ? `${pending.length} ${pending.length === 1 ? 'book' : 'books'} to review` : c.state.enabled ? 'Connected reading · enabled' : 'Connect your books and reading progress'}</small></span><ChevronDown className="libby-chevron" size={18} aria-hidden="true" /></summary>
    <div className="libby-panel" aria-labelledby={`${id}-heading`}>
    <h2 id={`${id}-heading`}>Your place, kept.</h2>
    <p className="libby-intro">Your Libby books, automatically on Reading. Your progress follows.</p>
    <p className="libby-caption">Visit your Libby web Shelf once to capture your loans. Progress then follows your web reader or audiobook player automatically. Open Wovenleaf to see your updates.</p>
    {c.error && <p className="libby-error" role="alert">{c.error}</p>}
    {!c.state.enabled ? <button className="libby-primary" disabled={!c.ready || c.busy} onClick={() => { void c.configure(true); setGuideOpen(true) }}>Enable Libby progress <ArrowUpRight size={18} aria-hidden="true" /></button>
      : <>
        <div className="libby-status" role="status"><Check size={16} aria-hidden="true" /><span>{c.state.lastReceivedAt ? `Last received ${new Date(c.state.lastReceivedAt).toLocaleString()}` : 'Enabled · waiting for your first shelf capture'}</span></div>
        <label className="libby-toggle"><span><strong>Add new loans to Reading</strong><small>New titles arrive automatically. If a title is already in your library, you choose its matching edition once.</small></span><input type="checkbox" checked={c.state.autoAdd} disabled={c.busy} onChange={event => void c.configure(true, c.state.automatic, event.target.checked)} /></label>
        <label className="libby-toggle"><span><strong>Update progress automatically</strong><small>Forward progress applies when Wovenleaf opens. Backward positions and manual edits stay in review.</small></span><input type="checkbox" checked={c.state.automatic} disabled={c.busy} onChange={event => void c.configure(true, event.target.checked)} /></label>
        {Capacitor.getPlatform() === 'android' && <div className="libby-connection">
          <h3>Browser connection</h3>
          <p className="libby-caption">Captures travel directly on this phone, with no share sheet. Android keeps a visible Libby connection notification. Reopen Wovenleaf after a phone restart or force-stop.</p>
          <p role="status">{c.connection?.paired ? (c.connection.running ? 'Connected · ready for captures' : 'Connection paused') : 'Your browser is not connected yet'}</p>
          {c.connection?.error && <p className="libby-error">{c.connection.error}</p>}
          {c.connection?.paired && !c.connection.running && <button onClick={() => void c.resumeConnection()} disabled={c.busy}>Resume connection</button>}
          <button onClick={() => void c.pair()} disabled={c.busy}>{c.connection?.paired ? 'Reconnect or switch browser' : 'Get connection code'}</button>
          {c.pairingCode && <div><output className="libby-code" aria-label="One-time connection code">{c.pairingCode.match(/.{1,4}/g)?.join(' ')}</output><button onClick={() => void c.copyCode()} disabled={c.busy}>Copy code</button><p className="libby-caption">Paste this into the Wovenleaf companion in your browser and choose Connect & enable capture. It expires after five minutes. This is a Wovenleaf connection code, separate from Libby’s device setup code.</p></div>}
        </div>}
      </>}
    <button className="libby-row-action" aria-expanded={guideOpen} aria-controls={`${id}-guide`} onClick={() => setGuideOpen(!guideOpen)}>{guideOpen ? 'Close setup guide' : 'Browser setup guide'} <span aria-hidden="true">{guideOpen ? '−' : '+'}</span></button>
    {guideOpen && <div id={`${id}-guide`} className="libby-guide">
      <div className="libby-platforms" role="group" aria-label="Choose your browser">
        <button aria-pressed={platform === 'safari'} onClick={() => setPlatform('safari')}>Safari <small>iOS 15.4 or later</small></button>
        <button aria-pressed={platform === 'quetta'} onClick={() => setPlatform('quetta')}>Quetta <small>Android</small></button>
        <button aria-pressed={platform === 'firefox'} onClick={() => setPlatform('firefox')}>Firefox <small>Android · testing</small></button>
      </div>
      <p className="libby-caption">Four stages · your browser and Libby will ask for their own permissions.</p>
      <ol>
        <li><strong>Add the companion</strong>{platform === 'safari' ? <p>Included with Wovenleaf. In iPhone or iPad Settings, open Apps → Safari → Extensions → Wovenleaf Libby and enable it. Allow access to libbyapp.com and its Libby/OverDrive reader and audio player when asked.</p> : listing ? <><p>Install “Wovenleaf · Libby progress” in {browser} and allow access to Libby and its reader and audio player.</p><a href={listing} target="_blank" rel="noreferrer">Open {browser} companion listing <ArrowUpRight size={14} aria-hidden="true" /></a></> : platform === 'firefox' ? <p>The Firefox companion is in testing. A signed Mozilla download or store listing is needed before normal installation is available. Use Quetta for the verified Android setup.</p> : <><p>The companion ZIP is included with this app. Store installation is not available yet.</p>{Capacitor.getPlatform() === 'android' ? <><button disabled={c.busy} onClick={() => void c.saveCompanion()}>Save companion to phone <ArrowUpRight size={14} aria-hidden="true" /></button>{c.companionSaved && <p role="status">Saved. Now install the ZIP in Quetta.</p>}</> : <a href="/libby/wovenleaf-libby-chromium.zip" download>Download companion ZIP</a>}<p className="libby-caption">In Quetta: Extensions → Manage Extensions → Developer options → Developer mode → from .zip/.crx/.user.js. Select the saved ZIP, then allow access to Libby. Verified with Quetta 2.0.5.</p></>}</li>
        <li><strong>Connect Wovenleaf</strong><p>{platform === 'safari' ? 'Enable Libby progress above. Open the companion in Safari’s page menu and turn on “Capture Libby web progress”.' : 'Enable Libby progress above, then get a connection code. Open the Wovenleaf companion in your browser, paste the code and choose “Connect & enable capture”.'} New loans join Reading and forward progress updates automatically. You can change these preferences above.</p>{platform !== 'safari' && <p className="libby-caption">Only one browser can be paired at a time. Reconnecting preserves your books and links.</p>}</li>
        <li><strong>Connect your Libby library</strong><p>Already see your loans in {browser}? Continue to the next stage. Otherwise, open <b>libbyapp.com</b> in {browser}: “Yes, I Have A Library Card” → “Recover Your Data” → “Display Setup Code”. In the Libby app, choose Menu → Copy To Another Device and enter the website’s code. Return to {browser} and wait for the transfer.</p><p className="libby-caption">Libby’s setup code is separate from the Wovenleaf connection code.</p></li>
        <li><strong>Start reading</strong><p>Visit Libby’s web Shelf once, then open a book in its web reader or audiobook player. Return to Wovenleaf to receive your title and percentage.</p><p role="status">{c.state.lastReceivedAt ? 'Book and progress received. Check below for any matches that need review.' : 'Waiting for your first book and percentage.'}</p></li>
      </ol>
      <p className="libby-caption">Brave on Android is not supported for this companion. Firefox Android is in testing; Firefox on iPhone cannot use it.</p>
      <div className="libby-guide-footnote"><strong>If progress hasn’t arrived</strong><p>After updating the companion, refresh Libby. Visit its Shelf once, then open your book in the web reader or player and leave it open briefly. Keep access to the Libby reader and audio player enabled. A lower position needs review in the book’s Libby link.</p><p>For native-app reading, use Shelf → Actions → Synchronize Shelf and wait for its percentage to update. Native-to-web sync timing is controlled by Libby. Missing progress stays unknown.</p></div>
      <a href="https://help.libbyapp.com/en-us/6023.htm" target="_blank" rel="noreferrer">Libby’s guide to syncing devices <ArrowUpRight size={14} aria-hidden="true" /></a>
    </div>}
    {c.state.enabled && <>
      <details className="libby-details"><summary>Connection help & file fallback</summary><p className="libby-caption">If Android’s connection was paused, use Resume connection above. Reopen Wovenleaf after a phone restart or force-stop, then revisit your web Shelf.</p><div className="libby-import"><label className={c.busy ? 'is-busy' : ''}><Upload size={16} aria-hidden="true" /> Import progress file<input type="file" accept=".json,application/json" aria-label="Import Libby progress file" disabled={c.busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void c.receiveFile(file) }} /></label><button disabled={c.busy} onClick={() => void c.refresh()}>Check received captures</button></div></details>
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
