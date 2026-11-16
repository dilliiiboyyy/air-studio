import { engine } from './engine';
import { settings } from '../lib/settings';

export interface SigInfo { beatsPerBar: number; stepsPerBeat: number; accents: number[]; unit: 4 | 8 }

export function sigInfo(sig: string): SigInfo {
  switch (sig) {
    case '3/4': return { beatsPerBar: 3, stepsPerBeat: 4, accents: [0], unit: 4 };
    case '2/4': return { beatsPerBar: 2, stepsPerBeat: 4, accents: [0], unit: 4 };
    case '5/4': return { beatsPerBar: 5, stepsPerBeat: 4, accents: [0, 3], unit: 4 };
    case '6/8': return { beatsPerBar: 6, stepsPerBeat: 2, accents: [0, 3], unit: 8 };
    default: return { beatsPerBar: 4, stepsPerBeat: 4, accents: [0], unit: 4 };
  }
}

export type StepListener = (step: number, time: number, stepDur: number) => void;

/**
 * Look-ahead scheduler (setTimeout loop + AudioContext time) driving the metronome,
 * backing tracks and practice lessons from one shared clock. Steps are 16ths (x/4) or
 * 16ths of an eighth-pulse (x/8). Negative steps are the count-in.
 */
class Transport {
  running = false;
  bpm = 96;
  sig = sigInfo('4/4');
  sigName = '4/4';
  clickOn = true;
  private anchorTime = 0;
  private anchorStep = 0;
  private nextStep = 0;
  private nextTime = 0;
  private timer = 0;
  private stepListeners = new Set<StepListener>();
  private stateListeners = new Set<() => void>();
  /** ctx time at which step 0 (bar 1, beat 1) happens. */
  zeroTime = 0;
  countInSteps = 0;

  constructor() {
    const m = settings.get().metronome;
    this.bpm = m.bpm;
    this.setSig(m.sig);
    settings.subscribe(() => {
      const mm = settings.get().metronome;
      if (mm.bpm !== this.bpm) this.setBpm(mm.bpm);
      if (mm.sig !== this.sigName && !this.running) this.setSig(mm.sig);
    });
  }

  onStep(fn: StepListener) { this.stepListeners.add(fn); return () => { this.stepListeners.delete(fn); }; }
  onState(fn: () => void) { this.stateListeners.add(fn); return () => { this.stateListeners.delete(fn); }; }
  private emitState() { this.stateListeners.forEach((f) => f()); }

  get stepDur() { return 60 / this.bpm / this.sig.stepsPerBeat; }
  get beatDur() { return 60 / this.bpm; }
  get stepsPerBar() { return this.sig.beatsPerBar * this.sig.stepsPerBeat; }

  setSig(sig: string) { this.sigName = sig; this.sig = sigInfo(sig); this.emitState(); }

  setBpm(bpm: number) {
    bpm = Math.max(30, Math.min(260, bpm));
    if (this.running) {
      // re-anchor at the next scheduled step so the grid stays continuous
      this.anchorStep = this.nextStep;
      this.anchorTime = this.nextTime;
      this.bpm = bpm;
      // zeroTime remains meaningful for the step-0 reference only through stepTime()
    } else this.bpm = bpm;
    this.emitState();
  }

  /** Time of a given step (supports bpm changes after the anchor). */
  stepTime(step: number) { return this.anchorTime + (step - this.anchorStep) * this.stepDur; }

  /** Fractional step position at ctx time t. */
  stepAt(t: number) { return this.anchorStep + (t - this.anchorTime) / this.stepDur; }

  /**
   * Start the clock. Returns the ctx time of step 0 (after count-in).
   * @param countInBars number of count-in bars (clicks always sound during count-in)
   */
  async start(countInBars = 0, click = true): Promise<number> {
    const ctx = await engine.ensure();
    if (this.running) this.stop();
    this.setSig(settings.get().metronome.sig);
    this.bpm = settings.get().metronome.bpm;
    this.clickOn = click;
    this.countInSteps = countInBars * this.stepsPerBar;
    const t0 = ctx.currentTime + 0.12;
    this.anchorStep = -this.countInSteps;
    this.anchorTime = t0;
    this.nextStep = this.anchorStep;
    this.nextTime = t0;
    this.zeroTime = this.stepTime(0);
    this.running = true;
    this.tick();
    this.emitState();
    return this.zeroTime;
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.emitState();
  }

  private tick = () => {
    if (!this.running || !engine.ctx) return;
    const horizon = engine.ctx.currentTime + 0.12;
    while (this.nextTime < horizon) {
      const step = this.nextStep;
      const time = this.nextTime;
      if (step % this.sig.stepsPerBeat === 0) {
        const beatInBar = (((step / this.sig.stepsPerBeat) % this.sig.beatsPerBar) + this.sig.beatsPerBar) % this.sig.beatsPerBar;
        if (this.clickOn || step < 0) this.click(time, this.sig.accents.includes(beatInBar) && settings.get().metronome.accent, beatInBar === 0);
      }
      this.stepListeners.forEach((f) => f(step, time, this.stepDur));
      this.nextStep++;
      this.nextTime = this.stepTime(this.nextStep);
    }
    this.timer = window.setTimeout(this.tick, 25);
  };

  private click(when: number, accent: boolean, downbeat: boolean) {
    const ctx = engine.ctx!;
    const o = ctx.createOscillator();
    o.frequency.value = downbeat && accent ? 1760 : accent ? 1320 : 1000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(accent ? 0.9 : 0.55, when + 0.001);
    g.gain.setTargetAtTime(0, when + 0.002, 0.018);
    o.connect(g).connect(engine.metroBus);
    o.start(when);
    o.stop(when + 0.15);
  }

  /** {bar, beat, frac} for UI at ctx time t. */
  position(t: number) {
    const s = this.stepAt(t);
    const beatF = s / this.sig.stepsPerBeat;
    const beat = Math.floor(beatF);
    const bar = Math.floor(beat / this.sig.beatsPerBar);
    const beatInBar = ((beat % this.sig.beatsPerBar) + this.sig.beatsPerBar) % this.sig.beatsPerBar;
    return { step: s, beat, bar, beatInBar, frac: beatF - beat, countIn: s < 0 };
  }
}

export const transport = new Transport();

export const TEMPO_PRESETS = [
  { label: 'Largo', bpm: 50 }, { label: 'Adagio', bpm: 70 }, { label: 'Andante', bpm: 90 },
  { label: 'Moderato', bpm: 110 }, { label: 'Allegro', bpm: 130 }, { label: 'Presto', bpm: 170 },
];
