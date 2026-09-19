import workletUrl from './wwv-worklet.js?worker&url';
import { DEFAULT_OPTIONS } from './signal.js';

const clampVolume = (value) => Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0));

/** Audio-thread WWV replica. Playback never depends on a setInterval scheduler. */
export class WWVAudioEngine extends EventTarget {
  constructor(options = {}) {
    super();
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.volume = clampVolume(options.volume ?? 0.65);
    this.context = null;
    this.analyser = null;
    this.playing = false;
    this.voiceReady = false;
    this.buffers = new Map();
    this._generation = 0;
    this._anchorEpochMs = 0;
    this._anchorContextTime = 0;
    this._preview = false;
    this._returnContextTime = null;
    this._wasRunning = false;
  }

  _ensureContext() {
    if (this.context) return this.context;
    const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!Context) throw new Error('This browser does not support Web Audio. Try a current Chrome, Edge, Firefox, or Safari browser.');
    const context = new Context({ latencyHint: 'interactive' });
    if (!context.audioWorklet) {
      void context.close();
      throw new Error('AudioWorklet is unavailable. Open the application on localhost or a secure HTTPS connection.');
    }
    this.context = context;
    this.master = context.createGain();
    this.master.gain.value = 0;
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.75;
    this.master.connect(this.analyser);
    this.analyser.connect(context.destination);
    context.onstatechange = () => {
      // A suspended device cannot render audio. Re-anchor live mode after resume
      // so a laptop wake does not leave the broadcast minutes behind the clock.
      if (context.state === 'running' && this.playing && !this._wasRunning) {
        if (!this._preview) this._anchor(Date.now());
        else if (this._returnContextTime !== null) {
          this._returnEpochMs = Date.now() + (this._returnContextTime - context.currentTime) * 1000;
          this.node?.port.postMessage({ type: 'update-return', returnEpochMs: this._returnEpochMs });
        }
      }
      this._wasRunning = context.state === 'running';
      this.dispatchEvent(new Event('statechange'));
    };
    return context;
  }

  async _ensureWorklet() {
    if (this.node) return;
    if (!this._modulePromise) {
      this._modulePromise = this.context.audioWorklet.addModule(workletUrl).then(() => {
        this.node = new AudioWorkletNode(this.context, 'wwv-processor', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
        this.node.onprocessorerror = () => {
          this.playing = false;
          this.master.gain.setValueAtTime(0, this.context.currentTime);
          this.dispatchEvent(new CustomEvent('error', { detail: new Error('The audio renderer stopped. Reload to restart playback.') }));
        };
        this.node.connect(this.master);
        this.node.port.onmessage = ({ data }) => {
          if (data.type !== 'previewend' || !this._preview || !this.playing || data.runId !== this._generation) return;
          this._preview = false;
          this._returnContextTime = null;
          this._anchorEpochMs = data.epochMs;
          this._anchorContextTime = data.anchorFrame / this.context.sampleRate;
          this.dispatchEvent(new Event('previewend'));
          this.dispatchEvent(new Event('statechange'));
        };
        this.node.port.postMessage({ type: 'configure', options: this.options });
        for (const [id, buffer] of this.buffers) this._sendBuffer(id, buffer);
      }).catch((error) => { this._modulePromise = null; throw error; });
    }
    await this._modulePromise;
  }

  _sendBuffer(id, buffer) {
    // Keep the stored copy intact so start/stop and later restarts retain voices.
    const samples = new Float32Array(buffer.length);
    const channels = buffer.numberOfChannels;
    for (let channel = 0; channel < channels; channel++) {
      const source = buffer.getChannelData(channel);
      for (let i = 0; i < samples.length; i++) samples[i] += source[i] / channels;
    }
    this.node.port.postMessage({ type: 'clip', id, samples, sampleRate: buffer.sampleRate }, [samples.buffer]);
  }

  registerVoiceBuffer(id, buffer) {
    this.buffers.set(id, buffer);
    if (this.node) this._sendBuffer(id, buffer);
    this.voiceReady = Array.from({ length: 60 }, (_, index) => `v_${index}`).concat(['v_at_the_tone', 'v_hour', 'v_hours', 'v_minute', 'v_minutes', 'v_utc']).every((key) => this.buffers.has(key));
  }

  /** Accepts { id: url } or the clips object in the bundled manifest. */
  async loadVoiceSamples(manifest) {
    const context = this._ensureContext();
    const entries = Object.entries(manifest.clips ?? manifest);
    // Small batches avoid flooding slower mobile connections with 68 requests.
    for (let start = 0; start < entries.length; start += 8) {
      await Promise.all(entries.slice(start, start + 8).map(async ([id, item]) => {
        if (this.buffers.has(id)) return;
        const url = typeof item === 'string' ? item : item.url;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Could not load voice recording: ${id}`);
        const buffer = await context.decodeAudioData(await response.arrayBuffer());
        this.registerVoiceBuffer(id, buffer);
      }));
    }
    this.dispatchEvent(new Event('statechange'));
    return this.voiceReady;
  }

  _anchor(epochMs, durationSeconds = null) {
    this._anchorEpochMs = epochMs;
    this._anchorContextTime = this.context.currentTime;
    const anchorFrame = Math.round(this._anchorContextTime * this.context.sampleRate);
    this._returnContextTime = Number.isFinite(durationSeconds) && durationSeconds > 0 ? this._anchorContextTime + durationSeconds : null;
    this._returnEpochMs = this._returnContextTime === null ? null : Date.now() + durationSeconds * 1000;
    this.node?.port.postMessage({ type: 'start', epochMs, anchorFrame, runId: this._generation, returnFrame: this._returnContextTime === null ? null : anchorFrame + Math.round(durationSeconds * this.context.sampleRate), returnEpochMs: this._returnEpochMs });
  }

  /** Unlock the browser audio context from a user gesture without starting sound. */
  async prepare() {
    const context = this._ensureContext();
    // Invoke resume synchronously in the user gesture before awaiting modules.
    const resume = context.resume();
    await Promise.all([resume, this._ensureWorklet()]);
    return this;
  }

  async start({ epochMs, durationSeconds } = {}) {
    const generation = ++this._generation;
    await this.prepare();
    const context = this.context;
    if (generation !== this._generation) return;
    this._preview = Number.isFinite(epochMs);
    this._anchor(this._preview ? epochMs : Date.now(), this._preview ? durationSeconds : null);
    this.playing = true;
    this.master.gain.cancelScheduledValues(context.currentTime);
    this.master.gain.setValueAtTime(0, context.currentTime);
    this.master.gain.linearRampToValueAtTime(this.volume, context.currentTime + 0.015);
    this.dispatchEvent(new Event('statechange'));
  }

  async stop() {
    const generation = ++this._generation;
    this.playing = false;
    this._preview = false;
    this._returnContextTime = null;
    if (this.context && this.master) {
      this.master.gain.cancelScheduledValues(this.context.currentTime);
      this.master.gain.setValueAtTime(this.master.gain.value, this.context.currentTime);
      this.master.gain.linearRampToValueAtTime(0, this.context.currentTime + 0.015);
      // Let the audio thread complete the short fade before suspending it.
      await new Promise((resolve) => setTimeout(resolve, 25));
      if (generation !== this._generation) return;
      this.node?.port.postMessage({ type: 'stop' });
      await this.context.suspend();
    }
    this.dispatchEvent(new Event('statechange'));
  }

  setVolume(value) {
    this.volume = clampVolume(value);
    if (this.context && this.master && this.playing) this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.012);
  }

  setOptions(options) {
    this.options = { ...this.options, ...options };
    this.node?.port.postMessage({ type: 'configure', options: this.options });
  }

  get currentTimeMs() {
    if (!this.playing || !this.context) return Date.now();
    if (this._returnContextTime !== null && this.context.currentTime >= this._returnContextTime) return this._returnEpochMs + (this.context.currentTime - this._returnContextTime) * 1000;
    return this._anchorEpochMs + (this.context.currentTime - this._anchorContextTime) * 1000;
  }

  get interrupted() { return this.playing && this.context?.state !== 'running'; }

  get isPreview() { return this._preview && (this._returnContextTime === null || this.context.currentTime < this._returnContextTime); }

  get sampleRate() { return this.context?.sampleRate ?? 0; }

  async destroy() {
    await this.stop();
    await this.context?.close();
    this.context = null;
    this.node = null;
    this._modulePromise = null;
  }
}

export default WWVAudioEngine;
