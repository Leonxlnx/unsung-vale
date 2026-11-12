// Game: the rules. Owns the player, camera, enemies, spires and progress, and reports what
// happens through a small event bus that the UI and audio listen to.
import * as THREE from 'three';
import { Input } from './input.js';
import { CollisionWorld } from './collision.js';
import { Player, TUNE } from './player.js';
import { CameraRig } from './camera.js';
import { Particles } from './particles.js';
import { Enemies } from './enemies.js';
import { MeshBuilder, M } from '../world/arch/builder.js';

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
  float core = exp(-x * x * 70.0) * 9.0 + exp(-x * x * 6.0) * 1.6;
  float rise = 0.75 + 0.25 * sin(vUv.y * 60.0 - uTime * 6.0);
  float fade = (1.0 - smoothstep(0.55, 1.0, vUv.y)) * smoothstep(0.0, 0.01, vUv.y);
  float a = core * rise * fade * uPower;
  gl_FragColor = vec4(uColor * a, a);
}`;
const BRIDGE_VERT = /* glsl */ `
out vec2 vUv; out vec3 vWorld;
void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const BRIDGE_FRAG = /* glsl */ `
uniform float uProgress; uniform float uTime; uniform sampler2D uNoise;
in vec2 vUv; in vec3 vWorld;
float sq(float x) { return x * x; }
void main() {
  if (vUv.y > uProgress) discard;
  float edge = abs(vUv.x - 0.5) * 2.0;
  float rail = smoothstep(0.82, 0.98, edge);
  float n = texture(uNoise, vec2(vUv.x * 0.6, vUv.y * 9.0 - uTime * 0.05)).r;
  float lattice = smoothstep(0.42, 0.5, abs(fract(vUv.y * 46.0 + vUv.x * 2.0) - 0.5)) * 0.35 + smoothstep(0.44, 0.5, abs(fract(vUv.x * 5.0) - 0.5)) * 0.3;
  float front = exp(-sq((uProgress - vUv.y) * 60.0)) * 3.0;
  float a = 0.3 + rail * 0.9 + lattice * 0.5 + n * 0.2 + front;
  gl_FragColor = vec4(vec3(1.0, 0.82, 0.48) * a * 1.4, 0.55 + rail * 0.3);
}`;

export class Game {
  constructor({ pipe, terrain, arch, sites, canvas }) {
    this.pipe = pipe; this.terrain = terrain; this.sites = sites; this.arch = arch;
    this.world = new CollisionWorld(terrain);
    for (const g of sites.solids) this.world.addGeometry(g);
    this.input = new Input(canvas);
    this.player = new Player(this.world);
    this.rig = new CameraRig(pipe.camera, this.world);
    this.particles = new Particles(pipe);
    pipe.sceneT.add(this.particles.mesh);
    this.enemies = new Enemies(pipe, this.world, this.particles);
    pipe.scene.add(this.enemies.mesh);
    this.state = 'home';          // home | playing | paused | ending | free
    this.time = 0; this.hitStop = 0; this.listeners = [];
    this.prompt = null; this.objective = ''; this.boss = null;
    this.tuneHold = 0;

    // Stand-in body until the hero model is attached (see attachHero).
    const b = new MeshBuilder();
    b.mat_(M.MARBLE).lathe([[0.0, 0], [0.3, 0.02], [0.34, 0.5], [0.3, 1.0], [0.36, 1.35], [0.2, 1.55], [0.17, 1.7], [0.1, 1.82], [0, 1.83]], 12);
    this.standIn = new THREE.Mesh(b.build(), arch.material);
    this.standIn.frustumCulled = false;
    pipe.scene.add(this.standIn);
    pipe.shadows.addCaster(this.standIn, arch.depthMaterial, { dynamic: true });

    this._buildSpires();
    this._buildBridge();
    this.load();
    this._spawnEncounters();
    this.respawnAtCheckpoint();
    this._refreshObjective();
  }

