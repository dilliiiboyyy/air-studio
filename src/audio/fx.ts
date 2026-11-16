import type { FxSettings } from '../lib/settings';

const irCache = new WeakMap<BaseAudioContext, AudioBuffer>();
const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

/** Synthesised stereo room impulse (diffuse exponentially decaying noise with HF damping). */
export function reverbIR(ctx: BaseAudioContext, seconds = 2.6): AudioBuffer {
  const c = irCache.get(ctx);
  if (c) return c;
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const env = Math.pow(1 - i / len, 2.2) * Math.exp(-t * 1.6);
      const damp = 0.25 + 0.7 * Math.exp(-t * 2.5); // brighter early, darker tail
      const n = Math.random() * 2 - 1;
      lp += (n - lp) * damp;
      d[i] = lp * env * (t < 0.008 ? t / 0.008 : 1);
    }
  }
  irCache.set(ctx, buf);
  return buf;
}

export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const c = noiseCache.get(ctx);
  if (c) return c;
  const len = ctx.sampleRate * 2;
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  noiseCache.set(ctx, b);
  return b;
}

/** Insert chorus + reverb send + delay send. input -> output. */
export class FxChain {
  readonly input: GainNode;
  readonly output: GainNode;
  private dry: GainNode;
  private chorusWet: GainNode;
  private chorusDelay: DelayNode;
  private chorusDepth: GainNode;
  private lfo: OscillatorNode;
  private revSend: GainNode;
  private delSend: GainNode;
  private delay: DelayNode;
  private fb: GainNode;

  constructor(private ctx: BaseAudioContext) {
    const c = ctx;
    this.input = c.createGain();
    this.output = c.createGain();
    this.dry = c.createGain();
    // chorus (insert, mixed)
    this.chorusDelay = c.createDelay(0.05);
    this.chorusDelay.delayTime.value = 0.018;
    this.lfo = c.createOscillator();
    this.lfo.frequency.value = 0.7;
    this.chorusDepth = c.createGain();
    this.chorusDepth.gain.value = 0;
    this.lfo.connect(this.chorusDepth).connect(this.chorusDelay.delayTime);
    this.lfo.start();
    this.chorusWet = c.createGain();
    this.chorusWet.gain.value = 0;
    const pre = c.createGain();
    this.input.connect(pre);
    pre.connect(this.dry).connect(this.output);
    pre.connect(this.chorusDelay).connect(this.chorusWet).connect(this.output);
    // reverb
    this.revSend = c.createGain();
    this.revSend.gain.value = 0;
    const conv = c.createConvolver();
    conv.buffer = reverbIR(c);
    const revHp = c.createBiquadFilter();
    revHp.type = 'highpass';
    revHp.frequency.value = 180;
    this.output.connect(this.revSend).connect(revHp).connect(conv);
    // delay
    this.delSend = c.createGain();
    this.delSend.gain.value = 0;
    this.delay = c.createDelay(2);
    this.fb = c.createGain();
    const dlp = c.createBiquadFilter();
    dlp.type = 'lowpass';
    dlp.frequency.value = 3800;
    this.output.connect(this.delSend).connect(this.delay).connect(dlp).connect(this.fb).connect(this.delay);
    // wet returns go into a separate node merged after output
    this.returns = c.createGain();
    conv.connect(this.returns);
    dlp.connect(this.returns);
  }

  /** Effect returns (connect alongside output). */
  readonly returns: GainNode;

  connect(dest: AudioNode) {
    this.output.connect(dest);
    this.returns.connect(dest);
  }

  set(fx: FxSettings) {
    const t = this.ctx.currentTime;
    const s = (p: AudioParam, v: number) => p.setTargetAtTime(v, t, 0.03);
    s(this.revSend.gain, fx.reverb * 0.9);
    s(this.delSend.gain, fx.delay * 0.7);
    s(this.delay.delayTime, Math.max(0.05, fx.delayTime));
    s(this.fb.gain, Math.min(0.85, fx.feedback));
    s(this.chorusWet.gain, fx.chorus * 0.8);
    s(this.dry.gain, 1 - fx.chorus * 0.3);
    s(this.chorusDepth.gain, 0.002 + fx.chorus * 0.004);
  }

  dispose() {
    try { this.lfo.stop(); } catch { /* already */ }
    this.input.disconnect();
    this.output.disconnect();
    this.returns.disconnect();
  }
}

/** Soft-clip curve for distortion. */
export function driveCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 2048;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  const k = amount;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return curve;
}
