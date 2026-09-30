import { useState } from 'react'
import { t, translateKnownCopy, useLanguage } from './index'

/** Raw system/provider diagnostics are available on demand, never mistaken for translated app copy. */
export function LocalizedError({ message }: { message: string }) {
  useLanguage()
  const [expanded, setExpanded] = useState(false)
  const localized = translateKnownCopy(message)
  if (localized) return <span>{localized}</span>
  return <span className="localized-error">
    <span>{t('This action could not be completed. Please try again.')}</span>{' '}
    <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{t('Details')}</button>
    {expanded && <span className="localized-error__details">{message}</span>}
  </span>
}
