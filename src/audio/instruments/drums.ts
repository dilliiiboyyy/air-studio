import { noiseBuffer } from '../fx';
import { loadBuffer, TR808 } from '../samples';

export const DRUM_PIECES = [
  { id: 'kick', label: 'Kick' }, { id: 'snare', label: 'Snare' }, { id: 'hhc', label: 'Closed Hi-Hat' },
  { id: 'hho', label: 'Open Hi-Hat' }, { id: 'crash', label: 'Crash' }, { id: 'ride', label: 'Ride' },
  { id: 'tomh', label: 'High Tom' }, { id: 'tomm', label: 'Mid Tom' }, { id: 'toml', label: 'Floor Tom' },
];

export const PERC_PIECES = [
  { id: 'bongoHi', label: 'Bongo High' }, { id: 'bongoLo', label: 'Bongo Low' },
  { id: 'congaSlap', label: 'Conga Slap' }, { id: 'congaOpen', label: 'Conga Open' }, { id: 'congaLow', label: 'Tumba' },
  { id: 'tambourine', label: 'Tambourine' }, { id: 'clap', label: 'Hand Clap' }, { id: 'shaker', label: 'Shaker' },
  { id: 'cowbell', label: 'Cowbell' }, { id: 'eClap', label: 'E-Clap' }, { id: 'eRim', label: 'E-Rim' },
  { id: 'eClave', label: 'E-Clave' }, { id: 'eConga', label: 'E-Conga' }, { id: 'eZap', label: 'E-Zap' },
];

export const PIECE_LABEL: Record<string, string> = Object.fromEntries([...DRUM_PIECES, ...PERC_PIECES].map((p) => [p.id, p.label]));

export const DRUM_PACKS = [
  { id: 'acoustic', label: 'Studio Acoustic' },
  { id: 'vintage', label: 'Vintage Warm' },
  { id: 'electronic', label: 'Electronic 808' },
];

const SAMPLE_FOR: Record<string, string> = {
  eClap: 'clap', eRim: 'rim', eClave: 'clave', eConga: 'congah', shaker808: 'maracas',
};

/**
 * Drum + percussion voice engine. Acoustic sounds are physically-inspired synthesis
 * (pitch-swept membranes, filtered noise, inharmonic metal partials); the 808 pack and
 * electronic percussion use TR-808 one-shots.
 */
export class DrumKit {
  private out: GainNode;
  private noise: AudioBuffer;
  private openHat: { g: GainNode; t: number } | null = null;
  private samples = new Map<string, AudioBuffer>();
  pack = 'acoustic';

  constructor(private ctx: BaseAudioContext, dest: AudioNode, pack = 'acoustic') {
    this.out = ctx.createGain();
    this.out.connect(dest);
    this.noise = noiseBuffer(ctx);
    this.pack = pack;
  }

  async load() {
    const names = this.pack === 'electronic' ? Object.keys(TR808) : ['clap', 'rim', 'clave', 'congah', 'maracas'];
    await Promise.all(names.map(async (n) => {
      const b = await loadBuffer(TR808[n]);
      if (b) this.samples.set(n, b);
    }));
  }

  setPack(p: string) { this.pack = p; return this.load(); }

