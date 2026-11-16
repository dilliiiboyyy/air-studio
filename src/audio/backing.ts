import { engine } from './engine';
import { transport } from './transport';
import { DrumKit } from './instruments/drums';
import { GuitarInstrument } from './instruments/guitar';
import { PianoInstrument, type Voice } from './instruments/piano';
import { BANKS } from './samples';
import { NOTE_NAMES, midiToFreq, CHORD_SHAPES } from '../lib/music';
import { settings } from '../lib/settings';

/**
 * Backing styles. Patterns are one bar of steps (16 for 4/4, 12 for 3/4).
 * Drums: 'x' hit, 'o' soft hit.  Bass: R root, 3 third, 5 fifth, 6 sixth, 7 flat-7, 8 octave, W walking.
 * Comp: x stab, h hold bar, a arpeggio note, d/u guitar down/up strum.
 */
export interface BackingStyle {
  id: string; label: string; genre: string; desc: string; bpm: number; sig: '4/4' | '3/4'; swing: number;
  chords: string[]; drums?: 'acoustic' | 'electronic'; pattern: Record<string, string>;
  bass?: string; comp?: { inst: 'piano' | 'electric' | 'organ' | 'pad' | 'guitar'; pat: string };
}

export const BACKING_STYLES: BackingStyle[] = [
  {
    id: 'pop', label: 'Sunday Drive', genre: 'Pop', desc: 'Bright pop groove, C–G–Am–F', bpm: 100, sig: '4/4', swing: 0,
    chords: ['C', 'G', 'Am', 'F'], drums: 'acoustic',
    pattern: { kick: 'x-----x-x-------', snare: '----x-------x---', hhc: 'x-o-x-o-x-o-x-o-' },
    bass: 'R-----R-R---5---', comp: { inst: 'piano', pat: 'x-----x---x---x-' },
  },
  {
    id: 'rock', label: 'Garage Drive', genre: 'Rock', desc: 'Driving rock with distorted guitar, A–D–E–D', bpm: 124, sig: '4/4', swing: 0,
    chords: ['A5', 'D5', 'E5', 'D5'], drums: 'acoustic',
    pattern: { kick: 'x-----x-x-x-----', snare: '----x-------x---', hhc: 'x-x-x-x-x-x-x-x-', crash: 'x---------------' },
    bass: 'R-R-R-R-R-R-R-R-', comp: { inst: 'guitar', pat: 'd-d-d-d-d-d-d-d-' },
  },
  {
    id: 'jazz', label: 'Late Set', genre: 'Jazz', desc: 'Swinging ii–V–I with walking bass', bpm: 132, sig: '4/4', swing: 0.33,
    chords: ['Dm7', 'G7', 'Cmaj7', 'A7'], drums: 'acoustic',
    pattern: { ride: 'x---x-x-x---x-x-', hhc: '----x-------x---', kick: 'o---------------' },
    bass: 'W---W---W---W---', comp: { inst: 'electric', pat: '------x-----x---' },
  },
  {
    id: 'blues', label: 'Twelve Bar Shuffle', genre: 'Blues', desc: '12-bar shuffle in A', bpm: 92, sig: '4/4', swing: 0.33,
    chords: ['A7', 'A7', 'A7', 'A7', 'D7', 'D7', 'A7', 'A7', 'E7', 'D7', 'A7', 'E7'], drums: 'acoustic',
    pattern: { kick: 'x-------x-------', snare: '----x-------x---', ride: 'x-x-x-x-x-x-x-x-' },
    bass: 'R-3-5-6-8-6-5-3-', comp: { inst: 'piano', pat: '--x---x---x---x-' },
  },
  {
    id: 'electronic', label: 'Night Drive', genre: 'Electronic', desc: 'Four-on-the-floor 808 with pads', bpm: 124, sig: '4/4', swing: 0,
    chords: ['Am', 'F', 'C', 'G'], drums: 'electronic',
    pattern: { kick: 'x---x---x---x---', clap: '----x-------x---', hho: '--x---x---x---x-', hhc: 'x-x-x-x-x-x-x-x-' },
    bass: '--R---R---R---R-', comp: { inst: 'pad', pat: 'h---------------' },
  },
  {
    id: 'classical', label: 'Canon Study', genre: 'Classical', desc: 'Arpeggiated 3/4 piano, cello-style bass', bpm: 84, sig: '3/4', swing: 0,
    chords: ['C', 'G', 'Am', 'Em', 'F', 'C', 'F', 'G'],
    pattern: {}, bass: 'R-----------', comp: { inst: 'piano', pat: 'a-a-a-a-a-a-' },
  },
  {
    id: 'hiphop', label: 'Boom Bap', genre: 'Hip-hop', desc: 'Laid-back boom bap, Am7–Dm7–Fmaj7–E7', bpm: 88, sig: '4/4', swing: 0.18,
    chords: ['Am7', 'Dm7', 'Fmaj7', 'E7'], drums: 'acoustic',
    pattern: { kick: 'x-------x-x-----', snare: '----x-------x---', hhc: 'x-o-x-o-x-o-x-oo' },
    bass: 'R------R--R-----', comp: { inst: 'electric', pat: 'x-------x-------' },
  },
  {
    id: 'ambient', label: 'Still Water', genre: 'Ambient', desc: 'Slow evolving pads, no drums', bpm: 64, sig: '4/4', swing: 0,
    chords: ['Cmaj7', 'Am7', 'Fmaj7', 'G'],
    pattern: {}, bass: 'R---------------', comp: { inst: 'pad', pat: 'h---------------' },
  },
];

