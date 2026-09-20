# ADR 0013: Native audiobook playback ownership and recovery

- **Status:** Accepted, with mandatory physical-device validation gates
- **Date:** 2026-08-27
- **Issue:** QUI-45
- **Depends on:** [ADR 0003: Reading ledger](0003-reading-ledger.md), [ADR 0004: Private data and credentials](0004-private-data-and-integration-credentials.md), [ADR 0005: Transactional SQLite storage](0005-transactional-sqlite-storage.md)
- **Decision horizon:** The complete audiobook path in QUI-42 through QUI-49, including future Audiobookshelf and vehicle surfaces
- **Reference versions:** Capacitor 8.5.0, iOS deployment target 15.0, Android min/target/compile 24/36/36, AndroidX Media3 1.11.0

The original managed-content policy is extended by [original-file access](../../guides/original-files.md) as of 2026-09-20. Native queue ownership, durable events, and physical-device validation gates remain in force.

## Context

Wovenleaf is a React application in a Capacitor shell, but an audiobook is normally controlled while
the React WebView is backgrounded, suspended, absent, or being recreated. The playback owner must
continue across a locked screen, file boundaries, calls, audio-focus changes, Bluetooth changes,
system controls, and Android activity destruction without asking JavaScript what is actually
playing.

The rest of the audiobook project makes this a domain and durability decision rather than an audio
widget choice:

- QUI-42 produces one normalized audiobook Asset from an M4B or deterministically ordered MP3s,
  including chapters, fingerprints, metadata, and an app-managed file policy.
- QUI-44 requires resilient background playback, queue restoration, focus/session handling,
  pitch-corrected speed, route changes, and authoritative snapshots.
- QUI-43 requires position checkpoints and listening sessions that never turn a seek, buffer, or
  idle interval into listened time and never allow stale external progress to win silently.
- QUI-46 adds a background-reliable sleep timer, speed presets, chapter navigation, bookmarks,
  quick notes, and seek undo.
- QUI-47 treats the lock screen, notification, headset, Bluetooth, and system media controls as
  primary interfaces, with immediate privacy changes.
- QUI-48 separately evaluates CarPlay entitlement/review, Android Auto, and an in-app car mode.
- QUI-49 runs the eight-hour battery, thermal, memory, storage, and accessibility release suite.

[ADR 0003](0003-reading-ledger.md) already makes the append-only Edition reading ledger canonical
history and distinguishes wall-clock active duration from media position. This ADR must not create
a second historical ledger, but the ledger cannot be the live transport owner while its only
process is suspended. The architecture therefore needs an explicit operational authority and a
lossless handoff to canonical history.

This is a source- and build-feasibility decision. No physical iOS or Android device was connected
to the research host on 2026-08-27, so this ADR does not claim the one-hour locked playback or
interruption matrix has passed. Those tests remain mandatory gates below; a simulator build is not
evidence about calls, Bluetooth, battery, background execution, or process pressure.

## Decision

Build a first-party, audiobook-specific Capacitor plugin with one versioned TypeScript contract and
two native engines:

- **iOS:** Swift, `AVQueuePlayer`, an `AVAudioSession` configured for `.playback` and
  `.spokenAudio`, the Audio/AirPlay background mode, and `MPNowPlayingInfoCenter` plus
  `MPRemoteCommandCenter` for system state and commands.
- **Android:** Kotlin, AndroidX Media3 1.11.0 `ExoPlayer` inside a foreground
  `MediaLibraryService` with one `MediaLibrarySession`; React connects through a `MediaController`
  and never owns the player.
- **Web/PWA:** a separately reported, foreground-only `HTMLAudioElement` adapter. It is useful for
  development and browser listening, but is not presented as native background support.

Keep it as a workspace-local Capacitor plugin package so its Swift Package Manager product, Android
Gradle/Kotlin module, dependencies, and native tests remain isolated from `AppDelegate`,
`MainActivity`, and React. Publishing a general npm package is not part of this decision.

The plugin is a domain adapter, not a general-purpose sound API. Native code owns operational
playback, while the TypeScript domain owns books, durable reading history, product settings, and
integration reconciliation.

### Responsibility boundary

