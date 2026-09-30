import { t, useLanguage } from '../localization'
import { useState } from 'react'
import type { ReviewArtwork } from './keepsake-model'

import { pathwayArtworkSource } from './presentation'

export function PathwayArtwork({ artwork }: { artwork: ReviewArtwork }) {
  useLanguage()
  const source = pathwayArtworkSource(artwork)
  const [failedSource, setFailedSource] = useState('')
  const ink = source.startsWith('/reviews/ink-v1/')
  return <div className="review-artwork">
    {failedSource === source ? <p>{t("Illustration unavailable. Your pathway is saved.")}</p> : <span className={ink ? 'review-ink' : undefined}
      style={ink ? { maskImage: `url("${source}")`, WebkitMaskImage: `url("${source}")` } : undefined}>
      <img src={source} alt="" onError={() => setFailedSource(source)} />
    </span>}
  </div>
}
