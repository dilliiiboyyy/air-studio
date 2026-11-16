import type { PlayEvent } from '../lib/events';
import type { FxSettings, InstrumentId } from '../lib/settings';
import { settings } from '../lib/settings';
import { FxChain } from './fx';
import { PianoInstrument } from './instruments/piano';
import { DrumKit } from './instruments/drums';
import { GuitarInstrument } from './instruments/guitar';
import { synthNote } from './instruments/synth';

/** Re-synthesise a performance offline with the same instrument code used live. */
export async function renderEvents(inst: InstrumentId, preset: string, events: PlayEvent[], duration: number, sampleRate: number, fx: FxSettings): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil((duration + 2.5) * sampleRate), sampleRate);
  const chain = new FxChain(ctx);
  chain.connect(ctx.destination);
  chain.set(fx);
  const out = chain.input;
  const t0 = 0.0;
  if (inst === 'piano') {
    const p = new PianoInstrument(ctx, out, preset || 'acoustic');
    await p.load();
    for (const e of events) {
      const notes = e.notes?.length ? e.notes : e.midi !== undefined ? [e.midi] : [];
      for (const n of notes) p.noteOn(n, e.vel, t0 + e.t).stop(t0 + e.t + (e.dur ?? 0.5));
    }
  } else if (inst === 'drums' || inst === 'percussion') {
    const k = new DrumKit(ctx, out, inst === 'drums' ? preset || 'acoustic' : 'acoustic');
    await k.load();
    for (const e of events) if (e.piece) k.play(e.piece, e.vel, t0 + e.t);
  } else if (inst === 'guitar') {
    const g = new GuitarInstrument(ctx, out, preset || 'acoustic');
    await g.load();
    for (const e of events) if (e.chord) g.strum(e.chord, e.dir ?? 'down', e.vel, t0 + e.t, !!e.muted);
  } else {
    const sp = settings.get().synth;
    for (const e of events) if (e.midi !== undefined) synthNote(ctx, out, sp, e.midi, e.vel, t0 + e.t, e.dur ?? 0.3);
  }
  return ctx.startRendering();
}

/** Snap event times to a grid (seconds). */
export function quantize(events: PlayEvent[], grid: number, shift = 0, strength = 1): PlayEvent[] {
  return events.map((e) => {
    const t = e.t - shift;
    const q = Math.max(0, Math.round(t / grid) * grid);
    const nt = t + (q - t) * strength;
    const dur = e.dur !== undefined ? Math.max(grid * 0.5, Math.round(e.dur / grid) * grid * 0.98) : undefined;
    return { ...e, t: nt, dur };
  });
}
