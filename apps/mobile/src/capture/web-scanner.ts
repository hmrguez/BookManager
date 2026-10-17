import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import { translateCopy } from '../localization'
import type { IsbnScanner } from './scanner'
import './scanner.css'

let scanning = false

/** Camera frames remain on-device; decoding uses the bundled ZXing implementation. */
export const webScanner: IsbnScanner = {
  async scan() {
    if (scanning) throw new Error('A scan is already in progress')
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera unavailable')
    scanning = true
    const previousFocus = document.activeElement
    const dialog = document.createElement('dialog')
    dialog.className = 'isbn-scanner'
    dialog.setAttribute('aria-labelledby', 'isbn-scanner-title')
    const title = document.createElement('h2')
    title.id = 'isbn-scanner-title'
    title.textContent = translateCopy('Scan barcode')
    const video = document.createElement('video')
    video.setAttribute('playsinline', '')
    video.muted = true
    const hint = document.createElement('p')
    hint.textContent = translateCopy('Center the ISBN barcode. Use the torch when the page is dark.')
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.textContent = translateCopy('Cancel ISBN scan')
    const torch = document.createElement('button')
    torch.type = 'button'
    torch.hidden = true
    torch.textContent = translateCopy('Turn flashlight on')
    torch.setAttribute('aria-pressed', 'false')
    dialog.append(title, video, hint, torch, cancel)
    let controls: IScannerControls | undefined
    let closed = false
    try {
      document.body.append(dialog)
      dialog.showModal()
      cancel.focus()
      return await new Promise<{ content: string | null }>((resolve, reject) => {
        const finish = (content: string | null) => { closed = true; resolve({ content }) }
        cancel.onclick = () => finish(null)
        dialog.oncancel = (event) => { event.preventDefault(); finish(null) }
        void new BrowserMultiFormatReader().decodeFromConstraints({
          audio: false, video: { facingMode: { ideal: 'environment' } },
        }, video, (result) => {
          if (result && !closed) finish(result.getText())
        }).then((active) => {
          controls = active
          // Permission may resolve after cancellation. Stop the late stream as well.
          if (closed) { active.stop(); return }
          if (active.switchTorch) {
            torch.hidden = false
            let torchOn = false
            torch.onclick = async () => {
              torch.disabled = true
              try {
                await active.switchTorch!(!torchOn)
                torchOn = !torchOn
                torch.setAttribute('aria-pressed', String(torchOn))
                torch.textContent = translateCopy(torchOn ? 'Turn flashlight off' : 'Turn flashlight on')
              } catch { torch.hidden = true } finally { torch.disabled = false }
            }
          }
        }).catch((error: unknown) => { if (!closed) reject(error) })
      })
    } finally {
      closed = true
      controls?.stop()
      const stream = video.srcObject
      if (stream instanceof MediaStream) stream.getTracks().forEach((track) => track.stop())
      dialog.close()
      dialog.remove()
      scanning = false
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  },
}
