import { NOTE_NAMES } from '../lib/music';

const bufferCache = new Map<string, Promise<AudioBuffer | null>>();
let decodeCtx: BaseAudioContext | null = null;
export const setDecodeContext = (c: BaseAudioContext) => { decodeCtx = c; };

export function loadBuffer(url: string): Promise<AudioBuffer | null> {
  let p = bufferCache.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => { if (!r.ok) throw new Error(`${r.status}`); return r.arrayBuffer(); })
      .then((ab) => (decodeCtx ?? new OfflineAudioContext(2, 1, 48000)).decodeAudioData(ab))
      .catch((e) => { console.warn('Sample load failed', url, e); return null; });
    bufferCache.set(url, p);
  }
  return p;
}

const BASE = import.meta.env.BASE_URL + 'samples/';

/** Parse "Cs4" / "D#4" / "A0" to midi. */
export function parseNote(n: string): number {
  const m = /^([A-G])(s|#|b)?(-?\d)$/.exec(n);
  if (!m) return -1;
  let pc = NOTE_NAMES.indexOf(m[1]);
  if (m[2] === 's' || m[2] === '#') pc += 1;
  if (m[2] === 'b') pc -= 1;
  return (parseInt(m[3]) + 1) * 12 + pc;
}

export class SampleBank {
  private map = new Map<number, AudioBuffer>();
  private keys: number[] = [];
  loaded = false;
  failed = false;
  private loading: Promise<void> | null = null;

  constructor(private files: { midi: number; url: string }[]) {}

  load(onProgress?: (f: number) => void): Promise<void> {
    if (this.loading) return this.loading;
    let done = 0;
    this.loading = Promise.all(
      this.files.map(async (f) => {
        const b = await loadBuffer(f.url);
        if (b) this.map.set(f.midi, b);
        done++;
        onProgress?.(done / this.files.length);
      }),
    ).then(() => {
      this.keys = [...this.map.keys()].sort((a, b) => a - b);
      this.loaded = this.keys.length > 0;
      this.failed = !this.loaded;
    });
    return this.loading;
  }

  /** Nearest sample & playback rate for a midi note. */
  pick(midi: number): { buffer: AudioBuffer; rate: number } | null {
    if (!this.keys.length) return null;
    let best = this.keys[0];
    for (const k of this.keys) if (Math.abs(k - midi) < Math.abs(best - midi)) best = k;
    return { buffer: this.map.get(best)!, rate: Math.pow(2, (midi - best) / 12) };
  }
}

const pianoNotes = (() => {
  const out: string[] = ['A0'];
  for (let o = 1; o <= 7; o++) for (const n of ['C', 'Ds', 'Fs', 'A']) out.push(n + o);
  out.push('C8');
  return out;
})();

export const BANKS = {
  pianoLoud: new SampleBank(pianoNotes.map((n) => ({ midi: parseNote(n), url: `${BASE}piano/${n}v8.mp3` }))),
  pianoSoft: new SampleBank(pianoNotes.map((n) => ({ midi: parseNote(n), url: `${BASE}piano/${n}v4.mp3` }))),
  guitarAcoustic: new SampleBank(
    ['A2', 'A3', 'A4', 'As2', 'As3', 'As4', 'B2', 'B3', 'B4', 'C3', 'C4', 'C5', 'Cs3', 'Cs4', 'Cs5', 'D2', 'D3', 'D4', 'D5', 'Ds2', 'Ds3', 'Ds4',
      'E2', 'E3', 'E4', 'F2', 'F3', 'F4', 'Fs2', 'Fs3', 'Fs4', 'G2', 'G3', 'G4', 'Gs2', 'Gs3', 'Gs4']
      .map((n) => ({ midi: parseNote(n), url: `${BASE}guitar-acoustic/${n}.mp3` })),
  ),
  guitarElectric: new SampleBank(
    ['A2', 'A3', 'A4', 'A5', 'C3', 'C4', 'C5', 'C6', 'Cs2', 'Ds3', 'Ds4', 'Ds5', 'E2', 'Fs2', 'Fs3', 'Fs4', 'Fs5']
      .map((n) => ({ midi: parseNote(n), url: `${BASE}guitar-electric/${n}.mp3` })),
  ),
  bass: new SampleBank(
    ['As1', 'As2', 'As3', 'As4', 'Cs1', 'Cs2', 'Cs3', 'Cs4', 'Cs5', 'E1', 'E2', 'E3', 'E4', 'G1', 'G2', 'G3', 'G4']
      .map((n) => ({ midi: parseNote(n), url: `${BASE}bass-electric/${n}.mp3` })),
  ),
};

export const TR808: Record<string, string> = Object.fromEntries(
  ['kick', 'snare', 'hhc', 'hho', 'crash', 'ride', 'tomh', 'tomm', 'toml', 'clap', 'cowbell', 'rim', 'clave', 'maracas', 'congah', 'congal']
    .map((k) => [k, `${BASE}tr808/${k}.wav`]),
);
