# Audiobook playback validation

This runbook is the release gate for the native audiobook engine introduced by QUI-44. Run the matrix on at least one currently supported physical iPhone and one currently supported physical Android phone. Simulators and emulators do not provide reliable audio-focus, route, lock-screen, or process-recreation evidence.

Use [Audiobook progress and listening-time semantics](audiobook-progress.md) when validating the
canonical checkpoint, session-duration, seek, speed, and provenance behavior added by QUI-43.

## Invariants

- The native snapshot is authoritative. Every accepted command or external transition increments `revision`; React converges to the same snapshot within 1 second.
- A phone call, alarm, Siri/Assistant capture, or permanent audio-focus loss pauses playback immediately. Permanent loss clears automatic-resume intent.
- A transient focus loss may resume only when the engine was actively playing before the interruption, the platform explicitly permits resumption, the output route is still valid, and the user did not pause during the interruption. Otherwise playback remains paused until an explicit user action.
- Navigation and other duckable audio may duck without changing the play intent. Record the observed platform behavior in the evidence table.
- Wired-headset or Bluetooth removal always pauses and never moves playback to a private device speaker. Connecting a route never starts playback.
- A sleep timer always pauses and clears play intent. It never resumes automatically.
- Process recreation restores the exact queue, selected segment, rate, and a position no more than 15 seconds behind the last audible position. Restoration is paused; it never auto-plays.
- System-media metadata includes the book title, author, chapter, elapsed time, duration, and rate. Cover art is published only from a verified managed asset and is replaced whenever the queue identity changes.
- System-surface previews are private by default. Disabling previews removes title, author, chapter, and artwork immediately without disabling transport controls.
- Replayed command IDs are acknowledged against the current engine snapshot without applying their transport or seek effect a second time, including after process recreation.
- A missing, replaced, truncated, corrupt, or locked file preserves the last committed position and exposes a recoverable relink/retry state. The engine must not silently substitute another path.
- AirPlay is supported through the iOS system route picker. Android exposes platform Media3 routing but intentionally does not advertise Cast; Cast requires a separate remote-playback queue and is outside this issue.

## Preparation

1. Install a debug build from the same commit on both physical devices.
2. Import one 30-or-more-segment MP3 audiobook and one M4B with embedded chapters. Use media long enough for the one-hour endurance rows.
3. Confirm system-surface previews are disabled by default. Then enable them, begin playback in the middle of a chapter, set a non-default rate, and record the queue ID, segment, position, rate, engine epoch, session ID, and revision.
4. For every row, capture native logs and the React snapshot immediately before the stimulus, immediately after it, and after 1 second.

## Physical-device matrix

| Scenario | Stimulus | Required result | iOS | Android |
| --- | --- | --- | --- | --- |
| Large local import | Attach an MP3 larger than 512 MiB, then repeat with an M4B and a shared local file | Copy completes without a file-sized bridge string; stored byte size and SHA-256 match the original; cover, chapters, play/pause, seek, and saved position work through the existing player | ☐ | ☐ |
| M4B endurance | Play locked/backgrounded for one hour at 1× and again at 2× | No stop or stall; position, active time, battery, thermal state, and system surface remain coherent | ☐ | ☐ |
| MP3 endurance | Play the 30-or-more-segment fixture locked/backgrounded for one hour at 1× and again at 2× | File transitions remain monotonic and journaled once; no queue loss or runaway resource use | ☐ | ☐ |
| Lock/background | Lock the device, then leave it locked for two checkpoint intervals | Audio and system controls continue; queue, rate, artwork privacy, and position remain coherent | ☐ | ☐ |
| Metadata fidelity | Compare the player with lock screen, notification, and Control Center at a chapter boundary and a non-default rate | Title, author, cover, chapter, elapsed time, duration, and rate remain current with no stale book identity | ☐ | ☐ |
| Privacy toggle | Disable and re-enable system-surface previews while the device is locked and unlocked | Identity and artwork disappear immediately when disabled; transport controls remain labeled and usable; current metadata returns when enabled | ☐ | ☐ |
| Artwork replacement | Switch between two audiobooks with distinct covers, then return to the first | Each surface shows only the current verified cover; no stale artwork, retained identity, or increasing memory footprint | ☐ | ☐ |
| Command convergence | Use play, pause, ± skip, next/previous, and scrub from lock screen/headset | React matches the native revision and state within 1 second after foregrounding | ☐ | ☐ |
| Command replay | Replay an already acknowledged play, seek, skip, and chapter command after reconnect and after process recreation | The current snapshot is returned and position/state/revision are not changed a second time | ☐ | ☐ |
| Command accessibility | Inspect available actions with VoiceOver/TalkBack and operate a wired and Bluetooth headset | Only valid actions are exposed; skip labels include the interval; play/pause/seek/chapter actions announce and perform the same operation | ☐ | ☐ |
| Phone call | Accept and end an incoming call while playing | Pause on interruption; resume only when the OS recommends/allows it and all transient-resume conditions still hold | ☐ | ☐ |
| Siri/Assistant | Start and dismiss voice assistant while playing | Pause during capture; resume only if the OS marks it resumable and all transient-resume conditions hold | ☐ | ☐ |
| Navigation | Trigger spoken navigation over playback | Duck or transiently pause according to platform focus; no lost position or duplicate resume | ☐ | ☐ |
| Alarm/timer | Fire an alarm or system timer | Pause; no automatic resume after dismissal | ☐ | ☐ |
| Competing media | Start a music/video app, then stop it | Yield focus and remain paused unless the platform returns resumable transient focus | ☐ | ☐ |
| Wired route loss | Unplug wired headphones while playing | Pause immediately; no speaker playback | ☐ | ☐ |
| Bluetooth route loss | Power off/disconnect the active Bluetooth device | Pause immediately; no speaker playback; route snapshot updates | ☐ | ☐ |
| Route connect | Connect wired or Bluetooth output while paused | Route snapshot updates; playback remains paused | ☐ | ☐ |
| AirPlay | Select and remove an AirPlay route from system controls | Continue on selected route; removal follows route-loss policy without leaking to speaker | ☐ | N/A |
| UI recreation | Recreate the WebView/Activity repeatedly while playing | Native playback continues; the reconnected UI fetches the snapshot before draining events and converges within 1 second | ☐ | ☐ |
| Android task removal | Swipe away the Android UI task while playing | Media service, audio, queue, and system controls continue; reopening attaches without restarting playback | N/A | ☐ |
| Process recreation | Kill the app process from developer tools while backgrounded, then relaunch | Restore queue/segment/rate paused and no more than 15 seconds behind | ☐ | ☐ |
| File boundary | Play through MP3 segment and chapter boundaries | Gap behavior is acceptable, absolute time remains monotonic, one transition event is journaled | ☐ | ☐ |
| Sleep duration | Set a short duration timer | Pause at expiry, clear intent, journal one durable event | ☐ | ☐ |
| Sleep chapter | Set chapter-end timer before a boundary | Pause at the chapter boundary, clear intent, journal one durable event | ☐ | ☐ |
| Missing file | Remove one managed file between launches | Restore position, surface relink-required, and play no substitute | ☐ | ☐ |
| Corrupt/truncated file | Replace a managed file with invalid or shorter bytes | Preserve position and expose recoverable error with capability/fingerprint evidence | ☐ | ☐ |
| Protected data | Reboot before first unlock, then open from a notification/control | Report authentication-required; after first unlock, retry succeeds from saved position | ☐ | N/A |
| System library | Browse and control the current audiobook from an available system media/library surface | Privacy-filtered metadata and current queue are consistent; unsupported browse surfaces remain absent | N/A | ☐ |

