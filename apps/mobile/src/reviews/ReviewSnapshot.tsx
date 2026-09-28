import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { ReviewKeepsake } from './keepsake-model'
import type { ReviewKeepsakeRepository } from './keepsake-repository'
import { snapshotChanges, snapshotContent, snapshotDefaults, snapshotRevision, retainSnapshotSelection, type SnapshotSelection } from './snapshot'
import { renderSnapshot, SnapshotRenderError } from './snapshot-render'
import { exportSnapshot } from './snapshot-export'
import { badgeFact } from './presentation'

export function ReviewSnapshot({ initial, repository, onClose, onDeleted }: {
  initial: ReviewKeepsake; repository: ReviewKeepsakeRepository; onClose: () => void; onDeleted: () => void
}) {
  const [saved, setSaved] = useState(initial)
  const [selection, setSelection] = useState(() => snapshotDefaults(initial))
  const [rendered, setRendered] = useState({ key: '', image: '', error: '' })
  const [attempt, setAttempt] = useState(0)
  const [failure, setFailure] = useState('')
  const [message, setMessage] = useState('')
  const [changes, setChanges] = useState<string[]>([])
  const alive = useRef(true)
  const [stale, setStale] = useState(false)
  const [busy, setBusy] = useState(false)
  const [enlarged, setEnlarged] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const lock = useRef(false)
  const revision = snapshotRevision(saved)
  const period = { year: saved.facts.quarter.year, quarter: saved.facts.quarter.quarter }
  let content: ReturnType<typeof snapshotContent> | undefined
  try { content = snapshotContent(saved, selection, document.documentElement.lang || navigator.language) } catch { /* Empty selection remains editable. */ }
  const serialized = JSON.stringify(content)
  const renderKey = `${serialized}:${attempt}`
  const image = rendered.key === renderKey ? rendered.image : ''
  const renderError = rendered.key === renderKey ? rendered.error : ''
  const deleted = useEffectEvent(onDeleted)
  useEffect(() => { alive.current = true; heading.current?.focus(); return () => { alive.current = false } }, [])
  useEffect(() => {
    let active = true
    if (!serialized) return
    void renderSnapshot(JSON.parse(serialized)).then(url => { if (active) setRendered({ key: renderKey, image: url, error: '' }) }).catch(error => {
      if (active) setRendered({ key: renderKey, image: '', error: error instanceof SnapshotRenderError ? error.reason : 'render' })
    })
    return () => { active = false }
  }, [serialized, renderKey])
  useEffect(() => {
    let active = true
    const check = async () => {
      try {
        const current = await repository.get({ year: saved.facts.quarter.year, quarter: saved.facts.quarter.quarter })
        if (!active) return
        if (!current) { deleted(); return }
        if (snapshotRevision(current) !== revision) setStale(true)
      } catch { if (active) setFailure('Could not check the saved review. Try again before exporting.') }
    }
    void check()
    const timer = setInterval(() => void check(), 1500)
    window.addEventListener('focus', check)
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', check) }
  }, [repository, saved.facts.quarter.year, saved.facts.quarter.quarter, revision])
  async function refresh() {
    try {
      const current = await repository.get(period)
      if (!current) { onDeleted(); return }
      if (!alive.current) return
      setChanges(snapshotChanges(saved, current, selection))
      setSelection(previous => retainSnapshotSelection(previous, current)); setSaved(current); setStale(false)
      setFailure(''); setMessage('Preview refreshed. Still-earned selections were kept. Review the image before exporting.')
    } catch { setFailure('Could not refresh this preview. Please try again.') }
  }
  async function send(action: 'save' | 'share') {
    if (!image || stale || lock.current) return
    lock.current = true; setBusy(true); setFailure(''); setMessage('')
    try {
      const current = await repository.get(period)
      if (!current) { onDeleted(); return }
      if (!alive.current) return
      if (snapshotRevision(current) !== revision) { setStale(true); return }
      const result = await exportSnapshot(image, action)
      setMessage(result.status === 'saved' ? 'Image saved.' : result.status === 'download-requested' ? 'Download requested. Check your downloads for the image.'
        : result.status === 'cancelled' ? 'Cancelled. Your preview is still here.' : 'Returned from sharing. Nothing is posted automatically by Wovenleaf.')
    } catch { setFailure('The image could not be exported. Your selections are kept. Try again, or save the image instead.') }
    finally { lock.current = false; setBusy(false) }
  }
  const change = (update: Partial<SnapshotSelection>) => { setSelection(s => ({ ...s, ...update })); setMessage('') }
  return <section className="review-snapshot" aria-label="Keepsake image preview" aria-busy={busy}>
    <button className="review-quiet" disabled={busy} onClick={onClose}>Back to keepsake</button>
    <h3 ref={heading} tabIndex={-1}>A season worth sharing</h3>
    <p>Only your pathway and selected achievements appear. Book titles, notes and detailed activity stay private.</p>
    <fieldset disabled={busy} className="snapshot-options"><legend>Make it yours</legend>
      <label>Image format<select value={selection.format} onChange={e => change({ format: e.target.value === 'story' ? 'story' : 'post' })}><option value="post">Post · 1080 × 1080</option><option value="story">Story · 1080 × 1920</option></select></label>
      <label>Image language<select value={selection.language} onChange={e => change({ language: e.target.value })}><option value="app">App language</option><option value="en">English</option></select></label>
      {saved.identity.status === 'chosen' && <label className="snapshot-check"><input type="checkbox" checked={selection.identity} onChange={e => change({ identity: e.target.checked })} />Include chosen pathway</label>}
      <fieldset><legend>Choose up to three badges · {selection.badgeIds.length}/3</legend>{saved.facts.earned.map(b => <label className="snapshot-check" key={b.id}>
        <input type="checkbox" checked={selection.badgeIds.includes(b.id)} disabled={!selection.badgeIds.includes(b.id) && selection.badgeIds.length >= 3}
          onChange={e => change({ badgeIds: e.target.checked ? [...selection.badgeIds, b.id] : selection.badgeIds.filter(id => id !== b.id) })} />
        <span>{b.name}<small>{badgeFact(b)}</small></span>
      </label>)}</fieldset>
    </fieldset>
    {content?.notice && <p role="status">{content.notice}</p>}
    {!content && <p role="status">Choose a badge or include your pathway to make an image.</p>}
    {stale && <div role="alert"><p>This keepsake changed. Refresh the preview before saving or sharing.</p><button disabled={busy} onClick={() => void refresh()}>Refresh preview</button></div>}
    {renderError && <div role="alert"><p>{renderError === 'artwork' ? 'The pathway artwork could not be rendered. Retry or choose a badge-only image.' : renderError === 'overflow' ? 'This composition needs more room. Choose Story or fewer badges; no text has been clipped.' : 'The image could not be rendered. Please retry.'}</p>
      {renderError === 'artwork' && <button onClick={() => change({ identity: false })}>Use badge-only image</button>}
      {renderError === 'overflow' && selection.format === 'post' && <button onClick={() => change({ format: 'story' })}>Use roomier Story</button>}
      <button onClick={() => setAttempt(value => value + 1)}>Retry rendering</button>
    </div>}
    {image && <><button className="snapshot-image" onClick={() => setEnlarged(!enlarged)} aria-expanded={enlarged} aria-label={enlarged ? 'Reduce image preview' : 'Enlarge image preview'}><img src={image} alt="Your reading quarter. Full image text follows below." /></button>
      {enlarged && <div className="snapshot-enlarged" tabIndex={0} role="region" aria-label="Enlarged image, scroll to explore"><img src={image} alt="Enlarged reading-quarter image" /></div>}</>}
    {content && <details className="snapshot-equivalent"><summary>Read image text</summary><div lang={content.language}><p>A season among pages · {content.period}</p><h4>{content.title}</h4>{content.badges.map(b => <p key={b.id}><strong>{b.title}</strong><br />{b.caption}{b.personalBest && <><br />Your best recorded quarter</>}</p>)}<p>Wovenleaf · {content.quarter}</p></div></details>}
    {changes.length > 0 && <ul aria-label="Changes in this preview">{changes.map(change => <li key={change}>{change}</li>)}</ul>}
    {failure && <p role="alert">{failure}</p>}{message && <p role="status">{message}</p>}
    <div className="review-actions"><button className="review-primary" disabled={!image || stale || busy} onClick={() => void send('save')}>Save image</button><button disabled={!image || stale || busy} onClick={() => void send('share')}>Share image</button></div>
  </section>
}
