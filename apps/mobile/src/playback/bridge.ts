import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type {
  NativePlaybackEvent,
  PlaybackCapabilities,
  PlaybackCommand,
  PlaybackQueueRequest,
  PlaybackSnapshot,
} from './model'

export interface WovenleafPlaybackPlugin {
  getCapabilities(): Promise<PlaybackCapabilities>
  loadQueue(options: PlaybackQueueRequest & PlaybackCommand): Promise<PlaybackSnapshot>
  play(options: PlaybackCommand): Promise<PlaybackSnapshot>
  pause(options: PlaybackCommand): Promise<PlaybackSnapshot>
  stop(options: PlaybackCommand): Promise<PlaybackSnapshot>
  seekToAbsolute(options: PlaybackCommand & { readonly positionMs: number }): Promise<PlaybackSnapshot>
  seekBy(options: PlaybackCommand & { readonly offsetMs: number }): Promise<PlaybackSnapshot>
  nextChapter(options: PlaybackCommand): Promise<PlaybackSnapshot>
  previousChapter(options: PlaybackCommand): Promise<PlaybackSnapshot>
  setRate(options: PlaybackCommand & { readonly rate: number }): Promise<PlaybackSnapshot>
  setSleepTimer(
    options: PlaybackCommand & {
      readonly mode: 'duration' | 'chapter-end'
      readonly durationMs?: number
    },
  ): Promise<PlaybackSnapshot>
  cancelSleepTimer(options: PlaybackCommand): Promise<PlaybackSnapshot>
  adoptPosition(
    options: PlaybackCommand & { readonly positionMs: number; readonly provenanceEventId: string },
  ): Promise<PlaybackSnapshot>
  getSnapshot(): Promise<PlaybackSnapshot>
  drainJournal(): Promise<{ readonly events: readonly NativePlaybackEvent[] }>
  acknowledgeJournal(options: { readonly ids: readonly string[] }): Promise<void>
  setSystemSurfacePrivacy(options: { readonly previewEnabled: boolean }): Promise<PlaybackSnapshot>
  addListener(
    eventName: 'snapshotChanged',
    listener: (snapshot: PlaybackSnapshot) => void,
  ): Promise<PluginListenerHandle>
  addListener(
    eventName: 'eventsAvailable',
    listener: (notification: { readonly count: number }) => void,
  ): Promise<PluginListenerHandle>
}

export const nativePlayback = registerPlugin<WovenleafPlaybackPlugin>('WovenleafPlayback', {
  web: () => import('./web').then(({ WovenleafPlaybackWeb }) => new WovenleafPlaybackWeb()),
})
