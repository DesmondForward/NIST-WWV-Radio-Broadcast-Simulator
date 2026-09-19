import "./style.css";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import { WWVAudioEngine } from "./audio-engine.js";
import { getToneFrequency } from "./signal.js";

const icons = {
  radio:
    '<path d="M12 8v13M7 21l5-13 5 13M9 17h6M7 4a7 7 0 0 0 0 10M17 4a7 7 0 0 1 0 10M4 1a11 11 0 0 0 0 16M20 1a11 11 0 0 1 0 16"/><circle cx="12" cy="7" r="1.3"/>',
  play: '<path d="m9 5 11 7-11 7z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="4"/>',
  volume:
    '<path d="m11 5-6 4H2v6h3l6 4zM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/>',
  muted: '<path d="m11 5-6 4H2v6h3l6 4zM16 9l6 6M22 9l-6 6"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  external: '<path d="M14 3h7v7m0-7L10 14M10 3H4v17h17v-6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  headphones:
    '<path d="M4 14v-3a8 8 0 0 1 16 0v3M4 12H2v8h5v-8H4Zm16 0h2v8h-5v-8h3Z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  wave: '<path d="M2 12h3l3-8 4 16 4-12 3 4h3"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
};
const icon = (name, cls = "") =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
const channelArt = (shape) =>
  `<svg viewBox="0 0 30 24" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="${{ pulse: "M0 12h8v7h5V5h5v7h12", sine: "M0 12C5-2 10 26 15 12S25-2 30 12", voice: "M3 10v4m4-7v10m4-13v16m4-12v8m4-14v20m4-15v10m4-7v4", data: "M0 17h5V7h8v10h5V11h7v6h5" }[shape]}"/></svg>`;
const $ = (selector) => document.querySelector(selector);
const pad = (value) => String(value).padStart(2, "0");
let stored = {};
try {
  stored = JSON.parse(localStorage.getItem("wwv-settings") || "{}");
} catch {
  /* Storage is optional. */
}
const state = {
  volume: Number.isFinite(stored.volume)
    ? Math.min(1, Math.max(0, stored.volume))
    : 0.65,
  options: {
    ticks: true,
    tones: true,
    voice: true,
    data: true,
    ...stored.options,
  },
  muted: false,
  busy: false,
  preview: false,
  loaded: false,
};
const engine = new WWVAudioEngine({ volume: state.volume, ...state.options });
const save = () => {
  try {
    localStorage.setItem(
      "wwv-settings",
      JSON.stringify({ volume: state.volume, options: state.options }),
    );
  } catch {
    /* Private browsing may disable storage. */
  }
};

