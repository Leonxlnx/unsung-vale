// The hero's visual: loads the generated model, gives it the game's materials, and animates
// it procedurally from the player's state (locomotion cycle, jumps, rolls, sword strikes),
// with spring physics for the cape and a ribbon trail behind the blade.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { COMMON, SKYMAP } from '../engine/glsl.js';
import { SKY_SAMPLE, SH_GLSL } from '../engine/sky.js';
import { LIGHTING } from '../engine/lighting.js';
import { TERRAIN_SAMPLING } from '../world/terrain.js';
import { Rig, SpringChains } from './rig.js';
import { TUNE } from '../game/player.js';

const TAU = Math.PI * 2;
const ease = (t) => t * t * (3 - 2 * t);
const clamp01 = (x) => Math.max(0, Math.min(1, x));

const HERO_VERT = /* glsl */ `
#include <skinning_pars_vertex>
out vec3 vWorld; out vec3 vNormal; out vec3 vRest;
void main() {
  #include <skinbase_vertex>
  vec3 objectNormal = normal;
  #include <skinnormal_vertex>
  vec3 transformed = position;
  #include <skinning_vertex>
  vec4 w = modelMatrix * vec4(transformed, 1.0);
  vWorld = w.xyz; vNormal = normalize(mat3(modelMatrix) * objectNormal); vRest = position;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const HERO_DEPTH_VERT = /* glsl */ `
