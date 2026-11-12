// Procedural PBR materials for the terrain, written as GLSL for the TextureForge.
// Colours are authored with srgb() so they read like paint values but are stored linear.

const rock = /* glsl */ `
// Stratified limestone cliff. u runs along the face, v is up.
void material(vec2 uv, out float h, out vec3 col, out float rough) {
  float warp = pfbm(uv, vec2(3.0), 3, 1.0) - 0.5;
  vec2 q = uv + vec2(0.0, warp * 0.07);
  vec4 w = pworley(q, vec2(5.0, 11.0), 2.0);                 // bedding blocks, wider than tall
  float crack = smoothstep(0.0, 0.09, w.y - w.x);
  vec4 w2 = pworley(q + 0.013 * (pfbm(uv, vec2(9.0), 2, 3.0) - 0.5), vec2(13.0, 31.0), 5.0);
  float crack2 = smoothstep(0.0, 0.12, w2.y - w2.x);
  float strata = pfbm(q, vec2(2.0, 40.0), 3, 7.0);           // thin horizontal layering
  float runnel = pfbm(uv, vec2(36.0, 3.0), 3, 9.0);          // vertical water streaks
  float grain = pfbm(uv, vec2(64.0), 4, 11.0);
  float pits = pridge(uv, vec2(24.0), 3, 13.0);
  h = 0.38 * w.z + 0.22 * crack + 0.12 * crack2 + 0.14 * strata + 0.08 * (1.0 - pits) + 0.06 * grain;
  h *= mix(0.55, 1.0, crack);
  vec3 cA = srgb(0.63, 0.59, 0.53), cB = srgb(0.47, 0.44, 0.41), cC = srgb(0.71, 0.63, 0.51), cD = srgb(0.36, 0.34, 0.33);
  col = mix(cA, cB, smoothstep(0.3, 0.7, w.w));
  col = mix(col, cC, smoothstep(0.55, 0.8, strata) * 0.6);
  col = mix(col, cD, smoothstep(0.6, 0.85, pfbm(uv, vec2(4.0, 9.0), 4, 17.0)) * 0.5);
  col *= 0.72 + 0.5 * grain;
  col *= mix(0.45, 1.0, crack) * mix(0.75, 1.0, crack2);
  col *= 1.0 - 0.3 * smoothstep(0.55, 0.85, runnel);
  vec4 l = pworley(uv, vec2(17.0), 21.0);
  float lichen = (1.0 - smoothstep(0.12, 0.32, l.x)) * step(0.72, l.z);
  col = mix(col, srgb(0.74, 0.76, 0.62), lichen * 0.45);
  rough = 0.88 - 0.1 * lichen;
}`;

const grass = /* glsl */ `
void material(vec2 uv, out float h, out vec3 col, out float rough) {
  float big = pfbm(uv, vec2(3.0), 4, 1.0);
  float mid = pfbm(uv, vec2(11.0), 4, 2.0);
  float b1 = pfbm(uv + 0.02 * mid, vec2(120.0, 22.0), 3, 3.0), b2 = pfbm(uv, vec2(22.0, 120.0), 3, 4.0);
  float blades = mix(b1, b2, smoothstep(0.4, 0.6, pfbm(uv, vec2(7.0), 2, 5.0)));
  vec4 tuft = pworley(uv, vec2(26.0), 6.0);
  float clump = 1.0 - smoothstep(0.0, 0.7, tuft.x);
  h = 0.5 * clump + 0.35 * blades + 0.15 * mid;
  vec3 deep = srgb(0.17, 0.31, 0.08), lush = srgb(0.35, 0.51, 0.15), dry = srgb(0.56, 0.54, 0.26), dark = srgb(0.09, 0.16, 0.05);
  col = mix(deep, lush, smoothstep(0.25, 0.75, big * 0.6 + blades * 0.4));
  col = mix(col, dry, smoothstep(0.62, 0.85, mid) * 0.45);
  col = mix(mix(dark, col, 0.55), col, smoothstep(0.1, 0.55, h));
  col *= 0.85 + 0.3 * tuft.z;
  rough = 0.82;
}`;

const soil = /* glsl */ `
void material(vec2 uv, out float h, out vec3 col, out float rough) {
  float n = pfbm(uv, vec2(6.0), 5, 1.0), fine = pfbm(uv, vec2(48.0), 4, 2.0);
  vec4 peb = pworley(uv, vec2(34.0), 3.0);
  float stone = (1.0 - smoothstep(0.2, 0.34, peb.x)) * step(0.55, peb.z);
  vec4 crk = pworley(uv + 0.02 * (n - 0.5), vec2(9.0), 4.0);
  float crack = smoothstep(0.0, 0.05, crk.y - crk.x);
  h = (0.45 * n + 0.2 * fine + 0.35 * stone) * mix(0.6, 1.0, crack);
  col = mix(srgb(0.30, 0.22, 0.15), srgb(0.44, 0.34, 0.24), n) * (0.75 + 0.5 * fine);
  col = mix(col, mix(srgb(0.5, 0.48, 0.44), srgb(0.36, 0.33, 0.3), peb.w), stone);
  col *= mix(0.6, 1.0, crack);
  rough = 0.92 - 0.15 * stone;
}`;

