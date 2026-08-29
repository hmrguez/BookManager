import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type {
  NativeReaderEvent,
  ReaderAnnotationState,
  ReaderNavigationState,
  ReaderPreferences,
  ReadiumLocator,
} from './model'
import type { EpubCompatibilityProfile } from '../epub/compatibility'

type ReaderOpenOptions = {
  readonly bookId: string
  readonly editionId: string
  readonly assetId: string
  readonly assetFingerprint: string
  readonly fileUri: string
  readonly title: string
  readonly globalPreferences: ReaderPreferences
  readonly bookPreferences?: ReaderPreferences
  readonly navigationState: ReaderNavigationState
  readonly annotationState: ReaderAnnotationState
  readonly initialLocator?: ReadiumLocator
  readonly compatibility?: EpubCompatibilityProfile
}

interface WovenleafReaderPlugin {
  open(options: ReaderOpenOptions): Promise<void>
  drainOutbox(): Promise<{ events: readonly NativeReaderEvent[] }>
  acknowledge(options: { ids: readonly string[] }): Promise<void>
  addListener(
    eventName: 'readerEvent',
    listener: (event: NativeReaderEvent) => void,
  ): Promise<PluginListenerHandle>
}

export const nativeReader = registerPlugin<WovenleafReaderPlugin>('WovenleafReader')
