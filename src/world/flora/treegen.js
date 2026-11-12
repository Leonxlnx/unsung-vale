// Procedural tree generator. Grows a branching skeleton from a species description and turns
// it into two meshes: wood (tapered tubes) and leaves (cards that carry a baked cluster
// texture). Everything is deterministic for a given seed.
import { mulberry32 } from '../../util/noise.js';

const UP = [0, 1, 0];
const GOLDEN = 2.399963;

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a, b, t) => a + (b - a) * t;

function perp(d) {
  const a = Math.abs(d[1]) < 0.9 ? UP : [1, 0, 0];
  return norm(cross(d, a));
}
function rotateAround(v, axis, ang) {
  const c = Math.cos(ang), s = Math.sin(ang), d = dot(v, axis), cr = cross(axis, v);
  return [v[0] * c + cr[0] * s + axis[0] * d * (1 - c), v[1] * c + cr[1] * s + axis[1] * d * (1 - c), v[2] * c + cr[2] * s + axis[2] * d * (1 - c)];
}

// Species table. Lengths are in metres. crown(t) gives the relative canopy radius at height
// fraction t of the crown, which shapes the silhouette.
export const SPECIES = {
  ember: {       // broad crimson maple
    height: [11, 17], trunkR: 0.42, lean: 0.12, branchStart: 0.28, n1: [9, 12], n2: [4, 6], n3: [3, 4],
    spread: 0.62, crown: (t) => Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.92 + 0.08)), 0.55), tropism: 0.1, droop: 0.0,
    wiggle: 0.34, cardSize: [1.5, 2.3], cardsPerTwig: 4, leaf: 0,
  },
  blossom: {     // spreading pink cherry with drooping tips
    height: [6.5, 10], trunkR: 0.3, lean: 0.22, branchStart: 0.3, n1: [7, 10], n2: [4, 6], n3: [3, 4],
    spread: 0.82, crown: (t) => Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.8 + 0.2)), 0.45), tropism: 0.02, droop: 0.42,
    wiggle: 0.42, cardSize: [1.2, 1.8], cardsPerTwig: 4, leaf: 1,
  },
  elder: {       // tall pale-lilac tree
    height: [15, 23], trunkR: 0.55, lean: 0.08, branchStart: 0.36, n1: [10, 13], n2: [4, 6], n3: [3, 4],
    spread: 0.5, crown: (t) => Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.1)), 0.7), tropism: 0.16, droop: 0.12,
    wiggle: 0.3, cardSize: [1.7, 2.5], cardsPerTwig: 4, leaf: 2,
  },
  cypress: {     // slender dark column
    height: [13, 24], trunkR: 0.26, lean: 0.03, branchStart: 0.06, n1: [26, 34], n2: [2, 3], n3: [0, 0],
    spread: 0.085, crown: (t) => 0.35 + 0.65 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.78 + 0.2)), 0.6) * (1 - t * 0.55), tropism: 0.55, droop: 0.0,
    wiggle: 0.12, cardSize: [1.3, 1.9], cardsPerTwig: 3, leaf: 3,
  },
  great: {       // the Elder: a tree the size of a mountain, crowned in pale blossom
    height: [470, 470], trunkR: 30, lean: 0.05, branchStart: 0.34, n1: [26, 26], n2: [9, 10], n3: [4, 5],
    spread: 0.7, crown: (t) => Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.86 + 0.14)), 0.5), tropism: 0.1, droop: 0.1,
    wiggle: 0.3, cardSize: [30, 48], cardsPerTwig: 5, leaf: 2,
  },
  green: {       // generic green broadleaf for forest mass
    height: [10, 16], trunkR: 0.4, lean: 0.1, branchStart: 0.3, n1: [8, 11], n2: [4, 5], n3: [3, 4],
    spread: 0.56, crown: (t) => Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.1)), 0.6), tropism: 0.12, droop: 0.05,
    wiggle: 0.34, cardSize: [1.5, 2.2], cardsPerTwig: 4, leaf: 4,
  },
};

