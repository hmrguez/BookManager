import { Capacitor } from '@capacitor/core'

export type ErasedNativeScope = { bookIds: string[]; queueIds: string[]; all: boolean }

/** Clear native journals too: they are durable private copies outside SQLite. */
export async function eraseNativeJournals(scope: ErasedNativeScope) {
  if (!Capacitor.isNativePlatform()) return
  const { clearSnapshotCache } = await import('../reviews/snapshot-export')
  await clearSnapshotCache()
  const { disableLibbyForPrivateErasure } = await import('../libby/use-libby')
  await disableLibbyForPrivateErasure()
  if (Capacitor.isPluginAvailable('WovenleafReader')) {
    const { nativeReader } = await import('../reader/bridge')
    await nativeReader.closeForIncomingFile()
    const { events } = await nativeReader.drainOutbox()
    const ids = events.filter(event => scope.all || scope.bookIds.includes(event.bookId)).map(event => event.id)
    if (ids.length) await nativeReader.acknowledge({ ids })
  }
  if (Capacitor.isPluginAvailable('WovenleafPlayback')) {
    const { nativePlayback } = await import('../playback/bridge')
    const snapshot = await nativePlayback.getSnapshot()
    if (snapshot.queueId && (scope.all || scope.queueIds.includes(snapshot.queueId))) {
      await nativePlayback.stop({ commandId: crypto.randomUUID(), expectedRevision: snapshot.revision })
    }
    const { events } = await nativePlayback.drainJournal()
    const ids = events.filter(event => scope.all || scope.queueIds.includes(event.queueId)).map(event => event.id)
    if (ids.length) await nativePlayback.acknowledgeJournal({ ids })
  }
}
