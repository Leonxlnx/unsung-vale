// Procedural PBR materials for the terrain, written as GLSL for the TextureForge.
// Colours are authored with srgb() so they read like paint values but are stored linear.

const BLOCKS = /* glsl */ `
// Jointed rock: cells measured with a squared-off distance so their borders run mostly
// along and across the bedding, like real fracture sets. Returns x = distance to the nearest
// joint, yzw = three hashes of the block; rel is the offset from the block's centre.
vec4 blocks(vec2 uv, vec2 freq, float seed, out vec2 rel) {
  vec2 p = uv * freq, i = floor(p), f = fract(p);
  float f1 = 9.0, f2 = 9.0; vec2 idc = vec2(0.0); rel = vec2(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y));
    vec2 c = mod(i + o, freq);
    vec2 r = o + 0.14 + 0.72 * hash22(c + seed * 7.7) - f;
    float d = max(abs(r.x), abs(r.y)) + 0.12 * (abs(r.x) + abs(r.y));
    if (d < f1) { f2 = f1; f1 = d; idc = c; rel = r; } else if (d < f2) f2 = d;
  }
  return vec4(f2 - f1, hash12(idc + seed * 3.3), hash12(idc * 1.7 + seed * 9.1 + 4.0), hash12(idc * 2.3 + seed * 5.7 + 9.0));
}`;

const rock = /* glsl */ `
${BLOCKS}

// Close-up cliff detail for a tile of a few metres: broken facets, chips and pitting.
// Its colour is authored around mid grey because it multiplies the far layer's colour.
void material(vec2 uv, out float h, out vec3 col, out float rough) {
  float wa = pfbm(uv, vec2(4.0), 3, 1.0) - 0.5, wb = pfbm(uv, vec2(4.0), 3, 2.0) - 0.5;
  vec2 q = uv + vec2(wb, wa) * 0.045;
  vec2 r1, r2, r3;
  vec4 b1 = blocks(q, vec2(4.0, 3.0), 3.0, r1);
  vec4 b2 = blocks(q + vec2(b1.y * 0.3, b1.z * 0.4), vec2(10.0, 7.0), 5.0, r2);
  vec4 b3 = blocks(q + vec2(b2.z * 0.2, b2.y * 0.3), vec2(23.0, 17.0), 7.0, r3);
  float open2 = smoothstep(0.38, 0.62, pfbm(q, vec2(5.0, 4.0), 2, 23.0));
  float j1 = smoothstep(0.0, 0.05, b1.x), j2 = mix(1.0, smoothstep(0.0, 0.07, b2.x), open2);
  // Every block breaks along its own plane, so neighbouring faces catch the light differently.
  float t1 = 0.5 + (b1.y - 0.5) * 0.6 + dot(r1, vec2(b1.z - 0.5, b1.w - 0.5)) * 0.9;
  float t2 = 0.5 + (b2.y - 0.5) * 0.5 + dot(r2, vec2(b2.z - 0.5, b2.w - 0.5)) * 1.5;
  float t3 = 0.5 + (b3.y - 0.5) * 0.5 + dot(r3, vec2(b3.z - 0.5, b3.w - 0.5)) * 1.5;
  float chips = pridge(uv + 0.01 * wa, vec2(17.0, 12.0), 4, 9.0);
  float pits = pfbm(uv, vec2(38.0), 4, 11.0);
  float grain = pfbm(uv, vec2(120.0), 3, 13.0);
  h = saturate(0.2 * t1 * j1 + 0.3 * t2 * j2 + 0.18 * t3 + 0.14 * (1.0 - chips) + 0.1 * pits + 0.08 * grain);
  col = vec3(0.5) * mix(vec3(0.88, 0.91, 0.97), vec3(1.12, 1.04, 0.92), b2.w);
  col *= 0.86 + 0.28 * b3.w;
  col *= mix(0.62, 1.0, j1) * mix(0.76, 1.0, j2);
  col *= 0.74 + 0.3 * smoothstep(0.15, 0.75, h) + 0.34 * (grain - 0.5);
  col *= 1.0 - 0.25 * smoothstep(0.55, 0.8, pits);
  vec4 l = pworley(uv, vec2(15.0), 21.0);
  float lichen = (1.0 - smoothstep(0.1, 0.34, l.x + 0.25 * (grain - 0.5))) * step(0.66, l.z) * j1;
  col = mix(col, vec3(0.5) * (l.w < 0.5 ? vec3(1.18, 1.2, 0.9) : vec3(1.3, 1.02, 0.62)), lichen * 0.55);
  rough = 0.9 - 0.08 * lichen;
}`;

