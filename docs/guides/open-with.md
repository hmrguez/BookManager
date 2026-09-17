# Opening files from other apps

When another app opens or shares one EPUB or PDF with Wovenleaf, a successful
import opens its native reader. An already managed file opens the existing book
without adding another library entry. Failed imports stay in the import flow.
Batch ebook imports retain their summary instead of choosing a reader arbitrarily.

Book and audio handoffs immediately show a full-screen opening state, before the
native file read or format detection starts. It displays the supplied filename
when available, a subtle activity indicator, and reading/preparing/opening status.
It uses the current paper theme and respects reduced motion. The screen remains
until the reader/player handoff or import review is ready, and clears on errors.
New audio scrolls to its review section after preparation.

An already imported audiobook opens its player directly. Recognition uses the
audio content, so a renamed file or previously reviewed title does not require
another import. New audio keeps the metadata/order review; confirming the import
opens the player without starting playback. The review is visible even when
advanced file management is disabled.

Native callbacks are coalesced while handling a file, then released so the same
URI can be deliberately reopened immediately. Android shares use the share
plugin instead of also synthesizing a second URL callback. The iOS share
extension accepts supported audio alongside EPUB, PDF, and CSV.

Before handling another book on iOS, an existing native reader saves its session
and location and dismisses. This lets an incoming audio review or player appear
instead of remaining behind the previous reader.

## Verification — September 17–18, 2026

- **Pixel 9, Android 17, connected over USB:** the `OpenWithTest` instrumentation
  flow passed using real content-provider `ACTION_VIEW` and `ACTION_SEND` intents.
  It covers an initial EPUB launch, EPUB/PDF reading, renamed-file shares, immediate
  reopening of the same URI, audio review/player navigation, direct reopening of
  managed audio, unchanged import counts, and invalid-file errors without opening
  a reader. It uses one app session and preserves the existing library.
- **iPhone 17 Pro simulator, iOS 26.5:** EPUB, PDF, and MP3 were shared from Files
  through the actual Wovenleaf extension. The ebook readers opened after import;
  confirming new audio opened the player. Sharing that audio again while the PDF
  reader was active dismissed the PDF and opened the player without a review.
  SQLite contained two ebook imports, one audio import, and two reader checkpoints.
  The simulator's share extension did not foreground the host automatically, so
  Wovenleaf was resumed after sharing; the navigation checks cover that resumption.
- **Opening feedback follow-up, September 18:** a 10.8 MB image-heavy PDF shared
  from Files showed the opening screen on the iOS simulator and then opened in
  the PDF reader. The Android instrumentation flow checks a PDF over 10 MB via
  both Open With and sharing, records all three opening phases, and verifies
  dismissal after the reader handoff and invalid-file errors. It also holds the
  first provider read to verify feedback before any file bytes arrive.
- Lint and typecheck passed without warnings. The 86 targeted import/reader
  regression tests passed. iOS simulator and Android debug builds succeeded.

From `apps/mobile`, run the regression checks with:

```sh
bun run lint
bun run typecheck
bun test tests/audiobook-import.test.ts tests/epub-import.test.ts tests/pdf-reader.test.ts tests/epub-reader.test.ts tests/import-pipeline.test.ts
```

After building and installing the debug app and test APK, run the device flow:

```sh
adb shell am instrument -w \
  -e class com.hmrguez.wovenleaf.OpenWithTest \
  com.hmrguez.wovenleaf.test/androidx.test.runner.AndroidJUnitRunner
```

The device test creates synthetic books named “Open With …” and deliberately
does not reset or clear the device's library.
