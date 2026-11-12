// Scene dressing that brings the places to life: banners on the colonnades, wisteria
// hanging from the arcades, petals drifting on the wind and birds far out over the valley.
import * as THREE from 'three';
import { COMMON, SKYMAP } from '../engine/glsl.js';
import { SKY_SAMPLE, SH_GLSL } from '../engine/sky.js';
import { LIGHTING } from '../engine/lighting.js';
import { TERRAIN_SAMPLING } from './terrain.js';
import { mulberry32 } from '../util/noise.js';

const LIT = `${COMMON}\n${SKYMAP}\n${SKY_SAMPLE}\n${SH_GLSL}\n${TERRAIN_SAMPLING}\n${LIGHTING}`;

// --- banners: long crimson cloths with a gilded border and ring device ---
const BANNER_VERT = /* glsl */ `
in vec3 aInfo;      // x: phase, y: hang (0 at the rod, 1 at the tip), z: unused
uniform float uTime; uniform vec3 uWind;
out vec3 vWorld; out vec3 vNormal; out vec2 vUv;
vec3 sway(vec3 p, float hang, float ph) {
  float w = hang * hang;
  float a = uTime * 1.6 + ph + hang * 2.6;
  return p + vec3(uWind.x, 0.0, uWind.z) * w * (0.22 + 0.16 * sin(a)) + vec3(sin(a * 1.3 + p.y) * 0.05, 0.0, cos(a * 0.9) * 0.06) * w;
}
void main() {
  vec3 p = sway(position, aInfo.y, aInfo.x);
  // Rebuild the normal from the displaced cloth so the folds catch the light.
  vec3 px = sway(position + normal.zyx * vec3(0.05, 0.0, -0.05), aInfo.y, aInfo.x);
  vec3 py = sway(position - vec3(0.0, 0.05, 0.0), min(1.0, aInfo.y + 0.0125), aInfo.x);
  vNormal = normalize(cross(py - p, px - p));
  vWorld = p; vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const BANNER_FRAG = /* glsl */ `
