import { engine } from './engine';
import { decodeBlob } from '../lib/wav';
import type { Project, Track } from '../lib/db';

interface Live { src: AudioBufferSourceNode; gain: GainNode; pan: StereoPannerNode }

export function audible(p: Project, t: Track) {
  const anySolo = p.tracks.some((x) => x.solo);
  return anySolo ? t.solo : !t.mute;
}

export async function decodeTrack(t: Track): Promise<AudioBuffer> {
  const ctx = await engine.ensure();
  return decodeBlob(ctx, t.wav);
}

/** Multitrack playback: one buffer source per track, sample-accurate start, live mix updates. */
class ProjectPlayer {
  private live = new Map<string, Live>();
  private masterGain: GainNode | null = null;
  playing = false;
  startCtx = 0;
  startPos = 0;
  private endTimer = 0;
  onEnd: (() => void) | null = null;

  position() { return this.playing ? this.startPos + (engine.now - this.startCtx) : this.startPos; }

  async play(p: Project, fromPos: number, at?: number, length?: number) {
    this.stop();
    const ctx = await engine.ensure();
    const buffers = await Promise.all(p.tracks.map((t) => decodeTrack(t).catch(() => null)));
    if (!this.masterGain) { this.masterGain = ctx.createGain(); this.masterGain.connect(engine.playbackBus); }
    this.masterGain.gain.value = p.master;
    const when = at ?? ctx.currentTime + 0.06;
    this.startCtx = when;
    this.startPos = fromPos;
    let end = 0;
    p.tracks.forEach((t, i) => {
      const b = buffers[i];
      if (!b) return;
      const off = t.offsetMs / 1000;
      end = Math.max(end, off + b.duration);
      const src = ctx.createBufferSource();
      src.buffer = b;
      const gain = ctx.createGain();
      const pan = ctx.createStereoPanner();
      gain.gain.value = audible(p, t) ? t.volume : 0;
      pan.pan.value = t.pan;
      src.connect(gain).connect(pan).connect(this.masterGain!);
      // buffer offset at project position `fromPos`
      const bo = fromPos - off;
      if (bo >= b.duration) return;
      if (bo >= 0) src.start(when, bo);
      else src.start(when - bo, 0);
      this.live.set(t.id, { src, gain, pan });
    });
    this.playing = true;
    const total = length ?? end;
    clearTimeout(this.endTimer);
    if (total > fromPos) this.endTimer = window.setTimeout(() => { if (this.playing && length === undefined) { this.stop(); this.startPos = 0; this.onEnd?.(); } }, (total - fromPos + (when - ctx.currentTime)) * 1000 + 100);
  }

  mix(p: Project) {
    const t = engine.now;
    if (this.masterGain) this.masterGain.gain.setTargetAtTime(p.master, t, 0.02);
    for (const tr of p.tracks) {
      const l = this.live.get(tr.id);
      if (!l) continue;
      l.gain.gain.setTargetAtTime(audible(p, tr) ? tr.volume : 0, t, 0.02);
      l.pan.pan.setTargetAtTime(tr.pan, t, 0.02);
    }
  }

  stop() {
    clearTimeout(this.endTimer);
    if (this.playing) this.startPos = this.position();
    for (const l of this.live.values()) { try { l.src.stop(); } catch { /* */ } l.pan.disconnect(); }
    this.live.clear();
    this.playing = false;
  }
}

export const player = new ProjectPlayer();

/** Offline mixdown of all audible tracks. */
export async function mixdown(p: Project): Promise<AudioBuffer> {
  const bufs = await Promise.all(p.tracks.map((t) => decodeTrack(t)));
  const sr = engine.ctx!.sampleRate;
  let len = 0;
  p.tracks.forEach((t, i) => { len = Math.max(len, t.offsetMs / 1000 + bufs[i].duration); });
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(len * sr)), sr);
  const master = ctx.createGain();
  master.gain.value = p.master;
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -3; lim.ratio.value = 16; lim.attack.value = 0.002;
  master.connect(lim).connect(ctx.destination);
  p.tracks.forEach((t, i) => {
    if (!audible(p, t)) return;
    const s = ctx.createBufferSource();
    s.buffer = bufs[i];
    const g = ctx.createGain(); g.gain.value = t.volume;
    const pan = ctx.createStereoPanner(); pan.pan.value = t.pan;
    s.connect(g).connect(pan).connect(master);
    const off = t.offsetMs / 1000;
    if (off >= 0) s.start(off); else s.start(0, -off);
  });
  return ctx.startRendering();
}
