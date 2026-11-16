import { settings } from '../lib/settings';
import { PadController, type Pad, drawHands } from './common';
import type { TrackFrame } from '../tracking/tracker';

export const DRUM_LAYOUTS: Record<string, { label: string; pads: Pad[] }> = {
  standard: {
    label: 'Standard (9 pieces)',
    pads: [
      { id: 'crash', x: 0, y: 0, w: 0.25, h: 0.3 }, { id: 'tomh', x: 0.25, y: 0, w: 0.25, h: 0.3 },
      { id: 'tomm', x: 0.5, y: 0, w: 0.25, h: 0.3 }, { id: 'ride', x: 0.75, y: 0, w: 0.25, h: 0.3 },
      { id: 'hho', x: 0, y: 0.3, w: 0.2, h: 0.36 }, { id: 'hhc', x: 0.2, y: 0.3, w: 0.22, h: 0.36 },
      { id: 'snare', x: 0.42, y: 0.3, w: 0.3, h: 0.36 }, { id: 'toml', x: 0.72, y: 0.3, w: 0.28, h: 0.36 },
      { id: 'kick', x: 0, y: 0.66, w: 1, h: 0.34 },
    ],
  },
  compact: {
    label: 'Beginner (5 large pads)',
    pads: [
      { id: 'hhc', x: 0, y: 0, w: 0.5, h: 0.36 }, { id: 'crash', x: 0.5, y: 0, w: 0.5, h: 0.36 },
      { id: 'snare', x: 0, y: 0.36, w: 0.5, h: 0.32 }, { id: 'toml', x: 0.5, y: 0.36, w: 0.5, h: 0.32 },
      { id: 'kick', x: 0, y: 0.68, w: 1, h: 0.32 },
    ],
  },
  lefty: {
    label: 'Left-handed (mirrored)',
    pads: [],
  },
};
DRUM_LAYOUTS.lefty.pads = DRUM_LAYOUTS.standard.pads.map((p) => ({ ...p, x: 1 - p.x - p.w }));

export class DrumController extends PadController {
  readonly inst = 'drums' as const;
  private layoutId = '';

  constructor() {
    super(settings.get().drums.pack);
    this.syncLayout();
  }

  private syncLayout() {
    const s = settings.get().drums;
    if (s.layout !== this.layoutId) {
      this.layoutId = s.layout;
      this.pads = DRUM_LAYOUTS[s.layout]?.pads ?? DRUM_LAYOUTS.standard.pads;
    }
    if (s.pack !== this.kit.pack) this.kit.setPack(s.pack);
  }

  sensOffset() { return settings.get().drums.sensOffset; }
  velSens() { return settings.get().drums.velocitySens; }
  preset() { return settings.get().drums.pack; }

  update(f: TrackFrame, now: number) {
    this.syncLayout();
    super.update(f, now);
  }

  draw(g: CanvasRenderingContext2D, w: number, h: number, now: number) {
    super.draw(g, w, h, now);
  }

  drawHands(g: CanvasRenderingContext2D, f: TrackFrame, w: number, h: number) { drawHands(g, f, w, h); }
}
