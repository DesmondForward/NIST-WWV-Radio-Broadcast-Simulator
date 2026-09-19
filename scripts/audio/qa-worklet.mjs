/** Exercise the actual audio worklet with decoded shipped recordings, outside a browser.
 * Run qa-decode.py first, then: node scripts/audio/qa-worklet.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { getAnnouncementSequence, HEADROOM, VOICE_GAIN } from '../../src/signal.js';

globalThis.AudioWorkletProcessor = class {
  constructor() { this.port = { onmessage: null }; }
};
globalThis.sampleRate = 48000;
globalThis.currentFrame = 0;
let Processor;
globalThis.registerProcessor = (_name, constructor) => { Processor = constructor; };
await import('../../src/wwv-worklet.js');
const processor = new Processor();
const clips = JSON.parse(readFileSync(join(tmpdir(), 'wwv-audio-qa/clips.json'), 'utf8'));
const durations = {};
for (const [id, clip] of Object.entries(clips)) {
  const bytes = readFileSync(clip.path);
  const samples = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  processor.port.onmessage({ data: { type: 'clip', id, samples, sampleRate: clip.sampleRate } });
  durations[id] = samples.length / clip.sampleRate;
}
const announcementEnds = [];
for (let hour = 0; hour < 24; hour++) for (let minute = 0; minute < 60; minute++) {
  const sequence = getAnnouncementSequence(Date.UTC(2026, 8, 19, hour, minute), (id) => durations[id]);
  const last = sequence.at(-1);
  announcementEnds.push(last.offsetSeconds + durations[last.id]);
}

function render(name, isoTime, duration, options) {
  const start = Date.parse(isoTime);
  processor.port.onmessage({ data: { type: 'configure', options: { ticks: true, tones: true, data: true, voice: true, ...options } } });
  processor.port.onmessage({ data: { type: 'start', epochMs: start, anchorFrame: 0 } });
  const frames = Math.round(duration * sampleRate);
  const block = new Float32Array(128);
  let peak = 0, square = 0, overOne = 0, nonFinite = 0;
  for (let frame = 0; frame < frames; frame += block.length) {
    globalThis.currentFrame = frame;
    processor.process([], [[block]]);
    for (let i = 0; i < Math.min(block.length, frames - frame); i++) {
      const sample = block[i];
      const absolute = Math.abs(sample);
      peak = Math.max(peak, absolute);
      square += sample * sample;
      overOne += absolute > 1 ? 1 : 0;
      nonFinite += Number.isFinite(sample) ? 0 : 1;
    }
  }
  return { name, isoTime, duration, peak, rms: Math.sqrt(square / frames), clippedSamples: overOne, nonFiniteSamples: nonFinite };
}

const renders = [
  render('500 Hz minute including voice', '2026-09-19T21:52:00Z', 60),
  render('600 Hz minute including voice', '2026-09-19T21:53:00Z', 60),
  render('440 Hz minute including voice', '2026-09-19T21:02:00Z', 60),
  render('Hour identification and announcement', '2026-09-19T21:00:00Z', 60),
  render('Half-hour identification', '2026-09-19T21:30:00Z', 37),
  render('Longest assembled announcement', '2026-09-19T16:53:52Z', 9),
  render('Short singular announcement', '2026-09-19T01:00:52Z', 9),
  render('Midnight rollover', '2026-09-19T23:59:52Z', 11),
  render('Only spoken announcement', '2026-09-19T21:53:52Z', 8, { ticks: false, data: false, tones: false }),
  render('Only station identification', '2026-09-19T21:00:01Z', 34, { ticks: false, data: false, tones: false }),
];
const report = {
  generatedAt: new Date().toISOString(),
  source: 'Actual src/wwv-worklet.js with shipped clips decoded at native 44.1 kHz; worklet linear interpolation to 48 kHz. Browser decoder resampling is outside this numerical QA.',
  sourceHashes: Object.fromEntries(['src/audio-engine.js', 'src/wwv-worklet.js', 'src/signal.js'].map((path) => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])),
  sampleRate,
  headroom: HEADROOM,
  voiceGain: VOICE_GAIN,
  maximumMeasuredPeak: Math.max(...renders.map((render) => render.peak)),
  announcementCount: announcementEnds.length,
  earliestAnnouncementEnd: Math.min(...announcementEnds),
  latestAnnouncementEnd: Math.max(...announcementEnds),
  renders,
};
mkdirSync('artifacts/audio-qa', { recursive: true });
writeFileSync('artifacts/audio-qa/report.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (renders.some((render) => render.clippedSamples || render.nonFiniteSamples)) process.exitCode = 1;
