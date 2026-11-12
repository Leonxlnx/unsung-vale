// Tuning a spire. No longer a held key: the hero raises his blade to the spire and rings of
// light close on its shaft, one after another, each higher than the last. Strike the note
// (E, or the sword) as a ring meets the shaft and that part of the spire lights; miss and the
// ring breaks and comes again. When the last note is struck the camera pulls back and rises
// round the spire while it opens: the strands climb, the beam goes up, colour runs back out
// over the land.
import * as THREE from 'three';

const ease = (t) => t * t * (3 - 2 * t), clamp01 = (x) => Math.max(0, Math.min(1, x));
export const NOTE = [1, 9 / 8, 5 / 4, 4 / 3, 3 / 2, 5 / 3, 15 / 8, 2];
const GOLD = [3.0, 2.2, 1.0];
const _p = new THREE.Vector3(), _l = new THREE.Vector3(), _q = new THREE.Quaternion(), _d = new THREE.Vector3(), _r = new THREE.Vector3();

export class Tuning {
  constructor(game) { this.g = game; this.active = false; }

  begin(s) {
    const g = this.g, p = g.player, cam = g.pipe.camera;
    this.s = s; this.active = true; this.phase = 'approach'; this.t = 0; this.beat = 0; this.bt = -0.4; this.ring = false;
    this.total = 4 + Math.min(2, s.index);              // four notes at the first spire, six at the last
    this.period = 1.25 - 0.1 * s.index;
    this.h = s.h ?? 24;
    p.invulnerable = 1e6; p.vel.x = p.vel.z = 0; p.lockTarget = null;
    p.yaw = Math.atan2(s.x - p.pos.x, s.z - p.pos.z);
    this.from = { pos: cam.position.clone(), quat: cam.quaternion.clone(), fov: cam.fov };
    g.emit('tuning', { phase: 'begin', total: this.total });
  }

  // The view for the notes: behind the hero and off to one side, looking up the shaft.
  _beatView(outPos, outLook) {
    const s = this.s, p = this.g.player.pos;
    _d.set(p.x - s.x, 0, p.z - s.z).normalize(); _r.set(_d.z, 0, -_d.x);
    outPos.copy(p).addScaledVector(_d, 8.5).addScaledVector(_r, 3.4); outPos.y += 2.9;
    const floor = this.g.world.groundHeight(outPos.x, outPos.z) + 0.6; if (outPos.y < floor) outPos.y = floor;
    // Hero low in the frame, the shaft rising through it; the view lifts with each note.
    outLook.set(s.x, s.base + 3.2 + this.h * 0.2 * (this.beat / this.total), s.z);
  }
  _set(pos, look, fov) {
    const cam = this.g.pipe.camera;
    cam.position.copy(pos); cam.lookAt(look);
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
  }

  _ringY() { return this.s.base + 1.4 + this.h * 0.5 * (this.beat / Math.max(1, this.total - 1)); }

