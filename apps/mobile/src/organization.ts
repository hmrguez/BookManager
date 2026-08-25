import { useCallback, useEffect, useRef, useState } from 'react'
import {
  EMPTY_LIBRARY_ORGANIZATION,
  libraryOrganizationSchema,
  normalizeTagName,
  ORGANIZATION_POSITION_STEP,
  orderedShelfEntries,
  type CustomShelf,
  type CustomShelfEntry,
  type LibraryOrganization,
  type OrganizationTag,
} from './organization-model'
import type { OrganizationRepository } from './storage/organization-repository'
import { getStorageRuntime } from './storage/runtime'

export type ShelfDraft = {
  readonly id?: string
  readonly name: string
  readonly notes: string
  readonly pinned: boolean
  readonly archived?: boolean
}

export function useOrganization() {
  const [organization, setOrganization] = useState<LibraryOrganization>(EMPTY_LIBRARY_ORGANIZATION)
  const [organizationError, setOrganizationError] = useState<string>()
  const organizationRef = useRef(organization)
  const hasMutatedRef = useRef(false)
  const persistenceTailRef = useRef(Promise.resolve())

  const showOrganization = useCallback((next: LibraryOrganization) => {
    const validated = libraryOrganizationSchema.parse(next)
    organizationRef.current = validated
    setOrganization(validated)
  }, [])

  const enqueuePersistence = useCallback(
    (operation: (repository: OrganizationRepository) => Promise<void>) => {
      persistenceTailRef.current = persistenceTailRef.current
        .then(async () => operation((await getStorageRuntime()).organization))
        .catch((error: unknown) => {
          setOrganizationError(error instanceof Error ? error.message : String(error))
        })
    },
    [],
  )

  useEffect(() => {
    let active = true
    void getStorageRuntime()
      .then(({ organization: repository }) => repository.read())
      .then((stored) => {
        if (active && !hasMutatedRef.current) showOrganization(stored)
      })
      .catch((error: unknown) => {
        if (active) setOrganizationError(error instanceof Error ? error.message : String(error))
      })
    return () => {
      active = false
    }
  }, [showOrganization])

  const saveShelf = useCallback((draft: ShelfDraft): string => {
    const timestamp = new Date().toISOString()
    const current = organizationRef.current
    const previous = draft.id
      ? current.shelves.find(({ id }) => id === draft.id)
      : undefined
    const shelf: CustomShelf = {
      id: previous?.id ?? organizationId('custom-shelf'),
      name: draft.name.trim(),
      notes: draft.notes.trim(),
      pinned: draft.pinned,
      archived: draft.archived ?? previous?.archived ?? false,
      position: previous?.position
        ?? current.shelves.reduce((maximum, item) => Math.max(maximum, item.position), 0)
          + ORGANIZATION_POSITION_STEP,
      createdAt: previous?.createdAt ?? timestamp,
      updatedAt: timestamp,
    }
    const shelves = previous
      ? current.shelves.map((item) => item.id === shelf.id ? shelf : item)
      : [...current.shelves, shelf]
    hasMutatedRef.current = true
    showOrganization({ ...current, shelves })
    enqueuePersistence((repository) => repository.saveShelf(shelf))
    return shelf.id
  }, [enqueuePersistence, showOrganization])

  const setShelfMembers = useCallback((shelfId: string, bookIds: readonly string[]) => {
    const current = organizationRef.current
    const requestedIds = [...new Set(bookIds)]
    const requested = new Set(requestedIds)
    const existing = orderedShelfEntries(current, shelfId)
    const existingBookIds = new Set(existing.map(({ bookId }) => bookId))
    const timestamp = new Date().toISOString()
    let position = existing.reduce((maximum, entry) => Math.max(maximum, entry.position), 0)
    const retainedEntries = current.entries.filter(
      (entry) => entry.shelfId !== shelfId || requested.has(entry.bookId),
    )
    const additions: CustomShelfEntry[] = []
    for (const bookId of requestedIds) {
      if (existingBookIds.has(bookId)) continue
      position += ORGANIZATION_POSITION_STEP
      additions.push({
        id: organizationId('shelf-entry'),
        shelfId,
        bookId,
        position,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
    }
    hasMutatedRef.current = true
    showOrganization({ ...current, entries: [...retainedEntries, ...additions] })
    enqueuePersistence((repository) => repository.replaceShelfMembers(shelfId, requestedIds))
  }, [enqueuePersistence, showOrganization])

  const setBookMemberships = useCallback((bookId: string, shelfIds: readonly string[]) => {
    const current = organizationRef.current
    const requestedIds = [...new Set(shelfIds)]
    const requested = new Set(requestedIds)
    const existingShelfIds = new Set(
      current.entries.filter((entry) => entry.bookId === bookId).map(({ shelfId }) => shelfId),
    )
    const timestamp = new Date().toISOString()
    const entries = current.entries.filter(
      (entry) => entry.bookId !== bookId || requested.has(entry.shelfId),
    )
    for (const shelfId of requestedIds) {
      if (existingShelfIds.has(shelfId)) continue
      const maximum = current.entries
        .filter((entry) => entry.shelfId === shelfId)
        .reduce((value, entry) => Math.max(value, entry.position), 0)
      entries.push({
        id: organizationId('shelf-entry'),
        shelfId,
        bookId,
        position: maximum + ORGANIZATION_POSITION_STEP,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
    }
    hasMutatedRef.current = true
    showOrganization({ ...current, entries })
    enqueuePersistence((repository) => repository.replaceBookMemberships(bookId, requestedIds))
  }, [enqueuePersistence, showOrganization])

  const moveShelfEntry = useCallback((shelfId: string, bookId: string, targetIndex: number) => {
    const current = organizationRef.current
    const ordered = orderedShelfEntries(current, shelfId)
    const sourceIndex = ordered.findIndex((entry) => entry.bookId === bookId)
    if (sourceIndex === -1) return
    const boundedTarget = Math.max(0, Math.min(ordered.length - 1, Math.round(targetIndex)))
    if (sourceIndex === boundedTarget) return
    const [moved] = ordered.splice(sourceIndex, 1)
    ordered.splice(boundedTarget, 0, moved)
    const timestamp = new Date().toISOString()
    const changedById = new Map(ordered.map((entry, index) => [entry.id, {
      ...entry,
      position: (index + 1) * ORGANIZATION_POSITION_STEP,
      updatedAt: timestamp,
    }]))
    hasMutatedRef.current = true
    showOrganization({
      ...current,
      entries: current.entries.map((entry) => changedById.get(entry.id) ?? entry),
    })
    enqueuePersistence((repository) => repository.moveShelfEntry(shelfId, bookId, boundedTarget))
  }, [enqueuePersistence, showOrganization])

  const setShelfMembersInOrder = useCallback((shelfId: string, bookIds: readonly string[]) => {
    const current = organizationRef.current
    const requestedIds = [...new Set(bookIds)]
    const existingByBookId = new Map(
      current.entries.filter((entry) => entry.shelfId === shelfId).map((entry) => [entry.bookId, entry]),
    )
    const timestamp = new Date().toISOString()
    const orderedEntries = requestedIds.map((bookId, index) => {
      const previous = existingByBookId.get(bookId)
      return {
        id: previous?.id ?? organizationId('shelf-entry'),
        shelfId,
        bookId,
        position: (index + 1) * ORGANIZATION_POSITION_STEP,
        createdAt: previous?.createdAt ?? timestamp,
        updatedAt: timestamp,
      }
    })
    hasMutatedRef.current = true
    showOrganization({
      ...current,
      entries: [
        ...current.entries.filter((entry) => entry.shelfId !== shelfId),
        ...orderedEntries,
      ],
    })
    enqueuePersistence((repository) => repository.replaceShelfMembersInOrder(shelfId, requestedIds))
  }, [enqueuePersistence, showOrganization])

  const setBookTags = useCallback((bookId: string, names: readonly string[]) => {
    const current = organizationRef.current
    const existingByName = new Map(current.tags.map((tag) => [tag.normalizedName, tag]))
    const timestamp = new Date().toISOString()
    const tags: OrganizationTag[] = []
    const seen = new Set<string>()
    for (const rawName of names) {
      const name = rawName.trim().replace(/\s+/g, ' ').slice(0, 40)
      const normalizedName = normalizeTagName(name)
      if (!normalizedName || seen.has(normalizedName)) continue
      seen.add(normalizedName)
      tags.push(existingByName.get(normalizedName) ?? {
        id: organizationId('tag'),
        name,
        normalizedName,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
    }
    const retainedBookTags = current.bookTags.filter((bookTag) => bookTag.bookId !== bookId)
    const bookTags = [
      ...retainedBookTags,
      ...tags.map((tag) => ({ tagId: tag.id, bookId, createdAt: timestamp })),
    ]
    const usedTagIds = new Set(bookTags.map(({ tagId }) => tagId))
    const allTags = [
      ...current.tags.filter((tag) => usedTagIds.has(tag.id)),
      ...tags.filter((tag) => !current.tags.some(({ id }) => id === tag.id)),
    ]
    hasMutatedRef.current = true
    showOrganization({ ...current, tags: allTags, bookTags })
    enqueuePersistence((repository) => repository.replaceBookTags(bookId, tags))
  }, [enqueuePersistence, showOrganization])

  const removeShelf = useCallback((shelfId: string) => {
    const current = organizationRef.current
    hasMutatedRef.current = true
    showOrganization({
      ...current,
      shelves: current.shelves.filter(({ id }) => id !== shelfId),
      entries: current.entries.filter((entry) => entry.shelfId !== shelfId),
    })
    enqueuePersistence((repository) => repository.removeShelf(shelfId))
  }, [enqueuePersistence, showOrganization])

  const reloadOrganization = useCallback(async () => {
    await persistenceTailRef.current
    const stored = await (await getStorageRuntime()).organization.read()
    hasMutatedRef.current = false
    showOrganization(stored)
    setOrganizationError(undefined)
    return stored
  }, [showOrganization])

  return {
    organization,
    organizationError,
    saveShelf,
    setShelfMembers,
    setShelfMembersInOrder,
    setBookMemberships,
    moveShelfEntry,
    setBookTags,
    removeShelf,
    reloadOrganization,
  }
}

function organizationId(kind: string): string {
  return `${kind}:${crypto.randomUUID()}`
}