| Owner | Responsibilities |
| --- | --- |
| TypeScript catalog/import domain | Work, Edition, Asset, normalized chapter map, file ordering, fingerprints, review of ambiguous imports, format/protection errors, and construction of an immutable playback manifest |
| Native playback service/engine | Actual transport state, loaded queue, current item and absolute position, rate, buffering, focus/audio session, route and interruption policy, sleep timer, system metadata/commands, process restoration, operational checkpoints, and semantic-event outbox |
| TypeScript reading domain and SQLite | Canonical `ReadingEvent` and `ReadingSession` history, projections, bookmarks, notes, user settings, integration checkpoints, provenance/conflict rules, export, backup, and statistics |
| React player UI | Render the latest authoritative native snapshot, issue versioned commands, show capability/error states, and offer product controls; it never infers that audio is playing from its own button state |
| Operating system | May interrupt, duck, reroute, suspend, reject foreground execution, terminate a process, or deny a command. Native records the resulting state instead of pretending the requested state won |

There is one native player and one native media session per app. Multiple audio sessions would
create competing focus and system entries without serving an audiobook use case.

## Platform adapters

### iOS adapter

Use `AVQueuePlayer` because the normalized book may contain many MP3 files. Each queue item maps to
one manifest segment, while Wovenleaf exposes a single absolute book timeline. Embedded M4B chapter
metadata is extracted and normalized during import; the player consumes that chapter map rather
than rediscovering a different structure at runtime.

The adapter must:

1. configure `AVAudioSession` as `.playback` with `.spokenAudio`, without mixing with unrelated
   audio by default;
2. activate the audio session only when playback begins and deactivate it when the session is
   stopped or released, notifying other audio where appropriate;
3. enable the Audio/AirPlay background mode so playback can continue when the app is backgrounded
   or locked;
4. apply a pitch-preserving `AVPlayerItem.audioTimePitchAlgorithm` and report the range that passed
   device tests rather than hard-coding UI promises;
5. publish elapsed time, duration, rate, chapter, transport state, and privacy-filtered metadata
   through `MPNowPlayingInfoCenter`;
6. handle play, pause, toggle, seek, skip, next/previous chapter, and rate commands directly through
   `MPRemoteCommandCenter`; remote commands do not wait for JavaScript;
7. observe player time/control state, `AVAudioSession.interruptionNotification`, and
   `routeChangeNotification`, forcing a checkpoint for every discontinuity;
8. keep AirPlay available through the platform player without building a second transport.

The new Apple `NowPlaying` framework in the installed iOS 27 SDK is iOS 27-only. Wovenleaf's floor
is iOS 15, so the initial adapter uses the established MediaPlayer APIs. A future adapter may select
the new framework on supported systems, but it must never run it concurrently with
`MPNowPlayingInfoCenter`/`MPRemoteCommandCenter` for the same local playback session; Apple documents
that combination as undefined.

### Android adapter

Use `MediaLibraryService`, not an Activity-owned player or a plain `MediaSessionService`. It is the
background service Media3 prescribes, is a superset of `MediaSessionService`, enables system
playback resumption, and establishes the library boundary required by Android Auto.

The adapter must:

1. construct `ExoPlayer` and one `MediaLibrarySession` in the service, then expose the session to
   the plugin, system UI, Assistant, trusted peripherals, and future car clients;
2. declare the media-playback foreground service and required foreground-service permissions;
3. set media `AudioAttributes` to usage media and content type speech, letting ExoPlayer manage
   audio focus with `handleAudioFocus = true` for the app's API 36 target;
4. enable becoming-noisy handling and the appropriate wake mode while playback is active;
5. use Media3's playlist as the segment queue and map item positions to the absolute book timeline;
6. use Media3 metadata and media-button preferences as the source for the API 33+ system media
   surface rather than maintaining a divergent custom notification state;
7. accept connections and commands only from the app, trusted/system controllers, and approved
   browse clients; an exported service is not an unrestricted command endpoint;
8. implement `onPlaybackResumption` from the durable manifest, but only in response to an explicit
   system/user resumption request.

All Media3 modules use the same exact version. The initial dependency set is
`media3-exoplayer` and `media3-session`; add Cast or other modules only when their feature is
approved and tested.

### Interruption and resume policy

The native reducer applies the same product policy on both platforms even where callbacks differ:

| Situation | Required result |
| --- | --- |
| App backgrounded or screen locked | Continue if the user was playing; React presence is irrelevant |
| Incoming call or exclusive transient focus loss | Pause and checkpoint immediately; resume only when the OS recommends/allows it, playback had been active before the interruption, and no later user command revoked that intent |
| Navigation prompt / duckable focus loss | Follow platform speech-media behavior; record whether playback ducked, paused, or was suppressed and test the actual result on devices |
| Permanent focus loss / another media app | Pause, clear automatic-resume intent, and preserve position |
| Wired or Bluetooth output removed | Pause before audio can escape to speakers, force a checkpoint, and require an explicit resume |
| New route connected | Keep the current transport state; never start solely because a route appeared |
| UI Activity/WebView recreated | Connect a controller, fetch the native snapshot, then drain the journal; never push cached React state into the engine |
| Android task removed while audio is playing | Keep the media service and playback; removing a UI task is not a stop command |
| Force-stop, explicit terminate, or unexpected process death | Preserve the last checkpoint and queue, restore paused, and do not autoplay. A later system media-button/resumption request may explicitly resume |
| Sleep timer expires | Pause natively and journal the reason even if React is suspended; an expired timer never restarts after process recreation |

For iOS 15-era APIs the adapter considers the interruption `shouldResume` hint. On newer systems it
may use Apple's replacement resumption recommendation behind the same policy. A recommendation is
never stronger than a later user pause.

## Queue and source contract

QUI-42 produces an immutable, versioned `PlaybackManifest`. It contains:

- `queueId`, schema version, Edition ID, Asset ID, fingerprint, and creation time;
- sanitized display metadata separated from private system-surface metadata;
- ordered segments with stable IDs, MIME/container evidence, duration, cumulative absolute offset,
  fingerprint, and an opaque playable capability;
- chapters with stable keys, absolute start/end positions, source segment mapping, title, and
  provenance;
- initial absolute position, rate, skip intervals, sleep-timer state, and declared source
  capabilities.

M4B is treated as an MPEG-4 audio container based on probed content/MIME evidence, not on its file
extension. Version 1 guarantees only unprotected MP3 and unprotected MPEG-4/AAC/M4B that the native
platform decoders accept. A protected, corrupt, or unsupported file returns a typed error; Wovenleaf
does not add DRM circumvention or silently transcode with FFmpeg.

Multi-file books are flattened into one absolute millisecond timeline. Segment transition, chapter
transition, seeking, progress, and bookmarks all use that timeline. Sample-accurate gapless playback
is not claimed until the physical corpus proves it; an audible boundary failure is a QUI-44 blocker,
not permission to reorder or skip a segment.

The manifest never contains unrestricted imported paths:

- Android uses an app-managed copy or a persisted content-URI grant validated against the Asset.
- iOS uses an app-managed copy or a security-scoped bookmark validated against the Asset.
- A missing or fingerprint-mismatched capability becomes `relinkRequired`; the engine pauses at the
  last good position and never advances past the missing segment as if it was listened to.

Future remote sources implement a `PlayableSourceResolver` that returns a time-bounded playable
capability. The manifest may carry a non-secret `CredentialRef`, never a token, cookie, or signed URL
that is persisted into diagnostics or the reading ledger. If a credential cannot be accessed while
locked after process death, restoration remains paused and reports `authenticationRequired`.

QUI-60's future Audiobookshelf adapter owns server discovery, authentication, library mapping,
download/cache policy, and progress exchange in TypeScript. It can use `PlayableSourceResolver` to
prepare a stream for native playback, but native code never pushes progress directly to the provider.
Incoming provider progress enters the canonical reconciliation rules and, when accepted for an idle
player, crosses through `adoptPosition`; outgoing progress is derived only after native journal facts
commit to the canonical ledger. This prevents provider, React, and native playback from becoming
three position authorities.

## Bridge contract

The public bridge is versioned independently of the native implementation. Every mutating command
has a stable `commandId` and an `expectedRevision`. The native reducer serializes commands on the
player's owning executor, applies a command at most once, rejects a stale expectation, and returns
the resulting authoritative snapshot. System commands enter the same reducer with native-generated
IDs.

Version 1 exposes these coarse operations:

