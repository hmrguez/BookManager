export const PAPER_MODES = ['warm', 'cool', 'print', 'night'] as const
export const CONTRAST_MODES = ['system', 'standard', 'high'] as const
export const TYPE_SCALES = ['standard', 'large', 'x-large'] as const
export const TEXTURE_MODES = ['quiet', 'off'] as const

export type PaperMode = (typeof PAPER_MODES)[number]
export type ContrastMode = (typeof CONTRAST_MODES)[number]
export type TypeScale = (typeof TYPE_SCALES)[number]
export type TextureMode = (typeof TEXTURE_MODES)[number]

export interface AppearancePreferences {
  paperMode: PaperMode
  contrast: ContrastMode
  typeScale: TypeScale
  texture: TextureMode
}

interface AppearanceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const APPEARANCE_STORAGE_KEY = 'wovenleaf.appearance.v1'

export const DEFAULT_APPEARANCE: AppearancePreferences = {
  paperMode: 'warm',
  contrast: 'system',
  typeScale: 'standard',
  texture: 'quiet',
}

export function getAppearanceStorage(): AppearanceStorage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

function isOneOf<const Values extends readonly string[]>(
  values: Values,
  candidate: unknown,
): candidate is Values[number] {
  return typeof candidate === 'string' && values.includes(candidate)
}

export function readAppearance(storage?: AppearanceStorage): AppearancePreferences {
  if (!storage) return DEFAULT_APPEARANCE

  try {
    const saved = JSON.parse(storage.getItem(APPEARANCE_STORAGE_KEY) ?? 'null') as
      | Partial<AppearancePreferences>
      | null

    if (!saved) return DEFAULT_APPEARANCE

    return {
      paperMode: isOneOf(PAPER_MODES, saved.paperMode)
        ? saved.paperMode
        : DEFAULT_APPEARANCE.paperMode,
      contrast: isOneOf(CONTRAST_MODES, saved.contrast)
        ? saved.contrast
        : DEFAULT_APPEARANCE.contrast,
      typeScale: isOneOf(TYPE_SCALES, saved.typeScale)
        ? saved.typeScale
        : DEFAULT_APPEARANCE.typeScale,
      texture: isOneOf(TEXTURE_MODES, saved.texture)
        ? saved.texture
        : DEFAULT_APPEARANCE.texture,
    }
  } catch {
    return DEFAULT_APPEARANCE
  }
}

export function writeAppearance(
  storage: AppearanceStorage,
  preferences: AppearancePreferences,
) {
  try {
    storage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(preferences))
  } catch {
    // The visual preference still applies for this session when storage is unavailable.
  }
}

export function applyAppearance(
  root: Pick<HTMLElement, 'dataset'>,
  preferences: AppearancePreferences,
) {
  root.dataset.paperMode = preferences.paperMode
  root.dataset.typeScale = preferences.typeScale
  root.dataset.texture = preferences.texture

  if (preferences.contrast === 'system') {
    delete root.dataset.contrast
  } else {
    root.dataset.contrast = preferences.contrast
  }
}