  // Swaps the stand-in body for the real animated hero.
  attachHero(hero) { this.hero = hero; this.standIn.visible = false; hero.update(0.016, this.player, this); }

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
      const zone = this.pipe.fog.mute[i];
      zone.set(s.x, s.z, i === 2 ? 60 : 78, 1);
      return { ...s, index: i, crystal, beam, zone, tuned: false, power: 0, zoneR: zone.z, zoneR0: zone.z, tuning: 0 };
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
      vertexShader: BRIDGE_VERT, fragmentShader: BRIDGE_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uProgress: { value: 0 }, uTime: this.pipe.globals.uTime, uNoise: this.terrain.surfaceUniforms.uNoise },
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

  _spawnEncounters() {
    const E = this.enemies, tuned = (id) => this.spires.find((s) => s.id === id)?.tuned;
    const ring = (kind, cx, cz, r, n, group, a0 = 0) => { for (let i = 0; i < n; i++) { const a = a0 + (i / n) * 6.283; E.spawn(kind, cx + Math.cos(a) * r, cz + Math.sin(a) * r, group); } };
    if (!tuned('petal')) ring('thrall', -372, -392, 8.5, 3, 'petal', 0.4);
    if (!tuned('cantor')) {
      E.spawn('thrall', -100, -455, 'stair'); E.spawn('thrall', -96, -465, 'stair'); E.spawn('lancer', -84, -459, 'stair');
      ring('thrall', 66, -498, 10, 3, 'cantor', 1.2); E.spawn('lancer', 92, -520, 'cantor'); E.spawn('lancer', 40, -476, 'cantor');
    }
    if (!tuned('choir')) { E.spawn('colossus', 156, -4, 'choir'); E.spawn('lancer', 130, -32, 'choir'); E.spawn('lancer', 167, 6, 'choir'); }
  }

  // --- progress ------------------------------------------------------------------------

  save() {
    if (this.cine) return;        // the film must never overwrite a player's progress
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ tuned: this.spires.filter((s) => s.tuned).map((s) => s.id), checkpoint: this.checkpoint, ended: this.ended })); } catch { /* storage may be unavailable */ }
  }
  load() {
    this.checkpoint = { ...this.sites.spawn };
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null');
      if (!d) return;
      for (const s of this.spires) if (d.tuned?.includes(s.id)) { s.tuned = true; s.power = 1; s.zoneR = 0; s.zone.w = 0; s.crystal.material.uniforms.uPower.value = 1; s.beam.material.uniforms.uPower.value = 1; }
      if (d.checkpoint) this.checkpoint = d.checkpoint;
      this.ended = !!d.ended;
      if (this.spires[1].tuned) { this.bridgeOpen = true; this.bridgeProgress = 1; }
    } catch { /* ignore a corrupt save */ }
  }
  get hasSave() { return this.spires.some((s) => s.tuned); }
  resetProgress() { try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ } location.reload(); }

  respawnAtCheckpoint() {
    const s = this.checkpoint;
    this.player.spawn(s.x, s.y, s.z, s.yaw ?? 0);
    this.rig.snap(this.player);
    this.rig.yaw = s.yaw ?? 0;
  }

  _refreshObjective() {
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
    for (const s of this.spires) {
      const on = tuned.includes(s.id);
      s.tuned = on; s.tuning = 0; s.power = on ? 1 : 0;
      s.zoneR = on ? 0 : s.zoneR0; s.zone.z = s.zoneR; s.zone.w = on ? 0 : 1;
    }
    // bridge: null follows the story state; a number starts the bridge forming from there.
    this.bridgeOpen = bridge !== null ? true : tuned.includes('cantor');
    this.bridgeProgress = bridge ?? (this.bridgeOpen ? 1 : 0);
    this.bridge.visible = this.bridgeOpen;
    this.bridgeMat.uniforms.uProgress.value = this.bridgeProgress;
    this.enemies.list.length = 0; this.enemies.projectiles.length = 0;
    this._spawnEncounters();
    this.boss = null; this.hitStop = 0;
    const p = this.player;
    if (player) { p.spawn(player[0], player[1], player[2], player[3] ?? 0); this.rig.yaw = player[3] ?? 0; }
    p.lockTarget = null; p.events.length = 0;
  }

  // --- flow ----------------------------------------------------------------------------

  start() { this.state = 'playing'; this.input.enabled = true; this.input.lockPointer(); this.emit('state', { state: 'playing' }); }
  pause() { if (this.state !== 'playing') return; this.state = 'paused'; this.input.enabled = false; this.input.unlockPointer(); this.emit('state', { state: 'paused' }); }
  resume() { if (this.state !== 'paused') return; this.start(); }
  toHome() { this.state = 'home'; this.input.enabled = false; this.input.unlockPointer(); this.emit('state', { state: 'home' }); }

  update(realDt) {
    this.input.update();
    if (!this.cine && this.input.pressed.has('pause')) { if (this.state === 'playing') this.pause(); else if (this.state === 'paused') this.resume(); }
    if (this.state !== 'playing' && this.state !== 'ending') {
      // The world keeps breathing behind the menus.
      this.particles.update(realDt);
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

    p.update(dt, this.input, this.rig.yaw);
    this._lockOn();
    this._combat();
    this.enemies.update(dt, p, this.time);
    for (const e of this.enemies.events) this._onEnemyEvent(e);
    this.enemies.events.length = 0;
    for (const e of p.events) this._onPlayerEvent(e);
    p.events.length = 0;
    this._spireLogic(dt);
    this._animateWorld(dt);
    this.particles.update(dt);
    // In a cinematic the director owns the camera; the rig only tracks yaw for movement.
    if (!this.cine) this.rig.update(realDt, p, this.input);

    if (this.hero) this.hero.update(dt, p, this);
    else { this.standIn.position.copy(p.pos); this.standIn.rotation.y = p.yaw; this.standIn.updateMatrixWorld(); }

    if (p.state === 'dead' && p.stateTime > 2.6) {
      this.respawnAtCheckpoint();
      this.emit('respawn');
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
    if (!p.attackActive) return;
    const a = p.attack, f = p.facing.clone();
    for (const e of this.enemies.list) {
      if (!e.alive || e.state === 'dormant' || p.hitDone.has(e)) continue;
      const d = e.pos.clone().sub(p.pos); const dy = d.y; d.y = 0;
      const dist = d.length() - e.def.radius;
      if (dist > a.reach || Math.abs(dy) > 2.5 + e.def.core) continue;
      if (dist > 0.6 && d.normalize().dot(f) < Math.cos(a.arc / 2 + 0.25)) continue;
      p.hitDone.add(e);
      const heavy = p.comboStep >= 2;
      if (this.enemies.hit(e, a.dmg, p.pos, heavy)) {
        this.hitStop = heavy ? 0.11 : 0.06;
        this.rig.addShake(heavy ? 0.5 : 0.28);
        this.emit('hit', { heavy, enemy: e });
      }
    }
  }

  _onPlayerEvent(e) {
    const p = this.player;
    if (e.type === 'land' && e.fell > 3) this.rig.addShake(Math.min(0.5, e.fell * 0.03));
    if (e.type === 'land') this.hero?.onLand(e.fell ?? 0);
    if (e.type === 'hurt') { this.rig.addShake(0.55); this.hero?.onHit(); }
    if (e.type === 'pulse') {
      // Resonance pulse: a ring of force that staggers everything nearby.
      for (let k = 0; k < 56; k++) { const a = (k / 56) * 6.283; this.particles.spawn(p.pos.x, p.pos.y + 1, p.pos.z, { vel: [Math.cos(a) * 15, 0.4, Math.sin(a) * 15], life: 0.55, size: 0.28, color: [4, 2.9, 1.4], drag: 2.5 }); }
      this.particles.spawn(p.pos.x, p.pos.y + 1, p.pos.z, { life: 0.4, size: 5, color: [2.4, 1.8, 0.9], grow: 1.6, alpha: 0.6 });
      for (const en of this.enemies.list) if (en.alive && en.state !== 'dormant' && en.pos.distanceTo(p.pos) < TUNE.pulseRadius) { this.enemies.hit(en, 12, p.pos, true); }
      this.rig.addShake(0.4);
    }
    this.emit('player', e);
  }

  _onEnemyEvent(e) {
    if (e.type === 'hitPlayer') { this.player.damage(e.damage, e.from ?? e.enemy.pos); }
    if (e.type === 'slam') this.rig.addShake(0.7);
    if (e.type === 'wake' && e.enemy.def.boss) { this.boss = e.enemy; this.emit('boss', { enemy: e.enemy }); }
    if (e.type === 'death') {
      if (e.enemy === this.boss) { this.boss = null; this.emit('boss', { enemy: null }); }
      if (e.enemy === this.player.lockTarget) { this.player.lockTarget = null; this.emit('lock', { target: null }); }
      this._refreshObjective();
    }
    this.emit('enemy', e);
  }

  _spireLogic(dt) {
    const p = this.player;
    this.prompt = null;
    for (const s of this.spires) {
      if (s.tuned) continue;
      const ready = this.enemies.aliveIn(s.id) === 0;
      s.power += ((ready ? 0.22 : 0) - s.power) * Math.min(1, 2 * dt);
      const near = Math.hypot(p.pos.x - s.x, p.pos.z - s.z) < 6.5 && Math.abs(p.pos.y - s.base) < 4;
      if (ready && near && p.state === 'move') {
        this.prompt = { key: 'E', text: 'Hold to tune the spire', progress: s.tuning / 1.5 };
        if (this.input.held.has('interact')) {
          s.tuning += dt;
          if (Math.random() < dt * 30) this.particles.spawn(s.x + (Math.random() - 0.5) * 5, s.base + Math.random() * 3, s.z + (Math.random() - 0.5) * 5, { vel: [(s.x - p.pos.x) * 0.2, 5 + Math.random() * 4, (s.z - p.pos.z) * 0.2], life: 1.1, size: 0.1, color: [4, 3, 1.4], drag: 0.6 });
          if (s.tuning >= 1.5) this._tune(s);
        } else s.tuning = Math.max(0, s.tuning - dt * 2);
      } else s.tuning = Math.max(0, s.tuning - dt * 2);
    }
    if (!this.prompt && this.ended && this.state === 'playing') this.prompt = null;
  }

  _tune(s) {
    s.tuned = true; s.tuning = 0; s.releasing = 0.001;
    const p = this.player;
    p.health = TUNE.healthMax; p.stamina = TUNE.staminaMax;
    this.checkpoint = { x: p.pos.x, y: p.pos.y + 0.1, z: p.pos.z, yaw: p.yaw };
    for (let k = 0; k < 120; k++) { const a = Math.random() * 6.283, r = Math.random() * 3; this.particles.spawn(s.x + Math.cos(a) * r, s.base + 1 + Math.random() * 18, s.z + Math.sin(a) * r, { vel: [Math.cos(a) * 3, 6 + Math.random() * 10, Math.sin(a) * 3], life: 1.8, size: 0.14, color: [5, 3.6, 1.6], drag: 0.8 }); }
    this.rig.addShake(0.6);
    if (s.id === 'cantor') this.bridgeOpen = true;
    if (!this.spires.some((x) => !x.tuned)) { this.ended = true; this.emit('ending'); }
    this.save();
    this._refreshObjective();
    this.emit('tuned', { spire: s });
  }

  // Slow world animation that runs in every state: crystals, beams, colour returning, the bridge.
  _animateWorld(dt) {
    const t = this.pipe.time;
    for (const s of this.spires) {
      if (s.tuned) {
        s.power += (1 - s.power) * Math.min(1, 1.5 * dt);
        // The silence retreats: its radius collapses toward the spire.
        if (s.zoneR > 0) { s.zoneR = Math.max(0, s.zoneR - dt * 26); s.zone.z = s.zoneR; s.zone.w = Math.min(1, s.zoneR / 12); }
      }
      s.crystal.material.uniforms.uPower.value = s.power;
      s.beam.material.uniforms.uPower.value = Math.max(0, (s.power - 0.3) / 0.7) * (s.tuned ? 1 : 0);
      s.beam.visible = s.tuned;
      s.crystal.rotation.y = t * (0.25 + s.power * 0.8) + s.index;
      s.crystal.position.y = s.y + Math.sin(t * 1.3 + s.index) * 0.18 * (0.3 + s.power);
      s.crystal.updateMatrixWorld();
    }
    if (this.bridgeOpen) {
      this.bridge.visible = true;
      this.bridgeProgress = Math.min(1, this.bridgeProgress + dt / 4.5);
      this.bridgeMat.uniforms.uProgress.value = this.bridgeProgress;
      if (this.bridgeProgress >= 1 && !this.bridgeSolid) { this.world.addGeometry(this.bridgeSlab); this.bridgeSolid = true; }
    }
  }
}
