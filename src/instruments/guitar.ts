import { settings } from '../lib/settings';
import { PROGRESSIONS, chordMidi } from '../lib/music';
import { engine } from '../audio/engine';
import { GuitarInstrument } from '../audio/instruments/guitar';
import { playBus } from '../lib/events';
import type { HandLabel, TrackFrame } from '../tracking/tracker';
import { fromReach, strikeThreshold, toReach } from '../tracking/tracker';
import { Debounce, StrumDetector, speedToVelocity } from '../tracking/gestures';
import { C, type Controller, rr } from './common';

export function guitarChords(): string[] {
  const s = settings.get().guitar;
  return s.progression === 'custom' ? s.custom : PROGRESSIONS[s.progression]?.chords ?? PROGRESSIONS.pop.chords;
}

export class GuitarController implements Controller {
  readonly inst = 'guitar' as const;
  private gtr: GuitarInstrument;
  private strum = new StrumDetector();
  private fist = new Debounce(70, 120);
  private pinch = new Debounce(50, 100);
  private chordIdx = 0;
  private lastStrum = { t: -1e9, dir: 'down' as 'down' | 'up', muted: false, v: 0 };
  private targets: string[] = [];
  private fretSeen = 0;

  constructor() {
    this.gtr = new GuitarInstrument(engine.ctx!, engine.instFx.input, settings.get().guitar.preset);
  }

  load(p?: (f: number) => void) { return this.gtr.load(p); }

  private roles(): { fret: HandLabel; strum: HandLabel } {
    return settings.get().guitar.lefty ? { fret: 'Right', strum: 'Left' } : { fret: 'Left', strum: 'Right' };
  }

  get chord() { const c = guitarChords(); return c[Math.min(this.chordIdx, c.length - 1)]; }

  update(f: TrackFrame, now: number) {
    const s = settings.get().guitar;
    if (s.preset !== this.gtr.preset) { this.gtr.setPreset(s.preset); this.gtr.load(); }
    const chords = guitarChords();
    const { fret, strum } = this.roles();
    const fh = f[fret];
    if (fh) {
      this.fretSeen = now;
      if (s.chordSelect === 'height') {
        const y = Math.max(0, Math.min(0.999, toReach(fh.palm).y));
        this.chordIdx = Math.floor(y * chords.length);
      } else {
        const was = this.pinch.value;
        if (this.pinch.update(fh.pinch, now) && !was) this.chordIdx = (this.chordIdx + 1) % chords.length;
      }
    }
    if (this.chordIdx >= chords.length) this.chordIdx = 0;
    const sh = f[strum];
    if (!sh) return;
    const muted = this.fist.update(sh.fist, now);
    const thr = strikeThreshold() * (1.25 - s.strumSens / 100 * 0.6);
    const st = this.strum.update(sh, now, thr);
    if (st) {
      const v = speedToVelocity(st.speed, thr, 70) * (st.dir === 'up' ? 0.85 : 1);
      const chord = this.chord;
      this.gtr.strum(chord, st.dir, v, engine.now, muted, st.speed / thr);
      this.lastStrum = { t: now, dir: st.dir, muted, v };
      playBus.emit({ t: engine.now, inst: 'guitar', kind: 'strum', chord, dir: st.dir, muted, vel: v, notes: chordMidi(chord).filter((n) => n >= 0), hand: strum, preset: s.preset });
    }
  }

  draw(g: CanvasRenderingContext2D, w: number, h: number, now: number) {
    const chords = guitarChords();
    const s = settings.get().guitar;
    const lefty = s.lefty;
    const r0 = fromReach({ x: 0, y: 0 }), r1 = fromReach({ x: 1, y: 1 });
    // chord column on fretting side
    const colX0 = (lefty ? r0.x + (r1.x - r0.x) * 0.68 : r0.x) * w;
    const colW = (r1.x - r0.x) * 0.32 * w;
    const top = r0.y * h, bot = r1.y * h;
    const sh = (bot - top) / chords.length;
    chords.forEach((c, i) => {
      const y = top + i * sh;
      const active = i === this.chordIdx;
      const isT = this.targets.includes(c);
      rr(g, colX0 + 3, y + 3, colW - 6, sh - 6, 5);
      g.fillStyle = active ? 'rgba(214,138,72,0.42)' : 'rgba(21,21,21,0.45)';
      g.fill();
      g.lineWidth = isT ? 3 : 1;
      g.strokeStyle = isT ? C.green : active ? C.accent : 'rgba(242,240,234,0.25)';
      g.stroke();
      g.fillStyle = isT ? C.green : C.text;
      g.font = `600 ${Math.max(14, Math.min(28, sh / 3))}px Inter, system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(c, colX0 + colW / 2, y + sh / 2);
      g.font = '500 10px Inter, system-ui, sans-serif';
      g.fillStyle = C.text2;
      if (s.chordSelect === 'height') g.fillText(`slot ${i + 1}`, colX0 + colW / 2, y + sh / 2 + Math.min(22, sh / 3));
      g.textBaseline = 'alphabetic';
    });
    // strings in the strum zone
    const sx0 = (lefty ? r0.x : r0.x + (r1.x - r0.x) * 0.42) * w;
    const sx1 = (lefty ? r0.x + (r1.x - r0.x) * 0.58 : r1.x) * w;
    const midY = (top + bot) / 2;
    const age = (now - this.lastStrum.t) / 1000;
    for (let i = 0; i < 6; i++) {
      const y = midY - 75 + i * 30;
      const amp = age < 1.2 && !this.lastStrum.muted ? 5 * this.lastStrum.v * Math.exp(-age * 4) : 0;
      g.strokeStyle = i < 3 ? 'rgba(214,190,150,0.75)' : 'rgba(242,240,234,0.6)';
      g.lineWidth = 3 - i * 0.35;
      g.beginPath();
      for (let x = sx0; x <= sx1; x += 8) {
        const k = (x - sx0) / (sx1 - sx0);
        g.lineTo(x, y + amp * Math.sin(k * Math.PI) * Math.sin(now / 18 + i));
      }
      g.stroke();
    }
    g.font = '600 12px Inter, system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillStyle = C.text2;
    g.fillText('STRUM ZONE — swing your hand down or up through the strings', (sx0 + sx1) / 2, midY - 100);
    if (age < 0.4) {
      g.fillStyle = C.accent;
      g.font = '600 13px Inter, system-ui, sans-serif';
      g.fillText(`${this.lastStrum.dir === 'down' ? '↓ DOWN' : '↑ UP'}${this.lastStrum.muted ? ' · MUTED' : ''}`, (sx0 + sx1) / 2, midY + 110);
    }
    if (now - this.fretSeen > 800) {
      g.fillStyle = C.text2;
      g.font = '500 11px Inter, system-ui, sans-serif';
      g.fillText(`Show your ${this.roles().fret.toLowerCase()} hand to choose chords`, colX0 + colW / 2, bot + 0 - 6);
    }
  }

  setTargets(k: string[]) { this.targets = k; }
  label(k: string) { return k; }
  readout() { return this.chord; }
  panic() { this.gtr.damp(); }
  dispose() { this.gtr.damp(); }
}