```text
getCapabilities
loadQueue
play | pause | stop
seekToAbsolute | seekBy
nextChapter | previousChapter
setRate
setSleepTimer | cancelSleepTimer
adoptPosition
getSnapshot
drainJournal | acknowledgeJournal
publishSystemLibraryIndex
setSystemSurfacePrivacy
```

`stop` ends the playback session and preserves the last position; it does not reset the book to
zero. `adoptPosition` is the only command that transfers a manual or integration position into the
active engine. It is allowed only while paused/stopped, names its provenance event, and creates a new
native revision. A stale external position can therefore be presented for review but cannot silently
overwrite active first-party progress.

There are only two bridge notifications:

- `snapshotChanged` is coalesced and ephemeral. It makes the foreground UI responsive but is never
  the only copy of a durable fact.
- `eventsAvailable` only tells JavaScript to drain the durable journal. Event payloads are not lost
  merely because a Capacitor listener was absent.

`PlaybackCapabilities` reports native/web engine kind, foreground/background support, system
controls, process restoration, system-library browsing, supported container/MIME evidence, rate
range, skip/sleep capabilities, AirPlay/Cast availability, and any degraded state. React hides or
explains unsupported controls. It never assumes platform parity from a successful plugin import.

### Snapshot identity

Every `PlaybackSnapshot` contains at least:

- bridge version, `engineEpoch`, `queueId`, `playbackSessionId`, and monotonically increasing
  `revision`;
- actual transport state, suppression/interruption reason, and the user's remaining play intent;
- segment and chapter IDs, absolute and segment position, duration, buffered position, and rate;
- sleep-timer mode/deadline/remaining time;
- route summary, capability flags, last command ID, and typed error/relink state.

An `engineEpoch` changes when native process memory is reconstructed. Revisions remain ordered
inside the durable playback session; the epoch makes impossible comparisons visible in diagnostics.
React accepts only a newer snapshot for the same session or an explicit session replacement.

## Operational journal and single position authority

The native service owns a small, versioned SQLite journal separate from Wovenleaf's canonical
Capacitor/SQLCipher database. On Android it uses app-private platform SQLite from the service; on iOS
it uses the platform SQLite library in an app-private, backup-excluded location.

The separation is deliberate:

- the Android service and iOS background player must not depend on a live WebView plugin connection;
- native code must not bypass TypeScript migrations or open the canonical database with a second
  connection/key/path policy;
- the journal has a tiny operational schema and can be deleted only after its events have been
  reconciled; the canonical database remains the sole home of reading history.

The journal stores the active manifest/capabilities, latest checkpoint, unfinished play interval,
sleep timer, applied command IDs, and unacknowledged semantic events. It stores no titles, cover
bytes, raw imported paths, notes, credentials, or provider payloads. Opaque playable capabilities
and Asset IDs remain app-private and backup-excluded. The journal is not presented as a separate
encryption boundary; it relies on the device sandbox and data protection under ADR 0004.

iOS audio Assets and this journal need a data-protection policy that permits an already-authorized
local queue to cross a locked-screen file boundary after first unlock. This does not weaken the
credential vault's `whenUnlockedThisDeviceOnly` policy. The concrete protection class and locked
transition behavior must be recorded in the physical validation result before shipping.

### Authority rule

There is no instant with two winning positions:

1. While a `playbackSessionId` exists, the native snapshot at its highest revision is the
   authoritative live position and transport state.
2. The native journal is the recovery source for that active session when React is absent or the
   process is reconstructed.
3. TypeScript drains journal facts idempotently into ADR 0003's canonical Edition ledger, commits
   events/sessions/projections in one repository transaction, then acknowledges their IDs/revision.
4. When there is no active native session, the projected ledger position is canonical and seeds the
   next immutable manifest.
5. Manual/imported/integration positions are proposals until `adoptPosition` explicitly creates the
   next native revision. React never writes a cached position directly over a live snapshot.

Native semantic events have stable IDs, session/revision, UTC observation time, monotonic active
duration, before/after positions where relevant, rate, reason, and confidence. The vocabulary
includes play/resume, pause, seek discontinuity, rate change, chapter/segment transition,
interruption, route loss, sleep expiry, stop, end, and failure. Replaying a drained batch cannot
duplicate a reading event or session.

