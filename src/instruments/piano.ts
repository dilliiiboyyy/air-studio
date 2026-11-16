import { settings } from '../lib/settings';
import { scaleNotes, noteName, diatonicTriad, isBlack, uid } from '../lib/music';
import { engine } from '../audio/engine';
import { PianoInstrument, type Voice } from '../audio/instruments/piano';
import { playBus } from '../lib/events';
import type { Hand, HandLabel, TrackFrame } from '../tracking/tracker';
import { fromReach, strikeThreshold, toReach } from '../tracking/tracker';
import { Debounce, StrikeDetector, speedToVelocity } from '../tracking/gestures';
import { C, type Controller, rr } from './common';

interface Press { zone: number; voices: Voice[]; id: string; t: number; vel: number }

export function pianoNotes(): number[] {
  const s = settings.get().piano;
  const base = 12 * (s.octave + 1) + s.key;
  if (s.level === 'beginner') return scaleNotes(s.key, s.scale === 'chromatic' ? 'major' : s.scale, base, base + 12);
  return scaleNotes(s.key, s.scale, base, base + 12 * s.octaves);
}

export class PianoController implements Controller {
  readonly inst = 'piano' as const;
  private piano: PianoInstrument;
  private notes: number[] = [];
  private press: Record<HandLabel, Press | null> = { Left: null, Right: null };
  private lastSeen: Record<HandLabel, number> = { Left: 0, Right: 0 };
  private strike = { Left: new StrikeDetector(90), Right: new StrikeDetector(90) };
  private fist = { Left: new Debounce(), Right: new Debounce() };
  private pinch = { Left: new Debounce(60, 120), Right: new Debounce(60, 120) };
  private sustained: { voices: Voice[]; id: string }[] = [];
  private sustainOn = false;
  private targets: string[] = [];
  private flashes = new Map<number, number>();
  private current = '';
  private sig = '';

  constructor() {
    this.piano = new PianoInstrument(engine.ctx!, engine.instFx.input, settings.get().piano.preset);
    this.sync();
  }

  load(p?: (f: number) => void) { return this.piano.load(p); }

  private sync() {
    const s = settings.get().piano;
    const sig = [s.level, s.octave, s.octaves, s.scale, s.key].join('|');
    if (sig !== this.sig) { this.sig = sig; this.panic(); this.notes = pianoNotes(); }
    if (s.preset !== this.piano.preset) { this.piano.setPreset(s.preset); this.piano.load(); }
  }

  private zoneAt(x: number): number {
    const r = toReach({ x, y: 0 }).x;
    return Math.max(0, Math.min(this.notes.length - 1, Math.floor(r * this.notes.length)));
  }

  private chordFor(m: number): number[] {
    const s = settings.get().piano;
    if (s.chordAssist === 'triad') return diatonicTriad(m, s.key, s.scale === 'chromatic' ? 'major' : s.scale);
    if (s.chordAssist === 'power') return [m, m + 7, m + 12];
    return [m];
  }

  private noteOn(label: HandLabel, zone: number, vel: number, now: number) {
    const m = this.notes[zone];
    const notes = this.chordFor(m);
    const id = uid();
    const voices = notes.map((n) => this.piano.noteOn(n, vel));
    this.press[label] = { zone, voices, id, t: now, vel };
    this.flashes.set(zone, now);
    this.current = notes.length > 1 ? notes.map(noteName).join(' ') : noteName(m);
    playBus.emit({ t: engine.now, inst: 'piano', kind: 'note', midi: m, notes, vel, id, hand: label, preset: this.piano.preset });
  }

  private noteOff(label: HandLabel) {
    const p = this.press[label];
    if (!p) return;
    this.press[label] = null;
    if (this.sustainOn) { this.sustained.push({ voices: p.voices, id: p.id }); return; }
    const t = engine.now;
    p.voices.forEach((v) => v.stop(t));
    playBus.emitRelease({ id: p.id, t });
  }

  private releaseSustain() {
    const t = engine.now;
    for (const s of this.sustained) { s.voices.forEach((v) => v.stop(t)); playBus.emitRelease({ id: s.id, t }); }
    this.sustained = [];
  }

