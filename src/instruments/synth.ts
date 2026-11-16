import { settings } from '../lib/settings';
import { scaleNotes, noteName, uid } from '../lib/music';
import { engine } from '../audio/engine';
import { SynthVoice } from '../audio/instruments/synth';
import { playBus } from '../lib/events';
import type { HandLabel, TrackFrame } from '../tracking/tracker';
import { fromReach, toReach } from '../tracking/tracker';
import { Debounce } from '../tracking/gestures';
import { C, type Controller } from './common';

interface VState { voice: SynthVoice; noteId: string | null; midi: number; pitch: number; mod: number; bright: number; level: number }

export class SynthController implements Controller {
  readonly inst = 'synth' as const;
  private v: Partial<Record<HandLabel, VState>> = {};
  private gate = { Left: new Debounce(60, 90), Right: new Debounce(60, 90) };
  private lastSeen = { Left: 0, Right: 0 };
  private targets: string[] = [];
  private current = '';
  private ctrl = { volume: 0.8, mod: 0 };

  async load() { /* fully synthesised */ }

  private range() {
    const s = settings.get().synth;
    const lo = 12 * (s.octave + 1) + s.key;
    return { lo, hi: lo + 12 * s.range, scale: scaleNotes(s.key, s.scale, lo, lo + 12 * s.range) };
  }

  private voiceFor(l: HandLabel): VState {
    let st = this.v[l];
    if (!st) {
      st = { voice: new SynthVoice(engine.ctx!, engine.instFx.input, settings.get().synth), noteId: null, midi: 0, pitch: 60, mod: 0, bright: 0.5, level: 0.8 };
      this.v[l] = st;
    }
    return st;
  }

  private endNote(st: VState) {
    if (st.noteId) { playBus.emitRelease({ id: st.noteId, t: engine.now }); st.noteId = null; }
  }

  private startNote(st: VState, l: HandLabel) {
    st.noteId = uid();
    playBus.emit({ t: engine.now, inst: 'synth', kind: 'note', midi: st.midi, notes: [st.midi], vel: st.level, id: st.noteId, hand: l, preset: settings.get().synth.preset });
  }

  update(f: TrackFrame, now: number) {
    const s = settings.get().synth;
    const { lo, hi, scale } = this.range();
    const players: HandLabel[] = s.level === 'simple' ? ['Left', 'Right'] : ['Right'];
    // advanced: left hand is a controller (height = volume, x = modulation depth)
    if (s.level === 'advanced') {
      const lh = f.Left;
      if (lh) {
        const r = toReach(lh.palm);
        this.ctrl.volume = Math.max(0, Math.min(1, 1 - r.y));
        this.ctrl.mod = Math.max(0, Math.min(1, r.x * 1.6));
      }
      if (this.v.Left) { this.v.Left.voice.noteOff(); this.endNote(this.v.Left); }
    } else { this.ctrl.volume = 0.85; this.ctrl.mod = 0; }

    for (const l of players) {
      const h = f[l];
      const st = this.voiceFor(l);
      st.voice.apply(s);
      if (!h) {
        if (st.voice.gate && now - this.lastSeen[l] > 160) { st.voice.noteOff(); this.endNote(st); }
        continue;
      }
      this.lastSeen[l] = now;
      const r = toReach(l === 'Right' || s.level === 'simple' ? h.tip : h.palm);
      const x = Math.max(0, Math.min(1, r.x));
      const y = Math.max(0, Math.min(1, r.y));
      let pitch = lo + x * (hi - lo);
      if (s.quantize && scale.length) {
        const idx = Math.min(scale.length - 1, Math.floor(x * scale.length));
        pitch = scale[idx];
      }
      const midi = Math.round(pitch);
      const height = 1 - y;
      st.mod = st.mod * 0.85 + Math.min(1, h.speed / 4) * 0.15;
      const mod = Math.min(1, st.mod * s.motionMod * 2 + this.ctrl.mod);
      st.bright = s.yAxis === 'filter' ? height : 0.85;
      st.level = (s.yAxis === 'volume' ? height : 0.85) * this.ctrl.volume;
      st.pitch = pitch;
      st.voice.set(pitch, st.bright, st.level, mod);
      const open = this.gate[l].update(h.extended >= 2 && !h.fist, now);
      if (open && !st.voice.gate) {
        st.voice.noteOn(0.8);
        st.midi = midi;
        this.startNote(st, l);
      } else if (!open && st.voice.gate) {
        st.voice.noteOff();
        this.endNote(st);
      } else if (open && midi !== st.midi) {
        // pitch moved to a new note: log as a new event (legato in audio)
        this.endNote(st);
        st.midi = midi;
        this.startNote(st, l);
      }
      if (open) this.current = noteName(midi);
    }
  }

