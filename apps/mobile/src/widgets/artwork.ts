// Small, offline artwork shared with native widget surfaces. Failed or cross-origin
// images fall back to the book symbol; progress never depends on a cover download.
const artwork = new Map<string, Promise<string | undefined>>()
export function widgetArtwork(url: string): Promise<string | undefined> {
  if (!url) return Promise.resolve(undefined)
  const cached = artwork.get(url)
  if (cached) return cached
  const pending = new Promise<string | undefined>((resolve) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    const timer = setTimeout(() => { image.src = ''; resolve(undefined) }, 2500)
    image.onerror = () => { clearTimeout(timer); resolve(undefined) }
    image.onload = () => {
      clearTimeout(timer)
      try {
        const canvas = document.createElement('canvas')
        canvas.width = 96
        canvas.height = 144
        const context = canvas.getContext('2d')
        if (!context) { resolve(undefined); return }
        context.drawImage(image, 0, 0, 96, 144)
        resolve(canvas.toDataURL('image/jpeg', 0.75).split(',')[1])
      } catch { resolve(undefined) }
    }
    image.src = url
  })
  if (artwork.size >= 40) artwork.delete(artwork.keys().next().value!)
  artwork.set(url, pending)
  return pending
}
