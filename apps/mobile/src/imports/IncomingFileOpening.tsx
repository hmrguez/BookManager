import { useLayoutEffect, useRef } from 'react'
import { BookOpen, FileText, Headphones } from 'lucide-react'
import './incoming-file-opening.css'

export type IncomingFileOpeningState = {
  readonly name?: string
  readonly audio?: boolean
  readonly phase: 'reading' | 'preparing' | 'opening'
}

export function IncomingFileOpening({ state }: { state: IncomingFileOpeningState }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const audio = state.audio ?? /\.(?:m4b|m4a|mp4|mp3)$/i.test(state.name ?? '')
  const Icon = audio ? Headphones : /\.pdf$/i.test(state.name ?? '') ? FileText : BookOpen
  const detail = state.phase === 'reading'
    ? 'Reading the shared file…'
    : state.phase === 'preparing'
      ? 'Preparing your file…'
      : audio ? 'Opening the player…' : 'Opening the reader…'

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className="incoming-file-opening"
      aria-labelledby="incoming-file-title"
      aria-describedby="incoming-file-detail"
      data-phase={state.phase}
      onCancel={(event) => event.preventDefault()}
    >
      <div className="incoming-file-opening__content">
        <span className="incoming-file-opening__wordmark">Wovenleaf</span>
        <div className="incoming-file-opening__symbol" aria-hidden="true"><Icon /></div>
        <h1 id="incoming-file-title">Opening your<br />{audio ? 'audiobook.' : 'file.'}</h1>
        {state.name && <p className="incoming-file-opening__filename">{state.name}</p>}
        <div className="incoming-file-opening__activity" aria-hidden="true"><span /></div>
        <p id="incoming-file-detail" className="incoming-file-opening__detail" role="status" aria-live="polite" aria-atomic="true">{detail}</p>
        <p className="incoming-file-opening__note">Larger files can take a little longer.</p>
      </div>
    </dialog>
  )
}
