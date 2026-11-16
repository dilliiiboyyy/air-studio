import type { InstrumentId } from '../lib/settings';
import { settings } from '../lib/settings';
import type { Hand, TrackFrame, Pt } from '../tracking/tracker';
import { fromReach, strikeThreshold, toReach } from '../tracking/tracker';
import { StrikeDetector, speedToVelocity } from '../tracking/gestures';
import { playBus } from '../lib/events';
import { engine } from '../audio/engine';
import { DrumKit, PIECE_LABEL } from '../audio/instruments/drums';

export const C = {
  bg: '#151515', panel: '#282828', border: '#393939', text: '#F2F0EA', text2: '#A5A5A5', dim: '#6d6d6d',
  accent: '#D68A48', accentSoft: 'rgba(214,138,72,0.22)', green: '#86A86B', greenSoft: 'rgba(134,168,107,0.22)', red: '#C2554B',
  left: '#8FA6B9', right: '#D68A48', key: 'rgba(242,240,234,0.10)', keyBlack: 'rgba(10,10,10,0.55)',
};

export interface Controller {
  readonly inst: InstrumentId;
  load(onProgress?: (f: number) => void): Promise<void>;
  update(f: TrackFrame, now: number): void;
  draw(g: CanvasRenderingContext2D, w: number, h: number, now: number): void;
  /** practice targets: event keys to highlight, with optional "next" key */
  setTargets(keys: string[]): void;
  /** human label for an event key */
  label(key: string): string;
  /** short live readout (current note / chord) for the HUD */
  readout(): string;
  panic(): void;
  dispose(): void;
}

export function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r = 4) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];

export function drawHands(g: CanvasRenderingContext2D, f: TrackFrame, w: number, h: number, opts: { point?: 'tip' | 'palm'; labels?: Record<string, string> } = {}) {
  const showLm = settings.get().tracking.showLandmarks;
  for (const hand of f.hands) {
    const col = hand.label === 'Left' ? C.left : C.right;
    if (showLm && hand.lm.length === 21) {
      g.strokeStyle = 'rgba(242,240,234,0.35)';
      g.lineWidth = 1.5;
      g.beginPath();
      for (const [a, b] of BONES) { g.moveTo(hand.lm[a].x * w, hand.lm[a].y * h); g.lineTo(hand.lm[b].x * w, hand.lm[b].y * h); }
      g.stroke();
      g.fillStyle = 'rgba(242,240,234,0.6)';
      for (const p of hand.lm) { g.beginPath(); g.arc(p.x * w, p.y * h, 2, 0, Math.PI * 2); g.fill(); }
    }
    const p = opts.point === 'tip' ? hand.tip : hand.palm;
    g.strokeStyle = col;
    g.lineWidth = 2.5;
    g.beginPath();
    g.arc(p.x * w, p.y * h, hand.fist ? 9 : 13, 0, Math.PI * 2);
    g.stroke();
    if (hand.fist) { g.fillStyle = col; g.fill(); }
    const lbl = opts.labels?.[hand.label] ?? (hand.label === 'Left' ? 'L' : 'R');
    g.font = '600 11px Inter, system-ui, sans-serif';
    g.fillStyle = col;
    g.textAlign = 'center';
    g.fillText(lbl, p.x * w, p.y * h - 20);
  }
}

export function reachRect(x0: number, y0: number, x1: number, y1: number) {
  const a = fromReach({ x: x0, y: y0 });
  const b = fromReach({ x: x1, y: y1 });
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
}

export function emitHit(inst: InstrumentId, piece: string, vel: number, hand: Hand['label'] | 'Sim', preset: string) {
  playBus.emit({ t: engine.now, inst, kind: 'hit', piece, vel, hand, preset });
}

export interface Pad { id: string; x: number; y: number; w: number; h: number; label?: string }

/** Shared pad-based controller (drums + percussion). Pads are in reach-space 0..1. */
export abstract class PadController implements Controller {
  abstract readonly inst: InstrumentId;
  protected kit: DrumKit;
  protected pads: Pad[] = [];
  protected det = { Left: new StrikeDetector(), Right: new StrikeDetector() };
  protected flashes = new Map<string, { t: number; v: number }>();
  protected targets: string[] = [];
  protected last = '';
  protected lastHits: { x: number; y: number; t: number; v: number }[] = [];

  constructor(pack: string) {
    this.kit = new DrumKit(engine.ctx!, engine.instFx.input, pack);
  }

