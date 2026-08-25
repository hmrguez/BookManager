import { describe, expect, test } from 'bun:test'
import {
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE,
  applyAppearance,
  readAppearance,
  writeAppearance,
  type AppearancePreferences,
} from '../src/design-system'

class MemoryStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

const nightReading: AppearancePreferences = {
  paperMode: 'night',
  contrast: 'high',
  typeScale: 'large',
  texture: 'off',
}

describe('appearance preferences', () => {
  test('round-trips a valid preference set', () => {
    const storage = new MemoryStorage()

    writeAppearance(storage, nightReading)

    expect(readAppearance(storage)).toEqual(nightReading)
  })

  test('falls back per field when stored values are malformed', () => {
    const storage = new MemoryStorage()
    storage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify({
      paperMode: 'sepia-plus',
      contrast: 'high',
      typeScale: 200,
      texture: 'quiet',
    }))

    expect(readAppearance(storage)).toEqual({
      ...DEFAULT_APPEARANCE,
      contrast: 'high',
      texture: 'quiet',
    })
  })

  test('applies the semantic selectors and lets system contrast stay authoritative', () => {
    const root = { dataset: { contrast: 'standard' } as DOMStringMap }

    applyAppearance(root, { ...nightReading, contrast: 'system' })

    expect(root.dataset).toEqual({
      paperMode: 'night',
      typeScale: 'large',
      texture: 'off',
    })
  })
})
