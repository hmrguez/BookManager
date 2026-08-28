# Audiobook listening controls

Wovenleaf keeps the native playback engine authoritative while an audiobook is loaded. The player
renders its latest snapshot; it does not run a second clock or infer transport state from a button.

## Speed and skips

- Speed uses pitch-preserving native playback and is bounded by the engine capability (currently
  0.5×–3× on the first-party engines).
- **This book** stores a per-book speed override. **All books** updates the global default. Removing
  the book override applies the global speed immediately.
- Back and forward intervals are global listening defaults. The foreground controls use a new value
  immediately; native system controls receive it in the immutable manifest the next time the book
  is loaded.

## Sleep timer

- Minute timers are native wall-clock deadlines. Their deadline and remaining time are visible in
  the player, and extending a timer replaces it with a new native deadline.
- End-of-chapter timers compare the native absolute position with the exact end of the chapter that
  was active when the timer was set. Pausing, buffering, or changing speed cannot make this mode
  expire early.
- Expiry pauses natively and journals `sleep-expired`, including while React is suspended. A process
  reconstruction restores paused and never restarts an expired or abandoned timer.
- Shake to extend is opt-in. It is considered only while a timer is active, has a five-second
  debounce, and adds the configured extension through the same native timer command as the button.

## Bookmarks, notes, and seek return

A bookmark or quick note first requests the latest authoritative snapshot. Its durable row contains
the book, edition, asset, queue, playback session, snapshot revision, absolute audio time, chapter,
and optional note. The markdown export includes the absolute time, chapter title, and note. Local
voice audio is described but never embedded in the text export.

The one-tap return action comes from the latest durable native `seek` event and its before/after
positions. It never guesses from the slider's local state. A return is offered only for the same
playback session and is cleared after use.

## Voice-note privacy

Starting a voice note pauses audiobook playback before microphone permission is requested. Capture
uses microphone input with echo cancellation and noise suppression; the playback plugin exposes no
recording, loopback, or mixing API. Recordings are limited to 90 seconds, stored under private local
app storage, omitted from text export, and deleted with their annotation. A failed database commit
removes the newly written audio file.