export function generateTree(speciesName, seed) {
  const sp = SPECIES[speciesName];
  const rnd = mulberry32(seed * 7919 + 13);
  const range = (r) => lerp(r[0], r[1], rnd());
  const irange = (r) => Math.round(lerp(r[0], r[1], rnd()));
  const H = range(sp.height);
  const crownR = H * sp.spread;
  const branches = [];   // { pts: [[x,y,z]], radii: [r], level, phase }
  const cards = [];      // { c: [x,y,z], n: [x,y,z], t: [x,y,z], size, phase }

  // Grows one branch as a polyline. Returns its points so children can attach.
  function grow(start, dir, length, r0, level, segs, bend, phase) {
    const pts = [start], radii = [r0];
    let d = dir, p = start;
    const segLen = length / segs;
    for (let i = 1; i <= segs; i++) {
      const t = i / segs;
      const side = perp(d);
      const w = sp.wiggle * (level === 0 ? 0.35 : 1);
      d = norm(add(add(d, mul(rotateAround(side, d, rnd() * 6.283), (rnd() - 0.2) * w)), mul(UP, bend(t))));
      p = add(p, mul(d, segLen));
      pts.push(p);
      radii.push(Math.max(0.012, r0 * Math.pow(1 - t * 0.82, level === 0 ? 0.9 : 1.15)));
    }
    branches.push({ pts, radii, level, phase });
    return pts;
  }
  const at = (pts, t) => {
    const f = t * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(f)), u = f - i;
    return { p: add(mul(pts[i], 1 - u), mul(pts[i + 1], u)), d: norm(sub(pts[i + 1], pts[i])) };
  };

  // Trunk with a gentle lean and root flare.
  const leanDir = rotateAround([1, 0, 0], UP, rnd() * 6.283);
  const trunk = grow([0, -0.4, 0], norm(add(UP, mul(leanDir, sp.lean * (0.4 + rnd())))), H * 0.96 + 0.4, sp.trunkR * (H / lerp(sp.height[0], sp.height[1], 0.5)), 0, 9, () => 0.05, 0);
  const trunkR = (t) => branches[0].radii[Math.min(branches[0].radii.length - 1, Math.round(t * (branches[0].radii.length - 1)))];
  const crownBase = H * sp.branchStart, crownH = H - crownBase;
  const crownCenter = [trunk[trunk.length - 1][0] * 0.6, crownBase + crownH * 0.55, trunk[trunk.length - 1][2] * 0.6];

  function leafCards(pts, count, sizeMul, phase) {
    for (let k = 0; k < count; k++) {
      const { p, d } = at(pts, count === 1 ? 1 : 0.45 + 0.55 * (k / (count - 1)));
      const out = norm(sub(p, crownCenter));
      // Cards lean between facing outward and facing up, with a random spin around the twig.
      let n = norm(add(add(mul(out, 0.6), mul(UP, 0.35 + 0.5 * rnd())), mul(rotateAround(perp(d), d, rnd() * 6.283), 0.75)));
      if (sp.leaf === 3) n = norm(add(mul(out, 1.0), mul(rotateAround(perp(d), d, rnd() * 6.283), 0.35)));   // conifer sprays hug the column
      const t = sp.leaf === 3 ? norm(add(UP, mul(out, 0.25))) : norm(cross(n, add(d, [0.01, 0.02, 0.03])));
      const size = range(sp.cardSize) * sizeMul;
      const c = add(p, mul(out, size * 0.18));
      if (sp.droop > 0) c[1] -= size * 0.25 * sp.droop;
      cards.push({ c, n, t, size, phase });
      // Every other cluster gets a second card at right angles so the crown has volume from any side.
      if (sp.leaf !== 3 && k % 2 === 0) cards.push({ c: add(c, mul(n, size * 0.12)), n: norm(cross(n, t)), t, size: size * 0.9, phase });
    }
  }

  const n1 = irange(sp.n1);
  for (let k = 0; k < n1; k++) {
    const tf = (k + 0.3 + rnd() * 0.5) / n1;
    const ht = lerp(sp.branchStart, 0.97, Math.pow(tf, 0.85));
    const { p, d } = at(trunk, ht);
    const az = k * GOLDEN + rnd() * 0.6;
    const side = rotateAround(perp(d), d, az);
    const crownT = (ht - sp.branchStart) / (1 - sp.branchStart);
    const elev = sp.leaf === 3 ? lerp(0.9, 0.5, crownT) : lerp(1.35, 0.35, Math.pow(crownT, 0.9));   // radians from the trunk axis
    const dir = norm(add(mul(d, Math.cos(elev)), mul(side, Math.sin(elev))));
    const length = Math.max(0.6, crownR * sp.crown(crownT) * (0.75 + 0.5 * rnd()));
    const phase = rnd() * 6.283;
    const r0 = Math.min(trunkR(ht) * 0.6, 0.05 + length * 0.028);
    const droop = sp.droop;
    const b1 = grow(p, dir, length, r0, 1, sp.leaf === 3 ? 4 : 7, (t) => sp.tropism * (1 - t) * 0.5 - droop * t * t * 0.6, phase);
    if (sp.leaf === 3) { leafCards(b1, 3, 1, phase); }
    else {
      // Large cards deep inside the crown close the gaps so the canopy reads as a solid mass.
      for (const ft of [0.55, 0.85]) {
        const f = at(b1, ft);
        cards.push({ c: f.p, n: norm(add(UP, mul(side, 0.4))), t: f.d, size: range(sp.cardSize) * 2.1, phase, fill: true });
      }
    }
    const n2 = irange(sp.n2);
    for (let j = 0; j < n2; j++) {
      const bt = lerp(0.28, 0.98, (j + rnd() * 0.6) / n2);
      const a = at(b1, bt);
      const s2 = rotateAround(perp(a.d), a.d, j * GOLDEN * 1.7 + rnd());
      const ang = lerp(0.5, 0.95, rnd());
      const d2 = norm(add(add(mul(a.d, Math.cos(ang)), mul(s2, Math.sin(ang))), mul(UP, 0.12)));
      const l2 = length * (1 - bt * 0.55) * lerp(0.42, 0.7, rnd());
      const b2 = grow(a.p, d2, l2, r0 * (1 - bt * 0.7) * 0.6, 2, 5, (t) => sp.tropism * 0.3 - droop * t * 0.75, phase + j);
      if (sp.leaf !== 3) leafCards(b2, 2, 1.15, phase + j);   // fill the inside of the crown
      const n3 = irange(sp.n3);
      if (n3 === 0) { leafCards(b2, sp.cardsPerTwig, 1, phase + j); continue; }
      for (let i = 0; i < n3; i++) {
        const ct = lerp(0.3, 1.0, (i + rnd() * 0.5) / n3);
        const c = at(b2, ct);
        const s3 = rotateAround(perp(c.d), c.d, i * GOLDEN * 2.1 + rnd());
        const d3 = norm(add(add(mul(c.d, 0.75), mul(s3, 0.7)), mul(UP, 0.1 - droop * 0.9)));
        const b3 = grow(c.p, d3, l2 * lerp(0.3, 0.5, rnd()), 0.03, 3, 3, (t) => -droop * t * 0.9, phase + j + i * 0.3);
        leafCards(b3, sp.cardsPerTwig, 1, phase + j + i * 0.3);
      }
    }
  }

  // Measure the crown from the cards so shading can tell inner leaves from the outer shell.
  let cx = 0, cy = 0, cz = 0;
  for (const c of cards) { cx += c.c[0]; cy += c.c[1]; cz += c.c[2]; }
  const cc = [cx / cards.length, cy / cards.length, cz / cards.length];
  let maxR = 0;
  for (const c of cards) maxR = Math.max(maxR, len(sub(c.c, cc)));

  return { species: speciesName, height: H, crownCenter: cc, crownRadius: maxR, branches, cards, leafKind: sp.leaf };
}

