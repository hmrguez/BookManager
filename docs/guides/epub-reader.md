# Native EPUB reader lifecycle

Wovenleaf renders reflowable EPUBs with the native Readium hosts selected in
[ADR 0012](../architecture/decisions/0012-epub-engine-and-reader-boundary.md): Swift Toolkit
3.11.0 on iOS and Kotlin Toolkit 3.3.0 on Android. LCP and other DRM modules are not linked.

## Resume contract

The Readium `Locator` is the canonical checkpoint. Wovenleaf stores its complete JSON rather than
reconstructing a location from a page number. Chapter title, chapter `href`, total progression, and
text context are derived views for UI, history, and recovery only. Switching between paginated and
scrolling layouts, rotating the device, backgrounding, changing books, or opening
`wovenleaf://reader?book=<book-id>` therefore returns the locator to Readium unchanged.

Locations are debounced for 750 ms. Backgrounding and closing the reader flush immediately, so a
normal lifecycle transition loses no observed position. A force-quit can lose at most the final
750 ms of movement after the last emitted locator. Native events are first written to a durable
outbox and use a monotonically increasing sequence per asset. The database ignores any sequence at
or below its checkpoint, making retries idempotent and preventing a delayed event from silently
moving progress backwards.

## Replacement and recovery

Every checkpoint records the managed asset's SHA-256 fingerprint. If a new import replaces that
asset, Wovenleaf preserves the semantic resource, progression, chapter title, and text context but
removes revision-specific fragments before asking Readium to resume. This avoids applying a stale
CFI or selector to changed content while retaining the best safe passage-level anchor.

The native hosts only accept file URLs inside the app-managed private library. A missing file,
invalid archive, protected publication, or resource load failure leaves the last trusted checkpoint,
reading-event ledger, notes, and annotations untouched. Recovery UI directs the reader back to the
library to re-import the edition; it never offers destructive cleanup as part of opening a book.