const QUAL: [string, number[]][] = [
  ['maj7', [0, 4, 7, 11]], ['m7', [0, 3, 7, 10]], ['7', [0, 4, 7, 10]], ['sus4', [0, 5, 7]], ['sus2', [0, 2, 7]],
  ['5', [0, 7, 12]], ['m', [0, 3, 7]], ['', [0, 4, 7]],
];

export function parseChord(sym: string): { root: number; tones: number[] } {
  const m = /^([A-G])(#|b)?(.*)$/.exec(sym)!;
  let root = NOTE_NAMES.indexOf(m[1]);
  if (m[2] === '#') root++;
  if (m[2] === 'b') root--;
  root = (root + 12) % 12;
  const q = QUAL.find(([k]) => m[3] === k) ?? QUAL[QUAL.length - 1];
  return { root, tones: q[1] };
}

function voice(root: number, tones: number[], center = 60): number[] {
  return tones.map((t) => {
    let n = root + t + 48;
    while (n < center - 6) n += 12;
    while (n > center + 7) n -= 12;
    return n;
  }).sort((a, b) => a - b);
}

/** Procedural backing band that follows the shared transport. */
class BackingBand {
  style: BackingStyle = BACKING_STYLES.find((b) => b.id === settings.get().backing.style) ?? BACKING_STYLES[0];
  playing = false;
  private drums: DrumKit | null = null;
  private keys: PianoInstrument | null = null;
  private guitar: GuitarInstrument | null = null;
  private held: Voice[] = [];
  private unsub: (() => void) | null = null;
  private listeners = new Set<() => void>();
  private arpIdx = 0;
  stopAtStep = Infinity;

  onChange(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit() { this.listeners.forEach((f) => f()); }

  select(id: string) {
    const s = BACKING_STYLES.find((b) => b.id === id);
    if (!s) return;
    this.style = s;
    settings.update('backing', { style: id });
    settings.update('metronome', { bpm: s.bpm, sig: s.sig });
    this.emit();
  }

  async prepare() {
    const ctx = await engine.ensure();
    const out = engine.backingFx.input;
    if (!this.drums) this.drums = new DrumKit(ctx, out, 'acoustic');
    if (!this.keys) this.keys = new PianoInstrument(ctx, out, 'acoustic');
    if (!this.guitar) this.guitar = new GuitarInstrument(ctx, out, 'distorted');
    const st = this.style;
    await Promise.all([
      this.drums.setPack(st.drums === 'electronic' ? 'electronic' : 'acoustic'),
      BANKS.bass.load(),
      st.comp?.inst === 'piano' ? this.keys.load() : Promise.resolve(),
      st.comp?.inst === 'guitar' ? this.guitar.load() : Promise.resolve(),
    ]);
    this.keys.setPreset(st.comp?.inst === 'electric' ? 'electric' : st.comp?.inst === 'organ' ? 'organ' : 'acoustic');
  }

  /** Attach to the transport. Call before transport.start(). */
  async attach() {
    await this.prepare();
    this.unsub?.();
    this.playing = true;
    this.arpIdx = 0;
    this.unsub = transport.onStep((step, time, sd) => this.onStep(step, time, sd));
    this.emit();
  }

  detach() {
    this.unsub?.();
    this.unsub = null;
    this.playing = false;
    const t = engine.now;
    this.held.forEach((v) => v.stop(t));
    this.held = [];
    this.guitar?.damp(t);
    this.emit();
  }

  private onStep(step: number, time: number, sd: number) {
    if (step < 0) return;
    const st = this.style;
    const spb = st.sig === '3/4' ? 12 : 16;
    const loopBars = st.chords.length;
    const bar = Math.floor(step / spb);
    if (!settings.get().backing.loop && bar >= loopBars) return;
    const i = step % spb;
    const chord = st.chords[bar % loopBars];
    const { root, tones } = parseChord(chord);
    // swing: delay off-beat 8ths (odd 8th = step%4==2)
    let t = time;
    if (st.swing > 0 && i % 4 === 2) t += st.swing * sd * 2 * 0.5;
    const ch = (s: string | undefined) => (s ? s[i] : '-');

    if (this.drums) {
      for (const [piece, pat] of Object.entries(st.pattern)) {
        const c = ch(pat);
        if (c === 'x' || c === 'o') this.drums.play(piece === 'clap' ? (st.drums === 'electronic' ? 'eClap' : 'clap') : piece, (c === 'x' ? 0.85 : 0.45) * (0.92 + Math.random() * 0.08), t);
      }
    }

    const b = ch(st.bass);
    if (b !== '-') {
      const bassRoot = 28 + ((root - 4 + 12) % 12);
      const steps: Record<string, number> = { R: 0, '3': tones[1], '5': 7, '6': 9, '7': 10, '8': 12 };
      let n = bassRoot + (steps[b] ?? 0);
      if (b === 'W') {
        const beat = Math.floor(i / 4);
        const nextRoot = 28 + ((parseChord(st.chords[(bar + 1) % loopBars]).root - 4 + 12) % 12);
        n = [bassRoot, bassRoot + tones[1], bassRoot + 7, nextRoot + (nextRoot > bassRoot + 7 ? -1 : 1)][beat];
      }
      const len = b === 'R' && st.bass!.replace(/-/g, '').length === 1 ? sd * spb * 0.95 : sd * 3.2;
      this.bassNote(n, 0.8, t, len);
    }

    const comp = st.comp;
    const cc = comp ? ch(comp.pat) : '-';
    if (comp && cc !== '-') {
      const notes = voice(root, tones, comp.inst === 'pad' ? 62 : 64);
      if (comp.inst === 'guitar' && this.guitar) {
        if (CHORD_SHAPES[chord]) this.guitar.strum(chord, cc === 'u' ? 'up' : 'down', 0.55, t, true, 1.5);
      } else if (comp.inst === 'pad') {
        this.pad(notes, t, sd * spb);
      } else if (this.keys) {
        if (cc === 'a') {
          const arp = [notes[0] - 12, ...notes, notes[1] + 12];
          const pattern = [0, 1, 2, 3, 2, 1];
          const n = arp[Math.min(arp.length - 1, pattern[this.arpIdx++ % pattern.length])];
          const v = this.keys.noteOn(n, 0.45, t);
          v.stop(t + sd * 3);
        } else {
          let nextHit = 1;
          while (nextHit < spb && comp.pat[(i + nextHit) % spb] === '-') nextHit++;
          const dur = cc === 'h' ? sd * spb : Math.min(sd * nextHit, sd * 6) * 0.9;
          notes.forEach((n) => { const v = this.keys!.noteOn(n, 0.42, t); v.stop(t + dur); });
        }
      }
    }
  }

  private bassNote(midi: number, vel: number, when: number, dur: number) {
    const p = BANKS.bass.pick(midi);
    const ctx = engine.ctx!;
    if (!p) return;
    const s = ctx.createBufferSource();
    s.buffer = p.buffer;
    s.playbackRate.value = p.rate;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel * 0.95, when);
    g.gain.setTargetAtTime(0, when + dur, 0.04);
    s.connect(g).connect(engine.backingFx.input);
    s.start(when);
    s.stop(when + dur + 0.4);
  }

  private pad(notes: number[], when: number, dur: number) {
    const ctx = engine.ctx!;
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.09, when + Math.min(0.6, dur * 0.3));
    g.gain.setValueAtTime(0.09, when + dur - 0.05);
    g.gain.setTargetAtTime(0, when + dur - 0.05, 0.35);
    lp.connect(g).connect(engine.backingFx.input);
    for (const n of notes) for (const d of [-9, 9]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = midiToFreq(n);
      o.detune.value = d;
      o.connect(lp);
      o.start(when);
      o.stop(when + dur + 2);
    }
  }
}

export const backing = new BackingBand();
