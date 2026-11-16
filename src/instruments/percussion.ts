import { settings } from '../lib/settings';
import { PadController, type Pad, C } from './common';
import type { TrackFrame } from '../tracking/tracker';
import { strikeThreshold } from '../tracking/tracker';
import { ShakeDetector, Debounce } from '../tracking/gestures';

const grid = (ids: string[], cols: number): Pad[] => {
  const rows = Math.ceil(ids.length / cols);
  return ids.map((id, i) => ({ id, x: (i % cols) / cols, y: Math.floor(i / cols) / rows, w: 1 / cols, h: 1 / rows }));
};

export const PERC_LAYOUTS: Record<string, { label: string; pads: Pad[] }> = {
  full: { label: 'Full set (12)', pads: grid(['bongoHi', 'bongoLo', 'congaSlap', 'congaOpen', 'tambourine', 'clap', 'cowbell', 'congaLow', 'shaker', 'eClap', 'eRim', 'eZap'], 4) },
  latin: { label: 'Latin (bongos, congas, cowbell)', pads: grid(['bongoHi', 'bongoLo', 'cowbell', 'congaSlap', 'congaOpen', 'congaLow'], 3) },
  hand: { label: 'Hand percussion', pads: grid(['tambourine', 'clap', 'shaker', 'cowbell'], 2) },
  electronic: { label: 'Electronic', pads: grid(['eClap', 'eRim', 'eClave', 'eConga', 'eZap', 'clap'], 3) },
};

export class PercussionController extends PadController {
  readonly inst = 'percussion' as const;
  private shake = { Left: new ShakeDetector(), Right: new ShakeDetector() };
  private fist = { Left: new Debounce(), Right: new Debounce() };
  private shaking = { Left: 0, Right: 0 };

  constructor() {
    super('acoustic');
    this.pads = PERC_LAYOUTS[settings.get().percussion.layout]?.pads ?? PERC_LAYOUTS.full.pads;
  }

  sensOffset() { return settings.get().percussion.sensOffset; }
  velSens() { return 70; }
  preset() { return settings.get().percussion.layout; }

  update(f: TrackFrame, now: number) {
    const s = settings.get().percussion;
    this.pads = PERC_LAYOUTS[s.layout]?.pads ?? PERC_LAYOUTS.full.pads;
    if (s.shake) {
      const thr = strikeThreshold(s.sensOffset) * 0.9;
      for (const hand of f.hands) {
        const closed = this.fist[hand.label].update(hand.fist, now);
        if (!closed) continue;
        const sh = this.shake[hand.label].update(hand, now, thr);
        if (sh !== null) {
          this.trigger('shaker', Math.min(1, 0.35 + sh / (thr * 4)), hand.label, now);
          this.shaking[hand.label] = now;
        }
      }
      // closed hands only shake; open hands strike pads
      const open = { ...f, hands: f.hands.filter((h) => !this.fist[h.label].value) };
      super.update(open, now);
    } else super.update(f, now);
  }

  draw(g: CanvasRenderingContext2D, w: number, h: number, now: number) {
    super.draw(g, w, h, now);
    if (settings.get().percussion.shake) {
      const active = now - Math.max(this.shaking.Left, this.shaking.Right) < 250;
      g.font = '600 12px Inter, system-ui, sans-serif';
      g.textAlign = 'left';
      g.fillStyle = active ? C.accent : C.text2;
      g.fillText(active ? 'SHAKER ●' : 'Make a fist and shake side to side for shaker', 14, h - 14);
    }
  }
}