#include <skinning_pars_vertex>
void main() {
  #include <skinbase_vertex>
  vec3 transformed = position;
  #include <skinning_vertex>
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(transformed, 1.0);
}`;
const HERO_FRAG = /* glsl */ `
${COMMON}
${SKYMAP}
${SKY_SAMPLE}
${SH_GLSL}
${TERRAIN_SAMPLING}
${LIGHTING}
uniform vec3 uAlbedo; uniform vec4 uSurf;   // rough, metal, sheen, emissive
uniform float uTime; uniform float uFlash;
in vec3 vWorld; in vec3 vNormal; in vec3 vRest;
void main() {
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vWorld);
  // Fine variation in rest space so it stays put as the body moves.
  float n = fbm3(vRest * 38.0, 3), n2 = vnoise3(vRest * 9.0);
  // Cloth is evenly dyed; metal and leather carry more wear.
  float grain = uSurf.z > 0.3 ? 0.05 : 0.12;
  vec3 alb = uAlbedo * (0.86 + 0.24 * n2) * (1.0 - grain + 2.0 * grain * n);
  float rough = clamp(uSurf.x + (n - 0.5) * 0.16, 0.06, 1.0);
  float vis = sunVisibility(vWorld + N * 0.03 + uSunDir * 0.06);
  vec3 col = shadeSurface(alb, rough, uSurf.y, N, V, vis, 0.9, 0.0);
  col += alb * (1.0 - 0.7 * uSurf.y) * lampLight(vWorld, N);
  float fres = pow(1.0 - saturate(dot(N, V)), 3.0);
  // Cloth catches the sky along its edges.
  col += alb * shIrradiance(N) * fres * uSurf.z * 2.0;
  // Thin cloth lets the low sun through: the cape glows when he stands against the light.
  col += alb * uSunColor * (0.3183 * 0.6 * saturate(dot(-N, uSunDir)) * vis * step(0.3, uSurf.z));
  // The blade carries its own light.
  col += uAlbedo * uSurf.w * (0.5 + 1.6 * fres + 0.15 * sin(uTime * 3.0 + vRest.y * 14.0));
  col += vec3(1.0, 0.9, 0.8) * uFlash;
  gl_FragColor = vec4(col, 1.0);
}`;

const TRAIL_FRAG = /* glsl */ `
in vec2 vUv;
void main() {
  // An arc of light behind the blade: a soft band along the outer half and a bright line
  // where the tip passed, hottest at the leading edge and cooling to gold along the tail.
  float lead = pow(vUv.x, 2.2);
  float band = smoothstep(0.25, 0.8, vUv.y) * (1.0 - smoothstep(0.94, 1.0, vUv.y));
  float tip = smoothstep(0.8, 0.93, vUv.y) * (1.0 - smoothstep(0.95, 1.0, vUv.y));
  float a = lead * (band * 0.16 + tip * 1.9);
  gl_FragColor = vec4(mix(vec3(1.0, 0.7, 0.34), vec3(1.0, 0.95, 0.82), lead) * a * 4.5, 1.0);
}`;

// name -> [albedo rgb, rough, metal, sheen, emissive]
const LOOKS = {
  armor: [[0.74, 0.73, 0.7], 0.34, 0.9, 0, 0], gold: [[1.0, 0.76, 0.36], 0.3, 1, 0, 0], cloth: [[0.03, 0.085, 0.105], 0.86, 0, 0.5, 0],
  cape: [[0.3, 0.028, 0.04], 0.82, 0, 0.55, 0], leather: [[0.075, 0.048, 0.032], 0.58, 0, 0.1, 0], mask: [[0.88, 0.86, 0.82], 0.24, 0, 0, 0],
  blade: [[0.55, 0.9, 1.0], 0.12, 0.3, 0, 1.2], undersuit: [[0.022, 0.022, 0.028], 0.7, 0, 0.2, 0],
};

export class Hero {
  static async load(pipe, url = '/models/hero.glb') {
    const gltf = await new GLTFLoader().loadAsync(url);
    return new Hero(pipe, gltf.scene);
  }

  constructor(pipe, scene) {
    this.pipe = pipe; this.root = scene;
    this.flash = { value: 0 };
    const mats = {};
    const D = pipe.depthDefines;
    const mat = (name) => {
      const k = Object.keys(LOOKS).find((x) => name.toLowerCase().includes(x)) ?? 'armor';
      const [alb, rough, metal, sheen, em] = LOOKS[k];
      return (mats[k] ??= new THREE.ShaderMaterial({
        vertexShader: HERO_VERT, fragmentShader: HERO_FRAG, defines: D, side: THREE.DoubleSide,
        uniforms: { ...pipe.lit(), uAlbedo: { value: new THREE.Vector3(...alb) }, uSurf: { value: new THREE.Vector4(rough, metal, sheen, em) }, uFlash: this.flash },
      }));
    };
    const depth = new THREE.ShaderMaterial({ vertexShader: HERO_DEPTH_VERT, fragmentShader: 'void main() {}', colorWrite: false, side: THREE.DoubleSide });
    scene.traverse((o) => {
      if (!o.isMesh) return;
      o.material = Array.isArray(o.material) ? o.material.map((m) => mat(m.name)) : mat(o.material.name);
      o.frustumCulled = false;
      // Shadow twin: skinned meshes need their own bound copy in the shadow scene.
      const twin = o.isSkinnedMesh ? new THREE.SkinnedMesh(o.geometry, depth) : new THREE.Mesh(o.geometry, depth);
      if (o.isSkinnedMesh) twin.bind(o.skeleton, o.bindMatrix);
      twin.matrixAutoUpdate = false; twin.frustumCulled = false;
      pipe.shadows.scene.add(twin);
      pipe.shadows.twins.push([o, twin]);
    });
    pipe.scene.add(scene);

    this.rig = new Rig(scene);
    const col = (c) => [1, 2, 3, 4, 5].map((i) => `Cape.${c}.${i}`);
    this.cloth = new SpringChains(this.rig, [col('L'), col('C'), col('R'), ['Tabard.F'], ['Tabard.B']], { drag: 0.2, stiffness: 1.2, gravity: 11 });
    this.sword = scene.getObjectByName('Sword');
    this.phase = 0; this.time = 0; this.moveBlend = 0; this.lean = 0; this.yawVel = 0; this.lastYaw = 0;
    this.airBlend = 0; this.landSquash = 0; this.hurtK = 0;
    this._buildTrail();
  }

  _buildTrail() {
    const N = 12;
    this.trailN = N; this.trailPts = [];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
    const uv = new Float32Array(N * 2 * 2), idx = [];
    for (let i = 0; i < N; i++) { uv.set([i / (N - 1), 0, i / (N - 1), 1], i * 4); if (i < N - 1) { const o = i * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); } }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setIndex(idx);
    this.trail = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      vertexShader: 'out vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }', fragmentShader: TRAIL_FRAG,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    }));
    this.trail.frustumCulled = false; this.trail.renderOrder = 6; this.trail.visible = false;
    this.pipe.sceneT.add(this.trail);
  }

  // Key-pose helper: keys = [[time, {Bone: [x, y, z]}], ...], smooth between neighbours.
  _keys(keys, t, w = 1) {
    let i = 0;
    while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
    const [t0, a] = keys[i], [t1, b] = keys[i + 1];
    const k = ease(clamp01((t - t0) / Math.max(1e-4, t1 - t0)));
    const names = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const n of names) {
      const p = a[n] ?? [0, 0, 0], q = b[n] ?? [0, 0, 0];
      this.rig.rot(n, p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, p[2] + (q[2] - p[2]) * k, w);
    }
  }

  update(dt, p, game) {
    const R = this.rig;
    this.time += dt;
    const t = this.time;
    this.flash.value = Math.max(0, this.flash.value - dt * 4);

    // Body placement and banking into turns.
    let dy = p.yaw - this.lastYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); this.lastYaw = p.yaw;
    this.yawVel += (dy / Math.max(dt, 1e-4) - this.yawVel) * Math.min(1, 8 * dt);
    const speed = p.speed, m = clamp01(speed / 1.6), run = clamp01((speed - 2.8) / 2.6), spr = clamp01((speed - 5.8) / 2.2);
    this.moveBlend += ((p.grounded && p.state === 'move' ? m : 0) - this.moveBlend) * Math.min(1, 10 * dt);
    this.airBlend += ((!p.grounded && p.state !== 'roll' ? 1 : 0) - this.airBlend) * Math.min(1, 12 * dt);
    this.landSquash = Math.max(0, this.landSquash - dt * 3.2);
    this.hurtK += ((p.state === 'hurt' ? 1 : 0) - this.hurtK) * Math.min(1, 14 * dt);
    const mb = this.moveBlend;
    this.phase += (speed * dt) / (1.5 + 1.1 * run + 0.5 * spr);
    const ph = this.phase * TAU;

    this.root.position.copy(p.pos);
    this.root.rotation.set(0, p.yaw, 0);
    R.reset();

    // --- base: idle breathing into the walk / run cycle ---
    const br = Math.sin(t * 1.5);
    R.rot('Chest', 0.012 * br, 0, 0); R.rot('Spine', 0.008 * br, 0, 0);
    // Arms rest lower than the modelled A-pose; the right hand carries the sword low.
    R.rot('UpperArm.L', 0.05, 0, -0.52); R.rot('UpperArm.R', 0.12, 0, 0.5);
    R.rot('LowerArm.L', -0.18, 0, 0); R.rot('LowerArm.R', -0.3, 0.1, 0);
    // Blade carried low, tip toward the ground; it comes up into line with the arm to strike.
    const guard = p.state === 'attack' ? 0.25 : 1;
    this.guard = (this.guard ?? 1) + (guard - (this.guard ?? 1)) * Math.min(1, 14 * dt);
    R.rot('Hand.R', 0.85, 0.2, 1.2, this.guard);
    let hipY = -0.012 * (1 - mb) * (1 + br * 0.4);
    if (mb > 0.01) {
      const amp = (0.42 + 0.34 * run + 0.12 * spr) * mb;
      for (const [side, s] of [['L', 0], ['R', Math.PI]]) {
        const a = ph + s;
        R.rot(`UpperLeg.${side}`, -Math.sin(a) * amp - 0.1 * run * mb, 0, 0);
        R.rot(`LowerLeg.${side}`, (0.16 + (0.75 + 0.6 * run) * Math.max(0, Math.cos(a - 0.5))) * mb, 0, 0);
        R.rot(`Foot.${side}`, (-0.18 * Math.max(0, Math.sin(a)) + 0.3 * Math.max(0, -Math.sin(a - 0.4))) * mb, 0, 0);
        const arm = Math.sin(a) * (0.5 + 0.35 * run) * mb * (side === 'R' ? 0.45 : 1);
        R.rot(`UpperArm.${side}`, arm, 0, 0);
        R.rot(`LowerArm.${side}`, -(0.25 + 0.75 * run + 0.25 * Math.max(0, -Math.sin(a))) * mb, 0, 0);
      }
      hipY -= (0.022 + 0.035 * run) * mb * (0.5 + 0.5 * Math.cos(ph * 2));
      R.rot('Hips', (0.05 + 0.1 * run + 0.1 * spr) * mb, Math.sin(ph) * 0.12 * mb, Math.sin(ph) * 0.035 * mb);
      R.rot('Spine', (0.04 + 0.08 * run) * mb, -Math.sin(ph) * 0.1 * mb, 0);
      R.rot('Chest', 0.04 * run * mb, -Math.sin(ph) * 0.12 * mb, 0);
      R.rot('Head', -(0.07 + 0.12 * run) * mb, 0, 0);
    }
    // Lean into turns.
    this.lean += (clamp01(Math.abs(this.yawVel) / 6) * Math.sign(this.yawVel) * mb - this.lean) * Math.min(1, 6 * dt);
    R.rot('Hips', 0, 0, -this.lean * 0.22); R.rot('Spine', 0, 0, -this.lean * 0.1);

    // --- airborne ---
    if (this.airBlend > 0.01) {
      const w = this.airBlend, rising = clamp01(p.vel.y / 6), falling = clamp01(-p.vel.y / 9);
      R.rot('UpperLeg.L', -0.5 * rising - 0.12 * falling, 0, 0, w); R.rot('LowerLeg.L', 0.9 * rising + 0.3 * falling, 0, 0, w);
      R.rot('UpperLeg.R', 0.15 * rising + 0.18 * falling, 0, 0, w); R.rot('LowerLeg.R', 0.5 * rising + 0.2 * falling, 0, 0, w);
      R.rot('UpperArm.L', -0.2, 0, 0.5 + 0.5 * falling, w); R.rot('UpperArm.R', -0.1, 0, -0.35 - 0.45 * falling, w);
      R.rot('Spine', 0.1 * rising - 0.08 * falling, 0, 0, w);
    }
    hipY -= 0.16 * this.landSquash * this.landSquash;
    if (this.landSquash > 0) { const k = this.landSquash * this.landSquash; R.rot('UpperLeg.L', -0.5 * k); R.rot('UpperLeg.R', -0.5 * k); R.rot('LowerLeg.L', 0.95 * k); R.rot('LowerLeg.R', 0.95 * k); R.rot('Spine', 0.25 * k); }

    // --- actions ---
    let rollSpin = 0;
    if (p.state === 'roll') {
      const k = clamp01(p.stateTime / TUNE.rollTime), w = Math.sin(Math.PI * k) ** 0.6;
      rollSpin = ease(k) * TAU;
      hipY -= 0.48 * w;
      for (const s of ['L', 'R']) { R.rot(`UpperLeg.${s}`, -1.5 * w); R.rot(`LowerLeg.${s}`, 1.9 * w); R.rot(`UpperArm.${s}`, -0.7 * w); R.rot(`LowerArm.${s}`, -1.3 * w); }
      R.rot('Spine', 0.55 * w); R.rot('Chest', 0.45 * w); R.rot('Head', 0.45 * w);
    } else if (p.state === 'attack' && p.attack) {
      const a = p.attack, k = p.stateTime / a.t, h0 = a.hit[0] / a.t, h1 = a.hit[1] / a.t;
      const step = p.comboStep;
      // Each strike: wind up, cut through the active window, then settle.
      if (step === 0) this._keys([
        [0, {}],
        [h0, { Hips: [0.06, -0.5, 0], Chest: [0.05, -0.55, 0.05], 'UpperArm.R': [-0.5, -0.9, 0.1], 'LowerArm.R': [-0.9, 0, 0], 'UpperLeg.L': [-0.35, 0, 0], 'LowerLeg.L': [0.5, 0, 0], 'UpperLeg.R': [0.2, 0, 0] }],
        [h1, { Hips: [0.12, 0.55, 0], Chest: [0.12, 0.75, -0.05], 'UpperArm.R': [-1.0, 1.2, 0.5], 'LowerArm.R': [-0.25, 0, 0], 'UpperLeg.L': [-0.5, 0, 0], 'LowerLeg.L': [0.75, 0, 0], 'UpperLeg.R': [0.35, 0, 0], 'UpperArm.L': [0.3, 0, -0.3] }],
        [1, { Chest: [0.02, 0.2, 0], 'UpperArm.R': [-0.3, 0.5, 0.2] }],
      ], k);
      else if (step === 1) this._keys([
        [0, { Chest: [0.02, 0.2, 0], 'UpperArm.R': [-0.3, 0.5, 0.2] }],
        [h0, { Hips: [0.06, 0.5, 0], Chest: [0.06, 0.7, -0.05], 'UpperArm.R': [-0.9, 1.3, 0.6], 'LowerArm.R': [-0.8, 0, 0], 'UpperLeg.R': [-0.35, 0, 0], 'LowerLeg.R': [0.5, 0, 0], 'UpperLeg.L': [0.2, 0, 0] }],
        [h1, { Hips: [0.12, -0.55, 0], Chest: [0.12, -0.75, 0.05], 'UpperArm.R': [-0.7, -1.0, 0.0], 'LowerArm.R': [-0.2, 0, 0], 'UpperLeg.R': [-0.5, 0, 0], 'LowerLeg.R': [0.75, 0, 0], 'UpperLeg.L': [0.35, 0, 0] }],
        [1, { Chest: [0.02, -0.2, 0] }],
      ], k);
      else this._keys([
        [0, {}],
        [h0, { Hips: [-0.12, 0, 0], Spine: [-0.2, 0, 0], Chest: [-0.25, 0, 0], 'UpperArm.R': [-2.5, 0, 0.35], 'LowerArm.R': [-0.7, 0, 0], 'UpperArm.L': [-2.3, 0, -0.35], 'LowerArm.L': [-0.8, 0, 0], 'UpperLeg.L': [-0.3, 0, 0], 'LowerLeg.L': [0.4, 0, 0] }],
        [h1, { Hips: [0.3, 0, 0], Spine: [0.3, 0, 0], Chest: [0.35, 0, 0], 'UpperArm.R': [-0.5, 0, 0.3], 'LowerArm.R': [-0.15, 0, 0], 'UpperArm.L': [-0.5, 0, -0.3], 'LowerArm.L': [-0.3, 0, 0], 'UpperLeg.L': [-0.75, 0, 0], 'LowerLeg.L': [1.0, 0, 0], 'UpperLeg.R': [0.45, 0, 0], 'LowerLeg.R': [0.3, 0, 0] }],
        [1, { Hips: [0.1, 0, 0], Chest: [0.1, 0, 0] }],
      ], k);
      if (step >= 2) hipY -= 0.2 * Math.sin(Math.PI * clamp01((k - h0) / (1 - h0)));
    } else if (p.state === 'dead') {
      const k = ease(clamp01(p.stateTime / 0.9));
      hipY -= 0.82 * k;
      R.rot('Hips', -1.35 * k, 0, 0.2 * k); R.rot('Spine', -0.1 * k); R.rot('Head', -0.3 * k);
      R.rot('UpperLeg.L', 0.5 * k); R.rot('LowerLeg.L', 0.6 * k); R.rot('UpperArm.L', 0, 0, 0.7 * k); R.rot('UpperArm.R', 0, 0, -0.5 * k);
    }
    if (this.hurtK > 0.01) { const w = this.hurtK; R.rot('Spine', -0.3 * w, 0.15 * w); R.rot('Chest', -0.25 * w); R.rot('Head', -0.3 * w); R.rot('UpperArm.L', -0.4 * w, 0, 0.3 * w); }
    if (game.prompt && game.input.held.has('interact')) { const w = clamp01((game.prompt.progress ?? 0) * 3); R.rot('UpperArm.R', -2.4 * w, 0, 0.2 * w); R.rot('LowerArm.R', -0.2 * w); R.rot('Chest', -0.12 * w); R.rot('Head', -0.25 * w); }

    this.debugPose?.(R, p);
    R.apply();
    const hips = R.bones.hips;
    if (hips) { hips.bone.position.copy(hips.restPos); hips.bone.position.y += hipY; }
    if (rollSpin) {
      // Somersault about the hips.
      const piv = (hips?.restPos.y ?? 1) + hipY;
      this.root.position.y += piv; this.root.rotateX(rollSpin); this.root.translateY(-piv);
    }
    this.root.updateMatrixWorld(true);

    // --- cloth ---
    const cols = this.cloth.colliders; cols.length = 0;
    const wp = (name, v) => { const b = R.get(name); return b ? b.getWorldPosition(v) : null; };
    const hp = wp('Hips', new THREE.Vector3()), cp = wp('Chest', new THREE.Vector3());
    if (hp && cp) cols.push({ a: hp.clone().add(new THREE.Vector3(0, -0.45, 0)), b: cp.clone().add(new THREE.Vector3(0, 0.25, 0)), r: 0.21 });
    for (const s of ['L', 'R']) { const a = wp(`UpperLeg.${s}`, new THREE.Vector3()), b = wp(`Foot.${s}`, new THREE.Vector3()); if (a && b) cols.push({ a, b, r: 0.12 }); }
    // A light breeze from the valley, plus the air the hero moves through.
    this.cloth.wind.set(0.28 + Math.sin(t * 0.7) * 0.14 - p.vel.x * 0.05, 0, 0.14 - p.vel.z * 0.05);
    this.cloth.update(dt, t);
    this.root.updateMatrixWorld(true);

    // --- blade trail ---
    if (this.sword) {
      const active = p.state === 'attack' && p.attack && p.stateTime > p.attack.hit[0] * 0.6 && p.stateTime < p.attack.hit[1] + 0.08;
      const base = this.sword.localToWorld(new THREE.Vector3(0, 0.1, 0)), tip = this.sword.localToWorld(new THREE.Vector3(0, 0.99, 0));
      if (active) this.trailPts.push([base, tip]); else if (this.trailPts.length) this.trailPts.shift();
      while (this.trailPts.length > this.trailN) this.trailPts.shift();
      const n = this.trailPts.length;
      this.trail.visible = n > 1;
      if (n > 1) {
        const pos = this.trail.geometry.attributes.position;
        for (let i = 0; i < this.trailN; i++) {
          const q = this.trailPts[Math.max(0, n - this.trailN + i)] ?? this.trailPts[0];
          pos.setXYZ(i * 2, q[0].x, q[0].y, q[0].z); pos.setXYZ(i * 2 + 1, q[1].x, q[1].y, q[1].z);
        }
        pos.needsUpdate = true;
      }
    }
  }

  onLand(fell) { this.landSquash = Math.min(1, 0.35 + fell * 0.12); }
  onHit() { this.flash.value = 0.25; }
}