  play(piece: string, vel: number, when = this.ctx.currentTime) {
    const v = Math.max(0.05, Math.min(1, vel));
    if (this.pack === 'electronic' && this.samples.has(piece)) return this.sample(piece, v, when);
    if (SAMPLE_FOR[piece] && this.samples.has(SAMPLE_FOR[piece])) return this.sample(SAMPLE_FOR[piece], v, when, piece === 'eConga' ? 1 : 1);
    const vint = this.pack === 'vintage';
    switch (piece) {
      case 'kick': return this.kick(v, when, vint);
      case 'snare': return this.snare(v, when, vint);
      case 'hhc': return this.hat(v, when, 0.045, vint);
      case 'hho': return this.hat(v, when, 0.5, vint, true);
      case 'crash': return this.cymbal(v, when, 1.8, 4200, vint);
      case 'ride': return this.ride(v, when, vint);
      case 'tomh': return this.tom(v, when, vint ? 240 : 210);
      case 'tomm': return this.tom(v, when, vint ? 180 : 155);
      case 'toml': return this.tom(v, when, vint ? 120 : 98);
      case 'bongoHi': return this.membrane(v, when, 440, 0.11, 0.2);
      case 'bongoLo': return this.membrane(v, when, 300, 0.16, 0.2);
      case 'congaOpen': return this.membrane(v, when, 330, 0.28, 0.15);
      case 'congaLow': return this.membrane(v, when, 220, 0.34, 0.15);
      case 'congaSlap': return this.slap(v, when);
      case 'tambourine': return this.tambourine(v, when);
      case 'clap': return this.clap(v, when);
      case 'shaker': return this.shaker(v, when);
      case 'cowbell': return this.cowbell(v, when);
      case 'eZap': return this.zap(v, when);
      case 'eClap': return this.clap(v, when);
      case 'eRim': return this.slap(v, when);
      case 'eClave': return this.membrane(v, when, 2500, 0.05, 0);
      case 'eConga': return this.membrane(v, when, 360, 0.2, 0);
      default: return this.snare(v, when, false);
    }
  }

  // ---------- building blocks ----------
  private g(level: number, when: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(level, when);
    g.connect(this.out);
    return g;
  }

