# WWV Radio

A web recreation of WWV's familiar seconds pulses, reference tones, and spoken UTC announcements. The tones are synthesized directly in Web Audio, with no added static or fading. Time announcements use recordings of the actual WWV announcer.

This is an independent listening application. It follows your device clock, not a connection to NIST's atomic clocks, and does not receive the live broadcast. The original voice recordings have telephone or radio bandwidth; an indistinguishable studio-quality match cannot be guaranteed.

## Run locally

Use Node.js 22.12 or later, or Node.js 20.19 or later in the 20.x series, and a browser with Web Audio and AudioWorklet support.

```sh
npm install
npm run dev
```

Open [localhost:5173](http://localhost:5173) and select **Start listening**. Vite binds to `127.0.0.1`; if port 5173 is occupied, use the address printed in the terminal. Starting playback loads the bundled recordings, so allow a moment on the first use.

## Listening controls

- **Start / Pause listening:** start or stop the broadcast. **Space** does the same when a form control or dialog is not focused.
- **Preview announcement:** hear the upcoming UTC announcement and minute marker immediately. Playback returns to current device time automatically; select **Return to current time** to return sooner.
- **Volume / Mute:** adjust the slider or press **M** to mute. With the slider focused, the arrow keys adjust volume.
- **Your signal:** independently enable seconds pulses, standard tones, voice announcements, and the 100 Hz time code. **Restore broadcast mix** enables all four.
- **Broadcast format / About the signal:** read the timing explanation, sources, and fidelity limits.

Volume and channel choices are saved in browser local storage when available. The waveform displays the actual output audio.

The sound is generated on the audio thread, so it does not depend on animation frames or foreground JavaScript timers. Keep the device awake: the browser or operating system can still suspend audio, especially on mobile devices. Playback resumes against the device clock after an audio-context interruption. Device-clock error, audio hardware drift, and output latency make this unsuitable as a precision time reference.

## Recreated broadcast

- 1,000 Hz seconds pulses lasting 5 ms, omitted at seconds 29 and 59.
- An 800 ms minute marker; the hour marker uses 1,500 Hz.
- The published minute schedule for 500 / 600 Hz tones, plus the scheduled 440 Hz tone and reserved intervals.
- Original recorded time phrases beginning around second 52.5, announcing the coming minute in UTC.
- Station identification at minutes 00 and 30.
- A 100 Hz BCD time-code subcarrier with locally calculated time, calendar, and US daylight-saving fields.

Live weather, geophysical bulletins, experimental transmissions, current DUT1 corrections, and leap-second notices are not supplied. The default simulated DUT1 value is zero and the leap-second warning is off. Reserved intervals retain the local signal components without inventing bulletins.

## Build and deploy

```sh
npm test
npm run build
npm run preview
```

`npm run build` produces `dist/`; `npm run preview` serves that build locally. Deploy the complete contents of `dist/` to a static host over **HTTPS** at the origin root. The audio URLs currently use `/audio/wwv/`, so deployment beneath a URL subdirectory requires updating the base and asset paths.

AudioWorklet requires HTTPS or a local development origin. Opening `index.html` directly from disk is not supported. The production app needs no application server, account, speech service, or API key. Voice files and fonts are bundled and served by the same host.

## Verification and implementation

`npm test` checks the broadcast schedule, marker duration and frequencies, protected silence, BCD encoding, calendar transitions, voice phrase assembly, output headroom, and audio-thread rendering against the offline signal model.

For full voice-and-tone rendering checks, install Python's `numpy` and `soundfile` packages, then run:

```sh
python scripts/audio/qa-decode.py
node scripts/audio/qa-worklet.mjs
```

The result is written to `artifacts/audio-qa/report.json`. The check renders representative minutes using the shipped recordings, checks for clipping or non-finite samples, and measures all 1,440 possible time announcements. The audio acquisition and preparation scripts are documented in [audio provenance](public/audio/wwv/SOURCES.md); the shipped files are already prepared.

See [architecture notes](docs/architecture.md) for the signal and playback design.

## Audio credits and sources

Voice clips come from Jim Kalafut's [WWV Simulator](https://wwv.mcodes.org/) and [MIT-licensed repository](https://github.com/kalafut/wwv), pinned to revision `ba716d2f7ce34002c54ffcb45fbf757551955e43`. The time phrases were recorded from NIST's telephone service. The station identifier derives from a contributed off-air recording; its embedded ticks were removed so the app can supply accurately timed pulses.

The original MIT notice, recording provenance, processing details, and file hashes are retained in [SOURCES.md](public/audio/wwv/SOURCES.md), [LICENSE-MIT.txt](public/audio/wwv/LICENSE-MIT.txt), and [manifest.json](public/audio/wwv/manifest.json). Preserve those notices when distributing the recordings.

- [NIST WWV station information](https://www.nist.gov/pml/time-and-frequency-division/time-distribution/radio-station-wwv)
- [NIST WWV/WWVH broadcast format and digital time code](https://www.nist.gov/pml/time-and-frequency-division/time-distribution/radio-station-wwv/wwv-and-wwvh-digital-time-code)
- [NIST telephone time-of-day service](https://www.nist.gov/pml/time-and-frequency-division/time-distribution/radio-station-wwv/telephone-time-day-service)

## Prior listening links

The original Windows shortcuts remain in this project:

- [WWV - Live Radio.url](WWV%20-%20Live%20Radio.url) opens a [Northern Utah WebSDR receiver at 10 MHz AM](http://websdr2.sdrutah.org:8902/index1a.html?tune=10000am&zoom=3) for the actual received broadcast. Radio reception can fade or contain static, and internet buffering delays the sound. Enter a listener name and use the receiver's audio-start button if prompted.
- [WWV - Clock Simulator.url](WWV%20-%20Clock%20Simulator.url) opens [Jim Kalafut's WWV Simulator](https://wwv.mcodes.org/), the external simulator used before this local application was built.

The receiver operator lists additional listening options at [Northern Utah WebSDR](https://www.sdrutah.org/).
