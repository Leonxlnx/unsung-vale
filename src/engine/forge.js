// TextureForge: bakes tileable PBR texture layers on the GPU from GLSL material functions.
// Nothing is loaded from disk; every surface in the game comes out of these shaders.
//
// Each material is a GLSL snippet defining
//   void material(vec2 uv, out float h, out vec3 col, out float rough)
// with uv in [0,1) and all noise periodic so the result tiles. Two array textures come out:
//   A: rgb = albedo (sRGB encoded), a = height
//   B: rg = tangent-space normal xy, b = roughness, a = ambient occlusion
import * as THREE from 'three';
import { FullscreenPass } from './fullscreen.js';

export const FORGE_LIB = /* glsl */ `
#define PI 3.14159265359
#define saturate(x) clamp(x, 0.0, 1.0)
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec3 hash32(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yzz) * p3.zyx); }

// Periodic gradient noise, roughly [-1, 1]. per is the lattice period (use the frequency).
float pgn(vec2 p, vec2 per, float seed) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 ga = hash22(mod(i, per) + seed) * 2.0 - 1.0, gb = hash22(mod(i + vec2(1, 0), per) + seed) * 2.0 - 1.0;
  vec2 gc = hash22(mod(i + vec2(0, 1), per) + seed) * 2.0 - 1.0, gd = hash22(mod(i + vec2(1, 1), per) + seed) * 2.0 - 1.0;
  float a = dot(ga, f), b = dot(gb, f - vec2(1, 0)), c = dot(gc, f - vec2(0, 1)), d = dot(gd, f - vec2(1, 1));
  return 1.6 * mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// fbm in [0,1]. freq is a vec2 so noise can be stretched and still tile.
float pfbm(vec2 uv, vec2 freq, int oct, float seed) {
  float a = 0.5, s = 0.0, n = 0.0;
  for (int i = 0; i < oct; i++) { s += a * pgn(uv * freq, freq, seed + float(i) * 19.7); n += a; freq *= 2.0; a *= 0.5; }
  return s / n * 0.5 + 0.5;
}
float pridge(vec2 uv, vec2 freq, int oct, float seed) {
  float a = 0.5, s = 0.0, n = 0.0;
  for (int i = 0; i < oct; i++) { float v = 1.0 - abs(pgn(uv * freq, freq, seed + float(i) * 13.1)); s += a * v * v; n += a; freq *= 2.0; a *= 0.5; }
  return s / n;
}
// Periodic cellular noise: x = F1, y = F2, z = cell id, w = second hash of the cell.
vec4 pworley(vec2 uv, vec2 freq, float seed) {
  vec2 p = uv * freq, i = floor(p), f = fract(p);
  float f1 = 9.0, f2 = 9.0; vec2 idc = vec2(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y));
    vec2 c = mod(i + o, freq);
    vec2 r = o + hash22(c + seed * 7.7) - f;
    float d = dot(r, r);
    if (d < f1) { f2 = f1; f1 = d; idc = c; } else if (d < f2) f2 = d;
  }
  return vec4(sqrt(f1), sqrt(f2), hash12(idc + seed * 3.3), hash12(idc * 1.7 + seed * 9.1 + 4.0));
}
// Vector from p to the closest cell point plus that cell's id, for placing shapes per cell.
vec4 pcell(vec2 uv, vec2 freq, float seed) {
  vec2 p = uv * freq, i = floor(p), f = fract(p);
  float f1 = 9.0; vec2 best = vec2(0.0), idc = vec2(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y));
    vec2 c = mod(i + o, freq);
    vec2 r = o + hash22(c + seed * 7.7) - f;
    float d = dot(r, r);
    if (d < f1) { f1 = d; best = r; idc = c; }
  }
  return vec4(best, hash12(idc + seed * 3.3), hash12(idc * 1.7 + seed * 9.1 + 4.0));
}
float remap01(float v, float a, float b) { return saturate((v - a) / (b - a)); }
vec3 srgb(float r, float g, float b) { return pow(vec3(r, g, b), vec3(2.2)); }
`;

const PASS_A = (code) => /* glsl */ `
${FORGE_LIB}
${code}
void main() {
  float h; vec3 col; float rough;
  material(vUv, h, col, rough);
  outColor = vec4(max(col, 0.0), saturate(h));
}`;

const PASS_B = (code) => /* glsl */ `
${FORGE_LIB}
${code}
uniform sampler2DArray uA;
uniform float uLayer;
uniform float uBump;
uniform float uRes;
float H(vec2 uv) { return textureLod(uA, vec3(uv, uLayer), 0.0).a; }
void main() {
  float h; vec3 col; float rough;
  material(vUv, h, col, rough);
  float e = 1.0 / uRes;
  float hl = H(vUv - vec2(e, 0.0)), hr = H(vUv + vec2(e, 0.0)), hd = H(vUv - vec2(0.0, e)), hu = H(vUv + vec2(0.0, e));
  vec3 n = normalize(vec3((hl - hr) * uBump, (hd - hu) * uBump, 1.0));
  // Cavity occlusion: how far this texel sits below a ring of neighbours.
  float occ = 0.0;
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 0.5236;
    float r = (i % 2 == 0) ? 5.0 : 13.0;
    occ += max(H(vUv + vec2(cos(a), sin(a)) * r * e) - h, 0.0);
  }
  float ao = saturate(1.0 - occ / 12.0 * uBump * 0.9);
  outColor = vec4(n.xy * 0.5 + 0.5, saturate(rough), ao);
}`;

export class TextureForge {
  constructor(renderer) { this.renderer = renderer; }

  // materials: [{ name, code, bump }]. Returns { a, b, index } with array textures.
  bake(materials, size = 1024) {
    const r = this.renderer, n = materials.length;
    const mk = (srgb) => {
      const rt = new THREE.WebGLArrayRenderTarget(size, size, n, { depthBuffer: false });
      const t = rt.texture;
      t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = true;
      t.anisotropy = Math.min(8, r.capabilities.getMaxAnisotropy());
      return rt;
    };
    const A = mk(true), B = mk(false);
    const index = {};
    materials.forEach((m, i) => {
      index[m.name] = i;
      const pa = new FullscreenPass({ fragment: PASS_A(m.code) });
      r.setRenderTarget(A, i);
      r.render(pa.mesh, _cam);
      pa.dispose();
    });
    materials.forEach((m, i) => {
      const pb = new FullscreenPass({ fragment: PASS_B(m.code), uniforms: { uA: { value: A.texture }, uLayer: { value: i }, uBump: { value: m.bump ?? 6 }, uRes: { value: size } } });
      r.setRenderTarget(B, i);
      r.render(pb.mesh, _cam);
      pb.dispose();
    });
    r.setRenderTarget(null);
    return { a: A.texture, b: B.texture, index, targets: [A, B] };
  }
}

const _cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