Periodic recovery state is a latest-checkpoint record, not an unbounded event stream. Persist when
either 10 seconds of wall time or 15 seconds of media progress has elapsed, whichever occurs first,
and force a transaction on play/pause, seek, rate change, chapter or segment transition,
interruption, route change, background/task removal, sleep expiry, stop, end, and error. The
initial required recovery bound is therefore 15 seconds of media position. QUI-44 may tighten the
cadence after measuring writes and battery, but may not loosen it without updating this ADR.

The active-time accumulator advances only while the native player is actually playing and not
buffering, paused, failed, or focus-suppressed. A seek is a discontinuity, never listened duration.
When a process dies mid-interval, reconstruction closes the interval at the last durable monotonic
checkpoint with reduced end-time confidence; it does not count the time until relaunch.

Acknowledged semantic rows are removed during bounded compaction. The latest manifest/checkpoint
and unacknowledged semantic rows remain until reconciliation. The implementation must set and test a
hard storage bound while preserving terminal events and the latest checkpoint; no long session may
grow the journal without limit.

### Audiobook-specific control ownership

- Global and per-book rate/skip preferences live in TypeScript and seed the manifest; the current
  applied rate and any platform constraint live in the native snapshot.
- The sleep timer is evaluated and persisted natively. React displays its snapshot state and may
  extend/cancel it, but no JavaScript timer is authoritative.
- A bookmark or quick text note asks for the latest native snapshot and stores its exact
  playback-session/revision, absolute audio time, and chapter in the TypeScript domain.
- Seek undo is built from a native seek-discontinuity event with before/after positions; it does not
  guess from UI drag state.
- Voice-note recording is a separate privacy/capture feature. The playback plugin never records,
  loops back, or mixes copyrighted audiobook output into a note.

## System surfaces, privacy, cars, and casting

System controls act directly on the native reducer. The UI, lock screen, notification, Control
Center, headset, and Bluetooth controls all observe the same player/session snapshot.

ADR 0004 applies to media metadata. By default the plugin publishes generic Wovenleaf text and no
book artwork on locked/system surfaces. A specific preview preference may allow title, contributor,
chapter, progress, and cover. Changing that preference replaces Media3/Now Playing metadata
immediately, clears stale artwork caches, and republishes the current snapshot. Android API 33+
metadata must be changed at the media session, not only in a custom notification provider. Library
browse is limited to trusted controllers and returns generic or empty private rows until preview is
enabled.

The TypeScript domain publishes a small, derived, privacy-filtered system-library index after
catalog changes. It is a replaceable cache for native browse clients, not another catalog. This
allows an Android Auto or future CarPlay client to browse while the WebView is absent without giving
native code authority to rediscover or mutate the library.

Vehicle decisions remain separate:

- Android's chosen `MediaLibraryService` is the correct foundation for Android Auto/AAOS, but QUI-48
  still owns manifest declarations, driver-distraction quality, voice actions, emulator/vehicle
  tests, and Play review.
- CarPlay requires Apple's audio-app entitlement, provisioning, allowed templates, Siri media
  intents, and additional App Store review. This ADR creates no entitlement and does not promise
  approval.
- An in-app car mode remains a React surface driven by the same snapshots and commands and can ship
  independently of either vehicle approval.

AirPlay is enabled in version 1 through AVPlayer and the iOS background capability. Google Cast is
deferred: a phone-local file is not remotely playable merely because ExoPlayer can be swapped for a
Cast player. A later Cast adapter may use Media3 Cast only when `PlayableSourceResolver` provides a
receiver-reachable source and the same command/snapshot contract. Wovenleaf will not expose a hidden
local HTTP server solely to cast imported files.

## Failure and fallback policy

Native iOS/Android builds never fall back automatically to WebView audio. A silent fallback would
change background, focus, durability, system-control, and privacy guarantees while keeping the same
UI. Instead:

- engine initialization failure returns `engineUnavailable` and preserves the checkpoint;
- unsupported/protected/corrupt content returns a typed Asset error with no circumvention path;
- a missing or changed segment returns `relinkRequired` with the expected fingerprint;
- a segment transition error pauses at the last good position and never auto-skips;
- journal or manifest incompatibility restores paused and keeps the old journal for recovery/export;
- a disconnected bridge leaves native playback and journaling intact; reconnect begins with
  `getSnapshot` and `drainJournal`;
- web reports `foregroundOnly` and stops/preserves its browser checkpoint when the browser runtime
  can no longer guarantee playback.

