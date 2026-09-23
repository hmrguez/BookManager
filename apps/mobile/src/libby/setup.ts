export type LibbyBrowser = 'safari' | 'quetta' | 'firefox'
export type SetupStep = 'welcome' | 'install' | 'connect' | 'verify'
export interface LibbySetupProgress { browser: LibbyBrowser; step: SetupStep; checkingSince?: string }
const key = 'wovenleaf-libby-setup-v1'
export function readSetup(platform: string): LibbySetupProgress {
  const fallback: LibbySetupProgress = { browser: platform === 'ios' ? 'safari' : 'quetta', step: 'welcome' }
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (!saved || !['safari', 'quetta', 'firefox'].includes(saved.browser) || !['welcome', 'install', 'connect', 'verify'].includes(saved.step)) return fallback
    if ((platform !== 'ios' && saved.browser === 'safari') || (platform === 'ios' && saved.browser !== 'safari')) return fallback
    return { browser: saved.browser, step: saved.step, checkingSince: typeof saved.checkingSince === 'string' && Number.isFinite(Date.parse(saved.checkingSince)) ? saved.checkingSince : undefined }
  } catch { return fallback }
}
export function saveSetup(progress: LibbySetupProgress) {
  try { localStorage.setItem(key, JSON.stringify(progress)); localStorage.setItem('wovenleaf-libby-browser', progress.browser) } catch { /* Setup remains usable without preference storage. */ }
}
export function hasFreshCapture(capturedAt: string | undefined, since: string | undefined): boolean {
  return !!capturedAt && !!since && Date.parse(capturedAt) >= Date.parse(since)
}
export function companionListing(browser: LibbyBrowser, chromium?: string, firefox?: string): string | undefined {
  if (browser === 'safari') return
  try {
    const url = new URL((browser === 'firefox' ? firefox : chromium) ?? '')
    const hosts = browser === 'firefox' ? ['addons.mozilla.org'] : ['chromewebstore.google.com', 'microsoftedge.microsoft.com']
    if (url.protocol === 'https:' && !url.username && !url.password && !url.port && hosts.includes(url.hostname)) return url.href
  } catch { /* An unpublished companion has no store destination. */ }
}
