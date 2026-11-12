// Terrain: two height maps (1 m core, 8 m region) drawn with a CDLOD quadtree of instanced
// grid patches that morph between levels, so there are no cracks and no popping.
// Normal, occlusion and sun-shadow maps are derived on the GPU at load time, and every
// surface texture is baked by the TextureForge.
import * as THREE from 'three';
import { FullscreenPass } from '../engine/fullscreen.js';
import { COMMON, SKYMAP } from '../engine/glsl.js';
import { SH_GLSL, SKY_SAMPLE } from '../engine/sky.js';
import { LIGHTING } from '../engine/lighting.js';
import { TextureForge, FORGE_LIB } from '../engine/forge.js';
import { TERRAIN_MATERIALS } from './terrainMaterials.js';
import { WORLD } from './layout.js';

async function loadHeights(url, meta) {
  const res = await fetch(url);
  const stream = res.body.pipeThrough(new DecompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  const q = new Uint16Array(buf);
  const out = new Float32Array(q.length);
  const k = (meta.max - meta.min) / 65535;
  for (let i = 0; i < q.length; i++) out[i] = meta.min + q[i] * k;
  return out;
}

function heightTexture(data, res) {
  const t = new THREE.DataTexture(data, res, res, THREE.RedFormat, THREE.FloatType);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

const NORMAL_BAKE = /* glsl */ `
uniform sampler2D uH;
uniform float uTexel;   // metres per texel
uniform float uRes;
void main() {
  float e = 1.0 / uRes;
  float hl = textureLod(uH, vUv - vec2(e, 0.0), 0.0).r, hr = textureLod(uH, vUv + vec2(e, 0.0), 0.0).r;
  float hd = textureLod(uH, vUv - vec2(0.0, e), 0.0).r, hu = textureLod(uH, vUv + vec2(0.0, e), 0.0).r;
  float hc = textureLod(uH, vUv, 0.0).r;
  vec3 n = normalize(vec3(hl - hr, 2.0 * uTexel, hd - hu));
  // Curvature: positive in creases, negative on ridges.
  float curv = (hl + hr + hd + hu - 4.0 * hc) / uTexel;
  // Cliff mask baked here so that its mips average the mask, not the normals.
  float cliff = smoothstep(0.26, 0.5, 1.0 - n.y);
  outColor = vec4(n.xz * 0.5 + 0.5, clamp(curv * 0.25 + 0.5, 0.0, 1.0), cliff);
}`;

// Horizon-based sky visibility over the height field.
const AO_BAKE = /* glsl */ `
uniform sampler2D uH;
uniform float uSize;
uniform float uRadius;
void main() {
  float h0 = textureLod(uH, vUv, 0.0).r;
  float vis = 0.0;
  for (int d = 0; d < 8; d++) {
    float a = (float(d) + 0.5) * 0.7853982;
    vec2 dir = vec2(cos(a), sin(a));
    float maxTan = 0.0;
    for (int i = 1; i <= 10; i++) {
      float t = uRadius * float(i * i) / 100.0;
      float h = textureLod(uH, vUv + dir * t / uSize, 0.0).r;
      maxTan = max(maxTan, (h - h0) / t);
    }
    vis += 1.0 - maxTan / sqrt(1.0 + maxTan * maxTan);
  }
  outColor = vec4(vis / 8.0);
}`;

// For a fixed sun, stores how far above the ground the shadow boundary sits (r) and the
// distance to whatever casts it (g). Anything at height y is lit when y > ground + r, so the
// same map shadows terrain, buildings, trees and fog samples at any altitude.
const SHADOW_BAKE = /* glsl */ `
uniform sampler2D uH;        // the map being baked
uniform sampler2D uHFar;     // region map, used once the ray leaves this map
uniform float uSize;
uniform float uFarSize;
uniform float uTexel;
uniform vec3 uSunDir;
uniform int uSteps;
float heightAt(vec2 xz) {
  vec2 uv = xz / uSize + 0.5;
  if (uv.x > 0.001 && uv.x < 0.999 && uv.y > 0.001 && uv.y < 0.999) return textureLod(uH, uv, 0.0).r;
  return textureLod(uHFar, xz / uFarSize + 0.5, 0.0).r;
}
void main() {
  vec2 xz = (vUv - 0.5) * uSize;
  float h0 = textureLod(uH, vUv, 0.0).r;
  vec2 dir = normalize(uSunDir.xz);
  float tanEl = uSunDir.y / length(uSunDir.xz);
  float best = 0.0, bestT = 0.0, t = uTexel;
  for (int i = 0; i < uSteps; i++) {
    float h = heightAt(xz + dir * t) - t * tanEl - h0;
    if (h > best) { best = h; bestT = t; }
    t += max(uTexel, t * 0.035);
    if (t > 14000.0) break;
  }
  outColor = vec4(best, bestT, 0.0, 1.0);
}`;

const NOISE_BAKE = /* glsl */ `
${FORGE_LIB}
void main() {
  outColor = vec4(pfbm(vUv, vec2(4.0), 6, 1.0), pfbm(vUv, vec2(4.0), 6, 7.0), pfbm(vUv, vec2(6.0), 5, 13.0), pfbm(vUv, vec2(3.0), 6, 23.0));
}`;

export const TERRAIN_SAMPLING = /* glsl */ `
uniform sampler2D uHCore;
uniform sampler2D uHRegion;
uniform sampler2D uSCore;
uniform sampler2D uSRegion;
const float CORE_SIZE = ${WORLD.coreSize.toFixed(1)};
const float REGION_SIZE = ${WORLD.regionSize.toFixed(1)};
float coreWeight(vec2 xz) {
  vec2 e = abs(xz) / (CORE_SIZE * 0.5);
  return 1.0 - smoothstep(0.9, 0.985, max(e.x, e.y));
}
float terrainHeight(vec2 xz) {
  float h = textureLod(uHRegion, xz / REGION_SIZE + 0.5, 0.0).r;
  float w = coreWeight(xz);
  if (w > 0.0) h = mix(h, textureLod(uHCore, xz / CORE_SIZE + 0.5, 0.0).r, w);
  return h;
}
// Sun visibility from the baked terrain shadow maps for a point at any height.
float terrainSunVis(vec3 p) {
  float w = coreWeight(p.xz);
  vec2 s = textureLod(uSRegion, p.xz / REGION_SIZE + 0.5, 0.0).rg;
  float g = textureLod(uHRegion, p.xz / REGION_SIZE + 0.5, 0.0).r;
  if (w > 0.0) {
    s = mix(s, textureLod(uSCore, p.xz / CORE_SIZE + 0.5, 0.0).rg, w);
    g = mix(g, textureLod(uHCore, p.xz / CORE_SIZE + 0.5, 0.0).r, w);
  }
  float pen = 0.35 + s.g * 0.012;        // penumbra widens with distance to the occluder
  return smoothstep(-pen, pen, p.y - (g + s.r));
}
`;

const TERRAIN_VERT = /* glsl */ `
${TERRAIN_SAMPLING}
in vec4 iNode;
uniform vec3 uLodCam;
uniform float uLodBase;
out vec3 vWorld;
void main() {
  float cell = iNode.z / 8.0;
  vec2 g = position.xy;
  vec2 xz = iNode.xy + g * cell;
  float h = terrainHeight(xz);
  float rEnd = uLodBase * exp2(iNode.w);
  float k = clamp((distance(vec3(xz.x, h, xz.y), uLodCam) - rEnd * 0.82) / (rEnd * 0.16), 0.0, 1.0);
  xz -= fract(g * 0.5) * 2.0 * cell * k;
  // Point-sampled heights keep cliff edges crisp at every level of detail.
  h = terrainHeight(xz);
  vWorld = vec3(xz.x, h, xz.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}`;

const LAYER_DEFINES = TERRAIN_MATERIALS.map((m, i) => `#define L_${m.name.toUpperCase()} ${i.toFixed(1)}`).join('\n');

const TERRAIN_FRAG = /* glsl */ `
${COMMON}
${SKYMAP}
${SKY_SAMPLE}
${SH_GLSL}
${TERRAIN_SAMPLING}
${LIGHTING}
uniform sampler2D uNCore;
uniform sampler2D uNRegion;
uniform sampler2D uAOCore;
uniform sampler2D uAORegion;
uniform sampler2DArray uTA;
uniform sampler2DArray uTB;
${LAYER_DEFINES}
uniform sampler2D uNoise;
in vec3 vWorld;

void layerAt(float layer, vec2 p, vec2 dpx, vec2 dpy, float s, out vec4 A, out vec4 B) {
  A = textureGrad(uTA, vec3(p / s, layer), dpx / s, dpy / s);
  B = textureGrad(uTB, vec3(p / s, layer), dpx / s, dpy / s);
}
// Cliff rock: the close-up layer hands over to a dedicated far layer, which itself steps up
// in scale again past a kilometre, so the faces keep believable structure at any range.
void rockSample(vec2 p, float dist, out vec4 A, out vec4 B) {
  vec2 dpx = dFdx(p), dpy = dFdy(p);
  float f1 = smoothstep(45.0, 150.0, dist), f2 = smoothstep(700.0, 1600.0, dist);
  vec4 a, b;
  A = vec4(0.0); B = vec4(0.0);
  if (f1 < 1.0) { layerAt(L_ROCK, p, dpx, dpy, 9.0, a, b); A += a * (1.0 - f1); B += b * (1.0 - f1); }
  if (f1 > 0.0 && f2 < 1.0) { layerAt(L_ROCKFAR, p, dpx, dpy, 130.0, a, b); A += a * f1 * (1.0 - f2); B += b * f1 * (1.0 - f2); }
  if (f2 > 0.0) { layerAt(L_ROCKFAR, p + 211.0, dpx, dpy, 620.0, a, b); A += a * f2; B += b * f2; }
}
void main() {
  vec2 xz = vWorld.xz;
  float dist = distance(vWorld, cameraPosition);
  vec3 V = (cameraPosition - vWorld) / dist;
  float cw = coreWeight(xz);
  vec4 nm = texture(uNRegion, xz / REGION_SIZE + 0.5);
  float aoM = texture(uAORegion, xz / REGION_SIZE + 0.5).r;
  if (cw > 0.0) {
    nm = mix(nm, texture(uNCore, xz / CORE_SIZE + 0.5), cw);
    aoM *= mix(1.0, texture(uAOCore, xz / CORE_SIZE + 0.5).r, cw);
  }
  vec2 nd = nm.rg * 2.0 - 1.0;
  vec3 N = normalize(vec3(nd.x, sqrt(max(1.0 - dot(nd, nd), 0.0)), nd.y));
  float curv = nm.b * 2.0 - 1.0;
  float h = vWorld.y;

  vec4 n1 = texture(uNoise, xz / 410.0);
  vec4 n2 = texture(uNoise, xz / 57.0 + 0.31);

  // --- layer weights ---
  float cliff = smoothstep(0.3, 0.7, nm.a + (n2.r - 0.5) * 0.35);
  float shore = (1.0 - smoothstep(0.5, 2.6, h + n2.g * 1.6)) * (1.0 - cliff);
  float snow = smoothstep(1000.0, 1450.0, h + n1.r * 520.0) * (1.0 - 0.75 * cliff);
  float ledge = smoothstep(0.5, 0.85, N.y + (n2.b - 0.5) * 0.3);
  float moss = cliff * ledge * smoothstep(0.35, 0.6, n1.g + n2.a * 0.3);
  float rock = cliff * (1.0 - moss);
  float flat_ = (1.0 - cliff) * (1.0 - shore);
  float soil = flat_ * saturate(smoothstep(0.1, 0.26, 1.0 - N.y) + smoothstep(0.25, 0.7, curv) * 0.7 + smoothstep(0.66, 0.8, n2.r) * 0.5);
  float grass = flat_ - soil;
  float lowland = 1.0 - smoothstep(26.0, 60.0, h);             // shaded forest floor in the lowlands
  float litter = grass * smoothstep(0.5, 0.7, n1.b) * lowland * 0.8;
  grass -= litter;

  vec2 dpx = dFdx(xz), dpy = dFdy(xz);
  vec4 A = vec4(0.0), B = vec4(0.0), a, b;
  float ws = 0.0, w;
  vec3 Nd = vec3(0.0);
#define TOP(layer, weight, s0) if (weight > 0.004) { layerAt(layer, xz, dpx, dpy, s0, a, b); w = weight * (0.3 + a.a); A += a * w; B += b * w; ws += w; vec2 t = b.rg * 2.0 - 1.0; Nd += w * vec3(t.x, 0.0, t.y); }
  // Grass hands over to the far meadow layer so the ground never goes flat with distance.
  float gFar = smoothstep(18.0, 70.0, dist);
  TOP(L_GRASS, grass * (1.0 - gFar), 2.6)
  TOP(L_MEADOWFAR, grass * gFar, 46.0)
  TOP(L_SOIL, soil, 3.2)
  TOP(L_PEBBLE, shore, 2.2)
  TOP(L_MOSS, moss, 3.4)
  TOP(L_LITTER, litter, 2.8)
  TOP(L_SNOW, snow * (1.0 - cliff), 6.0)
  if (rock > 0.004) {
    // Triplanar on the two side planes so strata stay horizontal on every face.
    vec2 bw = pow(abs(N.xz) + 1e-4, vec2(5.0));
    bw /= bw.x + bw.y;
    vec3 pos = vWorld + vec3(n1.a * 9.0, 0.0, n1.r * 9.0);    // break up the bedding lines
    if (bw.x > 0.03) {
      rockSample(pos.zy, dist, a, b);
      w = rock * bw.x * (0.3 + a.a); A += a * w; B += b * w; ws += w;
      vec2 t = b.rg * 2.0 - 1.0; Nd += w * 1.6 * vec3(0.0, t.y, t.x);
    }
    if (bw.y > 0.03) {
      rockSample(pos.xy, dist, a, b);
      w = rock * bw.y * (0.3 + a.a); A += a * w; B += b * w; ws += w;
      vec2 t = b.rg * 2.0 - 1.0; Nd += w * 1.6 * vec3(t.x, t.y, 0.0);
    }
  }  A /= max(ws, 1e-4); B /= max(ws, 1e-4); Nd /= max(ws, 1e-4);
  vec3 Ns = normalize(N + Nd * 0.9);

  vec3 alb = A.rgb;
  // Large-scale colour drift so no two meadows or cliff faces look the same.
  alb *= mix(vec3(0.82, 0.9, 0.8), vec3(1.16, 1.08, 0.94), n1.r) * (0.86 + 0.28 * n2.a);
  alb = mix(alb, alb * vec3(1.25, 1.1, 0.7), grass * smoothstep(0.55, 0.8, n1.a) * 0.5);
  // Rain streaks and damp at the foot of the cliffs.
  alb *= 1.0 - rock * 0.3 * smoothstep(0.5, 0.75, texture(uNoise, vec2(dot(xz, vec2(0.021, 0.017)), h * 0.0016)).g);
  float wet = 1.0 - smoothstep(-0.1, 0.9, h);
  alb *= mix(1.0, 0.55, wet);
  float rough = mix(B.b, 0.28, wet);
  alb = mix(alb, vec3(0.9, 0.93, 0.98), snow * cliff * 0.5);

  float ao = B.a * (0.25 + 0.75 * aoM) * (1.0 - 0.3 * saturate(curv * 1.5));
  float vis = sunVisibility(vWorld + N * 0.35 + uSunDir * 0.25);
  vec3 col = shadeSurface(alb, rough, 0.0, Ns, V, vis, ao, 0.0);
  gl_FragColor = vec4(col, 1.0);
}`;

export class Terrain {
  static async load(pipe, onProgress = () => {}) {
    const meta = await (await fetch('/world/world.json')).json();
    onProgress('heights', 0.1);
    const [core, region] = await Promise.all([
      loadHeights('/world/core_h.bin', meta.core),
      loadHeights('/world/region_h.bin', meta.region),
    ]);
    onProgress('maps', 0.5);
    return new Terrain(pipe, core, region, meta);
  }

  constructor(pipe, core, region, meta) {
    this.pipe = pipe;
    this.core = core; this.region = region; this.meta = meta;
    this.coreRes = meta.core.res; this.regionRes = meta.region.res;
    this.coreSize = meta.core.size; this.regionSize = meta.region.size;
    const r = pipe.renderer;

    this.texHCore = heightTexture(core, this.coreRes);
    this.texHRegion = heightTexture(region, this.regionRes);

    const mapTarget = (res, type, format) => {
      const bytes = type === THREE.UnsignedByteType;
      const t = new THREE.WebGLRenderTarget(res, res, { depthBuffer: false, type, format, generateMipmaps: bytes, minFilter: bytes ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter, magFilter: THREE.LinearFilter });
      t.texture.anisotropy = bytes ? 8 : 1;
      return t;
    };
    this.nCore = mapTarget(this.coreRes, THREE.UnsignedByteType, THREE.RGBAFormat);
    this.nRegion = mapTarget(this.regionRes, THREE.UnsignedByteType, THREE.RGBAFormat);
    this.aoCore = mapTarget(this.coreRes, THREE.UnsignedByteType, THREE.RedFormat);
    this.aoRegion = mapTarget(this.regionRes, THREE.UnsignedByteType, THREE.RedFormat);
    this.sCore = mapTarget(this.coreRes, THREE.HalfFloatType, THREE.RGFormat);
    this.sRegion = mapTarget(this.regionRes, THREE.HalfFloatType, THREE.RGFormat);

    const nb = new FullscreenPass({ fragment: NORMAL_BAKE, uniforms: { uH: { value: this.texHCore }, uTexel: { value: this.coreSize / this.coreRes }, uRes: { value: this.coreRes } } });
    nb.render(r, this.nCore);
    nb.uniforms.uH.value = this.texHRegion; nb.uniforms.uTexel.value = this.regionSize / this.regionRes; nb.uniforms.uRes.value = this.regionRes;
    nb.render(r, this.nRegion);
    nb.dispose();

    this.noise = new THREE.WebGLRenderTarget(256, 256, { depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    this.noise.texture.wrapS = this.noise.texture.wrapT = THREE.RepeatWrapping;
    const nz = new FullscreenPass({ fragment: NOISE_BAKE });
    nz.render(r, this.noise);
    nz.dispose();

    this.layers = new TextureForge(r).bake(TERRAIN_MATERIALS, 1024);

    this.shadowBake = new FullscreenPass({
      fragment: SHADOW_BAKE,
      uniforms: {
        uH: { value: null }, uHFar: { value: this.texHRegion }, uSize: { value: 1 }, uFarSize: { value: this.regionSize },
        uTexel: { value: 1 }, uSunDir: { value: pipe.sky.sunDir }, uSteps: { value: 200 },
      },
    });
    this.aoBake = new FullscreenPass({ fragment: AO_BAKE, uniforms: { uH: { value: null }, uSize: { value: 1 }, uRadius: { value: 1 } } });
    this._queue = [];
    this.queueBakes();

    this.uniforms = {
      uHCore: { value: this.texHCore }, uHRegion: { value: this.texHRegion },
      uSCore: { value: this.sCore.texture }, uSRegion: { value: this.sRegion.texture },
    };
    this.surfaceUniforms = {
      uNCore: { value: this.nCore.texture }, uNRegion: { value: this.nRegion.texture },
      uAOCore: { value: this.aoCore.texture }, uAORegion: { value: this.aoRegion.texture },
      uTA: { value: this.layers.a }, uTB: { value: this.layers.b }, uNoise: { value: this.noise.texture },
    };

    pipe.terrainUniforms = this.uniforms;
    this._buildPyramid();
    this._buildMesh();
  }

  // Queues the occlusion and sun-shadow bakes as small tiles; bakeStep() works through them.
  queueBakes() {
    this._queue.length = 0;
    const T = 256;
    const tiles = (res, fn) => { for (let y = 0; y < res; y += T) for (let x = 0; x < res; x += T) this._queue.push(() => fn(x, y, T)); };
    const r = this.pipe.renderer;
    const ao = (target, tex, size, radius) => (x, y, t) => {
      const u = this.aoBake.uniforms; u.uH.value = tex; u.uSize.value = size; u.uRadius.value = radius;
      this.aoBake.renderRegion(r, target, x, y, t, t);
    };
    const sh = (target, tex, size, res, steps) => (x, y, t) => {
      const u = this.shadowBake.uniforms; u.uH.value = tex; u.uSize.value = size; u.uTexel.value = size / res; u.uSteps.value = steps;
      this.shadowBake.renderRegion(r, target, x, y, t, t);
    };
    tiles(this.regionRes, ao(this.aoRegion, this.texHRegion, this.regionSize, 640));
    tiles(this.coreRes, ao(this.aoCore, this.texHCore, this.coreSize, 48));
    tiles(this.regionRes, sh(this.sRegion, this.texHRegion, this.regionSize, this.regionRes, 150));
    tiles(this.coreRes, sh(this.sCore, this.texHCore, this.coreSize, this.coreRes, 230));
    this._queueTotal = this._queue.length;
  }

  // Runs a few bake tiles. Returns the fraction still to do (0 when finished).
  bakeStep(maxTiles = 2) {
    for (let i = 0; i < maxTiles && this._queue.length; i++) this._queue.shift()();
    return this._queue.length / this._queueTotal;
  }

  heightAt(x, z) {
    const sample = (data, res, size) => {
      const fx = (x / size + 0.5) * res - 0.5, fz = (z / size + 0.5) * res - 0.5;
      const ix = Math.max(0, Math.min(res - 2, Math.floor(fx))), iz = Math.max(0, Math.min(res - 2, Math.floor(fz)));
      const tx = Math.max(0, Math.min(1, fx - ix)), tz = Math.max(0, Math.min(1, fz - iz));
      const o = iz * res + ix;
      return (data[o] * (1 - tx) + data[o + 1] * tx) * (1 - tz) + (data[o + res] * (1 - tx) + data[o + res + 1] * tx) * tz;
    };
    const e = Math.max(Math.abs(x), Math.abs(z)) / (this.coreSize * 0.5);
    const hr = e < 0.9 ? 0 : sample(this.region, this.regionRes, this.regionSize);
    if (e >= 0.985) return hr;
    const hc = sample(this.core, this.coreRes, this.coreSize);
    if (e <= 0.9) return hc;
    const t = (e - 0.9) / 0.085, w = 1 - t * t * (3 - 2 * t);
    return hr + (hc - hr) * w;
  }

  _buildPyramid() {
    // Min/max height pyramid over the region map; level 0 nodes are 16 m (2x2 texels).
    const res = this.regionRes;
    let n = res / 2;
    let mn = new Float32Array(n * n), mx = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = this.region[(2 * j) * res + 2 * i], b = this.region[(2 * j) * res + 2 * i + 1], c = this.region[(2 * j + 1) * res + 2 * i], d = this.region[(2 * j + 1) * res + 2 * i + 1];
      mn[j * n + i] = Math.min(a, b, c, d); mx[j * n + i] = Math.max(a, b, c, d);
    }
    this.pyr = [{ n, mn, mx }];
    while (n > 1) {
      const m = n / 2, mn2 = new Float32Array(m * m), mx2 = new Float32Array(m * m);
      for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
        const o = (2 * j) * n + 2 * i;
        mn2[j * m + i] = Math.min(mn[o], mn[o + 1], mn[o + n], mn[o + n + 1]);
        mx2[j * m + i] = Math.max(mx[o], mx[o + 1], mx[o + n], mx[o + n + 1]);
      }
      n = m; mn = mn2; mx = mx2;
      this.pyr.push({ n, mn, mx });
    }
    this.levels = this.pyr.length;      // 11: 16 m leaves up to the 16 km root
    this.leaf = this.regionSize / this.pyr[0].n;
  }

  _buildMesh() {
    const G = 8, verts = [], idx = [];
    for (let j = 0; j <= G; j++) for (let i = 0; i <= G; i++) verts.push(i, j, 0);
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const a = j * (G + 1) + i, b = a + 1, c = a + G + 1, d = c + 1;
      // Alternate the diagonal so morphing collapses cleanly onto the coarser grid.
      if ((i + j) % 2 === 0) idx.push(a, c, b, b, c, d); else idx.push(a, c, d, a, d, b);
    }
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setIndex(idx);
    this.maxNodes = 4096;
    this.nodeData = new Float32Array(this.maxNodes * 4);
    this.nodeAttr = new THREE.InstancedBufferAttribute(this.nodeData, 4);
    this.nodeAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iNode', this.nodeAttr);
    geo.instanceCount = 0;

    const g = this.pipe.globals;
    this.lodUniforms = { uLodCam: { value: new THREE.Vector3() }, uLodBase: { value: 64 } };
    this.material = new THREE.ShaderMaterial({
      vertexShader: TERRAIN_VERT,
      fragmentShader: TERRAIN_FRAG,
      defines: this.pipe.depthDefines,
      uniforms: { ...this.pipe.lit(), ...this.surfaceUniforms, ...this.lodUniforms },
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.geometry = geo;
    this.lodScale = 2;
  }

  // CDLOD selection (after Strugar). Writes the visible patch list into the instance buffer.
  select(camera) {
    const cam = _v.setFromMatrixPosition(camera.matrixWorld);
    _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_pm, camera.coordinateSystem, camera.reversedDepth);
    const base = 64 * this.lodScale;
    this.lodUniforms.uLodCam.value.copy(cam);
    this.lodUniforms.uLodBase.value = base;
    const half = this.regionSize / 2, leaf = this.leaf, pyr = this.pyr, data = this.nodeData, maxNodes = this.maxNodes;
    let count = 0;
    const push = (x0, z0, size, level) => {
      if (count >= maxNodes) return;
      const o = count * 4;
      data[o] = x0; data[o + 1] = z0; data[o + 2] = size; data[o + 3] = level;
      count++;
    };
    const sphereHits = (x0, z0, s, y0, y1, r) => {
      const dx = Math.max(x0 - cam.x, 0, cam.x - x0 - s), dy = Math.max(y0 - cam.y, 0, cam.y - y1), dz = Math.max(z0 - cam.z, 0, cam.z - z0 - s);
      return dx * dx + dy * dy + dz * dz <= r * r;
    };
    const visit = (level, i, j) => {
      const P = pyr[level], s = leaf * (1 << level), x0 = -half + i * s, z0 = -half + j * s;
      const y0 = P.mn[j * P.n + i] - 4, y1 = P.mx[j * P.n + i] + 4;
      if (!sphereHits(x0, z0, s, y0, y1, base * (1 << level))) return false;
      _box.min.set(x0, y0, z0); _box.max.set(x0 + s, y1, z0 + s);
      if (!_frustum.intersectsBox(_box)) return true;
      const h = s / 2;
      if (level === 0 || !sphereHits(x0, z0, s, y0, y1, base * (1 << (level - 1)))) {
        push(x0, z0, h, level); push(x0 + h, z0, h, level); push(x0, z0 + h, h, level); push(x0 + h, z0 + h, h, level);
      } else {
        for (let c = 0; c < 4; c++) {
          const ci = 2 * i + (c & 1), cj = 2 * j + (c >> 1);
          if (!visit(level - 1, ci, cj)) push(x0 + (c & 1) * h, z0 + (c >> 1) * h, h, level);
        }
      }
      return true;
    };
    const top = this.levels - 1;
    if (!visit(top, 0, 0)) { const s = this.regionSize / 2; push(-s, -s, s, top); push(0, -s, s, top); push(-s, 0, s, top); push(0, 0, s, top); }
    this.geometry.instanceCount = count;
    this.nodeAttr.clearUpdateRanges();
    this.nodeAttr.addUpdateRange(0, count * 4);
    this.nodeAttr.needsUpdate = true;
    this.nodeCount = count;
  }
}

const _v = new THREE.Vector3(), _pm = new THREE.Matrix4(), _frustum = new THREE.Frustum(), _box = new THREE.Box3();
