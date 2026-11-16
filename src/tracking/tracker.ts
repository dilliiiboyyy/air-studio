import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { OneEuro } from './filters';
import { settings } from '../lib/settings';
import { lerp } from '../lib/music';

export type HandLabel = 'Left' | 'Right';
export interface Pt { x: number; y: number }

export interface Hand {
  label: HandLabel;
  present: boolean;
  /** Screen-space (mirrored), smoothed landmarks, 0..1 */
  lm: Pt[];
  palm: Pt;
  tip: Pt;
  /** size-normalised velocities in frame-units/s (+y = downward) */
  vel: Pt;
  tipVel: Pt;
  speed: number;
  size: number;
  extended: number; // 0..4 fingers extended (excl. thumb)
  fist: boolean;
  open: boolean;
  pinch: boolean;
  score: number;
  lastSeen: number;
  /** true for the first frame after (re)appearing — velocities are not yet reliable */
  fresh: boolean;
}

export interface TrackFrame {
  time: number; // performance.now()
  hands: Hand[]; // present hands only
  Left: Hand | null;
  Right: Hand | null;
}

export type TrackerStatus = 'idle' | 'loading' | 'starting' | 'running' | 'denied' | 'nocamera' | 'inuse' | 'error' | 'sim';

export interface TrackerMetrics {
  fps: number;
  inferMs: number;
  detectRate: number; // fraction of recent frames with ≥1 hand
  handCount: number;
  brightness: number; // 0..255
  jitter: number; // 0..1 (higher = noisier)
  delegate: string;
}

const PALM = [0, 5, 9, 13, 17];
const REF_SIZE = 0.12;

class HandSlot {
  fx = Array.from({ length: 21 }, () => new OneEuro());
  fy = Array.from({ length: 21 }, () => new OneEuro());
  prevPalm: Pt | null = null;
  prevTip: Pt | null = null;
  vel: Pt = { x: 0, y: 0 };
  tipVel: Pt = { x: 0, y: 0 };
  lastT = 0;
  hand: Hand;
  history: Pt[] = [];
  constructor(label: HandLabel) {
    this.hand = {
      label, present: false, lm: [], palm: { x: 0.5, y: 0.5 }, tip: { x: 0.5, y: 0.5 }, vel: { x: 0, y: 0 }, tipVel: { x: 0, y: 0 },
      speed: 0, size: REF_SIZE, extended: 0, fist: false, open: false, pinch: false, score: 0, lastSeen: 0, fresh: true,
    };
  }
  reset() {
    this.fx.forEach((f) => f.reset());
    this.fy.forEach((f) => f.reset());
    this.prevPalm = this.prevTip = null;
    this.vel = { x: 0, y: 0 };
    this.tipVel = { x: 0, y: 0 };
    this.history = [];
  }

  update(raw: Pt[], t: number, aspect: number, score: number) {
    const gap = t - this.hand.lastSeen;
    const fresh = !this.hand.present || gap > 150;
    if (fresh) this.reset();
    const dt = Math.max(0.001, (t - (this.lastT || t - 33)) / 1000);
    this.lastT = t;
    const sm = settings.get().tracking.smoothing / 100;
    const minCut = lerp(4, 0.5, sm);
    const lm = raw.map((p, i) => {
      this.fx[i].minCutoff = this.fy[i].minCutoff = minCut;
      return { x: this.fx[i].filter(p.x, dt), y: this.fy[i].filter(p.y, dt) };
    });
    const avg = (pts: Pt[], idx: number[]) => ({ x: idx.reduce((a, i) => a + pts[i].x, 0) / idx.length, y: idx.reduce((a, i) => a + pts[i].y, 0) / idx.length });
    const rawPalm = avg(raw, PALM);
    const rawTip = raw[8];
    const d = (a: Pt, b: Pt) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);
    const size = Math.max(0.03, d(raw[0], raw[9]));
    const norm = REF_SIZE / size;
    // velocity: derivative of raw palm (low noise thanks to 5-point average) with light EMA
    const k = 0.55;
    if (this.prevPalm && !fresh) {
      const vx = ((rawPalm.x - this.prevPalm.x) / dt) * norm * aspect;
      const vy = ((rawPalm.y - this.prevPalm.y) / dt) * norm;
      this.vel = { x: this.vel.x * (1 - k) + vx * k, y: this.vel.y * (1 - k) + vy * k };
      const tvx = ((rawTip.x - this.prevTip!.x) / dt) * norm * aspect;
      const tvy = ((rawTip.y - this.prevTip!.y) / dt) * norm;
      this.tipVel = { x: this.tipVel.x * (1 - k) + tvx * k, y: this.tipVel.y * (1 - k) + tvy * k };
    }
    this.prevPalm = rawPalm;
    this.prevTip = rawTip;
    // finger extension: tip farther from wrist than PIP joint
    let ext = 0;
    for (const [tip, pip] of [[8, 6], [12, 10], [16, 14], [20, 18]]) if (d(raw[tip], raw[0]) > d(raw[pip], raw[0]) * 1.12) ext++;
    const pinch = d(raw[4], raw[8]) / size < 0.38;
    this.history.push(rawPalm);
    if (this.history.length > 12) this.history.shift();
    Object.assign(this.hand, {
      present: true, lm, palm: avg(lm, PALM), tip: lm[8], vel: this.vel, tipVel: this.tipVel,
      speed: Math.hypot(this.vel.x, this.vel.y), size, extended: ext, fist: ext <= 1 && !pinch, open: ext >= 3,
      pinch, score, lastSeen: t, fresh,
    });
  }
}

