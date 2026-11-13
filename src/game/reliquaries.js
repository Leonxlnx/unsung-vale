// Reliquaries and the charms they keep. On every mesa the singers left one small casket of
// stone out of the way of the paths, and in each of them a keepsake that still holds a
// little of its owner's craft. The hero may wear two at a time (three once five spires
// sing); which two is up to whoever is playing.
import * as THREE from 'three';
import { MeshBuilder, M } from '../world/arch/builder.js';

// What each charm does is written where it acts (player.js, game.js, enemies.js); this is
// what the hero is told.
export const CHARMS = {
  lark: { name: 'Lark Bone', what: 'The refrain mends more: three fifths of your life, not half.' },
  reed: { name: 'Reed Whistle', what: 'Breath comes back a third faster.' },
  ember: { name: 'Ember Bead', what: 'Cadence holds twice as long before it fades.' },
  anvil: { name: 'Anvil Shard', what: 'Heavy blows break guard sooner, and a ward does not turn them.' },
  tide: { name: 'Tide Glass', what: 'A blow slipped at the last instant mends a little of you.' },
  thorn: { name: 'Orchard Thorn', what: 'Whoever strikes you with its own body takes a part of the blow back.' },
  gilt: { name: 'Gilt Peg', what: 'A sixth more resonance from every construct that falls.' },
  crown: { name: 'Crown Splinter', what: 'A bolt struck back bursts among the Mute where it lands.' },
};

// Where they stand: [charm, x, z, mesa, guard]. Out of the way, but on level ground one can
// walk to from the court.
const PLACES = [
  ['reed', -590, 8, 'dawn', []],
  ['lark', -414, -495, 'petal', [['thrall', 2]]],
  ['ember', 143, -530, 'cantor', [['lancer', 1], ['thrall', 2]]],
  ['tide', 681, -395, 'east', [['seeker', 2], ['thrall', 2]]],
  ['anvil', 480, 347, 'south3', [['warden', 1], ['hound', 2]]],
  ['gilt', 239, 504, 'aurel', [['chorister', 1], ['thrall', 2, true]]],
  ['thorn', -405, 324, 'south1', [['brute', 1], ['hound', 2]]],
  ['crown', -1053, -53, 'crown', [['brute', 1], ['chorister', 1], ['thrall', 2, true]]],
];
const VETERAN = { scale: 1.16, hp: 1.7, dmg: 1.2, tint: 0.6 };

// The most level dry spot within a few paces that no tree or wall already stands on.
export function settle(W, x0, z0, reach = 12) {
  // Only the trunks that stand near enough to matter are looked at for each spot.
  const C = W.caps, near = [], span = reach + 4;
  for (let i = 0; i < C.length; i += 7) if (Math.abs(C[i] - x0) < span && Math.abs(C[i + 2] - z0) < span) near.push(C[i], C[i + 2], C[i + 6]);
  let best = [x0, z0], bs = 1e9;
  for (let dx = -reach; dx <= reach; dx += 2) for (let dz = -reach; dz <= reach; dz += 2) {
    const x = x0 + dx, z = z0 + dz, h = W.groundHeight(x, z);
    if (Number.isFinite(W.waterLevel(x, z)) || W.floorBelow(x, h + 20, z, 24) > h + 0.2) continue;
    let built = false;
    for (let k = 0; k < 8 && !built; k++) for (const r of [3.5, 7]) { const px = x + Math.cos(k * 0.785) * r, pz = z + Math.sin(k * 0.785) * r; if (W.floorBelow(px, h + 20, pz, 24) > W.groundHeight(px, pz) + 0.25) { built = true; break; } }
    if (built) continue;
    let lo = h, hi = h;
    for (let k = 0; k < 8; k++) for (const r of [1.6, 3.2]) { const q = W.groundHeight(x + Math.cos(k * 0.785) * r, z + Math.sin(k * 0.785) * r); lo = Math.min(lo, q); hi = Math.max(hi, q); }
    let tree = 1e9;
    for (let i = 0; i < near.length; i += 3) { const d = Math.hypot(near[i] - x, near[i + 1] - z) - near[i + 2]; if (d < tree) tree = d; }
    if (tree < 2.6) continue;
    const score = (hi - lo) + Math.hypot(dx, dz) * 0.012;
    if (score < bs) { bs = score; best = [x, z]; }
  }
  return best;
}

