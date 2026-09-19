# WWV voice recording provenance

These are recordings of the actual WWV announcer, not browser text-to-speech or
an AI voice. This independent application is a recreation, not a live NIST feed
or an official NIST time service.

## Source and permission

The 67 original MP3 files are copied without alteration from Jim Kalafut's
[WWV Simulator repository](https://github.com/kalafut/wwv), revision
`ba716d2f7ce34002c54ffcb45fbf757551955e43`, retrieved September 19, 2026. The repository
is distributed under the MIT License, copyright (c) 2019 Jim Kalafut. The full
license is retained in [LICENSE-MIT.txt](./LICENSE-MIT.txt). File hashes and the
pinned source revision are recorded in [manifest.json](./manifest.json).

The author's [implementation notes](https://wwv.mcodes.org/#implementation)
explain that the time announcements were recorded from NIST's telephone service
using Google Hangouts, then edited into individual speech clips in Audacity.
[NIST describes that service](https://www.nist.gov/pml/time-and-frequency-division/time-distribution/radio-station-wwv/telephone-time-day-service)
as providing the audio portion of the radio broadcasts.

The newer station identification recording, `v_ident_better.mp3`, was added
through [upstream issue 31](https://github.com/kalafut/wwv/issues/31), contributed
by TS440S using Signal Phantom's radio recordings. The contributor states that
the recording author permitted their use. It is part of the same MIT repository.
This document does not independently assert that third-party recordings are
public domain merely because the originating broadcast is governmental.

## Files used by the application

- `v_0.mp3` through `v_59.mp3`: spoken numbers, reused for hours and minutes.
- `v_at_the_tone.mp3`: the introductory phrase.
- `v_hour.mp3`, `v_hours.mp3`, `v_minute.mp3`, `v_minutes.mp3`: singular and plural units.
- `v_utc.mp3`: the spoken UTC name.
- `v_ident_clean.wav`: a local derivative of `v_ident_better.mp3`, described below.
- `voice-map.json`: a simple clip ID to URL mapping for the audio engine.
- `manifest.json`: original SHA-256 hashes, sample rates, decoded durations,
  mono peak/RMS measurements, and processing metadata.

Original speech clips use 44.1 kHz MP3 with a mixture of mono and stereo files.
Stereo clips are averaged to mono for playback. Speech uses one common gain, not
independent normalization of every word. The largest decoded mono speech peak is
0.8878510594367981; multiplying all speech by
`0.75 / 0.8878510594367981` produces a maximum voice level of 75% relative to a
full-amplitude reference. Final application output volume may apply an additional
shared gain.

### Clean station identifier

The original identification clip is retained for traceability. Its embedded
seconds pulses occur about 0.98293 seconds after the recording starts and then
at one-second intervals. Playing that clip over synthetic pulses would duplicate
the ticks and make them early.

`scripts/audio/prepare.py` creates the playback derivative as follows:

1. Decode and average stereo channels to mono.
2. Prepend 753 samples, or 17.0748299 ms, to align the recorded timing with whole seconds.
3. Remove embedded pulses inside their existing 40 ms protected intervals,
   using 1 ms edit ramps. Preserve the intentionally missing tick at broadcast
   second 29.
4. Raise the whole identifier by a common gain of 1.2789678596, capped so its peak
   remains at 0.85. The voice itself is not pitch-shifted or resynthesized.
5. Save losslessly as 44.1 kHz, 16-bit, mono PCM WAV.

Start this derivative at second 1 of minute 0 or 30. It lasts 33.2853968254 seconds.
The engine must continue synthesizing normal seconds pulses while it plays.
No 100 Hz subcarrier suppression or spectral denoising is applied to the voice;
the source recording's residual broadcast/receiver characteristics remain.

## Time phrase assembly

[NIST's broadcast specification](https://www.nist.gov/pml/time-and-frequency-division/time-distribution/radio-station-wwv/wwv-and-wwvh-digital-time-code)
places the WWV time announcement approximately 7.5 seconds before the next
minute. The announced hour and minute are those of the upcoming minute in UTC,
including date rollover.

The original corpus's natural speech timing is preserved:

| Component | Start |
| --- | --- |
| `v_at_the_tone` | 52.5 seconds into the current minute |
| Hour number | 53.5 seconds |
| Hour unit | End of hour number + 0.1 seconds |
| Minute number | End of hour unit + 0.4 seconds |
| Minute unit | End of minute number + 0.1 seconds |
| `v_utc` | End of minute unit + 0.4 seconds |

Use the singular unit only for the number 1. The clip durations come from actual
decoded audio, with encoder padding removed. All 1,440 hour/minute combinations
were checked: the spoken announcement finishes between seconds 57.74143 and
59.01515, leaving room for the minute marker.

Selected durations: introduction 0.709864 s; hour 0.410635 s; hours 0.655238 s;
minute 0.428730 s; minutes 0.584104 s; UTC 1.651451 s. Every number's duration is
listed in the manifest.

## Fidelity limits

These files provide the broadcast announcer's actual voice and cadence. They
are telephone-bandwidth or off-air recordings and are not original studio
masters. Lossy encoding, bandwidth limits, slight clip-to-clip variation, and
residual recording noise cannot be recovered perfectly. Accordingly, an
indistinguishable match to the real transmitted broadcast is not guaranteed.
Live weather and other changing announcements are not supplied by this corpus.

The application generates ticks and reference tones directly rather than
replaying radio noise. Timing patterns and nominal relative levels are based on
the [NIST broadcast format](https://www.nist.gov/pml/time-and-frequency-division/time-distribution/radio-station-wwv/wwv-and-wwvh-digital-time-code)
and [NIST's station description](https://www.nist.gov/pml/time-and-frequency-division/time-distribution/radio-station-wwv).
Browser, operating system, and output-device latency remain outside the recording
corpus's control.

## Reproduction

Run `python scripts/audio/acquire.py` to retrieve the pinned, unmodified source
files and license. Then run `python scripts/audio/prepare.py` to generate the
clean identifier, measured metadata, and playback map. The second script needs
`numpy` and `soundfile`; no Python audio dependencies are needed by the web app.