  update(dt) {
    const g = this.g, s = this.s, p = g.player, cam = g.pipe.camera;
    this.t += dt;
    if (this.phase === 'approach') {
      const k = ease(clamp01(this.t / 0.9));
      this._beatView(_p, _l);
      this._set(_p, _l, 64);
      cam.position.lerpVectors(this.from.pos, _p, k); cam.quaternion.copy(_q.copy(this.from.quat).slerp(cam.quaternion, k));
      if (this.t >= 0.9) { this.phase = 'beats'; this.t = 0; }
    } else if (this.phase === 'beats') {
      this._beatView(_p, _l);
      // The view breathes in a little with every note struck.
      this._set(_p, _l, 64 - 1.2 * this.beat);
      this.bt += dt;
      const y = this._ringY(), rs = 1.5;
      if (!this.ring && this.bt >= 0) {
        this.ring = true; this.bt = 0;
        g.vfx.wave(s.x, y, s.z, { r0: 11, r1: rs, life: this.period, linear: true, rise: true, strength: 0.5, width: 0.035, color: GOLD });
        g.vfx.wave(s.x, y, s.z, { r0: rs + 0.02, r1: rs, life: this.period + 0.25, linear: true, rise: true, strength: 0.2, width: 0.2, color: [1.2, 0.9, 0.4] });
        g.emit('tuning', { phase: 'beat', beat: this.beat, total: this.total, period: this.period });
      }
      if (this.ring) {
        const err = this.bt - this.period, pressed = g.input.pressed.has('interact') || g.input.pressed.has('attack');
        if (pressed && Math.abs(err) < 0.18) this._hit(y, Math.abs(err) < 0.075);
        else if (pressed && this.bt > 0.25) this._miss(y);
        else if (err > 0.24) this._miss(y);
      }
    } else if (this.phase === 'finale') {
      // Back and up, a slow quarter turn round the spire as it opens.
      const k = clamp01(this.t / 6.2), e = ease(k);
      const a = this.a0 + 1.1 * e, rad = 9 + 22 * e;
      _p.set(s.x + Math.sin(a) * rad, s.base + 3 + (this.h * 0.75 + 6) * e, s.z + Math.cos(a) * rad);
      const floor = g.world.groundHeight(_p.x, _p.z) + 1.5; if (_p.y < floor) _p.y = floor;
      _l.set(s.x, s.base + this.h * (0.35 + 0.3 * e), s.z);
      this._set(_p, _l, 56 + 6 * e);
      if (this.t < 0.8) { const w = ease(this.t / 0.8); cam.position.lerpVectors(this.from.pos, _p, w); cam.quaternion.copy(_q.copy(this.from.quat).slerp(cam.quaternion, w)); }
      // Motes pour up the shaft for as long as the view holds.
      if (Math.random() < dt * 60) { const an = Math.random() * 6.283, r = 1.5 + Math.random() * 3; g.particles.spawn(s.x + Math.cos(an) * r, s.base + Math.random() * 2, s.z + Math.sin(an) * r, { vel: [-Math.cos(an) * 0.8, 7 + Math.random() * 9, -Math.sin(an) * 0.8], life: 1.6, size: 0.08, color: [3.2, 2.4, 1.1], drag: 0.5, streak: 0.06 }); }
      if (this.t >= 6.2) { this.phase = 'return'; this.t = 0; this.from = { pos: cam.position.clone(), quat: cam.quaternion.clone(), fov: cam.fov }; g.rig.snap(p); g.rig.yaw = p.yaw; g.rig.pitch = -0.16; }
    } else if (this.phase === 'return') {
      const k = ease(clamp01(this.t / 1.3));
      g.rig.update(0, p, { look: { x: 0, y: 0 }, zoom: 0 });
      cam.position.lerpVectors(this.from.pos, cam.position, k); cam.quaternion.copy(_q.copy(this.from.quat).slerp(cam.quaternion, k));
      if (this.t >= 1.3) { this.active = false; p.invulnerable = 0.5; g.emit('tuning', { phase: 'end' }); }
    }
  }

  _hit(y, perfect) {
    const g = this.g, s = this.s;
    // The note rings: the band flares, light runs up the shaft from it, sparks leave the ring.
    g.vfx.wave(s.x, y, s.z, { r0: 1.5, r1: perfect ? 9 : 6, life: 0.5, strength: 1.2, width: 0.07, color: perfect ? [4.2, 3.2, 1.6] : GOLD });
    g.vfx.wave(s.x, y, s.z, { kind: 1, r0: 0.6, r1: 4, life: 0.4, strength: 1.0, width: 0.1, color: GOLD });
    for (let k = 0; k < 26; k++) { const a = (k / 26) * 6.283; g.particles.spawn(s.x + Math.cos(a) * 1.5, y, s.z + Math.sin(a) * 1.5, { vel: [Math.cos(a) * 5, 4 + Math.random() * 7, Math.sin(a) * 5], life: 0.8, size: 0.07, color: [4.2, 3.1, 1.4], drag: 1.4, streak: 0.1 }); }
    g.flash = Math.max(g.flash, perfect ? 0.3 : 0.18); g.rig.addShake?.(0);
    this.beat++;
    s.tuning = (this.beat / this.total) * 1.5; s.power = Math.max(s.power, 0.22 + 0.5 * (this.beat / this.total));
    g.emit('tuning', { phase: 'result', ok: true, perfect, beat: this.beat, total: this.total, pitch: NOTE[Math.min(NOTE.length - 1, this.beat - 1)] });
    this.ring = false; this.bt = -0.32;
    if (this.beat >= this.total) this._finale();
  }

  _miss(y) {
    const g = this.g, s = this.s;
    g.vfx.wave(s.x, y, s.z, { r0: 1.5, r1: 3.2, life: 0.35, strength: 0.5, width: 0.2, color: [0.5, 0.5, 0.6] });
    g.emit('tuning', { phase: 'result', ok: false, beat: this.beat, total: this.total });
    this.ring = false; this.bt = -0.55;
  }

  _finale() {
    const g = this.g, s = this.s, p = g.player, cam = g.pipe.camera;
    this.phase = 'finale'; this.t = 0;
    this.from = { pos: cam.position.clone(), quat: cam.quaternion.clone(), fov: cam.fov };
    this.a0 = Math.atan2(cam.position.x - s.x, cam.position.z - s.z);
    g._tune(s);                                   // the rules and the great effects: rings, strands, beam, colour
    g.emit('tuning', { phase: 'finale' });
    void p;
  }
}
