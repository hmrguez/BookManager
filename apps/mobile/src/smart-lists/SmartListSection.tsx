import { useState } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  Info,
  ListFilter,
  SlidersHorizontal,
} from 'lucide-react'
import { BookCover } from '../design-system'
import type { LibraryBook } from '../library-model'
import type { SavedSmartList } from './model'
import type { SmartListQueryResult } from './query'
import { tw } from '../tailwind/styles'

export function SmartListSection({
  list,
  query,
  booksById,
  onDetails,
  onManage,
}: {
  list: SavedSmartList
  query: SmartListQueryResult
  booksById: ReadonlyMap<string, LibraryBook>
  onDetails: (bookId: string) => void
  onManage: () => void
}) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <section className={tw(`shelf smart-list${query.ok ? '' : ' smart-list--invalid'}`)} id={`smart-list-${list.id}`}>
      <header className={tw("shelf-header smart-list__header")}>
        <button
          type="button"
          className={tw("shelf-toggle")}
          onClick={() => setCollapsed((value) => !value)}
          aria-expanded={!collapsed}
          aria-controls={`smart-list-books-${list.id}`}
        >
          <ListFilter aria-hidden="true" />
          <h2>{list.name} <i>·</i> {query.ok ? query.items.length : '!'}</h2>
          <ChevronDown className={tw(collapsed ? 'is-collapsed' : '')} aria-hidden="true" />
        </button>
        <button type="button" className={tw("shelf-add smart-list__manage")} onClick={onManage} aria-label={`Manage ${list.name}`}>
          <SlidersHorizontal aria-hidden="true" />
        </button>
      </header>

      <div className={tw("smart-list__body")} id={`smart-list-books-${list.id}`} hidden={collapsed}>
        {query.ok ? (
          <>
            <div className={tw("smart-list__explanation")}>
              <span>Live rule</span>
              <p>{query.explanation}</p>
              {list.description && <small>{list.description}</small>}
            </div>
            {!query.items.length ? (
              <div className={tw("smart-list__empty")}>
                <ListFilter aria-hidden="true" />
                <span><strong>No books match right now</strong><small>The saved rules will keep watching this library</small></span>
              </div>
            ) : (
              query.groups.map((group) => (
                <section className={tw("smart-list-group")} key={group.key}>
                  {query.definition.groupBy !== 'none' && (
                    <header><span>{group.label}</span><strong>{group.items.length}</strong></header>
                  )}
                  <div>
                    {group.items.map((item) => {
                      const book = booksById.get(item.document.id)
                      if (!book) return null
                      return (
                        <article className={tw("book-row smart-book-row")} key={`${group.key}:${book.id}`}>
                          <button className={tw("book-identity")} type="button" onClick={() => onDetails(book.id)}>
                            <BookCover book={book} />
                            <span className={tw("book-copy")}>
                              <strong>{book.title}</strong>
                              <small>{book.authors.join(', ')}</small>
                            </span>
                          </button>
                          <details className={tw("smart-book-reasons")}>
                            <summary><Info aria-hidden="true" /><span>Why</span></summary>
                            <div>
                              <strong>Why this book is here</strong>
                              <ul>{item.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                            </div>
                          </details>
                        </article>
                      )
                    })}
                  </div>
                </section>
              ))
            )}
          </>
        ) : (
          <div className={tw("smart-list-invalid")} role="alert">
            <AlertTriangle aria-hidden="true" />
            <div>
              <strong>Rules need a newer or corrected configuration</strong>
              <p>The saved configuration is preserved. This list will not return partial or misleading results.</p>
              <ul>{query.issues.slice(0, 3).map((issue) => <li key={`${issue.path}:${issue.message}`}><b>{issue.path}</b> {issue.message}</li>)}</ul>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
