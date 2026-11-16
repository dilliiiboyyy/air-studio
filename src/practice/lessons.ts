import type { InstrumentId, Settings } from '../lib/settings';
import { parseNote } from '../audio/samples';

export interface Target { beat: number; key: string }

export interface Lesson {
  id: string;
  inst: InstrumentId;
  category: 'Piano notes' | 'Piano chords' | 'Drum patterns' | 'Guitar chords' | 'Rhythm';
  title: string;
  level: 'Beginner' | 'Intermediate' | 'Advanced';
  desc: string;
  tip: string;
  bpm: number;
  sig: '4/4' | '3/4';
  targets: Target[];
  /** temporary settings applied while the lesson runs */
  patch?: Partial<{ [K in keyof Settings]: Partial<Settings[K]> }>;
  /** '*' key matches any pad */
  anyKey?: boolean;
}

/** Melody helper: "E4:1 D4:0.5 ..." (duration in beats) */
function melody(s: string, startBeat = 0): Target[] {
  let b = startBeat;
  const out: Target[] = [];
  for (const tok of s.trim().split(/\s+/)) {
    const [n, d] = tok.split(':');
    if (n !== 'r') out.push({ beat: b, key: String(parseNote(n)) });
    b += parseFloat(d ?? '1');
  }
  return out;
}

function pattern(map: Record<string, string>, bars: number, stepsPerBeat = 4): Target[] {
  const out: Target[] = [];
  for (let bar = 0; bar < bars; bar++) {
    for (const [key, pat] of Object.entries(map)) {
      [...pat].forEach((c, i) => { if (c === 'x') out.push({ beat: bar * (pat.length / stepsPerBeat) + i / stepsPerBeat, key }); });
    }
  }
  return out.sort((a, b) => a.beat - b.beat);
}

const chordsEvery = (chords: string[], beatsEach: number, strumsPerChord: number, strumStep: number): Target[] => {
  const out: Target[] = [];
  chords.forEach((c, i) => { for (let k = 0; k < strumsPerChord; k++) out.push({ beat: i * beatsEach + k * strumStep, key: c }); });
  return out;
};

const pianoBeginner = { piano: { level: 'beginner' as const, key: 0, scale: 'major', octave: 4, chordAssist: 'off' as const } };

