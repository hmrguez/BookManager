import { useState, type InputHTMLAttributes } from 'react'
import { Capacitor } from '@capacitor/core'
import { pickOriginalFiles } from './original-files'

/** Preserves the existing labelled picker surface; native selections retain access to the original. */
export function OriginalFileInput({ kind, folder = false, onFiles, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> & {
  readonly kind: 'ebook' | 'audio'
  readonly folder?: boolean
  readonly onFiles: (files: File[]) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  return <>
    <input {...props} type="file" disabled={props.disabled || busy}
      ref={(node) => { if (folder) node?.setAttribute('webkitdirectory', '') }}
      onClick={(event) => {
        if (!Capacitor.isNativePlatform()) return
        event.preventDefault()
        setError(undefined)
        setBusy(true)
        void pickOriginalFiles(kind, folder).then((files) => { if (files.length) onFiles(files) })
          .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'The file could not be opened.'))
          .finally(() => setBusy(false))
      }}
      onChange={(event) => {
        if (event.currentTarget.files?.length) onFiles(Array.from(event.currentTarget.files))
        event.currentTarget.value = ''
      }} />
    {error && <small role="alert" className="col-span-full block min-w-0 w-full py-2 text-center text-[var(--text-secondary)]">{error}</small>}
  </>
}
