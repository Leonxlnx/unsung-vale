// Stone, gold, tile and glass for the architecture, baked by the TextureForge, plus the
// shader that applies them with world-space triplanar mapping and weathering.
import * as THREE from 'three';
import { COMMON, SKYMAP } from '../../engine/glsl.js';
import { SKY_SAMPLE, SH_GLSL } from '../../engine/sky.js';
import { LIGHTING } from '../../engine/lighting.js';
import { TextureForge } from '../../engine/forge.js';
import { TERRAIN_SAMPLING } from '../terrain.js';

const ashlar = /* glsl */ `
// Coursed limestone blocks in running bond.
void material(vec2 uv, out float h, out vec3 col, out float rough) {
  const float rows = 6.0, nb = 3.0;
  float y = uv.y * rows, row = floor(y), fy = fract(y);
  float x = uv.x * nb + hash12(vec2(row, 7.0)), bx = floor(x), fx = fract(x);
  float id = hash12(vec2(mod(bx, nb), row)), id2 = hash12(vec2(mod(bx, nb) + 9.0, row + 3.0));
  float dx = min(fx, 1.0 - fx) / nb, dy = min(fy, 1.0 - fy) / rows;
  float edge = min(dx, dy);
  float joint = smoothstep(0.0, 0.0045, edge);
  float face = pfbm(uv, vec2(24.0), 4, 3.0), fine = pfbm(uv, vec2(90.0), 3, 5.0);
  float chips = smoothstep(0.55, 0.8, pfbm(uv, vec2(38.0), 3, 11.0)) * (1.0 - smoothstep(0.0, 0.02, edge));
  h = joint * (0.55 + 0.22 * id + 0.14 * face + 0.05 * fine) * (0.86 + 0.14 * smoothstep(0.0, 0.03, edge)) * (1.0 - 0.5 * chips);
  vec3 base = mix(srgb(0.87, 0.84, 0.77), srgb(0.79, 0.75, 0.67), id);
  base = mix(base, srgb(0.92, 0.89, 0.83), id2 * 0.5) * (0.9 + 0.2 * face);
  base = mix(base, base * vec3(0.8, 0.77, 0.7), smoothstep(0.5, 0.8, pfbm(uv, vec2(5.0, 2.0), 4, 9.0)));
  col = mix(srgb(0.6, 0.57, 0.5), base, joint);
  rough = mix(0.95, 0.72 + 0.12 * face, joint);
}`;

const marble = /* glsl */ `
void material(vec2 uv, out float h, out vec3 col, out float rough) {
  float warp = pfbm(uv, vec2(3.0), 4, 1.0);
  float veins = pridge(uv + 0.08 * warp, vec2(3.0), 4, 2.0);
  float fineVeins = pridge(uv + 0.05 * warp, vec2(9.0), 3, 5.0);
  float cloud = pfbm(uv, vec2(5.0), 4, 7.0), grain = pfbm(uv, vec2(120.0), 3, 9.0);
  float v = smoothstep(0.86, 0.99, veins) * 0.55 + smoothstep(0.9, 0.99, fineVeins) * 0.3;
  h = 0.6 + 0.08 * cloud - 0.1 * v + 0.03 * grain;
  col = mix(srgb(0.93, 0.91, 0.86), srgb(0.86, 0.83, 0.77), cloud);
  col = mix(col, srgb(0.7, 0.66, 0.58), v * 0.5) * (0.96 + 0.08 * grain);
  rough = 0.34 + 0.2 * cloud + 0.2 * v;
}`;

const gold = /* glsl */ `
void material(vec2 uv, out float h, out vec3 col, out float rough) {
  vec4 dimple = pworley(uv, vec2(26.0), 1.0);
  float brush = pfbm(uv, vec2(6.0, 140.0), 3, 2.0), cloud = pfbm(uv, vec2(5.0), 4, 3.0);
  h = 0.5 + 0.25 * smoothstep(0.0, 0.6, dimple.x) + 0.1 * brush;
  float tarnish = smoothstep(0.55, 0.85, cloud);
  col = mix(srgb(1.0, 0.8, 0.42), srgb(0.98, 0.7, 0.3), brush);
  col = mix(col, srgb(0.62, 0.42, 0.2), tarnish * 0.5);
  rough = 0.26 + 0.14 * brush + 0.25 * tarnish;
}`;

