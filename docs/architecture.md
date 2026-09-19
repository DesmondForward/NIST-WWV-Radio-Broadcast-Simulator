# Audio architecture

The application is plain JavaScript and CSS, bundled by Vite. It synthesizes WWV's audio baseband locally and combines it with bundled recordings. It does not demodulate an RF signal or stream a receiver.

## Responsibilities

| File | Responsibility |
| --- | --- |
| `src/signal.js` | Pure signal model: broadcast schedule, second plans, BCD fields, marker/tone samples, and voice phrase timing. Also renders offline fixtures for tests. |
| `src/wwv-worklet.js` | AudioWorklet processor: generates every audio sample, mixes recorded phrases, and performs automatic preview return on the audio thread. |
| `src/audio-engine.js` | Browser audio lifecycle, decoding and transferring voice buffers, clock anchors, playback controls, gain ramps, and analyser output. |
| `src/main.js` | Receiver UI, persisted settings, dialogs, clock display, and waveform drawing. |
| `public/audio/wwv/` | Original recordings, prepared station ID, playback map, metadata, and attribution. |

The audio graph is `WWVProcessor → master gain → analyser → destination`. A single mono source is upmixed by Web Audio. The analyser observes the same output sent to the speakers.

## Timing

Starting playback anchors the current device epoch time to the audio context's sample position. The worklet derives subsequent signal time from audio frames rather than recurring main-thread timers. It calculates a signal plan once per second and the voice sequence once per minute; the UI can stop repainting in a background tab without removing the audio schedule.

Preview playback supplies an alternate epoch and a bounded duration. The worklet returns to the device-time anchor at the prescribed audio frame, applies short transition fades, and reports the change to the UI. Audio-context suspension prevents rendering; the engine re-anchors ordinary playback when the context resumes.

The initial time anchor comes from `Date.now()`. There is no NTP, NIST, or other remote clock synchronization, and no compensation for output-device latency. While playing, the audio clock advances independently of later operating-system clock adjustments.

## Signal composition

The signal model implements the five-cycle 1,000 Hz ticks, missing ticks, long minute/hour markers, scheduled reference tones, protective silent intervals, and 100 Hz time-code modulation. Channel switches select which components are mixed. Shared output headroom and gain ramps preserve a clean signal without adding static or receiver effects.

Voice files are decoded once, averaged to mono if necessary, and copied into the worklet. Phrase placement uses measured decoded durations with the source cadence preserved. Announcements name the next minute, including UTC midnight rollover. A common speech gain preserves the relative level of the original words.

The prepared station identifier removes embedded recording ticks inside the broadcast's protected intervals. The app then generates its own pulses on the audio clock. The original recording remains available for traceability. Telephone bandwidth and residual recording characteristics remain; see the detailed [provenance and processing notes](../public/audio/wwv/SOURCES.md).

## Validation boundaries

The Node test suite checks the pure signal model and executes the actual worklet using a minimal test host. The optional audio QA scripts decode the shipped recordings, render representative combinations through the worklet, and check clipping and announcement duration. These checks establish signal behavior and sample integrity; they do not establish subjective indistinguishability from a live station or guarantee uninterrupted playback under every browser power policy.
