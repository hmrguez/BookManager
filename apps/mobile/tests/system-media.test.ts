import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_SYSTEM_MEDIA_PREFERENCES,
  SYSTEM_MEDIA_PREFERENCES_STORAGE_KEY,
  readSystemMediaPreferences,
  writeSystemMediaPreferences,
} from '../src/playback'
import { playbackArtworkSchema } from '../src/playback/model'

class MemoryStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

describe('system media privacy preferences', () => {
  test('defaults to a private lock-screen identity and persists explicit previews', () => {
    const storage = new MemoryStorage()

    expect(readSystemMediaPreferences(storage)).toEqual(DEFAULT_SYSTEM_MEDIA_PREFERENCES)
    writeSystemMediaPreferences(storage, { showBookDetailsWhenLocked: true })

    expect(readSystemMediaPreferences(storage)).toEqual({ showBookDetailsWhenLocked: true })
  })

  test('falls back to private when stored data is malformed', () => {
    const storage = new MemoryStorage()
    storage.setItem(SYSTEM_MEDIA_PREFERENCES_STORAGE_KEY, JSON.stringify({
      showBookDetailsWhenLocked: 'sometimes',
    }))

    expect(readSystemMediaPreferences(storage)).toEqual(DEFAULT_SYSTEM_MEDIA_PREFERENCES)
  })
})

describe('system media artwork contract', () => {
  test('accepts only fingerprinted managed-image evidence', () => {
    const artwork = {
      uri: 'file:///private/Library/NoCloud/assets/covers/cover.jpg',
      fingerprint: 'a'.repeat(64),
      byteSize: 4_096,
      mediaType: 'image/jpeg',
    }

    expect(playbackArtworkSchema.parse(artwork)).toEqual(artwork)
    expect(playbackArtworkSchema.safeParse({ ...artwork, mediaType: 'image/svg+xml' }).success).toBe(false)
    expect(playbackArtworkSchema.safeParse({ ...artwork, fingerprint: 'remote-cover' }).success).toBe(false)
  })
})

describe('native system media surface contract', () => {
  test('publishes privacy-filtered iOS metadata and exposes expected remote commands', async () => {
    const source = await Bun.file(
      new URL('../ios/App/App/WovenleafPlaybackPlugin.swift', import.meta.url),
    ).text()

    expect(source).toContain('MPMediaItemPropertyArtwork')
    expect(source).toContain('MPNowPlayingInfoPropertyChapterNumber')
    expect(source).toContain('MPNowPlayingInfoPropertyElapsedPlaybackTime')
    expect(source).toContain('remote.stopCommand.addTarget')
    expect(source).toContain('remote.changePlaybackPositionCommand.addTarget')
    expect(source).toContain('if !enabled { cachedArtwork = nil }')
    expect(source).toContain('if journal.command(id: id) != nil')
  })

  test('publishes Android artwork and chapters and journals headset media actions', async () => {
    const source = await Bun.file(
      new URL(
        '../android/app/src/main/java/com/hmrguez/wovenleaf/WovenleafPlaybackService.kt',
        import.meta.url,
      ),
    ).text()

    expect(source).toContain('.setArtworkUri(Uri.parse(it))')
    expect(source).toContain('.setSubtitle(if (previewEnabled)')
    expect(source).toContain('.setDurationMs(durationMs())')
    expect(source).toContain('override fun onMediaButtonEvent')
    expect(source).toContain('override fun onPositionDiscontinuity')
    expect(source).toContain('return successResult(snapshot())')
    expect(source).toContain('WovenleafL10n.text("Back {{seconds}} seconds", mapOf("seconds" to backwardSkipSeconds().toString()))')
  })

  test('keeps web system controls and position state aligned with the native contract', async () => {
    const source = await Bun.file(new URL('../src/playback/web.ts', import.meta.url)).text()

    expect(source).toContain("this.#setMediaAction('seekto'")
    expect(source).toContain("this.#setMediaAction('nexttrack'")
    expect(source).toContain("this.#setMediaAction('previoustrack'")
    expect(source).toContain('navigator.mediaSession.setPositionState')
    expect(source).toContain('this.#artwork.uri')
  })
})