const roof = /* glsl */ `
// Overlapping scale tiles in weathered slate blue.
void material(vec2 uv, out float h, out vec3 col, out float rough) {
  const float rows = 10.0, cols = 8.0;
  float y = uv.y * rows, row = floor(y), fy = fract(y);
  float x = uv.x * cols + 0.5 * mod(row, 2.0), cx = floor(x), fx = fract(x) - 0.5;
  float id = hash12(vec2(mod(cx, cols), row));
  // Rounded lower edge of each tile; the row above overlaps the top.
  float tip = 1.0 - smoothstep(0.42, 0.5, length(vec2(fx, (0.5 - fy) * 0.8 + 0.1)));
  float lap = smoothstep(0.0, 0.12, fy);
  float fine = pfbm(uv, vec2(60.0), 3, 2.0);
  h = (0.3 + 0.6 * (1.0 - fy)) * mix(0.45, 1.0, tip) * lap + 0.05 * fine;
  col = mix(srgb(0.42, 0.47, 0.5), srgb(0.55, 0.58, 0.58), id) * (0.8 + 0.3 * fine);
  col = mix(col, srgb(0.5, 0.6, 0.5), smoothstep(0.6, 0.9, pfbm(uv, vec2(4.0), 3, 5.0)) * 0.3);
  col *= mix(0.5, 1.0, tip * lap);
  rough = 0.55 + 0.2 * fine;
}`;

const paving = /* glsl */ `
// Coursed flagstones: long slabs of uneven width laid in rows, with fine joints that hold a
// little moss, worn smooth along the middle of each stone.
void material(vec2 uv, out float h, out vec3 col, out float rough) {
  const float rows = 5.0;
  float y = uv.y * rows, row = floor(y), fy = fract(y);
  // Each row is cut into stones of three widths; the cuts shift from row to row.
  float x = uv.x * 2.0 + hash12(vec2(row, 3.0)) * 2.0, cell = floor(x), fx = fract(x);
  float split = 0.34 + 0.32 * hash12(vec2(mod(cell, 2.0), row));
  float left = step(fx, split);
  float sx = left > 0.5 ? fx / split : (fx - split) / (1.0 - split), wx = left > 0.5 ? split : 1.0 - split;
  vec2 id = vec2(mod(cell, 2.0) * 2.0 + left, row);
  float r1 = hash12(id + 0.37), r2 = hash12(id * 1.7 + 5.1);
  float dx = min(sx, 1.0 - sx) * wx / 2.0, dy = min(fy, 1.0 - fy) / rows;
  float wob = 0.0012 * (pfbm(uv, vec2(40.0), 2, 9.0) - 0.5);
  float edge = min(dx, dy) + wob;
  float joint = smoothstep(0.0012, 0.0042, edge);
  float bevel = smoothstep(0.0, 0.016, edge);
  float face = pfbm(uv, vec2(26.0), 4, 4.0), fine = pfbm(uv, vec2(110.0), 3, 5.0);
  float pit = smoothstep(0.62, 0.8, pfbm(uv, vec2(48.0), 3, 13.0));
  h = joint * (0.62 + 0.1 * r1 + 0.1 * face + 0.04 * fine - 0.1 * pit) * (0.86 + 0.14 * bevel);
  vec3 base = mix(srgb(0.8, 0.77, 0.71), srgb(0.68, 0.66, 0.62), r1);
  base = mix(base, srgb(0.74, 0.68, 0.58), step(0.8, r2) * 0.7);
  base *= (0.9 + 0.2 * face) * (0.96 + 0.08 * fine) * (1.0 - 0.12 * pit);
  base = mix(base, base * vec3(0.84, 0.86, 0.78), smoothstep(0.5, 0.8, pfbm(uv, vec2(3.0), 4, 8.0)));
  vec3 gap = mix(srgb(0.27, 0.25, 0.2), srgb(0.2, 0.3, 0.11), smoothstep(0.4, 0.7, pfbm(uv, vec2(9.0), 3, 6.0)));
  col = mix(gap, base, joint);
  // Feet have polished the middle of each stone; the margins stay matt.
  rough = mix(0.95, 0.8 - 0.22 * bevel * (1.0 - pit), joint);
}`;

