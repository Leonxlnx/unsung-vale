// Ground cover: grass clumps and flower bunches in a grid of cells that follows the camera.
// Blades are placed, bent and lit entirely in the vertex shader (the fragment shader only
// writes the colour), so a dense meadow costs almost nothing per pixel.
import * as THREE from 'three';
import { COMMON, SKYMAP } from '../../engine/glsl.js';
import { SKY_SAMPLE, SH_GLSL } from '../../engine/sky.js';
import { LIGHTING } from '../../engine/lighting.js';
import { TERRAIN_SAMPLING } from '../terrain.js';
import { mulberry32 } from '../../util/noise.js';

const CELL = 16;

// Shared placement: where ground cover may grow, and how tall.
const PLACE = /* glsl */ `
uniform sampler2D uNCore;
uniform sampler2D uNoise;
uniform vec3 uWind;
uniform float uTime;
uniform float uFadeDist;
// x: height above sea level, y: growth 0..1 (0 = nothing grows here), zw: macro noise
vec4 groundInfo(vec2 xz) {
  float h = terrainHeight(xz);
  vec4 nm = textureLod(uNCore, xz / CORE_SIZE + 0.5, 0.0);
  vec4 n1 = textureLod(uNoise, xz / 410.0, 0.0);
  vec4 n2 = textureLod(uNoise, xz / 57.0 + 0.31, 0.0);
  float cliff = smoothstep(0.3, 0.7, nm.a + (n2.r - 0.5) * 0.35);
  float soil = smoothstep(0.66, 0.8, n2.r);
  float grow = (1.0 - smoothstep(0.02, 0.2, cliff)) * smoothstep(1.3, 2.6, h) * (1.0 - soil * 0.85);
  grow *= step(max(abs(xz.x), abs(xz.y)), CORE_SIZE * 0.45);
  return vec4(h, grow, n1.r, n1.a);
}
vec2 windBend(vec2 xz, float stiff) {
  vec2 wd = uWind.xz;
  float wave = sin(uTime * 1.1 - dot(xz, wd) * 0.22) * 0.5 + sin(uTime * 2.3 + dot(xz, vec2(0.31, 0.17))) * 0.25;
  return wd * (0.22 + 0.3 * wave) * stiff + vec2(sin(uTime * 3.1 + xz.x * 1.7), cos(uTime * 2.7 + xz.y * 1.9)) * 0.04;
}`;

const GRASS_VERT = /* glsl */ `
${COMMON}
${SKYMAP}
${SKY_SAMPLE}
${SH_GLSL}
${TERRAIN_SAMPLING}
${LIGHTING}
${PLACE}
in vec4 iBlade;     // xy: position inside the cell, zw: random
out vec3 vColor;
void main() {
  vec3 origin = modelMatrix[3].xyz;
  vec2 xz = origin.xz + iBlade.xy;
  float bi = position.z;
  vec2 rr = hash22(xz * 3.17 + bi * 7.1);
  xz += (hash22(xz + bi * 1.9) - 0.5) * 0.5;
  vec4 gi = groundInfo(xz);
  float dist = distance(vec3(xz.x, gi.x, xz.y), cameraPosition);
  float fade = 1.0 - smoothstep(uFadeDist * 0.72, uFadeDist, dist);
  float scale = gi.y * fade * step(iBlade.z, gi.y + 0.15);
  if (scale < 0.02) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vColor = vec3(0.0); return; }

  float t = position.y;
  float height = (0.16 + 0.4 * gi.z + 0.34 * rr.x * rr.x) * (0.55 + 0.45 * scale);
  float width = 0.017 * (1.0 + dist * 0.09);
  float yaw = rr.y * 6.2831853;
  vec2 dir = vec2(cos(yaw), sin(yaw));
  vec2 bend = (dir * (0.12 + 0.3 * rr.x) + windBend(xz, 1.0)) * t * t;
  float droop = 1.0 - 0.28 * dot(bend, bend);
  vec3 p = vec3(xz.x, gi.x, xz.y) + vec3(bend.x, t * droop, bend.y) * height;
  p += vec3(-dir.y, 0.0, dir.x) * position.x * width * (1.0 - t * 0.85);

  // Lighting per vertex: sun through and onto the blade, sky from above, dark at the root.
  vec3 base = vec3(xz.x, gi.x + 0.15, xz.y);
  vec3 V = normalize(cameraPosition - p);
  float vis = sunVisibility(base + uSunDir * 0.3);
  vec3 root = vec3(0.035, 0.07, 0.015), tip = mix(vec3(0.1, 0.21, 0.03), vec3(0.24, 0.27, 0.07), smoothstep(0.45, 0.85, gi.w + rr.x * 0.3));
  vec3 alb = mix(root, tip, t) * mix(vec3(0.82, 0.9, 0.8), vec3(1.16, 1.08, 0.94), gi.z);
  vec3 N = normalize(vec3(bend.x * 0.6, 1.0, bend.y * 0.6));
  float ndl = saturate(dot(N, uSunDir)) * 0.55 + 0.25;
  float back = pow(saturate(dot(-V, uSunDir)), 2.0) * t;
  vec3 col = alb * uSunColor * 0.3183 * vis * (ndl + back * 1.3);
  col += alb * shIrradiance(vec3(0.0, 1.0, 0.0)) * mix(0.3, 1.0, t);
  vColor = col;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const GRASS_FRAG = /* glsl */ `