const moss = /* glsl */ `
void material(vec2 uv, out float h, out vec3 col, out float rough) {
  vec4 w = pworley(uv, vec2(9.0), 1.0), w2 = pworley(uv, vec2(23.0), 2.0);
  float lump = 1.0 - smoothstep(0.0, 0.8, w.x), lump2 = 1.0 - smoothstep(0.0, 0.75, w2.x);
  float fuzz = pfbm(uv, vec2(96.0), 3, 3.0);
  h = 0.5 * lump * lump + 0.3 * lump2 + 0.2 * fuzz;
  col = mix(srgb(0.13, 0.2, 0.05), srgb(0.36, 0.44, 0.1), smoothstep(0.2, 0.9, h));
  col = mix(col, srgb(0.45, 0.42, 0.14), smoothstep(0.6, 0.9, pfbm(uv, vec2(5.0), 3, 4.0)) * 0.4);
  col *= 0.8 + 0.4 * fuzz;
  rough = 0.95;
}`;

const pebble = /* glsl */ `
void material(vec2 uv, out float h, out vec3 col, out float rough) {
  vec4 w = pworley(uv, vec2(15.0), 1.0);
  float edge = w.y - w.x;
  float dome = smoothstep(0.0, 0.28, edge) * (1.0 - 0.6 * w.x * w.x);
  vec4 s = pworley(uv, vec2(41.0), 2.0);
  float small = smoothstep(0.0, 0.2, s.y - s.x) * (1.0 - s.x);
  float sandN = pfbm(uv, vec2(80.0), 3, 3.0);
  float isStone = smoothstep(0.05, 0.16, edge);
  h = mix(0.12 + 0.1 * small + 0.06 * sandN, 0.35 + 0.65 * dome, isStone);
  vec3 stoneC = mix(mix(srgb(0.55, 0.53, 0.5), srgb(0.38, 0.36, 0.36), w.z), srgb(0.6, 0.48, 0.38), step(0.7, w.w));
  stoneC *= 0.8 + 0.4 * pfbm(uv, vec2(60.0), 3, 5.0);
  vec3 sandC = srgb(0.52, 0.46, 0.36) * (0.7 + 0.5 * sandN);
  col = mix(sandC * (0.6 + 0.4 * small), stoneC, isStone);
  rough = mix(0.9, 0.55, isStone);
}`;

const litter = /* glsl */ `
// Forest floor: dark humus under scattered fallen leaves in autumn reds and ochres.
void material(vec2 uv, out float h, out vec3 col, out float rough) {
  float n = pfbm(uv, vec2(7.0), 5, 1.0), fine = pfbm(uv, vec2(60.0), 3, 2.0);
  h = 0.3 * n + 0.1 * fine;
  col = mix(srgb(0.16, 0.12, 0.08), srgb(0.26, 0.2, 0.13), n) * (0.75 + 0.5 * fine);
  rough = 0.95;
  for (int k = 0; k < 3; k++) {
    vec4 c = pcell(uv, vec2(13.0 + 6.0 * float(k)), 3.0 + float(k) * 5.0);
    float ang = c.z * 6.283;
    vec2 d = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * c.xy;
    float leaf = 1.0 - smoothstep(0.2, 0.24, length(vec2(d.x, d.y * 2.3)) + 2.2 * d.x * d.x);
    leaf *= step(0.42, c.w);
    float vein = 1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.02, abs(d.y)));
    vec3 lc = c.z < 0.3 ? srgb(0.62, 0.3, 0.1) : c.z < 0.55 ? srgb(0.5, 0.13, 0.09) : c.z < 0.8 ? srgb(0.6, 0.48, 0.16) : srgb(0.32, 0.21, 0.12);
    lc *= (0.7 + 0.6 * c.w) * vein;
    col = mix(col, lc, leaf);
    h = mix(h, 0.5 + 0.15 * float(k) + 0.1 * (1.0 - length(d) * 4.0), leaf);
    rough = mix(rough, 0.7, leaf);
  }
}`;

const snow = /* glsl */ `
void material(vec2 uv, out float h, out vec3 col, out float rough) {
  float drift = pfbm(uv, vec2(4.0), 5, 1.0), fine = pfbm(uv, vec2(70.0), 3, 2.0);
  h = 0.75 * drift + 0.25 * fine;
  col = mix(srgb(0.86, 0.9, 0.96), srgb(0.97, 0.98, 1.0), drift);
  rough = 0.55 + 0.25 * fine;
}`;