## Evidence record

For each checked cell, record device model, OS version, build commit, route, audiobook format and fixture fingerprint, wall-clock timestamp, starting and ending revisions, measured React convergence time, maximum recovered-position delta, CPU, battery, thermal state, memory, journal size/write rate, and log/screen-recording location. A row passes only when the required result and all invariants hold. File a follow-up issue for every exception; do not reinterpret an exception as platform behavior without updating the architecture decision.

Automated contract tests cover schema validation, artwork validation, private-by-default preferences, system metadata hooks, snapshot ordering, command-race recovery,
at-least-once journal acknowledgement, checkpoint throttling, process-loss reconstruction,
buffering exclusion, seek/speed semantics, and stale external-progress precedence. The physical
matrix remains mandatory before release because CI cannot faithfully generate calls, alarms, route
loss, or OS process termination.

## Large-file import regression

Native audiobook writes transfer at most 1 MiB of binary data per call. Each independently encoded
chunk is decoded and appended to the same temporary file; only a complete size-checked file is
renamed into managed storage. Failed or canceled transfers remove the partial copy before catalog
records are committed. Web imports retain Blob storage. Shared native files use bounded reads, and
fingerprinting avoids an additional full-file JavaScript buffer copy.

The managed paths, original audio bytes, SHA-256 fingerprints, playback capabilities, manifest,
and catalog schema are unchanged. Existing imports, revisions, and listening progress therefore
use the same playback resolution and validation paths. Inspection still holds the original bytes
in memory; bounded transfers do not remove the WebView's memory limits for inspecting very large
files or selections.

`audiobook-file-transfer.test.ts` checks binary fidelity across padded chunk boundaries, web Blob
storage, cancellation, partial-write cleanup, truncation detection, duplicate copies, shared-file
reads, and hashing an offset view. `audiobook-import.test.ts` also checks that chunked MP3 audio and
covers produce the expected catalog records, chapters, fingerprints, and playback capabilities.

Embedded cover MIME types are identified from the image bytes during inspection. Playback also
accepts the legacy `image/jpg` alias as `image/jpeg`, so existing imports remain playable without
another copy. Unsupported optional artwork is omitted before queue validation and cannot block
otherwise valid audio.

Device check on 2026-09-07: Pixel 9, Android 17, debug build. A 865,096,461-byte MP3
completed the normal attachment flow. Original and managed-file SHA-256 both matched
`749630a5bb1a2de44d495696b6a489d17160e8d69ff4722c2743cb253fd599e1`.
The existing Media3 player loaded the 43,183,416 ms timeline with the legacy JPEG cover,
played, skipped forward 30 seconds, paused, and resumed without errors. After a full process
restart it restored paused at 36,025 ms, within 109 ms of the last paused snapshot. The player
was then returned to the beginning. This check does not mark the broader endurance matrix or
physical iOS/M4B/shared-file checks complete.
