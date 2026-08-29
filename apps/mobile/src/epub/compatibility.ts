import { z } from 'zod'

export const epubLayoutSchema = z.enum(['reflowable', 'fixed-layout', 'mixed'])
export const epubPageProgressionSchema = z.enum(['default', 'ltr', 'rtl'])
export const epubSupportLevelSchema = z.enum(['supported', 'limited', 'unsupported'])

export const epubContentFeaturesSchema = z.object({
  bidirectionalText: z.boolean(),
  verticalWriting: z.boolean(),
  ruby: z.boolean(),
  footnotes: z.boolean(),
  mathml: z.boolean(),
  svg: z.boolean(),
  complexTables: z.boolean(),
  mediaOverlays: z.boolean(),
  scriptedContent: z.boolean(),
  semanticStructure: z.boolean(),
})

export const epubCompatibilityProfileSchema = z.object({
  version: z.literal(1),
  layout: epubLayoutSchema,
  pageProgressionDirection: epubPageProgressionSchema,
  primaryLanguage: z.string().min(1),
  spineMediaTypes: z.array(z.string().min(1)),
  unsupportedSpineMediaTypes: z.array(z.string().min(1)),
  fallbackSpineItemCount: z.number().int().nonnegative(),
  accessibility: z.object({
    accessModes: z.array(z.string().min(1)),
    features: z.array(z.string().min(1)),
    hazards: z.array(z.string().min(1)),
    summary: z.string().min(1).optional(),
    conformsTo: z.array(z.string().min(1)),
    hasDiscoverabilityMetadata: z.boolean(),
  }),
  features: epubContentFeaturesSchema,
  support: z.object({
    level: epubSupportLevelSchema,
    notices: z.array(z.string().min(1)),
  }),
})

export type EpubCompatibilityProfile = z.infer<typeof epubCompatibilityProfileSchema>
export type EpubContentFeatures = z.infer<typeof epubContentFeaturesSchema>
export type EpubLayout = z.infer<typeof epubLayoutSchema>
export type EpubSupportLevel = z.infer<typeof epubSupportLevelSchema>

export const EPUB_COMPATIBILITY_NOTICES = {
  fixedLayout:
    'Fixed-layout pages stay paginated and keep the publisher’s design. Type size, reflow, columns, and scrolling are unavailable.',
  mixedLayout:
    'This book mixes reflowable and fixed-layout sections. Fixed pages keep the publisher’s design and may not respond to type controls.',
  verticalWriting:
    'Vertical text keeps the publisher’s writing mode and fonts. Wovenleaf disables layout overrides that could break its reading order.',
  mediaOverlays:
    'Synchronized recorded narration is not available yet. The text remains readable and can be handed to system read-aloud.',
  scriptedContent:
    'Interactive scripted features are not supported. The book’s ordinary text, links, and images remain available, but scripted behavior may not work reliably.',
  fallbackSpine:
    'Some sections use a declared fallback because their original content type is not directly supported.',
  unsupportedSpine:
    'Some sections use content types this reader cannot display. They are identified before navigation instead of opening as blank pages.',
  auditoryOnly:
    'This publication requires auditory content, but synchronized audio playback is not supported in the EPUB reader.',
  noReadableSpine:
    'This publication has no XHTML or SVG reading-order content that Wovenleaf can display.',
} as const

export type EpubCompatibilityInput = Omit<EpubCompatibilityProfile, 'version' | 'support'> & {
  readonly readableSpineItemCount: number
}

export function createEpubCompatibilityProfile(
  input: EpubCompatibilityInput,
): EpubCompatibilityProfile {
  const notices: string[] = []
  if (input.layout === 'fixed-layout') notices.push(EPUB_COMPATIBILITY_NOTICES.fixedLayout)
  if (input.layout === 'mixed') notices.push(EPUB_COMPATIBILITY_NOTICES.mixedLayout)
  if (input.features.verticalWriting) notices.push(EPUB_COMPATIBILITY_NOTICES.verticalWriting)
  if (input.features.mediaOverlays) notices.push(EPUB_COMPATIBILITY_NOTICES.mediaOverlays)
  if (input.features.scriptedContent) notices.push(EPUB_COMPATIBILITY_NOTICES.scriptedContent)
  if (input.fallbackSpineItemCount > 0) notices.push(EPUB_COMPATIBILITY_NOTICES.fallbackSpine)
  if (input.unsupportedSpineMediaTypes.length > 0) notices.push(EPUB_COMPATIBILITY_NOTICES.unsupportedSpine)

  const accessModes = new Set(input.accessibility.accessModes.map((mode) => mode.toLocaleLowerCase()))
  const auditoryOnly = accessModes.size > 0 && accessModes.has('auditory')
    && !accessModes.has('textual') && !accessModes.has('visual') && !accessModes.has('tactile')
  if (auditoryOnly) notices.unshift(EPUB_COMPATIBILITY_NOTICES.auditoryOnly)
  if (input.readableSpineItemCount === 0) notices.unshift(EPUB_COMPATIBILITY_NOTICES.noReadableSpine)

  const level = input.readableSpineItemCount === 0 || auditoryOnly
    ? 'unsupported'
    : notices.length > 0
      ? 'limited'
      : 'supported'

  return epubCompatibilityProfileSchema.parse({
    version: 1,
    layout: input.layout,
    pageProgressionDirection: input.pageProgressionDirection,
    primaryLanguage: input.primaryLanguage,
    spineMediaTypes: [...new Set(input.spineMediaTypes)].sort(),
    unsupportedSpineMediaTypes: [...new Set(input.unsupportedSpineMediaTypes)].sort(),
    fallbackSpineItemCount: input.fallbackSpineItemCount,
    accessibility: input.accessibility,
    features: input.features,
    support: { level, notices: [...new Set(notices)] },
  })
}

export function epubUnsupportedMessage(profile: EpubCompatibilityProfile): string | undefined {
  if (profile.support.level !== 'unsupported') return undefined
  return profile.support.notices.join(' ')
}