const rockFar = /* glsl */ `
// Cliff seen from a distance: thick beds, vertical fluting and sparse fractures.
// One tile spans well over a hundred metres, so nothing here should read as small cracks.
void material(vec2 uv, out float h, out vec3 col, out float rough) {
  float warp = pfbm(uv, vec2(2.0), 3, 1.0) - 0.5;
  vec2 q = vec2(uv.x, uv.y + warp * 0.06);
  float s1 = pfbm(q, vec2(1.0, 14.0), 2, 3.0);
  float s2 = pfbm(q, vec2(2.0, 46.0), 2, 5.0);
  float beds = smoothstep(0.38, 0.62, s1);
  float flute = pridge(uv, vec2(9.0, 1.0), 3, 7.0);
  float flute2 = pfbm(uv, vec2(26.0, 2.0), 3, 9.0);
  vec4 w = pworley(uv + 0.03 * warp, vec2(4.0, 3.0), 11.0);
  float crack = smoothstep(0.0, 0.035, w.y - w.x);
  float grain = pfbm(uv, vec2(40.0), 4, 13.0);
  h = (0.3 * beds + 0.2 * s2 + 0.25 * flute + 0.1 * flute2 + 0.15 * grain) * mix(0.7, 1.0, crack);
  vec3 cream = srgb(0.68, 0.62, 0.52), grey = srgb(0.5, 0.48, 0.45), rust = srgb(0.62, 0.47, 0.34), dark = srgb(0.33, 0.31, 0.3);
  col = mix(grey, cream, beds);
  col = mix(col, rust, smoothstep(0.6, 0.85, pfbm(q, vec2(3.0, 9.0), 3, 17.0)) * 0.45);
  col = mix(col, dark, smoothstep(0.62, 0.9, flute2) * 0.4);
  col *= (0.7 + 0.5 * s2) * (0.85 + 0.3 * grain) * mix(0.6, 1.0, crack) * (0.8 + 0.3 * flute);
  rough = 0.9;
}`;

const meadowFar = /* glsl */ `
// Meadow seen from tens of metres away: patchy greens, bare spots and wildflower specks.
void material(vec2 uv, out float h, out vec3 col, out float rough) {
  float big = pfbm(uv, vec2(3.0), 5, 1.0), mid = pfbm(uv, vec2(9.0), 4, 2.0), fine = pfbm(uv, vec2(40.0), 4, 3.0);
  vec4 tuft = pworley(uv, vec2(38.0), 4.0);
  float clump = 1.0 - smoothstep(0.0, 0.6, tuft.x);
  h = 0.5 * clump + 0.3 * fine + 0.2 * mid;
  vec3 deep = srgb(0.17, 0.31, 0.08), lush = srgb(0.36, 0.52, 0.15), dry = srgb(0.56, 0.54, 0.26);
  col = mix(deep, lush, smoothstep(0.3, 0.7, big * 0.5 + mid * 0.5));
  col = mix(col, dry, smoothstep(0.6, 0.8, pfbm(uv, vec2(5.0), 4, 6.0)) * 0.5);
  col = mix(col, srgb(0.34, 0.26, 0.17), smoothstep(0.74, 0.86, mid) * 0.7);
  col *= 0.72 + 0.45 * clump + 0.2 * fine;
  vec4 fl = pworley(uv, vec2(120.0), 9.0);
  float patchy = smoothstep(0.52, 0.7, pfbm(uv, vec2(4.0), 3, 8.0));
  float speck = (1.0 - smoothstep(0.1, 0.22, fl.x)) * step(0.45, fl.z) * patchy;
  vec3 fc = fl.w < 0.3 ? srgb(0.95, 0.93, 0.88) : fl.w < 0.55 ? srgb(0.78, 0.5, 0.86) : fl.w < 0.8 ? srgb(0.96, 0.6, 0.72) : srgb(0.98, 0.84, 0.3);
  col = mix(col, fc, speck * 0.85);
  rough = 0.85;
}`;

export const TERRAIN_MATERIALS = [
  { name: 'grass', code: grass, bump: 5 },
  { name: 'soil', code: soil, bump: 7 },
  { name: 'rock', code: rock, bump: 11 },
  { name: 'moss', code: moss, bump: 6 },
  { name: 'pebble', code: pebble, bump: 9 },
  { name: 'litter', code: litter, bump: 5 },
  { name: 'snow', code: snow, bump: 3 },
  { name: 'rockFar', code: rockFar, bump: 14 },
  { name: 'meadowFar', code: meadowFar, bump: 5 },
];
