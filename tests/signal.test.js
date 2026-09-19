import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HEADROOM,
  VOICE_GAIN,
  backgroundAllowed,
  createSecondPlan,
  encodeTimeCode,
  getAnnouncementSequence,
  getDayOfYear,
  getDstFlags,
  getMinuteInfo,
  getSecondMarker,
  getToneFrequency,
  renderSignal,
  sampleSignal,
} from '../src/signal.js';

const time = (text) => Date.parse(text);
const at = (minute, second = 0, hour = 12) => new Date(Date.UTC(2026, 8, 19, hour, minute, second));
const rms = (samples) => Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
let Processor;
async function createProcessor() {
  if (!Processor) {
    globalThis.AudioWorkletProcessor = class { constructor() { this.port = { onmessage: null, postMessage: () => {} }; } };
    globalThis.registerProcessor = (_name, constructor) => { Processor = constructor; };
    await import('../src/wwv-worklet.js');
  }
  globalThis.sampleRate = 48000;
  globalThis.currentFrame = 0;
  return new Processor();
}

test('WWV follows the NIST minute schedule, including silent and A440 exceptions', () => {
  const expected = [0, 600, 440, 600, 500, 600, 500, 600, 0, 0, 0, 600, 500, 600, 500, 600, 500, 600, 0, 600, 500, 600, 500, 600, 500, 600, 500, 600, 500, 0, 0, 600, 500, 600, 500, 600, 500, 600, 500, 600, 500, 600, 500, 0, 0, 0, 0, 0, 0, 0, 0, 0, 500, 600, 500, 600, 500, 600, 500, 0];
  assert.deepEqual(expected.map((_, minute) => getToneFrequency(at(minute))), expected);
  assert.equal(getToneFrequency(at(2, 0, 0)), 0);
  assert.equal(getToneFrequency(at(2, 0, 1)), 440);
});

test('markers are five cycles, omit seconds 29 and 59, and use hour/minute frequencies', () => {
  assert.deepEqual(getSecondMarker(at(14, 2)), { frequency: 1000, duration: 0.005, type: 'second' });
  assert.equal(getSecondMarker(at(14, 29)), null);
  assert.equal(getSecondMarker(at(14, 59)), null);
  assert.deepEqual(getSecondMarker(at(14)), { frequency: 1000, duration: 0.8, type: 'minute' });
  assert.deepEqual(getSecondMarker(at(0)), { frequency: 1500, duration: 0.8, type: 'hour' });
});

test('rendered 1000Hz ticks contain exactly 5ms of energy and no extra pulses', () => {
  for (const sampleRate of [44100, 48000, 96000]) {
    const samples = renderSignal(at(14, 28).getTime(), 3, sampleRate, { data: false, tones: false });
    assert.ok(rms(samples.slice(0, Math.floor(0.005 * sampleRate))) > 0.49);
    assert.equal(rms(samples.slice(Math.ceil(0.005 * sampleRate), sampleRate * 2)), 0);
    assert.ok(rms(samples.slice(sampleRate * 2, sampleRate * 2 + Math.floor(0.005 * sampleRate))) > 0.49);
  }
});

test('long markers have 800ms of energy and 200ms silence even with data and tones', () => {
  for (const minute of [0, 14]) {
    const samples = renderSignal(at(minute).getTime(), 1);
    const frequency = minute ? 1000 : 1500;
    assert.ok(Math.abs(samples[12] - HEADROOM * Math.sin(2 * Math.PI * frequency * 12 / 48000)) < 1e-7);
    assert.ok(rms(samples.slice(0, 38400)) > 0.50);
    assert.equal(rms(samples.slice(38400)), 0);
  }
});

test('protective silence is 10ms before and 25ms after each 5ms tick', () => {
  const plan = createSecondPlan(at(14, 5).getTime() / 1000);
  assert.equal(backgroundAllowed(plan, 0.005), false);
  assert.equal(backgroundAllowed(plan, 0.02999), false);
  assert.equal(backgroundAllowed(plan, 0.03001), true);
  assert.equal(backgroundAllowed(plan, 0.98999), true);
  assert.equal(backgroundAllowed(plan, 0.99), false);
  assert.equal(sampleSignal(plan, 0.02), 0);
  assert.equal(sampleSignal(plan, 0.995), 0);
});

test('standard audio stops at second45 and reserves the full first second', () => {
  assert.equal(createSecondPlan(at(4, 0).getTime() / 1000).toneFrequency, 0);
  assert.equal(createSecondPlan(at(4, 1).getTime() / 1000).toneFrequency, 500);
  assert.equal(createSecondPlan(at(4, 44).getTime() / 1000).toneFrequency, 500);
  assert.equal(createSecondPlan(at(4, 45).getTime() / 1000).toneFrequency, 0);
});

