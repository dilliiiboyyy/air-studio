import { eventKey, type PlayEvent } from '../lib/events';
import type { Lesson } from './lessons';
import { WINDOWS, type JudgedTarget, type Verdict } from './scoring';

export interface Feedback { verdict: Verdict; text: string; offsetMs?: number; at: number }

/**
 * Real-time lesson judge. Each played event is matched to the nearest unjudged target
 * with the same key inside the timing window; timing is classified against the window.
 */
export class LessonJudge {
  readonly targets: JudgedTarget[];
  extras = 0;
  wrongPairs = new Map<string, number>();
  events = 0;
  private w: (typeof WINDOWS)['beginner'];

  constructor(public lesson: Lesson, level: 'beginner' | 'advanced', zero: number, beatDur: number, private latency: number, private labelOf: (k: string) => string) {
    this.w = WINDOWS[level];
    this.targets = lesson.targets.map((t) => ({ beat: t.beat, time: zero + t.beat * beatDur, key: t.key, verdict: null as Verdict | null })).sort((a, b) => a.time - b.time);
  }

  private keyMatch(target: string, played: string, e: PlayEvent) {
    if (target === '*' || this.lesson.anyKey) return true;
    if (target === played) return true;
    // piano with chord assist: accept the root, or any sounding note for single-note targets
    if (e.kind === 'note' && e.notes?.includes(Number(target)) && e.midi === Number(target)) return true;
    return false;
  }

  onEvent(e: PlayEvent): Feedback {
    this.events++;
    const t = e.t - this.latency;
    const played = eventKey(e);
    const maxS = this.w.max / 1000;
    let best: JudgedTarget | null = null;
    let anyInWindow: JudgedTarget | null = null;
    for (const tg of this.targets) {
      if (tg.verdict) continue;
      const d = Math.abs(t - tg.time);
      if (d > maxS) continue;
      if (!anyInWindow || d < Math.abs(t - anyInWindow.time)) anyInWindow = tg;
      if (this.keyMatch(tg.key, played, e) && (!best || d < Math.abs(t - best.time))) best = tg;
    }
    if (best) {
      const off = (t - best.time) * 1000;
      best.offsetMs = Math.round(off);
      best.playedKey = played;
      best.verdict = Math.abs(off) <= this.w.perfect ? 'perfect' : off < 0 ? 'early' : 'late';
      const txt = best.verdict === 'perfect' ? 'Correct' : best.verdict === 'early' ? 'Too early' : 'Too late';
      return { verdict: best.verdict, text: `${txt} · ${this.labelOf(best.key === '*' ? played : best.key)}`, offsetMs: best.offsetMs, at: performance.now() };
    }
    if (anyInWindow) {
      const k = `${anyInWindow.key}→${played}`;
      this.wrongPairs.set(k, (this.wrongPairs.get(k) ?? 0) + 1);
      return { verdict: 'wrong', text: `Incorrect: ${this.labelOf(played)} (expected ${this.labelOf(anyInWindow.key)})`, at: performance.now() };
    }
    this.extras++;
    return { verdict: 'extra', text: `Extra hit: ${this.labelOf(played)}`, at: performance.now() };
  }

  /** Mark targets whose window has passed as missed. Returns newly missed targets. */
  tick(now: number): JudgedTarget[] {
    const out: JudgedTarget[] = [];
    const t = now - this.latency;
    for (const tg of this.targets) {
      if (!tg.verdict && t > tg.time + this.w.max / 1000) { tg.verdict = 'miss'; out.push(tg); }
    }
    return out;
  }

  /** Targets to highlight: the earliest unjudged group. */
  next(): JudgedTarget[] {
    const open = this.targets.filter((t) => !t.verdict);
    if (!open.length) return [];
    const first = open[0].time;
    return open.filter((t) => t.time - first < 0.01);
  }

  get endTime() { return this.targets.length ? this.targets[this.targets.length - 1].time + this.w.max / 1000 + this.latency : 0; }
  get done() { return this.targets.every((t) => t.verdict); }
}
