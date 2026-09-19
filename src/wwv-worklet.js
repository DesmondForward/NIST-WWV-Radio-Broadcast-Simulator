import { DEFAULT_OPTIONS, createSecondPlan, getAnnouncementSequence, sampleSignal } from './signal.js';

class WWVProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.options = { ...DEFAULT_OPTIONS };
    this.clips = new Map();
    this.running = false;
    this.anchorFrame = 0;
    this.anchorSecond = 0;
    this.anchorFraction = 0;
    this.lastSecond = -1;
    this.lastMinute = -1;
    this.sequence = [];
    this.returnFrame = null;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'configure') {
        this.options = { ...this.options, ...data.options };
        this.lastSecond = -1;
      } else if (data.type === 'clip') {
        this.clips.set(data.id, { samples: data.samples, sampleRate: data.sampleRate });
        this.lastMinute = -1;
        this.lastSecond = -1;
      } else if (data.type === 'start') {
        this.anchorFrame = data.anchorFrame;
        this.anchorSecond = Math.floor(data.epochMs / 1000);
        this.anchorFraction = (data.epochMs - this.anchorSecond * 1000) / 1000;
        this.lastSecond = -1;
        this.lastMinute = -1;
        this.returnFrame = data.returnFrame ?? null;
        this.returnEpochMs = data.returnEpochMs;
        this.runId = data.runId;
        this.fadeInFrame = null;
        this.running = true;
      } else if (data.type === 'update-return') {
        this.returnEpochMs = data.returnEpochMs;
      } else if (data.type === 'stop') {
        this.running = false;
        this.returnFrame = null;
      }
    };
  }

  buildSequence(epochMinute) {
    const date = new Date(epochMinute * 60000);
    const durationFor = (id) => {
      const clip = this.clips.get(id);
      return clip ? clip.samples.length / clip.sampleRate : 0;
    };
    const sequence = getAnnouncementSequence((epochMinute + 1) * 60000, durationFor);
    // Avoid partial spoken times if a recording failed to load.
    this.sequence = sequence.every(({ id }) => this.clips.has(id)) ? sequence : [];
    if (date.getUTCMinutes() === 0 || date.getUTCMinutes() === 30) {
      const id = this.clips.has('v_ident_clean') ? 'v_ident_clean' : 'v_ident_better';
      if (this.clips.has(id)) this.sequence.push({ id, offsetSeconds: id === 'v_ident_clean' ? 1 : 1.01707 });
    }
  }

  voiceAt(minutePhase) {
    if (!this.options.voice) return 0;
    for (const item of this.sequence) {
      const clip = this.clips.get(item.id);
      const position = (minutePhase - item.offsetSeconds) * clip.sampleRate;
      if (position < 0 || position >= clip.samples.length - 1) continue;
      const index = Math.floor(position);
      const fraction = position - index;
      return clip.samples[index] + (clip.samples[index + 1] - clip.samples[index]) * fraction;
    }
    return 0;
  }

  process(_inputs, outputs) {
    const output = outputs[0][0];
    if (!this.running) { output.fill(0); return true; }
    let relativeStart = this.anchorFraction + (currentFrame - this.anchorFrame) / sampleRate;
    for (let i = 0; i < output.length; i++) {
      if (this.returnFrame !== null && currentFrame + i >= this.returnFrame) {
        this.anchorFrame = this.returnFrame;
        this.anchorSecond = Math.floor(this.returnEpochMs / 1000);
        this.anchorFraction = (this.returnEpochMs - this.anchorSecond * 1000) / 1000;
        this.lastSecond = -1;
        this.lastMinute = -1;
        this.fadeInFrame = this.returnFrame;
        this.returnFrame = null;
        relativeStart = this.anchorFraction + (currentFrame - this.anchorFrame) / sampleRate;
        this.port.postMessage({ type: 'previewend', epochMs: this.returnEpochMs, anchorFrame: this.anchorFrame, runId: this.runId });
      }
      const relative = relativeStart + i / sampleRate;
      const whole = Math.floor(relative);
      const epochSecond = this.anchorSecond + whole;
      const phase = relative - whole;
      if (epochSecond !== this.lastSecond) {
        this.plan = createSecondPlan(epochSecond, this.options);
        this.lastSecond = epochSecond;
        const minute = Math.floor(epochSecond / 60);
        if (minute !== this.lastMinute) {
          this.buildSequence(minute);
          this.lastMinute = minute;
        }
      }
      let transitionGain = 1;
      if (this.returnFrame !== null) transitionGain = Math.min(1, (this.returnFrame - currentFrame - i) / (sampleRate * 0.005));
      if (this.fadeInFrame !== null) transitionGain *= Math.min(1, (currentFrame + i - this.fadeInFrame) / (sampleRate * 0.005));
      output[i] = transitionGain * sampleSignal(this.plan, phase, this.options, this.voiceAt(this.plan.second + phase));
    }
    // One mono source is upmixed equally by Web Audio; no stereo phase artifacts.
    return true;
  }
}

registerProcessor('wwv-processor', WWVProcessor);