test('BCD encodes the current frame time, date, and decimal digit positions', () => {
  const date = new Date('2026-09-19T23:58:45Z');
  const bits = encodeTimeCode(date, { dut1: -0.3, leapSecondWarning: true, dst1: false, dst2: true });
  const read = (positions) => positions.reduce((value, position, bit) => value + bits[position] * 2 ** bit, 0);
  assert.equal(bits[0], null);
  assert.deepEqual([9, 19, 29, 39, 49, 59].map((second) => bits[second]), [2, 2, 2, 2, 2, 2]);
  assert.equal(read([4, 5, 6, 7]) + 10 * read([51, 52, 53, 54]), 26);
  assert.equal(read([10, 11, 12, 13]) + 10 * read([15, 16, 17]), 58);
  assert.equal(read([20, 21, 22, 23]) + 10 * read([25, 26]), 23);
  assert.equal(read([30, 31, 32, 33]) + 10 * read([35, 36, 37, 38]) + 100 * read([40, 41]), 262);
  assert.equal(read([56, 57, 58]), 3);
  assert.equal(bits[50], 0);
  assert.equal(bits[3], 1);
  assert.equal(bits[2], 0);
  assert.equal(bits[55], 1);
});

test('time-code high pulses end at200/500/800ms, begin30ms late, and retain 3.3:1 low carrier', () => {
  const options = { tones: false, ticks: false, data: true, voice: false };
  const plan0 = createSecondPlan(at(14, 1).getTime() / 1000, options);
  assert.equal(plan0.dataEnd, 0.2);
  assert.equal(sampleSignal(plan0, 0.02, options), 0);
  const high = sampleSignal(plan0, 0.0325, options);
  const low = sampleSignal(plan0, 0.2025, options);
  assert.ok(Math.abs(high / low - 3.3) < 1e-10);
  const marker = createSecondPlan(at(14, 29).getTime() / 1000, options);
  assert.equal(marker.dataEnd, 0.8);
  assert.equal(sampleSignal(marker, 0.0125, options), 0);
});

test('positive and negative DUT1 double the designated ticks only', () => {
  const second = (s, dut1) => createSecondPlan(at(4, s).getTime() / 1000, { dut1 });
  assert.deepEqual([1, 2, 3, 4].map((s) => second(s, 0.3).doubled), [true, true, true, false]);
  assert.deepEqual([8, 9, 10, 11, 12].map((s) => second(s, -0.3).doubled), [false, true, true, true, false]);
  assert.equal(backgroundAllowed(second(2, 0.3), 0.095), false);
  assert.ok(Math.abs(sampleSignal(second(2, 0.3), 0.10025) - HEADROOM) < 1e-10);
});

test('date metadata handles leap years and US DST transition UTC days', () => {
  assert.equal(getDayOfYear('2024-12-31T23:59:59Z'), 366);
  assert.equal(getDayOfYear('2025-01-01T00:00:00Z'), 1);
  assert.deepEqual(getDstFlags('2026-03-07T12:00:00Z'), { dst1: false, dst2: false });
  assert.deepEqual(getDstFlags('2026-03-08T12:00:00Z'), { dst1: false, dst2: true });
  assert.deepEqual(getDstFlags('2026-03-09T12:00:00Z'), { dst1: true, dst2: true });
  assert.deepEqual(getDstFlags('2026-11-01T12:00:00Z'), { dst1: true, dst2: false });
  assert.deepEqual(getDstFlags('2026-11-02T12:00:00Z'), { dst1: false, dst2: false });
});

test('tone and code summation preserves unclipped headroom at every sample', () => {
  const samples = renderSignal(time('2026-09-19T12:02:00Z'), 60);
  const peak = samples.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
  assert.ok(peak <= HEADROOM + 1e-6);
  assert.ok(peak > 0.7);
});

test('voice composition announces the coming minute and handles midnight and singular units', () => {
  const sequence = getAnnouncementSequence('2026-09-20T00:00:00Z', () => 0.2);
  assert.deepEqual(sequence.map(({ id }) => id), ['v_at_the_tone', 'v_0', 'v_hours', 'v_0', 'v_minutes', 'v_utc']);
  assert.equal(sequence[0].offsetSeconds, 52.5);
  assert.equal(sequence[1].offsetSeconds, 53.5);
  assert.deepEqual(getAnnouncementSequence('2026-09-20T01:01:00Z', () => 0.2).map(({ id }) => id), ['v_at_the_tone', 'v_1', 'v_hour', 'v_1', 'v_minute', 'v_utc']);
});

test('minute metadata labels voice window and reserved intervals without faking bulletins', () => {
  assert.equal(getMinuteInfo('2026-09-19T12:04:52.500Z').segment, 'announcement');
  assert.equal(getMinuteInfo(at(18, 20)).label, 'Geophysical alert interval');
  assert.equal(getMinuteInfo(at(18, 20)).segment, 'quiet');
  assert.equal(getMinuteInfo(at(30, 10)).isStationId, true);
});