${LIT}
in vec3 vWorld; in vec3 vNormal; in vec2 vUv;
void main() {
  vec3 N = normalize(vNormal); vec3 V = normalize(cameraPosition - vWorld);
  if (dot(N, V) < 0.0) N = -N;
  // Swallow-tail cut at the bottom edge.
  float tail = 1.0 - vUv.y;
  if (tail < 0.1 * (1.0 - abs(vUv.x - 0.5) * 2.0)) discard;
  vec2 q = vUv - vec2(0.5, 0.62);
  q.y *= 4.0;
  float ring = smoothstep(0.03, 0.0, abs(length(q) - 0.3)) + smoothstep(0.02, 0.0, abs(length(q) - 0.16));
  float ray = smoothstep(0.012, 0.0, abs(q.x)) * step(abs(q.y), 0.62) + smoothstep(0.05, 0.0, abs(q.y)) * step(abs(q.x), 0.3);
  float border = step(abs(vUv.x - 0.5), 0.5) * (1.0 - step(abs(vUv.x - 0.5), 0.42)) + (1.0 - step(0.03, vUv.y));
  float gold = saturate(max(max(ring, ray * 0.9), border));
  float weave = 0.9 + 0.1 * sin(vUv.x * 240.0) * sin(vUv.y * 900.0);
  vec3 alb = mix(vec3(0.3, 0.022, 0.035) * weave, vec3(0.95, 0.7, 0.3), gold);
  float vis = sunVisibility(vWorld + uSunDir * 0.2);
  vec3 col = shadeSurface(alb, mix(0.85, 0.35, gold), gold, N, V, vis, 1.0, 0.0);
  // Thin cloth lets the low sun through.
  col += alb * uSunColor * 0.3183 * saturate(dot(-N, uSunDir)) * 0.55 * vis * (1.0 - gold);
  gl_FragColor = vec4(col, 1.0);
}`;

// --- petals: a wrapped box of tumbling blossom petals that follows the camera ---
const PETAL_VERT = /* glsl */ `
in vec4 iSeed;
uniform float uTime; uniform vec3 uWind; uniform vec3 uCenter; uniform float uBox;
out vec2 vUv; out vec3 vLight; out float vShade;
${COMMON.replace(/vec3 srgbToLinear[\s\S]*$/, '')}
${SH_GLSL}
${TERRAIN_SAMPLING}
uniform vec3 uSunDir; uniform vec3 uSunColor;
void main() {
  float t = uTime;
  // Each petal falls slowly, pushed along by the wind, and wraps inside the box.
  vec3 base = iSeed.xyz * uBox + vec3(uWind.x * 1.6, -0.55 - iSeed.w * 0.5, uWind.z * 1.6) * t;
  base.xz += vec2(sin(t * 0.7 + iSeed.w * 40.0), cos(t * 0.5 + iSeed.x * 31.0)) * 0.6;
  vec3 c = uCenter + mod(base - uCenter + uBox * 0.5, uBox) - uBox * 0.5;
  float ground = terrainHeight(c.xz);
  float fade = smoothstep(0.0, 0.6, c.y - ground) * (1.0 - smoothstep(0.42, 0.5, length(c - uCenter) / uBox));
  float a = t * (2.0 + iSeed.w * 3.0) + iSeed.x * 50.0, b = t * 1.3 + iSeed.z * 20.0;
  vec3 ax = normalize(vec3(cos(a) * cos(b), sin(b), sin(a) * cos(b))), ay = normalize(cross(ax, vec3(0.3, 1.0, 0.2)));
  vec3 wp = c + (ax * position.x + ay * position.y) * (0.035 + 0.03 * iSeed.w) * fade;
  vUv = position.xy;
  vShade = 0.75 + 0.25 * sin(a);
  vLight = uSunColor * 0.3183 * terrainSunVis(c) * 0.9 + shIrradiance(vec3(0.0, 1.0, 0.0));
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;
const PETAL_FRAG = /* glsl */ `
in vec2 vUv; in vec3 vLight; in float vShade;
void main() {
  // A rounded petal with a notch.
  float d = length(vUv * vec2(1.0, 1.25) + vec2(0.0, 0.15));
  if (d > 0.9 || (vUv.y > 0.55 && abs(vUv.x) < 0.12)) discard;
  vec3 alb = mix(vec3(0.86, 0.5, 0.6), vec3(0.95, 0.78, 0.82), vUv.y * 0.5 + 0.5) * vShade;
  gl_FragColor = vec4(alb * vLight, 1.0);
}`;

// --- motes: dust and pollen adrift in the air, bright where the low sun shines through them ---
const MOTE_VERT = /* glsl */ `
in vec4 iSeed;
uniform float uTime; uniform vec3 uWind; uniform vec3 uCenter; uniform float uBox;
out vec2 vUv; out float vGlow;
${COMMON.replace(/vec3 srgbToLinear[\s\S]*$/, '')}
${TERRAIN_SAMPLING}
uniform vec3 uSunDir;
void main() {
  float t = uTime;
  // Carried slowly along by the wind, wandering a little, wrapped inside a box around the camera.
  vec3 base = iSeed.xyz * uBox + vec3(uWind.x * 0.45, 0.0, uWind.z * 0.45) * t;
  base += vec3(sin(t * 0.4 + iSeed.w * 40.0), sin(t * 0.33 + iSeed.x * 17.0), cos(t * 0.37 + iSeed.y * 31.0)) * 0.6;
  vec3 c = uCenter + mod(base - uCenter + uBox * 0.5, uBox) - uBox * 0.5;
  vec3 toC = cameraPosition - c;
  float d = length(toC);
  float fade = smoothstep(0.1, 0.8, c.y - terrainHeight(c.xz)) * (1.0 - smoothstep(0.38, 0.5, length(c - uCenter) / uBox)) * smoothstep(0.7, 2.5, d);
  // Forward scattering: they blaze when the sun is behind them and all but vanish otherwise.
  float mu = dot(-toC / d, uSunDir);
  float phase = 0.14 + 2.9 * pow(max(mu, 0.0), 6.0);
  float twinkle = 0.55 + 0.45 * sin(t * (1.5 + iSeed.w * 3.0) + iSeed.x * 60.0);
  vGlow = fade * terrainSunVis(c) * phase * twinkle;
  float size = (0.011 + 0.012 * iSeed.w) * (1.0 + d * 0.09);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toC)), up = normalize(cross(toC, right));
  vUv = position.xy;
  gl_Position = projectionMatrix * viewMatrix * vec4(c + (right * position.x + up * position.y) * size, 1.0);
}`;
const MOTE_FRAG = /* glsl */ `
uniform vec3 uSunColor;
in vec2 vUv; in float vGlow;
void main() {
  float a = exp(-dot(vUv, vUv) * 3.6) - 0.027;
  if (a <= 0.0 || vGlow <= 0.002) discard;
  gl_FragColor = vec4(uSunColor * (0.13 * a * vGlow), 0.0);
}`;

// --- butterflies: a few dozen wandering low over the meadows around the camera ---
const FLY_VERT = /* glsl */ `
in vec4 iSeed;
uniform float uTime; uniform vec3 uCenter; uniform float uBox;
out vec2 vUv; out vec3 vLight; out float vKind;
${COMMON.replace(/vec3 srgbToLinear[sS]*$/, '')}
${SH_GLSL}
${TERRAIN_SAMPLING}
uniform vec3 uSunDir; uniform vec3 uSunColor;
void main() {
  float t = uTime, s = iSeed.w;
  // Each one wanders a slow loop with a quicker flutter on top, wrapped around the camera.
  float ang = t * (0.2 + 0.22 * s) + s * 40.0;
  vec2 base = (iSeed.xz - 0.5) * uBox + vec2(sin(ang), cos(ang * 0.83 + s * 9.0)) * 3.4 + vec2(sin(t * 1.3 + s * 9.0), cos(t * 1.7 + s * 5.0)) * 0.45;
  vec2 c = uCenter.xz + mod(base - uCenter.xz + uBox * 0.5, uBox) - uBox * 0.5;
  float ground = terrainHeight(c);
  float y = ground + 0.6 + 1.5 * iSeed.y + 0.3 * sin(t * 2.3 + s * 30.0);
  // Only over the high meadows, and fading out toward the edge of their box.
  float fade = (1.0 - smoothstep(0.4, 0.5, length(c - uCenter.xz) / uBox)) * step(60.0, ground);
  vec2 fw = normalize(vec2(cos(ang), -0.83 * sin(ang * 0.83 + s * 9.0)) + 1e-3);
  vec3 F = vec3(fw.x, 0.0, fw.y), R = vec3(-F.z, 0.0, F.x);
  float flap = sin(t * (15.0 + 9.0 * s) + s * 50.0);
  float size = (0.06 + 0.035 * fract(s * 3.1)) * fade;
  // Wings hinge on the body: the tips swing up and in on every beat.
  vec3 wing = R * position.x * (1.0 - 0.5 * abs(flap)) + vec3(0.0, abs(position.x) * flap * 0.8, 0.0) + F * position.y;
  vec3 wp = vec3(c.x, y, c.y) + wing * size;
  vUv = position.xy;
  vKind = fract(s * 5.7);
  vLight = uSunColor * 0.3183 * terrainSunVis(vec3(c.x, y, c.y)) * (0.75 + 0.25 * flap) + shIrradiance(vec3(0.0, 1.0, 0.0));
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;
const FLY_FRAG = /* glsl */ `
in vec2 vUv; in vec3 vLight; in float vKind;
void main() {
  // Two rounded wings with a darker margin.
  vec2 p = vec2(abs(vUv.x), vUv.y);
  float d = length((p - vec2(0.48, 0.08)) * vec2(1.0, 0.85));
  if (d > 0.52 || p.x < 0.03) discard;
  vec3 alb = vKind < 0.34 ? vec3(0.9, 0.9, 0.82) : vKind < 0.6 ? vec3(0.95, 0.72, 0.16) : vKind < 0.82 ? vec3(0.22, 0.4, 0.9) : vec3(0.9, 0.36, 0.1);
  alb *= mix(1.0, 0.25, smoothstep(0.36, 0.5, d));
  gl_FragColor = vec4(alb * vLight, 1.0);
}`;

// --- birds: small flocks wheeling far out over the valley ---
const BIRD_VERT = /* glsl */ `
in vec4 iBird;     // x: flock, y: place in flock, z: phase, w: size
uniform float uTime;
out float vShade;
void main() {
  float f = iBird.x, t = uTime * (0.045 + 0.012 * f) + f * 2.1;
  vec3 centre = vec3(60.0 + 260.0 * sin(f * 1.7), 150.0 + 46.0 * f + 14.0 * sin(t * 2.0), -30.0 + 150.0 * cos(f * 2.3));
  float R = 230.0 + 90.0 * f;
  vec3 c = centre + vec3(cos(t) * R, 0.0, sin(t) * R * 0.7);
  vec3 fwd = normalize(vec3(-sin(t) * R, 0.0, cos(t) * R * 0.7)), right = vec3(-fwd.z, 0.0, fwd.x);
  // Loose V formation that breathes a little.
  float k = iBird.y, side = mod(k, 2.0) * 2.0 - 1.0, row = floor((k + 1.0) * 0.5);
  c += -fwd * row * 5.0 + right * side * row * 3.6 + vec3(0.0, sin(uTime * 0.6 + iBird.z) * 1.6, 0.0);
  float flap = sin(uTime * (5.5 + iBird.z) + iBird.z * 6.0);
  vec3 p = position * iBird.w;
  p.y += abs(position.x) * flap * 0.55 * iBird.w;
  vec3 wp = c + right * p.x + vec3(0.0, p.y, 0.0) + fwd * p.z;
  vShade = 0.5 + 0.5 * flap;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;
const BIRD_FRAG = /* glsl */ `
in float vShade;
void main() { gl_FragColor = vec4(vec3(0.035, 0.035, 0.045) * (0.7 + 0.5 * vShade), 1.0); }`;

export class Dressing {
  constructor(pipe, terrain, forest) {
    this.pipe = pipe; this.group = new THREE.Group();
    this.wind = forest.wind;
    const lit = { ...pipe.lit(), uWind: { value: this.wind } };

    // Banners are collected as one mesh; add them with banner() and call finish().
    this._b = { pos: [], nrm: [], uv: [], info: [], idx: [] };
    this.bannerMat = new THREE.ShaderMaterial({ vertexShader: BANNER_VERT, fragmentShader: BANNER_FRAG, uniforms: lit, defines: pipe.depthDefines, side: THREE.DoubleSide });

    // Vines reuse the forest's leaf material (wisteria racemes and green leaves).
    this._v = { 9: [], 4: [] };
    this.forest = forest;
    this.rnd = mulberry32(8675309);

    // Petals.
    const pn = 520, seeds = new Float32Array(pn * 4), r = mulberry32(99);
    for (let i = 0; i < pn * 4; i++) seeds[i] = r();
    const pg = new THREE.InstancedBufferGeometry();
    pg.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    pg.setIndex([0, 1, 2, 0, 2, 3]);
    pg.setAttribute('iSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    pg.instanceCount = pn;
    this.petalCenter = new THREE.Vector3();
    this.petals = new THREE.Mesh(pg, new THREE.ShaderMaterial({
      vertexShader: PETAL_VERT, fragmentShader: PETAL_FRAG, side: THREE.DoubleSide,
      uniforms: { ...lit, uCenter: { value: this.petalCenter }, uBox: { value: 46 } },
    }));
    this.petals.frustumCulled = false;
    this.group.add(this.petals);

    // Motes: drawn after the opaque scene and added to it.
    const mn = 700, mseeds = new Float32Array(mn * 4);
    for (let i = 0; i < mn * 4; i++) mseeds[i] = r();
    const mg = new THREE.InstancedBufferGeometry();
    mg.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    mg.setIndex([0, 1, 2, 0, 2, 3]);
    mg.setAttribute('iSeed', new THREE.InstancedBufferAttribute(mseeds, 4));
    mg.instanceCount = mn;
    this.motes = new THREE.Mesh(mg, new THREE.ShaderMaterial({
      vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG,
      uniforms: { ...lit, uCenter: { value: this.petalCenter }, uBox: { value: 34 } },
      transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    }));
    this.motes.frustumCulled = false;
    this.groupT = new THREE.Group();
    this.groupT.add(this.motes);

    // Butterflies.
    const fn = 56, fseeds = new Float32Array(fn * 4);
    for (let i = 0; i < fn * 4; i++) fseeds[i] = r();
    const fg = new THREE.InstancedBufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute([-1, -0.5, 0, -1, 0.7, 0, 0, -0.3, 0, 0, 0.45, 0, 1, -0.5, 0, 1, 0.7, 0], 3));
    fg.setIndex([0, 2, 1, 1, 2, 3, 2, 4, 3, 3, 4, 5]);
    fg.setAttribute('iSeed', new THREE.InstancedBufferAttribute(fseeds, 4));
    fg.instanceCount = fn;
    this.butterflies = new THREE.Mesh(fg, new THREE.ShaderMaterial({
      vertexShader: FLY_VERT, fragmentShader: FLY_FRAG, side: THREE.DoubleSide,
      uniforms: { ...lit, uCenter: { value: this.petalCenter }, uBox: { value: 44 } },
    }));
    this.butterflies.frustumCulled = false;
    this.group.add(this.butterflies);

    // Birds: three flocks of eleven.
    const bn = 33, bd = new Float32Array(bn * 4);
    for (let i = 0; i < bn; i++) bd.set([Math.floor(i / 11), i % 11, r() * 3, 0.9 + r() * 0.5], i * 4);
    const bg = new THREE.InstancedBufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.5, -1.6, 0, -0.1, -0.5, 0, -0.35, 0, 0, 0.5, 0.5, 0, -0.35, 1.6, 0, -0.1], 3));
    bg.setAttribute('iBird', new THREE.InstancedBufferAttribute(bd, 4));
    bg.instanceCount = bn;
    this.birds = new THREE.Mesh(bg, new THREE.ShaderMaterial({ vertexShader: BIRD_VERT, fragmentShader: BIRD_FRAG, uniforms: { uTime: pipe.globals.uTime }, side: THREE.DoubleSide }));
    this.birds.frustumCulled = false;
    this.group.add(this.birds);
  }

  // A banner hanging from (x, y, z), facing along yaw, width w and length h.
  banner(x, y, z, yaw, w = 1.3, h = 4.2) {
    const B = this._b, cols = 4, rows = 16, base = B.pos.length / 3, ph = this.rnd() * 6.283;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
      const u = i / cols, v = j / rows, lx = (u - 0.5) * w;
      B.pos.push(x + lx * c, y - v * h, z - lx * s);
      B.nrm.push(s, 0, c); B.uv.push(u, v); B.info.push(ph, v, 0);
    }
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const a = base + j * (cols + 1) + i, b = a + cols + 1; B.idx.push(a, b, a + 1, a + 1, b, b + 1); }
  }

  // Wisteria trailing from a beam that runs from a to b (world points) at the beam's underside.
  vines(a, b, { drop = 2.2, density = 1.6 } = {}) {
    const L = Math.hypot(b[0] - a[0], b[2] - a[2]), n = Math.round(L * density), rnd = this.rnd;
    const dx = (b[0] - a[0]) / L, dz = (b[2] - a[2]) / L;
    for (let i = 0; i < n; i++) {
      const t = rnd(), x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[2] - a[2]) * t, y = a[1] + (b[1] - a[1]) * t;
      const len = drop * (0.45 + 0.75 * rnd()), wdt = 0.5 + 0.35 * rnd(), yaw = rnd() * Math.PI, off = (rnd() - 0.5) * 0.7;
      const cx = Math.cos(yaw), cz = Math.sin(yaw);
      // Hanging blossom raceme: a tall card whose top is pinned to the beam.
      this._v[9].push({ x: x - dz * off, y, z: z + dx * off, ux: cx * wdt * 0.5, uz: cz * wdt * 0.5, len, ph: rnd() * 6.283, r: rnd() });
      // A tuft of leaves along the beam above it.
      if (i % 2 === 0) this._v[4].push({ x: x - dz * off * 1.3, y: y + 0.55, z: z + dx * off * 1.3, ux: dx * 0.75, uz: dz * 0.75, len: 1.0 + 0.5 * rnd(), ph: rnd() * 6.283, r: rnd() });
    }
  }

  finish() {
    const B = this._b;
    if (B.pos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(B.nrm, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2));
      g.setAttribute('aInfo', new THREE.Float32BufferAttribute(B.info, 3));
      g.setIndex(B.idx);
      const m = new THREE.Mesh(g, this.bannerMat);
      m.frustumCulled = false;
      this.group.add(m);
    }
    for (const layer of [9, 4]) {
      const list = this._v[layer];
      if (!list.length) continue;
      const pos = [], nrm = [], uv = [], wind = [], leaf = [], idx = [];
      for (const c of list) {
        const base = pos.length / 3;
        for (const [u, v] of [[-1, 0], [1, 0], [1, 1], [-1, 1]]) {
          pos.push(c.x + c.ux * u, c.y - c.len * (1 - v), c.z + c.uz * u);
          nrm.push(-c.uz * 0.5, 0.75, c.ux * 0.5);
          uv.push(u * 0.5 + 0.5, v);
          wind.push(0.0, c.ph, (1 - v) * 2.2);       // only the free end swings
          leaf.push(0.25 * (1 - v), c.r);
        }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
      const one = (arr) => new THREE.InstancedBufferAttribute(new Float32Array(arr), 4);
      const g = new THREE.InstancedBufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('aWind', new THREE.Float32BufferAttribute(wind, 3));
      g.setAttribute('aLeaf', new THREE.Float32BufferAttribute(leaf, 2));
      g.setIndex(idx);
      g.setAttribute('iTree', one([0, 0, 0, 1])); g.setAttribute('iParam', one([0, 0.5, layer, 0]));
      g.instanceCount = 1;
      const m = new THREE.Mesh(g, this.forest._mkLeaf(layer, [0, 0]));
      m.frustumCulled = false;
      this.group.add(m);
    }
  }

  update(camera) { this.petalCenter.setFromMatrixPosition(camera.matrixWorld); }
}