$("#app").innerHTML = `
  <header class="site-header">
    <a class="brand" href="#" aria-label="WWV home">${icon("radio")}<span>WWV</span><span class="brand-description">STANDARD TIME<br>AND FREQUENCY</span></a>
    <nav aria-label="Main navigation"><button class="nav-link active" id="listen-nav">Listen</button><button class="nav-link" data-dialog="format-dialog">Broadcast format</button><button class="nav-link" data-dialog="about-dialog">About the signal ${icon("external")}</button></nav>
    <span class="header-location"><span class="tiny-dot"></span> FORT COLLINS, CO</span>
  </header>
  <main>
    <section class="intro"><div><div class="eyebrow">ON THE AIR SINCE 1919</div><h1>The sound of time<span>.</span></h1><p>A familiar voice. A steady pulse. Every second, on the second.</p></div><div class="quality-note">${icon("headphones")}<div>Pure signal. Clear mind.<small>A WWV broadcast recreation</small></div></div></section>
    <div class="receiver-layout">
      <section class="receiver panel" aria-label="WWV receiver">
        <div class="panel-heading"><div class="section-label"><span class="tiny-dot amber"></span> WWV <span class="muted">/</span> TIME SIGNAL</div><div id="play-status" class="status"><span class="status-dot"></span><span>STANDBY</span></div></div>
        <div class="clock-display"><div class="clock-overline"><span>COORDINATED UNIVERSAL TIME</span><span class="clock-source" title="Time follows your device clock">${icon("clock")} DEVICE CLOCK</span></div><div class="time-row"><time id="utc-clock" class="utc-clock" aria-label="Current UTC time">00<span>:</span>00<span>:</span><b>00</b></time><span class="utc-tag">UTC<br><small>+00:00</small></span></div><div class="date-row"><span id="utc-date">—</span><span id="day-number">DAY — / 365</span></div></div>
        <div class="scope"><div class="scope-labels"><span>${icon("wave")} AUDIO MONITOR</span><span id="scope-info">OUTPUT IDLE</span></div><canvas id="waveform" aria-label="Live audio waveform"></canvas><div class="scope-baseline"><span>−1</span><span>0</span><span>+1</span></div></div>
        <div class="transport"><button id="power" class="play-button">${icon("play")}<span>Start listening</span></button><div class="volume-control"><button id="mute" class="icon-button" aria-label="Mute audio" title="Mute (M)">${icon("volume")}</button><input id="volume" type="range" min="0" max="100" value="${Math.round(state.volume * 100)}" aria-label="Volume"><output id="volume-value">${Math.round(state.volume * 100)}%</output></div><button id="preview" class="preview-button" title="Hear the next time announcement and minute marker">Preview announcement ${icon("arrow")}</button></div>
        <div class="receiver-foot"><span id="engine-status"><span class="tiny-dot"></span> Ready when you are</span><span>SPACE TO PLAY / PAUSE</span></div>
        <div id="audio-error" role="alert" hidden></div>
      </section>
      <aside class="mix-panel panel" aria-label="Sound controls"><div class="panel-heading"><span class="section-label">YOUR SIGNAL</span><span class="panel-index">01—04</span></div><div class="mix-intro"><h2>A little more presence.<br> A little less noise.</h2><p>The original rhythm, without the static.</p></div>
        <div class="channel-list">
          ${[
            ["ticks", "Seconds pulse", "1,000 Hz · the heartbeat", "pulse"],
            ["tones", "Standard tones", "500 / 600 Hz · the hum", "sine"],
            [
              "voice",
              "Voice announcements",
              "Original WWV recordings",
              "voice",
            ],
            ["data", "Time code", "100 Hz · the undertone", "data"],
          ]
            .map(
              ([key, label, description, shape]) =>
                `<div class="channel"><span class="channel-art ${shape}" aria-hidden="true">${channelArt(shape)}</span><div><label id="label-${key}" for="toggle-${key}">${label}</label><small>${description}</small></div><button type="button" class="toggle" id="toggle-${key}" data-channel="${key}" role="switch" aria-checked="${Boolean(state.options[key])}" aria-labelledby="label-${key}"><span></span></button></div>`,
            )
            .join("")}
        </div><div class="mix-bottom"><button id="restore" class="text-button">Restore broadcast mix ${icon("arrow")}</button><div class="clean-badge">${icon("check")} NO STATIC. NO FADING.</div></div>
      </aside>
    </div>
    <div class="details-layout">
      <section class="minute-panel panel"><div class="panel-heading"><span class="section-label">INSIDE THIS MINUTE</span><button class="text-button" data-dialog="format-dialog">Explore the format ${icon("arrow")}</button></div><div class="minute-current"><div><span id="segment-label">STANDARD FREQUENCY</span><h2 id="tone-label">— Hz <small>audio tone</small></h2></div><div class="minute-counter"><strong id="minute-second">00</strong><span>/ 60 SEC</span></div></div><div class="minute-timeline"><div class="timeline-sections"><div class="tone-region"></div><div class="quiet-region"></div><div class="voice-region"></div><div id="timeline-cursor"></div></div><div class="timeline-ticks">${Array.from({ length: 61 }, (_, i) => `<i class="${i % 5 === 0 ? "major" : ""}"></i>`).join("")}</div><div class="timeline-times"><span>00</span><span>15</span><span>30</span><span>45</span><span>60</span></div></div><div class="timeline-key"><span><i class="key-tone"></i>Standard tone <em>00–45s</em></span><span><i class="key-quiet"></i>Pause <em>45–52.5s</em></span><span><i class="key-voice"></i>Voice <em>52.5s</em></span></div><div class="announcement"><span class="quote-mark">“</span><div><span class="eyebrow">NEXT TIME ANNOUNCEMENT</span><p id="next-announcement">At the tone…</p></div><span id="voice-countdown">IN —s</span></div></section>
      <section class="station-panel panel"><div class="panel-heading"><span class="section-label">THE STATION</span>${icon("radio")}</div><div class="station-landscape" aria-hidden="true"><svg viewBox="0 0 320 104" fill="none"><path class="terrain-back" d="m0 78 30-12 24 9 27-25 13 10 22-29 34 37 20-14 31 23 25-16 30 17 24-9 40 14"/><path class="terrain-front" d="m0 89 35-4 30 5 35-7 25 7 35-3 25 5 27-6 28 2 40-5 40 5"/><path class="tower" d="M161 18v73m-13 0 13-65 13 65m-24-9h22m-20-10h18m-16-10h14m-12-10h10m-9-10h8M160 32l-45 60m47-60 45 60M154 29a12 12 0 0 1 0-19m14 0a12 12 0 0 1 0 19M147 35a21 21 0 0 1 0-32m28 0a21 21 0 0 1 0 32"/><circle cx="161" cy="18" r="2.8" fill="currentColor"/></svg></div><h2>Fort Collins, Colorado<span class="tiny-dot amber"></span></h2><p class="station-coordinates">40° 40′ 49″ N &nbsp; 105° 02′ 27″ W</p><p class="station-description">A constant companion to generations of listeners, keeping the world in step.</p><div class="station-frequencies"><span class="eyebrow">BROADCAST FREQUENCIES · MHz</span><div><span>2.5</span><span>5</span><span>10</span><span>15</span><span>20</span><span title="Experimental frequency">25<sup>*</sup></span></div></div></section>
    </div>
    <footer><span>${icon("radio")} An independent tribute to a timeless signal.</span><span>Locally generated audio · Device-clock timing <button class="footer-link" data-dialog="about-dialog">About & credits ${icon("external")}</button></span></footer>
  </main>
  <dialog id="format-dialog"><div class="dialog-heading"><span class="eyebrow">THE RHYTHM OF WWV</span><button class="icon-button close-dialog" aria-label="Close broadcast format">${icon("close")}</button></div><h2>Every second has a purpose.</h2><p>WWV gives each minute a recognizable structure. The tones here follow NIST’s published schedule.</p><div class="format-items"><div><b>01</b><section><h3>The seconds pulse</h3><p>A 5-millisecond burst at 1,000 Hz. Seconds 29 and 59 have no tick. An 800-millisecond tone marks the minute; 1,500 Hz marks the hour.</p></section></div><div><b>02</b><section><h3>The standard tone</h3><p>500 and 600 Hz alternate on scheduled minutes, ending at second 45. Minute 2 carries 440 Hz, except during the first UTC hour. Reserved minutes have no standard tone.</p></section></div><div><b>03</b><section><h3>That familiar voice</h3><p>The recorded WWV announcer begins around second 52.5 and announces the upcoming minute in Coordinated Universal Time. Station identification plays at minutes 00 and 30.</p></section></div><div><b>04</b><section><h3>A little information underneath</h3><p>A 100 Hz subcarrier encodes the time and day of year. This recreation calculates the calendar fields locally; live DUT1 corrections and leap-second notices are not supplied.</p></section></div></div><a class="source-link" href="https://www.nist.gov/pml/time-and-frequency-division/time-distribution/radio-station-wwv/wwv-and-wwvh-digital-time-code" target="_blank" rel="noopener noreferrer">Read the NIST broadcast specification ${icon("external")}</a></dialog>
  <dialog id="about-dialog"><div class="dialog-heading"><span class="eyebrow">A TRIBUTE TO THE ORIGINAL</span><button class="icon-button close-dialog" aria-label="Close about">${icon("close")}</button></div><h2>A small station.<br>A remarkable legacy.</h2><p>WWV broadcasts standard time and frequency from Fort Collins, Colorado. This independent web app recreates its familiar audio with pure synthesized tones and authentic recorded voice clips.</p><h3>The voice you remember</h3><p>Time announcements use recordings of NIST’s telephone service, collected by Jim Kalafut for the <a href="https://wwv.mcodes.org/" target="_blank" rel="noopener noreferrer">WWV Simulator</a>. These are original voice recordings, not generated speech. Their telephone bandwidth is retained; the station ID comes from a radio recording.</p><h3>Made for listening</h3><p>This is a simulation, not an official NIST service or a live radio feed. Time follows your device clock, with additional audio-device latency. It does not carry live weather, geophysical reports, experimental signals, DUT1 updates, or leap-second adjustments. Keep your device awake to continue listening.</p><div class="about-links"><a class="source-link" href="https://www.nist.gov/pml/time-and-frequency-division/time-distribution/radio-station-wwv" target="_blank" rel="noopener noreferrer">Visit NIST’s WWV station ${icon("external")}</a><a class="source-link" href="/audio/wwv/SOURCES.md" target="_blank" rel="noopener noreferrer">Audio sources & license ${icon("external")}</a></div></dialog>
`;

