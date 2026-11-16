import { useEffect, useState, useSyncExternalStore } from 'react';
import { tracker } from '../tracking/tracker';
import { engine } from '../audio/engine';
import { transport } from '../audio/transport';
import { backing } from '../audio/backing';
import { db, onDbChange, type Recording, type Project } from '../lib/db';

export function useTrackerStatus() {
  return useSyncExternalStore(tracker.onStatus.bind(tracker), () => tracker.status);
}

export function useAudioStatus() {
  return useSyncExternalStore(engine.onStatus.bind(engine), () => engine.status);
}

/** Tracker metrics + hand presence, sampled at `hz` to avoid re-rendering per frame. */
export function useTrackerLive(hz = 5) {
  const [s, setS] = useState(() => snapshot());
  useEffect(() => {
    const id = setInterval(() => setS(snapshot()), 1000 / hz);
    return () => clearInterval(id);
  }, [hz]);
  return s;
}

function snapshot() {
  const f = tracker.frame;
  const fresh = performance.now() - f.time < 400;
  return {
    ...tracker.metrics,
    left: fresh && !!f.Left,
    right: fresh && !!f.Right,
    leftHand: fresh ? f.Left : null,
    rightHand: fresh ? f.Right : null,
    status: tracker.status,
  };
}

let tv = 0;
const tSub = (fn: () => void) => {
  const a = transport.onState(() => { tv++; fn(); });
  const b = backing.onChange(() => { tv++; fn(); });
  return () => { a(); b(); };
};
export function useTransportState() {
  useSyncExternalStore(tSub, () => tv);
  return { running: transport.running, bpm: transport.bpm, sig: transport.sigName, backingOn: backing.playing, style: backing.style };
}

export function useRecordings() {
  const [list, setList] = useState<Recording[] | null>(null);
  useEffect(() => {
    const load = () => db.listRecordings().then(setList).catch(() => setList([]));
    load();
    return onDbChange(load);
  }, []);
  return list;
}

export function useProjects() {
  const [list, setList] = useState<Project[] | null>(null);
  useEffect(() => {
    const load = () => db.listProjects().then(setList).catch(() => setList([]));
    load();
    return onDbChange(load);
  }, []);
  return list;
}

export function useRaf(fn: (now: number) => void, deps: unknown[] = []) {
  useEffect(() => {
    let id = 0;
    const loop = (t: number) => { fn(t); id = requestAnimationFrame(loop); };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export const fmtBytes = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
export const fmtDate = (t: number) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
