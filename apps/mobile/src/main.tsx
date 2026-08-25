import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './design-system/fonts.css'
import './index.css'

const root = createRoot(document.getElementById('root')!)
const isDevelopmentGallery = import.meta.env.DEV && window.location.pathname === '/__gallery'

if (isDevelopmentGallery) {
  const { ComponentGallery } = await import('./gallery/ComponentGallery')
  root.render(<StrictMode><ComponentGallery /></StrictMode>)
} else {
  const { default: App } = await import('./App.tsx')
  root.render(<StrictMode><App /></StrictMode>)
}
