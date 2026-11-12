// World layout for the Unsung Vale: a west-to-east valley flanked by sheer mesas, opening onto
// plains toward the low sun. This file is pure data + math and is used both by the Node world
// builder (tools/build-world.mjs) and by the browser runtime, so they always agree.
import { fbm, gnoise, erodedFbm, ridged, hash2, mulberry32, saturate, smoothstep, lerp, clamp } from '../util/noise.js';

export const WORLD = {
  seed: 20261112,
  coreSize: 2048,     // metres covered by the 1 m/texel core map (centred on the origin)
  coreRes: 2048,
  regionSize: 16384,  // metres covered by the 8 m/texel region map
  regionRes: 2048,
  waterLevel: 0,
  heightMin: -64,     // quantisation range for the 16-bit height files
  heightMax: 3136,
  sun: { azimuthDeg: 16, elevationDeg: 10.5 },
};

// Hand-placed mesas for the playable core. h is the absolute top height in metres.
// ax squashes the footprint along its local x axis, rot rotates it.
export const CORE_MESAS = [
  { id: 'dawn',    x: -650, z: -70,  r: 150, h: 208, ax: 1.25, rot: 0.25, seed: 11 },
  { id: 'crown',   x: -960, z: -110, r: 290, h: 268, ax: 1.0,  rot: 0.0,  seed: 12 },
  { id: 'petal',   x: -335, z: -410, r: 185, h: 176, ax: 1.2,  rot: -0.3, seed: 13 },
  { id: 'cantor',  x: 95,   z: -525, r: 235, h: 150, ax: 1.3,  rot: 0.1,  seed: 14 },
  { id: 'east',    x: 575,  z: -440, r: 195, h: 128, ax: 1.1,  rot: 0.5,  seed: 15 },
  { id: 'south1',  x: -390, z: 430,  r: 225, h: 192, ax: 1.25, rot: 0.2,  seed: 16 },
  { id: 'aurel',   x: 115,  z: 545,  r: 265, h: 162, ax: 1.35, rot: -0.15, seed: 17 },
  { id: 'south3',  x: 640,  z: 440,  r: 205, h: 136, ax: 1.1,  rot: 0.4,  seed: 18 },
  { id: 'choir',   x: 150,  z: -15,  r: 92,  h: 84,  ax: 1.15, rot: 0.6,  seed: 19 },
  // Karst pinnacles standing in the lake.
  { id: 'pin1', x: -180, z: 60,   r: 26, h: 96,  ax: 1.0, rot: 0, seed: 21, pinnacle: true },
  { id: 'pin2', x: -95,  z: -120, r: 19, h: 64,  ax: 1.0, rot: 0, seed: 22, pinnacle: true },
  { id: 'pin3', x: 380,  z: 95,   r: 32, h: 118, ax: 1.2, rot: 1, seed: 23, pinnacle: true },
  { id: 'pin4', x: 455,  z: -70,  r: 17, h: 58,  ax: 1.0, rot: 0, seed: 24, pinnacle: true },
  { id: 'pin5', x: -330, z: -60,  r: 22, h: 74,  ax: 1.0, rot: 0, seed: 25, pinnacle: true },
  { id: 'pin6', x: 720,  z: 30,   r: 36, h: 102, ax: 1.3, rot: 2, seed: 26, pinnacle: true },
  { id: 'pin7', x: 15,   z: 170,  r: 15, h: 46,  ax: 1.0, rot: 0, seed: 27, pinnacle: true },
  // Far landmark mesa that carries the great tree.
  { id: 'elder', x: 2750, z: 1480, r: 430, h: 236, ax: 1.2, rot: 0.3, seed: 31 },
];

// Elevated pools on mesa tops. Each spills over the rim toward `out` (unit direction).
export const POOLS = [
  { id: 'petalPool',  x: -300, z: -330, r: 34, level: 173.2, depth: 3.0, out: [0.35, 0.94] },
  { id: 'cantorPool', x: 60,   z: -400, r: 46, level: 147.0, depth: 3.5, out: [0.1, 0.99] },
  { id: 'eastPool',   x: 560,  z: -330, r: 38, level: 125.2, depth: 3.0, out: [-0.2, 0.98] },
  { id: 'aurelPool',  x: 80,   z: 400,  r: 52, level: 159.0, depth: 3.5, out: [0.15, -0.99] },
  { id: 'south1Pool', x: -330, z: 320,  r: 40, level: 189.0, depth: 3.0, out: [0.3, -0.95] },
  { id: 'south3Pool', x: 600,  z: 330,  r: 36, level: 133.2, depth: 3.0, out: [-0.25, -0.97] },
  { id: 'crownPool',  x: -865, z: 65,   r: 44, level: 264.5, depth: 3.5, out: [0.75, 0.66] },
];

