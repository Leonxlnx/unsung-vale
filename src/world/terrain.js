// Terrain: two height maps (1 m core, 8 m region) drawn with a CDLOD quadtree of instanced
// grid patches that morph between levels, so there are no cracks and no popping.
// Normal maps and sun-shadow maps are derived on the GPU at load time.
import * as THREE from 'three';
import { FullscreenPass } from '../engine/fullscreen.js';
import { COMMON, SKYMAP } from '../engine/glsl.js';
import { SH_GLSL } from '../engine/sky.js';
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
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  // Float textures cannot rely on driver mip generation, so build the chain here.
  const mips = [{ data, width: res, height: res }];
  let src = data, n = res;
  while (n > 1) {
    const m = n >> 1, dst = new Float32Array(m * m);
    for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
      const o = 2 * j * n + 2 * i;
      dst[j * m + i] = 0.25 * (src[o] + src[o + 1] + src[o + n] + src[o + n + 1]);
    }
    mips.push({ data: dst, width: m, height: m });
    src = dst; n = m;
  }
  t.mipmaps = mips;
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
  // Curvature: positive in creases, negative on ridges. Used for dirt and soft occlusion.
  float curv = (hl + hr + hd + hu - 4.0 * hc) / uTexel;
  outColor = vec4(n.xz * 0.5 + 0.5, clamp(curv * 0.25 + 0.5, 0.0, 1.0), 1.0);
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

export const TERRAIN_SAMPLING = /* glsl */ `
uniform sampler2D uHCore;
uniform sampler2D uHRegion;
uniform sampler2D uNCore;
uniform sampler2D uNRegion;
uniform sampler2D uSCore;
uniform sampler2D uSRegion;
const float CORE_SIZE = ${WORLD.coreSize.toFixed(1)};
const float REGION_SIZE = ${WORLD.regionSize.toFixed(1)};
float coreWeight(vec2 xz) {
  vec2 e = abs(xz) / (CORE_SIZE * 0.5);
  return 1.0 - smoothstep(0.9, 0.985, max(e.x, e.y));
}
float terrainHeightLod(vec2 xz, float lodC, float lodR) {
  float h = textureLod(uHRegion, xz / REGION_SIZE + 0.5, lodR).r;
  float w = coreWeight(xz);
  if (w > 0.0) h = mix(h, textureLod(uHCore, xz / CORE_SIZE + 0.5, lodC).r, w);
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
  float h = terrainHeightLod(xz, 0.0, 0.0);
  float rEnd = uLodBase * exp2(iNode.w);
  float k = clamp((distance(vec3(xz.x, h, xz.y), uLodCam) - rEnd * 0.82) / (rEnd * 0.16), 0.0, 1.0);
  xz -= fract(g * 0.5) * 2.0 * cell * k;
  // Point-sampled heights keep cliff edges crisp at every level of detail.
  h = terrainHeightLod(xz, 0.0, 0.0);
  vWorld = vec3(xz.x, h, xz.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}`;

