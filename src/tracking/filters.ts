/** One-Euro filter (Casiez et al. 2012): adaptive low-pass — smooth when slow, responsive when fast. */
export class OneEuro {
  private x: number | null = null;
  private dx = 0;
  constructor(public minCutoff = 1.2, public beta = 6, public dCutoff = 1.0) {}
  private alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  reset() { this.x = null; this.dx = 0; }
  filter(v: number, dt: number): number {
    if (this.x === null || dt <= 0) { this.x = v; return v; }
    const d = (v - this.x) / dt;
    const ad = this.alpha(this.dCutoff, dt);
    this.dx = ad * d + (1 - ad) * this.dx;
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    const a = this.alpha(cutoff, dt);
    this.x = a * v + (1 - a) * this.x;
    return this.x;
  }
}
