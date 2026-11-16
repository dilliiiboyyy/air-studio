import type { InstrumentId } from './settings';

/** A performance event. `t` is AudioContext time (seconds) when live, or seconds from take start when stored. */
export interface PlayEvent {
  t: number;
  inst: InstrumentId;
  kind: 'note' | 'hit' | 'strum';
  /** primary pitch (root for chords) */
  midi?: number;
  /** all sounding pitches */
  notes?: number[];
  piece?: string;
  chord?: string;
  dir?: 'down' | 'up';
  muted?: boolean;
  vel: number;
  dur?: number;
  hand?: 'Left' | 'Right' | 'Sim';
  id?: string;
  preset?: string;
}

export interface ReleaseEvent { id: string; t: number }

type L<T> = (e: T) => void;

class Bus {
  private on = new Set<L<PlayEvent>>();
  private off = new Set<L<ReleaseEvent>>();
  play(fn: L<PlayEvent>) { this.on.add(fn); return () => { this.on.delete(fn); }; }
  release(fn: L<ReleaseEvent>) { this.off.add(fn); return () => { this.off.delete(fn); }; }
  emit(e: PlayEvent) { this.on.forEach((f) => f(e)); }
  emitRelease(e: ReleaseEvent) { this.off.forEach((f) => f(e)); }
}

export const playBus = new Bus();

/** Key used for matching an event against a lesson target. */
export function eventKey(e: PlayEvent): string {
  if (e.kind === 'hit') return e.piece ?? '';
  if (e.kind === 'strum') return e.chord ?? '';
  return String(e.midi ?? '');
}
