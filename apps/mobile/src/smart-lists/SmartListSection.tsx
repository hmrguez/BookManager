import { t, translateCopy, useLanguage } from '../localization'
import { VirtualBookList } from '../library/VirtualBookList'
import { BookTile } from '../library/LibraryPresentation'
import { useLibraryView } from '../library/use-library-view'
import {
  AlertTriangle,
  ChevronDown,
  Info,
  ListFilter,
  SlidersHorizontal,
} from 'lucide-react'
import { BookCover, type MotionMode } from '../design-system'
import type { LibraryBook } from '../library-model'
import type { SavedSmartList } from './model'
import type { SmartListQueryResult } from './query'
import { tw } from '../tailwind/styles'
import { shelfCascadeItem, useShelfCascade } from '../library/shelf-cascade'

export function SmartListSection({
  list,
  query,
  booksById,
  motionMode,
  libraryHydrated = true,
  onDetails,
  onManage,
}: {
  list: SavedSmartList
  query: SmartListQueryResult
  booksById: ReadonlyMap<string, LibraryBook>
  motionMode: MotionMode
  libraryHydrated?: boolean
  onDetails: (bookId: string) => void
  onManage: () => void
}) {
  useLanguage()
  const grid = useLibraryView() === 'grid'
  const groupStarts = new Map<string, number>()
  let nextCascadeIndex = 1
  if (query.ok && query.items.length) {
    for (const group of query.groups) {
      groupStarts.set(group.key, nextCascadeIndex)
      nextCascadeIndex += group.items.length + (query.definition.groupBy === 'none' ? 0 : 1)
    }
  }
  const cascadeItemCount = query.ok ? (query.items.length ? nextCascadeIndex : 2) : 1
  const { isCollapsed, toggle, cascadeProps } = useShelfCascade({
    itemCount: cascadeItemCount,
    preferenceKey: `smart:${list.id}`,
    bookCount: query.ok ? query.items.length : 0,
    ready: libraryHydrated && query.ok,
    motionMode,
  })

  return (
    <section className={tw(`shelf smart-list${query.ok ? '' : ' smart-list--invalid'}`)} id={`smart-list-${list.id}`}>
      <header className={tw("shelf-header smart-list__header")}>
        <button
          type="button"
          className={tw("shelf-toggle")}
          onClick={toggle}
          aria-expanded={!isCollapsed}
          aria-controls={`smart-list-books-${list.id}`}
        >
          <ListFilter aria-hidden="true" />
          <h2>{list.name} <i>·</i> {query.ok ? query.items.length : '!'}</h2>
          <ChevronDown className={tw(isCollapsed ? 'is-collapsed' : '')} aria-hidden="true" />
        </button>
        <button type="button" className={tw("shelf-add smart-list__manage")} onClick={onManage} aria-label={t("Manage {{v0}}", { v0: list.name })}>
          <SlidersHorizontal aria-hidden="true" />
        </button>
      </header>

      <div className={tw("smart-list__body")} id={`smart-list-books-${list.id}`} {...cascadeProps}>
        {!cascadeProps.hidden && (query.ok ? (
          <>
            <div className={tw("smart-list__explanation")} {...shelfCascadeItem(0, cascadeItemCount)}>
              <span>{t("Live rule")}</span>
              <p>{query.explanation}</p>
              {list.description && <small>{list.description}</small>}
            </div>
            {!query.items.length ? (
              <div className={tw("smart-list__empty")} {...shelfCascadeItem(1, cascadeItemCount)}>
                <ListFilter aria-hidden="true" />
                <span><strong>{t("No books match right now")}</strong><small>{t("The saved rules will keep watching this library")}</small></span>
              </div>
            ) : (
              <VirtualBookList
                grid={grid}
                groups={query.groups.map((group) => ({
                  key: group.key,
                  items: group.items,
                  header: query.definition.groupBy === 'none' ? undefined : (
                    <div className={tw('smart-list-group')} style={{ width: '100%' }}>
                      <header {...shelfCascadeItem(groupStarts.get(group.key) ?? 1, cascadeItemCount)}>
                        <span>{['status', 'ownership', 'availability'].includes(query.definition.groupBy) ? translateCopy(group.label) : group.label}</span><strong>{group.items.length}</strong>
                      </header>
                    </div>
                  ),
                }))}
                getKey={smartItemKey}
              >
                {(item, index) => {
                  const book = booksById.get(item.document.id)
                  if (!book) return null
                  return (
                    <article
                      className={tw(grid ? 'book-tile' : 'book-row smart-book-row')}
                      key={book.id}
                      {...shelfCascadeItem(index + 1, cascadeItemCount)}
                    >
                      {grid ? <BookTile book={book} onDetails={onDetails} /> : <button className={tw("book-identity")} type="button" draggable data-library-book={book.id} onClick={() => onDetails(book.id)}>
                        <BookCover book={book} />
                        <span className={tw("book-copy")}>
                          <strong>{book.title}</strong>
                          <small>{book.authors.join(', ')}</small>
                        </span>
                      </button>}
                      <details className={tw("smart-book-reasons")}>
                        <summary><Info aria-hidden="true" /><span>{t("Why")}</span></summary>
                        <div>
                          <strong>{t("Why this book is here")}</strong>
                          <ul>{item.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                        </div>
                      </details>
                    </article>
                  )
                }}
              </VirtualBookList>
            )}
          </>
        ) : (
          <div className={tw("smart-list-invalid")} role="alert" {...shelfCascadeItem(0, cascadeItemCount)}>
            <AlertTriangle aria-hidden="true" />
            <div>
              <strong>{t("Rules need a newer or corrected configuration")}</strong>
              <p>{t("The saved configuration is preserved. This list will not return partial or misleading results.")}</p>
              <ul>{query.issues.slice(0, 3).map((issue) => <li key={`${issue.path}:${translateCopy(issue.message ?? '')}`}><b>{issue.path}</b> {translateCopy(issue.message ?? '')}</li>)}</ul>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function smartItemKey(item: { document: { id: string } }) { return item.document.id }