Retry is explicit and idempotent. Errors never reset the book, discard the queue, fabricate a
session, or expose a raw platform/path/provider message to diagnostics.

## Option scorecard

Scores are 1 (poor) to 5 (strong). The result measures fit for Wovenleaf's complete project, not
general audio quality. The best observed general-purpose plugin capability is scored even though no
single plugin supplies every row. Source evidence and local compilation inform the score; the
physical validation gate can still reopen it.

| Criterion | Weight | First-party AVFoundation + Media3 | General Capacitor audio plugin | Web audio + Media Session | Shared VLC/FFmpeg engine |
| --- | ---: | ---: | ---: | ---: | ---: |
| Background lifecycle and process recovery | 5 | 5 | 4 | 1 | 4 |
| System controls and future car surfaces | 5 | 5 | 4 | 2 | 4 |
| Durable journal and reading-ledger fit | 5 | 5 | 1 | 1 | 3 |
| Chapters, multi-file queue, and absolute timeline | 4 | 5 | 3 | 2 | 4 |
| Speed and pitch behavior | 4 | 5 | 4 | 3 | 4 |
| Required unprotected M4B/MP3 formats | 4 | 5 | 4 | 3 | 5 |
| Battery/platform optimization evidence | 4 | 4 | 3 | 2 | 2 |
| Licensing and supply-chain control | 3 | 5 | 3 | 5 | 2 |
| Testability and observability | 4 | 4 | 2 | 4 | 3 |
| Maintenance and escape path | 4 | 4 | 3 | 5 | 2 |
| **Weighted total** | **210** | **198 (94%)** | **130 (62%)** | **111 (53%)** | **141 (67%)** |

### Why a first-party bridge wins

AVFoundation and Media3 already own the difficult operating-system contracts. A narrow first-party
adapter lets Wovenleaf use those contracts directly while adding the part generic players do not
know: an audiobook manifest, absolute book timeline, native revision authority, deterministic
interruption reasons, a durable journal, and idempotent reconciliation into ADR 0003.

This is more native code than installing a plugin, but less total architecture than wrapping a
generic plugin and then implementing another service, queue journal, conflict layer, privacy layer,
and car library beside it. The bridge also confines future platform/API migrations without changing
the TypeScript reading domain.

### Why current Capacitor plugins are not selected

The current market proves the approach is feasible but not that a dependency satisfies Wovenleaf:

- Capawesome Audio Player now offers native queues and media sessions, but it is a paid Insiders
  dependency and its generic events do not provide Wovenleaf's revision, durable outbox, session,
  privacy, or explicit position-adoption contract.
- `@mediagrid/capacitor-native-audio` supports Capacitor 8, native background playback, rate,
  notifications, and Media3 under an MIT license. Its public API centers on individual audio IDs,
  foreground/background callbacks, and transient status events, with no durable queue recovery or
  ledger reconciliation.
- Capgo Native Audio supports Capacitor 8 and background flags, but requires the application to
  create/manage the Android foreground service separately. Wovenleaf would still own the critical
  lifecycle and journal code while depending on a second transport abstraction.
- `@jofr/capacitor-media-session` keeps HTML audio as the player, documents Android WebView
  background unreliability, targets older Capacitor versions, and is GPL-3.0.
- `@capacitor-community/native-audio` is optimized for short, preloaded sound effects rather than a
  durable long-form media service.

A future plugin may be used behind this exact bridge if it implements the journal/authority
contract and passes the same corpus and lifecycle suite. The domain contract is the escape path;
vendor API types must never leak into React or the ledger.

### Why Web audio is not the native engine

The Web Media Session API can improve browser controls but cannot make the Capacitor WebView the
owner of an Android foreground media service, restore a dead process, or durably handle system
commands while JavaScript is suspended. Treating a foreground service as a keep-alive for an
`HTMLAudioElement` still leaves transport and event authority in the wrong lifecycle.

Web audio remains a useful development/browser adapter because its limited capability is explicit.

### Why VLC/FFmpeg is not selected

The project needs unprotected MP3 and MPEG-4/AAC/M4B, which the platform engines already support.
A shared third-party decoder would add native binary size, codec/licensing review, a foreign media
session integration layer, and a less direct battery path without solving Wovenleaf's journal or
authority rules. Reconsider a decoder only if a representative legal corpus exposes a format gap
that the import boundary cannot reject or normalize clearly.