// --- mesh building ---

// Tubes along every branch up to maxLevel. Returns typed arrays ready for a BufferGeometry.
// aWind = (sway weight by height, branch phase, flutter weight).
export function buildWood(tree, maxLevel = 3, radialByLevel = [9, 6, 4, 3]) {
  const pos = [], nrm = [], uv = [], wind = [], idx = [];
  const H = tree.height;
  for (const b of tree.branches) {
    if (b.level > maxLevel) continue;
    const R = radialByLevel[b.level];
    const base = pos.length / 3;
    let prevN = null, vAcc = 0;
    for (let i = 0; i < b.pts.length; i++) {
      const p = b.pts[i];
      const d = norm(sub(b.pts[Math.min(i + 1, b.pts.length - 1)], b.pts[Math.max(i - 1, 0)]));
      // Parallel transport keeps the tube from twisting.
      let n = prevN ? norm(sub(prevN, mul(d, dot(prevN, d)))) : perp(d);
      prevN = n;
      const bi = cross(d, n);
      let r = b.radii[i];
      if (b.level === 0) r *= 1 + 1.1 * Math.exp(-Math.max(0, p[1]) * 1.6);   // root flare
      if (i > 0) vAcc += len(sub(p, b.pts[i - 1]));
      for (let k = 0; k <= R; k++) {
        const a = (k / R) * 6.283185;
        const o = add(mul(n, Math.cos(a)), mul(bi, Math.sin(a)));
        // Slight lumps on the trunk so it is not a perfect cylinder.
        const lump = b.level === 0 ? 1 + 0.07 * Math.sin(a * 3 + p[1] * 0.9) + 0.05 * Math.sin(a * 5 - p[1] * 1.7) : 1;
        pos.push(p[0] + o[0] * r * lump, p[1] + o[1] * r * lump, p[2] + o[2] * r * lump);
        nrm.push(o[0], o[1], o[2]);
        uv.push((k / R) * Math.max(1, Math.round(r * 6.283 / 0.9)), vAcc / 0.9);
        const sway = Math.pow(Math.max(0, p[1]) / H, 1.5);
        wind.push(sway, b.phase, b.level >= 2 ? i / (b.pts.length - 1) : 0);
      }
    }
    for (let i = 0; i < b.pts.length - 1; i++) for (let k = 0; k < R; k++) {
      const a = base + i * (R + 1) + k, c = a + R + 1;
      idx.push(a, a + 1, c, a + 1, c + 1, c);
    }
  }
  return { position: new Float32Array(pos), normal: new Float32Array(nrm), uv: new Float32Array(uv), wind: new Float32Array(wind), index: new Uint32Array(idx) };
}

