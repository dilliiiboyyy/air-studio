import { chordMidi, CHORD_ROOTS } from '../../lib/music';
import { driveCurve } from '../fx';
import { BANKS, SampleBank } from '../samples';

export const GUITAR_PRESETS = [
  { id: 'acoustic', label: 'Acoustic Guitar' },
  { id: 'clean', label: 'Electric Clean' },
  { id: 'distorted', label: 'Electric Distorted' },
  { id: 'bass', label: 'Bass Guitar' },
];

interface StringVoice { g: GainNode; src: AudioBufferSourceNode; end: number }

export class GuitarInstrument {
  private bus: GainNode;
  private pre: GainNode;
  private shaper: WaveShaperNode;
  private cabLp: BiquadFilterNode;
  private hp: BiquadFilterNode;
  private post: GainNode;
  private strings: (StringVoice | null)[] = [null, null, null, null, null, null];
  preset = 'acoustic';

  constructor(private ctx: BaseAudioContext, out: AudioNode, preset = 'acoustic') {
    this.bus = ctx.createGain();
    this.pre = ctx.createGain();
    this.shaper = ctx.createWaveShaper();
    this.shaper.oversample = '4x';
    this.cabLp = ctx.createBiquadFilter();
    this.cabLp.type = 'lowpass';
    this.hp = ctx.createBiquadFilter();
    this.hp.type = 'highpass';
    this.post = ctx.createGain();
    this.bus.connect(this.pre).connect(this.shaper).connect(this.hp).connect(this.cabLp).connect(this.post).connect(out);
    this.setPreset(preset);
  }

  private get bank(): SampleBank {
    return this.preset === 'acoustic' ? BANKS.guitarAcoustic : this.preset === 'bass' ? BANKS.bass : BANKS.guitarElectric;
  }

  load(onProgress?: (f: number) => void) { return this.bank.load(onProgress); }

  setPreset(p: string) {
    this.preset = p;
    const dist = p === 'distorted';
    this.shaper.curve = dist ? driveCurve(9) : null;
    this.pre.gain.value = dist ? 3.2 : 1;
    this.cabLp.frequency.value = dist ? 4200 : 16000;
    this.cabLp.Q.value = dist ? 1.1 : 0.5;
    this.hp.frequency.value = p === 'bass' ? 30 : dist ? 110 : 70;
    this.post.gain.value = dist ? 0.32 : p === 'bass' ? 1.1 : p === 'clean' ? 0.9 : 1;
  }

  /** Strum a chord. Downstrokes go low→high strings, upstrokes high→low (top 4-5 strings). */
  strum(chord: string, dir: 'down' | 'up', vel: number, when = this.ctx.currentTime, muted = false, speed = 1) {
    const v = Math.max(0.08, Math.min(1, vel));
    if (this.preset === 'bass') {
      const root = CHORD_ROOTS[chord] ?? 0;
      const midi = 28 + ((root - 4 + 12) % 12); // E1..D#2
      this.pluck(0, midi, v * (dir === 'up' ? 0.8 : 1), when, muted);
      return;
    }
    const notes = chordMidi(chord);
    const order = dir === 'down' ? [0, 1, 2, 3, 4, 5] : [5, 4, 3, 2, 1, 0];
    const spacing = Math.max(0.006, Math.min(0.028, 0.02 / Math.max(0.5, speed)));
    let k = 0;
    order.forEach((s) => {
      const n = notes[s];
      if (n < 0) return;
      if (dir === 'up' && s < 1) return; // upstrokes rarely catch the low E
      const accent = dir === 'down' ? 1 - k * 0.04 : 0.78 - k * 0.03;
      this.pluck(s, n, v * accent, when + k * spacing, muted);
      k++;
    });
  }

  pluck(stringIdx: number, midi: number, v: number, when: number, muted: boolean) {
    const pick = this.bank.pick(midi);
    if (!pick) return;
    const c = this.ctx;
    const prev = this.strings[stringIdx];
    if (prev && prev.end > when) {
      prev.g.gain.setTargetAtTime(0, when, 0.012);
      try { prev.src.stop(when + 0.1); } catch { /* */ }
    }
    const src = c.createBufferSource();
    src.buffer = pick.buffer;
    src.playbackRate.value = pick.rate;
    const g = c.createGain();
    const amp = (0.15 + 0.85 * Math.pow(v, 1.4)) * (this.preset === 'acoustic' ? 0.75 : 0.9);
    let node: AudioNode = src;
    if (muted) {
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = this.preset === 'distorted' ? 900 : 1400;
      src.connect(lp);
      node = lp;
      g.gain.setValueAtTime(amp, when);
      g.gain.setTargetAtTime(0, when + 0.03, 0.035);
    } else {
      g.gain.setValueAtTime(amp, when);
    }
    node.connect(g).connect(this.bus);
    const end = when + (muted ? 0.4 : 6);
    src.start(when);
    src.stop(end);
    this.strings[stringIdx] = { g, src, end };
  }

  /** Damp all ringing strings. */
  damp(when = this.ctx.currentTime) {
    this.strings.forEach((s) => { if (s && s.end > when) s.g.gain.setTargetAtTime(0, when, 0.05); });
  }
}
