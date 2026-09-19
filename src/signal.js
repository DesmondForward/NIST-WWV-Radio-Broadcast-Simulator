/**
 * WWV baseband model. Reference: NIST SP 250-67, sections 2.B.2.c–h,
 * and NIST's current WWV/WWVH digital time code and broadcast format.
 * https://www.nist.gov/pml/time-and-frequency-division/time-distribution/radio-station-wwv/wwv-and-wwvh-digital-time-code
 *
 * This is a local-clock simulation. UT1/leap-second flags are configurable;
 * without supplied almanac data they are zero, not claims about the live station.
 */
export const TAU = Math.PI * 2;
export const HEADROOM = 0.72;
// A single shared gain preserves the relative loudness of the recorded phrases.
// This peak is measured across the bundled mono voice set (see audio manifest).
export const VOICE_GAIN = 0.75 / 0.8878510594;
export const DEFAULT_OPTIONS = Object.freeze({
  ticks: true,
  tones: true,
  data: true,
  voice: true,
  dut1: 0,
  leapSecondWarning: false,
});

const TONES_500 = new Set([4, 6, 12, 14, 16, 20, 22, 24, 26, 28, 32, 34, 36, 38, 40, 42, 52, 54, 56, 58]);
const TONES_600 = new Set([1, 3, 5, 7, 11, 13, 15, 17, 19, 21, 23, 25, 27, 31, 33, 35, 37, 39, 41, 53, 55, 57]);

function asDate(value) {
  return value instanceof Date ? value : new Date(value);
}

/** Scheduled audio frequency for this UTC minute, whether or not it is sounding. */
export function getToneFrequency(value) {
  const date = asDate(value);
  const minute = date.getUTCMinutes();
  if (minute === 2) return date.getUTCHours() === 0 ? 0 : 440;
  if (TONES_500.has(minute)) return 500;
  if (TONES_600.has(minute)) return 600;
  return 0;
}

export function getSecondMarker(value) {
  const date = asDate(value);
  const second = date.getUTCSeconds();
  if (second === 29 || second === 59) return null;
  if (second === 0) {
    const hour = date.getUTCMinutes() === 0;
    return { frequency: hour ? 1500 : 1000, duration: 0.8, type: hour ? 'hour' : 'minute' };
  }
  return { frequency: 1000, duration: 0.005, type: 'second' };
}

export function getDayOfYear(value) {
  const date = asDate(value);
  return Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - Date.UTC(date.getUTCFullYear(), 0, 1)) / 86400000) + 1;
}

/** Current US DST calendar rule, used only for the two simulated DST flags. */
export function getDstFlags(value) {
  const date = asDate(value);
  const year = date.getUTCFullYear();
  const marchFirst = new Date(Date.UTC(year, 2, 1)).getUTCDay();
  const novemberFirst = new Date(Date.UTC(year, 10, 1)).getUTCDay();
  const startDay = 8 + ((7 - marchFirst) % 7);
  const endDay = 1 + ((7 - novemberFirst) % 7);
  const midnight = Date.UTC(year, date.getUTCMonth(), date.getUTCDate());
  const start = Date.UTC(year, 2, startDay);
  const end = Date.UTC(year, 10, endDay);
  return { dst1: midnight > start && midnight <= end, dst2: midnight >= start && midnight < end };
}

/**
 * One WWV (modified IRIG-H) minute: null = minute hole; 2 = position marker.
 * Minute/hour/year/day refer to the start of this frame, not the next minute.
 */
export function encodeTimeCode(value, options = {}) {
  const date = asDate(value);
  const bits = Array(60).fill(0);
  bits[0] = null;
  for (const second of [9, 19, 29, 39, 49, 59]) bits[second] = 2;
  const write = (number, positions) => positions.forEach((position, bit) => { bits[position] = (number >> bit) & 1; });
  const year = date.getUTCFullYear() % 100;
  const day = getDayOfYear(date);
  const hour = date.getUTCHours();
  const minute = date.getUTCMinutes();
  write(year % 10, [4, 5, 6, 7]);
  write(Math.floor(year / 10), [51, 52, 53, 54]);
  write(minute % 10, [10, 11, 12, 13]);
  write(Math.floor(minute / 10), [15, 16, 17]);
  write(hour % 10, [20, 21, 22, 23]);
  write(Math.floor(hour / 10), [25, 26]);
  write(day % 10, [30, 31, 32, 33]);
  write(Math.floor(day / 10) % 10, [35, 36, 37, 38]);
  write(Math.floor(day / 100), [40, 41]);
  const flags = getDstFlags(date);
  bits[2] = Number(options.dst1 ?? flags.dst1);
  bits[55] = Number(options.dst2 ?? flags.dst2);
  bits[3] = Number(Boolean(options.leapSecondWarning));
  const dut1 = Number.isFinite(options.dut1) ? Math.max(-0.7, Math.min(0.7, options.dut1)) : 0;
  bits[50] = Number(dut1 >= 0);
  write(Math.round(Math.abs(dut1) * 10), [56, 57, 58]);
  return bits;
}

