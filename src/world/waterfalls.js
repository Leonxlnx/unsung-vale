// Waterfalls and their spray. Each fall is a ribbon that leaves a rim, drops ballistically
// and clings to the cliff wherever the rock gets in the way; soft particles rise where it
// lands. Named falls drain the mesa pools, the rest are scattered along the far cliffs.
import * as THREE from 'three';
import { COMMON, SKYMAP } from '../engine/glsl.js';
import { SKY_SAMPLE, SH_GLSL } from '../engine/sky.js';
import { LIGHTING } from '../engine/lighting.js';
import { TERRAIN_SAMPLING } from './terrain.js';
import { POOLS, valleyAxisZ } from './layout.js';
import { mulberry32, hash2 } from '../util/noise.js';

const FALL_VERT = /* glsl */ `
in vec3 aInfo;      // x: across (-1..1), y: distance along the fall (m), z: total length (m)
out vec3 vWorld; out vec3 vInfo;
void main() {
  vWorld = position; vInfo = aInfo;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}`;

const FALL_FRAG = /* glsl */ `
${COMMON}
${SKYMAP}
${SKY_SAMPLE}
${SH_GLSL}
${TERRAIN_SAMPLING}
${LIGHTING}
uniform sampler2D uNoise;
uniform sampler2D uLinDepth;
uniform vec2 uResolution;
uniform float uTime;
in vec3 vWorld; in vec3 vInfo;
void main() {
  float across = vInfo.x, along = vInfo.y, total = vInfo.z;
  // Falling water speeds up, so the streak pattern stretches further down.
  float fall = sqrt(along * 19.6 + 9.0);
  float tt = uTime * 0.62;
  vec2 uv1 = vec2(across * 0.7 + 3.1, along * 0.013 - tt * 0.9 - fall * 0.012);
  vec2 uv2 = vec2(across * 1.9 - 1.3, along * 0.031 - tt * 1.5);
  vec2 uv3 = vec2(across * 4.7, along * 0.075 - tt * 2.4);
  float n = texture(uNoise, uv1).r * 0.5 + texture(uNoise, uv2).g * 0.32 + texture(uNoise, uv3).b * 0.28;
  // The sheet breaks up into veils toward the bottom and frays at its edges.
  float breakup = smoothstep(0.0, 1.0, along / max(total, 1.0));
  float edge = 1.0 - smoothstep(0.55, 1.0, abs(across) + (n - 0.5) * 0.5);
  float body = smoothstep(0.34 + 0.2 * breakup, 0.62 + 0.14 * breakup, n) * edge;
  float lip = 1.0 - smoothstep(0.0, 5.0, along);
  float alpha = saturate(body * (0.9 - 0.25 * breakup) + lip * edge * 0.75);
  // Fade into whatever the water meets so there is no hard line at the cliff or the lake.
  float sceneZ = texture(uLinDepth, gl_FragCoord.xy / uResolution).r;
  float viewZ = -(viewMatrix * vec4(vWorld, 1.0)).z;
  alpha *= saturate((sceneZ - viewZ) * 0.8 + 0.25);
  if (alpha < 0.01) discard;
  vec3 V = normalize(cameraPosition - vWorld);
  float vis = sunVisibility(vWorld + uSunDir * 1.5);
  float back = pow(saturate(dot(-V, uSunDir)), 3.0);
  vec3 light = uSunColor * 0.3183 * vis * (0.55 + 1.6 * back) + shIrradiance(vec3(0.0, 1.0, 0.0)) * 0.9;
  vec3 col = mix(vec3(0.62, 0.74, 0.78), vec3(0.96), smoothstep(0.45, 0.85, n)) * light;
  gl_FragColor = vec4(col, alpha);
}`;

const MIST_VERT = /* glsl */ `
in vec4 iPos;      // xyz: emitter, w: size
in vec4 iParam;    // x: phase, y: rise speed, z: drift, w: lifetime
uniform float uTime;
uniform vec3 uWind;
out vec2 vUv; out float vLife; out vec3 vWorld; out float vSeed;
void main() {
  float t = fract(uTime / iParam.w + iParam.x);
  vLife = t; vSeed = iParam.x;
  vec3 c = iPos.xyz + vec3(uWind.x, 0.0, uWind.z) * (t * iParam.w * 2.2 * iParam.z);
  c.y += t * iParam.y * iParam.w;
  c.xz += vec2(sin(iParam.x * 40.0), cos(iParam.x * 57.0)) * iPos.w * 0.5 * t;
  float size = iPos.w * (0.45 + 1.5 * t);
  vec3 right = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
  vec3 up = normalize(vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]));
  float a = iParam.x * 6.283 + t * 0.6, ca = cos(a), sa = sin(a);
  vec2 q = vec2(position.x * ca - position.y * sa, position.x * sa + position.y * ca);
  vWorld = c + (right * q.x + up * q.y) * size;
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}`;

