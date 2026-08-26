import {
  BookCheck,
  BookOpen,
  ChevronRight,
  Library,
  Plus,
  Search,
  Settings,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { LibraryBook, ShelfId } from '../library-model'
import { LocalSearchIndex } from './local-search'
import { tw } from '../tailwind/styles'

type CommandPaletteProps = {
  readonly open: boolean
  readonly books: readonly LibraryBook[]
  readonly libraryIndex: LocalSearchIndex
  readonly includePrivateNotes: boolean
  readonly onClose: () => void
  readonly onLibrary: () => void
  readonly onSettings: () => void
  readonly onShelf: (shelf: ShelfId) => void
  readonly onAdd: () => void
  readonly onBook: (bookId: string) => void
  readonly onBookAction: (bookId: string, shelf: ShelfId) => void
}

type PaletteCommand = {
  readonly id: string
  readonly label: string
  readonly detail: string
  readonly icon: LucideIcon
  readonly keywords: readonly string[]
  readonly run: () => void
}

type PaletteItem = {
  readonly id: string
  readonly label: string
  readonly detail: string
  readonly icon: LucideIcon
  readonly group: 'Commands' | 'Library' | 'Book actions'
  readonly run: () => void
}

export function CommandPalette({
  open,
  books,
  libraryIndex,
  includePrivateNotes,
  onClose,
  onLibrary,
  onSettings,
  onShelf,
  onAdd,
  onBook,
  onBookAction,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const listId = useId()
  const booksById = useMemo(() => new Map(books.map((book) => [book.id, book])), [books])
  const commands = useMemo<PaletteCommand[]>(() => [
    {
      id: 'library',
      label: 'My Books',
      detail: 'Return to the whole library',
      icon: Library,
      keywords: ['home', 'library', 'books', 'navigate'],
      run: onLibrary,
    },
    {
      id: 'add',
      label: 'Add a book',
      detail: 'Search providers or add local metadata',
      icon: Plus,
      keywords: ['new', 'create', 'book', 'search'],
      run: onAdd,
    },
    {
      id: 'reading',
      label: 'Currently reading',
      detail: 'Jump to books in progress',
      icon: BookOpen,
      keywords: ['reading', 'progress', 'shelf', 'navigate'],
      run: () => onShelf('reading'),
    },
    {
      id: 'next',
      label: 'Up Next',
      detail: 'Open the shortest shortlist',
      icon: Sparkles,
      keywords: ['next', 'queue', 'shelf', 'navigate'],
      run: () => onShelf('next'),
    },
    {
      id: 'settings',
      label: 'Settings',
      detail: 'Appearance, privacy, import, and export',
      icon: Settings,
      keywords: ['preferences', 'privacy', 'appearance', 'navigate'],
      run: onSettings,
    },
  ], [onAdd, onLibrary, onSettings, onShelf])

  const commandIndex = useMemo(() => {
    const index = new LocalSearchIndex()
    index.replace(commands.map((command) => ({
      id: command.id,
      title: command.label,
      tags: command.keywords,
      alternateTitles: [command.detail],
    })))
    return index
  }, [commands])

  const items = useMemo<PaletteItem[]>(() => {
    const cleanQuery = query.trim()
    const bookAction = parseBookAction(cleanQuery)
    const bookQuery = bookAction?.query ?? cleanQuery
    const matchingCommands = cleanQuery
      ? commandIndex.search(cleanQuery, { limit: 5 })
          .map(({ document }) => commands.find(({ id }) => id === document.id))
          .filter(isPresent)
      : commands
    const commandItems = matchingCommands.map((command) => ({
      id: `command:${command.id}`,
      label: command.label,
      detail: command.detail,
      icon: command.icon,
      group: 'Commands' as const,
      run: command.run,
    }))
    const bookItems = bookQuery
      ? libraryIndex.search(bookQuery, { includeNotes: includePrivateNotes, limit: 6 })
          .map(({ document }) => booksById.get(document.id))
          .filter(isPresent)
          .filter((book) => !bookAction || book.shelf !== bookAction.shelf)
          .map((book) => ({
            id: `book:${book.id}`,
            label: bookAction ? `${bookAction.label} · ${book.title}` : book.title,
            detail: bookAction
              ? `${book.authors.join(', ')} · Move from ${shelfLabel(book.shelf)}`
              : [book.authors.join(', '), book.format, shelfLabel(book.shelf)]
                  .filter(Boolean)
                  .join(' · '),
            icon: bookAction?.shelf === 'finished' ? BookCheck : bookAction ? BookOpen : Search,
            group: bookAction ? 'Book actions' as const : 'Library' as const,
            run: () => bookAction
              ? onBookAction(book.id, bookAction.shelf)
              : onBook(book.id),
          }))
      : []
    return [...commandItems, ...bookItems]
  }, [
    booksById,
    commandIndex,
    commands,
    includePrivateNotes,
    libraryIndex,
    onBook,
    onBookAction,
    query,
  ])

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => {
      window.clearTimeout(focusTimer)
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  if (!open) return null

  const run = (item: PaletteItem | undefined) => {
    if (!item) return
    onClose()
    item.run()
  }

  return (
    <div className={tw("command-backdrop")} onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className={tw("command-palette")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${listId}-title`}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          } else if (event.key === 'Tab') {
            const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
              'input, button:not(:disabled)',
            ) ?? [])]
            const first = focusable[0]
            const last = focusable.at(-1)
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault()
              last?.focus()
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault()
              first?.focus()
            }
          }
        }}
      >
        <header className={tw("command-palette__search")}>
          <Search aria-hidden="true" />
          <label className={tw("sr-only")} htmlFor={`${listId}-input`} id={`${listId}-title`}>
            Wovenleaf command menu
          </label>
          <input
            ref={inputRef}
            id={`${listId}-input`}
            role="combobox"
            aria-autocomplete="list"
            aria-controls={listId}
            aria-expanded="true"
            aria-activedescendant={items[activeIndex] ? `${listId}-${items[activeIndex].id}` : undefined}
            autoComplete="off"
            autoCapitalize="none"
            placeholder="Find a book or command"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActiveIndex(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActiveIndex((value) => items.length ? (value + 1) % items.length : 0)
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActiveIndex((value) => items.length ? (value - 1 + items.length) % items.length : 0)
              } else if (event.key === 'Enter') {
                event.preventDefault()
                run(items[activeIndex])
              }
            }}
          />
          <kbd>Esc</kbd>
        </header>

        <div className={tw("command-palette__results")} id={listId} role="listbox">
          {items.length ? items.map((item, index) => {
            const Icon = item.icon
            const previousGroup = items[index - 1]?.group
            return (
              <div className={tw("command-palette__result")} key={item.id}>
                {item.group !== previousGroup && <p>{item.group}</p>}
                <button
                  id={`${listId}-${item.id}`}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseMove={() => setActiveIndex(index)}
                  onClick={() => run(item)}
                >
                  <span className={tw("command-palette__icon")}><Icon aria-hidden="true" /></span>
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.detail}</small>
                  </span>
                  <ChevronRight aria-hidden="true" />
                </button>
              </div>
            )
          }) : (
            <div className={tw("command-palette__empty")}>
              <Search aria-hidden="true" />
              <strong>Nothing found</strong>
              <span>Try a title, author, shelf, or action.</span>
            </div>
          )}
        </div>

        <footer>
          <span><kbd>↑</kbd><kbd>↓</kbd> Move</span>
          <span><kbd>↵</kbd> Open</span>
          <span>Local only</span>
        </footer>
      </section>
    </div>
  )
}

function shelfLabel(shelf: ShelfId): string {
  return {
    tbr: 'To Be Read',
    next: 'Up Next',
    reading: 'Reading',
    finished: 'Finished',
  }[shelf]
}

function parseBookAction(query: string): {
  readonly label: string
  readonly query: string
  readonly shelf: ShelfId
} | undefined {
  const match = /^(start|read|finish|complete|done|next|queue)\s+(.+)$/i.exec(query)
  if (!match) return undefined
  const verb = match[1].toLocaleLowerCase()
  const bookQuery = match[2].trim()
  if (verb === 'finish' || verb === 'complete' || verb === 'done') {
    return { label: 'Mark finished', query: bookQuery, shelf: 'finished' }
  }
  if (verb === 'next' || verb === 'queue') {
    return { label: 'Move to Up Next', query: bookQuery, shelf: 'next' }
  }
  return { label: 'Start reading', query: bookQuery, shelf: 'reading' }
}

function isPresent<Value>(value: Value | undefined): value is Value {
  return value !== undefined
}
