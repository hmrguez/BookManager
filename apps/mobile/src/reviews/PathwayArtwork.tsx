import { useState } from 'react'
import type { ReviewArtwork } from './keepsake-model'

/** Known legacy keepsakes use the same illustration, now extracted as themeable ink. */
function artworkSource(artwork: ReviewArtwork) {
  return artwork.version === 'approved-concept-preview-v1'
    ? artwork.finishedStill.replace('/reviews/concepts/', '/reviews/ink-v1/')
    : artwork.finishedStill
}

export function PathwayArtwork({ artwork }: { artwork: ReviewArtwork }) {
  const source = artworkSource(artwork)
  const [failedSource, setFailedSource] = useState('')
  const ink = source.startsWith('/reviews/ink-v1/')
  return <div className="review-artwork">
    {failedSource === source ? <p>Illustration unavailable. Your pathway is saved.</p> : <span className={ink ? 'review-ink' : undefined}
      style={ink ? { maskImage: `url("${source}")`, WebkitMaskImage: `url("${source}")` } : undefined}>
      <img src={source} alt="" onError={() => setFailedSource(source)} />
    </span>}
  </div>
}
