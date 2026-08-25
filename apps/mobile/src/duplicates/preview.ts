import type { Catalog, Edition, Work, WorkId } from '../domain/catalog'
import {
  duplicateMergePreviewSchema,
  type DuplicateEditionDestination,
  type DuplicateMergePreview,
  type DuplicatePreviewCounts,
} from './model'

export function previewWorkMerge(
  catalog: Catalog,
  absorbedWorkId: WorkId,
  survivingWorkId: WorkId,
): DuplicateMergePreview {
  if (absorbedWorkId === survivingWorkId) throw new Error('A Work cannot merge into itself')
  const absorbed = requiredWork(catalog, absorbedWorkId)
  const surviving = requiredWork(catalog, survivingWorkId)
  const absorbedEditions = editionsFor(catalog, absorbedWorkId)
  const survivingEditions = editionsFor(catalog, survivingWorkId)
  if (!absorbedEditions.length) throw new Error(`Work ${absorbedWorkId} has no Editions to merge`)

  const moving = countsFor(catalog, absorbed, absorbedEditions)
  const destinationBefore = countsFor(catalog, surviving, survivingEditions)
  const listChanges = catalog.listEntries
    .filter(({ workId }) => workId === absorbedWorkId)
    .map((entry) => {
      const destination = catalog.listEntries.find(({ listId, workId }) =>
        listId === entry.listId && workId === survivingWorkId,
      )
      const listName = catalog.lists.find(({ id }) => id === entry.listId)?.name ?? entry.listId
      return destination ? {
        kind: 'consolidate' as const,
        entryId: entry.id,
        destinationEntryId: destination.id,
        listId: entry.listId,
        listName,
        fromWorkId: absorbedWorkId,
        toWorkId: survivingWorkId,
      } : {
        kind: 'move' as const,
        entryId: entry.id,
        listId: entry.listId,
        listName,
        fromWorkId: absorbedWorkId,
        toWorkId: survivingWorkId,
      }
    })
  const destinationAfter = {
    editions: destinationBefore.editions + moving.editions,
    assets: destinationBefore.assets + moving.assets,
    progress: destinationBefore.progress + moving.progress,
    annotations: destinationBefore.annotations + moving.annotations,
    listMemberships: destinationBefore.listMemberships
      + listChanges.filter(({ kind }) => kind === 'move').length,
    loans: destinationBefore.loans + moving.loans,
    ownerships: destinationBefore.ownerships + moving.ownerships,
    sources: destinationBefore.sources + moving.sources,
  }

  return duplicateMergePreviewSchema.parse({
    absorbedWorkId,
    absorbedTitle: absorbed.title.value,
    survivingWorkId,
    survivingTitle: surviving.title.value,
    moving,
    destinationBefore,
    destinationAfter,
    editions: absorbedEditions.map((edition) => editionDestination(catalog, edition, survivingWorkId)),
    listChanges,
    assurances: [
      'Edition IDs stay stable, so assets, progress, annotations, ownership, and loans remain attached.',
      'Source records and user-corrected metadata remain intact on recoverable Work records.',
      'The operation and list changes are journaled together for compare-and-swap undo.',
    ],
  })
}

function countsFor(
  catalog: Catalog,
  work: Work,
  editions: readonly Edition[],
): DuplicatePreviewCounts {
  const editionIds = new Set<string>(editions.map(({ id }) => id))
  const sources = new Set<string>()
  for (const identifier of catalog.identifiers) {
    const belongs = identifier.owner.type === 'work'
      ? identifier.owner.id === work.id
      : editionIds.has(identifier.owner.id)
    if (belongs) identifier.sourceRecordIds.forEach((id) => sources.add(id))
  }
  for (const source of catalog.sourceRecords) {
    const belongs = (target: { readonly type: string; readonly id: string }) =>
      (target.type === 'work' && target.id === work.id)
      || (target.type === 'edition' && editionIds.has(target.id))
    if (
      source.claims.some(({ target }) => belongs(target))
      || source.observedIdentifiers.some(({ target }) => target && belongs(target))
    ) sources.add(source.id)
  }

  return {
    editions: editions.length,
    assets: catalog.assets.filter(({ editionId }) => editionIds.has(editionId)).length,
    progress: catalog.progressSnapshots.filter(({ editionId }) => editionIds.has(editionId)).length,
    annotations: catalog.readingEvents.filter(({ editionId, kind }) =>
      editionIds.has(editionId) && kind === 'note',
    ).length,
    listMemberships: catalog.listEntries.filter(({ workId }) => workId === work.id).length,
    loans: catalog.loans.filter(({ editionId }) => editionIds.has(editionId)).length,
    ownerships: catalog.ownerships.filter(({ editionId }) => editionIds.has(editionId)).length,
    sources: sources.size,
  }
}

function editionDestination(
  catalog: Catalog,
  edition: Edition,
  survivingWorkId: WorkId,
): DuplicateEditionDestination {
  return {
    editionId: edition.id,
    fromWorkId: edition.workId,
    toWorkId: survivingWorkId,
    title: edition.title.value,
    medium: edition.medium,
    assets: catalog.assets.filter(({ editionId }) => editionId === edition.id).length,
    progress: catalog.progressSnapshots.filter(({ editionId }) => editionId === edition.id).length,
    annotations: catalog.readingEvents.filter(({ editionId, kind }) =>
      editionId === edition.id && kind === 'note',
    ).length,
    loans: catalog.loans.filter(({ editionId }) => editionId === edition.id).length,
  }
}

function requiredWork(catalog: Catalog, workId: WorkId): Work {
  const work = catalog.works.find(({ id }) => id === workId)
  if (!work) throw new Error(`Missing Work ${workId}`)
  return work
}

function editionsFor(catalog: Catalog, workId: WorkId): Edition[] {
  return catalog.editions.filter(({ workId: candidate }) => candidate === workId)
}