  private noiseSrc(when: number, dur: number) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.start(when, Math.random() * 1.5);
    s.stop(when + dur);
    return s;
  }

  private filt(type: BiquadFilterType, f: number, q = 0.7) {
    const b = this.ctx.createBiquadFilter();
    b.type = type; b.frequency.value = f; b.Q.value = q;
    return b;
  }

  private sample(name: string, v: number, when: number, rate = 1) {
    const b = this.samples.get(name);
    if (!b) return;
    const s = this.ctx.createBufferSource();
    s.buffer = b;
    s.playbackRate.value = rate;
    const g = this.g(0.2 + 0.9 * v * v, when);
    if (name === 'hhc' && this.openHat) this.chokeHat(when);
    s.connect(g);
    s.start(when);
    if (name === 'hho') this.openHat = { g, t: when };
  }

  private chokeHat(when: number) {
    if (this.openHat && when >= this.openHat.t) {
      this.openHat.g.gain.setTargetAtTime(0, when, 0.01);
      this.openHat = null;
    }
  }

  private kick(v: number, when: number, vint: boolean) {
    const c = this.ctx;
    const o = c.createOscillator();
    const f0 = vint ? 120 : 160 + 40 * v;
    o.frequency.setValueAtTime(f0, when);
    o.frequency.exponentialRampToValueAtTime(vint ? 52 : 46, when + 0.09);
    const g = this.g(0, when);
    g.gain.linearRampToValueAtTime(1.1 * (0.3 + 0.7 * v), when + 0.002);
    g.gain.setTargetAtTime(0, when + 0.01, vint ? 0.11 : 0.16);
    o.connect(g); o.start(when); o.stop(when + 1);
    // beater click
    const n = this.noiseSrc(when, 0.02);
    const hp = this.filt('highpass', 2500);
    const cg = this.g(0.25 * v, when);
    cg.gain.setTargetAtTime(0, when, 0.004);
    n.connect(hp).connect(cg);
  }

  private snare(v: number, when: number, vint: boolean) {
    const c = this.ctx;
    [185, 330].forEach((f, i) => {
      const o = c.createOscillator(); o.type = 'triangle';
      o.frequency.setValueAtTime(f * 1.15, when);
      o.frequency.exponentialRampToValueAtTime(f, when + 0.02);
      const g = this.g(0, when);
      g.gain.linearRampToValueAtTime((i ? 0.25 : 0.45) * v, when + 0.002);
      g.gain.setTargetAtTime(0, when + 0.003, 0.045);
      o.connect(g); o.start(when); o.stop(when + 0.4);
    });
    const n = this.noiseSrc(when, 0.45);
    const bp = this.filt('bandpass', vint ? 3200 : 4200 + 2000 * v, 0.6);
    const hp = this.filt('highpass', 900);
    const g = this.g(0, when);
    g.gain.linearRampToValueAtTime(0.75 * (0.2 + 0.8 * v), when + 0.001);
    g.gain.setTargetAtTime(0, when + 0.002, vint ? 0.06 : 0.075 + 0.03 * v);
    n.connect(hp).connect(bp).connect(g);
  }

  private metal(when: number, dur: number, base: number, dest: AudioNode) {
    const c = this.ctx;
    const ratios = [2, 3, 4.16, 5.43, 6.79, 8.21];
    for (const r of ratios) {
      const o = c.createOscillator(); o.type = 'square';
      o.frequency.value = base * r;
      o.connect(dest); o.start(when); o.stop(when + dur);
    }
  }

  private hat(v: number, when: number, decay: number, vint: boolean, open = false) {
    this.chokeHat(when);
    const g = this.g(0, when);
    g.gain.linearRampToValueAtTime(0.35 * (0.25 + 0.75 * v), when + 0.001);
    g.gain.setTargetAtTime(0, when + 0.002, decay * (open ? 0.6 : 1));
    const hp = this.filt('highpass', vint ? 6000 : 7500);
    const bp = this.filt('bandpass', 10000, 0.8);
    const mg = this.ctx.createGain(); mg.gain.value = 0.18;
    this.metal(when, open ? 2 : 0.4, 40, mg);
    mg.connect(bp);
    const n = this.noiseSrc(when, open ? 2 : 0.4);
    const ng = this.ctx.createGain(); ng.gain.value = 0.7;
    n.connect(ng).connect(bp);
    bp.connect(hp).connect(g);
    if (open) this.openHat = { g, t: when };
  }

  private cymbal(v: number, when: number, decay: number, hpF: number, vint: boolean) {
    const g = this.g(0, when);
    g.gain.linearRampToValueAtTime(0.45 * (0.3 + 0.7 * v), when + 0.002);
    g.gain.setTargetAtTime(0.18 * v, when + 0.002, 0.08);
    g.gain.setTargetAtTime(0, when + 0.1, decay * 0.45);
    const hp = this.filt('highpass', vint ? hpF * 0.8 : hpF);
    const lp = this.filt('lowpass', vint ? 9000 : 14000);
    const n = this.noiseSrc(when, decay * 3.5);
    n.connect(hp);
    const mg = this.ctx.createGain(); mg.gain.value = 0.12;
    this.metal(when, decay * 3.5, 63, mg);
    mg.connect(hp);
    hp.connect(lp).connect(g);
  }

  private ride(v: number, when: number, vint: boolean) {
    const g = this.g(0, when);
    g.gain.linearRampToValueAtTime(0.3 * (0.3 + 0.7 * v), when + 0.002);
    g.gain.setTargetAtTime(0, when + 0.003, vint ? 0.5 : 0.7);
    const bp = this.filt('bandpass', 5200, 1.2);
    const mg = this.ctx.createGain(); mg.gain.value = 0.22;
    this.metal(when, 3, 72, mg);
    mg.connect(bp).connect(g);
    // bell ping
    const o = this.ctx.createOscillator(); o.frequency.value = 3150;
    const pg = this.g(0.07 * v, when);
    pg.gain.setTargetAtTime(0, when, 0.25);
    o.connect(pg); o.start(when); o.stop(when + 1.5);
    const n = this.noiseSrc(when, 0.3);
    const ng = this.g(0.12 * v, when);
    ng.gain.setTargetAtTime(0, when, 0.03);
    n.connect(this.filt('highpass', 6000)).connect(ng);
  }

  private tom(v: number, when: number, f: number) {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(f * 1.6, when);
    o.frequency.exponentialRampToValueAtTime(f, when + 0.06);
    const g = this.g(0, when);
    g.gain.linearRampToValueAtTime(0.85 * (0.3 + 0.7 * v), when + 0.002);
    g.gain.setTargetAtTime(0, when + 0.005, 0.12 + 40 / f * 0.1);
    o.connect(g); o.start(when); o.stop(when + 1.2);
    const n = this.noiseSrc(when, 0.1);
    const ng = this.g(0.2 * v, when);
    ng.gain.setTargetAtTime(0, when, 0.02);
    n.connect(this.filt('bandpass', f * 6, 0.8)).connect(ng);
  }

  private membrane(v: number, when: number, f: number, decay: number, noiseAmt: number) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(f * 1.12, when);
    o.frequency.exponentialRampToValueAtTime(f, when + 0.03);
    const o2 = c.createOscillator(); o2.frequency.value = f * 1.59; // second membrane mode
    const g = this.g(0, when);
    g.gain.linearRampToValueAtTime(0.75 * (0.25 + 0.75 * v), when + 0.0015);
    g.gain.setTargetAtTime(0, when + 0.002, decay / 3);
    const g2 = c.createGain(); g2.gain.value = 0.25;
    o.connect(g); o2.connect(g2).connect(g);
    o.start(when); o.stop(when + decay * 4); o2.start(when); o2.stop(when + decay * 4);
    if (noiseAmt > 0) {
      const n = this.noiseSrc(when, 0.04);
      const ng = this.g(noiseAmt * v, when);
      ng.gain.setTargetAtTime(0, when, 0.006);
      n.connect(this.filt('bandpass', f * 5, 1)).connect(ng);
    }
  }

  private slap(v: number, when: number) {
    this.membrane(v * 0.7, when, 410, 0.06, 0);
    const n = this.noiseSrc(when, 0.15);
    const g = this.g(0, when);
    g.gain.linearRampToValueAtTime(0.7 * v, when + 0.001);
    g.gain.setTargetAtTime(0, when + 0.002, 0.025);
    n.connect(this.filt('bandpass', 1900, 1.4)).connect(g);
  }

  private tambourine(v: number, when: number) {
    for (let i = 0; i < 3; i++) {
      const t = when + i * 0.011 + Math.random() * 0.003;
      const n = this.noiseSrc(t, 0.4);
      const g = this.g(0, t);
      g.gain.linearRampToValueAtTime((i === 0 ? 0.5 : 0.3) * v, t + 0.001);
      g.gain.setTargetAtTime(0, t + 0.002, i === 2 ? 0.09 : 0.03);
      n.connect(this.filt('bandpass', 8200, 2.2)).connect(g);
    }
    const mg = this.ctx.createGain(); mg.gain.value = 0.05 * v;
    const g = this.g(1, when);
    g.gain.setTargetAtTime(0, when, 0.08);
    this.metal(when, 0.5, 260, mg);
    mg.connect(this.filt('highpass', 6000)).connect(g);
  }

  private clap(v: number, when: number) {
    for (let i = 0; i < 4; i++) {
      const t = when + i * 0.009;
      const n = this.noiseSrc(t, i === 3 ? 0.4 : 0.02);
      const g = this.g(0, t);
      g.gain.linearRampToValueAtTime(0.6 * v, t + 0.001);
      g.gain.setTargetAtTime(0, t + 0.002, i === 3 ? 0.06 : 0.006);
      n.connect(this.filt('bandpass', 1150, 1.1)).connect(this.filt('highpass', 600)).connect(g);
    }
  }

  private shaker(v: number, when: number) {
    const n = this.noiseSrc(when, 0.2);
    const g = this.g(0, when);
    g.gain.linearRampToValueAtTime(0.32 * v, when + 0.018);
    g.gain.setTargetAtTime(0, when + 0.02, 0.025);
    n.connect(this.filt('highpass', 5500)).connect(this.filt('lowpass', 12000)).connect(g);
  }

  private cowbell(v: number, when: number) {
    const bp = this.filt('bandpass', 820, 2.5);
    const g = this.g(0, when);
    g.gain.linearRampToValueAtTime(0.5 * v, when + 0.001);
    g.gain.setTargetAtTime(0.12 * v, when + 0.002, 0.02);
    g.gain.setTargetAtTime(0, when + 0.05, 0.12);
    for (const f of [562, 845]) {
      const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.value = f;
      o.connect(bp); o.start(when); o.stop(when + 0.8);
    }
    bp.connect(g);
  }

  private zap(v: number, when: number) {
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(1800, when);
    o.frequency.exponentialRampToValueAtTime(90, when + 0.18);
    const g = this.g(0, when);
    g.gain.linearRampToValueAtTime(0.5 * v, when + 0.002);
    g.gain.setTargetAtTime(0, when + 0.05, 0.05);
    o.connect(g); o.start(when); o.stop(when + 0.5);
  }
}