let returnFocus = null;
document.querySelectorAll("[data-dialog]").forEach((button) =>
  button.addEventListener("click", () => {
    returnFocus = button;
    $(`#${button.dataset.dialog}`).showModal();
  }),
);
document.querySelectorAll("dialog").forEach((dialog) => {
  dialog
    .querySelector(".close-dialog")
    .addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (
        event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom
      )
        dialog.close();
    }
  });
  dialog.addEventListener("close", () => returnFocus?.focus());
});
$("#listen-nav").addEventListener("click", () => $("#power").focus());

function refreshControls() {
  const playing = engine.playing;
  const interrupted = engine.interrupted;
  $("#power").disabled = state.busy;
  $("#preview").disabled = state.busy;
  const powerLabel = interrupted
    ? "Resume listening"
    : playing
      ? "Pause listening"
      : "Start listening";
  $("#power").innerHTML =
    `${icon(playing && !interrupted ? "pause" : "play")}<span>${state.busy ? "Preparing audio…" : powerLabel}</span>`;
  $("#power").setAttribute("aria-label", powerLabel);
  $("#preview").innerHTML =
    `${state.preview ? "Return to current time" : "Preview announcement"} ${icon("arrow")}`;
  $("#play-status").classList.toggle("is-playing", playing && !interrupted);
  $("#play-status").innerHTML =
    `<span class="status-dot"></span><span>${interrupted ? "SUSPENDED" : state.preview ? "PREVIEW" : playing ? "ON AIR" : "STANDBY"}</span>`;
  $("#engine-status").innerHTML =
    `<span class="tiny-dot ${playing && !interrupted ? "green" : ""}"></span>${state.busy ? "Preparing original voice recordings" : interrupted ? "Audio interrupted · press resume" : state.preview ? "Preview · returns to current time automatically" : playing ? "Locally generated · clean audio" : "Ready when you are"}`;
  $("#mute").innerHTML = icon(
    state.muted || !state.volume ? "muted" : "volume",
  );
  $("#mute").setAttribute(
    "aria-label",
    state.muted ? "Unmute audio" : "Mute audio",
  );
  $("#mute").setAttribute("aria-pressed", String(state.muted));
  $("#volume-value").textContent = `${Math.round(state.volume * 100)}%`;
  $("#volume").style.setProperty("--fill", `${state.volume * 100}%`);
  document
    .querySelectorAll("[data-channel]")
    .forEach((button) =>
      button.setAttribute(
        "aria-checked",
        String(state.options[button.dataset.channel]),
      ),
    );
}

