import { settings, type FxSettings } from '../lib/settings';
import { FxChain } from './fx';
import { setDecodeContext } from './samples';

const WORKLET = `
class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.on = false; this.pending = []; this.L = []; this.R = []; this.count = 0;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.cmd === 'capture') this.pending.push({ on: m.on, at: m.at });
      if (m.cmd === 'flush') { this.flush(); this.port.postMessage({ type: 'flushed' }); }
    };
  }
  flush() {
    if (!this.count) return;
    const l = new Float32Array(this.count), r = new Float32Array(this.count);
    let o = 0;
    for (let i = 0; i < this.L.length; i++) { l.set(this.L[i], o); r.set(this.R[i], o); o += this.L[i].length; }
    this.port.postMessage({ type: 'data', l, r }, [l.buffer, r.buffer]);
    this.L = []; this.R = []; this.count = 0;
  }
  process(inputs) {
    const inp = inputs[0];
    const n = 128;
    const l = inp && inp[0] ? inp[0] : null;
    const r = inp && inp[1] ? inp[1] : l;
    let start = 0;
    // apply pending state changes at sample precision
    while (start < n) {
      let nextIdx = n, next = null;
      for (const p of this.pending) {
        const idx = Math.round((p.at - currentTime) * sampleRate);
        if (idx < nextIdx) { nextIdx = Math.max(start, idx); next = p; }
      }
      const end = next ? nextIdx : n;
      if (this.on && end > start) {
        const a = new Float32Array(end - start), b = new Float32Array(end - start);
        if (l) { a.set(l.subarray(start, end)); b.set(r.subarray(start, end)); }
        this.L.push(a); this.R.push(b); this.count += end - start;
      }
      if (next) {
        this.on = next.on;
        this.pending.splice(this.pending.indexOf(next), 1);
        this.port.postMessage({ type: 'state', on: next.on, frame: currentFrame + end });
      }
      start = end;
      if (!next) break;
    }
    if (this.count >= 8192) this.flush();
    return true;
  }
}
registerProcessor('air-capture', Capture);
`;

export type AudioStatus = 'off' | 'suspended' | 'running' | 'error';

/**
 * Central audio graph:
 *   instrument -> instFx -> instBus ─┬─> master -> limiter -> destination
 *                                    └─> recordTap -> capture worklet
 *   backing -> backingFx -> backingBus -> master (+ recordTap when enabled)
 *   metronome -> metroBus -> master       (never recorded)
 *   playback (library/multitrack) -> playbackBus -> master
 */
class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  private limiter!: DynamicsCompressorNode;
  instBus!: GainNode;
  instFx!: FxChain;
  backingBus!: GainNode;
  backingFx!: FxChain;
  metroBus!: GainNode;
  playbackBus!: GainNode;
  recordTap!: GainNode;
  private backingToRec!: GainNode;
  capture: AudioWorkletNode | null = null;
  status: AudioStatus = 'off';
  error = '';
  private listeners = new Set<() => void>();
  private initP: Promise<AudioContext> | null = null;

  onStatus(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private setStatus(s: AudioStatus) { this.status = s; this.listeners.forEach((l) => l()); }

  /** Must be called from a user gesture the first time (autoplay policy). */
  ensure(): Promise<AudioContext> {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return this.initP!;
    }
    this.initP = this.init();
    return this.initP;
  }

  private async init(): Promise<AudioContext> {
    const s = settings.get().audio;
    try {
      const ctx = new AudioContext({ latencyHint: s.latencyHint });
      this.ctx = ctx;
      setDecodeContext(ctx);
      ctx.onstatechange = () => this.setStatus(ctx.state === 'running' ? 'running' : ctx.state === 'suspended' ? 'suspended' : 'off');
      this.master = ctx.createGain();
      this.limiter = ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -3;
      this.limiter.knee.value = 2;
      this.limiter.ratio.value = 16;
      this.limiter.attack.value = 0.002;
      this.limiter.release.value = 0.12;
      this.master.connect(this.limiter).connect(ctx.destination);

      this.instFx = new FxChain(ctx);
      this.instBus = ctx.createGain();
      this.instFx.connect(this.instBus);
      this.instBus.connect(this.master);

      this.backingFx = new FxChain(ctx);
      this.backingFx.set({ reverb: 0.22, delay: 0, delayTime: 0.3, feedback: 0.2, chorus: 0.1 });
      this.backingBus = ctx.createGain();
      this.backingFx.connect(this.backingBus);
      this.backingBus.connect(this.master);

      this.metroBus = ctx.createGain();
      this.metroBus.connect(this.master);
      this.playbackBus = ctx.createGain();
      this.playbackBus.connect(this.master);

      this.recordTap = ctx.createGain();
      this.instBus.connect(this.recordTap);
      this.backingToRec = ctx.createGain();
      this.backingToRec.gain.value = 0;
      this.backingBus.connect(this.backingToRec).connect(this.recordTap);

      try {
        const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
        await ctx.audioWorklet.addModule(url);
        this.capture = new AudioWorkletNode(ctx, 'air-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 2, channelCountMode: 'explicit' });
        const mute = ctx.createGain();
        mute.gain.value = 0;
        this.recordTap.connect(this.capture).connect(mute).connect(ctx.destination);
      } catch (e) {
        console.error('Recorder worklet unavailable', e);
      }

      this.applyAudioSettings();
      settings.subscribe(() => this.applyAudioSettings());
      if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
      this.setStatus(ctx.state === 'running' ? 'running' : 'suspended');
      return ctx;
    } catch (e) {
      this.error = String(e);
      this.setStatus('error');
      throw e;
    }
  }

  private lastSink = '';
  private applyAudioSettings() {
    if (!this.ctx) return;
    const s = settings.get();
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.audio.master, t, 0.03);
    this.limiter.threshold.value = s.audio.limiter ? -3 : 0;
    this.limiter.ratio.value = s.audio.limiter ? 16 : 1;
    this.metroBus.gain.setTargetAtTime(s.metronome.volume, t, 0.02);
    this.backingBus.gain.setTargetAtTime(s.backing.volume, t, 0.03);
    this.backingToRec.gain.setTargetAtTime(s.backing.includeInRecording ? 1 : 0, t, 0.01);
    const sinkCtx = this.ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    if (s.audio.outputId !== this.lastSink && sinkCtx.setSinkId) {
      this.lastSink = s.audio.outputId;
      sinkCtx.setSinkId(s.audio.outputId).catch((e) => console.warn('setSinkId failed', e));
    }
  }

  setInstrumentFx(fx: FxSettings) { this.instFx?.set(fx); }

  get now() { return this.ctx?.currentTime ?? 0; }

  /** Estimated time from scheduling to sound leaving the speakers. */
  get outputLatency() {
    const c = this.ctx;
    if (!c) return 0;
    return (c.outputLatency || 0) + (c.baseLatency || 0);
  }
}

export const engine = new AudioEngine();
