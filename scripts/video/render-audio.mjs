/**
 * Render the showcase soundtrack through the application's actual audio worklet.
 *
 * node scripts/video/render-audio.mjs --ffmpeg /path/to/ffmpeg
 *
 * Without --ffmpeg, this reuses clips produced by scripts/audio/qa-decode.py.
 * The output is a 20-second, mono, 48 kHz / 24-bit PCM WAV, plus waveform data
 * sampled from the same PCM stream for a 30 fps video.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_OPTIONS, getAnnouncementSequence } from '../../src/signal.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const argument = (name, fallback) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
};
const output = resolve(argument('--output', join(root, 'artifacts/video-work')));
const ffmpeg = argument('--ffmpeg', process.env.FFMPEG_PATH);
const clipFile = resolve(argument('--clips', join(tmpdir(), 'wwv-audio-qa/clips.json')));
const startIso = '2026-09-19T12:34:48.000Z';
const epochMs = Date.parse(startIso);
const seconds = 20;
const rate = 48000;
const fps = 30;
const volume = 0.65;
const fadeSeconds = 0.3;
const voiceIds = ['v_at_the_tone', 'v_12', 'v_hours', 'v_35', 'v_minutes', 'v_utc'];

mkdirSync(output, { recursive: true });
let clipMetadata;
if (ffmpeg) {
  const target = join(output, 'decoded-voice');
  mkdirSync(target, { recursive: true });
  const voiceMap = JSON.parse(readFileSync(join(root, 'public/audio/wwv/voice-map.json'), 'utf8'));
  clipMetadata = {};
  for (const id of voiceIds) {
    const source = join(root, 'public', voiceMap[id].replace(/^\//, ''));
    const path = join(target, `${id}.f32`);
    const decoded = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', source, '-ac', '1', '-ar', '44100', '-f', 'f32le', path], { encoding: 'utf8', windowsHide: true });
    if (decoded.error || decoded.status !== 0) throw new Error(`Could not decode ${id}: ${decoded.error?.message ?? decoded.stderr}`);
    clipMetadata[id] = { sampleRate: 44100, path };
  }
} else {
  if (!existsSync(clipFile)) throw new Error('Decoded clips are missing. Pass --ffmpeg PATH or run scripts/audio/qa-decode.py first.');
  clipMetadata = JSON.parse(readFileSync(clipFile, 'utf8'));
}

globalThis.AudioWorkletProcessor = class {
  constructor() { this.port = { onmessage: null, postMessage() {} }; }
};
globalThis.sampleRate = rate;
globalThis.currentFrame = 0;
let Processor;
globalThis.registerProcessor = (_name, constructor) => { Processor = constructor; };
await import('../../src/wwv-worklet.js');
const processor = new Processor();
const durations = {};
const sourceHashes = {};
for (const id of voiceIds) {
  const clip = clipMetadata[id];
  if (!clip) throw new Error(`Required recording missing: ${id}`);
  const bytes = readFileSync(clip.path);
  const samples = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  processor.port.onmessage({ data: { type: 'clip', id, samples, sampleRate: clip.sampleRate } });
  durations[id] = samples.length / clip.sampleRate;
  sourceHashes[id] = createHash('sha256').update(bytes).digest('hex');
}
processor.port.onmessage({ data: { type: 'configure', options: DEFAULT_OPTIONS } });
processor.port.onmessage({ data: { type: 'start', epochMs, anchorFrame: 0 } });

const frameCount = seconds * rate;
const pcm = new Float32Array(frameCount);
const block = new Float32Array(128);
let peak = 0;
let square = 0;
let clippedSamples = 0;
let nonFiniteSamples = 0;
for (let frame = 0; frame < frameCount; frame += block.length) {
  globalThis.currentFrame = frame;
  if (frame === Math.round(15.6 * rate)) processor.port.onmessage({ data: { type: 'configure', options: { tones: false } } });
  if (frame === Math.round(17.2 * rate)) processor.port.onmessage({ data: { type: 'configure', options: { tones: true } } });
  processor.process([], [[block]]);
  for (let i = 0; i < Math.min(block.length, frameCount - frame); i++) {
    const position = frame + i;
    const fade = Math.min(1, position / (rate * fadeSeconds), (frameCount - 1 - position) / (rate * fadeSeconds));
    const sample = block[i] * volume * Math.max(0, fade);
    pcm[position] = sample;
    peak = Math.max(peak, Math.abs(sample));
    square += sample * sample;
    clippedSamples += Math.abs(sample) >= 1 ? 1 : 0;
    nonFiniteSamples += Number.isFinite(sample) ? 0 : 1;
  }
}
if (clippedSamples || nonFiniteSamples) throw new Error('The soundtrack failed PCM validation.');

function writeWav(path, samples) {
  const bytesPerSample = 3;
  const dataBytes = samples.length * bytesPerSample;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * bytesPerSample, 28);
  wav.writeUInt16LE(bytesPerSample, 32);
  wav.writeUInt16LE(bytesPerSample * 8, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) wav.writeIntLE(Math.round(samples[i] * 8388607), 44 + i * bytesPerSample, 3);
  writeFileSync(path, wav);
}
writeWav(join(output, 'demo-audio.wav'), pcm);

const round = (value) => Math.round(value * 10000) / 10000;
const waveform = [];
for (let frame = 0; frame < seconds * fps; frame++) {
  const start = Math.round(frame / fps * rate);
  const end = Math.min(frameCount, Math.round((frame + 1) / fps * rate));
  let framePeak = 0;
  let frameSquare = 0;
  for (let i = start; i < end; i++) {
    framePeak = Math.max(framePeak, Math.abs(pcm[i]));
    frameSquare += pcm[i] * pcm[i];
  }
  // The trace is a 1000-sample audio window, decimated to 512 signed points.
  // Taking each point directly from the rendered signal matches an oscilloscope.
  const traceStart = Math.min(Math.max(0, start - 500), frameCount - 1000);
  const samples = Array.from({ length: 512 }, (_, index) => round(pcm[traceStart + Math.round(index * 999 / 511)]));
  waveform.push({ time: round(frame / fps), peak: round(framePeak), rms: round(Math.sqrt(frameSquare / (end - start))), samples });
}
writeFileSync(join(output, 'demo-waveform.json'), JSON.stringify({ fps, duration: seconds, sampleRate: rate, windowSamples: 1000, pointsPerFrame: 512, frames: waveform }));

const sequence = getAnnouncementSequence(Date.parse('2026-09-19T12:35:00Z'), (id) => durations[id]);
const report = {
  generatedAt: new Date().toISOString(),
  startIso,
  endIso: new Date(epochMs + seconds * 1000).toISOString(),
  durationSeconds: seconds,
  sampleRate: rate,
  sampleCount: frameCount,
  channels: 1,
  bitsPerSample: 24,
  masterVolume: volume,
  fadeSeconds,
  peak,
  peakDbfs: 20 * Math.log10(peak),
  rms: Math.sqrt(square / frameCount),
  clippedSamples,
  nonFiniteSamples,
  options: DEFAULT_OPTIONS,
  events: [
    { time: 0, label: 'Second ticks and 100 Hz time code' },
    ...sequence.map((clip) => ({ time: clip.offsetSeconds - 48, label: clip.id, durationSeconds: durations[clip.id] })),
    { time: 12, label: '12:35 UTC minute marker', frequencyHz: 1000, durationSeconds: 0.8 },
    { time: 13.03, label: '600 Hz standard tone and 100 Hz time code' },
    { time: 15.6, label: 'Standard tones switched off; ticks, voice and time code stay enabled' },
    { time: 17.2, label: 'Standard tones switched on' },
  ],
  source: 'Actual src/wwv-worklet.js, shipped recorded voices at native 44.1 kHz with worklet interpolation to 48 kHz, application default signal settings, 65% master gain; no music or added sound effects.',
  codeHashes: Object.fromEntries(['src/wwv-worklet.js', 'src/signal.js'].map((path) => [path, createHash('sha256').update(readFileSync(join(root, path))).digest('hex')])),
  decodedVoiceHashes: sourceHashes,
};
writeFileSync(join(output, 'demo-audio.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ output, durationSeconds: seconds, sampleRate: rate, peak, peakDbfs: report.peakDbfs, clippedSamples, waveformFrames: waveform.length, events: report.events }, null, 2));
