import { eventKey, type PlayEvent } from '../lib/events';

export type Verdict = 'perfect' | 'early' | 'late' | 'miss' | 'wrong' | 'extra';

export interface JudgedTarget { beat: number; time: number; key: string; verdict: Verdict | null; offsetMs?: number; playedKey?: string }

export interface PerformanceReport {
  kind: 'practice' | 'free';
  lessonId?: string;
  title: string;
  level?: string;
  createdAt: number;
  duration: number;
  events: number;
  // practice-only counts (null when not applicable)
  targets: number | null;
  correct: number | null;
  perfect: number | null;
  early: number | null;
  late: number | null;
  missed: number | null;
  wrong: number | null;
  accidental: number;
  meanOffsetMs: number | null;
  stdOffsetMs: number | null;
  timingAccuracy: number | null;
  rhythmConsistency: number | null;
  noteAccuracy: number | null;
  overall: number | null;
  grade: string;
  offsets: number[];
  perKey: { key: string; label: string; total: number; hit: number; missed: number }[];
  recommendations: string[];
  notes: string[];
}

export const WINDOWS = {
  beginner: { perfect: 60, ok: 150, max: 220, tempo: 1 },
  advanced: { perfect: 35, ok: 85, max: 130, tempo: 1.15 },
};

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const std = (a: number[]) => { const m = mean(a); return a.length > 1 ? Math.sqrt(mean(a.map((x) => (x - m) ** 2))) : 0; };
const clamp = (v: number) => Math.max(0, Math.min(100, v));

export function gradeFor(score: number) {
  return score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 65 ? 'C' : score >= 50 ? 'D' : 'E';
}

/** Report for a guided lesson, built only from the judged targets and the raw event log. */
export function practiceReport(args: {
  lessonId: string; title: string; level: 'beginner' | 'advanced'; judged: JudgedTarget[]; extras: number; wrongPairs: Map<string, number>;
  duration: number; events: number; labelOf: (k: string) => string; bpm: number; sensitivity: number;
}): PerformanceReport {
  const w = WINDOWS[args.level];
  const j = args.judged;
  const hits = j.filter((t) => t.verdict === 'perfect' || t.verdict === 'early' || t.verdict === 'late');
  const offsets = hits.map((t) => t.offsetMs!);
  const missed = j.filter((t) => t.verdict === 'miss' || t.verdict === null).length;
  const wrong = [...args.wrongPairs.values()].reduce((a, b) => a + b, 0);
  const total = j.length;
  const noteAcc = total ? (hits.length / total) * 100 : 0;
  const timing = hits.length ? mean(offsets.map((o) => Math.max(0, 1 - Math.abs(o) / w.max))) * 100 : 0;
  const sd = std(offsets);
  const consistency = hits.length >= 3 ? clamp(100 - (sd / w.max) * 150) : null;
  const penalty = Math.min(20, ((args.extras + wrong) / Math.max(1, total)) * 50);
  const overall = Math.round(clamp(0.5 * noteAcc + 0.3 * timing + 0.2 * (consistency ?? timing) - penalty));
  const m = mean(offsets);

  const perKeyMap = new Map<string, { total: number; hit: number; missed: number }>();
  for (const t of j) {
    const e = perKeyMap.get(t.key) ?? { total: 0, hit: 0, missed: 0 };
    e.total++;
    if (t.verdict === 'perfect' || t.verdict === 'early' || t.verdict === 'late') e.hit++; else e.missed++;
    perKeyMap.set(t.key, e);
  }
  const perKey = [...perKeyMap.entries()].map(([key, v]) => ({ key, label: key === '*' ? 'Any pad' : args.labelOf(key), ...v }));

  const rec: string[] = [];
  if (hits.length >= 3 && m > 40) rec.push(`You played behind the beat by about ${Math.round(m)} ms on average. Start each motion a little earlier. If this happens in every lesson, re-run the latency test in Calibration.`);
  if (hits.length >= 3 && m < -40) rec.push(`You were rushing, about ${Math.round(-m)} ms ahead of the beat on average. Wait for the click and land with it.`);
  if (consistency !== null && sd > w.perfect * 1.4) rec.push(`Your timing spread was ±${Math.round(sd)} ms. Try this lesson at ${Math.max(40, Math.round(args.bpm * 0.8))} BPM until the spread drops below ±${w.perfect} ms.`);
  const worst = perKey.filter((p) => p.missed > 0 && p.total >= 2).sort((a, b) => b.missed / b.total - a.missed / a.total)[0];
  if (worst && worst.missed / worst.total >= 0.3) rec.push(`Most misses were on ${worst.label} (${worst.missed} of ${worst.total}). Practise reaching that position slowly before playing at tempo.`);
  const topWrong = [...args.wrongPairs.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topWrong && topWrong[1] >= 2) {
    const [exp, got] = topWrong[0].split('→');
    rec.push(`You played ${args.labelOf(got)} instead of ${args.labelOf(exp)} ${topWrong[1]} times. Check where your hand is before each note.`);
  }
  if (args.extras / Math.max(1, total) > 0.15) rec.push(`There were ${args.extras} unintended triggers. Keep your hands still between notes, or lower tracking sensitivity (now ${args.sensitivity}) in Settings.`);
  if (missed / Math.max(1, total) > 0.4 && args.extras === 0) rec.push('Many notes didn\'t register at all. Raise tracking sensitivity slightly or make firmer, faster motions.');
  if (!rec.length) rec.push(overall >= 85 ? `Excellent. Try advanced difficulty or raise the tempo to ${Math.round(args.bpm * 1.1)} BPM.` : 'Solid run. Repeat it to build consistency.');

  return {
    kind: 'practice', lessonId: args.lessonId, title: args.title, level: args.level, createdAt: Date.now(), duration: args.duration, events: args.events,
    targets: total, correct: hits.length, perfect: hits.filter((t) => t.verdict === 'perfect').length, early: hits.filter((t) => t.verdict === 'early').length,
    late: hits.filter((t) => t.verdict === 'late').length, missed, wrong, accidental: args.extras,
    meanOffsetMs: hits.length ? Math.round(m) : null, stdOffsetMs: hits.length > 1 ? Math.round(sd) : null,
    timingAccuracy: hits.length ? Math.round(timing) : null, rhythmConsistency: consistency === null ? null : Math.round(consistency),
    noteAccuracy: Math.round(noteAcc), overall, grade: gradeFor(overall), offsets, perKey, recommendations: rec, notes: [],
  };
}