## Research and local feasibility evidence

Completed on 2026-08-27:

- reviewed current Apple background playback, queue player, interruption, route-change, Now
  Playing, remote-command, AirPlay, and CarPlay entitlement/template documentation;
- reviewed current Android Media3 service/session/library, audio focus, playback resumption,
  supported-format, speed, battery/offload, Android Auto, and 1.11.0 release documentation;
- reviewed Capacitor 8's local plugin boundary and the current plugin alternatives above;
- confirmed `bunx cap doctor` passes for the repository;
- type-checked an iOS 15 Swift adapter slice importing AVFoundation and MediaPlayer and using
  `.playback`/`.spokenAudio`, `AVQueuePlayer`, pitch handling, Now Playing metadata, and remote skip;
- inspected the installed Xcode 27 SDK interface and confirmed the new `NowPlaying` types are marked
  iOS 27+;
- resolved `media3-exoplayer:1.11.0` and `media3-session:1.11.0` plus their Media3 AAR graph against
  the current Android app's AGP 8.13/API 36 attributes;
- ran `make ios-build` successfully for an iPhone 17 Pro simulator with deployment target iOS 15;
- ran `make android-build` successfully for the API 36 Android debug app.

The host has iOS simulators and an Android API 36.1 AVD, but no connected physical iPhone or Android
device. These checks establish source compatibility and build feasibility only.

## Mandatory implementation validation

QUI-44 cannot present this architecture as production-ready until a first-party adapter runs the
same licensed fixture corpus on physical iOS and Android hardware. At minimum:

1. play one single-file M4B and one 30-or-more-segment MP3 book for one locked/background hour at
   1x and 2x on each platform;
2. exercise incoming call, Siri/Assistant, navigation/ducking audio, alarm/other media, wired unplug,
   Bluetooth disconnect/reconnect, route switching, and system/headset commands;
3. background and foreground the UI repeatedly, destroy/recreate the Activity/WebView, remove the
   Android UI task, terminate the process, relaunch, and issue an explicit system resumption command;
4. cross chapter and file boundaries, seek far forward/back, change rate, expire and extend a sleep
   timer, and verify no seek becomes listened duration;
5. replay the unacknowledged native journal after termination and prove event/session ingestion is
   idempotent;
6. enable and disable system-surface previews while locked and prove titles/artwork are replaced
   immediately with no stale identity;
7. test missing, changed, corrupt, unsupported, and protected segments without progress loss or
   silent skip;
8. record device/OS, fixture fingerprint, expected/actual interruption policy, position delta,
   snapshot/system convergence, journal rows/writes, CPU, battery, thermal state, memory, and any
   platform-specific exception.

The initial pass/fail targets are:

- no unintended stop during the one-hour background runs;
- no more than 15 seconds of media-position loss after an ungraceful process death;
- no duplicate ledger event or session after any journal replay;
- queue/fingerprint/chapter identity survives reconstruction;
- a healthy foreground UI and system surface converge to the command result within one second;
- route loss never leaks spoken audio to newly selected speakers;
- process recreation never autoplays without retained uninterrupted playback or an explicit
  resumption action;
- journal size and write rate stay bounded.

QUI-49 remains the longer eight-hour performance/accessibility gate and may tighten budgets. A
failure of background continuity, position authority, event idempotence, privacy replacement, or
legal-format support reopens this ADR before player UI work expands.

## Upgrade and reconsideration strategy

1. Pin Capacitor and all Media3 modules exactly. Upgrade one platform layer at a time and replay
   bridge fixtures, native unit tests, process-recovery tests, and the physical interruption matrix.
2. Keep serialized command, manifest, snapshot, journal-event, and typed-error fixtures shared
   between TypeScript, Swift, and Kotlin. A bridge schema change is versioned and migration-tested.
3. Treat the iOS system-surface API as a replaceable adapter. Evaluate the iOS 27 `NowPlaying`
   framework after it is stable and the supported-OS strategy justifies it; activate exactly one
   system-surface adapter per session.
4. Keep Media3 behind Wovenleaf's player/session adapter. A future Cast player, Media3 API change, or
   replacement engine must still satisfy the same reducer and journal contract.