export function valleyAxisZ(x) {
  return 150 * Math.sin(x / 2600 + 0.2) + 50 * Math.sin(x / 1100 + 2.0) - 75;
}

export function valleyHalfWidth(x) {
  const head = smoothstep(-1500, -820, x);          // narrow gorge at the valley head
  const mouth = smoothstep(2200, 6200, x);          // opens into plains to the east
  return 46 + 224 * head + 2100 * mouth * mouth;
}

function mountainMask(x, z) {
  const zv = valleyAxisZ(x);
  const dn = zv - z, ds = z - zv;                   // distance north / south of the valley
  const north = smoothstep(1700, 5200, dn);
  const south = smoothstep(2600, 6800, ds) * 0.5;
  const west = smoothstep(-1500, -5200, x) * 0.9;
  const east = 1 - 0.88 * smoothstep(1200, 5200, x); // keep the sunward horizon low
  return Math.max(Math.max(north, south) * east, west * 0.85);
}

function lowland(x, z) {
  return 7 + 34 * fbm(x / 820, z / 820, 4, 91) + 5 * fbm(x / 140, z / 140, 3, 92);
}

function mountains(x, z) {
  const m = mountainMask(x, z);
  if (m <= 0) return 0;
  const wx = x + 900 * fbm(x / 5200, z / 5200, 2, 71);
  const wz = z + 900 * fbm(x / 5200 + 40, z / 5200, 2, 72);
  const e = erodedFbm(wx / 5200, wz / 5200, 8, 73);
  const r = ridged(wx / 2600, wz / 2600, 5, 74);
  const base = Math.pow(e, 1.35) * 2500 + r * r * 520 * e;
  return m * m * (base + 60);
}

// Generates the procedural mesas that fill the region around the hand-placed core.
export function buildMesas() {
  const out = CORE_MESAS.map((m) => ({ ...m }));
  const rnd = mulberry32(WORLD.seed);
  const cell = 540, half = 7700;
  for (let gz = -half; gz < half; gz += cell) {
    for (let gx = -half; gx < half; gx += cell) {
      const r0 = rnd(), r1 = rnd(), r2 = rnd(), r3 = rnd(), r4 = rnd(), r5 = rnd(), r6 = rnd();
      const x = gx + (0.15 + 0.7 * r0) * cell, z = gz + (0.15 + 0.7 * r1) * cell;
      if (Math.abs(x) < 1150 && Math.abs(z) < 1050) continue;          // core is hand-authored
      const east = smoothstep(3000, 6500, x);
      if (r2 < 0.22 + 0.6 * east) continue;
      if (mountainMask(x, z) > 0.42) continue;
      const r = lerp(130, 255, r3) * (1 - 0.3 * east);
      const d = Math.abs(z - valleyAxisZ(x));
      if (d < valleyHalfWidth(x) + r * 0.85) continue;
      let clash = false;
      for (const m of out) {
        if (Math.hypot(m.x - x, m.z - z) < (m.r + r) * 0.82) { clash = true; break; }
      }
      if (clash) continue;
      const far = smoothstep(300, 2600, d);
      const h = lerp(lerp(105, 180, r4), lerp(150, 330, r4), far) * (1 - 0.45 * east);
      out.push({ id: `m${out.length}`, x, z, r, h, ax: lerp(0.8, 1.45, r5), rot: r6 * 3.14, seed: 100 + out.length });
    }
  }
  return out;
}

function terrace(x, n, s) {
  if (x >= 1) return 1;
  const k = x * n, f = Math.floor(k), t = saturate((k - f) / s);
  return (f + t * t * (3 - 2 * t)) / n;
}

