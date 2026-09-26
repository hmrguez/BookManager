# Verifying foreground EPUB capture

The native hosts record completed foreground intervals into the existing reader outbox. The
TypeScript repository validates them and appends private ledger sessions. The corrected capture
version is independent of Readium's version; historical sessions remain unversioned.

## Automated checks

From `apps/mobile`:

```sh
bun test tests/reader-active-time.test.ts tests/epub-reader.test.ts tests/reading-ledger.test.ts tests/portable-archive.test.ts tests/recovery.test.ts
bun run lint
bun run typecheck
swiftc -module-cache-path /tmp/wovenleaf-swift-cache ios/App/App/ReaderActiveClock.swift tests/native/reader-active-clock.swift -o /tmp/wovenleaf-active-clock
/tmp/wovenleaf-active-clock
cd android
./gradlew :app:testDebugUnitTest --tests com.hmrguez.wovenleaf.ReaderActiveClockTest
```

The native clock tests cover repeated lifecycle callbacks, the exact five-minute gap and a longer
break, clock changes, delayed callbacks and loss of an unfinished crash tail. Repository tests
cover out-of-order/repeated delivery, checkpoint-write retry, quarter-boundary endpoints, archive
restore and historical/invalid capture versions. The native hosts still require integration drills.

## Native integration harness

`scripts/verify-reader-active-native.ts` is a test-only entry point. Bundle it with Bun's browser
ESM target into a **copy** of the built app's web assets, using an `index.html` that loads it.
Never install the harness over a personal library. Use a disposable iOS simulator and a separate
Android application ID (the verification used `com.hmrguez.wovenleaf.capturetest.dev`). The
harness imports an original fixture EPUB and uses the production importer, native reader,
Capacitor SQLite database, outbox and ledger repository. It creates no fixture finish evidence.

Send JSON commands to `reader-command.json` in the app cache directory. Each command has a unique
`id` and an `action`: `open`, `close` (iOS), `inspect`, or `drain`. Read `reader-verification.json`
in the same directory for the command result. iOS uses `Library/Caches`; Android uses `cache`
through `adb shell run-as <test-package>`. `drain` also replays the saved native events in reverse
order to verify that acknowledgement/repeated callbacks do not double-count sessions.

1. Open the fixture, wait longer than ten seconds, background the app for eight seconds, then
   resume the **existing reader**. On Android use its Recents card: explicitly starting the
   singleTask MainActivity clears the reader above it and tests closing, not resumption.
2. Read for several seconds, then close through Library/Back. Verify that the same capture has
   checkpoint, pause, resume and close boundaries, with a real gap that adds no active time.
3. Reopen, wait for another checkpoint, then kill the process without closing the reader.
   Restart with an `inspect` command, then drain. The earlier slices must survive, and no interval
   may extend from the last checkpoint through the kill or restart gap.
4. Check persisted sessions, not only callback totals: stable IDs, unique slices, capture version,
   exact endpoint/duration equality, and unchanged newer resume location after duplicate replay.
5. Compare timestamps using the **device's clock** and confirmed background transition time.
   Command dispatch latency and phone/host clock offsets are not reader activity errors.

## Recorded verification — 2026-09-26

Both Debug native builds compiled. The Swift clock executable and Android clock unit tests passed.
The 43 targeted TypeScript tests passed; lint and typecheck passed.

The iOS 26.5 iPhone 17 Pro simulator drill exercised the real Readium host, app switching,
close/reopen, process termination, native outbox replay and SQLite ingestion. Its final run retained
four new intervals totaling 27,415 ms, excluded the background gap, and omitted the unfinished
crash tail. Duplicate replay preserved one ledger event per interval.

The connected Android phone drill resumed the same reader through Recents, closed with real Back,
reopened and force-stopped the isolated app, then drained into native SQLite and replayed events.
Its final run retained four new intervals totaling 28,591 ms, with pause/resume boundaries,
background time excluded and no fabricated crash tail. Assertions used the phone's wall clock.
The separate test application left the personal Wovenleaf installation and library unchanged.

No historical duration repair or quarterly badge calculation is claimed here. The calculation
layer must still reconcile overlaps and enforce visit continuity from complete evidence.
