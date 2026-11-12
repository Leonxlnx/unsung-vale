// The Mute: silent constructs of dark crystal shards held together around a violet core.
// They lie as rubble until the player comes near, then pull themselves together.
// Every shard is one instance of a single faceted mesh; bodies are animated procedurally by
// moving each shard toward a formation slot with a little spring lag.
import * as THREE from 'three';
import { COMMON, SKYMAP } from '../engine/glsl.js';
import { SKY_SAMPLE, SH_GLSL } from '../engine/sky.js';
import { LIGHTING } from '../engine/lighting.js';
import { TERRAIN_SAMPLING } from '../world/terrain.js';
import { mulberry32 } from '../util/noise.js';

const SHARD_VERT = /* glsl */ `
in vec3 iGlow;     // x: glow 0..1+, y: dissolve 0..1, z: tint (0 the Mute's violet, 1 an elite's ember red)
out vec3 vWorld; out vec3 vGlow; out vec3 vLocal;
void main() {
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = w.xyz; vGlow = iGlow; vLocal = position;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const SHARD_FRAG = /* glsl */ `
${COMMON}
${SKYMAP}
${SKY_SAMPLE}
${SH_GLSL}
${TERRAIN_SAMPLING}
${LIGHTING}
uniform float uTime;
uniform float uFrame;
in vec3 vWorld; in vec3 vGlow; in vec3 vLocal;
void main() {
  if (vGlow.y > 0.0 && ign(gl_FragCoord.xy + uFrame * 5.588) < vGlow.y) discard;
  // Facet normal straight from the geometry so every face is a clean plane.
  vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  vec3 V = normalize(cameraPosition - vWorld);
  if (dot(N, V) < 0.0) N = -N;
  float vis = sunVisibility(vWorld + N * 0.05 + uSunDir * 0.1);
  // Dark glass with a faint oil-film sheen that shifts from violet to teal across each facet.
  float ndv = saturate(dot(N, V));
  vec3 base = mix(vec3(0.16, 0.13, 0.26), vec3(0.1, 0.2, 0.24), smoothstep(0.2, 0.9, ndv));
  base = mix(base, vec3(0.2, 0.1, 0.09), vGlow.z * 0.7);
  vec3 col = shadeSurface(base, 0.14, 0.92, N, V, vis, 1.0, 0.0);
  // Light bleeding through the edges and along inner fractures, so the figure keeps a
  // bright outline even where the silence has drained the colour around it.
  float fres = pow(1.0 - ndv, 3.0);
  float vein = smoothstep(0.7, 0.95, vnoise3(vLocal * vec3(9.0, 3.0, 9.0) + uTime * 0.2));
  vec3 violet = mix(vec3(0.62, 0.24, 1.0), vec3(1.0, 0.34, 0.16), vGlow.z);
  col += violet * (fres * 1.7 + vein * 0.9) * (0.55 + vGlow.x * 1.5);
  col += vec3(0.8, 0.85, 1.0) * pow(fres, 3.0) * 0.6;
  col += vec3(0.9, 0.7, 1.0) * max(vGlow.x - 1.0, 0.0) * 0.9;
  gl_FragColor = vec4(col, 1.0);
}`;

function shardGeometry() {
  const rnd = mulberry32(77), pos = [], idx = [];
  const ring = (y, r) => { for (let k = 0; k < 6; k++) { const a = (k / 6) * 6.283 + rnd() * 0.3; const rr = r * (0.75 + 0.5 * rnd()); pos.push(Math.cos(a) * rr, y + (rnd() - 0.5) * 0.08, Math.sin(a) * rr); } };
  pos.push(0, -0.5, 0); ring(-0.22, 0.5); ring(0.2, 0.42); pos.push(0.04, 0.5, -0.03);
  for (let k = 0; k < 6; k++) {
    const a = 1 + k, b = 1 + ((k + 1) % 6), c = 7 + k, d = 7 + ((k + 1) % 6);
    idx.push(0, b, a, a, b, d, a, d, c, c, d, 13);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g.toNonIndexed();
}

// Formation slots: [x, y, z, dirX, dirY, dirZ, length, thickness, tag]
const S = (x, y, z, dx, dy, dz, len, th, tag = 'body') => ({ p: new THREE.Vector3(x, y, z), d: new THREE.Vector3(dx, dy, dz).normalize(), len, th, tag });
const THRALL = [
  S(0, 1.38, 0, 0, 1, 0.05, 0.95, 0.52), S(-0.17, 1.26, -0.06, -0.15, 1, 0, 0.72, 0.36), S(0.17, 1.26, -0.06, 0.15, 1, 0, 0.72, 0.36),
  S(0, 2.02, 0.03, 0, 1, 0.18, 0.44, 0.32, 'head'),
  S(-0.44, 1.7, 0, -1, 0.45, 0, 0.52, 0.26), S(0.44, 1.7, 0, 1, 0.45, 0, 0.52, 0.26),
  S(-0.6, 1.32, 0.05, -0.35, -1, 0.1, 0.62, 0.22, 'armL'), S(0.6, 1.32, 0.05, 0.35, -1, 0.1, 0.62, 0.22, 'armR'),
  S(-0.64, 0.86, 0.26, -0.1, -0.7, 0.7, 1.0, 0.16, 'bladeL'), S(0.64, 0.86, 0.26, 0.1, -0.7, 0.7, 1.0, 0.16, 'bladeR'),
  S(0, 0.86, 0, 0, -1, 0, 0.52, 0.34), S(-0.19, 0.5, 0, -0.12, -1, 0, 0.72, 0.2, 'tail'), S(0.19, 0.5, 0, 0.12, -1, 0, 0.72, 0.2, 'tail'),
  S(0, 0.32, -0.12, 0, -1, -0.2, 0.5, 0.14, 'tail'),
  S(-0.5, 2.0, -0.2, 0.3, 1, -0.3, 0.26, 0.12, 'mote'), S(0.55, 1.9, -0.25, -0.2, 1, -0.4, 0.22, 0.1, 'mote'), S(0, 1.7, -0.42, 0, 1, -0.5, 0.36, 0.14, 'mote'),
];
const LANCER = [
  S(0, 1.62, 0.75, 0, 0, 1, 1.7, 0.16, 'spear'),
  ...Array.from({ length: 8 }, (_, k) => { const a = (k / 8) * 6.283; return S(Math.cos(a) * 0.78, 1.62 + Math.sin(a) * 0.78, 0, Math.cos(a), Math.sin(a), 0, 0.5, 0.2, 'ring'); }),
  S(0, 1.62, 0, 0, 1, 0, 0.5, 0.4), S(0, 1.0, 0, 0, -1, 0, 0.6, 0.22, 'tail'), S(-0.14, 0.6, 0, -0.1, -1, 0, 0.5, 0.14, 'tail'), S(0.14, 0.5, 0, 0.1, -1, 0, 0.62, 0.14, 'tail'),
];
const COLOSSUS = [
  ...THRALL.map((s) => S(s.p.x * 2.3, s.p.y * 2.3, s.p.z * 2.3, s.d.x, s.d.y, s.d.z, s.len * 2.3, s.th * 2.3, s.tag)),
  ...Array.from({ length: 5 }, (_, k) => S((k - 2) * 0.42, 3.7 - Math.abs(k - 2) * 0.25, -0.75, (k - 2) * 0.25, 0.8, -0.8, 1.5, 0.3, 'spine')),
  ...Array.from({ length: 3 }, (_, k) => S((k - 1) * 0.36, 5.1, 0, (k - 1) * 0.4, 1, 0, 0.8, 0.22, 'head')),
  S(-1.5, 4.2, 0, -1, 0.9, 0, 1.3, 0.4), S(1.5, 4.2, 0, 1, 0.9, 0, 1.3, 0.4),
];

// Hound: long and low, fangs forward; it circles and then leaps.
const HOUND = [
  S(0, 0.82, 0.1, 0, 0.05, 1, 1.15, 0.44), S(0, 0.9, 0.78, 0, 0.3, 1, 0.5, 0.3, 'head'),
  S(-0.1, 0.78, 1.08, -0.15, -0.5, 1, 0.42, 0.1, 'bladeL'), S(0.1, 0.78, 1.08, 0.15, -0.5, 1, 0.42, 0.1, 'bladeR'),
  S(-0.24, 0.42, 0.5, -0.1, -1, 0.25, 0.72, 0.14, 'tail'), S(0.24, 0.42, 0.5, 0.1, -1, 0.25, 0.72, 0.14, 'tail'),
  S(-0.24, 0.42, -0.42, -0.1, -1, -0.25, 0.72, 0.14, 'tail'), S(0.24, 0.42, -0.42, 0.1, -1, -0.25, 0.72, 0.14, 'tail'),
  S(0, 1.16, 0.3, 0, 1, -0.5, 0.42, 0.12, 'mote'), S(0, 1.2, -0.05, 0, 1, -0.6, 0.5, 0.12, 'mote'), S(0, 1.12, -0.4, 0, 1, -0.7, 0.4, 0.1, 'mote'),
  S(0, 0.92, -0.85, 0, 0.45, -1, 0.85, 0.12, 'tail'),
];
// Warden: a tall figure behind a wall of long shards. Blows from the front glance off.
const WARDEN = [
  ...THRALL.map((s) => S(s.p.x * 1.4, s.p.y * 1.4, s.p.z * 1.4, s.d.x, s.d.y, s.d.z, s.len * 1.4, s.th * 1.4, s.tag)),
  ...Array.from({ length: 7 }, (_, k) => S((k - 3) * 0.27, 1.6 - Math.abs(k - 3) * 0.08, 1.0, (k - 3) * 0.05, 1, 0, 2.0 - Math.abs(k - 3) * 0.12, 0.3, 'shield')),
];
// Chorister: hangs in the air under a turning halo and calls blasts down where the hero stands.
const CHORISTER = [
  S(0, 2.2, 0, 0, 1, 0, 1.05, 0.4), S(0, 2.95, 0.02, 0, 1, 0.1, 0.42, 0.27, 'head'),
  S(0, 1.4, 0, 0, -1, 0, 0.95, 0.24, 'tail'), S(-0.5, 1.95, 0, -0.4, -1, 0, 1.15, 0.16, 'tail'), S(0.5, 1.95, 0, 0.4, -1, 0, 1.15, 0.16, 'tail'),
  ...Array.from({ length: 10 }, (_, k) => { const a = (k / 10) * 6.283; return S(Math.cos(a) * 0.95, 3.45, Math.sin(a) * 0.95, Math.cos(a), 0.25, Math.sin(a), 0.5, 0.13, 'halo'); }),
];

// Brute: a slab of a body on short legs, with two clubs of shard for arms. It brings both
// down at once, and whoever stands under them is thrown off his feet.
const BRUTE = [
  S(0, 1.7, 0, 0, 1, 0.05, 1.5, 0.95), S(-0.36, 1.5, -0.1, -0.2, 1, 0, 1.1, 0.6), S(0.36, 1.5, -0.1, 0.2, 1, 0, 1.1, 0.6),
  S(0, 2.62, 0.1, 0, 1, 0.3, 0.4, 0.34, 'head'),
  S(-0.85, 2.2, 0, -1, 0.3, 0, 0.8, 0.44), S(0.85, 2.2, 0, 1, 0.3, 0, 0.8, 0.44),
  S(-1.1, 1.55, 0.1, -0.25, -1, 0.15, 1.1, 0.42, 'armL'), S(1.1, 1.55, 0.1, 0.25, -1, 0.15, 1.1, 0.42, 'armR'),
  S(-1.15, 0.85, 0.3, -0.05, -1, 0.3, 1.0, 0.55, 'bladeL'), S(1.15, 0.85, 0.3, 0.05, -1, 0.3, 1.0, 0.55, 'bladeR'),
  S(0, 0.95, 0, 0, -1, 0, 0.7, 0.6), S(-0.3, 0.5, 0, -0.15, -1, 0, 0.9, 0.34, 'tail'), S(0.3, 0.5, 0, 0.15, -1, 0, 0.9, 0.34, 'tail'),
  S(-0.3, 2.5, -0.5, -0.3, 1, -0.6, 0.6, 0.2, 'spine'), S(0.3, 2.5, -0.5, 0.3, 1, -0.6, 0.6, 0.2, 'spine'), S(0, 2.7, -0.45, 0, 1, -0.5, 0.75, 0.22, 'spine'),
];
const SOVEREIGN = [
  ...COLOSSUS.map((s) => S(s.p.x * 1.22, s.p.y * 1.22, s.p.z * 1.22, s.d.x, s.d.y, s.d.z, s.len * 1.22, s.th * 1.22, s.tag)),
  ...Array.from({ length: 14 }, (_, k) => { const a = (k / 14) * 6.283; return S(Math.cos(a) * 2.5, 7.6, Math.sin(a) * 2.5, Math.cos(a), 0.5, Math.sin(a), 1.25, 0.26, 'halo'); }),
  ...Array.from({ length: 4 }, (_, k) => S((k - 1.5) * 1.3, 5.6, -1.5, (k - 1.5) * 0.5, 1, -0.9, 2.2, 0.34, 'spine')),
];

// A stronger one of a kind: bigger, tougher, its light the colour of embers.
function derive(base, m) {
  const sc = m.scale ?? 1;
  return { ...base, hp: Math.round(base.hp * (m.hp ?? 1)), damage: Math.round(base.damage * (m.dmg ?? 1)), speed: base.speed * (m.speed ?? 1), poise: base.poise * (m.poise ?? m.hp ?? 1),
    radius: base.radius * sc, core: base.core * sc, core0: base.core, hover: base.hover, reach: base.ranged ? base.reach : base.reach * (0.55 + 0.45 * sc),
    windup: base.windup * (m.windup ?? 1), recover: base.recover * (m.recover ?? 1), name: m.name ?? base.name, xp: Math.round((base.xp ?? 10) * (m.xp ?? m.hp ?? 1)) };
}

export const KINDS = {
  brute:     { slots: BRUTE, hp: 230, speed: 2.9, reach: 3.2, windup: 1.0, strike: 0.26, recover: 1.2, damage: 30, poise: 110, radius: 0.95, sight: 28, hover: 0.25, core: 1.7, slam: true, xp: 40, name: 'Mute Brute' },
  sovereign: { slots: SOVEREIGN, hp: 1100, speed: 2.9, reach: 6.2, windup: 0.9, strike: 0.25, recover: 1.0, damage: 30, poise: 200, radius: 1.8, sight: 70, hover: 0.6, core: 3.9, boss: true, phases: 3, xp: 400, name: 'The Stillness' },
  hound:     { slots: HOUND, hp: 36, speed: 6.4, reach: 2.4, windup: 0.42, strike: 0.26, recover: 0.7, damage: 11, poise: 16, radius: 0.5, sight: 30, hover: 0.12, core: 0.8, circle: true, lunge: 19, xp: 8, name: 'Mute Hound' },
  warden:    { slots: WARDEN, hp: 150, speed: 2.3, reach: 3.1, windup: 0.85, strike: 0.22, recover: 1.0, damage: 24, poise: 80, radius: 0.8, sight: 28, hover: 0.3, core: 1.95, shield: true, xp: 26, name: 'Mute Warden' },
  chorister: { slots: CHORISTER, hp: 64, speed: 2.6, reach: 20, windup: 1.1, strike: 0.2, recover: 1.6, damage: 18, poise: 26, radius: 0.6, sight: 36, hover: 1.2, core: 2.3, ranged: true, caster: true, xp: 18, name: 'Mute Chorister' },
  thrall:   { slots: THRALL, hp: 62, speed: 3.6, reach: 2.3, windup: 0.56, strike: 0.2, recover: 0.75, damage: 14, poise: 30, radius: 0.55, sight: 26, hover: 0.3, core: 1.4, xp: 10, name: 'Mute Thrall' },
  lancer:   { slots: LANCER, hp: 44, speed: 3.0, reach: 15, windup: 0.95, strike: 0.15, recover: 1.3, damage: 12, poise: 20, radius: 0.55, sight: 34, hover: 0.35, core: 1.62, ranged: true, xp: 12, name: 'Mute Lancer' },
  colossus: { slots: COLOSSUS, hp: 560, speed: 2.5, reach: 5.2, windup: 0.95, strike: 0.25, recover: 1.15, damage: 26, poise: 150, radius: 1.5, sight: 60, hover: 0.5, core: 3.2, boss: true, phases: 2, xp: 200, name: 'The Unsung' },
};

const _toP = new THREE.Vector3();
const _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _e = new THREE.Euler();

class Enemy {
  constructor(kind, x, y, z, seed, group, mods = null) {
    this.kind = kind; this.def = mods ? derive(KINDS[kind], mods) : KINDS[kind]; this.group = group;
    this.scale = mods?.scale ?? 1; this.tint = mods ? (mods.tint ?? 1) : 0; this.elite = !!mods?.elite; this.phase = 0;
    this.pos = new THREE.Vector3(x, y, z); this.home = this.pos.clone();
    this.yaw = seed * 6.283; this.vel = new THREE.Vector3();
    this.hp = this.def.hp; this.poise = this.def.poise;
    this.state = 'dormant'; this.t = 0; this.alive = true; this.glow = 0; this.staggerK = 0; this.assembled = 0;
    this.attackKind = 0; this.didHit = false; this.seed = seed;
    const rnd = mulberry32(Math.floor(seed * 1e6) + 3);
    this.shards = this.def.slots.map((s) => {
      // Rubble pose: scattered on the ground around the core.
      const a = rnd() * 6.283, r = (0.4 + rnd() * 1.1) * (this.def.boss ? 2.4 : 1);
      const pile = new THREE.Vector3(Math.cos(a) * r, 0.08 + rnd() * 0.12 * s.th * 4, Math.sin(a) * r);
      const pileQ = new THREE.Quaternion().setFromEuler(_e.set(Math.PI / 2 + (rnd() - 0.5) * 0.5, rnd() * 6.283, (rnd() - 0.5) * 0.6));
      return { s, pile, pileQ, pos: pile.clone().add(this.pos), quat: pileQ.clone(), vel: new THREE.Vector3(), spin: new THREE.Vector3(), phase: rnd() * 6.283, glow: 0 };
    });
  }
  get center() { return new THREE.Vector3(this.pos.x, this.pos.y + this.def.core, this.pos.z); }
}

export class Enemies {
  constructor(pipe, world, particles) {
    this.pipe = pipe; this.world = world; this.particles = particles;
    this.list = []; this.projectiles = []; this.events = []; this.blasts = [];
    this.max = 1400;
    const geo = shardGeometry();
    this.glowAttr = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 3), 3);
    this.glowAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iGlow', this.glowAttr);
    const mat = new THREE.ShaderMaterial({ vertexShader: SHARD_VERT, fragmentShader: SHARD_FRAG, defines: pipe.depthDefines, uniforms: pipe.lit(), side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; this.mesh.count = 0;
    const depth = new THREE.ShaderMaterial({ vertexShader: 'void main() { gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0); }', fragmentShader: 'void main() {}', colorWrite: false, side: THREE.DoubleSide });
    // The shadow twin must itself be instanced, so it is built here rather than by addCaster.
    this.shadowMesh = new THREE.InstancedMesh(geo, depth, this.max);
    this.shadowMesh.instanceMatrix = this.mesh.instanceMatrix;
    this.shadowMesh.frustumCulled = false; this.shadowMesh.count = 0;
    pipe.shadows.scene.add(this.shadowMesh);
  }

  // near: a height to look for the floor from (a court built out over the water has its
  // floor far above the ground under it).
  spawn(kind, x, z, group = 'world', mods = null, near = null) {
    // Start from just above the ground so nothing ends up on a roof or an arch.
    const y = this.world.floorBelow(x, (near ?? this.world.groundHeight(x, z)) + 2.5, z, 6);
    const e = new Enemy(kind, x, y, z, Math.random(), group, mods);
    this.list.push(e);
    return e;
  }

  aliveIn(group) { return this.list.filter((e) => e.alive && e.group === group).length; }

  // Applies a hit. Returns true if it connected.
  hit(e, dmg, from, heavy = false) {
    if (!e.alive || e.state === 'dormant') return false;
    if (e.def.shield && e.state !== 'stagger') {
      // In front of the wall of shards a light blow only rings on it; a heavy one cracks it.
      const dx = from.x - e.pos.x, dz = from.z - e.pos.z, l = Math.hypot(dx, dz) || 1;
      if ((dx * Math.sin(e.yaw) + dz * Math.cos(e.yaw)) / l > 0.35) {
        if (!heavy) { e.poise -= dmg * 0.6; e.glow = 1.2; this.events.push({ type: 'blocked', enemy: e }); if (e.poise <= 0) { e.poise = e.def.poise; e.state = 'stagger'; e.t = 0; } return false; }
        dmg *= 0.5;
      }
    }
    e.hp -= dmg; e.poise -= dmg * (heavy ? 2.2 : 1);
    e.glow = 1.7; e.staggerK = Math.min(1, e.staggerK + (heavy ? 1 : 0.55));
    _v.copy(e.pos).sub(from).setY(0).normalize();
    if (!e.def.boss) e.vel.addScaledVector(_v, heavy ? 9 : 5);
    const c = e.center;
    this.particles.burst(c.x, c.y, c.z, heavy ? 26 : 14, { speed: 7, life: 0.45, size: 0.07, color: [3.2, 1.6, 6.0], gravity: 9, drag: 2, streak: 0.06, dir: [_v.x, 0.3, _v.z], bias: 3 });
    if (e.hp <= 0) this.kill(e, _v);
    else if (e.poise <= 0) { e.poise = e.def.poise; e.state = 'stagger'; e.t = 0; }
    return true;
  }

  kill(e, dir) {
    e.alive = false; e.state = 'dead'; e.t = 0;
    for (const sh of e.shards) {
      sh.vel.set((Math.random() - 0.5) * 7 + dir.x * 5, 3 + Math.random() * 6, (Math.random() - 0.5) * 7 + dir.z * 5);
      sh.spin.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
    }
    const c = e.center;
    this.particles.burst(c.x, c.y, c.z, e.def.boss ? 90 : 36, { speed: e.def.boss ? 14 : 8, life: 0.9, size: 0.1, color: [4, 2, 8], gravity: 5, drag: 1.5, streak: 0.05 });
    this.particles.spawn(c.x, c.y, c.z, { life: 0.5, size: e.def.boss ? 7 : 3, color: [2.4, 1.2, 4.5], grow: 1.5, alpha: 0.7 });
    this.events.push({ type: 'death', enemy: e });
  }

  update(dt, player, time) {
    const P = this.particles, W = this.world;
    let melee = 0;
    for (const e of this.list) if (e.alive && !e.def.ranged && (e.state === 'windup' || e.state === 'strike')) melee++;
    for (const e of this.list) {
      const d = e.def;
      e.t += dt;
      e.glow += ((e.state === 'windup' ? 0.6 + 0.9 * (e.t / d.windup) : 0.12) - e.glow) * Math.min(1, 6 * dt);
      e.staggerK *= Math.exp(-5 * dt);
      const toP = _toP.copy(player.pos).sub(e.pos); toP.y = 0;
      const dist = toP.length(); if (dist > 1e-3) toP.multiplyScalar(1 / dist);
      e.far = dist > 240 && e.state === 'dormant';
      if (e.far) continue;
      const playerAlive = player.state !== 'dead';

      if (e.state === 'dormant') {
        if (playerAlive && dist < d.sight * 0.62 && Math.abs(player.pos.y - e.pos.y) < 8) { e.state = 'rise'; e.t = 0; this.events.push({ type: 'wake', enemy: e }); }
      } else if (e.state === 'rise') {
        e.assembled = Math.min(1, e.t / (d.boss ? 2.2 : 1.1));
        if (e.assembled >= 1) { e.state = 'chase'; e.t = 0; }
      } else if (e.alive) {
        const faceP = () => { let dy = Math.atan2(toP.x, toP.z) - e.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); e.yaw += dy * Math.min(1, 7 * dt); };
        let wantSpeed = 0, dirSign = 1;
        if (e.state === 'chase') {
          faceP();
          if (!playerAlive || e.pos.distanceTo(e.home) > 70) { e.state = 'return'; }
          else if (d.ranged) {
            // Lancers keep their distance and back off when crowded.
            if (dist < 7) { wantSpeed = d.speed; dirSign = -1; } else if (dist > 14) wantSpeed = d.speed;
            if (dist < 22 && e.t > 1.4 + e.seed * 1.2) { e.state = 'windup'; e.t = 0; this.events.push({ type: 'charge', enemy: e }); }
          } else if (d.circle && dist < 8.5) {
            // Round the hero at a few paces, then in.
            const s = (e.orbit ??= e.seed < 0.5 ? 1 : -1), inw = dist > 5.5 ? 0.7 : dist < 3.6 ? -0.5 : 0.05;
            if (e.t > 1.1 + e.seed * 1.3 && dist < 6.5 && melee < 2) { melee++; e.state = 'windup'; e.t = 0; e.attackKind = 0; this.events.push({ type: 'charge', enemy: e }); }
            else { const tx = -toP.z * s, tz = toP.x * s; toP.set(tx * 0.9 + toP.x * inw, 0, tz * 0.9 + toP.z * inw).normalize(); wantSpeed = d.speed * 0.8; }
          } else {
            if (dist > d.reach * 0.82) wantSpeed = d.speed * (1 + 0.16 * e.phase);
            else if (e.t > 0.25 && (d.boss || melee < 2)) { melee++; e.state = 'windup'; e.t = 0; e.attackKind = d.boss ? (e.phase > 0 && Math.random() < 0.22 * e.phase ? 3 : Math.floor(Math.random() * 2)) : 0; this.events.push({ type: 'charge', enemy: e }); }
            else if (!d.boss && e.t > 0.25) {
              // Waiting its turn: it prowls round him instead of standing in a queue.
              const sgn = (e.orbit ??= e.seed < 0.5 ? 1 : -1); toP.set(-toP.z * sgn, 0, toP.x * sgn); wantSpeed = d.speed * 0.45;
            }
            if (d.boss && dist > 12 && e.t > 2.5) { e.state = 'windup'; e.t = 0; e.attackKind = e.phase > 0 && Math.random() < 0.5 ? 3 : 2; this.events.push({ type: 'charge', enemy: e }); }
            // A wounded giant changes its song: a roar that calls others to it, then new blows.
            if (d.phases) {
              const ph = Math.min(d.phases - 1, Math.floor((1 - e.hp / d.hp) * d.phases));
              if (ph > e.phase) { e.phase = ph; e.state = 'windup'; e.t = 0; e.attackKind = 4; this.events.push({ type: 'charge', enemy: e }); this.events.push({ type: 'phase', enemy: e, phase: ph }); }
            }
          }
        } else if (e.state === 'return') {
          const h = _v.copy(e.home).sub(e.pos); h.y = 0; const hd = h.length();
          if (hd < 1.5) { e.state = 'chase'; e.t = 0; } else { toP.copy(h.multiplyScalar(1 / hd)); wantSpeed = d.speed; e.yaw = Math.atan2(toP.x, toP.z); }
          if (playerAlive && dist < d.sight * 0.5 && e.pos.distanceTo(e.home) < 40) e.state = 'chase';
        } else if (e.state === 'windup') {
          if (e.t < d.windup * 0.75) faceP();
          if (e.t >= d.windup) { e.state = 'strike'; e.t = 0; e.didHit = false; this.events.push({ type: 'attack', enemy: e }); }
        } else if (e.state === 'strike') {
          const f = _v2.set(Math.sin(e.yaw), 0, Math.cos(e.yaw));
          if (d.caster || e.attackKind === 3) {
            if (!e.didHit) {
              e.didHit = true;
              // Where he stands now, and where he is heading: two marks, a breath apart. A giant
              // rings him in as well: a circle of marks, and in its last fury a second, wider one.
              const marks = [[0, 1.05, 0, 0], [0.55, 1.5, 0, 0]];
              if (d.boss) {
                for (let k = 0; k < 6; k++) marks.push([0, 1.7, 5.4, (k / 6) * 6.283 + e.t]);
                if (e.phase > 1) for (let k = 0; k < 9; k++) marks.push([0, 2.3, 10, (k / 9) * 6.283]);
              }
              for (const [lead, wait, rr, an] of marks) {
                const b = { x: player.pos.x + player.vel.x * lead + Math.cos(an) * rr, z: player.pos.z + player.vel.z * lead + Math.sin(an) * rr, t: wait, r: d.boss ? 3.0 : 2.7, dmg: Math.round(d.damage * (d.boss ? 0.7 : 1)), y: 0 };
                b.y = W.floorBelow(b.x, player.pos.y + 1.5, b.z, 6);
                this.blasts.push(b); this.events.push({ type: 'blastMark', blast: b, enemy: e });
              }
            }
          } else if (e.attackKind === 4) {
            if (!e.didHit) { e.didHit = true; this.events.push({ type: 'summon', enemy: e, phase: e.phase }); }
          } else if (d.ranged || e.attackKind === 2) {
            if (!e.didHit) {
              e.didHit = true;
              const n = d.boss ? 3 : 1;
              for (let i = 0; i < n; i++) {
                const c = e.center, spread = (i - (n - 1) / 2) * 0.22;
                const aim = new THREE.Vector3(player.pos.x - c.x, player.pos.y + 1.1 - c.y, player.pos.z - c.z).normalize();
                aim.applyAxisAngle(_up, spread);
                this.projectiles.push({ pos: c.clone().addScaledVector(aim, 1.2), vel: aim.multiplyScalar(d.boss ? 19 : 17), life: 3, damage: d.damage * (d.boss ? 0.6 : 1), spin: Math.random() * 6 });
              }
              this.events.push({ type: 'shot', enemy: e });
            }
          } else {
            // Melee: a short lunge; the hit lands once, in a cone ahead.
            if (!d.boss) e.vel.copy(f).multiplyScalar((d.lunge ?? 11) * (1 - e.t / d.strike));
            if (!e.didHit && e.t > d.strike * 0.3) {
              const reach = d.reach + (d.boss ? 1.2 : 0.7), cone = d.boss && e.attackKind === 1 ? -0.2 : 0.35;
              const slam = (d.boss && e.attackKind === 0) || !!d.slam;
              const hitPos = slam ? _v.copy(e.pos).addScaledVector(f, d.boss ? 3.4 : 2.1) : null;
              const ok = slam ? hitPos.distanceTo(player.pos) < (d.boss ? 4.6 : 3.1) : dist < reach && toP.dot(f) > cone;
              if (ok && Math.abs(player.pos.y - e.pos.y) < 3) { e.didHit = true; this.events.push({ type: 'hitPlayer', enemy: e, damage: d.damage }); }
              if (slam && !e.slamFx) {
                e.slamFx = true;
                for (let k = 0; k < 40; k++) { const a = (k / 40) * 6.283; P.spawn(hitPos.x + Math.cos(a) * 1.5, hitPos.y + 0.3, hitPos.z + Math.sin(a) * 1.5, { vel: [Math.cos(a) * 9, 1.5, Math.sin(a) * 9], life: 0.5, size: 0.22, color: [3, 1.4, 6], drag: 3 }); }
                this.events.push({ type: 'slam', enemy: e, at: hitPos.clone() });
              }
            }
          }
          if (e.t >= d.strike) { e.state = 'recover'; e.t = 0; e.slamFx = false; }
        } else if (e.state === 'recover') {
          if (e.t >= d.recover * (1 - 0.16 * e.phase)) { e.state = 'chase'; e.t = 0; }
        } else if (e.state === 'stagger') {
          if (e.t >= (d.boss ? 1.4 : 0.6)) { e.state = 'chase'; e.t = 0; }
        }
        // Glide: steer, separate from neighbours, follow the ground.
        if (wantSpeed > 0) { e.vel.x += (toP.x * wantSpeed * dirSign - e.vel.x) * Math.min(1, 5 * dt); e.vel.z += (toP.z * wantSpeed * dirSign - e.vel.z) * Math.min(1, 5 * dt); }
        else { const k = Math.exp(-5 * dt); e.vel.x *= k; e.vel.z *= k; }
        for (const o of this.list) {
          if (o === e || !o.alive || o.state === 'dormant') continue;
          const dx = e.pos.x - o.pos.x, dz = e.pos.z - o.pos.z, dd = Math.hypot(dx, dz), min = d.radius + o.def.radius + 0.5;
          if (dd < min && dd > 1e-3) { e.vel.x += (dx / dd) * (min - dd) * 8 * dt * 10; e.vel.z += (dz / dd) * (min - dd) * 8 * dt * 10; }
        }
        // Do not walk through the player.
        if (dist < d.radius + 0.5 && e.state !== 'strike') { e.vel.x -= toP.x * 6 * dt * 10; e.vel.z -= toP.z * 6 * dt * 10; }
        // Move, following the floor and never sinking into a step or a dais on the way up it.
        const tryMove = (vx, vz) => {
          const nx = e.pos.x + vx * dt, nz = e.pos.z + vz * dt;
          const floor = W.floorBelow(nx, e.pos.y + 1.5, nz, 4);
          if (floor <= e.pos.y - 1.6 || floor >= e.pos.y + 1.2) return false;
          e.pos.x = nx; e.pos.z = nz; e.pos.y = Math.max(e.pos.y + (floor - e.pos.y) * Math.min(1, 10 * dt), floor - 0.12);
          // Walls, shafts and trunks push a construct aside just as they do the hero.
          const rad = Math.min(1.0, d.radius * 0.8);
          W.resolveCapsule(e.pos, rad, Math.max(1.7, rad * 2 + 0.3), 0);
          return true;
        };
        e.avoidT = Math.max(0, (e.avoidT ?? 0) - dt);
        const sp2 = e.vel.x * e.vel.x + e.vel.z * e.vel.z;
        if (sp2 < 0.04) tryMove(e.vel.x, e.vel.z);
        else {
          // Straight on if the way is clear. If something stops it (a spire, a wall, a ledge)
          // it goes round: off to one side for a moment, the same side until that fails too.
          const turned = (turn) => { const c = Math.cos(turn * e.avoidSide), sn = Math.sin(turn * e.avoidSide); return tryMove(e.vel.x * c - e.vel.z * sn, e.vel.x * sn + e.vel.z * c); };
          const ox = e.pos.x, oz = e.pos.z, want = Math.sqrt(sp2) * dt;
          let ok;
          if (e.avoidT > 0) ok = turned(1.25) || turned(1.9);
          else {
            ok = tryMove(e.vel.x, e.vel.z);
            if (!ok || Math.hypot(e.pos.x - ox, e.pos.z - oz) < want * 0.35) {
              e.avoidSide ||= Math.random() < 0.5 ? 1 : -1; e.avoidT = 0.9;
              ok = turned(1.25) || turned(1.9) || ok;
            }
          }
          if (!ok) { e.avoidSide = -(e.avoidSide || 1); e.vel.x *= -0.3; e.vel.z *= -0.3; }
        }
      }
    }

    // Projectiles.
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt; p.pos.addScaledVector(p.vel, dt); p.spin += dt * 20;
      P.spawn(p.pos.x, p.pos.y, p.pos.z, { life: 0.22, size: 0.3, color: [2.2, 1.0, 4.2], alpha: 0.8 });
      const hitPlayer = Math.hypot(p.pos.x - player.pos.x, p.pos.z - player.pos.z) < 0.6 && p.pos.y > player.pos.y - 0.1 && p.pos.y < player.pos.y + 1.95;
      const hitGround = p.pos.y < W.floorBelow(p.pos.x, p.pos.y + 1, p.pos.z, 2) + 0.05;
      if (hitPlayer) this.events.push({ type: 'hitPlayer', damage: p.damage, from: p.pos.clone().sub(p.vel) });
      if (hitPlayer || hitGround || p.life <= 0) { P.burst(p.pos.x, p.pos.y, p.pos.z, 10, { speed: 4, life: 0.35, size: 0.07, color: [3, 1.5, 6], gravity: 6 }); this.events.push({ type: 'shotHit', pos: p.pos.clone() }); this.projectiles.splice(i, 1); }
    }

    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const b = this.blasts[i];
      b.t -= dt;
      if (b.t > 0) continue;
      this.blasts.splice(i, 1);
      this.events.push({ type: 'blast', blast: b });
      if (Math.hypot(player.pos.x - b.x, player.pos.z - b.z) < b.r && Math.abs(player.pos.y - b.y) < 2.6) this.events.push({ type: 'hitPlayer', damage: b.dmg, from: new THREE.Vector3(b.x, b.y, b.z) });
    }
    this._writeInstances(dt, time, player);
    // Dead constructs disappear once their shards have faded.
    this.list = this.list.filter((e) => e.alive || e.t < 3.2);
  }

  _writeInstances(dt, time) {
    const M = this.mesh, G = this.glowAttr.array;
    let n = 0;
    for (const e of this.list) {
      if (e.far) continue;
      const d = e.def, cy = Math.cos(e.yaw), sy = Math.sin(e.yaw);
      const hover = d.hover + Math.sin(time * 1.7 + e.seed * 9) * 0.06, c0 = d.core0 ?? d.core, es = e.scale;
      const wind = e.state === 'windup' ? Math.min(1, e.t / d.windup) : 0;
      const strike = e.state === 'strike' ? 1 : e.state === 'recover' ? Math.max(0, 1 - e.t * 4) : 0;
      for (const sh of e.shards) {
        const s = sh.s;
        if (e.state === 'dead') {
          // Shards tumble away, bounce once or twice and dissolve.
          sh.vel.y -= 20 * dt; sh.pos.addScaledVector(sh.vel, dt);
          const g = this.world.groundHeight(sh.pos.x, sh.pos.z) + 0.08;
          if (sh.pos.y < g) { sh.pos.y = g; sh.vel.y *= -0.35; sh.vel.x *= 0.6; sh.vel.z *= 0.6; sh.spin.multiplyScalar(0.5); }
          _q.setFromEuler(_e.set(sh.spin.x * dt, sh.spin.y * dt, sh.spin.z * dt)); sh.quat.premultiply(_q);
        } else {
          // Formation target in the body's local frame, with attack and stagger offsets.
          const t = _v.copy(s.p), dir = _v2.copy(s.d);
          t.y += hover + Math.sin(time * 2.1 + sh.phase) * 0.035;
          if (s.tag === 'mote') { const a = time * 0.9 + sh.phase; t.x += Math.cos(a) * 0.12; t.z += Math.sin(a) * 0.12; }
          if (s.tag === 'ring') { const a = time * (1.2 + wind * 9) + sh.phase * 0; const c = Math.cos(a), sn = Math.sin(a); const x = s.p.x, y = s.p.y - c0; t.x = x * c - y * sn; t.y = c0 + x * sn + y * c + hover; dir.set(t.x, t.y - c0 - hover, 0).normalize(); }
          if (s.tag === 'spear') { t.z += -0.5 * wind + 1.2 * strike; }
          if (s.tag === 'halo') { const a = Math.atan2(s.p.z, s.p.x) + time * (0.7 + wind * 6) * (d.boss ? 0.5 : 1), r = Math.hypot(s.p.x, s.p.z) * (1 + 0.26 * wind); t.x = Math.cos(a) * r; t.z = Math.sin(a) * r; t.y += 0.2 * wind; dir.set(Math.cos(a), 0.25 + wind, Math.sin(a)).normalize(); }
          if (s.tag === 'shield') { t.z += 0.15 * wind - 0.5 * strike; t.y += 0.1 * Math.sin(time * 1.3 + s.p.x * 3); }
          const right = s.tag === 'bladeR' || s.tag === 'armR', arm = right || s.tag === 'bladeL' || s.tag === 'armL';
          if (arm && !d.ranged) {
            const k = s.tag.startsWith('blade') ? 1 : 0.5, sc = d.boss ? 2.3 : 1;
            if (e.attackKind === 1 && d.boss) { t.x += (right ? 1 : -1) * 0.9 * sc * wind * k; t.z += (1.6 * strike - 0.4 * wind) * sc * k; }
            else if (right || d.boss || d.slam) { t.y += 0.95 * sc * wind * k - 0.7 * sc * strike * k; t.z += (-0.45 * wind + 1.5 * strike) * sc * k; dir.set(s.d.x, s.d.y + 1.6 * wind - 0.5 * strike, s.d.z + 1.4 * strike).normalize(); }
          }
          if (!d.ranged && e.attackKind < 2) t.z += (-0.24 * wind + 0.5 * strike) * (d.boss ? 2 : 1) * (s.tag === 'tail' ? 0.35 : 1);
          if (strike > 0.5 && (s.tag === 'bladeR' || ((d.boss || d.slam) && s.tag === 'bladeL'))) this.particles.spawn(sh.pos.x, sh.pos.y, sh.pos.z, { life: 0.16, size: 0.24 * (d.boss ? 2.2 : 1), color: [1.7, 0.75, 3.2], alpha: 0.6 });
          if (e.staggerK > 0.01) t.addScaledVector(_s.copy(s.p).setY(s.p.y - c0).normalize(), e.staggerK * 0.55 * (d.boss ? 2 : 1));
          if (es !== 1) t.multiplyScalar(es);
          // Local to world.
          const wx = e.pos.x + t.x * cy + t.z * sy, wz = e.pos.z - t.x * sy + t.z * cy, wy = e.pos.y + t.y;
          const dx = dir.x * cy + dir.z * sy, dz = -dir.x * sy + dir.z * cy;
          _q.setFromUnitVectors(_up, _s.set(dx, dir.y, dz));
          if (e.state === 'dormant') { sh.pos.copy(sh.pile).add(e.pos); sh.quat.copy(sh.pileQ); }
          else {
            // While rising, each shard leaves the pile at its own moment.
            const a = e.state === 'rise' ? Math.max(0, Math.min(1, e.assembled * 1.8 - (sh.phase / 6.283) * 0.8)) : 1;
            // e.snap places every shard at once (a film cut onto a construct already standing).
            const k = e.snap ? 1 : 1 - Math.exp(-(arm ? 22 : 13) * dt * (0.15 + 0.85 * a));
            sh.pos.x += (wx - sh.pos.x) * k; sh.pos.y += (wy - sh.pos.y) * k; sh.pos.z += (wz - sh.pos.z) * k;
            sh.quat.slerp(_q, k);
          }
        }
        if (n >= this.max) break;
        _m.compose(sh.pos, sh.quat, _s.set(s.th * es, s.len * es, s.th * es));
        M.setMatrixAt(n, _m);
        G[n * 3] = e.state === 'dormant' ? 0 : e.glow + (e.state === 'rise' ? 0.6 : 0) + 0.25 * e.tint;
        G[n * 3 + 1] = e.state === 'dead' ? Math.max(0, (e.t - 1.6) / 1.5) : 0;
        G[n * 3 + 2] = e.tint;
        n++;
      }
      e.snap = false;
      // While a construct pulls itself together, motes of its light spiral in from the floor.
      if (e.alive && e.state === 'rise' && Math.random() < dt * 55) {
        const a = Math.random() * 6.283, r = (d.boss ? 4 : 1.8) + Math.random() * 2;
        this.particles.spawn(e.pos.x + Math.cos(a) * r, e.pos.y + 0.1 + Math.random() * 0.5, e.pos.z + Math.sin(a) * r, { vel: [-Math.cos(a) * r * 1.5 - Math.sin(a) * 2.4, 1.4 + Math.random() * 1.6, -Math.sin(a) * r * 1.5 + Math.cos(a) * 2.4], life: 0.75, size: 0.06, color: [3.4, 1.6, 6.5], streak: 0.12, drag: 0.4 });
      }
      if (e.alive && e.state !== 'dormant') {
        const c = e.center;
        this.particles.spawn(c.x, c.y + d.hover, c.z, { life: 0.08, size: (d.boss ? 1.6 : 0.62) * (1 + e.glow * 0.25), color: [1.6 + e.glow, 0.7 + e.glow * 0.4, 3.2 + e.glow], alpha: 0.55 });
      }
    }
    for (const p of this.projectiles) {
      if (n >= this.max) break;
      _q.setFromUnitVectors(_up, _v.copy(p.vel).normalize());
      _m.compose(p.pos, _q, _s.set(0.14, 0.9, 0.14));
      M.setMatrixAt(n, _m); G[n * 3] = 2; G[n * 3 + 1] = 0; G[n * 3 + 2] = 0; n++;
    }
    M.count = n; this.shadowMesh.count = n;
    M.instanceMatrix.needsUpdate = true; this.glowAttr.needsUpdate = true;
  }
}