// Returns a height function h(x, z) plus the mesa list. The spatial grid keeps each query cheap.
export function makeTerrain() {
  const mesas = buildMesas();
  const G = 256, half = WORLD.regionSize / 2, gn = Math.ceil(WORLD.regionSize / G);
  const grid = Array.from({ length: gn * gn }, () => []);
  for (const m of mesas) {
    m.cos = Math.cos(m.rot); m.sin = Math.sin(m.rot);
    m.reach = m.r * Math.max(1, m.ax) * 1.45 + 110;
    m.run = m.pinnacle ? clamp(0.05 * m.h + 3, 4, 9) : clamp(0.085 * m.h + 6, 9, 34);
    m.ledges = m.pinnacle ? 2 : 2 + Math.floor(m.h / 85);
    const x0 = Math.max(0, Math.floor((m.x - m.reach + half) / G)), x1 = Math.min(gn - 1, Math.floor((m.x + m.reach + half) / G));
    const z0 = Math.max(0, Math.floor((m.z - m.reach + half) / G)), z1 = Math.min(gn - 1, Math.floor((m.z + m.reach + half) / G));
    for (let j = z0; j <= z1; j++) for (let i = x0; i <= x1; i++) grid[j * gn + i].push(m);
  }

  function floorHeight(x, z) {
    const zv = valleyAxisZ(x), w = valleyHalfWidth(x);
    const d = Math.abs(z - zv);
    const low = lowland(x, z);
    const bank = smoothstep(0.52 * w, 1.02 * w, d + 26 * fbm(x / 210, z / 210, 3, 55));
    const bed = -17 + 5 * fbm(x / 160, z / 160, 3, 56);
    let f = lerp(bed, Math.max(low, 5.5), bank);
    const blend = smoothstep(w, w + 420, d);
    f = lerp(f, low, blend * 0.85);
    // The plains to the east sink gently into a wide estuary that catches the sun.
    const sea = smoothstep(5200, 7800, x);
    f = lerp(f, Math.min(f, -6 + 10 * fbm(x / 900, z / 900, 3, 57)), sea);
    return f + mountains(x, z);
  }

  // Signed distance to a mesa boundary (negative inside), with layered edge noise.
  function mesaSd(m, x, z) {
    const dx = x - m.x, dz = z - m.z;
    const qx = (dx * m.cos + dz * m.sin) / m.ax, qz = -dx * m.sin + dz * m.cos;
    const dist = Math.hypot(qx, qz);
    if (dist > m.r * 1.45 + 110) return 1e9;
    const lobe = m.pinnacle ? 0.22 : 0.3;
    const n = fbm(x / (m.r * 0.6) + m.seed, z / (m.r * 0.6), 3, m.seed) * m.r * lobe
      + fbm(x / 36, z / 36, 3, m.seed + 3) * (m.pinnacle ? 4 : 10)
      + gnoise(x / 8.5, z / 8.5, m.seed + 5) * 1.7;
    return dist - m.r + n;
  }

  function height(x, z) {
    const base = floorHeight(x, z);
    let h = base;
    const gi = Math.floor((x + half) / G), gj = Math.floor((z + half) / G);
    if (gi >= 0 && gj >= 0 && gi < gn && gj < gn) {
      const list = grid[gj * gn + gi];
      for (let k = 0; k < list.length; k++) {
        const m = list[k];
        const sd = mesaSd(m, x, z);
        if (sd > 1e8) continue;
        const rise = m.h - base;
        if (rise <= 0) continue;
        let mh;
        if (sd >= 0) {
          mh = base + rise * 0.1 * Math.exp(-sd / (0.1 * m.h + 8));       // talus skirt
        } else {
          const u = saturate(-sd / m.run);
          const warp = 0.11 * fbm(x / 64, z / 64, 2, m.seed + 9);
          const t = terrace(saturate(Math.pow(u, 0.85) + warp * (1 - u) * u * 4), m.ledges, 0.4);
          const inside = saturate(-sd / (m.r * 0.5));
          const top = m.h + (m.pinnacle ? 5 * inside : 4.5 * fbm(x / 95, z / 95, 3, m.seed + 1) + 1.1 * fbm(x / 21, z / 21, 2, m.seed + 2) + 3 * inside);
          mh = base + (top - base) * (0.1 + 0.9 * t);
        }
        if (mh > h) h = mh;
      }
    }
    // Carve pools into the mesa tops and notch their rims toward the outflow.
    for (let k = 0; k < POOLS.length; k++) {
      const p = POOLS[k];
      const dx = x - p.x, dz = z - p.z;
      if (Math.abs(dx) > 160 || Math.abs(dz) > 160) continue;
      const d = Math.hypot(dx, dz) + 3.5 * gnoise(x / 13, z / 13, 300 + k);
      if (d < p.r + 6) {
        const bowl = p.level - p.depth * saturate(1 - (d / p.r) * (d / p.r)) + 0.9 * smoothstep(p.r - 2, p.r + 6, d);
        h = Math.min(h, lerp(bowl, h, smoothstep(p.r, p.r + 6, d)));
      }
      const along = dx * p.out[0] + dz * p.out[1];
      const across = Math.abs(-dx * p.out[1] + dz * p.out[0]);
      if (along > 0 && along < 150 && across < 9) {
        const lip = p.level - 0.55 - 0.004 * along;
        const chan = lerp(lip, h, smoothstep(3.2, 8.5, across));
        if (h > lip && h < p.level + 14) h = Math.min(h, chan);
      }
    }
    return h;
  }

  return { height, mesas, floorHeight, mesaSd };
}

export function sunDirection() {
  const az = (WORLD.sun.azimuthDeg * Math.PI) / 180, el = (WORLD.sun.elevationDeg * Math.PI) / 180;
  return [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
}

export { hash2 };