  draw(g: CanvasRenderingContext2D, w: number, h: number, now: number) {
    void now;
    const s = settings.get().synth;
    const { lo, hi, scale } = this.range();
    const r0 = fromReach({ x: 0, y: 0 }), r1 = fromReach({ x: 1, y: 1 });
    const x0 = r0.x * w, x1 = r1.x * w, top = r0.y * h, bot = r1.y * h;
    const tset = new Set(this.targets.map(Number));
    g.textAlign = 'center';
    if (s.quantize) {
      const zw = (x1 - x0) / scale.length;
      scale.forEach((m, i) => {
        const x = x0 + i * zw;
        g.fillStyle = i % 2 ? 'rgba(242,240,234,0.035)' : 'rgba(242,240,234,0.07)';
        g.fillRect(x, top, zw, bot - top);
        g.fillStyle = tset.has(m) ? C.green : m % 12 === s.key ? C.accent : C.text2;
        g.font = `600 ${Math.max(9, Math.min(13, zw / 3))}px Inter, system-ui, sans-serif`;
        g.fillText(noteName(m), x + zw / 2, bot - 8);
      });
    } else {
      for (let m = lo; m <= hi; m++) {
        const x = x0 + ((m - lo) / (hi - lo)) * (x1 - x0);
        g.strokeStyle = m % 12 === s.key ? 'rgba(214,138,72,0.45)' : 'rgba(242,240,234,0.12)';
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(x, top); g.lineTo(x, bot); g.stroke();
        if (m % 12 === s.key) { g.fillStyle = C.accent; g.font = '600 11px Inter, system-ui, sans-serif'; g.fillText(noteName(m), x, bot - 8); }
      }
    }
    // axis labels
    g.save();
    g.fillStyle = C.text2;
    g.font = '500 11px Inter, system-ui, sans-serif';
    g.textAlign = 'left';
    g.fillText(`↑ ${s.yAxis === 'filter' ? 'BRIGHTER' : 'LOUDER'}`, x0 + 6, top + 16);
    g.fillText('← LOWER PITCH · HIGHER PITCH →', x0 + 6, top + 32);
    g.fillText('Open hand = sound · Fist = silence · Move faster = more vibrato', x0 + 6, top + 48);
    g.restore();
    // voice markers
    for (const [l, st] of Object.entries(this.v) as [HandLabel, VState][]) {
      if (!st.voice.gate) continue;
      const x = x0 + ((st.pitch - lo) / (hi - lo)) * (x1 - x0);
      g.strokeStyle = l === 'Left' ? C.left : C.accent;
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(x, top); g.lineTo(x, bot); g.stroke();
      g.fillStyle = l === 'Left' ? C.left : C.accent;
      g.font = '600 14px Inter, system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText(noteName(st.midi), x, top + 70);
    }
    if (s.level === 'advanced') {
      // left-hand control meters
      const mx = x0 + 6, my = bot - 120;
      g.fillStyle = 'rgba(21,21,21,0.6)';
      g.fillRect(mx, my, 120, 90);
      g.fillStyle = C.text2;
      g.font = '500 10px Inter, system-ui, sans-serif';
      g.textAlign = 'left';
      g.fillText('LEFT HAND', mx + 8, my + 16);
      g.fillText('Volume', mx + 8, my + 38);
      g.fillText('Mod', mx + 8, my + 66);
      g.fillStyle = C.left;
      g.fillRect(mx + 50, my + 30, 60 * this.ctrl.volume, 8);
      g.fillRect(mx + 50, my + 58, 60 * this.ctrl.mod, 8);
    }
  }

  setTargets(k: string[]) { this.targets = k; }
  label(k: string) { return noteName(Number(k)); }
  readout() { return Object.values(this.v).some((s) => s?.voice.gate) ? this.current : ''; }
  panic() {
    for (const st of Object.values(this.v)) if (st) { st.voice.noteOff(); this.endNote(st); }
  }
  dispose() {
    for (const st of Object.values(this.v)) if (st) { this.endNote(st); st.voice.dispose(); }
    this.v = {};
  }
}
