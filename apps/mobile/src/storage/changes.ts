/** Only successful durable writes notify readers; read transactions never invalidate themselves. */
const listeners = new Set<() => void>()
export function subscribeStorageChanges(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function notifyStorageChanged() {
  for (const listener of listeners) listener()
}