export function getMinuteInfo(value) {
  const date = asDate(value);
  const minute = date.getUTCMinutes();
  const second = date.getUTCSeconds();
  const frequency = getToneFrequency(date);
  const phase = second + date.getUTCMilliseconds() / 1000;
  const isStationId = minute === 0 || minute === 30;
  let label = frequency ? `${frequency} Hz standard tone` : 'Silent interval';
  if (isStationId) label = 'Station identification';
  else if (minute === 8) label = 'Reserved test-signal interval';
  else if (minute === 9 || minute === 10) label = 'Reserved announcement interval';
  else if (minute === 18) label = 'Geophysical alert interval';
  let segment = 'tone';
  if (second === 0) segment = 'marker';
  else if (phase >= 52.5) segment = 'announcement';
  else if (phase >= 45) segment = 'quiet';
  else if (isStationId) segment = 'identification';
  else if (!frequency) segment = 'quiet';
  return { minute, second, phase, frequency, activeFrequency: segment === 'tone' ? frequency : 0, label, segment, isStationId, marker: getSecondMarker(date), dayOfYear: getDayOfYear(date) };
}

/** One plan per second avoids Date construction and BCD work in the sample loop. */
export function createSecondPlan(epochSecond, options = DEFAULT_OPTIONS) {
  const date = new Date(epochSecond * 1000);
  const second = date.getUTCSeconds();
  const marker = getSecondMarker(date);
  const nextMarker = getSecondMarker(new Date((epochSecond + 1) * 1000));
  const bit = encodeTimeCode(date, options)[second];
  const dut1 = Number.isFinite(options.dut1) ? options.dut1 : 0;
  const doubled = dut1 > 0 ? second >= 1 && second <= Math.round(Math.min(dut1, 0.7) * 10) : dut1 < 0 && second >= 9 && second < 9 + Math.round(Math.min(-dut1, 0.7) * 10);
  return {
    second,
    markerFrequency: marker?.frequency ?? 0,
    markerDuration: marker?.duration ?? 0,
    hasNextMarker: Boolean(nextMarker),
    toneFrequency: second > 0 && second < 45 ? getToneFrequency(date) : 0,
    dataEnd: bit === null ? 0 : bit === 2 ? 0.8 : bit === 1 ? 0.5 : 0.2,
    doubled,
  };
}

/** The on-time tick has priority over all other audio. No artificial noise/filter. */
export function backgroundAllowed(plan, phase) {
  if (plan.second === 0) return false;
  if (plan.markerDuration && phase < 0.03) return false;
  if (plan.hasNextMarker && phase >= 0.99) return false;
  if (plan.doubled && phase >= 0.09 && phase < 0.13) return false;
  return true;
}

/** Sample at a fractional UTC second, keeping short phases for numeric precision. */
export function sampleSignal(plan, phase, options = DEFAULT_OPTIONS, voiceSample = 0) {
  if (options.ticks !== false) {
    if (phase < plan.markerDuration) return HEADROOM * Math.sin(TAU * plan.markerFrequency * phase);
    if (plan.doubled && phase >= 0.1 && phase < 0.105) return HEADROOM * Math.sin(TAU * 1000 * (phase - 0.1));
  }
  if (!backgroundAllowed(plan, phase)) return 0;
  let sample = 0;
  if (options.tones !== false && plan.toneFrequency) sample += 0.5 * Math.sin(TAU * plan.toneFrequency * phase);
  if (options.data !== false && plan.dataEnd && phase >= 0.03 && phase < 0.99) {
    // IRIG-H holds a low-level carrier between symbols (high:low = 3.3:1).
    sample += (phase < plan.dataEnd ? 0.5 : 0.5 / 3.3) * Math.sin(TAU * 100 * phase);
  }
  if (options.voice !== false) sample += VOICE_GAIN * voiceSample;
  return HEADROOM * sample;
}

/** Deterministic offline rendering, shared by tests and WAV exports. */
export function renderSignal(epochMs, duration, sampleRate = 48000, options = {}) {
  if (!Number.isFinite(epochMs) || !Number.isFinite(duration) || duration < 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError('Invalid render arguments');
  const config = { ...DEFAULT_OPTIONS, ...options };
  const result = new Float32Array(Math.round(duration * sampleRate));
  const startSecond = Math.floor(epochMs / 1000);
  const fraction = (epochMs - startSecond * 1000) / 1000;
  let planned = -1;
  let plan;
  for (let i = 0; i < result.length; i++) {
    const relative = fraction + i / sampleRate;
    const whole = Math.floor(relative);
    if (whole !== planned) { plan = createSecondPlan(startSecond + whole, config); planned = whole; }
    result[i] = sampleSignal(plan, relative - whole, config);
  }
  return result;
}

/** Recorded clip sequence; offsets preserve the cadence of the source voice. */
export function getAnnouncementSequence(nextMinute, durationFor) {
  const date = asDate(nextMinute);
  const hour = date.getUTCHours();
  const minute = date.getUTCMinutes();
  const hourId = `v_${hour}`;
  const minuteId = `v_${minute}`;
  const hourUnit = hour === 1 ? 'v_hour' : 'v_hours';
  const minuteUnit = minute === 1 ? 'v_minute' : 'v_minutes';
  const sequence = [{ id: 'v_at_the_tone', offsetSeconds: 52.5 }, { id: hourId, offsetSeconds: 53.5 }];
  let offset = 53.5 + durationFor(hourId) + 0.1;
  sequence.push({ id: hourUnit, offsetSeconds: offset });
  offset += durationFor(hourUnit) + 0.4;
  sequence.push({ id: minuteId, offsetSeconds: offset });
  offset += durationFor(minuteId) + 0.1;
  sequence.push({ id: minuteUnit, offsetSeconds: offset });
  offset += durationFor(minuteUnit) + 0.4;
  sequence.push({ id: 'v_utc', offsetSeconds: offset });
  return sequence;
}