in vec3 vColor;
void main() { gl_FragColor = vec4(vColor, 1.0); }`;

const FLOWER_VERT = /* glsl */ `
${COMMON}
${SKYMAP}
${SKY_SAMPLE}
${SH_GLSL}
${TERRAIN_SAMPLING}
${LIGHTING}
${PLACE}
in vec4 iBlade;
out vec3 vLight; out vec3 vTint; out vec3 vUvl; out float vBack;
void main() {
  vec3 origin = modelMatrix[3].xyz;
  vec2 xz = origin.xz + iBlade.xy;
  vec4 gi = groundInfo(xz);
  vec3 rr = hash32(xz * 2.31);
  // Flowers gather in drifts; a few strays grow everywhere.
  float drift = smoothstep(0.5, 0.68, textureLod(uNoise, xz / 73.0 + 0.6, 0.0).b);
  float want = max(drift, 0.06);
  float dist = distance(vec3(xz.x, gi.x, xz.y), cameraPosition);
  float fade = 1.0 - smoothstep(uFadeDist * 0.75, uFadeDist, dist);
  if (gi.y < 0.5 || iBlade.z > want || fade < 0.02) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

  // Colour families share whole drifts: lupin, poppy, daisy, bellflower.
  float fam = fract(textureLod(uNoise, xz / 131.0 + 0.2, 0.0).g * 3.7 + rr.z * 0.25);
  float layer = fam < 0.34 ? 5.0 : fam < 0.6 ? 7.0 : fam < 0.82 ? 6.0 : 8.0;
  float size = (layer == 5.0 ? 0.62 + 0.4 * rr.x : 0.38 + 0.3 * rr.x) * fade;
  float yaw = rr.y * 6.2831853 + position.z * 1.5708;      // second card at right angles
  vec2 dir = vec2(cos(yaw), sin(yaw));
  float t = position.y;
  vec2 bend = windBend(xz, 0.6) * t * t * 0.5;
  vec3 p = vec3(xz.x, gi.x - 0.03, xz.y) + vec3(dir.x * position.x * 0.5, t, dir.y * position.x * 0.5) * size + vec3(bend.x, 0.0, bend.y);

  vTint = vec3(0.9 + 0.2 * rr.z);
  vUvl = vec3(position.x * 0.5 + 0.5, t, layer);
  vec3 base = vec3(xz.x, gi.x + 0.2, xz.y);
  vec3 V = normalize(cameraPosition - p);
  float vis = sunVisibility(base + uSunDir * 0.3);
  vLight = uSunColor * 0.3183 * vis * 0.75 + shIrradiance(vec3(0.0, 1.0, 0.0)) * mix(0.45, 1.0, t);
  vBack = pow(saturate(dot(-V, uSunDir)), 2.0) * vis;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const FLOWER_FRAG = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray uLeaves;
uniform vec3 uSunColor;
in vec3 vLight; in vec3 vTint; in vec3 vUvl; in float vBack;
void main() {
  vec4 t = texture(uLeaves, vUvl);
  if (t.a < 0.42) discard;
  vec3 alb = t.rgb * vTint;
  gl_FragColor = vec4(alb * (vLight + uSunColor * 0.3183 * vBack * 0.7), 1.0);
}`;

export class GroundCover {
  constructor(pipe, terrain, leafAtlas, wind, opts = {}) {
    this.pipe = pipe;
    this.radius = opts.radius ?? 72;
    this.n = Math.ceil((this.radius * 2) / CELL);
    const rnd = mulberry32(4242);
    const D = pipe.depthDefines;
    this.fade = { value: this.radius };
    const uniforms = {
      ...pipe.lit(), uNCore: terrain.surfaceUniforms.uNCore, uNoise: terrain.surfaceUniforms.uNoise,
      uWind: { value: wind }, uFadeDist: this.fade,
    };

    // One clump = three tapered blades of five vertices each.
    const pos = [], idx = [];
    for (let b = 0; b < 3; b++) {
      const o = b * 5;
      pos.push(-1, 0, b, 1, 0, b, -1, 0.5, b, 1, 0.5, b, 0, 1, b);
      idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2, o + 2, o + 3, o + 4);
    }
    const perCell = Math.round(CELL * CELL * (opts.density ?? 10));
    const inst = new Float32Array(perCell * 4);
    for (let i = 0; i < perCell; i++) inst.set([rnd() * CELL, rnd() * CELL, rnd(), rnd()], i * 4);
    const instAttr = new THREE.InstancedBufferAttribute(inst, 4);
    const mkGeo = (count) => {
      const g = new THREE.InstancedBufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.setAttribute('iBlade', instAttr);
      g.instanceCount = count;
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(CELL / 2, 0, CELL / 2), CELL);
      return g;
    };
    this.grassGeo = [mkGeo(perCell), mkGeo(Math.round(perCell * 0.4)), mkGeo(Math.round(perCell * 0.16))];
    this.grassMat = new THREE.ShaderMaterial({ vertexShader: GRASS_VERT, fragmentShader: GRASS_FRAG, uniforms, defines: D, side: THREE.DoubleSide });

    // Flower bunch = two crossed cards.
    const fpos = [], fidx = [];
    for (let c = 0; c < 2; c++) {
      const o = c * 4;
      fpos.push(-1, 0, c, 1, 0, c, 1, 1, c, -1, 1, c);
      fidx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    }
    const fCount = Math.round(CELL * CELL * (opts.flowerDensity ?? 1.6));
    const finst = new Float32Array(fCount * 4);
    for (let i = 0; i < fCount; i++) finst.set([rnd() * CELL, rnd() * CELL, rnd(), rnd()], i * 4);
    const fg = new THREE.InstancedBufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(fpos, 3));
    fg.setIndex(fidx);
    fg.setAttribute('iBlade', new THREE.InstancedBufferAttribute(finst, 4));
    fg.instanceCount = fCount;
    fg.boundingSphere = new THREE.Sphere(new THREE.Vector3(CELL / 2, 0, CELL / 2), CELL);
    this.flowerMat = new THREE.ShaderMaterial({
      vertexShader: FLOWER_VERT, fragmentShader: FLOWER_FRAG, defines: D, side: THREE.DoubleSide,
      uniforms: { ...uniforms, uLeaves: { value: leafAtlas } },
    });

    this.group = new THREE.Group();
    this.cells = [];
    for (let j = 0; j < this.n; j++) for (let i = 0; i < this.n; i++) {
      const grass = new THREE.Mesh(this.grassGeo[0], this.grassMat);
      const flowers = new THREE.Mesh(fg, this.flowerMat);
      this.group.add(grass, flowers);
      this.cells.push({ i, j, grass, flowers });
    }
    this.terrain = terrain;
  }

  update(camera) {
    const cam = _v.setFromMatrixPosition(camera.matrixWorld);
    const n = this.n, bi = Math.floor(cam.x / CELL) - (n >> 1), bj = Math.floor(cam.z / CELL) - (n >> 1);
    for (const c of this.cells) {
      // Each mesh always serves the cells congruent to its index, so nothing ever reshuffles.
      const ci = bi + ((((c.i - bi) % n) + n) % n), cj = bj + ((((c.j - bj) % n) + n) % n);
      const x = ci * CELL, z = cj * CELL;
      const cx = x + CELL / 2, cz = z + CELL / 2;
      const y = this.terrain.heightAt(cx, cz);
      const d = Math.hypot(cx - cam.x, cz - cam.z, y - cam.y);
      const vis = d < this.radius + CELL && y > 0.5;
      c.grass.visible = c.flowers.visible = vis;
      if (!vis) continue;
      c.grass.geometry = this.grassGeo[d < 30 ? 0 : d < 52 ? 1 : 2];
      for (const m of [c.grass, c.flowers]) {
        m.position.set(x, y, z);
        m.updateMatrixWorld();
      }
    }
  }
}

const _v = new THREE.Vector3();
