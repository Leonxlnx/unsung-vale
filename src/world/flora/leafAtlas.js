// Bakes leaf and blossom cluster textures (one array layer per species) on the GPU.
// Each layer is a card's worth of overlapping leaves drawn from signed-distance shapes.
// Two textures come out of it: colour with coverage, and a second one that records how each
// leaf leans, folds and overlaps, so every leaf catches the light on its own.
import * as THREE from 'three';
import { FullscreenPass } from '../../engine/fullscreen.js';

const CLUSTER = /* glsl */ `
uniform int uKind;
uniform int uOut;     // 0: colour and coverage. 1: rg = leaf normal tilt, b = thinness, a = 1
#define saturate(x) clamp(x, 0.0, 1.0)
float h1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec3 srgb(float r, float g, float b) { return pow(vec3(r, g, b), vec3(2.2)); }
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

// Each shape returns colour in rgb and coverage in a. p is in leaf space, roughly -1..1.
vec4 maple(vec2 p, float id) {
  float a = atan(p.y, p.x), r = length(p);
  float lobes = 0.5 + 0.5 * cos(a * 5.0);
  float edge = (0.36 + 0.64 * pow(lobes, 1.7)) * (1.0 - 0.1 * abs(sin(a * 20.0)));
  float cov = 1.0 - smoothstep(edge - 0.06, edge, r);
  vec3 c = id < 0.58 ? mix(srgb(0.45, 0.07, 0.05), srgb(0.73, 0.17, 0.07), id * 1.72) : mix(srgb(0.88, 0.45, 0.11), srgb(0.76, 0.25, 0.08), (id - 0.58) * 2.38);
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
  if (uKind >= 5 && uKind <= 8) { vec4 pl = plant(uv, uKind); outColor = uOut == 0 ? pl : vec4(0.5, 0.5, 1.0, 1.0); return; }
  vec3 col = vec3(0.0); float alpha = 0.0, layers = 0.0;
  vec2 nrm = vec2(0.0);
  if (uKind == 9) {
    // Wisteria: racemes hanging from the top edge of the card, each a tapering tail of small
    // flowers, pale where they have opened and deep violet toward the tip.
    for (int i = 0; i < 420; i++) {
      float fi = float(i) + 500.0;
      float rc = floor(h1(fi * 1.7) * 7.0);
      float rx = 0.12 + 0.76 * h1(rc * 5.3 + 1.0), rl = 0.5 + 0.46 * h1(rc * 9.1 + 2.0);
      float t = pow(h1(fi * 6.1), 0.8);
      float wdt = 0.075 * (1.0 - 0.8 * t) + 0.008;
      vec2 c = vec2(rx + (h1(fi * 8.3) - 0.5) * 2.0 * wdt + 0.018 * sin(t * 5.0 + rc * 2.0), 0.985 - t * rl);
      float s = mix(0.034, 0.014, t), id = h1(fi * 9.1), ang = h1(fi * 3.1) * 6.283;
      vec2 q = rot(-ang) * (uv - c) / s;
      if (dot(q, q) > 1.6) continue;
      vec3 pale = mix(srgb(0.8, 0.72, 0.93), srgb(0.66, 0.55, 0.9), id), deep = srgb(0.42, 0.28, 0.66);
      vec4 l = flower(q, id, mix(pale, deep, smoothstep(0.45, 1.0, t)), srgb(0.5, 0.36, 0.72), 4.0);
      float ta = h1(fi * 12.7) * 6.283, tm = 0.12 + 0.5 * h1(fi * 14.3);
      vec2 ln = vec2(cos(ta), sin(ta)) * tm + rot(ang) * q * 0.3;
      col = mix(col * (1.0 - 0.3 * l.a), l.rgb, l.a);
      nrm = mix(nrm, ln, l.a);
      layers += l.a;
      alpha = max(alpha, l.a);
    }
    if (uOut == 0) outColor = vec4(mix(srgb(0.62, 0.52, 0.84), col, step(0.01, alpha)), alpha);
    else outColor = vec4(clamp(nrm * 0.5 + 0.5, 0.0, 1.0), 1.0 / (1.0 + 0.5 * max(layers - 1.0, 0.0)), 1.0);
    return;
  }
  vec3 mean = vec3(0.1);
  int count = 440; float sMin = 0.03, sMax = 0.05;
  if (uKind == 0) { mean = srgb(0.6, 0.16, 0.07); }
  if (uKind == 1) { count = 480; sMin = 0.024; sMax = 0.04; mean = srgb(0.9, 0.68, 0.73); }
  if (uKind == 2) { count = 520; sMin = 0.02; sMax = 0.034; mean = srgb(0.9, 0.84, 0.92); }
  if (uKind == 3) { count = 240; sMin = 0.08; sMax = 0.14; mean = srgb(0.1, 0.2, 0.09); }
  if (uKind == 4) { mean = srgb(0.2, 0.36, 0.1); }
  float kk = float(uKind);
  for (int i = 0; i < 520; i++) {
    if (i >= count) break;
    float fi = float(i) + kk * 31.0;
    vec2 c; float th;
    if (uKind == 3) {
      // Conifer: scale leaves along a handful of sprigs fanning upward.
      float sprig = floor(h1(fi * 1.7) * 13.0) + kk * 17.0;
      th = h1(sprig * 4.3) * 6.283 + (h1(fi * 2.9) - 0.5) * 0.5;
      float reach = 0.22 + 0.25 * h1(sprig * 7.7), along = pow(h1(fi * 6.1), 0.7);
      vec2 sd = vec2(cos(th), sin(th));
      c = vec2(0.5) + sd * reach * along + vec2(-sd.y, sd.x) * (h1(fi * 8.3) - 0.5) * 0.15 * (1.0 - 0.4 * along);
      c.x = 0.5 + (c.x - 0.5) * 0.8;
    } else {
      // Broadleaf and blossom: leaves gather in a few overlapping clumps inside a ragged,
      // lobed outline with holes where the sky shows. From a distance the cards then merge
      // into one mass of foliage instead of reading as separate rosettes.
      float cl = floor(h1(fi * 1.7) * 8.0) + kk * 17.0;
      vec2 cc = (vec2(h1(cl * 4.3), h1(cl * 7.7)) - 0.5) * 0.46;
      th = h1(fi * 2.9) * 6.283;
      vec2 d = cc + vec2(cos(th), sin(th)) * sqrt(h1(fi * 6.1)) * (0.12 + 0.1 * h1(cl * 2.1));
      float phi = atan(d.y, d.x), len = length(d);
      float lim = 0.41 * (0.7 + 0.3 * (0.5 + 0.5 * sin(phi * 3.0 + kk * 2.1)) * (0.6 + 0.4 * sin(phi * 7.0 + kk)));
      if (len > lim) d *= lim / len * sqrt(h1(fi * 3.3));
      c = vec2(0.5) + d;
      if (vn(c * 6.0 + kk * 9.0) < 0.27) continue;
    }
    float ang = th + (h1(fi * 3.1) - 0.5) * 2.2;
    if (uKind == 3) ang = 1.5708 + (h1(fi * 3.1) - 0.5) * 1.5;
    float s = mix(sMin, sMax, h1(fi * 5.3));
    float id = h1(fi * 9.1);
    vec2 q = rot(-ang) * (uv - c) / s;
    if (dot(q, q) > 1.6) continue;
    vec4 l; bool bloom = false;
    if (uKind == 0) l = maple(q, id);
    else if (uKind == 1) { bloom = id < 0.8; l = bloom ? flower(q, id, mix(srgb(0.92, 0.75, 0.79), srgb(0.88, 0.6, 0.68), h1(fi * 4.7)), srgb(0.82, 0.42, 0.54), 5.0) : ovate(q, id, srgb(0.32, 0.4, 0.14), srgb(0.5, 0.36, 0.2), 0.3); }
    else if (uKind == 2) { bloom = id < 0.86; l = bloom ? flower(q, id, mix(srgb(0.9, 0.85, 0.87), srgb(0.83, 0.75, 0.88), h1(fi * 4.7)), srgb(0.72, 0.6, 0.82), 4.0) : ovate(q, id, srgb(0.36, 0.5, 0.22), srgb(0.5, 0.58, 0.3), 0.3); }
    else if (uKind == 3) l = ovate(q, id, srgb(0.07, 0.17, 0.08), srgb(0.16, 0.3, 0.12), 0.11);
    else l = ovate(q, id, id > 0.9 ? srgb(0.42, 0.5, 0.13) : srgb(0.14, 0.31, 0.075), srgb(0.34, 0.48, 0.12), 0.34);
    // How this leaf leans, plus the fold along its midrib and the droop of its tip (a flower
    // is a shallow cup instead).
    float ta = h1(fi * 12.7) * 6.283, tm = 0.12 + 0.5 * h1(fi * 14.3);
    vec2 ln = vec2(cos(ta), sin(ta)) * tm + rot(ang) * (bloom ? q * 0.3 : vec2(-0.22 * q.x, -0.3 * clamp(q.y * 3.0, -1.0, 1.0)));
    // Leaves drawn later sit on top and cast a soft darkening on those beneath.
    col = mix(col * (1.0 - 0.3 * l.a), l.rgb, l.a);
    nrm = mix(nrm, ln, l.a);
    layers += l.a;
    alpha = max(alpha, l.a);
  }
  // Fill the transparent area with the mean colour so mip-maps do not pick up dark fringes.
  if (uOut == 0) outColor = vec4(mix(mean, col, step(0.01, alpha)), alpha);
  else outColor = vec4(clamp(nrm * 0.5 + 0.5, 0.0, 1.0), 1.0 / (1.0 + 0.5 * max(layers - 1.0, 0.0)), 1.0);
}`;