const grass = /* glsl */ `
// Turf seen between the blades: fine fibres lying every way, soft tufts, no hard lumps.
void material(vec2 uv, out float h, out vec3 col, out float rough) {
  float big = pfbm(uv, vec2(3.0), 4, 1.0);
  float mid = pfbm(uv, vec2(11.0), 4, 2.0);
  float b1 = pfbm(uv + 0.02 * mid, vec2(130.0, 20.0), 3, 3.0), b2 = pfbm(uv, vec2(20.0, 130.0), 3, 4.0);
  float b3 = pfbm(uv + 0.03 * big, vec2(70.0, 70.0), 3, 6.0);
  float blades = mix(mix(b1, b2, smoothstep(0.4, 0.6, pfbm(uv, vec2(7.0), 2, 5.0))), b3, 0.35);
  vec4 tuft = pworley(uv, vec2(19.0), 6.0);
  float clump = 1.0 - smoothstep(0.0, 0.8, tuft.x);
  h = 0.18 * clump + 0.62 * blades + 0.2 * mid;
  vec3 deep = srgb(0.17, 0.31, 0.08), lush = srgb(0.35, 0.51, 0.15), dry = srgb(0.56, 0.54, 0.26), dark = srgb(0.09, 0.16, 0.05);
  col = mix(deep, lush, smoothstep(0.25, 0.75, big * 0.6 + blades * 0.4));
  col = mix(col, dry, smoothstep(0.62, 0.85, mid) * 0.4);
  col = mix(mix(dark, col, 0.8), col, smoothstep(0.2, 0.6, blades));
  col *= 0.92 + 0.16 * tuft.z;
  rough = 0.84;
}`;