/**
 * Report for a free recording. Timing metrics are computed only when a metronome/backing grid
 * was running (offsets to the nearest 8th note); otherwise they are reported as not applicable.
 */
export function freeReport(args: { title: string; events: PlayEvent[]; duration: number; bpm?: number; gridDefined: boolean; gridOffset?: number; latencyMs: number }): PerformanceReport {
  const ev = args.events;
  const notes: string[] = [];
  // accidental triggers: same key re-triggered within 90 ms, or very weak hits
  let accidental = 0;
  const lastByKey = new Map<string, number>();
  for (const e of ev) {
    const k = eventKey(e);
    const prev = lastByKey.get(k);
    if ((prev !== undefined && e.t - prev < 0.09) || (e.kind === 'hit' && e.vel < 0.18)) accidental++;
    lastByKey.set(k, e.t);
  }
  let offsets: number[] = [];
  let timing: number | null = null, consistency: number | null = null, m: number | null = null, sd: number | null = null;
  if (args.gridDefined && args.bpm && ev.length >= 4) {
    const grid = 60 / args.bpm / 2; // 8th notes
    const g0 = args.gridOffset ?? 0;
    offsets = ev.map((e) => {
      const t = e.t - args.latencyMs / 1000 - g0;
      const k = Math.round(t / grid);
      return (t - k * grid) * 1000;
    });
    m = Math.round(mean(offsets));
    sd = Math.round(std(offsets));
    const maxW = grid * 500; // half a grid step
    timing = Math.round(mean(offsets.map((o) => Math.max(0, 1 - Math.abs(o) / maxW))) * 100);
    consistency = Math.round(clamp(100 - (sd / maxW) * 150));
  } else notes.push('Timing accuracy needs a grid. Turn on the metronome or a backing track while recording to get timing scores.');
  const accidentalRatio = ev.length ? accidental / ev.length : 0;
  const overall = timing !== null ? Math.round(clamp(0.6 * timing + 0.4 * (consistency ?? timing) - Math.min(20, accidentalRatio * 60))) : null;
  const rec: string[] = [];
  if (m !== null && m > 35) rec.push(`On average you landed ${m} ms after the grid. Anticipate the beat slightly.`);
  if (m !== null && m < -35) rec.push(`On average you landed ${-m} ms ahead of the grid. Relax and let the beat come to you.`);
  if (sd !== null && sd > 60) rec.push(`Your timing spread was ±${sd} ms. Practise with the metronome at a slower tempo.`);
  if (accidentalRatio > 0.1) rec.push(`${accidental} events look accidental (double triggers or very weak hits). Lower sensitivity or keep resting hands still.`);
  if (!ev.length) rec.push('No notes were played in this take.');
  if (!rec.length && ev.length) rec.push(timing !== null ? 'Tight performance. Try a faster tempo or a new backing style.' : 'Record with the metronome to get timing feedback.');
  return {
    kind: 'free', title: args.title, createdAt: Date.now(), duration: args.duration, events: ev.length,
    targets: null, correct: null, perfect: null, early: null, late: null, missed: null, wrong: null, accidental,
    meanOffsetMs: m, stdOffsetMs: sd, timingAccuracy: timing, rhythmConsistency: consistency, noteAccuracy: null,
    overall, grade: overall === null ? '—' : gradeFor(overall), offsets, perKey: [], recommendations: rec, notes,
  };
}