async function prepareAudio() {
  // Unlock audio within the gesture; keep the output silent until every clip is ready.
  await engine.prepare();
  if (!state.loaded) {
    const response = await fetch("/audio/wwv/voice-map.json");
    if (!response.ok)
      throw new Error("Voice recordings could not be loaded. Please retry.");
    const manifest = await response.json();
    await engine.loadVoiceSamples(manifest.samples || manifest);
    state.loaded = true;
  }
}

async function act(action) {
  if (state.busy) return;
  state.busy = true;
  $("#audio-error").hidden = true;
  refreshControls();
  try {
    await action();
  } catch (error) {
    await engine.stop();
    state.preview = false;
    $("#audio-error").textContent =
      `Audio could not start. ${error.message || "Please try again."}`;
    $("#audio-error").hidden = false;
  } finally {
    state.busy = false;
    refreshControls();
  }
}

$("#power").addEventListener("click", () =>
  act(async () => {
    if (engine.playing && !engine.interrupted) {
      await engine.stop();
      state.preview = false;
    } else {
      state.preview = false;
      await prepareAudio();
      await engine.start();
    }
  }),
);
$("#preview").addEventListener("click", () =>
  act(async () => {
    if (state.preview) {
      state.preview = false;
      await engine.start();
      return;
    }
    await prepareAudio();
    const previewEpoch = Math.floor(Date.now() / 60000) * 60000 + 52000;
    await engine.start({ epochMs: previewEpoch, durationSeconds: 12.5 });
    state.preview = true;
  }),
);
$("#mute").addEventListener("click", () => {
  state.muted = !state.muted;
  engine.setVolume(state.muted ? 0 : state.volume);
  refreshControls();
});
$("#volume").addEventListener("input", (event) => {
  state.volume = Number(event.target.value) / 100;
  state.muted = false;
  engine.setVolume(state.volume);
  save();
  refreshControls();
});
document.querySelectorAll("[data-channel]").forEach((button) =>
  button.addEventListener("click", () => {
    const key = button.dataset.channel;
    state.options[key] = !state.options[key];
    engine.setOptions(state.options);
    save();
    refreshControls();
  }),
);
$("#restore").addEventListener("click", () => {
  state.options = { ticks: true, tones: true, voice: true, data: true };
  engine.setOptions(state.options);
  save();
  refreshControls();
});
document.addEventListener("keydown", (event) => {
  if (
    event.repeat ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) ||
    event.target.isContentEditable ||
    $("dialog[open]")
  )
    return;
  if (event.code === "Space" && !/BUTTON|A/.test(event.target.tagName)) {
    event.preventDefault();
    $("#power").click();
  }
  if (event.key.toLowerCase() === "m") $("#mute").click();
});
engine.addEventListener("statechange", refreshControls);
engine.addEventListener("previewend", () => {
  state.preview = false;
  lastSecond = "";
  refreshControls();
});
engine.addEventListener("error", (event) => {
  state.preview = false;
  $("#audio-error").textContent =
    event.detail?.message || "Audio was interrupted. Press play to resume.";
  $("#audio-error").hidden = false;
  refreshControls();
});

