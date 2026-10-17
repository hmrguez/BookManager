import { expect, test } from '@playwright/test'

declare global { interface Window { scannerTracks: MediaStreamTrack[] } }

test('ZXing decodes a real EAN-13 camera frame locally and releases the camera', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    const left = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
    const isbn = '9780156453806', parity = 'LGGLGL'
    const invert = (s: string) => [...s].map(v => v === '0' ? '1' : '0').join('')
    const bits = '101' + [...isbn.slice(1, 7)].map((n, i) => parity[i] === 'L' ? left[+n] : [...invert(left[+n]!)].reverse().join('')).join('')
      + '01010' + [...isbn.slice(7)].map(n => invert(left[+n]!)).join('') + '101'
    const canvas = document.createElement('canvas')
    canvas.width = 800; canvas.height = 400
    const ctx = canvas.getContext('2d')!
    const paint = () => {
      ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 800, 400)
      ctx.fillStyle = 'black'
      for (let i = 0; i < bits.length; i++) if (bits[i] === '1') ctx.fillRect(160 + i * 5, 65, 5, 270)
    }
    paint()
    const stream = canvas.captureStream(10)
    window.scannerTracks = stream.getTracks()
    const timer = setInterval(paint, 100)
    window.scannerTracks[0]!.addEventListener('ended', () => clearInterval(timer))
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => stream })
  })
  const result = await page.evaluate(async () => {
    const path = '/src/capture/scanner.ts'
    return (await import(/* @vite-ignore */ path)).scanIsbnBarcode()
  })
  expect(result).toMatchObject({ state: 'scanned', isbn: { canonical: '9780156453806' } })
  expect(await page.evaluate(() => window.scannerTracks.every(track => track.readyState === 'ended'))).toBe(true)
  await expect(page.getByRole('dialog', { name: 'Scan barcode' })).toHaveCount(0)
})

test('denied camera access returns the manual-entry fallback and removes camera UI', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
    value: async () => { throw new DOMException('Permission denied', 'NotAllowedError') },
  }))
  const result = await page.evaluate(async () => {
    const path = '/src/capture/scanner.ts'
    return (await import(/* @vite-ignore */ path)).scanIsbnBarcode()
  })
  expect(result.state).toBe('denied')
  await expect(page.getByRole('dialog', { name: 'Scan barcode' })).toHaveCount(0)
})

test('camera permission can be cancelled without waiting for the browser prompt', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: () => new Promise(() => {}) }))
  const result = page.evaluate(async () => {
    const path = '/src/capture/scanner.ts'
    return (await import(/* @vite-ignore */ path)).scanIsbnBarcode()
  })
  await page.getByRole('button', { name: 'Cancel ISBN scan' }).click()
  expect(await result).toEqual({ state: 'cancelled' })
  await expect(page.getByRole('dialog', { name: 'Scan barcode' })).toHaveCount(0)
})

test('license notices are readable within app settings', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByText('Open-source licenses', { exact: true }).click()
  await expect(page.locator('pre').filter({ hasText: 'WOVENLEAF THIRD-PARTY NOTICES' })).toBeVisible()
  await expect(page.locator('pre')).toContainText('ZETETIC')
  await expect(page.getByRole('link', { name: 'Corresponding source for the MPL-licensed share extension' })).toBeVisible()
})
