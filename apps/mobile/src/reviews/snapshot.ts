import { resolveLanguage, REGIONAL_LOCALES, translateCopy, getLocale, t } from '../localization'
import type { ReviewKeepsake } from './keepsake-model'
import { badgeFact, badgeName, pathwayArtworkSource, pathways, quarterLabel } from './presentation'
import { reviewFingerprint } from './updates'

export type SnapshotSelection = { format: 'post' | 'story'; identity: boolean; badgeIds: string[]; language: string }
export function snapshotDefaults(saved: ReviewKeepsake): SnapshotSelection {
  return { format: 'post', identity: saved.identity.status === 'chosen', badgeIds: saved.facts.featuredIds.slice(0, 3), language: 'app' }
}
export function snapshotRevision(saved: ReviewKeepsake) {
  return reviewFingerprint({ id: saved.id, createdAt: saved.createdAt, facts: saved.facts, identity: saved.identity, artwork: saved.artwork })
}
export function retainSnapshotSelection(selection: SnapshotSelection, saved: ReviewKeepsake): SnapshotSelection {
  return { ...selection, identity: selection.identity && saved.identity.status === 'chosen',
    badgeIds: selection.badgeIds.filter(id => saved.facts.earned.some(b => b.id === id)).slice(0, 3) }
}
/** Allowlisted presentation only. Never pass supporting book labels, notes or evidence to the renderer. */
export function snapshotContent(saved: ReviewKeepsake, selection: SnapshotSelection, appLanguage = getLocale()) {
  const ids = [...new Set(selection.badgeIds)]
  if (ids.length !== selection.badgeIds.length || ids.length > 3 || ids.some(id => !saved.facts.earned.some(b => b.id === id))) throw new Error('Choose up to three earned badges.')
  const genre = selection.identity && saved.identity.status === 'chosen' ? saved.identity.genre : null
  if (!genre && !ids.length) throw new Error('Choose a badge or include your pathway.')
  const requested = selection.language === 'app' ? appLanguage : selection.language
  const language = REGIONAL_LOCALES[resolveLanguage('system', [requested])]
  const fallback = !/^(en|es|de|it|fr)(?:-|$)/i.test(requested)
  return { width: 1080 as const, height: selection.format === 'post' ? 1080 : 1920,
    language, notice: fallback ? 'This image is in English. A complete translation is not available for your app language yet.' : '',
    period: quarterLabel(saved.facts.quarter, language), quarter: `${saved.facts.quarter.year} · Q${saved.facts.quarter.quarter}`,
    title: translateCopy(genre ? pathways[genre].title : 'My reading quarter', language),
    artwork: genre ? pathwayArtworkSource(saved.artwork.pathways[genre]) : null,
    badges: ids.map(id => { const b = saved.facts.earned.find(b => b.id === id)!
      return { id: b.id, title: badgeName(b.id, language), caption: badgeFact(b, language), tier: b.tier, personalBest: b.personalBest }
    }),
  }
}
export type SnapshotContent = ReturnType<typeof snapshotContent>

export function snapshotChanges(before: ReviewKeepsake, after: ReviewKeepsake, selection: SnapshotSelection): string[] {
  const changes: string[] = []
  for (const id of selection.badgeIds) {
    const previous = before.facts.earned.find(b => b.id === id)!
    const next = after.facts.earned.find(b => b.id === id)
    if (!next) changes.push(t("{{name}} is no longer earned and was removed from this image.", { name: badgeName(previous.id) }))
    else if (reviewFingerprint(previous) !== reviewFingerprint(next)) changes.push(t("{{name}} changed: {{fact}}.", { name: badgeName(next.id), fact: badgeFact(next) }))
  }
  if (JSON.stringify(before.identity) !== JSON.stringify(after.identity)) changes.push(after.identity.status === 'chosen'
    ? t("The chosen pathway is now {{pathway}}.", { pathway: translateCopy(pathways[after.identity.genre].title) }) : t("The pathway was removed from this image."))
  return changes
}