export const LESSONS: Lesson[] = [
  {
    id: 'pn-scale', inst: 'piano', category: 'Piano notes', title: 'C major scale', level: 'Beginner', bpm: 66, sig: '4/4',
    desc: 'Play C D E F G A B C going up, one note per beat.', tip: 'Keep your index finger hovering just above the key line, and move sideways before you dip.',
    targets: melody('C4 D4 E4 F4 G4 A4 B4 C5:2'), patch: pianoBeginner,
  },
  {
    id: 'pn-mary', inst: 'piano', category: 'Piano notes', title: 'Mary Had a Little Lamb', level: 'Beginner', bpm: 80, sig: '4/4',
    desc: 'A traditional nursery melody on E, D, C and G.', tip: 'Repeated notes need a small lift above the key line between presses.',
    targets: melody('E4 D4 C4 D4 E4 E4 E4:2 D4 D4 D4:2 E4 G4 G4:2 E4 D4 C4 D4 E4 E4 E4 E4 D4 D4 E4 D4 C4:4'), patch: pianoBeginner,
  },
  {
    id: 'pn-ode', inst: 'piano', category: 'Piano notes', title: 'Ode to Joy (Beethoven)', level: 'Intermediate', bpm: 84, sig: '4/4',
    desc: 'The famous theme from the Ninth Symphony.', tip: 'The dotted rhythm at the end of each phrase lands just before beat 4.',
    targets: melody('E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 E4:1.5 D4:0.5 D4:2 E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 D4:1.5 C4:0.5 C4:2'), patch: pianoBeginner,
  },
  {
    id: 'pn-chords', inst: 'piano', category: 'Piano chords', title: 'I–IV–V–I with chord assist', level: 'Beginner', bpm: 72, sig: '4/4',
    desc: 'Chord assist is on. Play C, F, G, C and hold each for a bar (4 beats). One finger plays the whole triad.', tip: 'Press on beat 1 of each bar and hold through the bar.',
    targets: melody('C4:4 F4:4 G4:4 C4:4 C4:4 F4:4 G4:4 C4:4'), patch: { piano: { ...pianoBeginner.piano, chordAssist: 'triad' } },
  },
  {
    id: 'pn-eighths', inst: 'piano', category: 'Piano notes', title: 'Scale in eighth notes', level: 'Advanced', bpm: 80, sig: '4/4',
    desc: 'Up and down the C major scale, two notes per beat.', tip: 'Use glide: keep the finger down and slide to the next key.',
    targets: melody('C4:0.5 D4:0.5 E4:0.5 F4:0.5 G4:0.5 A4:0.5 B4:0.5 C5:0.5 B4:0.5 A4:0.5 G4:0.5 F4:0.5 E4:0.5 D4:0.5 C4:2'), patch: pianoBeginner,
  },
  {
    id: 'dr-quarters', inst: 'drums', category: 'Drum patterns', title: 'Quarter-note snare', level: 'Beginner', bpm: 76, sig: '4/4',
    desc: 'Hit the snare on every beat for 4 bars.', tip: 'Use short, relaxed wrist flicks. A big arm swing adds delay.',
    targets: pattern({ snare: 'x---x---x---x---' }, 4), patch: { drums: { layout: 'compact' } },
  },
  {
    id: 'dr-backbeat', inst: 'drums', category: 'Drum patterns', title: 'Kick & snare backbeat', level: 'Beginner', bpm: 80, sig: '4/4',
    desc: 'Kick on beats 1 and 3, snare on beats 2 and 4.', tip: 'The kick is the wide pad at the bottom, so drop lower for it.',
    targets: pattern({ kick: 'x-------x-------', snare: '----x-------x---' }, 4), patch: { drums: { layout: 'compact' } },
  },
  {
    id: 'dr-rock', inst: 'drums', category: 'Drum patterns', title: 'Basic rock beat', level: 'Intermediate', bpm: 84, sig: '4/4',
    desc: 'Right hand: closed hi-hat on 8th notes. Left hand: kick on 1 and 3, snare on 2 and 4.', tip: 'Lock in the hi-hat first. The other hand lands with it.',
    targets: pattern({ hhc: 'x-x-x-x-x-x-x-x-', kick: 'x-------x-------', snare: '----x-------x---' }, 4), patch: { drums: { layout: 'compact' } },
  },
  {
    id: 'dr-fill', inst: 'drums', category: 'Drum patterns', title: 'Tom fill into crash', level: 'Advanced', bpm: 90, sig: '4/4',
    desc: 'Two beats on each tom, high to low, then crash with kick.', tip: 'Alternate hands on each 8th note so neither hand has to hit twice in a row.',
    targets: [...pattern({ tomh: 'x-x-x-x---------', tomm: '--------x-x-x-x-' }, 1), ...pattern({ toml: 'x-x-x-x-x-x-x-x-' }, 1).map((t) => ({ ...t, beat: t.beat + 4 })), { beat: 8, key: 'crash' }, { beat: 8, key: 'kick' }],
    patch: { drums: { layout: 'standard' } },
  },
  {
    id: 'gt-pop', inst: 'guitar', category: 'Guitar chords', title: 'G – D – Em – C', level: 'Beginner', bpm: 70, sig: '4/4',
    desc: 'One strum per beat, four beats per chord. Raise or lower your left hand to change chords.', tip: 'Move the fretting hand on beat 4 so the new chord is ready for beat 1.',
    targets: chordsEvery(['G', 'D', 'Em', 'C', 'G', 'D', 'Em', 'C'], 4, 4, 1), patch: { guitar: { progression: 'pop', chordSelect: 'height' } },
  },
  {
    id: 'gt-folk', inst: 'guitar', category: 'Guitar chords', title: 'C – Am – F – G changes', level: 'Beginner', bpm: 76, sig: '4/4',
    desc: 'Two strums per chord (beats 1 and 3).', tip: 'Fewer strums give you more time to change chords.',
    targets: chordsEvery(['C', 'Am', 'F', 'G', 'C', 'Am', 'F', 'G'], 4, 2, 2), patch: { guitar: { progression: 'folk', chordSelect: 'height' } },
  },
  {
    id: 'gt-eighths', inst: 'guitar', category: 'Guitar chords', title: 'Down–up eighth strums', level: 'Advanced', bpm: 72, sig: '4/4',
    desc: 'Strum continuously down and up on eighth notes through G – D – Em – C.', tip: 'Keep the strumming hand moving like a pendulum, even when you change chords.',
    targets: chordsEvery(['G', 'D', 'Em', 'C'], 4, 8, 0.5), patch: { guitar: { progression: 'pop', chordSelect: 'height' } },
  },
  {
    id: 'rh-quarters', inst: 'percussion', category: 'Rhythm', title: 'Steady quarter notes', level: 'Beginner', bpm: 90, sig: '4/4', anyKey: true,
    desc: 'Hit any pad exactly on each click.', tip: 'Listen for the click and land with it. Don\'t chase it.',
    targets: pattern({ '*': 'x---x---x---x---' }, 4), patch: { percussion: { layout: 'hand', shake: false } },
  },
  {
    id: 'rh-eighths', inst: 'percussion', category: 'Rhythm', title: 'Eighth notes', level: 'Intermediate', bpm: 84, sig: '4/4', anyKey: true,
    desc: 'Two even hits per beat. Alternate hands.', tip: 'Count "1 and 2 and…" out loud.',
    targets: pattern({ '*': 'x-x-x-x-x-x-x-x-' }, 4), patch: { percussion: { layout: 'hand', shake: false } },
  },
  {
    id: 'rh-sync', inst: 'percussion', category: 'Rhythm', title: 'Syncopation', level: 'Intermediate', bpm: 84, sig: '4/4', anyKey: true,
    desc: 'Hit on 1, the "and" of 2, 3, and the "and" of 4.', tip: 'The off-beats fall exactly halfway between clicks.',
    targets: pattern({ '*': 'x-----x-x-----x-' }, 4), patch: { percussion: { layout: 'hand', shake: false } },
  },
  {
    id: 'rh-clave', inst: 'percussion', category: 'Rhythm', title: 'Son clave (3–2)', level: 'Advanced', bpm: 92, sig: '4/4', anyKey: true,
    desc: 'The two-bar Afro-Cuban clave: three hits, then two.', tip: 'Bar 1 has hits on 1, the "and" of 2, and 4. Bar 2 has hits on 2 and 3.',
    targets: pattern({ '*': 'x-----x-----x-------x---x-------' }, 3, 4).map((t) => t), patch: { percussion: { layout: 'latin', shake: false } },
  },
];

export const lessonLengthBeats = (l: Lesson) => Math.ceil(Math.max(...l.targets.map((t) => t.beat)) + 1);

// ---------- progress ----------
export interface LessonProgress { attempts: number; best: number; last: number; completed: boolean; history: { date: number; score: number; level: string }[] }
const PKEY = 'air-studio.progress.v1';

export function getProgress(): Record<string, LessonProgress> {
  try { return JSON.parse(localStorage.getItem(PKEY) || '{}'); } catch { return {}; }
}

export function recordProgress(id: string, score: number, level: string): LessonProgress {
  const all = getProgress();
  const p = all[id] ?? { attempts: 0, best: 0, last: 0, completed: false, history: [] };
  p.attempts++;
  p.last = score;
  p.best = Math.max(p.best, score);
  p.completed = p.completed || score >= 70;
  p.history = [...p.history, { date: Date.now(), score, level }].slice(-20);
  all[id] = p;
  localStorage.setItem(PKEY, JSON.stringify(all));
  return p;
}

export function resetProgress() { localStorage.removeItem(PKEY); }
