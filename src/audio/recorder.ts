import { engine } from './engine';
import { playBus, type PlayEvent } from '../lib/events';
import { encodeWav } from '../lib/wav';

interface Segment { ctxStart: number; ctxEnd: number; offset: number }

export interface TakeResult {
  wav: Blob;
  channels: Float32Array[];
  sampleRate: number;
  duration: number;
  events: PlayEvent[];
}

/**
 * Sample-accurate take recorder: PCM from the AudioWorklet tap plus every PlayEvent,
 * both on the AudioContext clock, with pause/resume.
 */
export class TakeRecorder {
  private chunksL: Float32Array[] = [];
  private chunksR: Float32Array[] = [];
  private segs: Segment[] = [];
  private events: PlayEvent[] = [];
  private openNotes = new Map<string, PlayEvent>();
  private unsub: (() => void)[] = [];
  private flushed: (() => void) | null = null;
  state: 'idle' | 'recording' | 'paused' | 'stopped' = 'idle';
  startedAt = 0;

  private onMsg = (e: MessageEvent) => {
    const m = e.data;
    if (m.type === 'data') { this.chunksL.push(m.l); this.chunksR.push(m.r); }
    if (m.type === 'flushed') this.flushed?.();
  };

  start(at: number) {
    const cap = engine.capture;
    if (!cap) throw new Error('Audio recorder is not available in this browser.');
    cap.port.onmessage = this.onMsg;
    cap.port.postMessage({ cmd: 'capture', on: true, at });
    this.segs = [{ ctxStart: at, ctxEnd: Infinity, offset: 0 }];
    this.startedAt = at;
    this.state = 'recording';
    this.unsub.push(playBus.play((ev) => this.onEvent(ev)));
    this.unsub.push(playBus.release((r) => {
      const n = this.openNotes.get(r.id);
      if (n) {
        const end = this.map(r.t) ?? this.elapsed();
        n.dur = Math.max(0.03, end - n.t);
        this.openNotes.delete(r.id);
      }
    }));
  }

  private onEvent(ev: PlayEvent) {
    if (this.state !== 'recording') return;
    const t = this.map(ev.t);
    if (t === null) return;
    const copy: PlayEvent = { ...ev, t };
    this.events.push(copy);
    if (ev.id && ev.kind === 'note') this.openNotes.set(ev.id, copy);
  }

  /** ctx time -> take time; null if inside a pause or before start. */
  private map(ctxT: number): number | null {
    for (const s of this.segs) if (ctxT >= s.ctxStart - 0.005 && ctxT < s.ctxEnd) return Math.max(0, s.offset + ctxT - s.ctxStart);
    return null;
  }

  /** Current take position in seconds (excludes pauses). */
  elapsed(): number {
    const now = engine.now;
    let t = 0;
    for (const s of this.segs) t += Math.max(0, Math.min(now, s.ctxEnd) - s.ctxStart);
    return t;
  }

  pause() {
    if (this.state !== 'recording') return;
    const at = engine.now;
    engine.capture?.port.postMessage({ cmd: 'capture', on: false, at });
    const s = this.segs[this.segs.length - 1];
    s.ctxEnd = at;
    this.state = 'paused';
  }

  resume() {
    if (this.state !== 'paused') return;
    const at = engine.now + 0.01;
    engine.capture?.port.postMessage({ cmd: 'capture', on: true, at });
    const last = this.segs[this.segs.length - 1];
    this.segs.push({ ctxStart: at, ctxEnd: Infinity, offset: last.offset + (last.ctxEnd - last.ctxStart) });
    this.state = 'recording';
  }

  async stop(): Promise<TakeResult> {
    const cap = engine.capture!;
    const at = engine.now;
    if (this.state === 'recording') {
      cap.port.postMessage({ cmd: 'capture', on: false, at });
      this.segs[this.segs.length - 1].ctxEnd = at;
    }
    this.state = 'stopped';
    this.unsub.forEach((u) => u());
    this.unsub = [];
    // wait one render quantum past `at`, then flush
    await new Promise((r) => setTimeout(r, 60));
    await new Promise<void>((res) => { this.flushed = res; cap.port.postMessage({ cmd: 'flush' }); setTimeout(res, 1000); });
    const total = this.chunksL.reduce((a, c) => a + c.length, 0);
    const L = new Float32Array(total), R = new Float32Array(total);
    let o = 0;
    for (let i = 0; i < this.chunksL.length; i++) { L.set(this.chunksL[i], o); R.set(this.chunksR[i], o); o += this.chunksL[i].length; }
    const sr = engine.ctx!.sampleRate;
    const duration = total / sr;
    // close any held notes at the end of the take
    this.openNotes.forEach((n) => { n.dur = Math.max(0.05, duration - n.t); });
    this.openNotes.clear();
    return { wav: encodeWav([L, R], sr), channels: [L, R], sampleRate: sr, duration, events: this.events.sort((a, b) => a.t - b.t) };
  }

  cancel() {
    if (this.state === 'recording') engine.capture?.port.postMessage({ cmd: 'capture', on: false, at: engine.now });
    this.unsub.forEach((u) => u());
    this.unsub = [];
    this.state = 'stopped';
    engine.capture?.port.postMessage({ cmd: 'flush' });
  }
}