class HandTracker {
  status: TrackerStatus = 'idle';
  error = '';
  stream: MediaStream | null = null;
  private video: HTMLVideoElement;
  private landmarker: HandLandmarker | null = null;
  private loadP: Promise<HandLandmarker> | null = null;
  private slots = { Left: new HandSlot('Left'), Right: new HandSlot('Right') };
  private frameListeners = new Set<(f: TrackFrame) => void>();
  private statusListeners = new Set<() => void>();
  private running = false;
  private lastVideoTime = -1;
  private rafId = 0;
  metrics: TrackerMetrics = { fps: 0, inferMs: 0, detectRate: 0, handCount: 0, brightness: 128, jitter: 0, delegate: '' };
  private detHist: number[] = [];
  private frameTimes: number[] = [];
  private lumCanvas = document.createElement('canvas');
  private lastLum = 0;
  aspect = 4 / 3;
  // simulation
  private sim = { x: 0.6, y: 0.4, fist: false, leftY: -1, active: false, visible: false };
  private releaseTimer = 0;
  private lastFrame: TrackFrame = { time: 0, hands: [], Left: null, Right: null };

  constructor() {
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.lumCanvas.width = 32;
    this.lumCanvas.height = 24;
  }

  onFrame(fn: (f: TrackFrame) => void) { this.frameListeners.add(fn); return () => { this.frameListeners.delete(fn); }; }
  onStatus(fn: () => void) { this.statusListeners.add(fn); return () => { this.statusListeners.delete(fn); }; }
  private setStatus(s: TrackerStatus, err = '') { this.status = s; this.error = err; this.statusListeners.forEach((f) => f()); }
  get frame() { return this.lastFrame; }
  get cameraActive() { return !!this.stream; }

  private loadModel(): Promise<HandLandmarker> {
    if (this.loadP) return this.loadP;
    this.loadP = (async () => {
      const base = import.meta.env.BASE_URL;
      const fileset = await FilesetResolver.forVisionTasks(base + 'mediapipe-wasm');
      const opts = (delegate: 'GPU' | 'CPU') => ({
        baseOptions: { modelAssetPath: base + 'models/hand_landmarker.task', delegate },
        runningMode: 'VIDEO' as const,
        numHands: 2,
        minHandDetectionConfidence: settings.get().tracking.minConfidence,
        minHandPresenceConfidence: settings.get().tracking.minConfidence,
        minTrackingConfidence: 0.5,
      });
      try {
        const l = await HandLandmarker.createFromOptions(fileset, opts('GPU'));
        this.metrics.delegate = 'GPU';
        return l;
      } catch (e) {
        console.warn('GPU delegate unavailable, using CPU', e);
        const l = await HandLandmarker.createFromOptions(fileset, opts('CPU'));
        this.metrics.delegate = 'CPU';
        return l;
      }
    })();
    this.loadP.catch(() => { this.loadP = null; });
    return this.loadP;
  }

  /** Stop the camera shortly (cancelled if another view starts it again). */
  release() {
    clearTimeout(this.releaseTimer);
    this.releaseTimer = window.setTimeout(() => { if (this.sim.active) this.stopSim(); else this.stopCamera(); }, 400);
  }

