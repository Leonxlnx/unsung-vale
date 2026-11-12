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

void main() {
  vec2 uv = vUv;
  vec3 col = vec3(0.0); float alpha = 0.0;
  vec3 mean = vec3(0.1);
  int count = 130; float sMin = 0.06, sMax = 0.1;
  if (uKind == 0) { mean = srgb(0.55, 0.09, 0.07); }
  if (uKind == 1) { count = 170; sMin = 0.04; sMax = 0.07; mean = srgb(0.95, 0.68, 0.76); }
  if (uKind == 2) { count = 190; sMin = 0.034; sMax = 0.055; mean = srgb(0.78, 0.7, 0.93); }
  if (uKind == 3) { count = 110; sMin = 0.12; sMax = 0.2; mean = srgb(0.1, 0.2, 0.09); }
  if (uKind == 4) { count = 130; sMin = 0.06; sMax = 0.1; mean = srgb(0.22, 0.38, 0.1); }
  for (int i = 0; i < 190; i++) {
    if (i >= count) break;
    float fi = float(i) + float(uKind) * 31.0;
    // Leaves sit along a handful of sprigs fanning out from the middle, which gives each
    // card a ragged, gappy outline instead of a disc.
    float sprig = floor(h1(fi * 1.7) * 7.0) + float(uKind) * 11.0;
    float th = h1(sprig * 4.3) * 6.283 + (h1(fi * 2.9) - 0.5) * 0.5;
    float reach = 0.2 + 0.26 * h1(sprig * 7.7);
    float along = pow(h1(fi * 6.1), 0.7);
    vec2 sd = vec2(cos(th), sin(th));
    vec2 c = vec2(0.5) + sd * reach * along + vec2(-sd.y, sd.x) * (h1(fi * 8.3) - 0.5) * 0.12 * (1.0 - 0.5 * along);
    float ang = th + (h1(fi * 3.1) - 0.5) * 2.2;
    float s = mix(sMin, sMax, h1(fi * 5.3));
    float id = h1(fi * 9.1);
    if (uKind == 3) { ang = 1.5708 + (h1(fi * 3.1) - 0.5) * 1.5; c.x = 0.5 + (c.x - 0.5) * 0.8; }
    vec2 q = rot(-ang) * (uv - c) / s;
    if (dot(q, q) > 1.6) continue;
    vec4 l;
    if (uKind == 0) l = maple(q, id);
    else if (uKind == 1) l = id < 0.8 ? flower(q, id, srgb(0.99, 0.74, 0.82), srgb(0.86, 0.3, 0.5), 5.0) : ovate(q, id, srgb(0.32, 0.4, 0.14), srgb(0.5, 0.36, 0.2), 0.3);
    else if (uKind == 2) l = id < 0.86 ? flower(q, id, srgb(0.84, 0.76, 0.97), srgb(0.6, 0.48, 0.88), 4.0) : ovate(q, id, srgb(0.36, 0.5, 0.22), srgb(0.5, 0.58, 0.3), 0.3);
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
  const n = 5;
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
