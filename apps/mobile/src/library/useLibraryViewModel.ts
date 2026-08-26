import { useDeferredValue, useMemo } from 'react'
import type { Catalog } from '../domain/catalog'
import { SHELVES, type LibraryBook, type ShelfId } from '../library'
import { orderedShelfEntries, type LibraryOrganization } from '../organization-model'
import { useLibrarySearchIndex, type LocalSearchSort, type SearchPreferences } from '../search'
import {
  createSmartListDocuments,
  querySmartList,
  type SavedSmartList,
} from '../smart-lists'
import {
  buildUpNextSuggestions,
  orderedUpNextBooks,
  type UpNextState,
} from '../up-next-model'

type LibraryViewModelOptions = {
  books: LibraryBook[]
  organization: LibraryOrganization
  smartLists: SavedSmartList[]
  upNext: UpNextState
  smartListCatalog?: Catalog
  librarySearchOpen: boolean
  libraryQuery: string
  libraryShelfFilter: ShelfId | 'all'
  librarySort: LocalSearchSort
  searchPreferences: SearchPreferences
}

export function useLibraryViewModel({
  books,
  organization,
  smartLists,
  upNext,
  smartListCatalog,
  librarySearchOpen,
  libraryQuery,
  libraryShelfFilter,
  librarySort,
  searchPreferences,
}: LibraryViewModelOptions) {
  const deferredLibraryQuery = useDeferredValue(libraryQuery.trim())
  const normalizedLibraryQuery = deferredLibraryQuery.toLocaleLowerCase()
  const tagNamesByBookId = useMemo(() => {
    const tagById = new Map(organization.tags.map((tag) => [tag.id, tag.name]))
    const names = new Map<string, string[]>()
    for (const bookTag of organization.bookTags) {
      const tagName = tagById.get(bookTag.tagId)
      if (tagName) names.set(bookTag.bookId, [...(names.get(bookTag.bookId) ?? []), tagName])
    }
    return names
  }, [organization.bookTags, organization.tags])

  const listNamesByBookId = useMemo(() => {
    const shelfById = new Map(organization.shelves.map((shelf) => [shelf.id, shelf.name]))
    const names = new Map<string, string[]>()
    for (const entry of organization.entries) {
      const shelfName = shelfById.get(entry.shelfId)
      if (shelfName) names.set(entry.bookId, [...(names.get(entry.bookId) ?? []), shelfName])
    }
    return names
  }, [organization.entries, organization.shelves])

  const searchableBooks = useMemo(() => books.map((book) => ({
    ...book,
    tags: tagNamesByBookId.get(book.id),
    listNames: listNamesByBookId.get(book.id),
  })), [books, listNamesByBookId, tagNamesByBookId])
  const { index: librarySearchIndex, checkpoint: searchCheckpoint, indexing } =
    useLibrarySearchIndex(searchableBooks)
  const librarySearchActive = librarySearchOpen && Boolean(
    normalizedLibraryQuery
    || libraryShelfFilter !== 'all'
    || librarySort !== 'relevance',
  )
  const librarySearchResults = useMemo(() => {
    if (!librarySearchActive) return []
    return librarySearchIndex.search(deferredLibraryQuery, {
      includeNotes: searchPreferences.includePrivateNotes,
      shelves: libraryShelfFilter === 'all' ? undefined : [libraryShelfFilter],
      sort: librarySort,
    })
  }, [
    deferredLibraryQuery,
    librarySearchActive,
    librarySearchIndex,
    libraryShelfFilter,
    librarySort,
    searchPreferences.includePrivateNotes,
  ])
  const librarySearchResultById = useMemo(
    () => new Map(librarySearchResults.map((result) => [result.document.id, result])),
    [librarySearchResults],
  )
  const bookById = useMemo(() => new Map(books.map((book) => [book.id, book])), [books])
  const visibleBooks = useMemo(() => {
    if (!librarySearchActive) return books
    return librarySearchResults
      .map(({ document }) => bookById.get(document.id))
      .filter((book): book is LibraryBook => Boolean(book))
  }, [bookById, books, librarySearchActive, librarySearchResults])
  const booksByShelf = useMemo(
    () => Object.fromEntries(SHELVES.map(({ id }) => [
      id,
      visibleBooks.filter((book) => book.shelf === id),
    ])) as Record<ShelfId, LibraryBook[]>,
    [visibleBooks],
  )
  const orderedNextBooks = useMemo(
    () => orderedUpNextBooks(booksByShelf.next, upNext),
    [booksByShelf.next, upNext],
  )
  const upNextSuggestions = useMemo(
    () => buildUpNextSuggestions(searchableBooks, upNext),
    [searchableBooks, upNext],
  )
  const activeCustomShelves = useMemo(
    () => organization.shelves
      .filter(({ archived }) => !archived)
      .sort((left, right) => Number(right.pinned) - Number(left.pinned)
        || left.position - right.position
        || left.name.localeCompare(right.name)),
    [organization.shelves],
  )
  const archivedCustomShelves = useMemo(
    () => organization.shelves
      .filter(({ archived }) => archived)
      .sort((left, right) => left.name.localeCompare(right.name)),
    [organization.shelves],
  )
  const visibleBookById = useMemo(
    () => new Map(visibleBooks.map((book) => [book.id, book])),
    [visibleBooks],
  )
  const booksByCustomShelf = useMemo(() => new Map(activeCustomShelves.map((shelf) => [
    shelf.id,
    orderedShelfEntries(organization, shelf.id)
      .map(({ bookId }) => visibleBookById.get(bookId))
      .filter((book): book is LibraryBook => Boolean(book)),
  ])), [activeCustomShelves, organization, visibleBookById])
  const activeSmartLists = useMemo(
    () => smartLists
      .filter(({ archived }) => !archived)
      .sort((left, right) => Number(right.pinned) - Number(left.pinned)
        || left.position - right.position
        || left.name.localeCompare(right.name)),
    [smartLists],
  )
  const archivedSmartLists = useMemo(
    () => smartLists
      .filter(({ archived }) => archived)
      .sort((left, right) => left.name.localeCompare(right.name)),
    [smartLists],
  )
  const smartListDocuments = useMemo(
    () => createSmartListDocuments(books, organization, smartListCatalog),
    [books, organization, smartListCatalog],
  )
  const smartListQueries = useMemo(
    () => new Map(activeSmartLists.map((list) => [
      list.id,
      querySmartList(list.definition, smartListDocuments),
    ])),
    [activeSmartLists, smartListDocuments],
  )

  return {
    activeCustomShelves,
    activeSmartLists,
    archivedCustomShelves,
    archivedSmartLists,
    bookById,
    booksByCustomShelf,
    booksByShelf,
    indexing,
    librarySearchActive,
    librarySearchIndex,
    librarySearchResultById,
    orderedNextBooks,
    searchCheckpoint,
    smartListDocuments,
    smartListQueries,
    upNextSuggestions,
    visibleBooks,
  }
}

export type LibraryViewModel = ReturnType<typeof useLibraryViewModel>