5. Reconsider a maintained third-party player only when it implements durable background queue
   recovery, Wovenleaf's revision/idempotence hooks, privacy updates, and supported-platform policy
   with lower measured total maintenance.
6. Reconsider native versus web only if Capacitor/WebView and browser standards provide documented,
   tested background execution, system-command, and process-restoration guarantees on both mobile
   platforms.

## Consequences

- Wovenleaf accepts two small native playback implementations and native lifecycle test suites.
- React stays the product UI but is no longer a playback authority.
- QUI-42 must output a normalized manifest instead of exposing raw imported files to the player.
- QUI-43 maps journal facts to the existing reading ledger rather than inventing an audiobook-only
  history store.
- QUI-46 can implement sleep and rate reliability in native code while bookmarks/notes remain
  durable domain records.
- QUI-47 uses platform sessions already attached to the real player and inherits ADR 0004 privacy.
- QUI-48 can build Android Auto from the existing library service and evaluate CarPlay separately
  without redesigning transport.
- QUI-49 begins instrumentation in the native adapters early, but owns the long-duration budgets.
- Native fallback is explicit failure, not a misleading switch to weaker WebView behavior.

## References

### Project decisions

- [ADR 0003: Reading event, session, progress, and provenance ledger](0003-reading-ledger.md)
- [ADR 0004: Private reading data and integration credentials](0004-private-data-and-integration-credentials.md)
- [ADR 0005: Transactional SQLite storage and repository boundaries](0005-transactional-sqlite-storage.md)

### Apple

- [Configuring your app for media playback](https://developer.apple.com/documentation/avfoundation/configuring-your-app-for-media-playback)
- [AVQueuePlayer](https://developer.apple.com/documentation/avfoundation/avqueueplayer)
- [AVPlayer](https://developer.apple.com/documentation/avfoundation/avplayer/)
- [Handling audio interruptions](https://developer.apple.com/documentation/avfaudio/handling-audio-interruptions)
- [Responding to audio route changes](https://developer.apple.com/documentation/avfaudio/responding-to-audio-route-changes)
- [AVAsset chapter metadata](https://developer.apple.com/documentation/avfoundation/avasset)
- [MPNowPlayingInfoCenter](https://developer.apple.com/documentation/mediaplayer/mpnowplayinginfocenter)
- [MPRemoteCommandCenter](https://developer.apple.com/documentation/mediaplayer/mpremotecommandcenter)
- [Now Playing framework](https://developer.apple.com/documentation/nowplaying)
- [Requesting CarPlay entitlements](https://developer.apple.com/documentation/carplay/requesting-carplay-entitlements)
- [CPListTemplate and Siri media intent requirements](https://developer.apple.com/documentation/carplay/cplisttemplate)

### Android

- [Introduction to Jetpack Media3](https://developer.android.com/media/media3)
- [Background playback with a MediaSessionService](https://developer.android.com/media/media3/session/background-playback)
- [Serve content with a MediaLibraryService](https://developer.android.com/media/media3/session/serve-content)
- [Control and advertise playback using a MediaSession](https://developer.android.com/media/media3/session/control-playback)
- [Manage audio focus](https://developer.android.com/media/optimize/audio-focus)
- [ExoPlayer supported formats](https://developer.android.com/media/media3/exoplayer/supported-formats)
- [PlaybackParameters](https://developer.android.com/reference/androidx/media3/common/PlaybackParameters)
- [ExoPlayer battery consumption](https://developer.android.com/media/media3/exoplayer/battery-consumption)
- [Media apps for cars overview](https://developer.android.com/training/cars/media)
- [AndroidX Media3 1.11.0 release](https://developer.android.com/jetpack/androidx/releases/media3)

### Capacitor and evaluated plugins

- [Creating Capacitor plugins](https://capacitorjs.com/docs/plugins/creating-plugins)
- [Capawesome Audio Player](https://capawesome.io/docs/plugins/audio-player/)
- [Mediagrid Capacitor Native Audio](https://github.com/mediagrid/capacitor-native-audio)
- [Capgo Capacitor Native Audio](https://github.com/Cap-go/capacitor-native-audio)
- [jofr Capacitor Media Session](https://github.com/jofr/capacitor-media-session)
- [Capacitor Community Native Audio](https://github.com/capacitor-community/native-audio)