test('invalid offline rendering arguments fail explicitly', () => {
  assert.throws(() => renderSignal(NaN, 1), RangeError);
  assert.throws(() => renderSignal(0, -1), RangeError);
  assert.throws(() => renderSignal(0, 1, 0), RangeError);
});

test('audio-thread rendering matches offline DSP across a minute boundary without timers', async () => {
  const processor = await createProcessor();
  const epochMs = time('2026-09-19T12:59:58.000Z');
  processor.port.onmessage({ data: { type: 'configure', options: { voice: false } } });
  processor.port.onmessage({ data: { type: 'start', epochMs, anchorFrame: 0 } });
  const expected = renderSignal(epochMs, 4, 48000, { voice: false });
  let maxDifference = 0;
  for (let frame = 0; frame < expected.length; frame += 128) {
    globalThis.currentFrame = frame;
    const output = new Float32Array(Math.min(128, expected.length - frame));
    assert.equal(processor.process([], [[output]]), true);
    for (let i = 0; i < output.length; i++) maxDifference = Math.max(maxDifference, Math.abs(output[i] - expected[frame + i]));
  }
  assert.ok(maxDifference < 1e-6, `maximum sample difference ${maxDifference}`);
  processor.port.onmessage({ data: { type: 'stop' } });
  const stopped = new Float32Array(128).fill(1);
  processor.process([], [[stopped]]);
  assert.equal(rms(stopped), 0);
});

test('voice recordings loaded mid-second join the current announcement without waiting for a timer', async () => {
  const processor = await createProcessor();
  const epochMs = time('2026-09-19T12:04:53.600Z');
  const options = { tones: false, ticks: false, data: false, voice: true };
  processor.port.onmessage({ data: { type: 'configure', options } });
  processor.port.onmessage({ data: { type: 'start', epochMs, anchorFrame: 0 } });
  const silent = new Float32Array(128);
  processor.process([], [[silent]]);
  assert.equal(rms(silent), 0);
  for (const id of ['v_at_the_tone', 'v_12', 'v_hours', 'v_5', 'v_minutes', 'v_utc']) {
    processor.port.onmessage({ data: { type: 'clip', id, samples: new Float32Array(9600).fill(0.2), sampleRate: 48000 } });
  }
  globalThis.currentFrame = 128;
  const spoken = new Float32Array(128);
  processor.process([], [[spoken]]);
  assert.ok(Math.abs(spoken[0] - HEADROOM * VOICE_GAIN * 0.2) < 1e-7);
});

test('preview returns to current time on the audio thread even with no main-thread timers', async () => {
  const processor = await createProcessor();
  const events = [];
  processor.port.postMessage = (message) => events.push(message);
  const epochMs = time('2026-09-19T12:04:52.000Z');
  const returnEpochMs = time('2026-09-19T12:14:25.250Z');
  const returnFrame = 600000; // 12.5 seconds, deliberately not a multiple of 128.
  processor.port.onmessage({ data: { type: 'start', epochMs, anchorFrame: 0, returnFrame, returnEpochMs, runId: 7 } });
  for (let frame = 0; frame < returnFrame + 1024; frame += 128) {
    globalThis.currentFrame = frame;
    processor.process([], [[new Float32Array(128)]]);
  }
  assert.deepEqual(events, [{ type: 'previewend', epochMs: returnEpochMs, anchorFrame: returnFrame, runId: 7 }]);
  assert.equal(processor.plan.second, 25);
  assert.equal(processor.plan.toneFrequency, 500);
  globalThis.currentFrame = 601600;
  const output = new Float32Array(128);
  processor.process([], [[output]]);
  const expected = renderSignal(returnEpochMs + 1600 / 48, 128 / 48000);
  assert.ok(output.every((value, index) => Math.abs(value - expected[index]) < 0.0002));
});

test('restarting a stopped preview clears its pending automatic return', async () => {
  const processor = await createProcessor();
  const events = [];
  processor.port.postMessage = (message) => events.push(message);
  processor.port.onmessage({ data: { type: 'start', epochMs: time('2026-09-19T12:04:52Z'), anchorFrame: 0, returnFrame: 128, returnEpochMs: 0 } });
  processor.port.onmessage({ data: { type: 'stop' } });
  processor.port.onmessage({ data: { type: 'start', epochMs: time('2026-09-19T12:03:00Z'), anchorFrame: 0 } });
  globalThis.currentFrame = 256;
  processor.process([], [[new Float32Array(128)]]);
  assert.equal(processor.returnFrame, null);
  assert.equal(processor.plan.second, 0);
  assert.deepEqual(events, []);
});
