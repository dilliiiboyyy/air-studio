import type { PlayEvent } from './events';
import type { InstrumentId } from './settings';
import type { PerformanceReport } from '../practice/scoring';

export interface Recording {
  id: string;
  name: string;
  instrument: InstrumentId;
  preset: string;
  createdAt: number;
  duration: number;
  sampleRate: number;
  wav: Blob;
  events: PlayEvent[];
  bpm?: number;
  sig?: string;
  gridDefined?: boolean;
  backing?: string;
  report?: PerformanceReport;
}

export interface Track {
  id: string;
  name: string;
  instrument: InstrumentId;
  preset: string;
  volume: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  offsetMs: number;
  wav: Blob;
  events: PlayEvent[];
  duration: number;
  quantized?: boolean;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  bpm: number;
  sig: string;
  master: number;
  tracks: Track[];
}

const DB_NAME = 'air-studio';
let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('recordings')) db.createObjectStore('recordings', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => { dbp = null; rej(r.error); };
  });
  return dbp;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) => new Promise<T>((res, rej) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => res(req.result);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error ?? new Error('Transaction aborted'));
  }));
}

const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());
export const onDbChange = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

export const db = {
  async listRecordings(): Promise<Recording[]> {
    const all = await tx<Recording[]>('recordings', 'readonly', (s) => s.getAll() as IDBRequest<Recording[]>);
    return all.sort((a, b) => b.createdAt - a.createdAt);
  },
  getRecording: (id: string) => tx<Recording | undefined>('recordings', 'readonly', (s) => s.get(id)),
  async putRecording(r: Recording) { await tx('recordings', 'readwrite', (s) => s.put(r)); changed(); },
  async deleteRecording(id: string) { await tx('recordings', 'readwrite', (s) => s.delete(id)); changed(); },
  async listProjects(): Promise<Project[]> {
    const all = await tx<Project[]>('projects', 'readonly', (s) => s.getAll() as IDBRequest<Project[]>);
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  },
  getProject: (id: string) => tx<Project | undefined>('projects', 'readonly', (s) => s.get(id)),
  async putProject(p: Project) { await tx('projects', 'readwrite', (s) => s.put(p)); changed(); },
  async deleteProject(id: string) { await tx('projects', 'readwrite', (s) => s.delete(id)); changed(); },
  async clearAll() {
    await tx('recordings', 'readwrite', (s) => s.clear());
    await tx('projects', 'readwrite', (s) => s.clear());
    changed();
  },
  async usage(): Promise<{ usage: number; quota: number } | null> {
    if (!navigator.storage?.estimate) return null;
    const e = await navigator.storage.estimate();
    return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
  },
};

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const safeName = (s: string) => s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'recording';