const soil = /* glsl */ `
// Packed earth: uneven tone, a scatter of stones in two sizes, chaff pressed into the dirt,
// and hairline cracks only where it has dried hardest.
void material(vec2 uv, out float h, out vec3 col, out float rough) {
  float n = pfbm(uv, vec2(5.0), 5, 1.0), mid = pfbm(uv, vec2(17.0), 4, 2.0), fine = pfbm(uv, vec2(64.0), 4, 3.0);
  float earth = 0.5 * n + 0.3 * mid + 0.2 * fine;
  vec4 p1 = pworley(uv, vec2(13.0), 3.0), p2 = pworley(uv, vec2(37.0), 5.0);
  float s1 = (1.0 - smoothstep(0.15, 0.26, p1.x)) * step(0.74, p1.z);
  float s2 = (1.0 - smoothstep(0.2, 0.33, p2.x)) * step(0.64, p2.z);
  float stone = max(s1, s2 * 0.85);
  vec4 crk = pworley(uv + 0.03 * (mid - 0.5), vec2(7.0), 4.0);
  float crack = 1.0 - (1.0 - smoothstep(0.0, 0.03, crk.y - crk.x)) * smoothstep(0.56, 0.74, n) * 0.6;
  float chaff = smoothstep(0.7, 0.86, pfbm(uv, vec2(44.0, 9.0), 3, 7.0)) * (1.0 - stone);
  h = (0.45 * earth + 0.1) * crack + 0.42 * stone * (0.55 + 0.45 * (1.0 - min(p1.x, p2.x) * 3.0));
  vec3 dry = srgb(0.5, 0.4, 0.28), damp = srgb(0.3, 0.23, 0.16), pale = srgb(0.58, 0.5, 0.38);
  col = mix(damp, dry, smoothstep(0.3, 0.7, n * 0.7 + mid * 0.3));
  col = mix(col, pale, smoothstep(0.6, 0.85, mid) * 0.4) * (0.82 + 0.36 * fine);
  col *= mix(0.7, 1.0, crack);
  vec3 sc = mix(srgb(0.56, 0.54, 0.5), srgb(0.4, 0.37, 0.34), p1.w);
  sc = mix(sc, srgb(0.62, 0.5, 0.38), step(0.75, p2.w));
  col = mix(col, sc * (0.8 + 0.4 * fine), stone);
  col = mix(col, srgb(0.55, 0.5, 0.25), chaff * 0.5);
  rough = mix(0.94, 0.68, stone);
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
// Shore and gravel: rippled sand with stones of three sizes that gather in drifts, so no
// two metres of it look alike.
void material(vec2 uv, out float h, out vec3 col, out float rough) {
  float big = pfbm(uv, vec2(3.0), 4, 1.0), sandN = pfbm(uv, vec2(72.0), 4, 3.0);
  float ripple = pfbm(uv + 0.02 * big, vec2(5.0, 24.0), 3, 5.0);
  float drift = smoothstep(0.38, 0.66, big);
  vec4 a = pworley(uv, vec2(8.0), 1.0), b = pworley(uv, vec2(19.0), 2.0), c = pworley(uv, vec2(43.0), 3.0);
  float sa = (1.0 - smoothstep(0.2, 0.3, a.x)) * step(1.0 - 0.4 * drift, a.z);
  float sb = (1.0 - smoothstep(0.22, 0.33, b.x)) * step(0.94 - 0.5 * drift, b.z);
  float sc = (1.0 - smoothstep(0.24, 0.36, c.x)) * step(0.8 - 0.45 * drift, c.z);
  float da = sa * (1.0 - sq3(a.x / 0.3)), db = sb * (1.0 - sq3(b.x / 0.33)), dc = sc * (1.0 - sq3(c.x / 0.36));
  float stone = max(sa, max(sb, sc));
  float sand = 0.16 + 0.1 * ripple + 0.06 * sandN;
  h = max(sand, max(0.5 + 0.5 * da, max(0.36 + 0.4 * db, 0.26 + 0.3 * dc)) * stone);
  float id = sa > 0.5 ? a.w : sb > 0.5 ? b.w : c.w;
  vec3 st = id < 0.4 ? srgb(0.55, 0.54, 0.52) : id < 0.62 ? srgb(0.38, 0.37, 0.37) : id < 0.82 ? srgb(0.63, 0.52, 0.4) : srgb(0.8, 0.78, 0.72);
  st *= 0.78 + 0.44 * pfbm(uv, vec2(60.0), 3, 5.0);
  vec3 sandC = mix(srgb(0.6, 0.54, 0.42), srgb(0.5, 0.44, 0.33), smoothstep(0.4, 0.7, ripple)) * (0.8 + 0.4 * sandN);
  col = mix(sandC, st, stone);
  // A dark rim of damp around each stone seats it in the sand.
  col *= 1.0 - 0.3 * (1.0 - stone) * (1.0 - smoothstep(0.3, 0.42, min(a.x + (1.0 - step(1.0 - 0.4 * drift, a.z)), b.x + (1.0 - step(0.94 - 0.5 * drift, b.z)))));
  rough = mix(0.92, 0.5, stone);
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
${BLOCKS}

// Cliff face for a tile of well over a hundred metres: tall pillars between vertical joints,
// cut by bedding planes into stepped blocks that each break along their own plane.
// u runs along the face, v is up.
void material(vec2 uv, out float h, out vec3 col, out float rough) {
  float wa = pfbm(uv, vec2(3.0), 3, 1.0) - 0.5, wb = pfbm(uv, vec2(3.0), 3, 2.0) - 0.5;
  vec2 q = uv + vec2(wb * 0.035, wa * 0.05);
  vec2 r1, r2, r3, r4;
  vec4 b1 = blocks(q, vec2(6.0, 2.0), 3.0, r1);
  vec4 b2 = blocks(q + vec2(0.0, b1.y * 0.41), vec2(11.0, 5.0), 5.0, r2);
  vec4 b3 = blocks(q + vec2(b2.y * 0.3, b1.y * 0.17), vec2(26.0, 13.0), 7.0, r3);
  vec4 b4 = blocks(q + vec2(b3.y * 0.2, b2.z * 0.3), vec2(57.0, 37.0), 11.0, r4);
  float flute = pridge(uv + vec2(0.0, wa * 0.1), vec2(34.0, 3.0), 3, 9.0);
  float grain = pfbm(uv, vec2(64.0), 4, 13.0);
  float beds = pfbm(q, vec2(2.0, 30.0), 3, 15.0);
  // Joints are only open in places, so blocks merge into larger slabs of irregular size.
  float open2 = smoothstep(0.34, 0.58, pfbm(q, vec2(4.0, 3.0), 2, 23.0));
  float open3 = smoothstep(0.46, 0.7, pfbm(q, vec2(8.0, 6.0), 2, 29.0));
  float j1 = smoothstep(0.0, 0.07, b1.x);
  float j2 = mix(1.0, smoothstep(0.0, 0.08, b2.x), open2);
  float j3 = mix(1.0, smoothstep(0.0, 0.11, b3.x), open3);
  float t1 = 0.5 + (b1.y - 0.5) * 0.8 + r1.x * (b1.z - 0.5) * 0.9;
  float t2 = 0.5 + mix(0.0, (b2.y - 0.5) * 0.7 + dot(r2, vec2(b2.z - 0.5, b2.w - 0.5)) * 1.2, open2);
  float t3 = 0.5 + (b3.y - 0.5) * 0.4 + dot(r3, vec2(b3.z - 0.5, b3.w - 0.5)) * 1.6;
  float t4 = 0.5 + dot(r4, vec2(b4.z - 0.5, b4.w - 0.5)) * 1.7;
  h = saturate(0.26 * t1 * j1 + 0.22 * t2 * j2 + 0.22 * t3 * j3 + 0.1 * t4 + 0.1 * flute + 0.05 * grain + 0.03 * beds);
  vec3 cream = srgb(0.74, 0.7, 0.62), grey = srgb(0.56, 0.56, 0.55), warm = srgb(0.68, 0.56, 0.43), dark = srgb(0.3, 0.28, 0.27), pale = srgb(0.8, 0.78, 0.72);
  col = mix(grey, cream, smoothstep(0.2, 0.8, 0.5 * b2.w + 0.3 * b1.w + 0.2 * b3.w));
  col = mix(col, warm, smoothstep(0.52, 0.82, pfbm(q, vec2(3.0, 5.0), 3, 17.0)) * 0.5);
  col = mix(col, pale, smoothstep(0.6, 0.85, pfbm(q, vec2(5.0, 9.0), 3, 31.0)) * 0.35);
  col *= 0.94 + 0.14 * (beds - 0.5);
  col *= 0.9 + 0.2 * b4.y;
  col *= mix(0.7, 1.0, j1) * mix(0.78, 1.0, j2) * mix(0.86, 1.0, j3);
  col *= 0.84 + 0.28 * smoothstep(0.15, 0.8, h);
  float streak = pfbm(uv + vec2(0.0, wa * 0.06), vec2(42.0, 2.0), 3, 19.0);
  col = mix(col, dark, smoothstep(0.58, 0.84, streak) * 0.42);
  col *= 0.87 + 0.26 * grain;
  rough = 0.9;
}`;

