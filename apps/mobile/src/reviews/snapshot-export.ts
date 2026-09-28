import { Capacitor, registerPlugin } from '@capacitor/core'

type ExportResult = { status: 'saved' | 'cancelled' | 'shared' | 'download-requested' }
const native = registerPlugin<{ clearCache(): Promise<void>; exportImage(options: { png: string; action: 'save' | 'share'; filename: string }): Promise<ExportResult> }>('WovenleafSnapshot')
export async function exportSnapshot(dataUrl: string, action: 'save' | 'share'): Promise<ExportResult> {
  const filename = 'wovenleaf-reading-quarter.png'
  if (!dataUrl.startsWith('data:image/png;base64,') || dataUrl.length > 16_000_000) throw new Error('Invalid snapshot')
  if (Capacitor.isNativePlatform()) return native.exportImage({ png: dataUrl.slice(22), action, filename })
  const blob = await (await fetch(dataUrl)).blob()
  const file = new File([blob], filename, { type: 'image/png' })
  if (action === 'share') {
    if (!navigator.canShare?.({ files: [file] })) throw new Error('Sharing is unavailable. Save the image instead.')
    try { await navigator.share({ files: [file] }); return { status: 'shared' } }
    catch (error) { if (error instanceof DOMException && error.name === 'AbortError') return { status: 'cancelled' }; throw error }
  }
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  // A browser download request cannot prove the destination write completed.
  return { status: 'download-requested' }
}

/** Private erasure includes temporary native image copies; external exports remain outside the app. */
export async function clearSnapshotCache() {
  if (Capacitor.isNativePlatform()) await native.clearCache()
}
