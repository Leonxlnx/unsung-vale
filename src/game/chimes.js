// Chimes. Here and there on the mesas three small bells hang side by side on a step of
// stone, one large, one middling, one small. Struck with the blade each gives its voice.
// Rung from the lowest voice to the highest they answer together, and whatever of the song
// was caught in them comes loose: resonance, breath back, and a line of the Vale's memory.
import * as THREE from 'three';
import { MeshBuilder, M, column } from '../world/arch/builder.js';
import { settle } from './reliquaries.js';

const VERT = /* glsl */ `
out vec3 vWorld;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const FRAG = /* glsl */ `
uniform float uTime; uniform float uPower;
in vec3 vWorld;
void main() {
  vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld))), V = normalize(cameraPosition - vWorld);
  float f = pow(1.0 - abs(dot(N, V)), 2.2), sun = 0.55 + 0.45 * clamp(dot(N, normalize(vec3(0.5, 0.45, 0.74))), 0.0, 1.0);
  vec3 bronze = vec3(0.24, 0.18, 0.09) * sun + vec3(0.34, 0.27, 0.15) * f;
  vec3 lit = vec3(1.0, 0.74, 0.34) * (0.7 + 2.2 * f) * (0.88 + 0.12 * sin(uTime * 3.0));
  gl_FragColor = vec4(mix(bronze, lit, uPower), 1.0);
}`;

// Where they hang: [id, x, z]. Each settles on the nearest level, empty ground.
const PLACES = [['petal', -436, -366], ['cantor', -3, -498], ['east', 629, -458], ['south3', 568, 458], ['aurel', 81, 546], ['south1', -350, 435], ['crown', -954, -147]];
// What comes loose when a set is rung right.
const LINES = [
  'Children learnt their scales on the field chimes before they were let near a spire.',
  'Three voices, low to high: the first thing any singer of the Vale was taught.',
  'Shepherds rang them at dusk to say which way the flock had gone.',
  'A chime rung wrong was said to sour the milk. Nobody believed it. Everybody rang them right.',
  'The smallest chime was always cast last, from what was left in the crucible.',
  'On feast days they hung ribbons from the clappers, one colour for each court.',
  'Whoever rang the three in one breath could ask a wish of the wind. It mostly said no.',
];
const PITCH = [0.75, 1.0, 1.335], SIZE = [1.0, 0.8, 0.62];

export class Chimes {
  constructor(game, pipe) {
    this.g = game; this.pipe = pipe; this.list = [];
    const W = game.world, time = pipe.globals.uTime, done = game.chimesDone ?? [];
    const taken = [...(game.bells?.list ?? []), ...(game.reliquaries?.list ?? []), ...game.spires].map((q) => [q.x, q.z]);
    const bell = new THREE.LatheGeometry([[0.02, 0], [0.11, -0.03], [0.17, -0.2], [0.2, -0.46], [0.28, -0.66], [0.32, -0.72], [0.3, -0.74]].map(([r, y]) => new THREE.Vector2(r, y)), 12);
    const frames = new MeshBuilder();
    PLACES.forEach(([id, x0, z0], n) => {
      W.stream(x0, z0, 6);
      let [x, z] = settle(W, x0, z0, 14);
      // Not on top of anything else that was set out.
      if (taken.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 9)) [x, z] = settle(W, x0 + 16, z0 + 10, 10);
      const y = W.floorBelow(x, W.groundHeight(x, z) + 3, z, 8), s = game.spires.find((q) => q.id === id), yaw = Math.atan2(s.x - x, s.z - z);
      // Which place holds which voice differs from set to set.
      const order = [[0, 1, 2], [1, 0, 2], [2, 0, 1], [0, 2, 1], [1, 2, 0], [2, 1, 0], [1, 0, 2]][n % 7];
      const bells = order.map((voice, k) => {
        const lx = (k - 1) * 1.15, wx = x + Math.cos(yaw) * lx, wz = z - Math.sin(yaw) * lx;
        const m = new THREE.Mesh(bell, new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { uTime: time, uPower: { value: 0 } }, side: THREE.DoubleSide }));
        m.frustumCulled = false; m.scale.setScalar(SIZE[voice] * 1.25); m.position.set(wx, y + 2.34, wz); m.rotation.y = yaw; m.updateMatrixWorld();
        pipe.scene.add(m);
        return { voice, x: wx, z: wz, mesh: m, swing: 0, t: Math.random() * 6 };
      });
      frames.at(x, y, z, yaw, (q) => {
        q.mat_(M.MARBLE).lathe([[2.3, -1.6], [2.3, 0.1], [1.95, 0.1], [1.95, 0.2], [0, 0.2]], 20);
        q.mat_(M.GOLD).lathe([[1.8, 0.205], [1.72, 0.21]], 20);
        for (const sx of [-1.75, 1.75]) q.at(sx, 0.2, 0, 0, (g) => column(g, 0.11, 2.3, { sides: 10 }));
        q.mat_(M.MARBLE).box(-2.05, 2.5, -0.16, 4.1, 0.16, 0.32);
        q.mat_(M.GOLD).box(-2.05, 2.66, -0.16, 4.1, 0.04, 0.32, '-y');
        for (const lx of [-1.15, 0, 1.15]) q.mat_(M.GOLD).box(lx - 0.02, 2.34, -0.02, 0.04, 0.16, 0.04);
      });
      this.list.push({ id, n, x, y, z, yaw, bells, next: 0, done: done.includes(id), glow: done.includes(id) ? 1 : 0 });
    });
    game.addProp(frames);
  }

  get doneCount() { return this.list.filter((c) => c.done).length; }

  _ring(c, b) {
    const g = this.g;
    b.swing = 1;
    g.vfx.wave(b.x, c.y + 1.9, b.z, { kind: 1, r0: 0.15, r1: 1.6 + 0.5 * (2 - b.voice), life: 0.5, strength: 0.9, width: 0.08, color: [3.4, 2.5, 1.1] });
    g.particles.burst(b.x, c.y + 1.8, b.z, 8, { speed: 2.5, life: 0.6, size: 0.04, color: [4, 3, 1.4], gravity: 2, drag: 1.5 });
    if (c.done) { g.emit('chime', { phase: 'ring', pitch: PITCH[b.voice] }); return; }
    if (b.voice === c.next) {
      c.next++; b.lit = true;
      g.emit('chime', { phase: 'ring', pitch: PITCH[b.voice], right: true });
      if (c.next >= 3) this._solve(c);
    } else {
      // Out of order: they fall quiet and it begins again (with this one, if it is the lowest).
      for (const q of c.bells) q.lit = false;
      c.next = b.voice === 0 ? 1 : 0; b.lit = b.voice === 0;
      g.emit('chime', { phase: 'ring', pitch: PITCH[b.voice], wrong: b.voice !== 0 });
    }
  }

  _solve(c) {
    const g = this.g;
    c.done = true;
    (g.chimesDone ??= []).push(c.id);
    for (const [dl, r] of [[0.15, 7], [0.4, 12]]) g.vfx.wave(c.x, c.y + 0.25, c.z, { r0: 0.5, r1: r, life: 1.1, strength: 1.0, width: 0.05, color: [3.2, 2.3, 1.0], delay: dl });
    for (let k = 0; k < 40; k++) { const a = Math.random() * 6.283; g.particles.spawn(c.x + Math.cos(a) * 1.2, c.y + 2, c.z + Math.sin(a) * 1.2, { vel: [Math.cos(a) * 1.5, 2 + Math.random() * 4, Math.sin(a) * 1.5], life: 1.2 + Math.random() * 0.8, size: 0.05, color: [4.2, 3.1, 1.4], drag: 1.0, gravity: 1.5 }); }
    const xp = 60;
    g.xp += xp; g.emit('xp', { amount: xp, total: g.xp });
    g.rest(); g.flash = Math.max(g.flash, 0.2);
    g.emit('chime', { phase: 'done', line: LINES[c.n % LINES.length], xp, count: this.doneCount, total: this.list.length });
    g.save();
  }

  update(dt, playing) {
    const g = this.g, p = g.player, show = !g.cine;
    for (const c of this.list) {
      const d = Math.hypot(p.pos.x - c.x, p.pos.z - c.z), near = d < 240;
      c.glow += ((c.done ? 1 : 0) - c.glow) * Math.min(1, dt * 2);
      for (const b of c.bells) {
        b.mesh.visible = show && near;
        if (!near) continue;
        b.t += dt; b.swing *= Math.exp(-dt * 1.4);
        const u = b.mesh.material.uniforms.uPower, want = c.done ? 0.85 : b.lit ? 1 : 0;
        u.value += (want - u.value) * Math.min(1, dt * 5);
        const sw = (b.swing * 0.55 + 0.02) * Math.sin(b.t * (5.5 - b.voice * 0.9));
        b.mesh.rotation.set(sw * Math.sin(c.yaw + 1.57), c.yaw, sw * Math.cos(c.yaw + 1.57)); b.mesh.updateMatrixWorld();
      }
      if (!playing || d > 6) continue;
      if (!c.done && !this.hinted && d < 5) { this.hinted = true; g.emit('hint', { title: 'Chimes', text: 'Three voices hang here. Strike them with the blade, from the lowest voice to the highest.' }); }
      // A swing that passes through a chime rings it, once per swing.
      if (!p.attackActive) continue;
      if (p.hitDone.has(c) || Math.abs(p.pos.y - c.y) > 1.5) continue;
      let best = null, bs = 0.55;
      for (const b of c.bells) {
        const dx = b.x - p.pos.x, dz = b.z - p.pos.z, dd = Math.hypot(dx, dz);
        if (dd > 2.6) continue;
        const aim = dd < 0.4 ? 1 : (dx * p.facing.x + dz * p.facing.z) / dd;
        if (aim > bs) { bs = aim; best = b; }
      }
      if (best) { p.hitDone.add(c); this._ring(c, best); }
    }
  }
}