  update(f: TrackFrame, now: number) {
    this.sync();
    const s = settings.get().piano;
    const lineY = fromReach({ x: 0, y: s.lineY }).y;
    const margin = 0.008 + (1 - s.noteSens / 100) * 0.03;
    const thr = strikeThreshold();

    // sustain gesture
    let sus = false;
    for (const h of f.hands) {
      const fist = this.fist[h.label].update(h.fist, now);
      const pinch = this.pinch[h.label].update(h.pinch, now);
      if ((s.sustain === 'leftFist' && h.label === 'Left' && fist) || (s.sustain === 'rightFist' && h.label === 'Right' && fist) || (s.sustain === 'pinch' && pinch)) sus = true;
    }
    if (sus !== this.sustainOn) { this.sustainOn = sus; if (!sus) this.releaseSustain(); }

    for (const label of ['Left', 'Right'] as HandLabel[]) {
      const h: Hand | null = f[label];
      if (!h) {
        // grace period for brief detection drop-outs, then release
        if (this.press[label] && now - this.lastSeen[label] > 160) this.noteOff(label);
        continue;
      }
      this.lastSeen[label] = now;
      const isSustainHand = (s.sustain === 'leftFist' && label === 'Left') || (s.sustain === 'rightFist' && label === 'Right');
      if (isSustainHand && this.fist[label].value) { this.noteOff(label); continue; }
      const zone = this.zoneAt(h.tip.x);
      const p = this.press[label];
      if (s.activation === 'line') {
        const below = h.tip.y > lineY + margin;
        const above = h.tip.y < lineY - margin;
        if (!p && below && !h.fresh && h.tipVel.y > thr * 0.15) {
          this.noteOn(label, zone, speedToVelocity(h.tipVel.y, thr * 0.6, s.velocitySens), now);
        } else if (p && above) this.noteOff(label);
        else if (p && s.glide && zone !== p.zone && h.tip.y > lineY) {
          const v = p.vel * 0.85;
          this.noteOff(label);
          this.noteOn(label, zone, v, now);
        }
      } else {
        const hit = this.strike[label].update(h, now, thr * 0.8, true);
        if (hit) {
          if (p) this.noteOff(label);
          this.noteOn(label, this.zoneAt(hit.at.x), speedToVelocity(hit.vel, thr * 0.8, s.velocitySens), now);
        } else if (p && (h.tipVel.y < -thr * 0.5 || now - p.t > 1500)) this.noteOff(label);
      }
    }
  }

  draw(g: CanvasRenderingContext2D, w: number, h: number, now: number) {
    const s = settings.get().piano;
    const r0 = fromReach({ x: 0, y: 0 }), r1 = fromReach({ x: 1, y: 1 });
    const x0 = r0.x * w, x1 = r1.x * w;
    const lineY = fromReach({ x: 0, y: s.lineY }).y * h;
    const bottom = Math.min(h - 6, r1.y * h);
    const n = this.notes.length;
    const zw = (x1 - x0) / n;
    const active = new Set<number>();
    for (const p of [this.press.Left, this.press.Right]) if (p) active.add(p.zone);
    const targetMidis = new Set(this.targets.map(Number));
    for (let i = 0; i < n; i++) {
      const m = this.notes[i];
      const x = x0 + i * zw;
      const black = isBlack(m);
      const fl = this.flashes.get(i);
      const age = fl ? (now - fl) / 1000 : 9;
      const top = s.activation === 'line' ? lineY : h * 0.62;
      // key body
      rr(g, x + 2, top, zw - 4, bottom - top, 4);
      g.fillStyle = black ? 'rgba(12,12,12,0.72)' : 'rgba(242,240,234,0.13)';
      g.fill();
      if (active.has(i)) { g.fillStyle = 'rgba(214,138,72,0.55)'; g.fill(); }
      else if (age < 0.3) { g.fillStyle = `rgba(214,138,72,${(0.4 * (1 - age / 0.3)).toFixed(3)})`; g.fill(); }
      const isT = targetMidis.has(m);
      g.lineWidth = isT ? 3 : 1;
      g.strokeStyle = isT ? C.green : 'rgba(242,240,234,0.25)';
      g.stroke();
      // column guide above the line
      g.fillStyle = 'rgba(242,240,234,0.035)';
      if (i % 2 === 0) g.fillRect(x, r0.y * h, zw, top - r0.y * h);
      // label
      g.textAlign = 'center';
      g.fillStyle = isT ? C.green : active.has(i) ? C.text : black ? C.text2 : C.text;
      g.font = `600 ${Math.max(10, Math.min(15, zw / 3.2))}px Inter, system-ui, sans-serif`;
      g.fillText(noteName(m), x + zw / 2, bottom - 12);
      if (isT) { g.font = '600 10px Inter, system-ui, sans-serif'; g.fillText('PLAY', x + zw / 2, top + 18); }
    }
    if (s.activation === 'line') {
      g.strokeStyle = 'rgba(214,138,72,0.7)';
      g.setLineDash([6, 6]);
      g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(x0, lineY); g.lineTo(x1, lineY); g.stroke();
      g.setLineDash([]);
      g.font = '500 11px Inter, system-ui, sans-serif';
      g.fillStyle = C.text2;
      g.textAlign = 'left';
      g.fillText('KEY LINE — dip your index finger below to play', x0 + 4, lineY - 8);
    } else {
      g.font = '500 11px Inter, system-ui, sans-serif';
      g.fillStyle = C.text2;
      g.textAlign = 'left';
      g.fillText('TAP MODE — tap down with your index finger above a key', x0 + 4, h * 0.62 - 8);
    }
    if (this.sustainOn) {
      g.fillStyle = C.accent;
      g.font = '600 12px Inter, system-ui, sans-serif';
      g.textAlign = 'right';
      g.fillText('SUSTAIN', x1 - 4, r0.y * h + 16);
    }
  }

  setTargets(k: string[]) { this.targets = k; }
  label(k: string) { return noteName(Number(k)); }
  readout() { return this.current; }
  panic() {
    const t = engine.now;
    for (const l of ['Left', 'Right'] as HandLabel[]) {
      const p = this.press[l];
      if (p) { p.voices.forEach((v) => v.stop(t)); playBus.emitRelease({ id: p.id, t }); this.press[l] = null; }
    }
    this.releaseSustain();
  }
  dispose() { this.panic(); }
}