  abstract sensOffset(): number;
  abstract velSens(): number;
  abstract preset(): string;

  load() { return this.kit.load(); }

  protected padAt(p: Pt): Pad | null {
    const r = toReach(p);
    const x = Math.max(0, Math.min(0.999, r.x)), y = Math.max(0, Math.min(0.999, r.y));
    let best: Pad | null = null;
    let bd = Infinity;
    for (const pad of this.pads) {
      if (x >= pad.x && x < pad.x + pad.w && y >= pad.y && y < pad.y + pad.h) return pad;
      const cx = Math.max(pad.x, Math.min(pad.x + pad.w, x)), cy = Math.max(pad.y, Math.min(pad.y + pad.h, y));
      const d = Math.hypot(cx - x, cy - y);
      if (d < bd) { bd = d; best = pad; }
    }
    return bd < 0.08 ? best : null;
  }

  trigger(piece: string, vel: number, hand: Hand['label'] | 'Sim', now: number) {
    this.kit.play(piece, vel);
    this.flashes.set(piece, { t: now, v: vel });
    this.last = PIECE_LABEL[piece] ?? piece;
    emitHit(this.inst, piece, vel, hand, this.preset());
  }

  update(f: TrackFrame, now: number) {
    const thr = strikeThreshold(this.sensOffset());
    for (const hand of f.hands) {
      const hit = this.det[hand.label].update(hand, now, thr);
      if (!hit) continue;
      const pad = this.padAt(hit.at);
      if (!pad) continue;
      const v = speedToVelocity(hit.vel, thr, this.velSens());
      this.trigger(pad.id, v, hand.label, now);
      this.lastHits.push({ x: hit.at.x, y: hit.at.y, t: now, v });
      if (this.lastHits.length > 12) this.lastHits.shift();
    }
  }

  draw(g: CanvasRenderingContext2D, w: number, h: number, now: number) {
    const gap = 0.012;
    for (const pad of this.pads) {
      const r = reachRect(pad.x + gap, pad.y + gap, pad.x + pad.w - gap, pad.y + pad.h - gap);
      const x = r.x * w, y = r.y * h, pw = r.w * w, ph = r.h * h;
      const fl = this.flashes.get(pad.id);
      const age = fl ? (now - fl.t) / 1000 : 9;
      const isTarget = this.targets.includes(pad.id);
      rr(g, x, y, pw, ph, 6);
      g.fillStyle = 'rgba(21,21,21,0.42)';
      g.fill();
      if (age < 0.25) {
        g.fillStyle = `rgba(214,138,72,${(0.55 * (1 - age / 0.25) * (0.4 + fl!.v * 0.6)).toFixed(3)})`;
        g.fill();
      }
      g.lineWidth = isTarget ? 3 : 1.2;
      g.strokeStyle = isTarget ? C.green : age < 0.25 ? C.accent : 'rgba(242,240,234,0.28)';
      g.stroke();
      // pad label
      g.fillStyle = isTarget ? C.green : C.text;
      g.font = `600 ${Math.max(11, Math.min(16, pw / 9))}px Inter, system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(pad.label ?? PIECE_LABEL[pad.id] ?? pad.id, x + pw / 2, y + ph / 2);
      if (isTarget) {
        g.font = '600 10px Inter, system-ui, sans-serif';
        g.fillText('PLAY', x + pw / 2, y + ph / 2 + 16);
      }
      g.textBaseline = 'alphabetic';
      // impact ring
      if (age < 0.3) {
        g.strokeStyle = `rgba(214,138,72,${(1 - age / 0.3).toFixed(3)})`;
        g.lineWidth = 2;
        rr(g, x - age * 30, y - age * 30, pw + age * 60, ph + age * 60, 8);
        g.stroke();
      }
    }
    // hit markers
    for (const hm of this.lastHits) {
      const a = (now - hm.t) / 400;
      if (a > 1) continue;
      g.fillStyle = `rgba(242,240,234,${(0.8 * (1 - a)).toFixed(3)})`;
      g.beginPath();
      g.arc(hm.x * w, hm.y * h, 4 + hm.v * 6, 0, Math.PI * 2);
      g.fill();
    }
  }

  setTargets(keys: string[]) { this.targets = keys; }
  label(key: string) { return PIECE_LABEL[key] ?? key; }
  readout() { return this.last; }
  panic() { /* one-shots only */ }
  dispose() { /* voices end by themselves */ }
}
