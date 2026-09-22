import { useEffect } from 'react'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { App } from '@capacitor/app'
import { getStorageRuntime } from '../storage/runtime'
import { widgetArtwork } from './artwork'
import { widgetSnapshot } from './snapshot'

const nativeWidgets = registerPlugin<{ publish(options: { snapshot: string }): Promise<void> }>('WovenleafWidgets')

// Read committed storage, never the optimistic React state. Native surfaces keep an
// offline snapshot and calculate streak expiry even while the web view is asleep.
export function useWidgets(revision: unknown) {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let tail = Promise.resolve()
    const publish = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        tail = tail.then(async () => {
          if (disposed) return
          const { database } = await getStorageRuntime()
          const snapshot = await widgetSnapshot(database)
          const books = await Promise.all(snapshot.books.map(async (book, index) => ({
            ...book, cover: index < 20 ? await widgetArtwork(book.thumbnail) : undefined,
          })))
          if (!disposed) await nativeWidgets.publish({ snapshot: JSON.stringify({ ...snapshot, books }) })
        }).catch((error: unknown) => console.warn('Widget snapshot could not refresh', error instanceof Error ? error.message : 'Unknown error'))
      }, 250)
    }
    publish()
    window.addEventListener('wovenleaf-library-saved', publish)
    const listener = App.addListener('appStateChange', publish)
    return () => {
      disposed = true
      clearTimeout(timer)
      window.removeEventListener('wovenleaf-library-saved', publish)
      void listener.then((handle) => handle.remove())
    }
  }, [revision])
}