  async start(): Promise<void> {
    clearTimeout(this.releaseTimer);
    if (this.running && this.stream) return;
    this.stopSim();
    this.setStatus('starting');
    if (!navigator.mediaDevices?.getUserMedia) { this.setStatus('error', 'This browser does not support camera access (a secure https:// or localhost page is required).'); return; }
    const camId = settings.get().tracking.cameraId;
    try {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: { ...(camId ? { deviceId: { exact: camId } } : { facingMode: 'user' }), width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60 } },
          audio: false,
        });
      } catch (e) {
        // relax constraints (some cameras/drivers reject them) before giving up
        if ((e as DOMException).name !== 'OverconstrainedError' && (e as DOMException).name !== 'NotFoundError') throw e;
        this.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
    } catch (e) {
      const err = e as DOMException;
      console.warn('getUserMedia failed', err.name, err.message);
      this.stream = null;
      if (err.name === 'NotAllowedError' || err.name === 'SecurityError') this.setStatus('denied', 'Camera permission was denied. Allow camera access in the browser address bar and try again.');
      else if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') this.setStatus('nocamera', 'No camera was found. Connect a webcam or use simulated hands.');
      else if (err.name === 'NotReadableError') this.setStatus('inuse', 'The camera is in use by another application. Close it and try again.');
      else this.setStatus('error', err.message || String(e));
      return;
    }
    this.video.srcObject = this.stream;
    await this.video.play().catch(() => {});
    const s = this.stream.getVideoTracks()[0]?.getSettings();
    if (s?.width && s?.height) this.aspect = s.width / s.height;
    this.setStatus('loading');
    try {
      this.landmarker = await this.loadModel();
    } catch (e) {
      this.setStatus('error', 'Hand-tracking model failed to load: ' + String(e));
      this.stopCamera();
      return;
    }
    this.running = true;
    this.setStatus('running');
    this.loop();
  }

  private loop = () => {
    if (!this.running) return;
    const v = this.video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => { this.process(); this.loop(); });
    else this.rafId = requestAnimationFrame(() => { this.process(); this.loop(); });
  };

  private process() {
    if (!this.landmarker || this.video.readyState < 2) return;
    if (this.video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = this.video.currentTime;
    const now = performance.now();
    const t0 = now;
    let res;
    try { res = this.landmarker.detectForVideo(this.video, now); } catch (e) { console.warn(e); return; }
    this.metrics.inferMs = this.metrics.inferMs * 0.9 + (performance.now() - t0) * 0.1;
    if (this.video.videoWidth) this.aspect = this.video.videoWidth / this.video.videoHeight;
    const swap = settings.get().tracking.swapHands;
    const found: { label: HandLabel; pts: Pt[]; score: number }[] = res.landmarks.map((lm, i) => {
      const cat = res.handedness[i]?.[0];
      // MediaPipe assumes mirrored input; our frames are raw camera frames, so its label is the opposite hand.
      let label: HandLabel = cat?.categoryName === 'Left' ? 'Right' : 'Left';
      if (swap) label = label === 'Left' ? 'Right' : 'Left';
      return { label, pts: lm.map((p) => ({ x: 1 - p.x, y: p.y })), score: cat?.score ?? 0 };
    });
    this.ingest(found, now);
    this.measure(now);
  }

  private ingest(found: { label: HandLabel; pts: Pt[]; score: number }[], now: number) {
    if (found.length === 2 && found[0].label === found[1].label) {
      // conflicting labels: decide by screen side
      const [a, b] = found[0].pts[0].x < found[1].pts[0].x ? [found[0], found[1]] : [found[1], found[0]];
      a.label = 'Left'; b.label = 'Right';
    } else if (found.length === 1) {
      // label stickiness: keep identity when the hand hasn't moved far but the classifier flipped
      const f = found[0];
      const other = this.slots[f.label === 'Left' ? 'Right' : 'Left'].hand;
      const same = this.slots[f.label].hand;
      if (other.present && !same.present && Math.hypot(other.palm.x - f.pts[9].x, other.palm.y - f.pts[9].y) < 0.12) f.label = other.label;
    }
    const seen = new Set<HandLabel>();
    for (const f of found) { this.slots[f.label].update(f.pts, now, this.aspect, f.score); seen.add(f.label); }
    for (const l of ['Left', 'Right'] as HandLabel[]) {
      const h = this.slots[l].hand;
      if (!seen.has(l) && h.present) { h.present = false; h.vel = { x: 0, y: 0 }; h.tipVel = { x: 0, y: 0 }; }
    }
    const L = this.slots.Left.hand.present ? this.slots.Left.hand : null;
    const R = this.slots.Right.hand.present ? this.slots.Right.hand : null;
    const frame: TrackFrame = { time: now, hands: [L, R].filter(Boolean) as Hand[], Left: L, Right: R };
    this.lastFrame = frame;
    this.frameListeners.forEach((fn) => fn(frame));
  }

  private measure(now: number) {
    this.frameTimes.push(now);
    while (this.frameTimes.length && now - this.frameTimes[0] > 1000) this.frameTimes.shift();
    this.metrics.fps = this.frameTimes.length;
    const n = this.lastFrame.hands.length;
    this.metrics.handCount = n;
    this.detHist.push(n);
    if (this.detHist.length > 60) this.detHist.shift();
    this.metrics.detectRate = this.detHist.filter((x) => x > 0).length / this.detHist.length;
    // jitter: label flips in hand count over recent frames + palm noise
    let flips = 0;
    for (let i = 1; i < this.detHist.length; i++) if (this.detHist[i] !== this.detHist[i - 1]) flips++;
    this.metrics.jitter = Math.min(1, flips / 12);
    if (now - this.lastLum > 500) {
      this.lastLum = now;
      const c = this.lumCanvas.getContext('2d', { willReadFrequently: true });
      if (c) {
        c.drawImage(this.video, 0, 0, 32, 24);
        const d = c.getImageData(0, 0, 32, 24).data;
        let s = 0;
        for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        this.metrics.brightness = s / (d.length / 4);
      }
    }
  }

  stopCamera() {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.slots.Left.hand.present = false;
    this.slots.Right.hand.present = false;
    if (this.status !== 'denied' && this.status !== 'nocamera' && this.status !== 'error' && this.status !== 'inuse') this.setStatus('idle');
  }

  // ---------- simulated hands (mouse/keyboard) ----------
  private simTimer = 0;
  startSim() {
    clearTimeout(this.releaseTimer);
    if (this.sim.active) return;
    this.stopCamera();
    this.sim.active = true;
    this.setStatus('sim');
    clearInterval(this.simTimer);
    this.simTimer = window.setInterval(() => this.simTick(), 1000 / 60);
  }
  stopSim() {
    if (!this.sim.active) return;
    this.sim.active = false;
    clearInterval(this.simTimer);
    this.slots.Left.hand.present = false;
    this.slots.Right.hand.present = false;
    if (this.status === 'sim') this.setStatus('idle');
  }
  get simulating() { return this.sim.active; }
  simPointer(x: number, y: number) { this.sim.x = x; this.sim.y = y; this.sim.visible = true; }
  simHide() { this.sim.visible = false; }
  simFist(on: boolean) { this.sim.fist = on; }
  simLeft(y: number) { this.sim.leftY = y; }

  private simTick() {
    const now = performance.now();
    const mk = (cx: number, cy: number, fist: boolean): Pt[] => {
      // synthetic 21-point hand around (cx, cy); index tip at (cx, cy)
      const s = 0.07;
      const pts: Pt[] = [];
      const base = { x: cx, y: cy + s * 2.2 };
      pts.push(base);
      const fingerX = [-0.9, -0.35, 0, 0.35, 0.7];
      for (let f = 0; f < 5; f++) {
        for (let j = 1; j <= 4; j++) {
          const ext = fist && f > 0 ? Math.min(j, 2) * 0.35 : j;
          pts.push({ x: base.x + fingerX[f] * s * (f === 0 ? 0.6 + j * 0.25 : 1), y: base.y - s * (f === 0 ? 0.6 + j * 0.2 : 0.9 + ext * 0.38) });
        }
      }
      // align index tip with the pointer
      const dx = cx - pts[8].x, dy = cy - pts[8].y;
      return pts.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    };
    const found: { label: HandLabel; pts: Pt[]; score: number }[] = [];
    if (this.sim.visible) found.push({ label: 'Right', pts: mk(this.sim.x, this.sim.y, this.sim.fist), score: 1 });
    if (this.sim.leftY >= 0) found.push({ label: 'Left', pts: mk(0.22, this.sim.leftY, false), score: 1 });
    this.aspect = 4 / 3;
    // simulated hands bypass smoothing noise but share the full feature pipeline
    this.ingest(found, now);
    Object.assign(this.metrics, { fps: 60, detectRate: 1, handCount: found.length, brightness: 140, jitter: 0, delegate: 'Simulated' });
  }
}

export const tracker = new HandTracker();

export function strikeThreshold(sensOffset = 0) {
  const s = Math.max(0, Math.min(100, settings.get().tracking.sensitivity + sensOffset)) / 100;
  return lerp(2.6, 0.55, s);
}

/** Map a screen-space point into the calibrated reach box (0..1). */
export function toReach(p: Pt): Pt {
  const r = settings.get().tracking.reach;
  return { x: (p.x - r.x0) / Math.max(0.1, r.x1 - r.x0), y: (p.y - r.y0) / Math.max(0.1, r.y1 - r.y0) };
}
export function fromReach(p: Pt): Pt {
  const r = settings.get().tracking.reach;
  return { x: r.x0 + p.x * (r.x1 - r.x0), y: r.y0 + p.y * (r.y1 - r.y0) };
}
