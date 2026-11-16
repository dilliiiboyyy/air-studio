import { midiToFreq } from '../../lib/music';
import { BANKS } from '../samples';

export interface Voice { stop(when?: number): void }

export const PIANO_PRESETS = [
  { id: 'acoustic', label: 'Acoustic Piano' },
  { id: 'grand', label: 'Grand Piano' },
  { id: 'electric', label: 'Electric Piano' },
  { id: 'synth', label: 'Synthesizer' },
  { id: 'ambient', label: 'Soft Ambient Piano' },
  { id: 'organ', label: 'Organ' },
];

const SAMPLED = new Set(['acoustic', 'grand', 'ambient']);

export class PianoInstrument {
  private tone: BiquadFilterNode;
  private shelf: BiquadFilterNode;
  private bus: GainNode;
  preset = 'acoustic';

  constructor(private ctx: BaseAudioContext, out: AudioNode, preset = 'acoustic') {
    this.bus = ctx.createGain();
    this.tone = ctx.createBiquadFilter();
    this.shelf = ctx.createBiquadFilter();
    this.shelf.type = 'highshelf';
    this.shelf.frequency.value = 3500;
    this.bus.connect(this.tone).connect(this.shelf).connect(out);
    this.setPreset(preset);
  }

  get needsSamples() { return SAMPLED.has(this.preset); }

  async load(onProgress?: (f: number) => void) {
    if (!this.needsSamples) return;
    let a = 0, b = 0;
    const rep = () => onProgress?.((a + b) / 2);
    await Promise.all([
      BANKS.pianoLoud.load((f) => { a = f; rep(); }),
      BANKS.pianoSoft.load((f) => { b = f; rep(); }),
    ]);
  }

  setPreset(p: string) {
    this.preset = p;
    this.tone.type = 'lowpass';
    this.tone.Q.value = 0.5;
    const set = (freq: number, shelfDb: number, gain: number) => {
      this.tone.frequency.value = freq;
      this.shelf.gain.value = shelfDb;
      this.bus.gain.value = gain;
    };
    switch (p) {
      case 'grand': set(16000, 2.5, 1.05); break;
      case 'ambient': set(2400, -4, 0.95); break;
      case 'electric': set(9000, 0, 0.55); break;
      case 'organ': set(7000, -2, 0.32); break;
      case 'synth': set(18000, 0, 0.3); break;
      default: set(15000, 0, 1);
    }
  }

  noteOn(midi: number, vel: number, when = this.ctx.currentTime): Voice {
    const v = Math.max(0.05, Math.min(1, vel));
    switch (this.preset) {
      case 'electric': return this.ep(midi, v, when);
      case 'organ': return this.organ(midi, v, when);
      case 'synth': return this.synth(midi, v, when);
      default:
        if (BANKS.pianoLoud.loaded) return this.sampled(midi, v, when);
        return this.fallbackPiano(midi, v, when);
    }
  }

  private sampled(midi: number, v: number, when: number): Voice {
    const c = this.ctx;
    const g = c.createGain();
    g.connect(this.bus);
    const amp = 0.12 + 0.88 * Math.pow(v, 1.6);
    const srcs: AudioBufferSourceNode[] = [];
    const layer = (bank: typeof BANKS.pianoLoud, gain: number) => {
      const p = bank.pick(midi);
      if (!p || gain < 0.02) return;
      const s = c.createBufferSource();
      s.buffer = p.buffer;
      s.playbackRate.value = p.rate;
      const lg = c.createGain();
      lg.gain.value = gain;
      s.connect(lg).connect(g);
      s.start(when);
      srcs.push(s);
    };
    const ambient = this.preset === 'ambient';
    const softMix = ambient ? 1 : BANKS.pianoSoft.loaded ? Math.max(0, Math.min(1, (0.6 - v) / 0.4)) : 0;
    layer(BANKS.pianoLoud, (1 - softMix) * amp);
    if (BANKS.pianoSoft.loaded) layer(BANKS.pianoSoft, softMix * amp * 1.5);
    let pad: OscillatorNode | null = null;
    if (ambient) {
      // airy octave pad layer for the ambient preset
      pad = c.createOscillator();
      pad.type = 'sine';
      pad.frequency.value = midiToFreq(midi + 12);
      const pg = c.createGain();
      pg.gain.setValueAtTime(0, when);
      pg.gain.linearRampToValueAtTime(0.05 * v, when + 0.6);
      pad.connect(pg).connect(g);
      pad.start(when);
    }
    g.gain.value = 1;
    const tau = this.preset === 'ambient' ? 0.7 : this.preset === 'grand' ? 0.22 : 0.16;
    let stopped = false;
    const hardStop = when + 12;
    srcs.forEach((s) => s.stop(hardStop));
    pad?.stop(hardStop);
    return {
      stop: (t = c.currentTime) => {
        if (stopped) return;
        stopped = true;
        const at = Math.max(t, when);
        g.gain.setTargetAtTime(0, at, tau);
        const end = at + tau * 7;
        srcs.forEach((s) => { try { s.stop(end); } catch { /* */ } });
        try { pad?.stop(end); } catch { /* */ }
      },
    };
  }

