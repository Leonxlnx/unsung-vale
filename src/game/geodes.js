// Song-crystals. Where the old song pooled in the ground it grew into small clusters of
// amber shards, out in the meadows of every mesa. A cut of the blade breaks one open and what
// it held goes to the hero: a little resonance, and now and then a refrain.
import * as THREE from 'three';
import { settle } from './reliquaries.js';

const VERT = /* glsl */ `
in vec2 iGem;     // phase, and how whole it is (1 standing, 0 gone)
uniform float uTime;
out vec3 vWorld; out float vPhase;
void main() {
  vec3 p = position * iGem.y;
  vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vWorld = w.xyz; vPhase = iGem.x;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const FRAG = /* glsl */ `
uniform float uTime;
in vec3 vWorld; in float vPhase;
void main() {
  vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld))), V = normalize(cameraPosition - vWorld);
  float f = pow(1.0 - abs(dot(N, V)), 2.0), sun = 0.5 + 0.5 * clamp(dot(N, normalize(vec3(0.5, 0.45, 0.74))), 0.0, 1.0);
  float pulse = 0.75 + 0.25 * sin(uTime * 1.7 + vPhase);
  vec3 body = vec3(0.5, 0.3, 0.1) * sun;
  gl_FragColor = vec4(body + vec3(1.0, 0.68, 0.26) * (0.25 + 2.4 * f) * pulse, 1.0);
}`;

const PER = 6;      // shards to a cluster

export class Geodes {
  constructor(game, pipe) {
    this.g = game; this.pipe = pipe; this.list = [];
    const W = game.world, broken = game.geodesBroken ?? [];
    const rnd = (() => { let s = 7741; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();
    const taken = [...(game.bells?.list ?? []), ...(game.reliquaries?.list ?? []), ...(game.chimes?.list ?? []), ...(game.trials?.list ?? [])].map((q) => [q.x, q.z]);
    const centres = [[game.sites.spawn.x - 30, game.sites.spawn.z], ...game.spires.map((s) => [s.x, s.z])];
    for (const [cx, cz] of centres) {
      const h0 = W.groundHeight(cx, cz), a0 = rnd() * 6.283;
      for (let k = 0; k < 4; k++) {
        const a = a0 + k * 1.571 + (rnd() - 0.5) * 0.7, r = 48 + rnd() * 62, x0 = cx + Math.cos(a) * r, z0 = cz + Math.sin(a) * r;
        if (Math.abs(W.groundHeight(x0, z0) - h0) > 7) continue;                       // off the mesa
        W.stream(x0, z0, 4);
        const [x, z] = settle(W, x0, z0, 6), y = W.groundHeight(x, z);
        if (Math.abs(y - h0) > 7 || Number.isFinite(W.waterLevel(x, z)) || W.floorBelow(x, y + 12, z, 16) > y + 0.2) continue;
        if (taken.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 11)) continue;
        taken.push([x, z]);
        this.list.push({ i: this.list.length, x, y, z, k: 1, gone: false });
      }
    }
    for (const q of this.list) if (broken.includes(q.i)) { q.gone = true; q.k = 0; }
    // One draw for every shard of every cluster.
    const geo = new THREE.OctahedronGeometry(1, 0).scale(0.17, 0.74, 0.17).translate(0, 0.62, 0);
    const n = this.list.length * PER, gem = new Float32Array(n * 2);
    geo.setAttribute('iGem', new THREE.InstancedBufferAttribute(gem, 2));
    this.mesh = new THREE.InstancedMesh(geo, new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { uTime: pipe.globals.uTime } }), n);
    this.mesh.frustumCulled = false;
    const m = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
    this.list.forEach((c, ci) => {
      for (let j = 0; j < PER; j++) {
        const a = (j / PER) * 6.283 + rnd() * 0.8, lean = j === 0 ? 0.08 : 0.35 + rnd() * 0.45, sc = j === 0 ? 1.5 : 0.6 + rnd() * 0.7, rr = j === 0 ? 0 : 0.14 + rnd() * 0.12;
        m.compose(p.set(c.x + Math.cos(a) * rr, c.y - 0.06, c.z + Math.sin(a) * rr), q4.setFromEuler(e.set(Math.cos(a) * lean, rnd() * 6.283, -Math.sin(a) * lean, 'YXZ')), s.setScalar(sc));
        this.mesh.setMatrixAt(ci * PER + j, m);
        gem[(ci * PER + j) * 2] = rnd() * 6.283; gem[(ci * PER + j) * 2 + 1] = c.k;
      }
    });
    this.gem = geo.attributes.iGem;
    pipe.scene.add(this.mesh);
  }

  get brokenCount() { return this.list.filter((c) => c.gone).length; }

  _break(c) {
    const g = this.g, p = g.player;
    c.gone = true;
    (g.geodesBroken ??= []).push(c.i);
    g.particles.burst(c.x, c.y + 0.5, c.z, 26, { speed: 6, life: 0.6, size: 0.06, color: [5, 3.6, 1.5], gravity: 12, drag: 1.2, streak: 0.14, up: 3 });
    g.vfx.wave(c.x, c.y + 0.1, c.z, { r0: 0.2, r1: 2.6, life: 0.4, strength: 0.8, width: 0.08, color: [3.4, 2.5, 1.1] });
    for (let k = 0; k < 4; k++) { const a = Math.random() * 6.283; (g.motes ??= []).push({ x: c.x, y: c.y + 0.6, z: c.z, vx: Math.cos(a) * 2.5, vy: 3 + Math.random() * 2, vz: Math.sin(a) * 2.5, t: -k * 0.05, first: k === 0 }); }
    const xp = 12, refrain = c.i % 4 === 1 && p.refrains < p.refrainMax;
    g.xp += xp; if (refrain) p.refrains++;
    g.hitStop = Math.max(g.hitStop, 0.04);
    g.emit('geode', { xp, refrain, count: this.brokenCount, total: this.list.length });
    g.emit('xp', { amount: xp, total: g.xp });
    g.save();
  }

  update(dt, playing) {
    const g = this.g, p = g.player;
    this.mesh.visible = !g.cine;
    let dirty = false;
    for (const c of this.list) {
      const want = c.gone ? 0 : 1;
      if (Math.abs(c.k - want) > 1e-3) { c.k += (want - c.k) * Math.min(1, dt * 14); if (Math.abs(c.k - want) < 0.01) c.k = want; for (let j = 0; j < PER; j++) this.gem.array[(c.i * PER + j) * 2 + 1] = c.k; dirty = true; }
      // Standing, it gives itself away with a spark now and then to whoever is near.
      if (!c.gone && !g.cine && Math.random() < dt * 1.6 && Math.abs(c.x - p.pos.x) < 45 && Math.abs(c.z - p.pos.z) < 45) g.particles.spawn(c.x + (Math.random() - 0.5) * 0.5, c.y + 0.9 + Math.random() * 0.6, c.z + (Math.random() - 0.5) * 0.5, { vel: [0, 0.5 + Math.random() * 0.6, 0], life: 1.4 + Math.random(), size: 0.045, color: [3.8, 2.7, 1.1], drag: 0.4 });
      if (!playing || c.gone || !p.attackActive || p.hitDone.has(c)) continue;
      const dx = c.x - p.pos.x, dz = c.z - p.pos.z, dd = Math.hypot(dx, dz);
      if (dd > 2.5 || Math.abs(p.pos.y - c.y) > 1.6 || (dd > 0.5 && (dx * p.facing.x + dz * p.facing.z) / dd < 0.25)) continue;
      p.hitDone.add(c); this._break(c);
    }
    if (dirty) this.gem.needsUpdate = true;
  }
}
