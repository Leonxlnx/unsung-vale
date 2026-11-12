// Trials: rings of gold standing out on the mesas, left from the days when the Vale trained
// its singers to fight and to run. Stepping up to one and answering it begins a trial: either
// three waves of the Mute called up around the ring, or a run through gates of light against
// a falling count. The first time one is won it gives a step of strength.
import * as THREE from 'three';
import { MeshBuilder, M } from '../world/arch/builder.js';

const VERT = /* glsl */ `
out vec3 vWorld;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const FRAG = /* glsl */ `
uniform float uTime; uniform float uPower;
in vec3 vWorld;
void main() {
  vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld))), V = normalize(cameraPosition - vWorld);
  float f = pow(1.0 - abs(dot(N, V)), 2.0);
  vec3 lit = vec3(1.0, 0.74, 0.34) * (0.8 + 2.4 * f) * (0.85 + 0.15 * sin(uTime * 2.4 + vWorld.y * 2.0));
  gl_FragColor = vec4(mix(vec3(0.3, 0.24, 0.13) * (0.5 + f), lit, uPower), 1.0);
}`;

// fight: waves of [kind, count, elite?]; run: gates as offsets from the ring, and seconds.
export const TRIALS = [
  { id: 'blades', name: 'Trial of Blades', kind: 'fight', at: [-300, -440], reward: { up: 'blade', xp: 80 },
    waves: [[['thrall', 3]], [['hound', 3], ['thrall', 1]], [['warden', 1], ['thrall', 2]]] },
  { id: 'ringer', name: "The Ringer's Run", kind: 'run', at: [150, -470], seconds: 34, reward: { up: 'stamina', xp: 80 },
    gates: [[26, 6], [44, 30], [30, 56], [0, 66], [-28, 50], [-40, 22], [-22, -4], [0, 0]] },
  { id: 'embers', name: 'Trial of Embers', kind: 'fight', at: [505, -515], reward: { up: 'health', xp: 110 },
    waves: [[['hound', 4]], [['lancer', 2], ['thrall', 2, 'veteran']], [['chorister', 1], ['warden', 1], ['hound', 2]]] },
  { id: 'reeds', name: 'The Reed Run', kind: 'run', at: [650, 470], seconds: 40, reward: { up: 'stamina', xp: 110 },
    gates: [[-24, 14], [-52, 6], [-70, -22], [-52, -50], [-22, -58], [6, -40], [18, -14], [0, 0]] },
  { id: 'gilt', name: 'Trial of Gilt', kind: 'fight', at: [200, 600], reward: { up: 'blade', xp: 140 },
    waves: [[['brute', 1], ['hound', 2]], [['chorister', 2], ['hound', 3]], [['thrall', 3, 'veteran'], ['lancer', 2]]] },
  { id: 'orchard', name: 'The Orchard Run', kind: 'run', at: [-300, 500], seconds: 44, reward: { up: 'health', xp: 140 },
    gates: [[-18, -22], [-44, -34], [-70, -18], [-84, 12], [-66, 40], [-36, 48], [-12, 28], [0, 0]] },
  { id: 'crown', name: 'Trial of the Crown', kind: 'fight', at: [-1100, -230], reward: { up: 'blade', xp: 200 },
    waves: [[['thrall', 3, 'veteran'], ['hound', 2]], [['brute', 2], ['chorister', 1]], [['thrall', 1, 'champion'], ['hound', 4]]] },
  // kind 'return': lancers keep coming; the ring is won by sending their bolts back at them.
  { id: 'answers', name: 'Trial of Answers', kind: 'return', at: [212, -8], need: 5, seconds: 80, reward: { up: 'blade', xp: 120 }, waves: [[['lancer', 3]]] },
];
const ELITE = { veteran: { scale: 1.16, hp: 1.7, dmg: 1.2, tint: 0.6 }, champion: { scale: 1.5, hp: 4, dmg: 1.45, elite: true, name: 'The Crown Champion' } };

// The flattest dry ground near a point.
function flatNear(W, x, z, reach = 24) {
  let best = [x, z], bs = 1e9;
  for (let r = 0; r <= reach; r += 6) for (let k = 0; k < (r ? 8 : 1); k++) {
    const a = (k / 8) * 6.283 + r, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    const h = W.groundHeight(px, pz), hs = [[4, 0], [-4, 0], [0, 4], [0, -4]].map(([dx, dz]) => W.groundHeight(px + dx, pz + dz));
    const slope = Math.max(...hs, h) - Math.min(...hs, h) + r * 0.03 + (Number.isFinite(W.waterLevel(px, pz)) ? 50 : 0);
    if (slope < bs) { bs = slope; best = [px, pz]; }
  }
  return best;
}

export class Trials {
  constructor(game, pipe) {
    // A bolt struck back while the Trial of Answers is on counts toward it.
    game.on((type, d) => { const r = this.run; if (type === 'enemy' && d.type === 'returned' && r?.t.def.kind === 'return') { r.count++; game.emit('trial', { phase: 'gate', name: r.t.def.name, index: r.count, total: r.t.def.need, pitch: [1, 9 / 8, 5 / 4, 4 / 3, 3 / 2][Math.min(4, r.count - 1)] }); } });
    this.g = game; this.pipe = pipe; this.run = null;
    const W = game.world, time = pipe.globals.uTime;
    const geo = new THREE.TorusGeometry(1.25, 0.075, 6, 28).translate(0, 1.85, 0);
    // Each ring stands on a round floor of paving with four low posts at its edge.
    const floors = new MeshBuilder();
    this.list = TRIALS.map((def) => {
      const [x, z] = flatNear(W, def.at[0], def.at[1]);
      W.stream(x, z, 6);
      const y = W.floorBelow(x, W.groundHeight(x, z) + 3, z, 8);
      const u = { uTime: time, uPower: { value: 0 } };
      const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: u }));
      mesh.position.set(x, y, z); mesh.frustumCulled = false; mesh.updateMatrixWorld();
      pipe.scene.add(mesh);
      floors.at(x, y, z, 0, (q) => {
        q.mat_(M.PAVING).lathe([[3.0, -1.6], [3.0, 0.1], [2.6, 0.1], [2.6, 0.2], [0, 0.2]], 28);
        q.mat_(M.GOLD).lathe([[2.2, 0.205], [2.08, 0.21]], 28);
        q.mat_(M.GOLD).lathe([[0.5, 0.205], [0.38, 0.21]], 16);
        for (let k = 0; k < 4; k++) { const a = k * 1.5708 + 0.785; q.at(Math.cos(a) * 2.8, 0.1, Math.sin(a) * 2.8, 0, (g) => { g.mat_(M.MARBLE).lathe([[0.2, 0], [0.15, 0.08], [0.12, 0.62], [0.17, 0.68], [0.17, 0.76], [0, 0.8]], 8); g.mat_(M.GOLD).lathe([[0.13, 0.6], [0.15, 0.64], [0.13, 0.67]], 8); }); }
      });
      const t = { def, x, y, z, u, mesh, done: (game.trialsDone ?? []).includes(def.id) };
      if (def.kind === 'run') {
        t.gates = def.gates.map(([dx, dz]) => { const [gx, gz] = dx || dz ? flatNear(W, x + dx, z + dz, 6) : [x, z]; return { x: gx, z: gz, y: W.groundHeight(gx, gz) + 1.3 }; });
        // The count allows a strong run with breath to spare, not a perfect one.
        let len = 0, px = x, pz = z; for (const gt of t.gates) { len += Math.hypot(gt.x - px, gt.z - pz); px = gt.x; pz = gt.z; }
        t.seconds = Math.round(len / 5.5 + 5);
      }
      return t;
    });
    game.addProp(floors);
  }

  get doneCount() { return this.list.filter((t) => t.done).length; }
  // The ring the hero stands at, if he could begin it.
  at() { const p = this.g.player.pos; return this.list.find((t) => Math.hypot(p.x - t.x, p.z - t.z) < 3.6 && Math.abs(p.y - t.y) < 3); }
  // What the interface shows while a trial is on.
  tracker() {
    const r = this.run; if (!r) return null;
    const t = r.t, d = t.def;
    if (d.kind === 'fight') return { title: d.name, text: 'Stand against the waves', count: `${r.wave + 1} / ${d.waves.length}`, mark: null };
    if (d.kind === 'return') return { title: d.name, text: `Strike their bolts back  ·  ${Math.max(0, r.left).toFixed(0)} s`, count: `${r.count} / ${d.need}`, mark: null, urgent: r.left < 12 };
    const gt = t.gates[r.gate];
    return { title: d.name, text: 'Run the gates', count: `${Math.max(0, r.left).toFixed(1)} s`, mark: { x: gt.x, y: gt.y + 0.6, z: gt.z, name: `Gate ${r.gate + 1} of ${t.gates.length}` }, urgent: r.left < 8 };
  }

  _spawn(t, i) {
    const g = this.g, flat = [];
    for (const [kind, n, elite] of t.def.waves[i]) for (let k = 0; k < n; k++) flat.push([kind, elite]);
    flat.forEach(([kind, elite], k) => {
      const a = i * 1.1 + (k / flat.length) * 6.283, e = g.enemies.spawn(kind, t.x + Math.cos(a) * 8, t.z + Math.sin(a) * 8, `trial:${t.def.id}`, elite ? ELITE[elite] : null, t.y);
      e.state = 'rise'; e.t = 0; e.home.set(t.x, t.y, t.z);
      g.vfx.wave(e.pos.x, e.pos.y + 0.08, e.pos.z, { r0: 3, r1: 0.4, life: 0.8, strength: 0.9, width: 0.08, color: e.elite ? [4.2, 1.4, 0.8] : [2.4, 1.15, 4.6] });
    });
  }

  begin(t) {
    const g = this.g;
    this.run = { t, wave: 0, gate: 0, left: t.seconds ?? t.def.seconds ?? 0, wait: 0, time: 0, count: 0 };
    if (t.def.kind !== 'run') this._spawn(t, 0);
    g.vfx.wave(t.x, t.y + 0.1, t.z, { r0: 1, r1: 14, life: 0.9, strength: 1.2, width: 0.06, color: [3.2, 2.3, 1.0] });
    g.emit('trial', { phase: 'begin', name: t.def.name, kind: t.def.kind, total: t.def.kind === 'fight' ? t.def.waves.length : t.def.kind === 'return' ? t.def.need : t.gates.length });
  }

  _end(won) {
    const g = this.g, r = this.run, t = r.t;
    this.run = null;
    // Whatever was called up goes back into the ground.
    for (const e of g.enemies.list) if (e.alive && e.group === `trial:${t.def.id}`) { e.alive = false; e.state = 'dead'; e.t = 0; for (const sh of e.shards) { sh.vel.set((Math.random() - 0.5) * 3, 2 + Math.random() * 3, (Math.random() - 0.5) * 3); sh.spin.set(Math.random() * 6, Math.random() * 6, Math.random() * 6); } }
    if (won) {
      const first = !t.done; t.done = true;
      g.trialsDone = this.list.filter((q) => q.done).map((q) => q.def.id);
      for (const [dl, rr] of [[0, 16], [0.25, 11]]) g.vfx.wave(t.x, t.y + 0.1, t.z, { r0: 1, r1: rr, life: 1.2, strength: 1.4, width: 0.06, color: [3.2, 2.3, 1.0], delay: dl });
      g.flash = Math.max(g.flash, 0.5);
      if (first) g.grant(t.def.reward); else g.grant({ xp: Math.round(t.def.reward.xp * 0.25) });
      g.emit('trial', { phase: 'done', name: t.def.name, first, reward: first ? t.def.reward : null, time: r.time });
    } else g.emit('trial', { phase: 'fail', name: t.def.name });
    g.save();
  }

  update(dt, playing) {
    const g = this.g, p = g.player, time = this.pipe.time;
    for (const t of this.list) {
      t.mesh.visible = !g.cine;
      const on = this.run?.t === t ? 1 : t.done ? 0.25 : 0.7;
      t.u.uPower.value += (on - t.u.uPower.value) * Math.min(1, dt * 3);
      t.mesh.rotation.y += dt * (this.run?.t === t ? 1.6 : 0.25); t.mesh.updateMatrixWorld();
    }
    if (!playing) return;
    const r = this.run;
    if (!r) {
      if (g.prompt || p.state !== 'move' || !p.grounded) return;
      const t = this.at();
      if (!t || g.enemies.list.some((e) => e.alive && e.state !== 'dormant' && e.pos.distanceTo(p.pos) < 30)) return;
      g.prompt = { key: 'E', text: `Begin ${/^The /.test(t.def.name) ? t.def.name : `the ${t.def.name}`}` };
      if (g.input.pressed.has('interact')) { g.prompt = null; this.begin(t); }
      return;
    }
    const t = r.t, d = t.def;
    r.time += dt;
    if (p.state === 'dead' || Math.hypot(p.pos.x - t.x, p.pos.z - t.z) > (d.kind === 'fight' ? 46 : 130)) { this._end(false); return; }
    if (d.kind === 'return') {
      // Three lancers at all times; five of their bolts sent back before the count runs out.
      r.left -= dt;
      if (r.count >= d.need) { this._end(true); return; }
      if (r.left <= 0) { this._end(false); return; }
      if (g.enemies.aliveIn(`trial:${d.id}`) < 3 && (r.wait += dt) > 1.8) {
        r.wait = 0;
        const a = Math.random() * 6.283, e = g.enemies.spawn('lancer', t.x + Math.cos(a) * 9, t.z + Math.sin(a) * 9, `trial:${d.id}`, null, t.y);
        e.state = 'rise'; e.t = 0; e.home.set(t.x, t.y, t.z);
        g.vfx.wave(e.pos.x, e.pos.y + 0.08, e.pos.z, { r0: 3, r1: 0.4, life: 0.8, strength: 0.9, width: 0.08, color: [2.4, 1.15, 4.6] });
      }
    } else if (d.kind === 'fight') {
      if (g.enemies.aliveIn(`trial:${d.id}`) > 0) return;
      if (r.wave >= d.waves.length - 1) { this._end(true); return; }
      if ((r.wait += dt) > 1.6) { r.wait = 0; r.wave++; this._spawn(t, r.wave); g.emit('trial', { phase: 'wave', name: d.name, index: r.wave, total: d.waves.length }); }
    } else {
      r.left -= dt;
      const gt = t.gates[r.gate];
      // The next gate: a ring of light standing in the grass, pulsing.
      if ((r.pulse = (r.pulse ?? 0) - dt) <= 0) { r.pulse = 0.45; g.vfx.wave(gt.x, gt.y, gt.z, { kind: 1, r0: 2.2, r1: 1.5, life: 0.6, strength: 1.0, width: 0.12, color: [3.2, 2.3, 1.0] }); g.vfx.wave(gt.x, gt.y - 1.2, gt.z, { r0: 0.6, r1: 2.6, life: 0.6, strength: 0.7, width: 0.1, color: [3.2, 2.3, 1.0] }); }
      if (Math.random() < dt * 30) g.particles.spawn(gt.x + (Math.random() - 0.5) * 2, gt.y - 1 + Math.random() * 0.4, gt.z + (Math.random() - 0.5) * 2, { vel: [0, 3 + Math.random() * 3, 0], life: 1.1, size: 0.05, color: [3.4, 2.5, 1.1], drag: 0.4 });
      if (Math.hypot(p.pos.x - gt.x, p.pos.z - gt.z) < 2.8 && Math.abs(p.pos.y + 1 - gt.y) < 3) {
        g.vfx.wave(gt.x, gt.y, gt.z, { kind: 1, r0: 1, r1: 5, life: 0.4, strength: 1.2, width: 0.1, color: [4, 3, 1.4] });
        g.particles.burst(gt.x, gt.y, gt.z, 20, { speed: 5, life: 0.6, size: 0.05, color: [4, 3, 1.4], gravity: 4, drag: 1.2, streak: 0.1 });
        r.gate++;
        g.emit('trial', { phase: 'gate', name: d.name, index: r.gate, total: t.gates.length, pitch: [1, 9 / 8, 5 / 4, 4 / 3, 3 / 2, 5 / 3, 15 / 8, 2][Math.min(7, r.gate - 1)] });
        if (r.gate >= t.gates.length) { this._end(true); return; }
      }
      if (r.left <= 0) this._end(false);
    }
    void time;
  }
}
