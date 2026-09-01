# Semantic feedback review record

This is the reviewable source of truth for QUI-10. Feedback reinforces a state change that is
already visible, named, focused, or announced. It never carries information by itself.

## Vocabulary

| Event | Native haptic intent | Quiet paper sound | Observable non-sensory source |
| --- | --- | --- | --- |
| Selection | Lightest discrete selection tick | Graphite contact | Selected state, value, and accessible name |
| Successful move | One soft settle at commit | Paper slide | Shelf membership, row position, and undo status |
| Boundary | One dry edge impact on entering the limit | Pencil meeting the page edge | Unchanged bounded value and visible min/max |
| Completion | Platform success primitive | Page turn and settle | Finished heading, check, identity, and shelf |
| Error | Platform error/reject primitive | Two muted paper taps | Alert text and recovery action |

The executable vocabulary, cooldowns, and information sources live in `model.ts`. A consumer calls
the central `FeedbackController`; components do not select hardware waveforms, create audio players,
or bypass throttling.

## Shelf-transfer synchronization

The full shelf move has one immediate soft haptic. Its generated `shelf-transfer.wav` then mirrors
the existing motion grammar without adding more vibration:

| Phase | Timeline | Sound |
| --- | ---: | --- |
| Source focus | 0–220 ms | Silence |
| Erase | 220–740 ms | Filtered eraser friction |
| Settle and destination focus | 740–1180 ms | Silence |
| Rewrite | 1180–1700 ms | Granular pencil stroke and a final paper contact |

A second semantic event replaces the active sample. Reduced motion uses the short semantic paper
slide immediately; it never plays a delayed 1.72-second sound against an instantaneous state change.

## Preferences and accessibility

- Haptics default to **System** and can be turned off in Settings. Native APIs remain subject to
  hardware, app state, and system touch-feedback policy.
- Paper sounds default **off**. Enabling them is a direct user action that also previews the page
  cue. They use device volume; no independent loudness control competes with system volume.
- Native paper sound is suppressed while audiobook/media playback is active, while the ringer is
  silent on Android, and while VoiceOver, Switch Control, or Android touch exploration is active.
- Background or hidden documents do not emit feedback. Web audio begins only after a direct user
  action. No sound plays on launch, during idle state, or for decorative loops.
- Selection is limited to one event per 90 ms, boundary to one per 360 ms, moves to one per 280 ms,
  and completion/error to one per 700 ms. Operation IDs also prevent duplicate terminal feedback.
- A haptic or sound failure is a no-op. UI state, focus, text, and live regions remain unchanged.

## Platform matrix

| Platform | Haptics | Sound |
| --- | --- | --- |
| iPhone | UIKit selection, soft/rigid impact, success, and error; system may decline playback | Generated bundled WAV through an ambient session; respects Silent mode and mixes with other audio |
| iPad | No substitute on hardware without supported haptics | Same generated sound policy; visual/text feedback remains authoritative |
| Android | `View.performHapticFeedback` semantic constants with API 26–29 fallbacks; no override flags or vibration permission | `SoundPool` sonification, one stream, no audio-focus request |
| Web | Intentionally none; raw `navigator.vibrate` is not a semantic substitute | Generated bundled WAV after a direct action when explicitly enabled |

## Homegrown audio assets

`bun run feedback:generate` deterministically writes mono 44.1 kHz, 16-bit PCM WAV files and a
SHA-256 manifest to `public/feedback`. The generator uses only seeded noise, filters, envelopes, and
damped oscillation from `scripts/generate-feedback-sounds.ts`; no recording, sample pack, remote
request, executable, or third-party audio library enters the build.

The checked-in WAV files are the runtime assets. `tests/feedback.test.ts` verifies their container,
duration, peak ceiling, manifest digest, and the silent separation between shelf erase and rewrite.

## Device review

CI verifies policy and audio structure, but simulators cannot approve physical feel. Before closing
QUI-10, review selection, boundary, move, completion, and error once on a supported iPhone and on
Android devices with at least one crisp and one coarse actuator. Repeat with system haptics off,
ringer silent, assistive reading active, Paper sounds off/on, Reduced motion, and audiobook playback.
