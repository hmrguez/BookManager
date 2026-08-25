import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './design-system/fonts.css'
import './index.css'

const root = createRoot(document.getElementById('root')!)
const isDevelopmentGallery = import.meta.env.DEV && window.location.pathname === '/__gallery'
const isDevelopmentConflictInbox = import.meta.env.DEV && window.location.pathname === '/__conflicts'
const isDevelopmentDuplicateReview = import.meta.env.DEV && window.location.pathname === '/__duplicates'

if (isDevelopmentGallery) {
  const { ComponentGallery } = await import('./gallery/ComponentGallery')
  root.render(<StrictMode><ComponentGallery /></StrictMode>)
} else if (isDevelopmentConflictInbox) {
  const { ConflictInboxPrototype } = await import('./conflicts/ConflictInboxPrototype')
  root.render(<StrictMode><ConflictInboxPrototype /></StrictMode>)
} else if (isDevelopmentDuplicateReview) {
  const { DuplicateReviewPrototype } = await import('./duplicates/DuplicateReviewPrototype')
  root.render(<StrictMode><DuplicateReviewPrototype /></StrictMode>)
} else {
  const { default: App } = await import('./App.tsx')
  root.render(<StrictMode><App /></StrictMode>)
}
