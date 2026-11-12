// Bakes leaf and blossom cluster textures (one array layer per species) on the GPU.
// Each layer is a card's worth of overlapping leaves drawn from signed-distance shapes.
import * as THREE from 'three';
import { FullscreenPass } from '../../engine/fullscreen.js';

const CLUSTER = /* glsl */ `
uniform int uKind;
#define saturate(x) clamp(x, 0.0, 1.0)
float h1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
vec3 srgb(float r, float g, float b) { return pow(vec3(r, g, b), vec3(2.2)); }
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

// Each shape returns colour in rgb and coverage in a. p is in leaf space, roughly -1..1.
vec4 maple(vec2 p, float id) {
  float a = atan(p.y, p.x), r = length(p);
  float lobes = 0.5 + 0.5 * cos(a * 5.0);
  float edge = (0.36 + 0.64 * pow(lobes, 1.7)) * (1.0 - 0.1 * abs(sin(a * 20.0)));
  float cov = 1.0 - smoothstep(edge - 0.06, edge, r);
  vec3 c = id < 0.7 ? mix(srgb(0.4, 0.045, 0.06), srgb(0.7, 0.12, 0.08), id * 1.43) : mix(srgb(0.8, 0.3, 0.09), srgb(0.6, 0.09, 0.1), id);
  float vein = 1.0 - smoothstep(0.0, 0.05, abs(sin(a * 2.5)) * r);
  c = mix(c, c * 1.5 + 0.03, vein * 0.5);
  c *= 0.62 + 0.5 * r;
  return vec4(c, cov);
}
vec4 ovate(vec2 p, float id, vec3 cA, vec3 cB, float aspect) {
  float x = p.x * 0.5 + 0.5;
  float w = aspect * sin(3.14159 * pow(saturate(x), 0.75));
  float cov = (1.0 - smoothstep(w - 0.06, w, abs(p.y))) * step(0.0, x) * step(x, 1.0);
  vec3 c = mix(cA, cB, id);
  float mid = 1.0 - smoothstep(0.0, 0.04, abs(p.y));
  float side = 1.0 - smoothstep(0.0, 0.03, abs(fract(x * 6.0 - abs(p.y) * 2.0) - 0.5) - 0.42);
  c = mix(c, c * 1.5 + 0.02, max(mid, side * 0.4) * 0.45);
  c *= 0.7 + 0.5 * abs(p.y) / max(w, 0.05);
  return vec4(c, cov);
}
vec4 flower(vec2 p, float id, vec3 petal, vec3 heart, float n) {
  float a = atan(p.y, p.x), r = length(p);
  float edge = 0.5 + 0.5 * pow(abs(cos(a * n * 0.5)), 0.45);
  float cov = 1.0 - smoothstep(edge - 0.1, edge, r);
  vec3 c = mix(heart, petal, smoothstep(0.08, 0.5, r));
  c = mix(c, vec3(1.0), smoothstep(0.55, 0.95, r) * 0.35);
  c = mix(srgb(0.98, 0.85, 0.3), c, smoothstep(0.06, 0.13, r));
  c *= 0.85 + 0.25 * id;
  return vec4(c, cov);
}

// Whole flowering plants for the meadow (kinds 5-8): stems rising from the bottom centre of
// the card, a few leaves, and blooms. p is the card uv.
vec4 plant(vec2 uv, int kind) {
  vec3 col = vec3(0.0); float alpha = 0.0;
  float k = float(kind) * 13.0;
  int stems = kind == 5 ? 3 : kind == 6 ? 7 : kind == 7 ? 4 : 6;
  vec3 green = srgb(0.2, 0.36, 0.1), green2 = srgb(0.3, 0.46, 0.14);
  // Basal leaves: a tuft of narrow blades.
  for (int i = 0; i < 9; i++) {
    float fi = float(i) + k;
    float ang = 1.5708 + (h1(fi * 2.3) - 0.5) * 2.0;
    vec2 q = rot(-ang) * (uv - vec2(0.5 + (h1(fi * 4.1) - 0.5) * 0.1, 0.0)) / (0.24 + 0.2 * h1(fi * 6.7));
    vec4 l = ovate(q * 2.0 - vec2(1.0, 0.0), h1(fi), green, green2, 0.16);
    col = mix(col * (1.0 - 0.25 * l.a), l.rgb, l.a); alpha = max(alpha, l.a);
  }
  for (int i = 0; i < 7; i++) {
    if (i >= stems) break;
    float fi = float(i) + k;
    vec2 base = vec2(0.5 + (h1(fi * 1.3) - 0.5) * 0.08, 0.0);
    float spread = kind == 5 ? 0.3 : 0.74, lo = kind == 5 ? 0.78 : 0.42;
    vec2 top = vec2(0.5 + (h1(fi * 3.1) - 0.5) * spread, lo + (0.93 - lo) * h1(fi * 5.7));
    float bend = (h1(fi * 7.9) - 0.5) * 0.12;
    float t = clamp((uv.y - base.y) / (top.y - base.y), 0.0, 1.0);
    float sx = mix(base.x, top.x, t) + sin(t * 3.14159) * bend;
    float stem = (1.0 - smoothstep(0.005, 0.011, abs(uv.x - sx))) * step(uv.y, top.y);
    col = mix(col, green * 0.8, stem); alpha = max(alpha, stem);
    if (kind == 5) {
      // Lupin-like spike: florets packed up the top half of the stem, smaller toward the tip.
      for (int j = 0; j < 14; j++) {
        float tj = 0.42 + 0.58 * float(j) / 13.0;
        vec2 c = vec2(mix(base.x, top.x, tj) + sin(tj * 3.14159) * bend + (mod(float(j), 2.0) - 0.5) * 0.05 * (1.2 - tj), mix(base.y, top.y, tj));
        float s = 0.05 * (1.25 - tj * 0.75);
        vec4 f = flower((uv - c) / s, h1(fi + float(j)), mix(srgb(0.58, 0.44, 0.9), srgb(0.42, 0.32, 0.8), h1(float(j) * 1.7 + fi)), srgb(0.3, 0.2, 0.6), 4.0);
        col = mix(col, f.rgb, f.a); alpha = max(alpha, f.a);
      }
    } else {
      float s = kind == 6 ? 0.075 : kind == 7 ? 0.11 : 0.062;
      vec3 petal = kind == 6 ? srgb(0.97, 0.96, 0.92) : kind == 7 ? mix(srgb(0.93, 0.36, 0.46), srgb(0.86, 0.22, 0.26), h1(fi * 9.3)) : srgb(0.98, 0.78, 0.22);
      vec3 heart = kind == 6 ? srgb(0.95, 0.75, 0.2) : kind == 7 ? srgb(0.25, 0.08, 0.1) : srgb(0.85, 0.5, 0.1);
      vec4 f = flower(rot(h1(fi * 11.0) * 6.283) * (uv - top) / s, h1(fi * 2.1), petal, heart, kind == 6 ? 9.0 : kind == 7 ? 5.0 : 6.0);
      col = mix(col, f.rgb, f.a); alpha = max(alpha, f.a);
    }
  }
  return vec4(mix(green, col, step(0.01, alpha)), alpha);
}

void main() {
  vec2 uv = vUv;
  if (uKind >= 5) { outColor = plant(uv, uKind); return; }
  vec3 col = vec3(0.0); float alpha = 0.0;
  vec3 mean = vec3(0.1);
  int count = 380; float sMin = 0.034, sMax = 0.056;
  if (uKind == 0) { mean = srgb(0.5, 0.09, 0.07); }
  if (uKind == 1) { count = 420; sMin = 0.026; sMax = 0.044; mean = srgb(0.84, 0.54, 0.62); }
  if (uKind == 2) { count = 460; sMin = 0.022; sMax = 0.036; mean = srgb(0.66, 0.57, 0.8); }
  if (uKind == 3) { count = 240; sMin = 0.08; sMax = 0.14; mean = srgb(0.1, 0.2, 0.09); }
  if (uKind == 4) { count = 380; sMin = 0.034; sMax = 0.056; mean = srgb(0.2, 0.36, 0.1); }
  for (int i = 0; i < 460; i++) {
    if (i >= count) break;
    float fi = float(i) + float(uKind) * 31.0;
    // Leaves sit along a handful of sprigs fanning out from the middle, which gives each
    // card a ragged, gappy outline instead of a disc.
    float sprig = floor(h1(fi * 1.7) * 13.0) + float(uKind) * 17.0;
    float th = h1(sprig * 4.3) * 6.283 + (h1(fi * 2.9) - 0.5) * 0.5;
    float reach = 0.22 + 0.25 * h1(sprig * 7.7);
    float along = pow(h1(fi * 6.1), 0.7);
    vec2 sd = vec2(cos(th), sin(th));
    vec2 c = vec2(0.5) + sd * reach * along + vec2(-sd.y, sd.x) * (h1(fi * 8.3) - 0.5) * 0.15 * (1.0 - 0.4 * along);
    float ang = th + (h1(fi * 3.1) - 0.5) * 2.2;
    float s = mix(sMin, sMax, h1(fi * 5.3));
    float id = h1(fi * 9.1);
    if (uKind == 3) { ang = 1.5708 + (h1(fi * 3.1) - 0.5) * 1.5; c.x = 0.5 + (c.x - 0.5) * 0.8; }
    vec2 q = rot(-ang) * (uv - c) / s;
    if (dot(q, q) > 1.6) continue;
    vec4 l;
    if (uKind == 0) l = maple(q, id);
    else if (uKind == 1) l = id < 0.8 ? flower(q, id, srgb(0.9, 0.56, 0.66), srgb(0.72, 0.22, 0.4), 5.0) : ovate(q, id, srgb(0.32, 0.4, 0.14), srgb(0.5, 0.36, 0.2), 0.3);
    else if (uKind == 2) l = id < 0.86 ? flower(q, id, srgb(0.7, 0.6, 0.86), srgb(0.48, 0.36, 0.74), 4.0) : ovate(q, id, srgb(0.36, 0.5, 0.22), srgb(0.5, 0.58, 0.3), 0.3);
    else if (uKind == 3) l = ovate(q, id, srgb(0.07, 0.17, 0.08), srgb(0.16, 0.3, 0.12), 0.11);
    else l = ovate(q, id, srgb(0.16, 0.33, 0.08), srgb(0.36, 0.5, 0.13), 0.34);
    // Leaves drawn later sit on top and cast a soft darkening on those beneath.
    col = mix(col * (1.0 - 0.3 * l.a), l.rgb, l.a);
    alpha = max(alpha, l.a);
  }
  // Fill the transparent area with the mean colour so mip-maps do not pick up dark fringes.
  outColor = vec4(mix(mean, col, step(0.01, alpha)), alpha);
}`;

export function bakeLeafAtlas(renderer, size = 512) {
  const n = 9;
  const rt = new THREE.WebGLArrayRenderTarget(size, size, n, { depthBuffer: false });
  const t = rt.texture;
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  const pass = new FullscreenPass({ fragment: CLUSTER, uniforms: { uKind: { value: 0 } } });
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  for (let i = 0; i < n; i++) {
    pass.uniforms.uKind.value = i;
    renderer.setRenderTarget(rt, i);
    renderer.render(pass.mesh, cam);
  }
  pass.dispose();
  renderer.setRenderTarget(null);
  return t;
}