const MIST_FRAG = /* glsl */ `
${COMMON}
${SKYMAP}
${SKY_SAMPLE}
${SH_GLSL}
${TERRAIN_SAMPLING}
${LIGHTING}
uniform sampler2D uNoise;
uniform sampler2D uLinDepth;
uniform vec2 uResolution;
in vec2 vUv; in float vLife; in vec3 vWorld; in float vSeed;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float puff = texture(uNoise, vUv * 0.42 + vSeed * 3.7).r;
  float a = (1.0 - smoothstep(0.25, 1.0, r + (puff - 0.5) * 0.7));
  a *= smoothstep(0.0, 0.12, vLife) * (1.0 - smoothstep(0.45, 1.0, vLife)) * 0.34;
  float sceneZ = texture(uLinDepth, gl_FragCoord.xy / uResolution).r;
  float viewZ = -(viewMatrix * vec4(vWorld, 1.0)).z;
  a *= saturate((sceneZ - viewZ) * 0.12) * saturate(viewZ * 0.08);
  if (a < 0.004) discard;
  vec3 V = normalize(cameraPosition - vWorld);
  float vis = terrainSunVis(vWorld) * cloudShadow(vWorld);
  float back = pow(saturate(dot(-V, uSunDir)), 2.0);
  vec3 light = uSunColor * 0.3183 * vis * (0.5 + 2.2 * back) + shIrradiance(vec3(0.0, 1.0, 0.0));
  gl_FragColor = vec4(vec3(0.92, 0.95, 0.98) * light, a);
}`;