const VERT = /* glsl */ `
out vec3 vWorld;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const FRAG = /* glsl */ `
uniform float uTime; uniform float uGlow;
in vec3 vWorld;
void main() {
  vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld))), V = normalize(cameraPosition - vWorld);
  float f = pow(1.0 - abs(dot(N, V)), 2.2), sun = 0.5 + 0.5 * clamp(dot(N, normalize(vec3(0.5, 0.45, 0.74))), 0.0, 1.0);
  vec3 stone = vec3(0.62, 0.6, 0.55) * sun + vec3(0.2, 0.19, 0.17) * f;
  vec3 lit = vec3(1.0, 0.74, 0.34) * (1.2 + 2.4 * f) * (0.85 + 0.15 * sin(uTime * 2.4));
  gl_FragColor = vec4(mix(stone, lit, uGlow), 1.0);
}`;

export class Reliquaries {
  constructor(game, pipe) {
    this.g = game; this.pipe = pipe; this.list = [];
    const W = game.world, time = pipe.globals.uTime, found = game.charmsFound ?? [];
    const base = new MeshBuilder();
    const lidGeo = new THREE.BoxGeometry(1.24, 0.14, 0.8).translate(0, 0.07, 0.4), capGeo = new THREE.CylinderGeometry(0.44, 0.44, 1.18, 3).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2).scale(1, 0.3, 1).translate(0, 0.206, 0.4), seamGeo = new THREE.BoxGeometry(1.1, 0.05, 0.66);
    const mk = (geo, glow) => { const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { uTime: time, uGlow: { value: glow } } })); m.frustumCulled = false; return m; };
    for (const [charm, x0, z0, mesa, guard] of PLACES) {
      W.stream(x0, z0, 6);
      const [x, z] = settle(W, x0, z0);
      const y = W.floorBelow(x, W.groundHeight(x, z) + 3, z, 8);
      // It faces the court it belongs to, so whoever finds it comes on it from the front.
      const s = game.spires.find((q) => q.id === mesa), yaw = Math.atan2((s?.x ?? game.sites.spawn.x) - x, (s?.z ?? game.sites.spawn.z) - z);
      base.at(x, y, z, yaw, (q) => {
        q.mat_(M.MARBLE).lathe([[1.5, -1.6], [1.5, 0.1], [1.2, 0.1], [1.2, 0.2], [0, 0.2]], 8, { smooth: false, phase: 0.3927 });
        q.mat_(M.GOLD).lathe([[1.08, 0.205], [1.0, 0.21]], 8, { smooth: false, phase: 0.3927 });
        // The casket: a stone chest on four feet, banded with gold.
        for (const [fx, fz] of [[-0.5, -0.28], [0.5, -0.28], [-0.5, 0.28], [0.5, 0.28]]) q.mat_(M.MARBLE).box(fx - 0.08, 0.2, fz - 0.08, 0.16, 0.12, 0.16);
        q.mat_(M.MARBLE).box(-0.6, 0.32, -0.38, 1.2, 0.5, 0.76);
        q.mat_(M.GOLD).box(-0.62, 0.36, -0.4, 1.24, 0.05, 0.8).box(-0.62, 0.72, -0.4, 1.24, 0.05, 0.8);
        for (const bx of [-0.34, 0.34]) q.mat_(M.GOLD).box(bx - 0.03, 0.32, -0.4, 0.06, 0.5, 0.8);
      });
      // The lid turns on its back edge; under it a seam of light until it has been opened.
      const lid = new THREE.Group(); lid.add(mk(lidGeo, 0), mk(capGeo, 0));
      lid.position.set(x - Math.sin(yaw) * 0.4, y + 0.82, z - Math.cos(yaw) * 0.4); lid.rotation.order = 'YXZ'; lid.rotation.y = yaw;
      const seam = mk(seamGeo, 1); seam.position.set(x, y + 0.82, z); seam.rotation.y = yaw; seam.updateMatrixWorld();
      pipe.scene.add(lid, seam);
      this.list.push({ charm, x, y, z, yaw, mesa, guard, lid, seam, open: found.includes(charm), k: found.includes(charm) ? 1 : 0, group: `relic:${charm}`, t: Math.random() * 6 });
    }
    game.addProp(base);
  }

  get openCount() { return this.list.filter((r) => r.open).length; }
  // Shown on the map once the people of its mesa are awake to speak of it.
  known(r) { return !r.open && (r.mesa === 'dawn' || !!this.g.spires.find((s) => s.id === r.mesa)?.tuned); }
  slots() { return this.g.spires.filter((s) => s.tuned).length >= 5 ? 3 : 2; }

  spawnGuards() {
    const g = this.g;
    for (const r of this.list) {
      if (r.open) continue;
      const flat = []; for (const [kind, n, vet] of r.guard) for (let k = 0; k < n; k++) flat.push([kind, vet]);
      flat.forEach(([kind, vet], k) => {
        // Each stands on open ground near the casket, never inside something built.
        let px = r.x, pz = r.z;
        for (let t = 0; t < 8; t++) { const a = r.yaw + ((k + 0.5) / flat.length) * 6.283 + t * 0.7; px = r.x + Math.cos(a) * 4.6; pz = r.z + Math.sin(a) * 4.6; if (Math.abs(g.world.floorBelow(px, r.y + 12, pz, 16) - r.y) < 1.0) break; }
        g.enemies.spawn(kind, px, pz, r.group, vet ? VETERAN : null, r.y);
      });
    }
  }

  // Wear it or take it off. With every place taken, the one worn longest makes way.
  toggle(id) {
    const g = this.g, worn = (g.charmsWorn ??= []);
    if (!(g.charmsFound ?? []).includes(id)) return false;
    const i = worn.indexOf(id);
    if (i >= 0) worn.splice(i, 1); else { while (worn.length >= this.slots()) worn.shift(); worn.push(id); }
    g._charms(); g.save();
    return true;
  }

  open(r) {
    const g = this.g, p = g.player, c = CHARMS[r.charm];
    r.open = true;
    (g.charmsFound ??= []).push(r.charm);
    if ((g.charmsWorn ??= []).length < this.slots()) g.charmsWorn.push(r.charm);
    g._charms();
    for (const [dl, rr] of [[0, 5], [0.25, 9]]) g.vfx.wave(r.x, r.y + 0.25, r.z, { r0: 0.4, r1: rr, life: 1.0, strength: 0.9, width: 0.05, color: [3.2, 2.3, 1.0], delay: dl });
    g.vfx.wave(r.x, r.y + 1.0, r.z, { kind: 1, r0: 0.2, r1: 2.6, life: 0.5, strength: 1.2, width: 0.1, color: [3.4, 2.5, 1.1] });
    for (let k = 0; k < 46; k++) { const a = Math.random() * 6.283, sp = 0.6 + Math.random() * 1.8; g.particles.spawn(r.x + Math.cos(a) * 0.3, r.y + 0.9, r.z + Math.sin(a) * 0.3, { vel: [Math.cos(a) * sp, 2.5 + Math.random() * 5, Math.sin(a) * sp], life: 1.0 + Math.random() * 0.8, size: 0.05, color: [4.2, 3.1, 1.4], drag: 1.2, gravity: 2 }); }
    // What was inside comes to him as light.
    for (let k = 0; k < 9; k++) { const a = Math.random() * 6.283; (g.motes ??= []).push({ x: r.x, y: r.y + 1.0, z: r.z, vx: Math.cos(a) * 2, vy: 3 + Math.random() * 3, vz: Math.sin(a) * 2, t: -k * 0.06, first: k === 0 }); }
    g.flash = Math.max(g.flash, 0.22);
    g.rest();
    g.emit('charm', { phase: 'found', id: r.charm, name: c.name, what: c.what, worn: g.charmsWorn.includes(r.charm), count: this.openCount, total: this.list.length });
    g.save();
  }

  update(dt, playing) {
    const g = this.g, p = g.player, show = !g.cine;
    for (const r of this.list) {
      const d = Math.hypot(p.pos.x - r.x, p.pos.z - r.z), near = d < 260;
      r.lid.visible = show && near; r.seam.visible = show && near;
      if (!near) continue;
      r.t += dt;
      const was = r.k; r.k += ((r.open ? 1 : 0) - r.k) * Math.min(1, dt * 3.5);
      if (Math.abs(r.k - was) > 1e-4 || r.lid.rotation.x === 0) { r.lid.rotation.x = -1.22 * r.k - 1e-4; r.lid.updateMatrixWorld(true); }
      r.seam.material.uniforms.uGlow.value = 1 - 0.55 * r.k;
      // Unopened, it gives itself away to anyone who comes near: slow motes rising off the lid.
      if (show && !r.open && d < 70 && Math.random() < dt * 5) g.particles.spawn(r.x + (Math.random() - 0.5) * 1.1, r.y + 0.95, r.z + (Math.random() - 0.5) * 0.7, { vel: [0, 0.5 + Math.random() * 0.7, 0], life: 1.6 + Math.random(), size: 0.045, color: [3.6, 2.7, 1.2], drag: 0.4 });
    }
    if (!playing || g.prompt || p.state !== 'move' || !p.grounded) return;
    for (const r of this.list) {
      if (r.open || Math.hypot(p.pos.x - r.x, p.pos.z - r.z) > 3.0 || Math.abs(p.pos.y - r.y) > 3) continue;
      if (g.enemies.aliveIn(r.group) > 0 || g.enemies.list.some((e) => e.alive && e.state !== 'dormant' && e.pos.distanceTo(p.pos) < 22)) return;
      g.prompt = { key: 'E', text: 'Open the reliquary' };
      if (g.input.pressed.has('interact')) { g.prompt = null; this.open(r); }
      return;
    }
  }
}