// Leaf cards. keep = fraction of cards to keep (LODs keep fewer, larger cards).
// aWind = (sway weight, phase, flutter weight); aLeaf = (inner 0..1, random 0..1).
export function buildLeaves(tree, keep = 1, sizeMul = 1) {
  const pos = [], nrm = [], uv = [], wind = [], leaf = [], idx = [];
  const H = tree.height, cc = tree.crownCenter;
  const rnd = mulberry32(991);
  const step = 1 / keep;
  let acc = 0;
  for (const c of tree.cards) {
    acc += 1;
    if (acc < step) continue;
    acc -= step;
    const s = c.size * sizeMul * 0.5;
    const t = c.t, b = norm(cross(c.n, t));
    const out = norm(sub(c.c, cc));
    // Soft "ball" normals read as a full canopy instead of flat cards.
    const n = norm(add(mul(out, 0.72), mul(c.n, 0.28)));
    const inner = Math.max(c.fill ? 0.72 : 0, 1 - Math.min(1, len(sub(c.c, cc)) / tree.crownRadius));
    const r = rnd();
    const flip = rnd() < 0.5 ? -1 : 1;
    const base = pos.length / 3;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const [u, v] of corners) {
      pos.push(c.c[0] + (t[0] * u + b[0] * v) * s, c.c[1] + (t[1] * u + b[1] * v) * s, c.c[2] + (t[2] * u + b[2] * v) * s);
      nrm.push(n[0], n[1], n[2]);
      uv.push(flip * u * 0.5 + 0.5, v * 0.5 + 0.5);
      wind.push(Math.pow(Math.max(0, c.c[1]) / H, 1.5), c.phase, 1);
      leaf.push(inner, r);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { position: new Float32Array(pos), normal: new Float32Array(nrm), uv: new Float32Array(uv), wind: new Float32Array(wind), leaf: new Float32Array(leaf), index: new Uint32Array(idx) };
}