export class Waterfalls {
  constructor(pipe, terrain, mesas) {
    this.pipe = pipe; this.terrain = terrain;
    const D = pipe.depthDefines;
    const common = { ...pipe.lit(), ...pipe.sceneUniforms, uNoise: terrain.surfaceUniforms.uNoise };
    this.fallMat = new THREE.ShaderMaterial({
      vertexShader: FALL_VERT, fragmentShader: FALL_FRAG, uniforms: common, defines: D,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.wind = new THREE.Vector3(0.9, 0, 0.4);
    this.mistMat = new THREE.ShaderMaterial({
      vertexShader: MIST_VERT, fragmentShader: MIST_FRAG, uniforms: { ...common, uWind: { value: this.wind } }, defines: D,
      transparent: true, depthWrite: false,
    });
    this.group = new THREE.Group();
    this.falls = [];
    const pos = [], info = [], idx = [];
    const mist = [];
    const rnd = mulberry32(31337);

    const addFall = (x0, z0, dx, dz, width, lip, v0 = 2.6) => {
      // Walk outward from the rim: the water follows a ballistic arc unless the rock is higher.
      const T = terrain, pts = [];
      let s = 0, len = 0, prev = null, landed = null;
      for (let i = 0; i < 400; i++) {
        const x = x0 + dx * s, z = z0 + dz * s;
        const g = T.heightAt(x, z);
        const tFall = s / v0;
        const y = Math.max(lip - 4.905 * tFall * tFall, g + 0.25);
        const p = [x, y, z];
        if (prev) len += Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
        pts.push({ p, len });
        prev = p;
        if (y <= 0.4 || (i > 6 && g > y - 0.3 && g < 3)) { landed = p; break; }
        // Once it has reached gentle ground well below the rim, the fall is over.
        if (i > 10 && y <= g + 0.3 && T.heightAt(x + dx * 4, z + dz * 4) > g - 1.2) { landed = p; break; }
        s += y > g + 1 ? 0.35 : 1.2;
      }
      if (pts.length < 4 || len < 12) return null;
      const base = pos.length / 3, px = -dz, pz = dx;
      for (const { p, len: l } of pts) {
        const w = width * (0.5 + 0.12 * Math.min(1, l / 30));
        // Offset away from the rock a touch so the sheet does not z-fight the cliff.
        pos.push(p[0] - px * w + dx * 0.4, p[1], p[2] - pz * w + dz * 0.4, p[0] + px * w + dx * 0.4, p[1], p[2] + pz * w + dz * 0.4);
        info.push(-1, l, len, 1, l, len);
      }
      for (let i = 0; i < pts.length - 1; i++) { const a = base + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      const end = landed ?? pts[pts.length - 1].p;
      const drop = lip - end[1];
      // Spray where it lands, and a thinner veil drifting off the face part-way down.
      const nMist = Math.min(26, Math.round(6 + drop / 9));
      for (let i = 0; i < nMist; i++) mist.push([end[0] + (rnd() - 0.5) * width * 1.6, end[1] + 1 + rnd() * 3, end[2] + (rnd() - 0.5) * width * 1.6, width * (1.3 + rnd() * 1.5) + drop * 0.03, rnd(), 0.9 + rnd() * 1.6, 0.4 + rnd(), 7 + rnd() * 6]);
      const mid = pts[Math.floor(pts.length * 0.55)].p;
      for (let i = 0; i < 5; i++) mist.push([mid[0] + dx * 2, mid[1] - rnd() * drop * 0.25, mid[2] + dz * 2, width * (1 + rnd()), rnd(), -1.5 - rnd() * 2, 0.6 + rnd(), 6 + rnd() * 5]);
      this.falls.push({ top: [x0, lip, z0], end, width, drop });
      return end;
    };

    // Named falls from the pools.
    for (const p of POOLS) {
      const [ox, oz] = p.out;
      // Find where the outflow channel meets the cliff edge.
      let s = p.r;
      while (s < 170 && terrain.heightAt(p.x + ox * s, p.z + oz * s) > p.level - 2.2) s += 1;
      addFall(p.x + ox * (s - 1.5), p.z + oz * (s - 1.5), ox, oz, 13, p.level - 0.5);
      // Thinner side strands a little way along the rim.
      for (const k of [-1, 1]) addFall(p.x + ox * (s - 1.5) - oz * k * 15, p.z + oz * (s - 1.5) + ox * k * 15, ox, oz, 4.5, p.level - 1.2, 2.0);
    }
    // Far falls: off the valley-facing rims of the outer mesas.
    for (const m of mesas) {
      if (m.pinnacle || m.r < 140 || Math.max(Math.abs(m.x), Math.abs(m.z)) < 1050) continue;
      const hsh = hash2(Math.round(m.x), Math.round(m.z), 55);
      const d = Math.abs(m.z - valleyAxisZ(m.x));
      if (hsh > (d < 1400 ? 0.7 : 0.35)) continue;
      const side = Math.sign(valleyAxisZ(m.x) - m.z) || 1;
      const ang = (hsh * 9.7 % 1 - 0.5) * 1.6;
      const dx = Math.sin(ang), dz = Math.cos(ang) * side;
      let s = m.r * 0.5, lip = terrain.heightAt(m.x + dx * s, m.z + dz * s);
      while (s < m.r * 1.5 && terrain.heightAt(m.x + dx * s, m.z + dz * s) > lip - 6) { lip = Math.min(lip, terrain.heightAt(m.x + dx * s, m.z + dz * s) + 0.1); s += 1.5; }
      addFall(m.x + dx * (s - 2), m.z + dz * (s - 2), dx, dz, 9 + hsh * 8, lip - 1.5, 3.2);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 3));
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, this.fallMat);
    mesh.frustumCulled = false; mesh.renderOrder = 2;
    this.group.add(mesh);

    const mg = new THREE.InstancedBufferGeometry();
    mg.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    mg.setIndex([0, 1, 2, 0, 2, 3]);
    const a = new Float32Array(mist.length * 4), b = new Float32Array(mist.length * 4);
    mist.forEach((m, i) => { a.set(m.slice(0, 4), i * 4); b.set(m.slice(4), i * 4); });
    mg.setAttribute('iPos', new THREE.InstancedBufferAttribute(a, 4));
    mg.setAttribute('iParam', new THREE.InstancedBufferAttribute(b, 4));
    mg.instanceCount = mist.length;
    const mm = new THREE.Mesh(mg, this.mistMat);
    mm.frustumCulled = false; mm.renderOrder = 3;
    this.group.add(mm);
    this.mistCount = mist.length;
  }
}
