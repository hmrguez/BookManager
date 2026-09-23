import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Capacitor } from '@capacitor/core'
import { ArrowUpRight, Check, ChevronRight, Upload } from 'lucide-react'
import type { LibraryBook } from '../library-model'
import { shelfCopy } from '../app/config'
import { Sheet } from '../app/components/Sheet'
import { BookCover } from '../design-system/components'
import type { LibbyController } from './use-libby'
import type { LibbyItem } from './model'
import { companionListing, hasFreshCapture, readSetup, saveSetup, type SetupStep } from './setup'
import './libby.css'

export function LibbySettings({ controller: c, books, reveal = false, onRevealed }: { controller: LibbyController; books: LibraryBook[]; reveal?: boolean; onRevealed?: () => void }) {
  const android = Capacitor.getPlatform() === 'android'
  const [progress, setProgress] = useState(() => readSetup(Capacitor.getPlatform()))
  const [open, setOpen] = useState(false)
  const [checking, setChecking] = useState(false)
  const [checkSince, setCheckSince] = useState<string>()
  const [disconnecting, setDisconnecting] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const platform = progress.browser
  const browser = platform === 'safari' ? 'Safari' : platform === 'firefox' ? 'Firefox' : 'Quetta'
  const paired = !android || (c.connection?.paired && c.connection.browser === platform)
  const complete = c.state.enabled && paired && !!c.state.lastVerifiedCaptureAt && (!progress.checkingSince || hasFreshCapture(c.state.lastVerifiedCaptureAt, progress.checkingSince))
  const pending = c.state.items.filter(item => item.status === 'pending').slice().reverse()
  const listing = companionListing(platform, import.meta.env.VITE_LIBBY_EXTENSION_STORE_URL, import.meta.env.VITE_LIBBY_FIREFOX_STORE_URL)
  const verified = checking ? paired && hasFreshCapture(c.state.lastVerifiedCaptureAt, checkSince) : complete
  const step = checking ? 'verify' : c.ready && !c.state.enabled ? 'welcome' : progress.step
  useEffect(() => saveSetup(progress), [progress])
  useEffect(() => { if (reveal) { const frame = requestAnimationFrame(() => { setOpen(true); onRevealed?.() }); return () => cancelAnimationFrame(frame) } }, [reveal, onRevealed])
  useEffect(() => { if (open) heading.current?.focus() }, [open, step, complete, checking, verified])
  const close = () => { setOpen(false); setChecking(false); requestAnimationFrame(() => trigger.current?.focus()) }
  const advance = (next: SetupStep) => setProgress(previous => ({ ...previous, step: next }))
  async function begin() {
    if (await c.configure(true)) setProgress(previous => ({ ...previous, step: 'install', checkingSince: new Date().toISOString() }))
  }
  async function connect() {
    const since = new Date().toISOString()
    setProgress(previous => ({ ...previous, checkingSince: since }))
    if (await c.openBrowser(platform)) advance('verify')
  }
  async function checkConnection() {
    setChecking(true)
    setCheckSince(new Date().toISOString())
    if (android && c.connection?.paired && !c.connection.running) await c.resumeConnection()
    await c.refresh()
  }
  const status = pending.length ? `${pending.length} ${pending.length === 1 ? 'book' : 'books'} to review` : complete ? 'Connected' : c.state.enabled ? 'Finish connecting Libby' : 'Books and reading progress'
  return <>
    <section className="libby-settings libby-settings--compact settings-service">
      <button ref={trigger} className="libby-entry settings-service__entry" onClick={() => { setOpen(true); void c.refresh() }} aria-haspopup="dialog">
        <span className="settings-service__mark"><img src="/services/libby.png" alt="" width="40" height="40" /></span><span><strong>Libby</strong><small>{status}</small></span><ChevronRight size={18} aria-hidden="true" />
      </button>
    </section>
    {open && createPortal(<Sheet title="Libby" onClose={close} tall>
      <div className="libby-settings libby-flow">
        {c.error && <div className="libby-notice" role="status">Let’s try that again. Your books are still here.<details><summary>More information</summary><p>{c.error}</p></details></div>}
        {complete && !checking ? <>
          <p className="libby-eyebrow">CONNECTED WITH {browser.toUpperCase()}</p>
          <h2 ref={heading} tabIndex={-1}>Your reading, together.</h2>
          <p className="libby-caption">Read in Libby’s web reader or player. Open Wovenleaf to receive your books and progress.</p>
          <button className="libby-primary" onClick={() => void c.openBrowser(platform)}>Open Libby <ArrowUpRight size={18} aria-hidden="true" /></button>
          <button className="libby-row-action" disabled={c.busy} onClick={() => void checkConnection()}>Check connection <ChevronRight size={18} aria-hidden="true" /></button>
          <label className="libby-toggle"><span><strong>Add new loans to Reading</strong><small>Books already in your library are matched with your help.</small></span><input type="checkbox" checked={c.state.autoAdd} disabled={c.busy} onChange={event => void c.configure(true, c.state.automatic, event.target.checked)} /></label>
          <label className="libby-toggle"><span><strong>Update progress automatically</strong><small>You review earlier positions and changes you made yourself.</small></span><input type="checkbox" checked={c.state.automatic} disabled={c.busy} onChange={event => void c.configure(true, event.target.checked)} /></label>
          <button className="libby-row-action" onClick={() => { setProgress(previous => ({ ...previous, step: 'welcome', checkingSince: new Date().toISOString() })); setChecking(false) }}>Change browser or reconnect <ChevronRight size={18} aria-hidden="true" /></button>
        </> : <>
          <p className="libby-eyebrow">{checking ? 'CONNECTION CHECK' : `CONNECT LIBBY · ${['welcome', 'install', 'connect', 'verify'].indexOf(step) + 1} OF 4`}</p>
          <h2 ref={heading} tabIndex={-1}>{checking ? verified ? 'Everything is ready.' : 'Let’s check your connection.' : step === 'welcome' ? 'Bring your reading along.' : step === 'install' ? 'Add the companion.' : step === 'connect' ? 'Connect your browser.' : 'Open your Libby Shelf.'}</h2>
          {step === 'welcome' && <>
            <p>Connect Libby to bring your loans and reading progress into Wovenleaf. You’ll read through Libby in your browser.</p>
            <p className="libby-caption">Keep an internet connection while reading on the web.</p>
            {Capacitor.getPlatform() !== 'ios' && <fieldset className="libby-browser-choice"><legend>Where do you use Libby?</legend>{(['quetta', 'firefox'] as const).map(value => <label key={value}><input type="radio" name="libby-browser" checked={platform === value} onChange={() => setProgress(previous => ({ ...previous, browser: value }))} /><span>{value === 'quetta' ? 'Quetta' : 'Firefox'}</span></label>)}</fieldset>}
            <button className="libby-primary" disabled={!c.ready || c.busy} onClick={() => void begin()}>Continue <ChevronRight size={18} aria-hidden="true" /></button>
          </>}
          {step === 'install' && <>
            <p>{platform === 'safari' ? 'The companion comes with Wovenleaf. Turn it on in iPhone or iPad Settings → Apps → Safari → Extensions → Wovenleaf Libby.' : `Add the Wovenleaf companion to ${browser}. Your browser will ask you to allow access to Libby and its reader.`}</p>
            {platform !== 'safari' && (listing ? <button className="libby-primary" disabled={c.busy} onClick={() => void c.openBrowser(platform, listing)}>Get companion <ArrowUpRight size={18} aria-hidden="true" /></button> : <p className="libby-notice">The companion’s store listing isn’t available yet. If you already have it installed, you can continue.</p>)}
            <button className={platform === 'safari' ? 'libby-primary' : 'libby-row-action'} disabled={c.busy} onClick={() => advance('connect')}>{platform === 'safari' ? 'I’ve turned it on' : 'I’ve added the companion'} <ChevronRight size={18} aria-hidden="true" /></button>
          </>}
          {step === 'connect' && <>
            <p>{platform === 'safari' ? 'Open Libby in Safari and allow the companion to work on Libby when asked. Wovenleaf connects automatically.' : paired ? `${browser} is connected. Open your Shelf to check that your books can reach Wovenleaf.` : 'Automatic browser connection is not available in this version yet. If you’re already using the companion, you can connect with a code in More options below.'}</p>
            <button className="libby-primary" disabled={c.busy || (platform !== 'safari' && !paired)} onClick={() => void connect()}>{c.busy ? 'Opening…' : 'Open Libby'} <ArrowUpRight size={18} aria-hidden="true" /></button>
          </>}
          {step === 'verify' && <>
            <p role="status">{verified ? 'Libby reached Wovenleaf successfully. You’re ready to read.' : 'Open your Shelf in Libby, then come back here. We’ll check that your library can reach Wovenleaf—even if you have no loans yet.'}</p>
            {verified ? <button className="libby-primary" onClick={() => setChecking(false)}>Done <Check size={18} aria-hidden="true" /></button> : <>
              <button className="libby-primary" disabled={c.busy} onClick={() => void c.openBrowser(platform)}>Open Libby to {checking ? 'finish checking' : 'continue'} <ArrowUpRight size={18} aria-hidden="true" /></button>
              <button className="libby-row-action" disabled={c.busy} onClick={() => void c.refresh()}>{c.busy ? 'Checking…' : 'Check again'}</button>
              <details className="libby-details"><summary>My library isn’t in Libby yet</summary><p>In Libby on the web, choose “Yes, I Have A Library Card”, then “Recover Your Data”. Use your Libby passkey if you have one.</p><p>Otherwise, choose “Display Setup Code”. In the Libby app, open Menu → Copy To Another Device and enter that code. Return to your browser when the transfer finishes.</p><a href="https://help.libbyapp.com/en-us/6070.htm" target="_blank" rel="noreferrer">Help from Libby <ArrowUpRight size={14} aria-hidden="true" /></a></details>
              <details className="libby-details"><summary>Need a hand?</summary><p>Make sure the Wovenleaf companion is enabled in {browser} and allowed on Libby. Refresh your Libby Shelf, then return here.</p><button disabled={c.busy} onClick={() => { setChecking(false); setProgress(previous => ({ ...previous, step: 'connect', checkingSince: new Date().toISOString() })) }}>Connect the browser again</button><button onClick={() => { setChecking(false); setProgress(previous => ({ ...previous, step: 'install', checkingSince: new Date().toISOString() })) }}>Check companion installation</button></details>
            </>}
          </>}
          {step !== 'welcome' && !checking && <button className="libby-back" onClick={() => advance(step === 'verify' ? 'connect' : step === 'connect' ? 'install' : 'welcome')}>Back</button>}
        </>}
        {pending.length > 0 && <div className="libby-review"><h3>Books to review <span>{pending.length}</span></h3>{pending.map(item => <MatchRow key={`${item.key}:${item.snapshotId}:${books.find(book => book.id === c.state.mappings.find(mapping => mapping.key === item.key)?.bookId)?.lastUpdatedAt ?? 'unlinked'}`} item={item} books={books} controller={c} />)}</div>}
        {c.state.enabled && <>
          <details className="libby-details"><summary>More options</summary>
            {android && <><button disabled={c.busy} onClick={() => void c.pair()}>Use a connection code instead</button>{c.pairingCode && <><output className="libby-code">{c.pairingCode.match(/.{1,4}/g)?.join(' ')}</output><button disabled={c.busy} onClick={() => void c.copyCode()}>Copy code</button><p className="libby-caption">In the companion, open Connection help and paste this code. It expires after five minutes.</p></>}</>}
            <div className="libby-import"><label><Upload size={16} aria-hidden="true" /> Import progress file<input type="file" accept=".json,application/json" disabled={c.busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void c.receiveFile(file) }} /></label></div>
            <p className="libby-caption">Only book details, public cover links and percentages are received. No library card, login, book text or reading history. Your books stay in Wovenleaf if you disconnect.</p>
          </details>
          {c.state.receipts.length > 0 && <details className="libby-details"><summary>Recent updates</summary>{c.state.receipts.slice().reverse().slice(0, 10).map(receipt => <div className="libby-history" key={receipt.id}><div><strong>{receipt.title}</strong><small>{receipt.before.progress}% → {receipt.after.progress}%</small></div><button disabled={c.busy || receipt.undone || books.find(book => book.id === receipt.bookId)?.lastUpdatedAt !== receipt.after.lastUpdatedAt} onClick={() => void c.undo(receipt.id)}>{receipt.undone ? 'Undone' : 'Undo'}</button></div>)}</details>}
          {c.state.mappings.length > 0 && <details className="libby-details"><summary>Linked books · {c.state.mappings.length}</summary>{c.state.mappings.map(mapping => <div className="libby-history" key={mapping.key}><span>{books.find(book => book.id === mapping.bookId)?.title ?? 'Book no longer in your library'}</span><button disabled={c.busy} onClick={() => void c.unlink(mapping.key)}>Unlink</button></div>)}</details>}
          {disconnecting ? <div className="libby-disconnect"><p>Disconnect Libby? Your books and their progress stay in Wovenleaf. Connection history and matches will be removed.</p><button disabled={c.busy} onClick={() => void c.configure(false).then(ok => { if (ok) { setDisconnecting(false); setChecking(false); setProgress({ browser: platform, step: 'welcome' }) } })}>Disconnect Libby</button><button onClick={() => setDisconnecting(false)}>Keep connected</button></div> : <button className="libby-disconnect-button" disabled={c.busy} onClick={() => setDisconnecting(true)}>Disconnect Libby</button>}
        </>}
      </div>
    </Sheet>, document.body)}
  </>
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