// Returns { a, b }: colour + coverage, and per-leaf shading data (see uOut above).
export function bakeLeafAtlas(renderer, size = 512) {
  const n = 10;
  const mk = (srgbSpace) => {
    const rt = new THREE.WebGLArrayRenderTarget(size, size, n, { depthBuffer: false });
    const t = rt.texture;
    t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
    t.colorSpace = srgbSpace ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 4;
    return rt;
  };
  const a = mk(true), b = mk(false);
  const pass = new FullscreenPass({ fragment: CLUSTER, uniforms: { uKind: { value: 0 }, uOut: { value: 0 } } });
  const gl = renderer.getContext(), half = size / 2;
  for (const [rt, out] of [[a, 0], [b, 1]]) {
    pass.uniforms.uOut.value = out;
    for (let i = 0; i < n; i++) {
      pass.uniforms.uKind.value = i;
      // Four tiles per layer, handed over one at a time, so no single draw runs long.
      for (let ty = 0; ty < 2; ty++) for (let tx = 0; tx < 2; tx++) {
        pass.renderRegion(renderer, rt, tx * half, ty * half, half, half, i);
        gl.flush();
      }
    }
  }
  pass.dispose();
  renderer.setRenderTarget(null);
  return { a: a.texture, b: b.texture };
}
