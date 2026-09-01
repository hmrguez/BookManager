import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_FEEDBACK_PREFERENCES,
  FEEDBACK_EVENTS,
  FEEDBACK_GRAMMAR,
  FEEDBACK_PLATFORM_MATRIX,
  FeedbackController,
  readFeedbackPreferences,
  writeFeedbackPreferences,
  type FeedbackRequest,
  type WovenleafFeedbackPlugin,
} from '../src/feedback'

const feedbackDirectory = new URL('../public/feedback/', import.meta.url)

describe('semantic feedback', () => {
  test('defines the complete bounded vocabulary without using sensory output as information', () => {
    expect(Object.keys(FEEDBACK_GRAMMAR)).toEqual(FEEDBACK_EVENTS)
    for (const event of FEEDBACK_EVENTS) {
      const rule = FEEDBACK_GRAMMAR[event]
      expect(rule.purpose.length).toBeGreaterThan(30)
      expect(rule.hapticIntent.length).toBeGreaterThan(20)
      expect(rule.sound.length).toBeGreaterThan(20)
      expect(rule.informationSource).toMatch(/state|value|text|heading|membership|position/i)
      expect(rule.cooldownMs).toBeGreaterThanOrEqual(event === 'selection' ? 90 : 250)
    }
  })

  test('defaults paper sound off and recovers invalid saved preferences safely', () => {
    expect(DEFAULT_FEEDBACK_PREFERENCES).toEqual({ haptics: 'system', sound: 'off' })
    const storage = memoryStorage()
    storage.setItem('wovenleaf.feedback.preferences.v1', JSON.stringify({ haptics: 'loud', sound: true }))
    expect(readFeedbackPreferences(storage)).toEqual(DEFAULT_FEEDBACK_PREFERENCES)

    writeFeedbackPreferences(storage, { haptics: 'off', sound: 'quiet' })
    expect(readFeedbackPreferences(storage)).toEqual({ haptics: 'off', sound: 'quiet' })
  })

  test('centralizes preferences, cooldowns, operation deduplication, and background suppression', async () => {
    const requests: FeedbackRequest[] = []
    let now = 1_000
    let background = false
    const plugin: WovenleafFeedbackPlugin = {
      async getCapabilities() {
        return { platform: 'web', haptics: false, sound: true }
      },
      async emit(request) {
        requests.push(request)
        return { hapticPlayed: request.haptics, soundPlayed: request.sound }
      },
    }
    const controller = new FeedbackController({
      plugin,
      now: () => now,
      isBackground: () => background,
    })
    controller.configure({ haptics: 'system', sound: 'quiet' })

    expect(await controller.emit('selection')).toMatchObject({ hapticPlayed: true, soundPlayed: true })
    expect(await controller.emit('selection')).toMatchObject({ reason: 'throttled' })
    now += FEEDBACK_GRAMMAR.selection.cooldownMs
    expect(await controller.emit('selection', { operationId: 'rating:book-1:4' })).toMatchObject({ hapticPlayed: true })
    now += FEEDBACK_GRAMMAR.selection.cooldownMs
    expect(await controller.emit('selection', { operationId: 'rating:book-1:4' })).toMatchObject({ reason: 'duplicate' })

    background = true
    now += 1_000
    expect(await controller.emit('error')).toMatchObject({ reason: 'background' })
    expect(requests).toHaveLength(2)
  })

  test('documents native support and intentionally gives web no haptic substitute', () => {
    expect(FEEDBACK_PLATFORM_MATRIX).toHaveLength(4)
    expect(FEEDBACK_PLATFORM_MATRIX.find(({ platform }) => platform === 'Web')?.haptics)
      .toContain('Intentionally unsupported')
    expect(FEEDBACK_PLATFORM_MATRIX.find(({ platform }) => platform === 'Android')?.haptics)
      .toContain('performHapticFeedback')
  })

  test('ships deterministic quiet PCM assets with an erase-to-write shelf timeline', async () => {
    const manifestBytes = await Bun.file(new URL('manifest.json', feedbackDirectory)).arrayBuffer()
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as {
      generatedBy: string
      sounds: Array<{
        filename: string
        durationMs: number
        sampleRate: number
        channels: number
        bitDepth: number
        sha256: string
      }>
    }
    expect(manifest.generatedBy).toBe('scripts/generate-feedback-sounds.ts')
    expect(manifest.sounds.map(({ filename }) => filename)).toEqual([
      'graphite-tick.wav',
      'paper-slide.wav',
      'paper-edge.wav',
      'page-settle.wav',
      'soft-error.wav',
      'shelf-transfer.wav',
    ])

    for (const sound of manifest.sounds) {
      const bytes = Buffer.from(await Bun.file(new URL(sound.filename, feedbackDirectory)).arrayBuffer())
      expect(bytes.toString('ascii', 0, 4)).toBe('RIFF')
      expect(bytes.toString('ascii', 8, 12)).toBe('WAVE')
      expect(bytes.readUInt16LE(20)).toBe(1)
      expect(bytes.readUInt16LE(22)).toBe(sound.channels)
      expect(bytes.readUInt32LE(24)).toBe(sound.sampleRate)
      expect(bytes.readUInt16LE(34)).toBe(sound.bitDepth)
      expect(Math.round((bytes.length - 44) / 2 / sound.sampleRate * 1_000)).toBe(sound.durationMs)
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(sound.sha256)

      const samples = pcmSamples(bytes)
      expect(absolutePeak(samples)).toBeLessThanOrEqual(5_400)
      expect(samples[0]).toBe(0)
      expect(samples.at(-1)).toBe(0)
    }

    const shelfBytes = Buffer.from(
      await Bun.file(new URL('shelf-transfer.wav', feedbackDirectory)).arrayBuffer(),
    )
    const shelfSamples = pcmSamples(shelfBytes)
    const sampleRate = 44_100
    const eraseRms = rms(shelfSamples, sampleRate, 0.24, 0.72)
    const quietRms = rms(shelfSamples, sampleRate, 0.78, 1.12)
    const pencilRms = rms(shelfSamples, sampleRate, 1.2, 1.68)
    expect(eraseRms).toBeGreaterThan(120)
    expect(pencilRms).toBeGreaterThan(120)
    expect(quietRms).toBeLessThan(Math.min(eraseRms, pencilRms) * 0.03)
  })

  test('keeps native haptics semantic and subject to system policy', async () => {
    const [android, ios] = await Promise.all([
      Bun.file(new URL('../android/app/src/main/java/com/hmrguez/wovenleaf/WovenleafFeedbackPlugin.kt', import.meta.url)).text(),
      Bun.file(new URL('../ios/App/App/WovenleafFeedbackPlugin.swift', import.meta.url)).text(),
    ])
    expect(android).toContain('performHapticFeedback')
    expect(android).not.toContain('FLAG_IGNORE_GLOBAL_SETTING')
    expect(android).not.toContain('FLAG_IGNORE_VIEW_SETTING')
    expect(android).toContain('setMaxStreams(1)')
    expect(ios).toContain('UISelectionFeedbackGenerator')
    expect(ios).toContain('UINotificationFeedbackGenerator')
    expect(ios).toContain('UIAccessibility.isVoiceOverRunning')
    expect(ios).toContain('AVAudioSession.sharedInstance()')
  })
})

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, value) },
  }
}

function pcmSamples(bytes: Buffer): number[] {
  const result: number[] = []
  for (let offset = 44; offset < bytes.length; offset += 2) result.push(bytes.readInt16LE(offset))
  return result
}

function absolutePeak(samples: readonly number[]): number {
  let peak = 0
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample))
  return peak
}

function rms(
  samples: readonly number[],
  sampleRate: number,
  startSeconds: number,
  endSeconds: number,
): number {
  const start = Math.round(startSeconds * sampleRate)
  const end = Math.min(samples.length, Math.round(endSeconds * sampleRate))
  let sum = 0
  for (let index = start; index < end; index += 1) sum += samples[index]! ** 2
  return Math.sqrt(sum / Math.max(1, end - start))
}
