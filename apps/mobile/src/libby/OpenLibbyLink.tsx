import { Capacitor, registerPlugin } from '@capacitor/core'
import { useState } from 'react'
import { ChevronRight } from 'lucide-react'

const native = registerPlugin<{ openShelf(): Promise<void> }>('WovenleafLibby')

export function OpenLibbyLink() {
  const [error, setError] = useState<string>()
  const [opening, setOpening] = useState(false)
  const android = Capacitor.getPlatform() === 'android'

  async function open() {
    setError(undefined)
    setOpening(true)
    try { await native.openShelf() }
    catch { setError('Could not open Libby in a browser. Make sure Quetta or another browser is installed, then try again.') }
    finally { setOpening(false) }
  }

  return <>
    {android ? <button className="book-source__primary" type="button" disabled={opening} onClick={() => void open()}>
      {opening ? 'Opening…' : 'Open Libby in browser'} <ChevronRight size={17} aria-hidden="true" />
    </button> : <a className="book-source__primary" href="https://libbyapp.com/shelf" target="_blank" rel="noreferrer">Open in Libby <ChevronRight size={17} aria-hidden="true" /></a>}
    {error && <p className="book-source__message" role="alert">{error}</p>}
  </>
}
