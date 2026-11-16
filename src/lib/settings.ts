import { useSyncExternalStore } from 'react';

export type InstrumentId = 'piano' | 'drums' | 'guitar' | 'synth' | 'percussion';

export interface FxSettings { reverb: number; delay: number; delayTime: number; feedback: number; chorus: number }

export interface Settings {
  tracking: {
    sensitivity: number; // 0..100
    smoothing: number; // 0..100
    minConfidence: number;
    swapHands: boolean;
    videoOpacity: number;
    showLandmarks: boolean;
    reach: { x0: number; x1: number; y0: number; y1: number };
    latencyMs: number;
    cameraId: string;
    calibrated: boolean;
  };
  audio: { master: number; latencyHint: 'interactive' | 'balanced' | 'playback'; outputId: string; limiter: boolean };
  piano: {
    preset: string; level: 'beginner' | 'advanced'; octave: number; octaves: 1 | 2; scale: string; key: number;
    chordAssist: 'off' | 'triad' | 'power'; sustain: 'off' | 'leftFist' | 'rightFist' | 'pinch';
    activation: 'line' | 'tap'; lineY: number; velocitySens: number; noteSens: number; glide: boolean; volume: number; fx: FxSettings;
  };
  drums: { pack: string; layout: 'standard' | 'compact' | 'lefty'; sensOffset: number; velocitySens: number; volume: number; fx: FxSettings };
  guitar: { preset: string; progression: string; custom: string[]; chordSelect: 'height' | 'pinch'; lefty: boolean; strumSens: number; volume: number; fx: FxSettings };
  synth: {
    level: 'simple' | 'advanced'; preset: string; wave: OscillatorType; octave: number; range: number; quantize: boolean; scale: string; key: number;
    yAxis: 'filter' | 'volume'; glide: number; attack: number; release: number; cutoff: number; resonance: number;
    lfoRate: number; vibrato: number; detune: number; sub: number; motionMod: number; volume: number; fx: FxSettings;
  };
  percussion: { layout: 'full' | 'latin' | 'hand' | 'electronic'; shake: boolean; sensOffset: number; volume: number; fx: FxSettings };
  metronome: { bpm: number; sig: '4/4' | '3/4' | '6/8' | '2/4' | '5/4'; volume: number; countIn: number; accent: boolean };
  backing: { style: string; volume: number; loop: boolean; includeInRecording: boolean };
}

const fx = (reverb = 0.2, delay = 0, chorus = 0): FxSettings => ({ reverb, delay, delayTime: 0.33, feedback: 0.3, chorus });

export const DEFAULTS: Settings = {
  tracking: {
    sensitivity: 55, smoothing: 50, minConfidence: 0.6, swapHands: false, videoOpacity: 0.55, showLandmarks: true,
    reach: { x0: 0.06, x1: 0.94, y0: 0.08, y1: 0.95 }, latencyMs: 70, cameraId: '', calibrated: false,
  },
  audio: { master: 0.85, latencyHint: 'interactive', outputId: '', limiter: true },
  piano: {
    preset: 'acoustic', level: 'beginner', octave: 4, octaves: 1, scale: 'major', key: 0, chordAssist: 'off', sustain: 'off',
    activation: 'line', lineY: 0.58, velocitySens: 60, noteSens: 50, glide: true, volume: 0.9, fx: fx(0.22),
  },
  drums: { pack: 'acoustic', layout: 'standard', sensOffset: 0, velocitySens: 70, volume: 0.9, fx: fx(0.12) },
  guitar: { preset: 'acoustic', progression: 'pop', custom: ['G', 'C', 'D', 'Em'], chordSelect: 'height', lefty: false, strumSens: 50, volume: 0.9, fx: fx(0.18) },
  synth: {
    level: 'simple', preset: 'warmLead', wave: 'sawtooth', octave: 4, range: 2, quantize: true, scale: 'minorPent', key: 9,
    yAxis: 'filter', glide: 0.06, attack: 0.03, release: 0.35, cutoff: 0.7, resonance: 4, lfoRate: 5, vibrato: 0.15, detune: 8, sub: 0.3,
    motionMod: 0.5, volume: 0.7, fx: fx(0.3, 0.25, 0.2),
  },
  percussion: { layout: 'full', shake: true, sensOffset: 0, volume: 0.9, fx: fx(0.15) },
  metronome: { bpm: 96, sig: '4/4', volume: 0.6, countIn: 1, accent: true },
  backing: { style: 'pop', volume: 0.55, loop: true, includeInRecording: true },
};

const KEY = 'air-studio.settings.v1';

function deepMerge<T>(base: T, over: unknown): T {
  if (typeof base !== 'object' || base === null || Array.isArray(base)) return (over === undefined ? base : (over as T));
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  if (over && typeof over === 'object') {
    for (const k of Object.keys(out)) {
      const ov = (over as Record<string, unknown>)[k];
      if (ov !== undefined && (typeof ov === typeof out[k] || out[k] === null)) out[k] = deepMerge(out[k], ov);
    }
  }
  return out as T;
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return deepMerge(DEFAULTS, JSON.parse(raw));
  } catch { /* ignore corrupt storage */ }
  return structuredClone(DEFAULTS);
}

let state: Settings = load();
const listeners = new Set<() => void>();
let saveTimer = 0;

export const settings = {
  get: () => state,
  subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  update<K extends keyof Settings>(section: K, patch: Partial<Settings[K]>) {
    state = { ...state, [section]: { ...state[section], ...patch } };
    listeners.forEach((l) => l());
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* quota */ } }, 250);
  },
  reset(section?: keyof Settings) {
    if (section) settings.update(section, structuredClone(DEFAULTS[section]));
    else { state = structuredClone(DEFAULTS); listeners.forEach((l) => l()); localStorage.removeItem(KEY); }
  },
};

export function useSettings<T>(sel: (s: Settings) => T): T {
  return useSyncExternalStore(settings.subscribe, () => sel(state));
}

export const INSTRUMENT_LABELS: Record<InstrumentId, string> = {
  piano: 'Air Piano', drums: 'Air Drums', guitar: 'Air Guitar', synth: 'Air Synth', percussion: 'Air Percussion',
};