  private envVoice(oscs: OscillatorNode[], g: GainNode, when: number, release: number, maxDur = 12): Voice {
    oscs.forEach((o) => { o.start(when); o.stop(when + maxDur); });
    let stopped = false;
    return {
      stop: (t = this.ctx.currentTime) => {
        if (stopped) return;
        stopped = true;
        const at = Math.max(t, when + 0.005);
        g.gain.cancelScheduledValues(at);
        g.gain.setTargetAtTime(0, at, release);
        oscs.forEach((o) => { try { o.stop(at + release * 7); } catch { /* */ } });
      },
    };
  }

  private ep(midi: number, v: number, when: number): Voice {
    const c = this.ctx, f = midiToFreq(midi);
    const car = c.createOscillator(); car.frequency.value = f;
    const mod = c.createOscillator(); mod.frequency.value = f;
    const tine = c.createOscillator(); tine.frequency.value = f * 14;
    const mg = c.createGain();
    const idx = (1.2 + 2.8 * v) * f;
    mg.gain.setValueAtTime(idx, when);
    mg.gain.setTargetAtTime(idx * 0.25, when, 0.35);
    const tg = c.createGain();
    tg.gain.setValueAtTime(f * 1.5 * v, when);
    tg.gain.setTargetAtTime(0, when, 0.02);
    mod.connect(mg).connect(car.frequency);
    tine.connect(tg).connect(car.frequency);
    const g = c.createGain();
    const peak = 0.25 + 0.75 * v;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak, when + 0.003);
    g.gain.setTargetAtTime(peak * 0.35, when + 0.003, 0.6);
    g.gain.setTargetAtTime(0.0001, when + 2, 2.5);
    car.connect(g).connect(this.bus);
    return this.envVoice([car, mod, tine], g, when, 0.12);
  }

  private organ(midi: number, v: number, when: number): Voice {
    const c = this.ctx, f = midiToFreq(midi);
    const g = c.createGain();
    const bars: [number, number][] = [[0.5, 0.55], [1, 1], [1.5, 0.45], [2, 0.6], [3, 0.3], [4, 0.28], [6, 0.12]];
    const vib = c.createOscillator(); vib.frequency.value = 6.4;
    const vg = c.createGain(); vg.gain.value = 5; // cents
    vib.connect(vg);
    const oscs = bars.map(([r, a]) => {
      const o = c.createOscillator();
      o.frequency.value = f * r;
      vg.connect(o.detune);
      const og = c.createGain(); og.gain.value = a;
      o.connect(og).connect(g);
      return o;
    });
    // key click
    const click = c.createOscillator(); click.type = 'square'; click.frequency.value = f * 8;
    const cg = c.createGain(); cg.gain.setValueAtTime(0.08 * v, when); cg.gain.setTargetAtTime(0, when, 0.004);
    click.connect(cg).connect(g);
    const lvl = 0.5 + 0.2 * v;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(lvl, when + 0.01);
    g.connect(this.bus);
    return this.envVoice([...oscs, vib, click], g, when, 0.03, 30);
  }

  private synth(midi: number, v: number, when: number): Voice {
    const c = this.ctx, f = midiToFreq(midi);
    const o1 = c.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = f; o1.detune.value = -7;
    const o2 = c.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = f; o2.detune.value = 7;
    const o3 = c.createOscillator(); o3.type = 'square'; o3.frequency.value = f / 2;
    const s3 = c.createGain(); s3.gain.value = 0.35;
    const flt = c.createBiquadFilter(); flt.type = 'lowpass'; flt.Q.value = 3;
    const top = 900 + 5000 * v;
    flt.frequency.setValueAtTime(top, when);
    flt.frequency.setTargetAtTime(700 + 900 * v, when + 0.01, 0.25);
    const g = c.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.5 + 0.5 * v, when + 0.008);
    g.gain.setTargetAtTime(0.35 + 0.3 * v, when + 0.01, 0.3);
    o1.connect(flt); o2.connect(flt); o3.connect(s3).connect(flt);
    flt.connect(g).connect(this.bus);
    return this.envVoice([o1, o2, o3], g, when, 0.15, 30);
  }

  private fallbackPiano(midi: number, v: number, when: number): Voice {
    const c = this.ctx, f = midiToFreq(midi);
    const g = c.createGain();
    const oscs = [1, 2, 3, 4].map((h, i) => {
      const o = c.createOscillator();
      o.type = i === 0 ? 'triangle' : 'sine';
      o.frequency.value = f * h * (1 + 0.0004 * h * h);
      const og = c.createGain();
      og.gain.setValueAtTime(0.6 / (h * h) * (0.5 + v), when);
      og.gain.setTargetAtTime(0, when, 1.2 / h);
      o.connect(og).connect(g);
      return o;
    });
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.4 + 0.6 * v, when + 0.004);
    g.connect(this.bus);
    return this.envVoice(oscs, g, when, 0.15, 8);
  }
}
