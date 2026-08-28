# Audiobook progress and listening-time semantics

Wovenleaf keeps two related measurements because they answer different questions:

- **Progress** is the absolute media position in the audiobook timeline. It advances faster at
  higher playback speeds and can jump in either direction when the reader seeks.
- **Listening time** is active wall-clock time. It advances only while the native player reports
  that audio is actually playing. Pauses, buffering, interruptions, route loss, sleep-timer stops,
  failures, and time while the app is absent are excluded.

A session begins with a native play/resume event and closes at pause, interruption, route loss,
sleep expiry, stop, end, or failure. The canonical session stores the start/end wall instants, the
native active-time delta, and the media positions at both boundaries. Playback speed changes media
progress but never multiplies listening time. A seek or rewind is a discontinuity: its destination
becomes the new progress position, but the distance jumped never becomes listened minutes.

## Durability and lifecycle

The native player checkpoints its absolute position, chapter, segment, rate, and monotonic active
duration when either 10 seconds of wall time or 15 seconds of media movement has elapsed, whichever
happens first. It forces the same transaction for transport commands, seeks, rate/chapter/segment
changes, interruptions, route changes, task/background removal, sleep expiry, stop, end, and errors.
The documented recovery bound is therefore at most **15 seconds of media position** after a
force-quit, reboot, or native process loss.

The foreground runtime mirrors the latest checkpoint into the canonical database with the same
throttle and flushes when the app becomes inactive. Native recovery remains authoritative while the
web runtime is absent. On the next connection, Wovenleaf drains semantic events into the reading
ledger and acknowledges only rows committed successfully. A recovered unfinished interval closes
at the last durable native active-time value with reduced timestamp confidence; time until relaunch
is not counted.

## Position authority and conflicts

There is only one live position authority: the highest native revision for the active playback
session. Outside an active session, Wovenleaf evaluates the latest position from each provenance
class with the reading-ledger precedence rules:

1. an explicit manual correction;
2. a first-party Wovenleaf player checkpoint;
3. imported, migrated, synchronized, or integration observations.

A newer external timestamp does not silently replace a first-party checkpoint. External-only
progress remains a proposal until the reader explicitly adopts it. Every accepted player position
keeps its Edition, Asset, native event, device class, observed/effective/recorded timestamps, and
confidence, so later corrections suppress evidence without deleting it.

## Validation cases

- Play for 60 wall-clock seconds at 2×: listening time is 60 seconds; media progress is roughly
  120 seconds.
- Play for 60 seconds with 40 seconds of buffering: listening time is 20 seconds.
- Seek from 10 minutes to 4 hours: progress becomes 4 hours; listening time does not gain 230
  minutes.
- Rewind 30 seconds and replay it: the rewind adds no time, while the replayed 30 active seconds do.
- Import a newer server position after offline local playback: the local checkpoint remains selected
  until an explicit manual/adoption decision says otherwise.
