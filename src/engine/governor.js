// Frame-rate governor: holds a chosen frame rate by trimming the internal render resolution,
// and gives it back when there is room. Everything else in a quality preset stays as it is;
// the image is reconstructed and sharpened to the display size either way.
// The cost of a frame is read from GPU timer queries where the browser offers them, and
// from the time between frames otherwise.
export class Governor {
  constructor(pipe) {
    this.pipe = pipe;
    this.target = 0;              // frames per second to hold; 0 switches the governor off
    this.max = 1; this.min = 0.55;
    this.scale = 1; this.gpu = 0; this.frame = 0;
    this.since = 0; this.cool = 0; this.ceiling = 1; this.ceilingT = 0;
    const gl = (this.gl = pipe.renderer.getContext());
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.pending = []; this.active = null;
  }

  // The preset's own resolution is the most the governor will ever use.
  setLimits(max, target) {
    this.max = max; this.target = target;
    if (!target) { this.ceiling = 1; if (Math.abs(this.pipe.renderScale - max) > 1e-3) this.pipe.setRenderScale(max); this.scale = max; return; }
    this.scale = Math.min(this.pipe.renderScale, max);
    if (this.pipe.renderScale > max + 1e-3) this.pipe.setRenderScale(max);
  }

  begin() {
    if (!this.ext || !this.target || this.active || this.pending.length > 3) return;
    this.active = this.gl.createQuery();
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, this.active);
  }

  end(dt) {
    const gl = this.gl;
    if (this.active) { gl.endQuery(this.ext.TIME_ELAPSED_EXT); this.pending.push(this.active); this.active = null; }
    // Collect whichever measurements have arrived.
    while (this.pending.length && gl.getQueryParameter(this.pending[0], gl.QUERY_RESULT_AVAILABLE)) {
      const q = this.pending.shift();
      if (!gl.getParameter(this.ext.GPU_DISJOINT_EXT)) { const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; this.gpu = this.gpu ? this.gpu + (ms - this.gpu) * 0.12 : ms; }
      gl.deleteQuery(q);
    }
    if (!this.target) return;
    const ms = Math.min(100, dt * 1000);
    this.frame = this.frame ? this.frame + (ms - this.frame) * 0.08 : ms;
    this.since += dt; this.cool -= dt; this.ceilingT -= dt;
    if (this.ceilingT <= 0) this.ceiling = 1;                 // try the higher resolutions again now and then
    if (this.since < 0.5 || this.cool > 0) return;
    this.since = 0;
    const period = 1000 / this.target;
    let next = this.scale;
    if (this.gpu > 0) {
      // Leave room in the frame for the CPU's share and the compositor.
      const budget = period * 0.8;
      if (this.gpu > budget * 1.05) next = this.scale - (this.gpu > budget * 1.3 ? 0.1 : 0.05);
      else if (this.gpu < budget * 0.82) next = this.scale + 0.05;
    } else if (this.frame > period * 1.1) { next = this.scale - (this.frame > period * 1.4 ? 0.1 : 0.05); this.ceiling = Math.max(this.min, next); this.ceilingT = 25; }
    else if (this.frame < period * 0.97) next = this.scale + 0.05;
    next = Math.round(Math.max(this.min, Math.min(this.max, this.ceiling, next)) * 20) / 20;
    if (Math.abs(next - this.scale) < 0.01) return;
    this.scale = next; this.cool = 1.2; this.gpu = 0; this.frame = 0;
    this.pipe.setRenderScale(next);
  }
}