const meadowFar = /* glsl */ `
// Meadow seen from tens of metres away: soft swathes laid over by the wind, broad patches of
// tone and a dusting of wildflowers. Nothing in it should read as a lump.
void material(vec2 uv, out float h, out vec3 col, out float rough) {
  float big = pfbm(uv, vec2(3.0), 5, 1.0), mid = pfbm(uv, vec2(9.0), 4, 2.0), fine = pfbm(uv, vec2(48.0), 4, 3.0);
  float swathe = pfbm(uv + 0.05 * big, vec2(7.0, 26.0), 3, 5.0);
  float tips = pfbm(uv, vec2(120.0, 60.0), 3, 7.0);
  h = 0.4 * swathe + 0.3 * fine + 0.2 * mid + 0.1 * tips;
  vec3 deep = srgb(0.17, 0.31, 0.08), lush = srgb(0.36, 0.52, 0.15), dry = srgb(0.56, 0.54, 0.26);
  col = mix(deep, lush, smoothstep(0.3, 0.7, big * 0.5 + mid * 0.5));
  col = mix(col, dry, smoothstep(0.6, 0.8, pfbm(uv, vec2(5.0), 4, 6.0)) * 0.45);
  col *= 0.84 + 0.2 * swathe + 0.12 * tips;
  vec4 fl = pworley(uv, vec2(120.0), 9.0);
  float patchy = smoothstep(0.52, 0.7, pfbm(uv, vec2(4.0), 3, 8.0));
  float speck = (1.0 - smoothstep(0.1, 0.22, fl.x)) * step(0.45, fl.z) * patchy;
  vec3 fc = fl.w < 0.3 ? srgb(0.95, 0.93, 0.88) : fl.w < 0.55 ? srgb(0.78, 0.5, 0.86) : fl.w < 0.8 ? srgb(0.96, 0.6, 0.72) : srgb(0.98, 0.84, 0.3);
  col = mix(col, fc, speck * 0.8);
  rough = 0.86;
}`;

export const TERRAIN_MATERIALS = [
  { name: 'grass', code: grass, bump: 2 },
  { name: 'soil', code: soil, bump: 7 },
  { name: 'rock', code: rock, bump: 24, aoStrength: 0.4 },
  { name: 'moss', code: moss, bump: 6 },
  { name: 'pebble', code: pebble, bump: 9 },
  { name: 'litter', code: litter, bump: 5 },
  { name: 'snow', code: snow, bump: 3 },
  { name: 'rockFar', code: rockFar, bump: 22, aoRadius: 4, aoStrength: 0.33 },
  { name: 'meadowFar', code: meadowFar, bump: 2.2 },
];
