// Game: the rules. Owns the player, camera, enemies, spires and progress, and reports what
// happens through a small event bus that the UI and audio listen to.
import * as THREE from 'three';
import { Input } from './input.js';
import { CollisionWorld } from './collision.js';
import { Player, TUNE } from './player.js';
import { CameraRig } from './camera.js';
import { Particles } from './particles.js';
import { Vfx } from './vfx.js';
import { Enemies } from './enemies.js';
import { MeshBuilder, M } from '../world/arch/builder.js';
import { spireRadius } from '../world/arch/kit.js';
import { Notes } from './notes.js';
import { Tuning } from './tuning.js';
import { LEGS, NAMES } from './story.js';
import { Strings } from './strings.js';
import { Encounters } from './encounters.js';
import { People } from './people.js';
import { Quests } from './quests.js';
import { Trials } from './trials.js';
import { Bells } from './bells.js';
import { Reliquaries } from './reliquaries.js';
import { Wildlife } from '../world/wildlife.js';
import { POOLS } from '../world/layout.js';

// What each spire teaches when it is tuned.
export const SKILLS = {
  petal: { id: 'pulse', name: 'Resonance pulse', how: 'F sends a ring of the song through everything near you.' },
  cantor: { id: 'dash', name: 'Running cut', how: 'Strike at a sprint to carry the run into a full turn of the blade.' },
  choir: { id: 'echo', name: 'Echo step', how: 'Roll through a blow at the last moment and the world slows for a breath.' },
  east: { id: 'surge', name: 'Long pulse', how: 'The resonance pulse reaches further, hits harder and returns sooner.' },
  south3: { id: 'storm', name: 'Storm fall', how: 'The falling strike lands wider and harder, and its ring throws the Mute down.' },
  aurel: { id: 'wind', name: 'Second wind', how: 'Once in a life, a blow that would end you leaves you standing.' },
  south1: { id: 'gift', name: "The orchard's gift", how: 'More life and more breath, for good.' },
};

const SAVE_KEY = 'unsung-vale-save-v1';

const CRYSTAL_VERT = /* glsl */ `
out vec3 vWorld; out vec3 vN;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`;
const CRYSTAL_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uPower; uniform float uTime;
in vec3 vWorld; in vec3 vN;
void main() {
  vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  vec3 V = normalize(cameraPosition - vWorld);
  float f = pow(1.0 - abs(dot(N, V)), 2.0);
  float pulse = 0.85 + 0.15 * sin(uTime * 2.3);
  vec3 col = uColor * (0.05 + uPower * (1.2 + 2.5 * f) * pulse) + vec3(0.02, 0.02, 0.03) * (1.0 - uPower);
  gl_FragColor = vec4(col, 1.0);
}`;
const BEAM_VERT = /* glsl */ `
out vec2 vUv; out vec3 vWorld;
void main() {
  // A tall quad that turns about its vertical axis to face the camera.
  vec3 base = modelMatrix[3].xyz;
  vec2 d = normalize(cameraPosition.xz - base.xz);
  vec3 right = vec3(d.y, 0.0, -d.x);
  // Widen with distance so the pillar of light still reads from across the valley.
  float widen = 1.0 + distance(cameraPosition.xz, base.xz) * 0.012;
  vWorld = base + right * position.x * widen + vec3(0.0, position.y, 0.0);
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}`;
const BEAM_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uPower; uniform float uTime;
in vec2 vUv; in vec3 vWorld;
void main() {
  float x = abs(vUv.x - 0.5) * 2.0;
  float core = exp(-x * x * 70.0) * 5.0 + exp(-x * x * 6.0) * 1.1;
  float rise = 0.75 + 0.25 * sin(vUv.y * 60.0 - uTime * 6.0);
  float fade = (1.0 - smoothstep(0.55, 1.0, vUv.y)) * smoothstep(0.0, 0.01, vUv.y);
  float a = core * rise * fade * uPower;
  gl_FragColor = vec4(uColor * a, a);
}`;
const BRIDGE_VERT = /* glsl */ `
out vec2 vUv; out vec3 vWorld;
void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const BRIDGE_FRAG = /* glsl */ `
uniform float uProgress; uniform float uTime; uniform float uLength; uniform sampler2D uNoise;
in vec2 vUv; in vec3 vWorld;
float sq(float x) { return x * x; }
// An antialiased line of half-width w that dims, rather than shimmers, once it is thinner
// than a pixel.
float stroke(float d, float w) {
  float fw = max(fwidth(d), 1e-5);
  return (1.0 - smoothstep(w - fw, w + fw, d)) * min(1.0, w / fw + 0.25);
}
void main() {
  if (vUv.y > uProgress) discard;
  float x = (vUv.x - 0.5) * 5.2, y = vUv.y * uLength;          // metres across and along
  float edge = 2.6 - abs(x);
  float rail = stroke(edge, 0.05), railGlow = exp(-edge * edge * 9.0);
  // A diamond lattice with a rib across every few metres and a spine down the middle.
  const float S = 1.3;
  float da = abs(fract((x + y) / S) - 0.5) * S * 0.707, db = abs(fract((x - y) / S) - 0.5) * S * 0.707;
  float lattice = max(stroke(da, 0.012), stroke(db, 0.012));
  float rib = stroke(abs(fract(y / 5.2) - 0.5) * 5.2, 0.03);
  float spine = stroke(abs(x), 0.02);
  // Pulses of light run out along the span.
  float pulse = exp(-sq((fract(y / 70.0 - uTime * 0.11) - 0.5) * 14.0));
  float n = texture(uNoise, vec2(x * 0.11, y * 0.035 - uTime * 0.03)).r;
  // The leading edge is a bright seam; the lattice draws itself in first, the glow follows.
  float behind = (uProgress - vUv.y) * uLength;
  float front = exp(-sq(behind * 0.9)) * 14.0;
  float formed = smoothstep(0.0, 9.0, behind);
  float lines = lattice * 3.2 + rib * 4.0 + spine * 3.0 + rail * 14.0;
  float glow = (0.22 + 0.25 * n) * formed + railGlow * 1.6;
  float a = (lines * (0.6 + 0.4 * formed) + glow) * (1.0 + pulse * 1.6) + front;
  vec3 col = mix(vec3(1.0, 0.74, 0.36), vec3(1.0, 0.93, 0.78), clamp(a * 0.08, 0.0, 1.0)) * a;
  // Premultiplied: light, plus a faint veil so the deck reads against a bright lake.
  gl_FragColor = vec4(col, (0.1 + 0.22 * railGlow) * formed);
}`;
// Threads of light strung up the faces of a tuning spire.
const STRING_VERT = /* glsl */ `
in float aT; in float aK;
out float vT; out float vK;
void main() { vT = aT; vK = aK; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }`;
const STRING_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uPower; uniform float uTune; uniform float uTime;
in float vT; in float vK;
void main() {
  // A steady hum, beads of light climbing each string, and one bright bead that follows
  // the tuning as it is held.
  float bead = pow(0.5 + 0.5 * sin(vT * 26.0 - uTime * 4.0 + vK * 2.4), 6.0);
  float hum = 0.75 + 0.25 * sin(uTime * 9.0 + vK * 1.7);
  float climb = exp(-pow((vT - uTune) * 9.0, 2.0)) * step(0.001, uTune);
  vec3 col = uColor * (uPower * (1.6 * hum + 7.0 * bead) + climb * 16.0) + vec3(0.012, 0.011, 0.01);
  gl_FragColor = vec4(col, 1.0);
}`;

export class Game {
  constructor({ pipe, terrain, arch, sites, canvas, forest = null, rocks = null }) {
    this.pipe = pipe; this.terrain = terrain; this.sites = sites; this.arch = arch;
    this.world = new CollisionWorld(terrain);
    for (const g of sites.solids) this.world.addGeometry(g);
    for (const g of arch.farSolids ?? []) this.world.addGeometry(g);
    // Trees and boulders are solid too: trunks as capsules, stones with their real shape.
    forest?.trunkColliders((a, b, r) => this.world.addCapsule(a, b, r));
    for (const c of rocks?.colliders() ?? []) this.world.addLazy(c.cx, c.cz, c.r, c.build);
    this.input = new Input(canvas);
    this.player = new Player(this.world);
    this.rig = new CameraRig(pipe.camera, this.world);
    // Without a lock, a strike still finds the foe it was meant for: the nearest one within
    // reach of a step, roughly in the direction pushed (or faced).
    this.player.aimAssist = (dx, dz, reach = 5.5) => {
      const p = this.player.pos;
      let best = null, bs = 1e9;
      for (const e of this.enemies.list) {
        if (!e.alive || e.state === 'dormant' || Math.abs(e.pos.y - p.y) > (reach > 6 ? 30 : 3)) continue;
        const ex = e.pos.x - p.x, ez = e.pos.z - p.z, d = Math.hypot(ex, ez);
        if (d > reach + e.def.radius || d < 1e-3) continue;
        const dot = (ex * dx + ez * dz) / d;
        if (dot < (reach > 6 ? -0.3 : 0.2)) continue;
        const s = d * (1.5 - dot);
        if (s < bs) { bs = s; best = e; }
      }
      return best;
    };
    this.particles = new Particles(pipe, 1600);
    pipe.sceneT.add(this.particles.mesh);
    this.vfx = new Vfx(pipe);
    pipe.sceneT.add(this.vfx.group);
    this.flash = 0; this.baseExposure = pipe.exposure;      // a brief lift of exposure on the big moments
    this.enemies = new Enemies(pipe, this.world, this.particles);
    pipe.scene.add(this.enemies.mesh);
    this.state = 'home';          // home | playing | paused | ending | free
    this.time = 0; this.hitStop = 0; this.listeners = [];
    this.prompt = null; this.objective = ''; this.boss = null;
    this.tuneHold = 0;
    this.tuning = new Tuning(this);
    this._idle = { pressed: new Set(), held: new Set(), move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, zoom: 0 };

    // Stand-in body until the hero model is attached (see attachHero).
    const b = new MeshBuilder();
    b.mat_(M.MARBLE).lathe([[0.0, 0], [0.3, 0.02], [0.34, 0.5], [0.3, 1.0], [0.36, 1.35], [0.2, 1.55], [0.17, 1.7], [0.1, 1.82], [0, 1.83]], 12);
    this.standIn = new THREE.Mesh(b.build(), arch.material);
    this.standIn.frustumCulled = false;
    pipe.scene.add(this.standIn);
    pipe.shadows.addCaster(this.standIn, arch.depthMaterial, { dynamic: true });

    this._buildSpires();
    this._buildBridge();
    this.encounters = new Encounters(this);
    this.xp = 0; this.wildDone = []; this.bought = 0; this.slow = 0; this.slowCd = 0; this.menu = null;
    this.load();
    // Lost notes along the paths, kept clear of the courts where the fighting is.
    // More of them lie off the paths: round the outer courts and on the shores of the pools.
    const more = [], level = (x, z, y) => { const gh = this.world.groundHeight(x, z); return Math.abs(gh - y) < 5 && !Number.isFinite(this.world.waterLevel(x, z)) && Math.abs(this.world.floorBelow(x, gh + 16, z, 20) - gh) < 0.7 && [[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]].every(([dx, dz]) => Math.abs(this.world.floorBelow(x + dx, gh + 16, z + dz, 20) - this.world.groundHeight(x + dx, z + dz)) < 0.7); };
    for (const c of sites.outer ?? []) for (let k = 0; k < 7; k++) { const a = k * 0.8976 + c.x * 0.01, r = k % 2 ? 58 : 36, x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r; if (level(x, z, c.y)) more.push([x, z]); }
    for (const pl of POOLS) for (let k = 0; k < 3; k++) { const a = k * 2.094 + pl.x * 0.013, x = pl.x + Math.cos(a) * (pl.r + 7), z = pl.z + Math.sin(a) * (pl.r + 7); if (level(x, z, pl.level + 1)) more.push([x, z]); }
    this.notes = new Notes(this, pipe, LEGS, { avoid: sites.spires.map((s) => [s.x, s.z, 26]), extra: [[sites.spawn.x + 10, sites.spawn.z + 1.5]], more });
    this.bells = new Bells(this, pipe);
    this.reliquaries = new Reliquaries(this, pipe);
    this.wildlife = new Wildlife(this, pipe, POOLS);
    this._spawnEncounters();
    // The strings of light between the courts. A string wakes when the spires it needs sing.
    this.strings = new Strings(this, pipe, { dawn: [-512, -81], petal: [-385, -392], cantor: [53, -490.5], choir: [171.2, -36.2], east: [568.8, -427.8], south3: [517, 424], aurel: [148.6, 542.6], south1: [-392.4, 438.4], crown: [-993.7, -156.7] },
      [['dawn', 'petal', ['petal']], ['petal', 'cantor', ['petal', 'cantor']], ['cantor', 'choir', ['cantor', 'choir']], ['choir', 'east', ['choir']], ['east', 'south3', ['east']], ['south3', 'aurel', ['south3']], ['aurel', 'south1', ['aurel']], ['south1', 'crown', ['south1']], ['crown', 'dawn', ['crown']]]);
    // A sprinting footfall kicks up a little of whatever is underfoot.
    this.on((type, d) => { if (type === 'player' && d.type === 'step' && d.sprint && !this.cine) this._dust(3, 1.2, 2.2); });
    this.people = new People(this, pipe);
    this.quests = new Quests(this, pipe);
    this.trials = new Trials(this, pipe);
    this._skills(); this._charms();
    this.respawnAtCheckpoint();
    this._refreshObjective();
  }

