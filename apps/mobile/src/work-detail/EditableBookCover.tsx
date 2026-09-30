import { t, useLanguage } from '../localization'
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ImagePlus, X } from 'lucide-react'
import { BookCover } from '../design-system'
import type { LibraryBook } from '../library'
import { ManualCoverError, prepareManualCover } from '../covers/manual-cover'
import { tw } from '../tailwind/styles'
import { motionStyles } from '../tailwind/motion'

const HOLD_DURATION_MS = 500
const HOLD_MOVEMENT_PX = 10

export function EditableBookCover({
  book,
  onCover,
}: {
  readonly book: LibraryBook
  readonly onCover: (thumbnail: string) => void
}) {
  useLanguage()
  const inputRef = useRef<HTMLInputElement>(null)
  const pressRef = useRef<{ pointerId: number; x: number; y: number; startedAt: number } | null>(null)
  const suppressClickRef = useRef(false)
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string>()

  const cancelPress = () => {
    if (pressRef.current) suppressClickRef.current = true
    pressRef.current = null
  }

  const startPress = (event: PointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary || event.button !== 0) return
    suppressClickRef.current = false
    pressRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startedAt: performance.now(),
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const movePress = (event: PointerEvent<HTMLButtonElement>) => {
    const press = pressRef.current
    if (press?.pointerId !== event.pointerId) return
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > HOLD_MOVEMENT_PX) cancelPress()
  }

  const endPress = (event: PointerEvent<HTMLButtonElement>) => {
    const press = pressRef.current
    pressRef.current = null
    if (press?.pointerId !== event.pointerId) return
    if (performance.now() - press.startedAt >= HOLD_DURATION_MS) {
      suppressClickRef.current = true
      // Keep the picker inside a user gesture so it also opens in mobile WebViews.
      inputRef.current?.click()
    }
  }

  const chooseCover = async (file: File | undefined) => {
    if (!file || busy) return
    setBusy(true)
    setMessage(undefined)
    try {
      onCover(await prepareManualCover(file))
      setMessage(t("Cover saved on this device."))
    } catch (error) {
      setMessage(error instanceof ManualCoverError
        ? error.message
        : t("Wovenleaf could not save that cover. Try another image."))
    } finally {
      setBusy(false)
    }
  }

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept="image/*"
      hidden
      disabled={busy}
      onChange={(event) => {
        void chooseCover(event.currentTarget.files?.[0])
        event.currentTarget.value = ''
      }}
    />
  )

  return (
    <div className={tw('editable-book-cover')}>
      <button
        type="button"
        disabled={busy}
        aria-label={t("View cover for {{v0}}", { v0: book.title })}
        aria-description={t("Press and hold to change the cover.")}
        aria-haspopup="dialog"
        aria-expanded={expanded}
        onPointerDown={startPress}
        onPointerMove={movePress}
        onPointerUp={endPress}
        onPointerCancel={cancelPress}
        onLostPointerCapture={cancelPress}
        onBlur={cancelPress}
        onContextMenu={(event) => event.preventDefault()}
        onDragStart={(event) => event.preventDefault()}
        onClick={(event) => {
          if (event.detail > 0 && suppressClickRef.current) {
            suppressClickRef.current = false
            return
          }
          setExpanded(true)
        }}
      >
        <BookCover book={book} large />
      </button>
      {!expanded && fileInput}
      {!expanded && message && <small role="status">{message}</small>}
      {expanded && (
        <CoverPreview book={book} onClose={() => setExpanded(false)}>
          <button className={tw('primary-button cover-preview__change')} type="button" disabled={busy} onClick={() => inputRef.current?.click()}>
            <ImagePlus aria-hidden="true" />
            {busy ? t("Preparing…") : book.thumbnail ? t("Change cover") : t("Add cover")}
          </button>
          {fileInput}
          {message && <p className={tw('cover-preview__message')} role="status">{message}</p>}
        </CoverPreview>
      )}
    </div>
  )
}

function CoverPreview({ book, onClose, children }: {
  readonly book: LibraryBook
  readonly onClose: () => void
  readonly children: ReactNode
}) {
  useLanguage()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const backdropPressRef = useRef(false)
  const [failedThumbnail, setFailedThumbnail] = useState<string>()

  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  const closePreview = () => {
    // Restore focus before React removes the dialog from the document.
    dialogRef.current?.close()
    onClose()
  }

  return createPortal(
    <dialog
      ref={dialogRef}
      className={tw('cover-preview', motionStyles.reveal)}
      data-motion-event="reveal"
      aria-label={t("Cover of {{v0}}", { v0: book.title })}
      onCancel={(event) => { event.preventDefault(); closePreview() }}
      onKeyDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => { backdropPressRef.current = event.target === event.currentTarget }}
      onClick={(event) => {
        event.stopPropagation()
        if (backdropPressRef.current && event.target === event.currentTarget) closePreview()
      }}
    >
      <div className={tw('cover-preview__content')}>
        <header className={tw('cover-preview__header')}>
          <h3>{book.title}</h3>
          <button className={tw('icon-button cover-preview__close')} type="button" onClick={closePreview} aria-label={t("Close cover preview")}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className={tw('cover-preview__image')}>
          {book.thumbnail && failedThumbnail !== book.thumbnail ? (
            <img referrerPolicy="no-referrer" src={book.thumbnail} alt={t("Cover of {{v0}}", { v0: book.title })} onError={() => setFailedThumbnail(book.thumbnail)} />
          ) : (
            <BookCover book={book} large />
          )}
        </div>
        <footer className={tw('cover-preview__footer')}>{children}</footer>
      </div>
    </dialog>,
    document.body,
  )
}
