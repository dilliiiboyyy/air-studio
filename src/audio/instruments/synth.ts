import { midiToFreq } from '../../lib/music';
import type { Settings } from '../../lib/settings';

type SynthParams = Settings['synth'];

export const SYNTH_PRESETS: { id: string; label: string; params: Partial<SynthParams> }[] = [
  { id: 'warmLead', label: 'Warm Lead', params: { wave: 'sawtooth', cutoff: 0.65, resonance: 4, attack: 0.03, release: 0.35, detune: 8, sub: 0.3, vibrato: 0.15, lfoRate: 5, glide: 0.06 } },
  { id: 'theremin', label: 'Theremin', params: { wave: 'sine', cutoff: 1, resonance: 0.5, attack: 0.08, release: 0.5, detune: 0, sub: 0, vibrato: 0.35, lfoRate: 6, glide: 0.12, quantize: false } },
  { id: 'squareBass', label: 'Square Bass', params: { wave: 'square', cutoff: 0.35, resonance: 6, attack: 0.005, release: 0.12, detune: 4, sub: 0.7, vibrato: 0, lfoRate: 3, glide: 0.03, octave: 2 } },
  { id: 'pad', label: 'Glass Pad', params: { wave: 'triangle', cutoff: 0.55, resonance: 2, attack: 0.6, release: 1.6, detune: 14, sub: 0.2, vibrato: 0.1, lfoRate: 0.4, glide: 0.2 } },
  { id: 'acidLine', label: 'Acid Line', params: { wave: 'sawtooth', cutoff: 0.3, resonance: 16, attack: 0.003, release: 0.1, detune: 0, sub: 0, vibrato: 0, lfoRate: 7, glide: 0.04, octave: 3 } },
  { id: 'chipLead', label: 'Chip Lead', params: { wave: 'square', cutoff: 1, resonance: 0.5, attack: 0.002, release: 0.08, detune: 0, sub: 0, vibrato: 0.25, lfoRate: 7.5, glide: 0 } },
];

export const WAVES: { id: OscillatorType; label: string }[] = [
  { id: 'sine', label: 'Sine' }, { id: 'triangle', label: 'Triangle' }, { id: 'sawtooth', label: 'Saw' }, { id: 'square', label: 'Square' },
];

/** One continuous-control synth voice (one per hand). */
export class SynthVoice {
  private o1: OscillatorNode;
  private o2: OscillatorNode;
  private sub: OscillatorNode;
  private subG: GainNode;
  private filter: BiquadFilterNode;
  private vca: GainNode;
  private lvl: GainNode;
  private lfo: OscillatorNode;
  private vibG: GainNode;
  private fltLfoG: GainNode;
  gate = false;
  private p: SynthParams;

  constructor(private ctx: BaseAudioContext, out: AudioNode, p: SynthParams) {
    const c = ctx;
    this.p = p;
    this.o1 = c.createOscillator();
    this.o2 = c.createOscillator();
    this.sub = c.createOscillator();
    this.sub.type = 'square';
    this.subG = c.createGain();
    this.filter = c.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.vca = c.createGain();
    this.vca.gain.value = 0;
    this.lvl = c.createGain();
    this.lvl.gain.value = 0.8;
    this.lfo = c.createOscillator();
    this.vibG = c.createGain();
    this.fltLfoG = c.createGain();
    this.lfo.connect(this.vibG);
    this.vibG.connect(this.o1.detune);
    this.vibG.connect(this.o2.detune);
    this.vibG.connect(this.sub.detune);
    this.lfo.connect(this.fltLfoG).connect(this.filter.detune);
    const mix = c.createGain();
    mix.gain.value = 0.32;
    this.o1.connect(mix); this.o2.connect(mix); this.sub.connect(this.subG).connect(mix);
    mix.connect(this.filter).connect(this.vca).connect(this.lvl).connect(out);
    [this.o1, this.o2, this.sub, this.lfo].forEach((o) => o.start());
    this.apply(p);
  }

  apply(p: SynthParams) {
    this.p = p;
    const t = this.ctx.currentTime;
    this.o1.type = p.wave;
    this.o2.type = p.wave;
    this.o1.detune.setTargetAtTime(-p.detune, t, 0.02);
    this.o2.detune.setTargetAtTime(p.detune, t, 0.02);
    this.subG.gain.setTargetAtTime(p.sub, t, 0.02);
    this.filter.Q.setTargetAtTime(p.resonance, t, 0.02);
    this.lfo.frequency.setTargetAtTime(p.lfoRate, t, 0.02);
  }

  /** Continuous controls. pitch: midi (float). bright: 0..1. level: 0..1. mod: 0..1 extra modulation. */
  set(pitch: number, bright: number, level: number, mod: number, when = this.ctx.currentTime) {
    const f = midiToFreq(pitch);
    const tc = Math.max(0.005, this.p.glide / 3);
    this.o1.frequency.setTargetAtTime(f, when, tc);
    this.o2.frequency.setTargetAtTime(f, when, tc);
    this.sub.frequency.setTargetAtTime(f / 2, when, tc);
    const cutoff = 120 * Math.pow(2, 7.6 * Math.max(0, Math.min(1, bright * this.p.cutoff * 1.25)));
    this.filter.frequency.setTargetAtTime(Math.min(18000, cutoff), when, 0.03);
    this.lvl.gain.setTargetAtTime(0.05 + 0.95 * level, when, 0.03);
    const vib = (this.p.vibrato + mod * 0.6) * 45; // cents
    this.vibG.gain.setTargetAtTime(vib, when, 0.05);
    this.fltLfoG.gain.setTargetAtTime(mod * 900, when, 0.05);
  }

  noteOn(vel = 0.8, when = this.ctx.currentTime) {
    this.gate = true;
    const g = this.vca.gain;
    g.cancelScheduledValues(when);
    g.setTargetAtTime(0.4 + 0.6 * vel, when, Math.max(0.002, this.p.attack / 3));
  }

  noteOff(when = this.ctx.currentTime) {
    this.gate = false;
    const g = this.vca.gain;
    g.cancelScheduledValues(when);
    g.setTargetAtTime(0, when, Math.max(0.005, this.p.release / 3));
  }

  dispose() {
    this.noteOff();
    const t = this.ctx.currentTime + this.p.release * 2 + 0.1;
    [this.o1, this.o2, this.sub, this.lfo].forEach((o) => { try { o.stop(t); } catch { /* */ } });
    setTimeout(() => this.lvl.disconnect(), (this.p.release * 2 + 0.3) * 1000);
  }
}

/** Fixed-pitch note playback for rendering synth note events (e.g. recordings re-rendered offline). */
export function synthNote(ctx: BaseAudioContext, out: AudioNode, p: SynthParams, midi: number, vel: number, when: number, dur: number) {
  const v = new SynthVoice(ctx, out, p);
  v.set(midi, 0.8, 0.9, 0, when);
  v.noteOn(vel, when);
  v.noteOff(when + dur);
}
