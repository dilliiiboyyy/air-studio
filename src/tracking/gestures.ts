import type { Hand, Pt } from './tracker';

/**
 * Downward "air tap" detector. Fires on the frame the downward velocity crosses the
 * threshold (lowest latency), then requires the hand to slow or reverse before re-arming,
 * plus a short refractory window — so a hand held still or moving slowly never retriggers.
 */
export class StrikeDetector {
  private armed = true;
  private lastHit = -1e9;
  peak = 0;
  constructor(public minIntervalMs = 70) {}

  update(h: Hand, now: number, threshold: number, useTip = false): { vel: number; at: Pt } | null {
    if (!h.present || h.fresh) { this.armed = true; return null; }
    const v = useTip ? h.tipVel : h.vel;
    this.peak = Math.max(v.y, this.peak * 0.9);
    if (!this.armed) {
      if (v.y < threshold * 0.35 && now - this.lastHit > this.minIntervalMs) this.armed = true;
      return null;
    }
    // reject mostly-horizontal swipes
    if (v.y > threshold && v.y > Math.abs(v.x) * 0.8 && now - this.lastHit > this.minIntervalMs) {
      this.armed = false;
      this.lastHit = now;
      const p = useTip ? h.tip : h.palm;
      // aim point: where the stroke is heading ~50 ms later (the stroke started above the pad)
      const at = { x: p.x, y: p.y + (v.y * 0.05 * h.size) / 0.12 };
      return { vel: v.y, at };
    }
    return null;
  }

  reset() { this.armed = true; }
}

/** Bidirectional strum detector (downstrokes and upstrokes). */
export class StrumDetector {
  private armedDir: 'any' | 'down' | 'up' = 'any';
  private lastT = -1e9;
  constructor(public minIntervalMs = 55) {}

  update(h: Hand, now: number, threshold: number): { dir: 'down' | 'up'; speed: number } | null {
    if (!h.present || h.fresh) { this.armedDir = 'any'; return null; }
    const vy = h.vel.y;
    if (now - this.lastT < this.minIntervalMs) return null;
    if (vy > threshold && this.armedDir !== 'up') {
      this.armedDir = 'up'; this.lastT = now;
      return { dir: 'down', speed: vy };
    }
    if (vy < -threshold * 0.85 && this.armedDir !== 'down') {
      this.armedDir = 'down'; this.lastT = now;
      return { dir: 'up', speed: -vy };
    }
    // a pause re-arms both directions (allows down-down-down strumming)
    if (Math.abs(vy) < threshold * 0.25) this.armedDir = 'any';
    return null;
  }
}

/** Shake detector: horizontal direction reversals at speed. */
export class ShakeDetector {
  private lastSign = 0;
  private peak = 0;
  private lastT = -1e9;
  update(h: Hand, now: number, threshold: number): number | null {
    if (!h.present || h.fresh) { this.lastSign = 0; this.peak = 0; return null; }
    const vx = h.vel.x;
    const sign = Math.abs(vx) > threshold ? Math.sign(vx) : 0;
    this.peak = Math.max(this.peak, Math.abs(vx));
    if (sign !== 0 && sign !== this.lastSign) {
      const had = this.lastSign !== 0;
      this.lastSign = sign;
      if (had && now - this.lastT > 60) {
        this.lastT = now;
        const p = this.peak;
        this.peak = 0;
        return p;
      }
    }
    return null;
  }
}

/** Boolean with hysteresis over time (avoids flicker for fist/pinch). */
export class Debounce {
  value = false;
  private since = 0;
  constructor(private onMs = 90, private offMs = 140) {}
  update(raw: boolean, now: number) {
    if (raw === this.value) { this.since = now; return this.value; }
    if (now - this.since > (raw ? this.onMs : this.offMs)) { this.value = raw; this.since = now; }
    return this.value;
  }
}

/** Map vertical speed to a 0..1 velocity, blending with a fixed level by `sens` (0..100). */
export function speedToVelocity(speed: number, threshold: number, sens: number) {
  const dyn = Math.max(0.15, Math.min(1, 0.35 + ((speed - threshold) / (threshold * 2.2)) * 0.65));
  const s = sens / 100;
  return 0.75 * (1 - s) + dyn * s;
}
