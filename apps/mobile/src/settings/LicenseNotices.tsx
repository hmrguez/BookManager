import { useState } from 'react'
import { t, useLanguage } from '../localization'

/** Readable offline in a native WebView; no external browser or account is needed. */
export function LicenseNotices() {
  useLanguage()
  const [text, setText] = useState('')
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)
  const load = async () => {
    if (text || loading) return
    setLoading(true)
    setError(false)
    try {
      const response = await fetch('/licenses/NOTICES.txt')
      if (!response.ok) throw new Error('Notices unavailable')
      setText(await response.text())
    } catch { setError(true) } finally { setLoading(false) }
  }
  return <details onToggle={event => { if (event.currentTarget.open) void load() }}>
    <summary>{t('Open-source licenses')}</summary>
    <p>{t('Wovenleaf is free and open source. Third-party components retain their own licenses.')}</p>
    <p><a href="https://github.com/hmrguez/wovenleaf/tree/main/third_party/capacitor-share-target" target="_blank" rel="noreferrer">{t('Corresponding source for the MPL-licensed share extension')}</a></p>
    {loading && <p role="status">{t('Loading…')}</p>}
    {error && <p role="alert"><button type="button" onClick={() => void load()}>{t('Try again')}</button></p>}
    {text && <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '24rem', overflow: 'auto', fontSize: '12px' }}>{text}</pre>}
  </details>
}