const frieze = /* glsl */ `
// Carved band: interlaced waves between two beads, repeating along u.
void material(vec2 uv, out float h, out vec3 col, out float rough) {
  float x = uv.x * 8.0, y = uv.y;
  float w1 = abs(y - (0.5 + 0.2 * sin(x * 6.2831853))), w2 = abs(y - (0.5 - 0.2 * sin(x * 6.2831853)));
  float strand = max(1.0 - smoothstep(0.03, 0.09, w1), 1.0 - smoothstep(0.03, 0.09, w2));
  vec2 c = vec2(fract(x * 2.0 + 0.5) - 0.5, (y - 0.5) * 2.0);
  float rosette = 1.0 - smoothstep(0.12, 0.2, length(c * vec2(1.0, 0.5)));
  float bead = max(1.0 - smoothstep(0.02, 0.05, abs(y - 0.1)), 1.0 - smoothstep(0.02, 0.05, abs(y - 0.9)));
  float grain = pfbm(uv, vec2(60.0), 3, 2.0);
  h = 0.35 + 0.4 * max(strand, rosette * 0.8) + 0.3 * bead + 0.04 * grain;
  col = mix(srgb(0.8, 0.77, 0.7), srgb(0.92, 0.9, 0.85), h) * (0.94 + 0.12 * grain);
  rough = 0.6;
}`;

const glass = /* glsl */ `
// Leaded lancet glazing: warm panes in a diamond lattice. Brightness doubles as the glow mask.
void material(vec2 uv, out float h, out vec3 col, out float rough) {
  vec2 p = vec2(uv.x * 6.0, uv.y * 6.0);
  vec2 d = vec2(p.x + p.y, p.x - p.y);
  vec2 id = floor(d), f = abs(fract(d) - 0.5);
  float lead = 1.0 - smoothstep(0.42, 0.47, max(f.x, f.y));
  float r = hash12(mod(id, 12.0));
  vec3 pane = r < 0.5 ? srgb(1.0, 0.78, 0.42) : r < 0.75 ? srgb(1.0, 0.62, 0.3) : r < 0.9 ? srgb(0.98, 0.9, 0.7) : srgb(0.75, 0.5, 0.42);
  pane *= 0.6 + 0.5 * pfbm(uv, vec2(9.0), 3, 2.0);
  col = mix(srgb(0.08, 0.07, 0.06), pane, lead);
  h = mix(0.8, 0.4, lead);
  rough = mix(0.6, 0.15, lead);
}`;

const dark = /* glsl */ `
// Aged bronze for doors, grilles and lamp frames.
void material(vec2 uv, out float h, out vec3 col, out float rough) {
  float cloud = pfbm(uv, vec2(5.0), 4, 1.0), fine = pfbm(uv, vec2(70.0), 3, 2.0);
  h = 0.5 + 0.2 * fine;
  col = mix(srgb(0.2, 0.15, 0.1), srgb(0.34, 0.25, 0.15), cloud);
  col = mix(col, srgb(0.2, 0.36, 0.3), smoothstep(0.62, 0.85, pfbm(uv, vec2(8.0), 3, 3.0)) * 0.5);
  rough = 0.5 + 0.2 * fine;
}`;

export const ARCH_MATERIALS = [
  { name: 'ashlar', code: ashlar, bump: 5 },
  { name: 'marble', code: marble, bump: 3 },
  { name: 'gold', code: gold, bump: 4 },
  { name: 'roof', code: roof, bump: 10 },
  { name: 'paving', code: paving, bump: 8 },
  { name: 'frieze', code: frieze, bump: 9 },
  { name: 'glass', code: glass, bump: 5 },
  { name: 'dark', code: dark, bump: 4 },
];

const ARCH_VERT = /* glsl */ `
in float aMat;
out vec3 vWorld; out vec3 vNormal; out float vMat;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz; vNormal = normalize(mat3(modelMatrix) * normal); vMat = aMat;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const ARCH_FRAG = /* glsl */ `
${COMMON}
${SKYMAP}
${SKY_SAMPLE}
${SH_GLSL}
${TERRAIN_SAMPLING}
${LIGHTING}
uniform sampler2DArray uArchA;
uniform sampler2DArray uArchB;
uniform sampler2D uNoise;
uniform float uGlow;
in vec3 vWorld; in vec3 vNormal; in float vMat;
const float TILE[8] = float[8](4.2, 3.0, 1.3, 2.6, 3.4, 2.4, 1.7, 2.0);