let lastSecond = "";
const dateFormat = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
function renderTime(now) {
  const date = new Date(now);
  const h = pad(date.getUTCHours()),
    m = pad(date.getUTCMinutes()),
    s = pad(date.getUTCSeconds());
  const phase = date.getUTCSeconds() + date.getUTCMilliseconds() / 1000;
  const key = `${h}:${m}:${s}:${phase >= 52.5}`;
  if (lastSecond !== key) {
    lastSecond = key;
    $("#utc-clock").innerHTML =
      `${h}<span>:</span>${m}<span>:</span><b>${s}</b>`;
    $("#utc-clock").setAttribute("datetime", date.toISOString());
    $("#utc-clock").setAttribute(
      "aria-label",
      `${h} hours ${m} minutes ${s} seconds UTC`,
    );
    $("#utc-date").textContent = dateFormat.format(date);
    const year = date.getUTCFullYear();
    const day = Math.floor(
      (Date.UTC(year, date.getUTCMonth(), date.getUTCDate()) -
        Date.UTC(year, 0, 0)) /
        86400000,
    );
    const days = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86400000;
    $("#day-number").textContent =
      `DAY ${String(day).padStart(3, "0")} / ${days}`;
    $("#minute-second").textContent = s;
    const next = new Date((Math.floor(now / 60000) + 1) * 60000);
    $("#next-announcement").textContent =
      `At the tone, ${next.getUTCHours()} ${next.getUTCHours() === 1 ? "hour" : "hours"}, ${next.getUTCMinutes()} ${next.getUTCMinutes() === 1 ? "minute" : "minutes"}, Coordinated Universal Time.`;
    const seconds = date.getUTCSeconds();
    const announcing = phase >= 52.5 && phase < 59.5;
    const identifying =
      (date.getUTCMinutes() === 0 || date.getUTCMinutes() === 30) &&
      phase >= 1 &&
      phase < 34.3;
    $("#voice-countdown").textContent = announcing
      ? "ANNOUNCING"
      : `IN ${Math.ceil((52.5 - phase + 60) % 60)}s`;
    const frequency = getToneFrequency(date);
    $("#segment-label").textContent = announcing
      ? "TIME ANNOUNCEMENT"
      : identifying
        ? "STATION IDENTIFICATION"
        : seconds === 0
          ? "ON-TIME MARKER"
          : seconds >= 45
            ? "STANDARD TONE ENDED"
            : frequency
              ? "STANDARD FREQUENCY"
              : "NO STANDARD TONE";
    $("#tone-label").innerHTML = announcing
      ? "The voice of WWV"
      : identifying
        ? "This is WWV"
        : seconds === 0
          ? `${date.getUTCMinutes() === 0 ? "1,500" : "1,000"} Hz <small>${date.getUTCMinutes() === 0 ? "hour" : "minute"} marker</small>`
          : seconds >= 45
            ? "A moment of quiet"
            : frequency
              ? `${frequency} Hz <small>audio tone</small>`
              : "Ticks & time code";
    $(".tone-region").classList.toggle("no-tone", !frequency);
    $("#scope-info").textContent = !engine.playing
      ? "OUTPUT IDLE"
      : state.muted || !state.volume
        ? "MUTED"
        : !Object.values(state.options).some(Boolean)
          ? "ALL CHANNELS OFF"
          : `${((engine.context?.sampleRate || 48000) / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })} kHz / MONO`;
  }
  $("#timeline-cursor").style.left =
    `${((date.getUTCSeconds() + date.getUTCMilliseconds() / 1000) / 60) * 100}%`;
}

