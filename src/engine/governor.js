// Frame-rate governor: holds a chosen frame rate by trimming the internal render resolution,
// and gives it back when there is room. Everything else in a quality preset stays as it is;
// the image is reconstructed and sharpened to the display size either way.
// It steers by the rate at which frames are actually shown, counted over short windows, and
// looks for the highest resolution that still holds the target: it steps up while the rate
// is comfortably above it, steps down when it falls short, and remembers for a while where
// it had to back off so it does not keep probing the same limit.
export class Governor {
  constructor(pipe) {
    this.pipe = pipe;
    this.target = 0;              // frames per second to hold; 0 switches the governor off
    this.max = 1; this.min = 0.55;
    this.scale = 1; this.fps = 0;
    this.t = 0; this.n = 0; this.cool = 0;
    this.ceiling = 1; this.ceilingT = 0; this.retry = 45;
    this.best = 0;                // the highest rate seen: about the display's refresh rate
    this.low = 0; this.high = 0;
  }

  // The preset's own resolution is the most the governor will ever use.
  setLimits(max, target) {
    this.max = max; this.target = target;
    this.ceiling = 1; this.ceilingT = 0; this.low = this.high = 0;
    if (!target) { if (Math.abs(this.pipe.renderScale - max) > 1e-3) this.pipe.setRenderScale(max); this.scale = max; return; }
    this.scale = Math.min(this.pipe.renderScale, max);
    if (this.pipe.renderScale > max + 1e-3) this.pipe.setRenderScale(max);
  }

  begin() {}

  end(dt) {
    if (!this.target) return;
    // A stall (a tab switch, a long load) says nothing about the frame rate.
    if (dt > 0.25) { this.t = 0; this.n = 0; return; }
    this.t += dt; this.n++; this.cool -= dt; this.ceilingT -= dt;
    if (this.t < 0.75) return;
    const fps = (this.fps = this.n / this.t);
    this.t = 0; this.n = 0;
    this.best = Math.max(this.best * 0.995, fps);
    if (this.cool > 0) return;
    if (this.ceilingT <= 0) this.ceiling = 1;                 // time to try the higher resolutions again
    const T = this.target;
    // With the display's own limit close to the target there is no "comfortably above":
    // holding the limit itself then counts as room to spare.
    const room = Math.min(T * 1.1, this.best - 1.5);
    let next = this.scale;
    if (fps < T - 2) { this.high = 0; if (++this.low >= 2 || fps < T * 0.75) next = this.scale - (fps < T * 0.75 ? 0.1 : 0.05); }
    else if (fps >= room) { this.low = 0; if (++this.high >= 2) next = this.scale + 0.05; }
    else { this.low = 0; this.high = 0; }
    next = Math.round(Math.max(this.min, Math.min(this.max, this.ceiling, next)) * 20) / 20;
    if (Math.abs(next - this.scale) < 0.01) return;
    if (next < this.scale) {
      // Backed off: stay at or below this for a while, longer each time the same limit is hit.
      this.retry = this.ceiling <= next + 0.051 ? Math.min(300, this.retry * 2) : 45;
      this.ceiling = next; this.ceilingT = this.retry;
    }
    this.scale = next; this.cool = 1.2; this.low = this.high = 0;
    this.pipe.setRenderScale(next);
  }
}