void main() {
  int m = int(vMat + 0.5);
  vec3 N = normalize(vNormal);
  float dist = distance(vWorld, cameraPosition);
  vec3 V = (cameraPosition - vWorld) / dist;
  vec3 w = pow(abs(N), vec3(5.0));
  w /= w.x + w.y + w.z;
  float tile = TILE[m];
  vec3 p = vWorld / tile;
  vec4 A = vec4(0.0), B = vec4(0.0);
  vec3 Nd = vec3(0.0);
  float layer = float(m);
  // Masonry seen from above is paved rather than coursed.
  float topLayer = (m == 0) ? 4.0 : layer;
  if (w.x > 0.02) {
    vec2 uv = p.zy;
    vec4 a = textureGrad(uArchA, vec3(uv, layer), dFdx(uv), dFdy(uv)), b = textureGrad(uArchB, vec3(uv, layer), dFdx(uv), dFdy(uv));
    A += a * w.x; B += b * w.x;
    vec2 t = b.rg * 2.0 - 1.0; Nd += w.x * vec3(0.0, t.y, t.x);
  }
  if (w.z > 0.02) {
    vec2 uv = p.xy;
    vec4 a = textureGrad(uArchA, vec3(uv, layer), dFdx(uv), dFdy(uv)), b = textureGrad(uArchB, vec3(uv, layer), dFdx(uv), dFdy(uv));
    A += a * w.z; B += b * w.z;
    vec2 t = b.rg * 2.0 - 1.0; Nd += w.z * vec3(t.x, t.y, 0.0);
  }
  if (w.y > 0.02) {
    vec2 uv = p.xz * (m == 0 ? 0.84 : 1.0);
    vec4 a = textureGrad(uArchA, vec3(uv, topLayer), dFdx(uv), dFdy(uv)), b = textureGrad(uArchB, vec3(uv, topLayer), dFdx(uv), dFdy(uv));
    A += a * w.y; B += b * w.y;
    vec2 t = b.rg * 2.0 - 1.0; Nd += w.y * vec3(t.x, 0.0, t.y);
  }
  float wsum = (w.x > 0.02 ? w.x : 0.0) + (w.z > 0.02 ? w.z : 0.0) + (w.y > 0.02 ? w.y : 0.0);
  A /= wsum; B /= wsum; Nd /= wsum;
  vec3 Ns = normalize(N + Nd * 0.85);

  vec3 alb = A.rgb;
  float rough = B.b, metal = 0.0, ao = B.a;
  bool stone = m == 0 || m == 1 || m == 4 || m == 5;
  if (stone || m == 3) {
    // Weathering: damp and moss near the ground, rain streaks down walls, broad tone drift.
    float above = vWorld.y - terrainHeight(vWorld.xz);
    vec4 n1 = texture(uNoise, vWorld.xz / 63.0 + vWorld.y * 0.013);
    vec4 n2 = texture(uNoise, vec2(dot(vWorld.xz, vec2(0.19, 0.23)), vWorld.y * 0.021));
    // Floors people walk on stay cleaner than the foot of a wall.
    float floorK = 1.0 - 0.75 * smoothstep(0.5, 0.9, N.y);
    float damp = (1.0 - smoothstep(0.0, 7.0, above)) * (0.45 + 0.55 * n1.r) * floorK;
    float streak = smoothstep(0.5, 0.78, n2.g) * (1.0 - abs(N.y)) * 0.3;
    alb *= mix(vec3(0.92, 0.9, 0.86), vec3(1.06, 1.04, 1.0), n1.a);
    alb *= 1.0 - streak;
    alb = mix(alb, alb * vec3(0.62, 0.6, 0.5), damp * 0.7);
    float moss = smoothstep(0.58, 0.78, n1.g + damp * 0.4) * (1.0 - smoothstep(4.0, 26.0, above)) * 0.7 * floorK;
    alb = mix(alb, vec3(0.07, 0.11, 0.03) * (0.6 + n1.b), moss);
    rough = mix(rough, 0.95, moss);
    ao *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 2.5, above));
  }
  if (m == 2) metal = 1.0;
  if (m == 7) metal = 0.6;

  float vis = sunVisibility(vWorld + N * 0.12 + uSunDir * 0.12);
  vec3 col = shadeSurface(alb, rough, metal, Ns, V, vis, ao, 0.0);
  if (m == 6) {
    // Lit interiors: the glazing glows warm at dusk.
    // Not every room is lit: each window gets its own brightness, and some stay dark.
    float lit = hash12(floor(vWorld.xz * 0.21) + floor(vWorld.y * 0.09));
    col = col * 0.5 + A.rgb * vec3(1.0, 0.7, 0.4) * uGlow * smoothstep(0.3, 0.75, lit) * (0.5 + 0.9 * lit);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export function createArchMaterial(pipe, terrain) {
  const layers = new TextureForge(pipe.renderer).bake(ARCH_MATERIALS, 1024);
  const mat = new THREE.ShaderMaterial({
    vertexShader: ARCH_VERT, fragmentShader: ARCH_FRAG, defines: pipe.depthDefines,
    uniforms: {
      ...pipe.lit(), uArchA: { value: layers.a }, uArchB: { value: layers.b },
      uNoise: terrain.surfaceUniforms.uNoise, uGlow: { value: 3.2 },
    },
  });
  mat.userData.layers = layers;
  return mat;
}