const canvas = $("#waveform"),
  ctx = canvas.getContext("2d");
let waveformData = new Float32Array(2048);
function drawScope() {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.round(canvas.clientWidth * ratio),
    height = Math.round(canvas.clientHeight * ratio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  ctx.clearRect(0, 0, width, height);
  ctx.lineWidth = ratio;
  ctx.strokeStyle = "#ffffff08";
  ctx.beginPath();
  for (let x = 0; x < width; x += 32 * ratio) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let y = 0; y <= height; y += 24 * ratio) {
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();
  const analyser = engine.analyser;
  if (analyser && engine.playing) {
    if (waveformData.length !== analyser.fftSize)
      waveformData = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(waveformData);
  } else waveformData.fill(0);
  // Trigger the scope at the first positive zero crossing for a stable waveform.
  let offset = 0;
  for (let i = 1; i < Math.min(300, waveformData.length / 2); i++) {
    if (waveformData[i - 1] <= 0 && waveformData[i] > 0) {
      offset = i;
      break;
    }
  }
  ctx.strokeStyle = engine.playing ? "#d9ad72" : "#5c665e";
  ctx.lineWidth = 1.2 * ratio;
  ctx.shadowColor = "#eeb575";
  ctx.shadowBlur = engine.playing ? 5 : 0;
  ctx.beginPath();
  const visible = Math.min(1000, waveformData.length - offset);
  for (let i = 0; i < visible; i++) {
    const x = (i / (visible - 1)) * width;
    const y = height / 2 - waveformData[i + offset] * height * 0.75;
    if (!i) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
}
let previousFrame = 0;
function frame(time) {
  if (time - previousFrame > 32) {
    previousFrame = time;
    renderTime(engine.playing ? engine.currentTimeMs : Date.now());
    drawScope();
  }
  requestAnimationFrame(frame);
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") lastSecond = "";
});
refreshControls();
requestAnimationFrame(frame);
