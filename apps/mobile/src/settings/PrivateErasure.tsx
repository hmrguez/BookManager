import { LocalizedError } from '../localization/LocalizedError'
import { t, useLanguage } from '../localization'
import { useEffect, useState } from 'react'
import { getStorageRuntime } from '../storage/runtime'
import type { ErasurePreview } from '../storage/private-erasure'
import type { LibraryBook } from '../library-model'
import { tw } from '../tailwind/styles'

export function PrivateErasure({ books }: { books: readonly LibraryBook[] }) {
  useLanguage()
  const [selected, setSelected] = useState('')
  const [preview, setPreview] = useState<ErasurePreview>()
  const [pending, setPending] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { void getStorageRuntime().then(async r => setPending(await r.recovery.hasPendingErasure())).catch(() => setError('Could not check private cleanup status.')) }, [])
  async function run(apply: boolean) {
    setBusy(true); setError('')
    try {
      const runtime = await getStorageRuntime()
      if (pending) { await runtime.recovery.finishPrivateErasure(); window.location.reload() }
      else if (apply && preview) { await runtime.privateErasure.erase(preview.token); window.location.reload() }
      else setPreview(await runtime.privateErasure.preview(selected || undefined))
    } catch (error) {
      setError(error instanceof Error ? error.message : t("Erasure could not finish. Retry cleanup."))
      try { setPending(await (await getStorageRuntime()).recovery.hasPendingErasure()) } catch { /* Keep the original failure visible; startup can retry the durable marker. */ }
    } finally { setBusy(false) }
  }
  return <section className={`${tw('settings-card')} private-erasure-card`} aria-label={t("Erase private reading history")} aria-busy={busy}>
    <div className={tw('settings-card__heading')}><h2>{t("Private reading history")}</h2><p>{t("Deliberately erase a book and its history, or start with an empty library.")}</p></div>
    {error && <p role="alert">{<LocalizedError message={error} />}</p>}
    {pending ? <><p role="alert">{t("Erasure is not complete. Your history was removed from the library, but managed copies may remain. Retry cleanup to remove them and save a clean recovery point.")}</p><button disabled={busy} onClick={() => void run(true)}>{t("Retry private cleanup")}</button></>
      : <><label>{t("Erase")}<select aria-label={t("Erase")} value={selected} disabled={busy} onChange={e => { setSelected(e.target.value); setPreview(undefined) }}><option value="">{t("Whole library and private history")}</option>{books.map(b => <option value={b.id} key={b.id}>{b.title}</option>)}</select></label>
        {!preview ? <button disabled={busy} onClick={() => void run(false)}>{t("Preview erasure")}</button> : <div role="region" aria-label={t("Private erasure preview")}>
          <h3>{t("This will be erased")}</h3><p>{preview.books.length} {preview.books.length === 1 ? t("book and its") : t("books and their")} {t(" reading history, notes, ratings and saved activity.")}</p>
          <ul>{preview.books.map((title, i) => <li key={i}>{title}</li>)}</ul>
          <p>{preview.reviews.length} {t(" dependent")}{preview.reviews.length === 1 ? 'keepsake' : 'keepsakes'}{t(", including personal-best comparisons:")}</p><ul>{preview.reviews.map(q => <li key={`${q.year}-${q.quarter}`}>{q.year} {t(" · Q")}{q.quarter}</li>)}</ul>
          <p>{t("All local recovery and migration copies will be removed. Import undo history and cached captures will be cleared, Libby sync disabled, and Up Next reset. A clean recovery point will replace them.")}</p>
          <p>{t("Previously exported backups and shared images are outside Wovenleaf’s control. Restoring an old external backup can bring erased data back.")}</p>
          <p>{t("Book files you downloaded are separate from reading history. This cannot be undone.")}</p>
          <button disabled={busy} onClick={() => void run(true)}>{t("Erase this private history")}</button><button disabled={busy} onClick={() => setPreview(undefined)}>{t("Cancel")}</button>
        </div>}</>}
  </section>
}