const TERRAIN_FRAG = /* glsl */ `
${COMMON}
${SKYMAP}
${SH_GLSL}
${TERRAIN_SAMPLING}
uniform vec3 uSunDir;
uniform vec3 uSunColor;
in vec3 vWorld;

vec3 terrainNormal(vec2 xz, out float curv) {
  float w = coreWeight(xz);
  vec3 n = texture(uNRegion, xz / REGION_SIZE + 0.5).rgb;
  if (w > 0.0) n = mix(n, texture(uNCore, xz / CORE_SIZE + 0.5).rgb, w);
  curv = n.b * 2.0 - 1.0;
  vec2 d = n.rg * 2.0 - 1.0;
  return normalize(vec3(d.x, sqrt(max(1.0 - dot(d, d), 0.0)), d.y));
}

void main() {
  float curv;
  vec3 N = terrainNormal(vWorld.xz, curv);
  float slope = 1.0 - N.y;
  float h = vWorld.y;
  float dist = distance(vWorld, cameraPosition);

  // First-pass materials straight from noise. Replaced by baked texture layers later.
  float n1 = fbm2(vWorld.xz * 0.02, 4), n2 = fbm2(vWorld.xz * 0.21, 4), n3 = fbm2(vWorld.xz * 1.7, 3);
  vec3 grass = mix(vec3(0.07, 0.13, 0.03), vec3(0.16, 0.2, 0.05), n1);
  grass = mix(grass, vec3(0.2, 0.19, 0.07), smoothstep(0.55, 0.8, n2) * 0.6) * (0.75 + 0.5 * n3);
  float strata = fbm2(vec2(h * 0.21 + n1 * 4.0, dot(vWorld.xz, vec2(0.031, 0.027))), 4);
  vec3 rock = mix(vec3(0.2, 0.18, 0.16), vec3(0.42, 0.38, 0.33), strata) * (0.7 + 0.6 * n2);
  rock = mix(rock, vec3(0.1, 0.12, 0.06), smoothstep(0.5, 0.75, n1) * 0.35);
  vec3 soil = vec3(0.16, 0.12, 0.08) * (0.7 + 0.6 * n2);
  vec3 sand = vec3(0.38, 0.33, 0.24) * (0.8 + 0.4 * n3);
  vec3 snow = vec3(0.86, 0.9, 0.95);

  float cliff = smoothstep(0.22, 0.42, slope + (n2 - 0.5) * 0.12);
  vec3 alb = mix(grass, soil, smoothstep(0.1, 0.24, slope));
  alb = mix(alb, rock, cliff);
  alb = mix(alb, sand, (1.0 - smoothstep(0.6, 3.0, h + n2 * 1.5)) * (1.0 - cliff));
  alb = mix(alb, sand * vec3(0.35, 0.5, 0.5), 1.0 - smoothstep(-6.0, 0.0, h));
  float snowLine = smoothstep(1050.0, 1500.0, h + n1 * 500.0) * (1.0 - smoothstep(0.45, 0.75, slope));
  alb = mix(alb, snow, snowLine);
  alb *= 1.0 - 0.35 * saturate(curv * 2.0);

  float vis = terrainSunVis(vWorld + N * 0.3);
  float ndl = saturate(dot(N, uSunDir));
  vec3 col = alb * (uSunColor * ndl * vis + shIrradiance(N) * (0.75 + 0.25 * saturate(-curv * 2.0 + 0.6)));
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
    const t = new Terrain(pipe, core, region, meta);
    return t;
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
      const t = new THREE.WebGLRenderTarget(res, res, { depthBuffer: false, type, format, generateMipmaps: type === THREE.UnsignedByteType, minFilter: type === THREE.UnsignedByteType ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter, magFilter: THREE.LinearFilter });
      t.texture.anisotropy = type === THREE.UnsignedByteType ? 8 : 1;
      return t;
    };
    this.nCore = mapTarget(this.coreRes, THREE.UnsignedByteType, THREE.RGBAFormat);
    this.nRegion = mapTarget(this.regionRes, THREE.UnsignedByteType, THREE.RGBAFormat);
    this.sCore = mapTarget(this.coreRes, THREE.HalfFloatType, THREE.RGFormat);
    this.sRegion = mapTarget(this.regionRes, THREE.HalfFloatType, THREE.RGFormat);

    const nb = new FullscreenPass({ fragment: NORMAL_BAKE, uniforms: { uH: { value: this.texHCore }, uTexel: { value: this.coreSize / this.coreRes }, uRes: { value: this.coreRes } } });
    nb.render(r, this.nCore);
    nb.uniforms.uH.value = this.texHRegion; nb.uniforms.uTexel.value = this.regionSize / this.regionRes; nb.uniforms.uRes.value = this.regionRes;
    nb.render(r, this.nRegion);
    nb.dispose();

    this.shadowBake = new FullscreenPass({
      fragment: SHADOW_BAKE,
      uniforms: {
        uH: { value: null }, uHFar: { value: this.texHRegion }, uSize: { value: 1 }, uFarSize: { value: this.regionSize },
        uTexel: { value: 1 }, uSunDir: { value: pipe.sky.sunDir }, uSteps: { value: 200 },
      },
    });
    this._shadowQueue = [];
    this.queueShadowBake();

    this.uniforms = {
      uHCore: { value: this.texHCore }, uHRegion: { value: this.texHRegion },
      uNCore: { value: this.nCore.texture }, uNRegion: { value: this.nRegion.texture },
      uSCore: { value: this.sCore.texture }, uSRegion: { value: this.sRegion.texture },
    };

    this._buildPyramid();
    this._buildMesh();
  }

  // Queues the sun-shadow bake as small tiles; update() works through them a few per frame.
  queueShadowBake() {
    this._shadowQueue.length = 0;
    const T = 256;
    for (const [target, tex, size, res, steps] of [[this.sRegion, this.texHRegion, this.regionSize, this.regionRes, 150], [this.sCore, this.texHCore, this.coreSize, this.coreRes, 230]]) {
      for (let y = 0; y < res; y += T) for (let x = 0; x < res; x += T) this._shadowQueue.push({ target, tex, size, texel: size / res, steps, x, y, T });
    }
  }

  // Returns true while bake work remains.
  bakeStep(maxTiles = 2) {
    const u = this.shadowBake.uniforms, r = this.pipe.renderer;
    for (let i = 0; i < maxTiles && this._shadowQueue.length; i++) {
      const j = this._shadowQueue.shift();
      u.uH.value = j.tex; u.uSize.value = j.size; u.uTexel.value = j.texel; u.uSteps.value = j.steps;
      this.shadowBake.renderRegion(r, j.target, j.x, j.y, j.T, j.T);
    }
    return this._shadowQueue.length > 0;
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
      uniforms: { ...this.uniforms, ...this.lodUniforms, uSunDir: g.uSunDir, uSunColor: g.uSunColor, uSH: g.uSH },
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
