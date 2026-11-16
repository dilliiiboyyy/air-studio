import type { PlayEvent } from './events';
import type { InstrumentId } from './settings';

/** General MIDI percussion map (channel 10). */
export const GM_DRUMS: Record<string, number> = {
  kick: 36, snare: 38, hhc: 42, hho: 46, crash: 49, ride: 51, tomh: 50, tomm: 47, toml: 43,
  bongoHi: 60, bongoLo: 61, congaOpen: 63, congaSlap: 62, congaLow: 64, tambourine: 54, clap: 39, shaker: 70,
  cowbell: 56, eClap: 39, eRim: 37, eClave: 75, eConga: 63, eZap: 81,
};

const GM_PROGRAM: Record<string, number> = {
  acoustic: 0, grand: 0, ambient: 0, electric: 4, organ: 16, synth: 81,
  gAcoustic: 25, clean: 27, distorted: 30, bass: 33, synthLead: 81,
};

function vlq(n: number): number[] {
  const out = [n & 0x7f];
  while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
  return out;
}

interface Msg { tick: number; data: number[] }

/**
 * Build a Standard MIDI File (format 1). Tracks: list of {name, inst, preset, events}.
 * Event times are seconds from take start.
 */
export function buildMidi(tracks: { name: string; inst: InstrumentId; preset: string; events: PlayEvent[]; offset?: number }[], bpm = 120): Blob {
  const PPQ = 480;
  const secToTick = (s: number) => Math.max(0, Math.round((s * bpm / 60) * PPQ));
  const chunks: number[][] = [];
  // tempo track
  const mpqn = Math.round(60000000 / bpm);
  chunks.push([0, 0xff, 0x51, 0x03, (mpqn >> 16) & 0xff, (mpqn >> 8) & 0xff, mpqn & 0xff, 0, 0xff, 0x2f, 0x00]);

  let melodicCh = 0;
  for (const tr of tracks) {
    const isDrum = tr.inst === 'drums' || tr.inst === 'percussion';
    const ch = isDrum ? 9 : melodicCh++ % 9;
    const msgs: Msg[] = [];
    const off = tr.offset ?? 0;
    for (const e of tr.events) {
      const vel = Math.max(1, Math.min(127, Math.round(e.vel * 127)));
      const t0 = e.t + off;
      if (e.kind === 'hit') {
        const n = GM_DRUMS[e.piece ?? ''] ?? 38;
        msgs.push({ tick: secToTick(t0), data: [0x90 | ch, n, vel] }, { tick: secToTick(t0 + 0.1), data: [0x80 | ch, n, 0] });
      } else {
        const notes = e.notes?.length ? e.notes : e.midi !== undefined ? [e.midi] : [];
        const dur = e.dur ?? (e.kind === 'strum' ? (e.muted ? 0.12 : 0.9) : 0.4);
        notes.forEach((n, i) => {
          if (n < 0) return;
          const st = e.kind === 'strum' ? t0 + i * 0.012 : t0;
          msgs.push({ tick: secToTick(st), data: [0x90 | ch, n, vel] }, { tick: secToTick(t0 + dur), data: [0x80 | ch, n, 0] });
        });
      }
    }
    msgs.sort((a, b) => a.tick - b.tick || (a.data[0] & 0xf0) - (b.data[0] & 0xf0));
    const bytes: number[] = [];
    const name = Array.from(new TextEncoder().encode(tr.name.slice(0, 60)));
    bytes.push(0, 0xff, 0x03, ...vlq(name.length), ...name);
    if (!isDrum) bytes.push(0, 0xc0 | ch, GM_PROGRAM[tr.preset] ?? (tr.inst === 'guitar' ? 25 : tr.inst === 'synth' ? 81 : 0));
    let last = 0;
    for (const m of msgs) { bytes.push(...vlq(m.tick - last), ...m.data); last = m.tick; }
    bytes.push(0, 0xff, 0x2f, 0x00);
    chunks.push(bytes);
  }

  const out: number[] = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, (chunks.length >> 8) & 0xff, chunks.length & 0xff, (PPQ >> 8) & 0xff, PPQ & 0xff];
  const parts: Uint8Array[] = [new Uint8Array(out)];
  for (const c of chunks) {
    parts.push(new Uint8Array([0x4d, 0x54, 0x72, 0x6b, (c.length >>> 24) & 0xff, (c.length >>> 16) & 0xff, (c.length >>> 8) & 0xff, c.length & 0xff]), new Uint8Array(c));
  }
  return new Blob(parts as BlobPart[], { type: 'audio/midi' });
}