  // The charms he wears (see reliquaries.js), handed to whoever acts on them.
  _charms() { const p = this.player, max = this.reliquaries?.slots() ?? 2; this.charmsWorn = (this.charmsWorn ?? []).filter((c) => (this.charmsFound ?? []).includes(c)).slice(-max); p.charms = new Set(this.charmsWorn); this.enemies.anvil = p.charms.has('anvil'); }

  // The hero knows what the tuned spires have taught him.
  _skills() { const p = this.player; p.skills.clear(); for (const s of this.spires) if ((s.tuned || this.cine) && SKILLS[s.id]) p.skills.add(SKILLS[s.id].id); }

  // Motes of resonance: thrown up and out of what fell, then drawn to the hero, faster the
  // longer they have been loose. Each is drawn as a short-lived spark where it is now.
  _motes(dt) {
    const list = this.motes; if (!list?.length) return;
    const p = this.player.pos, tx = p.x, ty = p.y + 1.15, tz = p.z;
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i]; m.t += dt;
      if (m.t < 0) continue;
      const dx = tx - m.x, dy = ty - m.y, dz = tz - m.z, d = Math.hypot(dx, dy, dz) || 1e-3, pull = Math.max(0, m.t - 0.3);
      if (pull > 0) { const want = 8 + pull * 26, k = Math.min(1, dt * (3 + pull * 14)); m.vx += (dx / d * want - m.vx) * k; m.vy += (dy / d * want - m.vy) * k; m.vz += (dz / d * want - m.vz) * k; }
      else { m.vy -= 9 * dt; const drag = Math.exp(-2.2 * dt); m.vx *= drag; m.vz *= drag; }
      m.x += m.vx * dt; m.y += m.vy * dt; m.z += m.vz * dt;
      this.particles.spawn(m.x, m.y, m.z, { vel: [m.vx * 0.2, m.vy * 0.2, m.vz * 0.2], life: 0.2, size: 0.075, color: [3.6, 2.7, 1.2], streak: 0.1 });
      if ((pull > 0 && d < 0.55) || m.t > 3) {
        this.particles.spawn(tx, ty, tz, { life: 0.14, size: 0.5, color: [1.6, 1.2, 0.5], alpha: 0.5 });
        if (m.first) this.emit('mote', {});
        list.splice(i, 1);
      }
    }
  }

  // Dust and grass thrown up by the hero's feet: at a sprint, in a roll, on a hard landing.
  _dust(n, speed, back = 0) {
    const p = this.player, stone = p.pos.y - this.terrain.heightAt(p.pos.x, p.pos.z) > 0.25, f = p.facing;
    const col = stone ? [0.55, 0.5, 0.44] : [0.3, 0.42, 0.14];
    for (let k = 0; k < n; k++) {
      const a = Math.random() * 6.283;
      this.particles.spawn(p.pos.x + Math.cos(a) * 0.25, p.pos.y + 0.08, p.pos.z + Math.sin(a) * 0.25, stone
        ? { vel: [Math.cos(a) * speed * 0.5 - f.x * back, 0.5 + Math.random() * 0.8, Math.sin(a) * speed * 0.5 - f.z * back], life: 0.55 + Math.random() * 0.3, size: 0.28, color: col, alpha: 0.22, grow: 1.6, drag: 2.4 }
        : { vel: [Math.cos(a) * speed - f.x * back, 1.6 + Math.random() * 2.2, Math.sin(a) * speed - f.z * back], life: 0.5, size: 0.035, color: col, gravity: 9, drag: 1.0, streak: 0.05 });
    }
  }

  // Stonework that belongs to the rules rather than to a site (a bell's frame, a pylon's
  // foot): built with the same kit and material as the courts, solid, and left out of the film.
  addProp(builder) {
    const mesh = new THREE.Mesh(builder.build(), this.arch.material);
    mesh.matrixAutoUpdate = false; mesh.frustumCulled = false;
    this.pipe.scene.add(mesh);
    this.pipe.shadows.addCaster(mesh, this.arch.depthMaterial, { dynamic: true });
    this.world.addGeometry(mesh.geometry);
    (this.props ??= []).push(mesh);
    return mesh;
  }

  // The side goal the interface shows: a trial under way, else the nearest quest.
  tracker() { return this.trials.tracker() ?? this.encounters.tracker() ?? this.quests.tracker(); }
  placeName(id) { return NAMES[id] ?? id; }

  // A place of rest (a tuned spire, a bell rung, a pylon reached): the refrains come back.
  rest() { const p = this.player; if (p.refrains < p.refrainMax) { p.refrains = p.refrainMax; this.emit('rest', {}); } }

  // A gift: one step of life, breath or edge, and some of the song (resonance).
  grant({ up = null, xp = 0 } = {}) {
    const p = this.player;
    if (up) p.up[up] = Math.min(8, p.up[up] + 1);
    this.xp += xp; p.health = p.healthMax; p.stamina = p.staminaMax;
    this.emit('grant', { up, xp });
    this.save();
  }
  // The luthier's bench: resonance for a step of the hero's choosing, dearer each time.
  get benchCost() { return 100 + 60 * this.bought; }
  buy(kind) {
    const p = this.player;
    if (this.xp < this.benchCost || p.up[kind] >= 8) return false;
    this.xp -= this.benchCost; this.bought++; p.up[kind]++;
    p.health = p.healthMax; p.stamina = p.staminaMax;
    this.emit('grant', { up: kind, xp: 0, bought: true });
    this.save();
    return true;
  }

  // Back to the last safe place (a tuned spire, a pylon, a bell, a note): the way out of
  // anywhere there is no way out of, such as the lake under the mesas.
  unstuck() {
    if (this.state !== 'playing' || this.tuning.active || this.people.talk || this.strings.ride) return;
    this.emit('fade', { on: true });
    setTimeout(() => { if (this.trials.run) this.trials._end(false); this.respawnAtCheckpoint(); this.hero?.cloth?.reset(); this.emit('fade', { on: false }); }, 650);
  }

  // A screen over the game (the map, the luthier's bench): the world waits behind it.
  openMenu(name) { if (this.state !== 'playing') return; this.state = 'menu'; this.menu = name; this.input.enabled = false; this.input.unlockPointer(); this.emit('state', { state: 'menu', menu: name }); }
  closeMenu() { if (this.state !== 'menu') return; this.menu = null; this.start(); }

  // Swaps the stand-in body for the real animated hero.
  attachHero(hero) { this.hero = hero; this.standIn.visible = false; this.player.autoSteps = false; hero.update(0.016, this.player, this); }

  on(fn) { this.listeners.push(fn); }
  emit(type, data = {}) { for (const fn of this.listeners) fn(type, data); }

  // --- world objects -------------------------------------------------------------------

  _buildSpires() {
    const g = this.pipe.globals;
    const geo = new THREE.OctahedronGeometry(1, 0).scale(0.62, 1.25, 0.62);
    const beamGeo = new THREE.PlaneGeometry(7, 900).translate(0, 450, 0);
    this.spires = this.sites.spires.map((s, i) => {
      const mat = new THREE.ShaderMaterial({ vertexShader: CRYSTAL_VERT, fragmentShader: CRYSTAL_FRAG, uniforms: { uColor: { value: new THREE.Vector3(1.0, 0.78, 0.4) }, uPower: { value: 0 }, uTime: g.uTime } });
      const crystal = new THREE.Mesh(geo, mat);
      crystal.position.set(s.x, s.y, s.z);
      this.pipe.scene.add(crystal);
      const beamMat = new THREE.ShaderMaterial({ vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, uniforms: { uColor: { value: new THREE.Vector3(1.0, 0.8, 0.45) }, uPower: { value: 0 }, uTime: g.uTime }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.position.set(s.x, s.y + 1, s.z); beam.frustumCulled = false; beam.renderOrder = 4;
      beam.updateMatrixWorld();
      this.pipe.sceneT.add(beam);
      // Eight strings, one up the middle of each face of the shaft.
      const sp = [], st = [], sk = [], si = [], h = s.h ?? 22, c8 = Math.cos(Math.PI / 8);
      const ys = [3.0, h * 0.35, h * 0.7 - 0.3];
      for (let k = 0; k < 8; k++) {
        const a = k * Math.PI / 4, ca = Math.cos(a), sa = Math.sin(a), w = 0.028;
        for (let j = 0; j < ys.length; j++) {
          const y = ys[j], r = spireRadius(y, h) * c8 + 0.1, t = (y - ys[0]) / (ys[2] - ys[0]);
          // A square thread: four corners per ring.
          for (const [dr, dt] of [[-w, -w], [w, -w], [w, w], [-w, w]]) { sp.push(ca * (r + dr) - sa * dt, y, -(sa * (r + dr) + ca * dt)); st.push(t); sk.push(k); }
          if (j > 0) { const o = (k * ys.length + j - 1) * 4; for (let q = 0; q < 4; q++) { const n = (q + 1) % 4; si.push(o + q, o + n, o + 4 + q, o + n, o + 4 + n, o + 4 + q); } }
        }
      }
      const sgeo = new THREE.BufferGeometry();
      sgeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
      sgeo.setAttribute('aT', new THREE.Float32BufferAttribute(st, 1));
      sgeo.setAttribute('aK', new THREE.Float32BufferAttribute(sk, 1));
      sgeo.setIndex(si);
      const strings = new THREE.Mesh(sgeo, new THREE.ShaderMaterial({ vertexShader: STRING_VERT, fragmentShader: STRING_FRAG, side: THREE.DoubleSide, uniforms: { uColor: { value: new THREE.Vector3(1.0, 0.8, 0.42) }, uPower: { value: 0 }, uTune: { value: 0 }, uTime: g.uTime } }));
      strings.position.set(s.x, s.base, s.z); strings.frustumCulled = false;
      strings.updateMatrixWorld();
      this.pipe.scene.add(strings);
      const zone = this.pipe.fog.mute[i];
      zone.set(s.x, s.z, i === 2 ? 60 : 78, 1);
      return { ...s, index: i, crystal, beam, strings, zone, tuned: false, power: 0, zoneR: zone.z, zoneR0: zone.z, tuning: 0 };
    });
  }

  _buildBridge() {
    const { from, to } = this.sites.bridge;
    const a = new THREE.Vector3(...from), c = new THREE.Vector3(...to);
    const L = a.distanceTo(c), dir = c.clone().sub(a).normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize().multiplyScalar(2.6);
    const pos = [], uv = [], idx = [], N = 60;
    for (let i = 0; i <= N; i++) {
      const p = a.clone().lerp(c, i / N);
      pos.push(p.x - side.x, p.y, p.z - side.z, p.x + side.x, p.y, p.z + side.z);
      uv.push(0, i / N, 1, i / N);
      if (i < N) { const o = i * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    this.bridgeMat = new THREE.ShaderMaterial({
      vertexShader: BRIDGE_VERT, fragmentShader: BRIDGE_FRAG, transparent: true, premultipliedAlpha: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uLength: { value: L }, uProgress: { value: 0 }, uTime: this.pipe.globals.uTime, uNoise: this.terrain.surfaceUniforms.uNoise },
    });
    this.bridge = new THREE.Mesh(geo, this.bridgeMat);
    this.bridge.frustumCulled = false; this.bridge.visible = false; this.bridge.renderOrder = 1;
    this.pipe.sceneT.add(this.bridge);
    // Collision slab, added to the world once the bridge has finished forming.
    const slab = new THREE.BufferGeometry();
    const sp = [];
    for (const [p, s] of [[a, -1], [a, 1], [c, -1], [c, 1]]) sp.push(p.x + side.x * s, p.y, p.z + side.z * s);
    for (const [p, s] of [[a, -1], [a, 1], [c, -1], [c, 1]]) sp.push(p.x + side.x * s, p.y - 0.6, p.z + side.z * s);
    slab.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    slab.setIndex([0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 5, 0, 5, 4, 2, 6, 7, 2, 7, 3, 0, 4, 6, 0, 6, 2, 1, 3, 7, 1, 7, 5]);
    slab.computeBoundingBox();
    this.bridgeSlab = slab; this.bridgeProgress = 0; this.bridgeOpen = false; this.bridgeSolid = false;
  }

  _spawnEncounters(inner = false) { this.encounters.reset(inner); }

  // --- progress ------------------------------------------------------------------------

  save() {
    if (this.cine) return;        // the film must never overwrite a player's progress
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ tuned: this.spires.filter((s) => s.tuned).map((s) => s.id), checkpoint: this.checkpoint, ended: this.ended, intro: !!this.introSeen, said: this.storySaid ?? [], notes: this.notesTaken ?? [], xp: this.xp, wild: this.wildDone, up: this.player.up, bought: this.bought, quests: this.quests?.dump() ?? this.questSave ?? {}, met: this.metPeople ?? [], map: !!this.hasMap, seen: this.seenPlaces ?? [], trials: this.trialsDone ?? [], bells: this.bellsRung ?? {}, outro: !!this.outroSeen, elites: this.elitesDown ?? [], charms: this.charmsFound ?? [], worn: this.charmsWorn ?? [], slain: this.slain ?? {}, echoes: this.echoes ?? [], time: Math.round(this.playTime ?? 0) })); } catch { /* storage may be unavailable */ }
  }
  load() {
    this.checkpoint = { ...this.sites.spawn };
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null');
      if (!d) return;
      for (const s of this.spires) if (d.tuned?.includes(s.id)) { s.tuned = true; s.power = 1; s.zoneR = 0; s.zone.w = 0; s.crystal.material.uniforms.uPower.value = 1; s.beam.material.uniforms.uPower.value = 1; }
      if (d.checkpoint) this.checkpoint = d.checkpoint;
      this.xp = d.xp ?? 0; this.wildDone = d.wild ?? []; this.bought = d.bought ?? 0;
      Object.assign(this.player.up, d.up ?? {}); this.questSave = d.quests ?? {}; this.metPeople = d.met ?? []; this.hasMap = !!d.map; this.seenPlaces = d.seen ?? []; this.trialsDone = d.trials ?? []; this.playTime = d.time ?? 0; this.bellsRung = d.bells ?? {}; this.outroSeen = !!d.outro; this.elitesDown = d.elites ?? []; this.charmsFound = d.charms ?? []; this.charmsWorn = d.worn ?? []; this.slain = d.slain ?? {}; this.echoes = d.echoes ?? [];
      this.ended = !!d.ended; this.introSeen = !!d.intro || !!d.tuned?.length; this.storySaid = d.said ?? []; this.notesTaken = d.notes ?? [];
      if (this.spires[1].tuned) { this.bridgeOpen = true; this.bridgeProgress = 1; }
      // A journey that ended when the Vale had three spires goes on now that it has eight.
      this.ended = this.ended && this.spires.every((s) => s.tuned);
    } catch { /* ignore a corrupt save */ }
  }
  get hasSave() { return this.spires.some((s) => s.tuned); }
  resetProgress() { try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ } location.reload(); }

  respawnAtCheckpoint() {
    const s = this.checkpoint;
    this.world.stream(s.x, s.z, 6);
    this.player.spawn(s.x, s.y, s.z, s.yaw ?? 0);
    this.rig.snap(this.player);
    this.rig.yaw = s.yaw ?? 0;
  }

  _refreshObjective() {
    if (this.story) { this.story._goal(); return; }
    const next = this.spires.find((s) => !s.tuned);
    const names = { petal: 'the Petal Court', cantor: "Cantor's Rise", choir: 'the Choir' };
    if (!next) this.objective = 'The Vale sings again';
    else if (this.enemies.aliveIn(next.id) > 0 || (next.id === 'cantor' && this.enemies.aliveIn('stair') > 0 && false)) this.objective = `Break the silence at ${names[next.id]}`;
    else this.objective = `Tune the spire at ${names[next.id]}`;
    this.emit('objective', { text: this.objective });
  }

  // Puts the world into a chosen story state. Used by the cinematic director so each shot
  // starts from known conditions; never called during normal play.
  cineSetup({ tuned = [], player = null, bridge = null } = {}) {
    { const was = this.cine; this.cine = true; this._skills(); this.cine = was; }      // the film's hero knows it all
    for (const s of this.spires) {
      const on = tuned.includes(s.id) || s.index > 2;
      s.tuned = on; s.tuning = 0; s.power = on ? 1 : 0;
      s.zoneR = on ? 0 : s.zoneR0; s.zone.z = s.zoneR; s.zone.w = on ? 0 : 1;
    }
    // bridge: null follows the story state; a number starts the bridge forming from there.
    this.bridgeOpen = bridge !== null ? true : tuned.includes('cantor');
    this.bridgeProgress = bridge ?? (this.bridgeOpen ? 1 : 0);
    this.bridge.visible = this.bridgeOpen;
    this.bridgeMat.uniforms.uProgress.value = this.bridgeProgress;
    this.enemies.list.length = 0; this.enemies.projectiles.length = 0; this.enemies.blasts.length = 0;
    this._spawnEncounters(true);
    this.boss = null; this.hitStop = 0;
    const p = this.player;
    if (player) {
      p.spawn(player[0], player[1], player[2], player[3] ?? 0); this.rig.yaw = player[3] ?? 0;
      // He was somewhere else a moment ago: no cape whipping across, no blade trail between.
      this.hero?.cloth?.reset(); if (this.hero?.trailPts) this.hero.trailPts.length = 0;
    }
    p.lockTarget = null; p.events.length = 0;
  }

  // --- flow ----------------------------------------------------------------------------

  start() { this.state = 'playing'; this.input.enabled = true; this.input.lockPointer(); this.emit('state', { state: 'playing' }); }
  pause() { if (this.state !== 'playing') return; this.state = 'paused'; this.input.enabled = false; this.input.unlockPointer(); this.emit('state', { state: 'paused' }); }
  resume() { if (this.state !== 'paused') return; this.start(); }
  toHome() { this.state = 'home'; this.input.enabled = false; this.input.unlockPointer(); this.emit('state', { state: 'home' }); }

  // --- photo mode: the world holds its breath and the view goes where it likes ---
  photo(on) {
    const cam = this.pipe.camera;
    if (on) {
      if (this.state !== 'playing' || this.cine || this.tuning.active || this.people.talk || this.player.state === 'dead' || this.player.state === 'ride') return;
      const d = cam.getWorldDirection(new THREE.Vector3());
      this._photo = { fov0: cam.fov, fov: cam.fov, yaw: Math.atan2(d.x, d.z), pitch: Math.asin(Math.max(-1, Math.min(1, d.y))), pos: cam.position.clone() };
      this.state = 'photo'; this.emit('state', { state: 'photo' });
    } else if (this.state === 'photo') {
      cam.fov = this._photo.fov0; cam.updateProjectionMatrix(); this._photo = null;
      this.state = 'playing'; this.emit('state', { state: 'playing' });
    }
  }
  _photoTick(dt) {
    const ph = this._photo, cam = this.pipe.camera, inp = this.input, p = this.player.pos;
    ph.yaw -= inp.look.x; ph.pitch = Math.max(-1.45, Math.min(1.45, ph.pitch - inp.look.y));
    const cp = Math.cos(ph.pitch), fx = Math.sin(ph.yaw) * cp, fy = Math.sin(ph.pitch), fz = Math.cos(ph.yaw) * cp;
    const sp = (inp.held.has('sprint') ? 16 : inp.held.has('walk') ? 1.2 : 5) * Math.min(dt, 0.05);
    const up = (inp.held.has('jump') ? 1 : 0) - (inp.held.has('dodge') ? 1 : 0);
    ph.pos.x += (fx * inp.move.y - Math.cos(ph.yaw) * inp.move.x) * sp; ph.pos.y += (fy * inp.move.y + up) * sp; ph.pos.z += (fz * inp.move.y + Math.sin(ph.yaw) * inp.move.x) * sp;
    // It stays within a stone's throw of him and never goes under the ground or a floor.
    const dx = ph.pos.x - p.x, dy = ph.pos.y - (p.y + 1.2), dz = ph.pos.z - p.z, d = Math.hypot(dx, dy, dz), far = 45;
    if (d > far) { ph.pos.x = p.x + dx / d * far; ph.pos.y = p.y + 1.2 + dy / d * far; ph.pos.z = p.z + dz / d * far; }
    const fl = this.world.floorBelow(ph.pos.x, ph.pos.y + 1.2, ph.pos.z, 80) + 0.3; if (ph.pos.y < fl) ph.pos.y = fl;
    if (inp.zoom) ph.fov = Math.max(14, Math.min(95, ph.fov + inp.zoom * 4));
    cam.fov += (ph.fov - cam.fov) * Math.min(1, dt * 10); cam.updateProjectionMatrix();
    cam.position.copy(ph.pos); cam.lookAt(ph.pos.x + fx, ph.pos.y + fy, ph.pos.z + fz);
    if (inp.pressed.has('attack') || inp.pressed.has('interact')) this._photoSave();
  }
  // The picture as it stands on the canvas, saved as a PNG.
  _photoSave() {
    try {
      const c = this.pipe.renderer.domElement;
      this.pipe.render(1 / 240);
      c.toBlob((b) => { if (!b) return; const a = document.createElement('a'), t = new Date(), z = (n) => String(n).padStart(2, '0'); a.href = URL.createObjectURL(b); a.download = `unsung-vale-${t.getFullYear()}${z(t.getMonth() + 1)}${z(t.getDate())}-${z(t.getHours())}${z(t.getMinutes())}${z(t.getSeconds())}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }, 'image/png');
      this.emit('photo', { saved: true });
    } catch { /* a picture is not worth a crash */ }
  }

  update(realDt) {
    this.input.update();
    if (!this.cine && this.input.pressed.has('photo')) { this.photo(this.state !== 'photo'); return; }
    if (this.state === 'photo') { if (this.input.pressed.has('pause')) this.photo(false); else this._photoTick(realDt); return; }
    if (!this.cine && this.input.pressed.has('pause')) { if (this.state === 'playing') this.pause(); else if (this.state === 'paused') this.resume(); else if (this.state === 'menu') this.closeMenu(); }
    if (!this.cine && this.input.pressed.has('map')) { if (this.state === 'playing' && !this.tuning.active && !this.people.talk) this.openMenu(this.hasMap ? 'map' : 'journal'); else if (this.menu === 'map' || (this.menu === 'journal' && !this.hasMap)) this.closeMenu(); }
    if (!this.cine && this.input.pressed.has('journal')) { if (this.state === 'playing' && !this.tuning.active && !this.people.talk) this.openMenu('journal'); else if (this.menu === 'journal') this.closeMenu(); }
    if (this.state !== 'playing' && this.state !== 'ending') {
      // The world keeps breathing behind the menus.
      this.particles.update(realDt); this.vfx.update(realDt);
      this.notes.update(realDt, false);
      this.strings.update(realDt, false);
      this.quests.update(realDt, false); this.people.update(realDt, false); this.trials.update(realDt, false); this.bells.update(realDt, false); this.reliquaries.update(realDt, false); this.wildlife.update(realDt);
      this._animateWorld(realDt);
      this.enemies.update(0, this.player, this.time);
      this.hero?.update(realDt, this.player, this);
      return;
    }
    // Hit-stop: a few frames of near-frozen time sell the weight of a blow.
    this.hitStop = Math.max(0, this.hitStop - realDt);
    const dt = this.hitStop > 0 ? realDt * 0.06 : realDt;
    this.time += dt;
    const p = this.player;

    this.world.stream(p.pos.x, p.pos.z);
    // While a spire is being tuned the hero stands to it and the camera belongs to the moment.
    const busy = this.tuning.active || !!this.people.talk;
    // How hard the Mute press: more of them at once and brisker on Standard and Hard.
    // The film is fought on the numbers it was made with, whatever the player has chosen.
    const ch = this.cine ? 'gentle' : this.challenge;
    this.enemies.film = !!this.cine;
    this.enemies.crowd = { gentle: 2, hard: 4 }[ch] ?? 3; this.enemies.haste = { gentle: 1, hard: 1.5 }[ch] ?? 1.3;
    p.inCombat = this.enemies.list.some((e) => e.alive && e.state !== 'dormant' && e.state !== 'return' && e.pos.distanceToSquared(p.pos) < 1600);
    p.refrainMax = TUNE.refrain.charges + (this.spires.filter((s) => s.tuned).length >= 3 ? 1 : 0) + (this.spires.filter((s) => s.tuned).length >= 6 ? 1 : 0);
    // Echo step: for a breath the Mute move as if through water.
    this.slow = Math.max(0, this.slow - realDt); this.slowCd = Math.max(0, this.slowCd - realDt);
    const edt = this.slow > 0 ? dt * (0.22 + 0.78 * Math.max(0, 1 - this.slow / 0.35)) : dt;
    p.update(dt, busy ? this._idle : this.input, this.rig.yaw);
    this._cadenceTick(dt);
    if (this.riposteT > 0) {
      // While the opening lasts the blade shows it.
      this.riposteT -= dt; const tip = this.hero?.tip;
      if (tip) for (let k = 0; k < 2; k++) this.particles.spawn(tip.x, tip.y, tip.z, { vel: [(Math.random() - 0.5) * 1.5, Math.random() * 1.5, (Math.random() - 0.5) * 1.5], life: 0.22, size: 0.06, color: [5, 4.4, 3.0], drag: 2 });
    }
    this._bodies();
    if (!busy && p.state !== 'ride') { this._lockOn(); this._combat(); }
    this.enemies.update(edt, p, this.time);
    if (!this.cine) this.encounters.update(dt);
    for (const e of this.enemies.events) this._onEnemyEvent(e);
    this.enemies.events.length = 0;
    for (const e of p.events) this._onPlayerEvent(e);
    p.events.length = 0;
    this._spireLogic(dt);
    if (!busy) this._finisher(dt);
    this.strings.update(dt, !this.cine && !busy);
    this.quests.update(dt, !this.cine && !busy);
    this.trials.update(dt, !this.cine && !busy);
    this.bells.update(dt, !this.cine && !busy);
    this.reliquaries.update(dt, !this.cine && !busy);
    this.wildlife.update(dt);
    this.notes.update(dt, !this.cine);
    this._animateWorld(dt);
    this._motes(dt);
    this.particles.update(dt); this.vfx.update(dt);
    // In a cinematic the director owns the camera; the rig only tracks yaw for movement.
    // A giant pulling itself together draws the eye: the view comes round to it for a moment.
    if (this.regard && !this.cine) {
      const r = this.regard; r.t -= realDt;
      if (r.t <= 0 || !r.e.alive) this.regard = null;
      else { const want = Math.atan2(r.e.pos.x - p.pos.x, r.e.pos.z - p.pos.z), d = Math.atan2(Math.sin(want - this.rig.yaw), Math.cos(want - this.rig.yaw)); this.rig.yaw += d * Math.min(1, 3.2 * realDt); this.rig.pitch += (-0.02 - this.rig.pitch) * Math.min(1, 2 * realDt); }
    }
    if (this.tuning.active) this.tuning.update(realDt);
    else if (!this.people.talk && !this.cine) this.rig.update(realDt, p, this.input);
    this.people.update(realDt, !this.cine);

    if (this.hero) this.hero.update(dt, p, this);
    else { this.standIn.position.copy(p.pos); this.standIn.rotation.y = p.yaw; this.standIn.updateMatrixWorld(); }

    if (p.state === 'dead' && p.stateTime > 1.9 && !this._deadFade) { this._deadFade = true; this.emit('fade', { on: true }); }
    if (p.state === 'dead' && p.stateTime > 2.7) {
      this.respawnAtCheckpoint();
      this.hero?.cloth?.reset();
      this._deadFade = false; this.emit('fade', { on: false });
      this.emit('respawn');
    }
  }

  // The hero and the constructs cannot stand inside one another: whoever overlaps is eased
  // apart (he can still roll through the small ones).
  _bodies() {
    const p = this.player;
    if (p.state === 'dead') return;
    for (const e of this.enemies.list) {
      if (!e.alive || e.state === 'dormant' || e.state === 'rise') continue;
      if (p.state === 'roll' && !e.def.boss) continue;
      if (Math.abs(p.pos.y - e.pos.y) > 2.2 + e.def.core) continue;
      const dx = p.pos.x - e.pos.x, dz = p.pos.z - e.pos.z, d = Math.hypot(dx, dz), min = TUNE.radius + e.def.radius * 0.85;
      if (d >= min || d < 1e-4) continue;
      const k = (min - d) / d;
      p.pos.x += dx * k * 0.7; p.pos.z += dz * k * 0.7;
      if (!e.def.boss) { e.pos.x -= dx * k * 0.3; e.pos.z -= dz * k * 0.3; }
    }
  }

  _lockOn() {
    const p = this.player;
    if (p.lockTarget && (!p.lockTarget.alive || p.lockTarget.pos.distanceTo(p.pos) > 34)) { p.lockTarget = null; this.emit('lock', { target: null }); }
    if (!this.input.pressed.has('lock')) return;
    if (p.lockTarget) { p.lockTarget = null; this.emit('lock', { target: null }); return; }
    let best = null, bs = 1e9;
    const f = new THREE.Vector3(Math.sin(this.rig.yaw), 0, Math.cos(this.rig.yaw));
    for (const e of this.enemies.list) {
      if (!e.alive || e.state === 'dormant') continue;
      const d = e.pos.clone().sub(p.pos); const dist = d.length();
      if (dist > 30) continue;
      const score = dist * (1.6 - d.normalize().dot(f));
      if (score < bs) { bs = score; best = e; }
    }
    p.lockTarget = best;
    this.emit('lock', { target: best });
  }

  _combat() {
    const p = this.player;
    // The heavy strike ends with the blade in the ground: a ring, dust and a jolt, hit or miss.
    if (p.state === 'attack' && p.comboStep === 3) {
      if (!this._slammed && p.stateTime >= 0.42) {
        this._slammed = true;
        const tip = this.hero?.tip ?? p.pos, gx = this.hero ? tip.x : p.pos.x + p.facing.x * 1.6, gz = this.hero ? tip.z : p.pos.z + p.facing.z * 1.6;
        const gy = this.world.floorBelow(gx, p.pos.y + 1, gz, 3) + 0.06;
        this.vfx.wave(gx, gy, gz, { r0: 0.3, r1: 4.2, life: 0.45, strength: 0.9, width: 0.1, color: [2.2, 1.6, 0.8] });
        this.particles.burst(gx, gy + 0.1, gz, 22, { speed: 5, life: 0.5, size: 0.05, color: [3.4, 2.5, 1.2], gravity: 12, drag: 1.4, streak: 0.1, up: 2.5 });
        this.rig.addShake(0.35);
        this.emit('player', { type: 'slamHit' });
      }
    } else this._slammed = false;
    if (!p.attackActive) return;
    const a = p.attack, f = p.facing.clone();
    for (const e of this.enemies.list) {
      if (!e.alive || e.state === 'dormant' || p.hitDone.has(e)) continue;
      const d = e.pos.clone().sub(p.pos); const dy = d.y; d.y = 0;
      const dist = d.length() - e.def.radius;
      if (dist > a.reach || Math.abs(dy) > 2.5 + e.def.core) continue;
      if (dist > 0.6 && d.normalize().dot(f) < Math.cos(a.arc / 2 + 0.25)) continue;
      p.hitDone.add(e);
      // The answer to a slipped blow: the first swing after it lands like a heavy one, and harder.
      if (this.riposteT > 0) { this.riposteT = 0; this._ripUntil = this.time + 0.2; }
      const rip = this.time < (this._ripUntil ?? 0), heavy = p.comboStep >= 2 || rip;
      if (this.enemies.hit(e, a.dmg * p.power * (rip ? 1.7 : 1) * (1 + 0.08 * this.cadenceLevel) * ({ gentle: 1, hard: 0.8 }[this.cine ? 'gentle' : this.challenge] ?? 0.9), p.pos, heavy)) {
        if (rip) { const c0 = e.center ?? e.pos; this.vfx.wave(c0.x, c0.y, c0.z, { kind: 1, r0: 0.3, r1: 3.2, life: 0.32, strength: 1.5, width: 0.08, color: [4.2, 3.6, 2.4] }); this.flash = Math.max(this.flash, 0.2); this.emit('riposte', { enemy: e }); }
        this._cadence(heavy ? 2 : 1, e);
        this.hitStop = heavy ? 0.11 : 0.06;
        this.rig.addShake(heavy ? 0.5 : 0.28);
        const c = e.center ?? e.pos, hy = c.y + (e.center ? 0 : 1.2);
        const tv = this.hero?.tipVel, cut = tv && tv.lengthSq() > 9 ? tv.clone().normalize() : null;
        const sd = cut ? [cut.x * 0.8 + f.x * 0.3, cut.y * 0.6 + 0.25, cut.z * 0.8 + f.z * 0.3] : [f.x, 0.35, f.z];
        this.particles.burst(c.x, hy, c.z, heavy ? 36 : 20, { speed: heavy ? 13 : 10, life: 0.42, size: 0.055, color: [5.5, 4, 1.9], gravity: 16, drag: 1.2, streak: 0.16, dir: sd, bias: 5 });
        this.particles.spawn(c.x, hy, c.z, { life: 0.1, size: heavy ? 1.7 : 1.1, color: [3.6, 2.8, 1.6], alpha: 0.7 });
        this.vfx.wave(c.x, hy, c.z, { kind: 1, r0: 0.2, r1: heavy ? 2.4 : 1.5, life: heavy ? 0.26 : 0.18, strength: heavy ? 0.9 : 0.55, width: 0.18, color: [1.1, 0.85, 0.5] });
        if (heavy) this.vfx.wave(e.pos.x, e.pos.y + 0.08, e.pos.z, { r0: 0.4, r1: 4.5, life: 0.45, strength: 0.8, width: 0.1, color: [2.6, 1.9, 0.9] });
        this.emit('hit', { heavy, enemy: e });
      }
    }
  }

  // The last note. A named one or a giant that is nearly spent can be ended at a stroke: he
  // goes up, turns in the air and comes down on it blade first, and nothing is left standing.
  _finisher(dt) {
    const p = this.player, f = this.finisher;
    if (f) {
      f.t += dt;
      if (!f.dived && f.t >= 0.3) {
        f.dived = true;
        p.setState('plunge'); p.plungeHit = false; p.plungeTop = p.pos.y; p.plungeAim = f.e.pos.clone();
        p.yaw = Math.atan2(f.e.pos.x - p.pos.x, f.e.pos.z - p.pos.z); p.emit('plungeStart');
      }
      if (f.t > 3 || p.state === 'dead') this.finisher = null;
      return;
    }
    if (this.cine || this.prompt || p.state !== 'move' || !p.grounded) return;
    let best = null, bd = 7.5;
    for (const e of this.enemies.list) {
      if (!e.alive || !(e.elite || e.def.boss) || e.state === 'dormant' || e.state === 'rise' || e.hp > e.def.hp * 0.14 || Math.abs(e.pos.y - p.pos.y) > 3) continue;
      const d = e.pos.distanceTo(p.pos) - e.def.radius; if (d < bd) { bd = d; best = e; }
    }
    if (!best) return;
    this.prompt = { key: 'E', text: 'End it' };
    if (!this.input.pressed.has('interact')) return;
    this.prompt = null;
    this.finisher = { e: best, t: 0 };
    p.invulnerable = Math.max(p.invulnerable, 2.4); p.lockTarget = null;
    const dx = best.pos.x - p.pos.x, dz = best.pos.z - p.pos.z, d = Math.hypot(dx, dz) || 1, sp = Math.min(6, d * 2);
    p.vel.set((dx / d) * sp, 11.5, (dz / d) * sp); p.grounded = false; p.yaw = Math.atan2(dx, dz);
    this.slow = Math.max(this.slow, 1.3);
    this.vfx.wave(p.pos.x, p.pos.y + 0.08, p.pos.z, { r0: 0.3, r1: 4.5, life: 0.45, strength: 1.0, width: 0.07, color: [3.4, 2.5, 1.1] });
    this.particles.burst(p.pos.x, p.pos.y + 0.2, p.pos.z, 18, { speed: 4, life: 0.5, size: 0.05, color: [4, 3, 1.4], gravity: -3, drag: 1.2, up: 3 });
    this.emit('finisher', { phase: 'leap', enemy: best });
  }

  // Cadence: every blow that lands without one taken in between counts toward it. Three make
  // a step, four steps the whole of it; each step puts more weight in the blade, and at the
  // top every cut rings. It fades if the blade rests, and a blow taken breaks it at once.
  get cadenceLevel() { return Math.min(4, Math.floor((this.cadence ?? 0) / 3)); }
  _cadence(n, e = null) {
    if (this.cine) return;
    const was = this.cadenceLevel;
    this.cadence = Math.min(12, (this.cadence ?? 0) + n); this.cadenceT = this.player.charms?.has('ember') ? 10 : 5;
    const lv = this.cadenceLevel, p = this.player;
    if (lv > was) {
      this.emit('cadence', { level: lv, up: true });
      this.vfx.wave(p.pos.x, p.pos.y + 0.08, p.pos.z, { r0: 0.3, r1: 2.2 + lv * 0.9, life: 0.5, strength: 0.5 + 0.2 * lv, width: 0.05, color: [3.4, 2.5, 1.1] });
      if (lv === 4) { this.vfx.wave(p.pos.x, p.pos.y + 1.1, p.pos.z, { kind: 1, r0: 0.3, r1: 3.6, life: 0.45, strength: 1.2, width: 0.08, color: [3.6, 2.7, 1.2] }); this.flash = Math.max(this.flash, 0.16); }
    }
    // In full cadence a cut gives a little breath back and rings where it lands.
    if (lv === 4 && e) {
      p.stamina = Math.min(p.staminaMax, p.stamina + 5);
      const c = e.center ?? e.pos;
      this.vfx.wave(c.x, c.y, c.z, { kind: 1, r0: 0.2, r1: 2.0, life: 0.3, strength: 0.9, width: 0.07, color: [3.6, 2.7, 1.2] });
    }
  }
  _cadenceTick(dt) {
    if (!(this.cadence > 0)) return;
    const lv = this.cadenceLevel;
    this.cadenceT -= dt;
    if (this.cadenceT <= 0) { this.cadence = Math.max(0, this.cadence - 3); this.cadenceT = this.player.charms?.has('ember') ? 2.2 : 1.1; if (this.cadenceLevel < lv) this.emit('cadence', { level: this.cadenceLevel }); }
    // The blade itself shows it: a thread of sparks off the point, thicker with every step.
    const tip = this.hero?.tip;
    if (tip && lv >= 2 && Math.random() < dt * (10 + 14 * (lv - 2))) this.particles.spawn(tip.x, tip.y, tip.z, { vel: [(Math.random() - 0.5) * 0.6, 0.5 + Math.random() * 0.8, (Math.random() - 0.5) * 0.6], life: 0.3 + 0.1 * lv, size: 0.03 + 0.008 * lv, color: [4.2, 3.1, 1.4], drag: 1.6 });
  }
  _cadenceBreak() {
    if (!(this.cadence > 0)) return;
    const lv = this.cadenceLevel, p = this.player;
    this.cadence = 0;
    if (lv > 0) {
      this.emit('cadence', { level: 0, broke: true });
      this.particles.burst(p.pos.x, p.pos.y + 1.2, p.pos.z, 8 + lv * 5, { speed: 4, life: 0.5, size: 0.04, color: [2.6, 2.0, 1.0], gravity: 6, drag: 1.6 });
    }
  }

  _onPlayerEvent(e) {
    const p = this.player;
    if (e.type === 'hurt' || e.type === 'death' || e.type === 'wind') this._cadenceBreak();
    // A blow slipped at the last instant keeps the time, and adds to it.
    if (e.type === 'evade') this._cadence(1);
    if (e.type === 'evade' && !this.cine) { this.riposteT = 1.25; this.emit('opening', {}); }
    if (e.type === 'evade' && p.charms?.has('tide') && p.health < p.healthMax) { p.health = Math.min(p.healthMax, p.health + 7); this.particles.burst(p.pos.x, p.pos.y + 1.1, p.pos.z, 10, { speed: 2.2, life: 0.6, size: 0.05, color: [1.6, 2.6, 2.4], gravity: -2, drag: 1.5 }); }
    if (e.type === 'land' && e.fell > 3) this.rig.addShake(Math.min(0.5, e.fell * 0.03));
    if (e.type === 'land' && e.fell > 1.5) this.vfx.wave(p.pos.x, p.pos.y + 0.06, p.pos.z, { r0: 0.2, r1: 1.2 + Math.min(3, e.fell * 0.3), life: 0.4, strength: 0.5, width: 0.16, color: [0.5, 0.42, 0.3] });
    if (e.type === 'land') this.hero?.onLand(e.fell ?? 0);
    if (e.type === 'land' && e.fell > 0.8 && !this.cine) this._dust(Math.min(14, 4 + Math.round(e.fell * 2)), 2.2);
    if (e.type === 'roll' && !this.cine) this._dust(9, 1.6, 2.5);
    if (e.type === 'plunge' && this.finisher?.dived) {
      // It lands: whatever the thing had left goes at once, and the whole court knows.
      const q = this.finisher.e; this.finisher = null;
      if (q.alive) {
        const c = q.center.clone();
        q.ward = 0; q.shelled = false; q.hp = 1; this.enemies.hit(q, 9999, p.pos, true);
        for (const [dl, r, s] of [[0, 9, 1.8], [0.12, 14, 1.2], [0.28, 20, 0.8]]) this.vfx.wave(q.pos.x, q.pos.y + 0.1, q.pos.z, { r0: 0.5, r1: r, life: 0.9, strength: s, width: 0.06, color: [3.6, 2.7, 1.2], delay: dl });
        this.vfx.wave(c.x, c.y, c.z, { kind: 1, r0: 0.4, r1: 6, life: 0.5, strength: 1.8, width: 0.1, color: [4.2, 3.4, 2.0] });
        for (let k = 0; k < 70; k++) { const a = Math.random() * 6.283, sp = 3 + Math.random() * 9; this.particles.spawn(c.x, c.y, c.z, { vel: [Math.cos(a) * sp, 4 + Math.random() * 12, Math.sin(a) * sp], life: 0.8 + Math.random() * 0.7, size: 0.06, color: [5, 3.9, 1.8], gravity: 10, drag: 0.8, streak: 0.16 }); }
        this.hitStop = Math.max(this.hitStop, 0.22); this.rig.addShake(1.0); this.flash = Math.max(this.flash, 0.5); this.slow = Math.max(this.slow, 0.9);
        this._cadence(3);
        this.emit('finisher', { phase: 'end', enemy: q });
      }
    }
    if (e.type === 'plunge') {
      const storm = p.skills.has('storm'), P = storm ? { ...TUNE.plunge, radius: TUNE.plunge.radius * 1.5, dmg: TUNE.plunge.dmg * 1.5 } : TUNE.plunge;
      const x = p.pos.x, y = p.pos.y + 0.08, z = p.pos.z, power = Math.min(1, 0.45 + e.height * 0.07);
      if (storm) { this.vfx.wave(x, y, z, { r0: 1, r1: P.radius * 2.1, life: 0.9, strength: 1.2 * power, width: 0.05, color: [3.2, 2.3, 1.0], delay: 0.18 }); this.vfx.wave(x, y + 1.4, z, { kind: 1, r0: 0.5, r1: P.radius * 1.2, life: 0.5, strength: 1.2 * power, width: 0.1, color: [2.2, 1.7, 0.9], delay: 0.05 }); }
      for (const en of this.enemies.list) {
        if (!en.alive || en.state === 'dormant' || Math.abs(en.pos.y - p.pos.y) > 3) continue;
        const d = en.pos.distanceTo(p.pos) - en.def.radius;
        if (d < P.radius) this.enemies.hit(en, Math.round((P.dmg + Math.min(40, e.height * 3)) * p.power * (1 - 0.5 * Math.max(0, d) / P.radius)), p.pos, true);
      }
      this.vfx.wave(x, y, z, { r0: 0.4, r1: P.radius * 1.5, life: 0.6, strength: 1.6 * power, width: 0.08, color: [3.2, 2.3, 1.0] });
      this.vfx.wave(x, y, z, { r0: 0.4, r1: P.radius * 1.05, life: 0.7, strength: 1.0 * power, width: 0.1, color: [2.0, 1.5, 0.7], delay: 0.1 });
      this.vfx.wave(x, y + 1.0, z, { kind: 1, r0: 0.4, r1: P.radius * 0.8, life: 0.35, strength: 1.2 * power, width: 0.12, color: [1.4, 1.1, 0.6] });
      for (let k = 0; k < 44; k++) { const a = (k / 44) * 6.283 + Math.random() * 0.1, sp = 5 + Math.random() * 7; this.particles.spawn(x + Math.cos(a) * 0.5, y + 0.1, z + Math.sin(a) * 0.5, { vel: [Math.cos(a) * sp, 2 + Math.random() * 5, Math.sin(a) * sp], life: 0.6, size: 0.06, color: [4.2, 3.0, 1.3], gravity: 14, drag: 1.2, streak: 0.14 }); }
      this.rig.addShake(0.5 + 0.4 * power); this.hitStop = 0.09; this.flash = Math.max(this.flash, 0.3 * power);
    }
    if (e.type === 'splash' || e.type === 'stroke') {
      const y = (Number.isFinite(p.water) ? p.water : p.pos.y + 1.2) + 0.03, big = e.type === 'splash';
      this.vfx.wave(p.pos.x, y, p.pos.z, { r0: 0.3, r1: big ? 3.2 : 1.6, life: big ? 0.9 : 1.1, strength: big ? 0.9 : 0.35, width: 0.14, color: [0.5, 0.6, 0.62] });
      if (big) this.particles.burst(p.pos.x, y, p.pos.z, 26, { speed: 3 + Math.min(4, (e.speed ?? 3) * 0.3), life: 0.6, size: 0.05, color: [1.4, 1.6, 1.7], gravity: 12, drag: 0.6, up: 2.5 });
    }
    if (e.type === 'hurt') {
      // The blow lands: time catches, sparks leave the armour, the view jolts.
      this.rig.addShake(e.heavy ? 0.8 : 0.45); this.hero?.onHit(); this.hitStop = Math.max(this.hitStop, e.heavy ? 0.1 : 0.05);
      const a = p.hurtDir ?? p.yaw + Math.PI;
      this.particles.burst(p.pos.x, p.pos.y + 1.2, p.pos.z, e.heavy ? 34 : 16, { speed: e.heavy ? 9 : 6, life: 0.45, size: 0.05, color: [4.5, 3.2, 1.6], gravity: 14, drag: 1.4, streak: 0.14, dir: [Math.sin(a), 0.4, Math.cos(a)], bias: 4 });
      this.vfx.wave(p.pos.x, p.pos.y + 1.1, p.pos.z, { kind: 1, r0: 0.2, r1: e.heavy ? 2.6 : 1.5, life: 0.25, strength: e.heavy ? 1.3 : 0.7, width: 0.16, color: [1.6, 0.7, 0.5] });
      if (e.heavy) this.vfx.wave(p.pos.x, p.pos.y + 0.08, p.pos.z, { r0: 0.3, r1: 3.4, life: 0.5, strength: 0.8, width: 0.1, color: [1.2, 0.5, 0.4] });
    }
    if (e.type === 'evade' && p.skills.has('echo') && this.slowCd <= 0) {
      // Echo step: the blow passes through where he was, and the moment stretches.
      this.slow = 1.5; this.slowCd = 3.5; p.stamina = Math.min(p.staminaMax, p.stamina + 45);
      this.vfx.wave(p.pos.x, p.pos.y + 0.08, p.pos.z, { r0: 0.4, r1: 7, life: 0.7, strength: 0.9, width: 0.06, color: [2.2, 2.0, 1.6] });
      this.vfx.wave(p.pos.x, p.pos.y + 1.0, p.pos.z, { kind: 1, r0: 0.3, r1: 3.4, life: 0.4, strength: 0.9, width: 0.1, color: [2.0, 1.8, 1.4] });
      this.flash = Math.max(this.flash, 0.22);
      this.emit('echo', {});
    }
    if (e.type === 'wind') {
      for (const en of this.enemies.list) if (en.alive && en.state !== 'dormant' && en.pos.distanceTo(p.pos) < 7) this.enemies.hit(en, 8, p.pos, true);
      this.vfx.wave(p.pos.x, p.pos.y + 0.08, p.pos.z, { r0: 0.5, r1: 9, life: 0.8, strength: 1.4, width: 0.07, color: [3.2, 2.3, 1.0] });
      this.vfx.wave(p.pos.x, p.pos.y + 1.0, p.pos.z, { kind: 1, r0: 0.4, r1: 5, life: 0.5, strength: 1.4, width: 0.1, color: [3.2, 2.3, 1.0] });
      this.flash = Math.max(this.flash, 0.5); this.rig.addShake(0.6); this.hitStop = 0.14;
    }
    if (e.type === 'healStart') {
      for (let k = 0; k < 16; k++) { const a = (k / 16) * 6.283; this.particles.spawn(p.pos.x + Math.cos(a) * 1.3, p.pos.y + 0.1, p.pos.z + Math.sin(a) * 1.3, { vel: [-Math.cos(a) * 1.6, 2.2 + Math.random(), -Math.sin(a) * 1.6], life: 0.6, size: 0.05, color: [3.4, 2.8, 1.5], drag: 0.6 }); }
      this.vfx.wave(p.pos.x, p.pos.y + 0.08, p.pos.z, { r0: 3.2, r1: 0.5, life: 0.5, linear: true, rise: true, strength: 0.6, width: 0.06, color: [3.2, 2.6, 1.4] });
    }
    if (e.type === 'heal') {
      // The note goes through him: a column of warm light, a ring going out over the ground.
      this.vfx.wave(p.pos.x, p.pos.y + 0.08, p.pos.z, { r0: 0.4, r1: 5, life: 0.7, strength: 1.0, width: 0.08, color: [3.4, 2.8, 1.5] });
      this.vfx.wave(p.pos.x, p.pos.y + 1.0, p.pos.z, { kind: 1, r0: 0.3, r1: 2.6, life: 0.45, strength: 1.0, width: 0.12, color: [3.4, 2.8, 1.5] });
      for (let k = 0; k < 34; k++) { const a = Math.random() * 6.283, r = Math.random() * 0.6; this.particles.spawn(p.pos.x + Math.cos(a) * r, p.pos.y + Math.random() * 1.6, p.pos.z + Math.sin(a) * r, { vel: [Math.cos(a) * 0.5, 2.5 + Math.random() * 3.5, Math.sin(a) * 0.5], life: 0.9, size: 0.06, color: [3.6, 3.0, 1.7], drag: 0.8, streak: 0.06 }); }
      this.flash = Math.max(this.flash, 0.2);
    }
    if (e.type === 'pulse') {
      // Resonance pulse: a ring of force that staggers everything nearby.
      const surge = p.skills.has('surge'), PR = TUNE.pulseRadius * (surge ? 1.4 : 1);
      for (let k = 0; k < 56; k++) { const a = (k / 56) * 6.283; this.particles.spawn(p.pos.x, p.pos.y + 1, p.pos.z, { vel: [Math.cos(a) * 15, 0.4, Math.sin(a) * 15], life: 0.55, size: 0.2, color: [3, 2.2, 1.1], drag: 2.5 }); }
      this.particles.spawn(p.pos.x, p.pos.y + 1, p.pos.z, { life: 0.35, size: 3.4, color: [1.3, 1.0, 0.5], grow: 1.4, alpha: 0.5 });
      this.vfx.wave(p.pos.x, p.pos.y + 1.0, p.pos.z, { kind: 1, r0: 0.5, r1: PR * 0.9, life: 0.55, strength: 1.5, width: 0.1, color: [3.2, 2.3, 1.0] });
      this.vfx.wave(p.pos.x, p.pos.y + 0.08, p.pos.z, { r0: 0.5, r1: PR * 1.25, life: 0.75, strength: 1.2, width: 0.07, color: [3.2, 2.3, 1.0] });
      this.vfx.wave(p.pos.x, p.pos.y + 0.08, p.pos.z, { r0: 0.5, r1: PR * 0.9, life: 0.7, strength: 0.7, width: 0.09, color: [2.5, 1.8, 0.8], delay: 0.14 });
      this.flash = Math.max(this.flash, 0.35);
      for (const en of this.enemies.list) if (en.alive && en.state !== 'dormant' && en.pos.distanceTo(p.pos) < PR) { this.enemies.hit(en, Math.round((surge ? 30 : 12) * p.power), p.pos, true); }
      this.rig.addShake(0.4);
    }
    this.emit('player', e);
  }

  _onEnemyEvent(e) {
    if (e.type === 'hitPlayer') {
      const took = this.player.damage(Math.round(e.damage * ({ gentle: 0.75, hard: 1.9 }[this.cine ? 'gentle' : this.challenge] ?? 1.5)), e.from ?? e.enemy.pos);
      if (took && e.enemy?.alive && this.player.charms?.has('thorn')) { this.enemies.hit(e.enemy, Math.round(e.damage * 0.6 * this.player.power), this.player.pos, false); const c = e.enemy.center; this.particles.burst(c.x, c.y, c.z, 12, { speed: 6, life: 0.4, size: 0.05, color: [1.8, 3.0, 1.0], gravity: 8, drag: 1.4, streak: 0.1 }); }
    }
    if (e.type === 'slam') {
      const big = e.enemy?.def.boss ? 1 : 0.5;
      this.rig.addShake(0.7 * big + 0.1);
      const q = e.at ?? e.enemy?.pos ?? this.player.pos;
      this.vfx.wave(q.x, q.y + 0.1, q.z, { r0: 1, r1: 11 * big, life: 0.7, strength: 1.5, width: 0.08, color: [2.4, 1.15, 4.6] });
      this.particles.burst(q.x, q.y + 0.3, q.z, 40, { speed: 9 * (0.5 + 0.5 * big), life: 0.6, size: 0.07, color: [2.4, 1.15, 4.6], gravity: 8, drag: 1.5, streak: 0.1, up: 3 });
    }
    if (e.type === 'blastMark') {
      const b = e.blast;
      this.vfx.wave(b.x, b.y + 0.08, b.z, { r0: b.r, r1: b.r - 0.01, life: b.t, linear: true, rise: true, strength: 0.3, width: 0.05, color: [2.4, 1.15, 4.6] });
      this.vfx.wave(b.x, b.y + 0.08, b.z, { r0: b.r * 2.6, r1: b.r, life: b.t, linear: true, rise: true, strength: 0.5, width: 0.05, color: [2.4, 1.15, 4.6] });
    }
    if (e.type === 'blast') {
      const b = e.blast;
      this.vfx.wave(b.x, b.y + 0.1, b.z, { r0: 0.3, r1: b.r * 1.5, life: 0.45, strength: 1.3, width: 0.1, color: [2.4, 1.15, 4.6] });
      this.vfx.wave(b.x, b.y + 1.2, b.z, { kind: 1, r0: 0.3, r1: b.r, life: 0.35, strength: 1.2, width: 0.14, color: [2.0, 1.0, 3.8] });
      for (let k = 0; k < 30; k++) { const a = Math.random() * 6.283, r = Math.random() * b.r * 0.7; this.particles.spawn(b.x + Math.cos(a) * r, b.y + 0.2, b.z + Math.sin(a) * r, { vel: [Math.cos(a) * 2, 6 + Math.random() * 10, Math.sin(a) * 2], life: 0.7, size: 0.08, color: [3.2, 1.9, 5.6], drag: 1.0, streak: 0.1 }); }
      if (Math.hypot(this.player.pos.x - b.x, this.player.pos.z - b.z) < 14) this.rig.addShake(0.3);
    }
    if (e.type === 'burstBack') {
      this.vfx.wave(e.pos.x, e.pos.y, e.pos.z, { kind: 1, r0: 0.4, r1: 3.8, life: 0.4, strength: 1.4, width: 0.1, color: [3.6, 2.7, 1.2] });
      this.particles.burst(e.pos.x, e.pos.y, e.pos.z, 30, { speed: 9, life: 0.5, size: 0.06, color: [5, 3.8, 1.7], gravity: 8, drag: 1.3, streak: 0.14 });
      this.rig.addShake(0.4);
    }
    if (e.type === 'returned') {
      this._cadence(2);
      this.vfx.wave(e.pos.x, e.pos.y, e.pos.z, { kind: 1, r0: 0.2, r1: 2.4, life: 0.3, strength: 1.3, width: 0.12, color: [3.6, 2.7, 1.2] });
      this.particles.burst(e.pos.x, e.pos.y, e.pos.z, 16, { speed: 8, life: 0.35, size: 0.05, color: [5, 3.8, 1.7], gravity: 8, drag: 1.4, streak: 0.14 });
      this.hitStop = Math.max(this.hitStop, 0.07); this.rig.addShake(0.3);
    }
    if (e.type === 'rung') {
      const c = e.enemy.center;
      this.vfx.wave(c.x, c.y, c.z, { kind: 1, r0: 0.3, r1: 4.2, life: 0.4, strength: 1.5, width: 0.09, color: [3.6, 2.7, 1.2] });
      this.vfx.wave(e.enemy.pos.x, e.enemy.pos.y + 0.08, e.enemy.pos.z, { r0: 0.4, r1: 6, life: 0.55, strength: 1.1, width: 0.07, color: [3.6, 2.7, 1.2] });
      this.particles.burst(c.x, c.y, c.z, 30, { speed: 11, life: 0.5, size: 0.06, color: [5, 3.8, 1.7], gravity: 10, drag: 1.2, streak: 0.16 });
      this.hitStop = Math.max(this.hitStop, 0.15); this.rig.addShake(0.5); this.flash = Math.max(this.flash, 0.25);
    }
    if (e.type === 'blocked') {
      const c = e.enemy.center;
      this.particles.burst(c.x, c.y, c.z, 12, { speed: 8, life: 0.3, size: 0.05, color: [3, 2.6, 4], gravity: 12, drag: 1.5, streak: 0.14 });
    }
    if (e.type === 'wake' && e.enemy.affix && !this.cine) this.emit('hint', { title: e.enemy.def.name, text: { mark: 'Where it strikes, the ground remembers. Do not stand where you stood.', split: 'When it falls, what held it together comes for you.', shell: 'Nothing bites on it while any of its own still stand.', hymn: 'It keeps two of its own under ward at once. Break the singer first.' }[e.enemy.affix] });
    if (e.type === 'split') {
      const q = e.enemy;
      for (let k = 0; k < 3; k++) { const a = k * 2.094 + 0.5, s = this.enemies.spawn('seeker', q.pos.x + Math.cos(a) * 1.6, q.pos.z + Math.sin(a) * 1.6, q.group, null, q.pos.y); s.state = 'rise'; s.t = 0.5; }
      this.vfx.wave(q.pos.x, q.pos.y + 0.1, q.pos.z, { r0: 0.4, r1: 5, life: 0.6, strength: 1.1, width: 0.07, color: [2.4, 1.15, 4.6] });
    }
    if (e.type === 'wake' && (e.enemy.def.boss || e.enemy.elite)) { this.boss = e.enemy; this.emit('boss', { enemy: e.enemy }); this.regard = { e: e.enemy, t: e.enemy.def.boss ? 2.4 : 1.2 }; }
    if (e.type === 'phase') {
      // The giant falters, and gathers itself: everything near is thrown back by its voice.
      const q = e.enemy.pos, c = e.enemy.center;
      this.flash = Math.max(this.flash, 0.6); this.rig.addShake(0.8); this.hitStop = Math.max(this.hitStop, 0.12);
      for (const [dl, r] of [[0, 16], [0.25, 24]]) this.vfx.wave(q.x, q.y + 0.1, q.z, { r0: 1, r1: r, life: 1.1, strength: 1.4, width: 0.07, color: [2.4, 1.15, 4.6], delay: dl });
      this.vfx.wave(c.x, c.y, c.z, { kind: 1, r0: 1, r1: 12, life: 0.7, strength: 1.5, width: 0.1, color: [2.4, 1.15, 4.6] });
    }
    if (e.type === 'ward') {
      const a = e.ally.center, c = e.enemy.center;
      this.vfx.wave(a.x, e.ally.pos.y + 0.08, a.z, { r0: 2.6, r1: 0.6, life: 0.5, strength: 1.0, width: 0.07, color: [2.4, 1.15, 4.6] });
      this.vfx.wave(c.x, c.y, c.z, { kind: 1, r0: 0.3, r1: 1.8, life: 0.4, strength: 0.9, width: 0.1, color: [2.4, 1.15, 4.6] });
      if (!this._wardHint && !this.cine) { this._wardHint = true; this.emit('hint', { title: 'Warded', text: 'A chorister has thrown its ward over one of the Mute. Break the singer and the ward goes with it.' }); }
    }
    if (e.type === 'warded') {
      const c = e.enemy.center;
      this.vfx.wave(c.x, c.y, c.z, { kind: 1, r0: 0.9, r1: 1.5, life: 0.2, strength: 0.9, width: 0.05, color: [2.6, 1.3, 5.2] });
    }
    if (e.type === 'wardBreak') {
      const c = e.enemy.center;
      this.particles.burst(c.x, c.y, c.z, 18, { speed: 5, life: 0.5, size: 0.06, color: [2.6, 1.3, 5.2], gravity: 4, drag: 1.5 });
    }
    if (e.type === 'rushMark') {
      // A line on the ground where it means to go: time enough to step off it.
      const q = e.enemy, f = [Math.sin(q.yaw), Math.cos(q.yaw)];
      for (let k = 1; k <= 6; k++) this.vfx.wave(q.pos.x + f[0] * k * 2.2, q.pos.y + 0.08, q.pos.z + f[1] * k * 2.2, { r0: 0.9, r1: 0.25, life: 0.75, delay: k * 0.05, strength: 0.6, width: 0.06, color: [2.4, 1.15, 4.6] });
    }
    if (e.type === 'summon') {
      const q = e.enemy.pos, n = 1 + e.phase;
      for (let i = 0; i < n; i++) {
        const a = e.enemy.yaw + Math.PI + (i - (n - 1) / 2) * 0.9, x = q.x + Math.sin(a) * 6, z = q.z + Math.cos(a) * 6;
        const add = this.enemies.spawn(e.enemy.kind === 'sovereign' && i === 0 ? 'thrall' : 'hound', x, z, e.enemy.group, e.enemy.kind === 'sovereign' ? { scale: 1.12, hp: 1.4, dmg: 1.15, tint: 0.6 } : null, q.y);
        add.state = 'rise'; add.t = 0;
        this.vfx.wave(add.pos.x, add.pos.y + 0.08, add.pos.z, { r0: 3, r1: 0.4, life: 0.8, strength: 0.9, width: 0.08, color: [2.4, 1.15, 4.6] });
      }
      this.rig.addShake(0.5);
    }
    if (e.type === 'death') {
      // The construct comes apart: a bubble of force, a ring over the ground, and its light
      // rising out of it as slow embers.
      const en = e.enemy, c = en.center ?? en.pos, big = en.def.boss ? 2.6 : 1;
      this.vfx.wave(c.x, c.y, c.z, { kind: 1, r0: 0.4, r1: 4.5 * big, life: 0.5 * big, strength: 1.4, width: 0.12, color: [2.4, 1.15, 4.6] });
      this.vfx.wave(en.pos.x, en.pos.y + 0.08, en.pos.z, { r0: 0.5, r1: 7 * big, life: 0.8 * big, strength: 1.0, width: 0.08, color: [2.4, 1.15, 4.6] });
      this.particles.burst(c.x, c.y, c.z, en.def.boss ? 140 : 46, { speed: 2.6 * big, life: 2.2, size: 0.06, color: [3.2, 1.9, 5.6], gravity: -1.6, drag: 0.9, up: 1.2 });
      this.flash = Math.max(this.flash, en.def.boss ? 0.9 : 0.25);
      if (en.def.boss) {
        // The colossus goes out like a struck bell: echo after echo, and a column of its light.
        for (const [dl, r] of [[0.3, 26], [0.65, 34], [1.05, 42]]) this.vfx.wave(en.pos.x, en.pos.y + 0.1, en.pos.z, { r0: 1, r1: r, life: 1.6, strength: 1.3, width: 0.06, color: [2.4, 1.15, 4.6], delay: dl });
        for (let k = 0; k < 160; k++) { const a = Math.random() * 6.283, r = Math.random() * 2.5; this.particles.spawn(c.x + Math.cos(a) * r, c.y + Math.random() * 3, c.z + Math.sin(a) * r, { vel: [Math.cos(a) * 1.5, 9 + Math.random() * 16, Math.sin(a) * 1.5], life: 2.4, size: 0.12, color: [3.5, 2.1, 6.3], drag: 0.7, streak: 0.08 }); }
      }
      if (e.enemy === this.boss) { this.boss = null; this.emit('boss', { enemy: null }); }
      if (e.enemy === this.player.lockTarget) { this.player.lockTarget = null; this.emit('lock', { target: null }); }
      // What it held of the song comes back to him.
      if (!this.cine) {
        const nm = Math.max(3, Math.min(16, Math.round((en.def.xp ?? 10) / 5)));
        for (let k = 0; k < nm; k++) { const a = Math.random() * 6.283, up = 2 + Math.random() * 5, sp = 2 + Math.random() * 4; (this.motes ??= []).push({ x: c.x, y: c.y + Math.random() * 0.6, z: c.z, vx: Math.cos(a) * sp, vy: up, vz: Math.sin(a) * sp, t: -Math.random() * 0.25, first: k === 0 }); }
        if (en.elite && en.def.name && !(this.elitesDown ??= []).includes(en.def.name)) this.elitesDown.push(en.def.name);
        const gain = Math.round((en.def.xp ?? 10) * (this.player.charms?.has('gilt') ? 1.17 : 1));
        this.xp += gain; this.emit('xp', { amount: gain, total: this.xp });
        (this.slain ??= {})[en.kind] = (this.slain[en.kind] ?? 0) + 1;
        const m = /^wild(\d+)$/.exec(en.group ?? '');
        if (m && this.enemies.aliveIn(en.group) === 0) { this.wildDone.push(+m[1]); this.emit('pack', { index: +m[1] }); }
        this.save();
      }
      this._refreshObjective();
    }
    this.emit('enemy', e);
  }

  _spireLogic(dt) {
    const p = this.player;
    this.prompt = null;
    for (const s of this.spires) {
      if (s.tuned) continue;
      const ready = this.encounters.cleared(s.id);
      s.power += ((ready ? 0.22 : 0) - s.power) * Math.min(1, 2 * dt);
      const near = Math.hypot(p.pos.x - s.x, p.pos.z - s.z) < 6.5 && Math.abs(p.pos.y - s.base) < 4;
      if (ready && near && p.state === 'move') {
        if (!this.cine) {
          // Played: a press begins the tuning proper (see tuning.js).
          if (!this.tuning.active) { this.prompt = { key: 'E', text: 'Tune the spire' }; if (this.input.pressed.has('interact')) { this.prompt = null; this.tuning.begin(s); } }
          continue;
        }
        this.prompt = { key: 'E', text: 'Hold to tune the spire', progress: s.tuning / 1.5 };
        if (this.input.held.has('interact')) {
          s.tuning += dt;
          // Rings of light close in on the spire while he holds the note.
          this._gather = (this._gather ?? 0) - dt;
          if (this._gather <= 0) { this._gather = 0.22; this.vfx.wave(s.x, s.base + 0.2, s.z, { r0: 10, r1: 2.2, life: 0.7, strength: 0.6, width: 0.07, color: [3.2, 2.4, 1.1] }); }
          if (Math.random() < dt * 30) this.particles.spawn(s.x + (Math.random() - 0.5) * 5, s.base + Math.random() * 3, s.z + (Math.random() - 0.5) * 5, { vel: [(s.x - p.pos.x) * 0.2, 5 + Math.random() * 4, (s.z - p.pos.z) * 0.2], life: 1.1, size: 0.1, color: [4, 3, 1.4], drag: 0.6 });
          if (s.tuning >= 1.5) this._tune(s);
        } else s.tuning = Math.max(0, s.tuning - dt * 2);
      } else if (!(this.tuning.active && this.tuning.s === s)) s.tuning = Math.max(0, s.tuning - dt * 2);
    }
    if (!this.prompt && this.ended && this.state === 'playing') this.prompt = null;
  }

  _tune(s) {
    s.tuned = true; s.tuning = 0; s.releasing = 0.001;
    const p = this.player;
    this._skills();
    p.health = p.healthMax; p.stamina = p.staminaMax; p.windUsed = false; p.refrainMax = Math.max(p.refrainMax, TUNE.refrain.charges); this.rest();
    if (SKILLS[s.id] && !this.cine) this.emit('skill', { ...SKILLS[s.id] });
    this.checkpoint = { x: p.pos.x, y: p.pos.y + 0.1, z: p.pos.z, yaw: p.yaw };
    for (let k = 0; k < 120; k++) { const a = Math.random() * 6.283, r = Math.random() * 3; this.particles.spawn(s.x + Math.cos(a) * r, s.base + 1 + Math.random() * 18, s.z + Math.sin(a) * r, { vel: [Math.cos(a) * 3, 6 + Math.random() * 10, Math.sin(a) * 3], life: 1.8, size: 0.14, color: [3.2, 2.3, 1.0], drag: 0.8 }); }
    this.rig.addShake(0.6);
    const gy = s.base + 0.2;
    this.vfx.wave(s.x, gy, s.z, { r0: 1, r1: 80, life: 2.6, strength: 1.8, width: 0.045, color: [3.2, 2.3, 1.0] });
    this.vfx.wave(s.x, gy, s.z, { r0: 1, r1: 60, life: 2.6, strength: 1.2, width: 0.06, color: [3.5, 2.6, 1.2], delay: 0.35 });
    this.vfx.wave(s.x, gy, s.z, { r0: 1, r1: 44, life: 2.6, strength: 0.9, width: 0.08, color: [2.6, 2.0, 1.0], delay: 0.75 });
    this.vfx.wave(s.x, s.base + (s.h ?? 24) * 0.5, s.z, { kind: 1, r0: 1, r1: 30, life: 1.3, strength: 1.6, width: 0.07, color: [3.2, 2.3, 1.0] });
    for (let k = 0; k < 90; k++) { const a = (k / 90) * 6.283; this.particles.spawn(s.x + Math.cos(a) * 3, s.base + 0.5, s.z + Math.sin(a) * 3, { vel: [Math.cos(a) * (16 + Math.random() * 8), 1.5 + Math.random() * 3, Math.sin(a) * (16 + Math.random() * 8)], life: 1.1, size: 0.09, color: [4.5, 3.2, 1.4], drag: 1.6, gravity: 2, streak: 0.12 }); }
    s.helix?.start();
    this.flash = 1; this.ringPulse = 1.6;
    if (s.id === 'cantor') this.bridgeOpen = true;
    if (!this.spires.some((x) => !x.tuned)) { this.ended = true; this.emit('ending'); }
    this.save();
    this._refreshObjective();
    this.emit('tuned', { spire: s });
  }

  // Slow world animation that runs in every state: crystals, beams, colour returning, the bridge.
  _animateWorld(dt) {
    const t = this.pipe.time;
    // The great rings glow a little more for every spire restored, and blaze when one is tuned.
    const lat = this.arch?.material?.uniforms?.uLattice?.value;
    if (lat) { this.ringPulse = (this.ringPulse ?? 0) * Math.exp(-dt * 0.45); const lit = this.spires.filter((s) => s.tuned).length / this.spires.length; lat.w += (0.28 * lit + this.ringPulse - lat.w) * Math.min(1, dt * 1.5); }
    if (this.props) for (const m of this.props) m.visible = !this.cine;
    // The island of colour the hero carries through a silence.
    { const p = this.player.pos; this.pipe.fog.hero.set(p.x, p.y + 1.0, p.z, this.state === 'home' ? 0 : 3.2); }
    // In the film the outer courts show their light only at the end, when the inner Vale sings.
    this.cineAll = !!this.cine && this.spires[0].tuned && this.spires[1].tuned && this.spires[2].tuned;
    if (!this.cine && this.state !== 'home') {
      const p = this.player.pos;
      for (const s of this.spires) {
        if (!s.tuned) continue;
        const d = Math.hypot(s.x - p.x, s.z - p.z);
        if (d > 75 || Math.random() > dt * 7) continue;
        const a = Math.random() * 6.283, r = 3 + Math.random() * 15, x = s.x + Math.cos(a) * r, z = s.z + Math.sin(a) * r;
        this.particles.spawn(x, (s.base ?? p.y) + 0.3 + Math.random() * 2.5, z, { vel: [(Math.random() - 0.5) * 0.3, 0.25 + Math.random() * 0.35, (Math.random() - 0.5) * 0.3], life: 3.5 + Math.random() * 2.5, size: 0.035 + Math.random() * 0.03, color: [3.4, 2.6, 1.2], alpha: 0.75, drag: 0.2 });
      }
    }
    this.flash *= Math.exp(-dt * 3.2);
    this.pipe.exposure = this.baseExposure * (1 + 0.16 * this.flash);
    for (const s of this.spires) {
      // Strands of light around each spire: climbing when it is tuned, steady afterwards.
      s.helix ??= this.vfx.helix({ x: s.x, base: s.base, z: s.z, h: s.h ?? 24 });
      if (s.tuned && s.helix.rise === 0) s.helix.set(true);
      if (!s.tuned && s.helix.rise > 0) s.helix.set(false);
      if (s.tuned) {
        s.power += (1 - s.power) * Math.min(1, 1.5 * dt);
        // The silence retreats: its radius collapses toward the spire.
        if (s.zoneR > 0) { s.zoneR = Math.max(0, s.zoneR - dt * 26); s.zone.z = s.zoneR; s.zone.w = Math.min(1, s.zoneR / 12); }
      }
      s.crystal.material.uniforms.uPower.value = s.power;
      s.strings.material.uniforms.uPower.value = s.power;
      s.strings.material.uniforms.uTune.value = s.tuning / 1.5;
      s.beam.material.uniforms.uPower.value = Math.max(0, (s.power - 0.3) / 0.7) * (s.tuned ? 1 : 0);
      s.beam.visible = s.tuned && !(this.cine && s.index > 2 && !this.cineAll);
      s.crystal.rotation.y = t * (0.25 + s.power * 0.8) + s.index;
      s.crystal.position.y = s.y + Math.sin(t * 1.3 + s.index) * 0.18 * (0.3 + s.power);
      s.crystal.updateMatrixWorld();
    }
    if (this.bridgeOpen) {
      this.bridge.visible = true;
      this.bridgeProgress = Math.min(1, this.bridgeProgress + dt / 4.5);
      if (this.bridgeProgress < 1) {
        // Sparks pour off the leading edge as the span weaves itself across the gap.
        const { from, to } = this.sites.bridge, k = this.bridgeProgress;
        const bx = from[0] + (to[0] - from[0]) * k, by = from[1] + (to[1] - from[1]) * k, bz = from[2] + (to[2] - from[2]) * k;
        const n = Math.min(6, Math.floor(dt * 150 + Math.random()));
        for (let i = 0; i < n; i++) this.particles.spawn(bx + (Math.random() - 0.5) * 6, by + 0.2, bz + (Math.random() - 0.5) * 2, { vel: [(Math.random() - 0.5) * 5, 2 + Math.random() * 5, (Math.random() - 0.5) * 5], life: 0.9, size: 0.07, color: [4.5, 3.3, 1.5], gravity: 6, drag: 0.8, streak: 0.1 });
      }
      this.bridgeMat.uniforms.uProgress.value = this.bridgeProgress;
      // Solid from the first moment, so nobody can step onto the visible part and fall through.
      if (!this.bridgeSolid) { this.world.addGeometry(this.bridgeSlab); this.bridgeSolid = true; }
    }
  }
}
