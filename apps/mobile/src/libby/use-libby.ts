import { useCallback, useEffect, useRef, useState } from 'react'
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { App } from '@capacitor/app'
import { getStorageRuntime } from '../storage/runtime'
import type { LibbyRepository } from './repository'
import { emptyLibbyState, type LibbyState } from './model'
import { getLibbyEnrichment } from './enrichment-runtime'
import { readLibbyFile, removeLibbyShareCopy } from './intake'

const native = registerPlugin<{
  configure(options: { enabled: boolean }): Promise<void>
  pending(): Promise<{ snapshots: { id: string; text: string }[] }>
  acknowledge(options: { ids: string[] }): Promise<void>
  openBrowser(options: { browser: 'quetta' | 'firefox'; url?: string }): Promise<void>
  beginPairing(): Promise<{ code: string }>
  resume(): Promise<void>
  copyCode(): Promise<void>
  saveCompanion(): Promise<{ saved: boolean }>
  status(): Promise<{ running: boolean; paired: boolean; browser?: 'quetta' | 'firefox'; pairing?: boolean; error?: string }>
  addListener(event: 'captureReceived', listener: () => void): Promise<PluginListenerHandle>
}>('WovenleafLibby')
const nativeAvailable = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('WovenleafLibby')
const android = () => Capacitor.getPlatform() === 'android' && nativeAvailable()

export function useLibby(reloadLibrary: () => Promise<unknown>) {
  const [state, setState] = useState<LibbyState>(emptyLibbyState)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [connection, setConnection] = useState<{ running: boolean; paired: boolean; browser?: 'quetta' | 'firefox'; error?: string }>()
  const [companionSaved, setCompanionSaved] = useState(false)
  const [pairingCode, setPairingCode] = useState<string>()
  const tail = useRef(Promise.resolve())
  const jobs = useRef(0)
  const run = useCallback((action: (repo: LibbyRepository) => Promise<LibbyState>) => {
    jobs.current++
    const work = tail.current.then(async () => {
      setBusy(true)
      setError(undefined)
      const { libby } = await getStorageRuntime()
      // Flush queued manual library writes before checking progress conflicts.
      await reloadLibrary()
      const next = await action(libby)
      setState(next)
      await reloadLibrary()
      setReady(true)
    })
    const settled = work.then(() => true, async (reason: unknown) => {
      // Earlier captures may already have committed before a later bridge operation fails.
      try { setState(await (await getStorageRuntime()).libby.read()); await reloadLibrary() } catch { /* Preserve the original actionable error. */ }
      setError(reason instanceof Error ? reason.message : 'Libby progress could not be received. Try again.')
      setReady(true)
      return false
    }).finally(() => { if (--jobs.current === 0) setBusy(false) })
    tail.current = settled.then(() => undefined)
    return settled
  }, [reloadLibrary])
  const refresh = useCallback(() => run(async (repo) => {
    let next = await repo.read()
    if (nativeAvailable()) {
      await native.configure({ enabled: next.enabled })
      if (next.enabled) {
        const { snapshots } = await native.pending()
        for (const snapshot of snapshots) {
          next = await repo.ingest(snapshot.text, true)
          // Acknowledge only after the database has committed; retries are idempotent.
          await native.acknowledge({ ids: [snapshot.id] })
        }
      }
      if (android()) { const status = await native.status(); setConnection(status); if (!status.pairing) setPairingCode(undefined) }
    }
    return next
  }), [run])
  useEffect(() => {
    void refresh()
    if (!Capacitor.isNativePlatform()) return
    const listener = App.addListener('appStateChange', ({ isActive }) => { if (isActive) void refresh() })
    const captures = android() ? native.addListener('captureReceived', () => { void refresh() }) : undefined
    return () => { void listener.then(handle => handle.remove()); void captures?.then(handle => handle.remove()) }
  }, [refresh])

  useEffect(() => {
    if (!ready || !state.enabled) return
    let active = true
    const enrich = async () => {
      try {
        const worker = await getLibbyEnrichment()
        await worker.run(navigator.language || 'en', reloadLibrary)
        if (active) { setState(await (await getStorageRuntime()).libby.read()); await reloadLibrary() }
      } catch { /* Metadata availability never interrupts reading or capture. */ }
    }
    void enrich()
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void enrich() }, 60_000)
    return () => { active = false; clearInterval(timer) }
  }, [ready, state.enabled, state.lastReceivedAt, state.mappings.length, reloadLibrary])

  useEffect(() => { if (!pairingCode) return; const timer = setTimeout(() => setPairingCode(undefined), 300_000); return () => clearTimeout(timer) }, [pairingCode])

  const configure = (enabled: boolean, automatic = state.automatic, autoAdd = state.autoAdd) => run(async (repo) => {
    if (!enabled && nativeAvailable()) await native.configure({ enabled: false })
    const next = await repo.configure(enabled, automatic, autoAdd)
    if (enabled && nativeAvailable()) await native.configure({ enabled: true })
    if (!enabled) { setPairingCode(undefined); setConnection(undefined) }
    return next
  })
  const receiveText = (text: string) => run(repo => repo.ingest(text))
  const receiveFile = (source: File | string) => run(async repo => {
    const next = await repo.ingest(await readLibbyFile(source))
    if (typeof source === 'string') await removeLibbyShareCopy(source)
    return next
  })
  return { state, ready, busy, error, refresh, configure, receiveText, receiveFile, connection, pairingCode, companionSaved,
    openBrowser: (browser: 'safari' | 'quetta' | 'firefox', url = 'https://libbyapp.com/shelf') => {
      // Keep the browser opening inside the click gesture; a queued database job loses popup activation.
      if (!android() || browser === 'safari') { window.open(url, '_blank', 'noopener,noreferrer'); return Promise.resolve(true) }
      return run(async repo => { await native.openBrowser({ browser, url }); return repo.read() })
    },
    saveCompanion: () => run(async repo => { const result = await native.saveCompanion(); setCompanionSaved(result.saved); return repo.read() }),
    pair: () => run(async repo => { const result = await native.beginPairing(); setPairingCode(result.code); setConnection(await native.status()); return repo.read() }),
    copyCode: () => run(async repo => { await native.copyCode(); return repo.read() }),
    resumeConnection: () => run(async repo => { await native.resume(); setConnection(await native.status()); return repo.read() }),
    apply: (key: string, id: string, bookId: string | null, expected?: string, moveToReading = false) => run(repo => repo.apply(key, id, bookId, expected, moveToReading)),
    dismiss: (key: string, id: string) => run(repo => repo.dismiss(key, id)),
    unlink: (key: string) => run(repo => repo.unlink(key)),
    retryMetadata: (id: string) => run(repo => repo.retryEnrichment(id)),
    chooseMetadata: (id: string, candidateId: string | null) => run(repo => repo.chooseEnrichment(id, candidateId)),
    undo: (id: string) => run(repo => repo.undo(id)),
  }
}
export type LibbyController = ReturnType<typeof useLibby>

/** Private erasure disables the device inbox and removes its managed captures/key. */
export async function disableLibbyForPrivateErasure() {
  if (nativeAvailable()) await native.configure({ enabled: false })
}
