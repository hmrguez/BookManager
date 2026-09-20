import { useCallback, useEffect, useRef, useState } from 'react'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { App } from '@capacitor/app'
import { getStorageRuntime } from '../storage/runtime'
import type { LibbyRepository } from './repository'
import { emptyLibbyState, type LibbyState } from './model'
import { readLibbyFile, removeLibbyShareCopy } from './intake'

const native = registerPlugin<{
  configure(options: { enabled: boolean }): Promise<void>
  pending(): Promise<{ snapshots: { id: string; text: string }[] }>
  acknowledge(options: { ids: string[] }): Promise<void>
}>('WovenleafLibby')
const nativeAvailable = () => Capacitor.getPlatform() === 'ios' && Capacitor.isPluginAvailable('WovenleafLibby')

export function useLibby(reloadLibrary: () => Promise<unknown>) {
  const [state, setState] = useState<LibbyState>(emptyLibbyState)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
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
          next = await repo.ingest(snapshot.text)
          // Acknowledge only after the database has committed; retries are idempotent.
          await native.acknowledge({ ids: [snapshot.id] })
        }
      }
    }
    return next
  }), [run])
  useEffect(() => {
    void refresh()
    if (!Capacitor.isNativePlatform()) return
    const listener = App.addListener('appStateChange', ({ isActive }) => { if (isActive) void refresh() })
    return () => { void listener.then(handle => handle.remove()) }
  }, [refresh])

  const configure = (enabled: boolean, automatic = state.automatic) => run(async (repo) => {
    if (!enabled && nativeAvailable()) await native.configure({ enabled: false })
    const next = await repo.configure(enabled, automatic)
    if (enabled && nativeAvailable()) await native.configure({ enabled: true })
    return next
  })
  const receiveText = (text: string) => run(repo => repo.ingest(text))
  const receiveFile = (source: File | string) => run(async repo => {
    const next = await repo.ingest(await readLibbyFile(source))
    if (typeof source === 'string') await removeLibbyShareCopy(source)
    return next
  })
  return { state, ready, busy, error, refresh, configure, receiveText, receiveFile,
    apply: (key: string, id: string, bookId: string | null, expected?: string) => run(repo => repo.apply(key, id, bookId, expected)),
    dismiss: (key: string, id: string) => run(repo => repo.dismiss(key, id)),
    unlink: (key: string) => run(repo => repo.unlink(key)),
    undo: (id: string) => run(repo => repo.undo(id)),
  }
}
export type LibbyController = ReturnType<typeof useLibby>
