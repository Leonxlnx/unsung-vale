// Deterministic noise helpers shared by the Node world builder and the browser runtime.
// Everything here is pure math: no textures, no assets.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(ix, iz, seed = 0) {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ Math.imul(seed | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const dfade = (t) => 30 * t * t * (t * (t - 2) + 1);

function grad(ix, iz, seed) {
  const a = hash2(ix, iz, seed) * 6.283185307;
  return [Math.cos(a), Math.sin(a)];
}

// 2D gradient noise in roughly [-1, 1].
export function gnoise(x, z, seed = 0) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const g00 = grad(ix, iz, seed), g10 = grad(ix + 1, iz, seed);
  const g01 = grad(ix, iz + 1, seed), g11 = grad(ix + 1, iz + 1, seed);
  const n00 = g00[0] * fx + g00[1] * fz;
  const n10 = g10[0] * (fx - 1) + g10[1] * fz;
  const n01 = g01[0] * fx + g01[1] * (fz - 1);
  const n11 = g11[0] * (fx - 1) + g11[1] * (fz - 1);
  const u = fade(fx), v = fade(fz);
  return 1.41 * (n00 + u * (n10 - n00) + v * (n01 - n00) + u * v * (n00 - n10 - n01 + n11));
}

// Gradient noise with analytic derivatives: returns [value, d/dx, d/dz].
const _nd = [0, 0, 0];
export function gnoiseD(x, z, seed = 0) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const g00 = grad(ix, iz, seed), g10 = grad(ix + 1, iz, seed);
  const g01 = grad(ix, iz + 1, seed), g11 = grad(ix + 1, iz + 1, seed);
  const n00 = g00[0] * fx + g00[1] * fz;
  const n10 = g10[0] * (fx - 1) + g10[1] * fz;
  const n01 = g01[0] * fx + g01[1] * (fz - 1);
  const n11 = g11[0] * (fx - 1) + g11[1] * (fz - 1);
  const u = fade(fx), v = fade(fz), du = dfade(fx), dv = dfade(fz);
  const k = n00 - n10 - n01 + n11;
  _nd[0] = 1.41 * (n00 + u * (n10 - n00) + v * (n01 - n00) + u * v * k);
  _nd[1] = 1.41 * (g00[0] + u * (g10[0] - g00[0]) + v * (g01[0] - g00[0]) + u * v * (g00[0] - g10[0] - g01[0] + g11[0]) + du * (n10 - n00 + v * k));
  _nd[2] = 1.41 * (g00[1] + u * (g10[1] - g00[1]) + v * (g01[1] - g00[1]) + u * v * (g00[1] - g10[1] - g01[1] + g11[1]) + dv * (n01 - n00 + u * k));
  return _nd;
}

export function fbm(x, z, octaves = 5, seed = 0, lac = 2.03, gain = 0.5) {
  let amp = 0.5, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * gnoise(x, z, seed + i * 17);
    norm += amp;
    x = x * lac + 13.7; z = z * lac - 7.3;
    amp *= gain;
  }
  return sum / norm;
}

export function ridged(x, z, octaves = 5, seed = 0, lac = 2.07, gain = 0.5) {
  let amp = 0.5, sum = 0, norm = 0, prev = 1;
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(gnoise(x, z, seed + i * 31));
    n *= n;
    sum += amp * n * prev;
    prev = Math.min(1, n * 1.6);
    norm += amp;
    x = x * lac + 5.1; z = z * lac + 9.4;
    amp *= gain;
  }
  return sum / norm;
}

// Derivative-damped fbm: slopes suppress later octaves, which reads as eroded mountain
// flanks with smooth valleys instead of uniform fractal fuzz. Output roughly [0, 1].
export function erodedFbm(x, z, octaves = 7, seed = 0) {
  let amp = 0.5, sum = 0, norm = 0, dx = 0, dz = 0, f = 1;
  for (let i = 0; i < octaves; i++) {
    const n = gnoiseD(x * f + i * 11.3, z * f - i * 4.7, seed + i * 13);
    dx += n[1]; dz += n[2];
    const damp = 1 / (1 + 0.9 * (dx * dx + dz * dz));
    sum += amp * (n[0] * 0.5 + 0.5) * damp;
    norm += amp;
    amp *= 0.5; f *= 1.97;
  }
  return sum / norm;
}

// Cellular noise: returns [F1, F2, cellId].
const _w = [0, 0, 0];
export function worley(x, z, seed = 0) {
  const ix = Math.floor(x), iz = Math.floor(z);
  let f1 = 9, f2 = 9, id = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = ix + i, cz = iz + j;
      const px = cx + hash2(cx, cz, seed), pz = cz + hash2(cx, cz, seed + 101);
      const d = (px - x) * (px - x) + (pz - z) * (pz - z);
      if (d < f1) { f2 = f1; f1 = d; id = hash2(cx, cz, seed + 7); }
      else if (d < f2) f2 = d;
    }
  }
  _w[0] = Math.sqrt(f1); _w[1] = Math.sqrt(f2); _w[2] = id;
  return _w;
}

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const saturate = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export function smoothstep(a, b, x) {
  const t = saturate((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
export function smin(a, b, k) {
  const h = saturate(0.5 + (0.5 * (b - a)) / k);
  return lerp(b, a, h) - k * h * (1 - h);
}
export const smax = (a, b, k) => -smin(-a, -b, k);
