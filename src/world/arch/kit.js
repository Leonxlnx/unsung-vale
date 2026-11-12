// Building generators assembled from the MeshBuilder primitives. Everything is built in a
// local frame (origin on the ground, +y up) and placed with b.at(), except viaduct(), which
// works in world space because its piers follow the terrain.
import { M, archWall, archPanel, archFrame, archRise, column, spire, dome, balustrade } from './builder.js';
import { mulberry32 } from '../../util/noise.js';

const TAU = Math.PI * 2;

// Puts fn's local +z along the outward normal of face k of a regular prism.
function onFace(b, k, sides, y, apothem, fn) {
  const th = (k / sides) * TAU;
  b.push().rotateY(Math.PI / 2 - th).translate(0, y, apothem);
  fn(b);
  b.pop();
}

// A lancet window: glowing glass with a raised stone surround, facing +z at z = 0.
export function lancet(b, width, height, { detail = 1, sharp = 1.15, gold = false } = {}) {
  const rise = archRise(width, sharp), spring = Math.max(0.2, height - rise);
  b.mat_(M.GLASS); archPanel(b, 0, 0, 0.04, width, spring, sharp, detail ? 10 : 6);
  if (detail) {
    b.mat_(gold ? M.GOLD : M.MARBLE); archFrame(b, 0, 0, 0, width, spring, sharp, Math.max(0.14, width * 0.12), 0.16, 10);
    b.mat_(M.MARBLE).box(-width / 2 - 0.3, -0.22, 0, width + 0.6, 0.22, 0.3);
    if (width > 1.6) b.mat_(M.DARK).box(-0.05, 0, 0.05, 0.1, spring + rise * 0.55, 0.06);
  }
}

// Tower of stacked stages. top: 'spire' | 'dome' | 'crown'. Returns the total height.
export function tower(b, { r = 6, h = 40, sides = 8, stages = 3, top = 'spire', spireH, detail = 1, foot = 14, glassEvery = 1 } = {}) {
  const hs = h / stages;
  b.mat_(M.ASHLAR).prism(r * 1.14, r * 1.08, -foot, 0.01, sides);
  b.mat_(M.MARBLE).prism(r * 1.1, r * 1.1, 0, 0.9, sides, { capTop: true });
  let ri = r;
  for (let s = 0; s < stages; s++) {
    const y0 = s * hs, y1 = y0 + hs, rn = ri * 0.93;
    b.mat_(M.ASHLAR).prism(ri, ri, y0, y1, sides);
    // Cornice between stages; the top one is gilded.
    b.mat_(s === stages - 1 ? M.GOLD : M.MARBLE).lathe([[ri, y1 - 0.9], [ri + 0.38, y1 - 0.55], [ri + 0.52, y1 - 0.1], [ri + 0.52, y1], [rn, y1 + 0.01]], sides, { smooth: false, phase: Math.PI / sides });
    if (detail) b.mat_(M.FRIEZE).prism(ri + 0.06, ri + 0.06, y1 - 1.9, y1 - 0.9, sides);
    const ap = ri * Math.cos(Math.PI / sides), faceW = 2 * ri * Math.sin(Math.PI / sides);
    for (let k = 0; k < sides; k += glassEvery) {
      const w = Math.min(faceW * 0.36, 2.6), wh = hs * (s === stages - 1 ? 0.62 : 0.5);
      onFace(b, k, sides, y0 + hs * 0.2, ap, (q) => lancet(q, w, wh, { detail }));
      if (detail) onFace(b, k, sides, y0, ap, (q) => { q.mat_(M.MARBLE).box(-faceW / 2, 0, -0.02, 0.5, hs - 0.9, 0.3); });
    }
    ri = rn;
  }
  let y = h;
  // Parapet with corner pinnacles.
  b.mat_(M.MARBLE).prism(ri * 1.12, ri * 1.12, y, y + 1.1, sides, { capTop: true });
  if (detail && sides <= 8) {
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * TAU + Math.PI / sides;
      b.at(Math.cos(a) * ri * 1.08, y + 1.1, Math.sin(a) * ri * 1.08, 0, (q) => spire(q, ri * 0.1, ri * 0.85, { sides: 4, mat: M.MARBLE }));
    }
  }
  y += 1.1;
  if (top === 'spire') {
    const sh = spireH ?? h * 0.6;
    b.at(0, y, 0, 0, (q) => spire(q, ri * 0.96, sh, { sides }));
    y += sh * 1.1;
  } else if (top === 'dome') {
    b.mat_(M.ASHLAR).prism(ri * 0.9, ri * 0.9, y, y + ri * 0.5, 16);
    b.at(0, y + ri * 0.5, 0, 0, (q) => { y += ri * 0.5 + dome(q, ri * 0.92, { sides: detail ? 20 : 12, ribs: 8 }) * 1.7; });
  } else {
    b.at(0, y, 0, 0, (q) => spire(q, ri * 0.5, ri * 2.4, { sides }));
    y += ri * 2.6;
  }
  return y;
}

// Rectangular hall along x with buttressed bays, lancets and a pitched roof.
export function hall(b, { w = 40, d = 18, h = 24, bays = 6, detail = 1, foot = 14, door = true } = {}) {
  b.mat_(M.ASHLAR).box(-w / 2 - 0.8, -foot, -d / 2 - 0.8, w + 1.6, foot + 1.2, d + 1.6);
  b.box(-w / 2, 1.2, -d / 2, w, h - 1.2, d, '-y');
  b.mat_(M.MARBLE).box(-w / 2 - 0.5, h, -d / 2 - 0.5, w + 1.0, 0.9, d + 1.0);
  if (detail) b.mat_(M.FRIEZE).box(-w / 2 - 0.08, h - 1.3, -d / 2 - 0.08, w + 0.16, 1.3, d + 0.16, '+y-y');
  const bw = w / bays;
  for (const side of [1, -1]) {
    b.push(); if (side < 0) b.rotateY(Math.PI);
    for (let i = 0; i < bays; i++) {
      const cx = -w / 2 + (i + 0.5) * bw;
      b.at(cx, h * 0.16, d / 2, 0, (q) => lancet(q, Math.min(bw * 0.42, 3.4), h * 0.66, { detail }));
    }
    for (let i = 0; i <= bays; i++) {
      const x = -w / 2 + i * bw;
      b.mat_(M.ASHLAR).box(x - 0.7, 0, d / 2, 1.4, h * 0.82, 1.6, '-z');
      b.mat_(M.MARBLE).box(x - 0.8, h * 0.82, d / 2, 1.6, 0.4, 1.75, '-z');
      if (detail) b.at(x, h * 0.82 + 0.4, d / 2 + 0.85, 0, (q) => spire(q, 0.5, h * 0.22, { sides: 4, mat: M.MARBLE }));
    }
    b.pop();
  }
  // Gable ends: a great window over a doorway at +x, a window group at -x.
  for (const side of [1, -1]) {
    b.push(); b.rotateY(side > 0 ? Math.PI / 2 : -Math.PI / 2);
    b.at(0, h * 0.34, w / 2, 0, (q) => lancet(q, d * 0.3, h * 0.6, { detail, gold: true }));
    if (door && side > 0) {
      b.mat_(M.DARK); b.at(0, 0, w / 2, 0, (q) => archPanel(q, 0, 0, 0.05, d * 0.2, h * 0.16, 1.0, 8));
      b.mat_(M.GOLD); b.at(0, 0, w / 2, 0, (q) => archFrame(q, 0, 0, 0, d * 0.2, h * 0.16, 1.0, 0.3, 0.3, 8));
    }
    b.pop();
  }
  // Roof: two pitched slopes, gable infill and a gilded ridge.
  const rh = d * 0.5, y0 = h + 0.9, ex = w / 2 + 0.6, ez = d / 2 + 0.6;
  b.mat_(M.ROOF);
  b.quad([-ex, y0, ez], [ex, y0, ez], [ex, y0 + rh, 0], [-ex, y0 + rh, 0]);
  b.quad([ex, y0, -ez], [-ex, y0, -ez], [-ex, y0 + rh, 0], [ex, y0 + rh, 0]);
  b.mat_(M.ASHLAR);
  b.triFlat([ex, y0, ez], [ex, y0, -ez], [ex, y0 + rh, 0]);
  b.triFlat([-ex, y0, -ez], [-ex, y0, ez], [-ex, y0 + rh, 0]);
  b.mat_(M.GOLD).box(-ex, y0 + rh - 0.1, -0.22, ex * 2, 0.4, 0.44);
  if (detail) for (const sx of [-1, 1]) b.at(sx * ex, y0 + rh + 0.2, 0, 0, (q) => spire(q, 0.45, 5, { sides: 4, mat: M.GOLD }));
  return y0 + rh;
}

// Open pavilion: a ring of columns under a dome, on a stepped base.
export function pavilion(b, { r = 5, colH = 5.6, n = 8, detail = 1 } = {}) {
  b.mat_(M.PAVING).lathe([[r + 1.5, -3], [r + 1.5, 0.2], [r + 1.1, 0.2], [r + 1.1, 0.4], [r + 0.7, 0.4], [r + 0.7, 0.6], [0, 0.6]], detail ? 28 : 14);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    b.at(Math.cos(a) * (r - 0.35), 0.6, Math.sin(a) * (r - 0.35), 0, (q) => column(q, 0.34, colH, { sides: detail ? 12 : 6 }));
  }
  const y = 0.6 + colH, s = detail ? 28 : 14;
  b.mat_(M.MARBLE).lathe([[r - 1.0, y], [r + 0.12, y], [r + 0.12, y + 0.5]], s);
  b.mat_(M.FRIEZE).lathe([[r + 0.06, y + 0.5], [r + 0.06, y + 1.2]], s);
  b.mat_(M.GOLD).lathe([[r + 0.06, y + 1.2], [r + 0.4, y + 1.45], [r + 0.4, y + 1.6], [r - 0.3, y + 1.62]], s);
  b.at(0, y + 1.6, 0, 0, (q) => dome(q, r - 0.3, { sides: s, ribs: n }));
}

// Paved platform over a retaining wall. The local frame sits at the centre of the top.
// rail lists the edges that get a balustrade: any of 'n' (-z), 's' (+z), 'e' (+x), 'w' (-x).
export function terrace(b, { w = 30, d = 20, depth = 20, rail = 'nsew', detail = 1 } = {}) {
  b.mat_(M.ASHLAR).box(-w / 2, -depth, -d / 2, w, depth - 0.3, d, '+y-y');
  b.mat_(M.MARBLE).box(-w / 2 - 0.35, -0.75, -d / 2 - 0.35, w + 0.7, 0.45, d + 0.7);
  b.mat_(M.PAVING).box(-w / 2, -0.3, -d / 2, w, 0.3, d, '-y');
  // Shallow buttress strips break up the tall wall.
  const strip = (len, n, fn) => { for (let i = 0; i <= n; i++) fn(-len / 2 + (i * len) / n); };
  b.mat_(M.ASHLAR);
  strip(w, Math.max(2, Math.round(w / 9)), (x) => { b.box(x - 0.6, -depth, d / 2, 1.2, depth - 0.75, 0.55, '-z'); b.box(x - 0.6, -depth, -d / 2 - 0.55, 1.2, depth - 0.75, 0.55, '+z'); });
  strip(d, Math.max(2, Math.round(d / 9)), (z) => { b.box(w / 2, -depth, z - 0.6, 0.55, depth - 0.75, 1.2, '-x'); b.box(-w / 2 - 0.55, -depth, z - 0.6, 0.55, depth - 0.75, 1.2, '+x'); });
  if (rail.includes('s')) b.at(-w / 2, 0, d / 2 - 0.25, 0, (q) => balustrade(q, w, { detail }));
  if (rail.includes('n')) b.at(-w / 2, 0, -d / 2 + 0.25, 0, (q) => balustrade(q, w, { detail }));
  if (rail.includes('e')) b.at(w / 2 - 0.25, 0, d / 2, Math.PI / 2, (q) => balustrade(q, d, { detail }));
  if (rail.includes('w')) b.at(-w / 2 + 0.25, 0, d / 2, Math.PI / 2, (q) => balustrade(q, d, { detail }));
}

// Row of columns carrying pointed arches, running along +x from the origin. grand: piers of
// clustered shafts, moulded arches on both faces, a carved band and pinnacles over each pier.
export function arcade(b, length, { bay = 4.4, colH = 4.8, t = 0.9, top = 1.5, detail = 1, colR = 0.33, grand = false } = {}) {
  const n = Math.max(1, Math.round(length / bay)), bw = length / n;
  const gap = grand ? colR * 2.8 : 0.9, sides = detail ? 12 : 6;
  const rise = archRise(bw - gap, 0.85), yTop = colH + rise + top;
  for (let i = 0; i <= n; i++) {
    b.at(i * bw, 0, 0, 0, (q) => column(q, colR, colH, { sides }));
    if (grand) {
      for (const sz of [-1, 1]) b.at(i * bw, 0, sz * colR * 1.2, 0, (q) => column(q, colR * 0.42, colH, { sides: 8 }));
      b.at(i * bw, yTop + 0.22, 0, 0, (q) => spire(q, colR * 0.6, colR * 5, { sides: 4, mat: M.MARBLE }));
    }
  }
  b.mat_(M.MARBLE);
  for (let i = 0; i < n; i++) archWall(b, i * bw, (i + 1) * bw, colH, yTop, t, (i + 0.5) * bw, bw - gap, colH, 0.85, detail ? 12 : 6);
  if (grand) {
    for (let i = 0; i < n; i++) {
      const cx = (i + 0.5) * bw;
      b.mat_(M.MARBLE); archFrame(b, cx, colH, t / 2, bw - gap, colH, 0.85, 0.5, 0.24, 12);
      b.at(cx, 0, 0, Math.PI, (q) => archFrame(q, 0, colH, t / 2, bw - gap, colH, 0.85, 0.5, 0.24, 12));
    }
    b.mat_(M.FRIEZE).box(0, yTop - 1.0, -t / 2 - 0.06, length, 0.9, t + 0.12, '+y-y');
  }
  b.mat_(M.GOLD).box(0, yTop, -t / 2 - 0.12, length, 0.22, t + 0.24);
  return yTop + 0.22;
}

// Arched bridge from (ax, az) to (bx, bz) with its deck at deckY. Piers run down to the
// terrain; very tall piers get a second tier of arches part-way up.
export function viaduct(b, heightAt, ax, az, bx, bz, deckY, { width = 7, span = 24, detail = 1, parapet = true, slope = 0, balusters = false } = {}) {
  const L = Math.hypot(bx - ax, bz - az), yaw = Math.atan2(-(bz - az), bx - ax);
  const n = Math.max(1, Math.round(L / span)), bw = L / n, pw = Math.min(3.4, bw * 0.2);
  const open = bw - pw, sharp = 0.8, rise = archRise(open, sharp), spring = deckY - 1.5 - rise;
  const ux = (bx - ax) / L, uz = (bz - az) / L;
  b.push().translate(ax, 0, az).rotateY(yaw);
  if (slope) b.shearYX(slope);        // the deck climbs or falls along its length
  const lows = [];
  for (let i = 0; i <= n; i++) {
    const px = ax + ux * i * bw, pz = az + uz * i * bw;
    let low = Infinity;
    for (const o of [-3, 0, 3]) low = Math.min(low, heightAt(px - uz * o, pz + ux * o));
    low = Math.min(low - 3, spring - 2) - Math.max(0, slope * i * bw);
    lows.push(low);
    const hgt = spring - low;
    b.mat_(M.ASHLAR).box(i * bw - pw / 2, low, -width / 2 - 0.3, pw, hgt, width + 0.6, '-y');
    if (hgt > 22) b.box(i * bw - pw / 2 - 0.5, low, -width / 2 - 0.8, pw + 1, hgt * 0.45, width + 1.6, '-y');
    b.mat_(M.MARBLE);
    for (let y = spring - 0.5; y > low + 6; y -= 17) b.box(i * bw - pw / 2 - 0.25, y, -width / 2 - 0.55, pw + 0.5, 0.5, width + 1.1);
    if (detail) b.at(i * bw, deckY + (parapet ? 1.15 : 0), 0, 0, (q) => {
      for (const sz of [-1, 1]) { q.mat_(M.MARBLE).box(-0.3, 0, sz * (width / 2 - 0.1) - 0.3, 0.6, 0.5, 0.6); q.at(0, 0.5, sz * (width / 2 - 0.1), 0, (g) => spire(g, 0.24, 2.6, { sides: 4, mat: M.GOLD })); }
    });
  }
  b.mat_(M.ASHLAR);
  for (let i = 0; i < n; i++) {
    archWall(b, i * bw, (i + 1) * bw, spring, deckY - 0.5, width, (i + 0.5) * bw, open, spring, sharp, detail ? 14 : 8);
    // Second tier for the tallest spans.
    const low = Math.max(lows[i], lows[i + 1]);
    if (spring - low > 70) {
      const y2 = low + (spring - low) * 0.5;
      archWall(b, i * bw + pw / 2, (i + 1) * bw - pw / 2, y2 - rise, y2 + 2.4, width * 0.7, (i + 0.5) * bw, open, y2 - rise, sharp, detail ? 12 : 8);
    }
  }
  b.mat_(M.MARBLE).box(-1, deckY - 0.5, -width / 2 - 0.5, L + 2, 0.3, width + 1.0);
  b.mat_(M.PAVING).box(-1, deckY - 0.2, -width / 2, L + 2, 0.2, width, '-y');
  if (parapet) {
    if (detail) { for (const sz of [-1, 1]) b.at(0, deckY, sz * (width / 2 - 0.25), 0, (q) => balustrade(q, L, { detail: balusters ? 1 : 0 })); }
    else for (const sz of [-1, 1]) b.mat_(M.MARBLE).box(0, deckY, sz * (width / 2 - 0.25) - 0.15, L, 1.0, 0.3);
  }
  b.pop();
}

// A whole hill-top city block: plinth, hall, a great tower, lesser towers and a rotunda.
// Built in a local frame whose +z looks out over the valley.
export function citadel(b, { seed = 1, scale = 1, detail = 1 } = {}) {
  const rnd = mulberry32(seed * 977 + 5), S = scale;
  const rr = (a, c) => a + (c - a) * rnd();
  const W = rr(64, 86) * S, D = rr(44, 58) * S, deep = 46;
  // Plinth with blind arches along the valley face.
  b.at(0, 4 * S, 0, 0, (q) => terrace(q, { w: W, d: D, depth: deep, rail: 's', detail: detail ? 1 : 0 }));
  const nA = Math.round(W / (9 * S));
  for (let i = 0; i < nA; i++) {
    const cx = -W / 2 + (i + 0.5) * (W / nA);
    b.at(cx, 4 * S - 15 * S, D / 2 + 0.02, 0, (q) => { q.mat_(M.DARK); archPanel(q, 0, 0, 0.02, 4.6 * S, 6 * S, 1.0, 8); if (detail) { q.mat_(M.MARBLE); archFrame(q, 0, 0, 0, 4.6 * S, 6 * S, 1.0, 0.4 * S, 0.3, 8); } });
  }
  const y0 = 4 * S;
  // Hall across the back, great tower rising behind its centre.
  const hw = W * 0.62, hd = D * 0.36, hh = rr(22, 30) * S;
  b.at(0, y0, -D * 0.2, 0, (q) => hall(q, { w: hw, d: hd, h: hh, bays: Math.round(hw / (7 * S)), detail, foot: 2 }));
  const gh = rr(74, 112) * S;
  b.at(rr(-6, 6) * S, y0, -D * 0.2 - hd * 0.2, 0, (q) => tower(q, { r: 7.4 * S, h: gh, sides: 8, stages: 4, top: 'spire', spireH: gh * rr(0.5, 0.7), detail, foot: 4 }));
  // Lesser towers at the corners and flanks.
  const spots = [[-W * 0.42, -D * 0.34], [W * 0.42, -D * 0.34], [-W * 0.44, D * 0.3], [W * 0.44, D * 0.3], [-W * 0.2, -D * 0.44], [W * 0.22, -D * 0.44]];
  for (const [x, z] of spots) {
    if (rnd() < 0.18) continue;
    const th = rr(30, 68) * S, tr = rr(3.4, 5.2) * S;
    b.at(x, y0, z, rnd() * 0.4, (q) => tower(q, { r: tr, h: th, sides: rnd() < 0.5 ? 6 : 8, stages: th > 46 * S ? 3 : 2, top: rnd() < 0.72 ? 'spire' : 'dome', spireH: th * rr(0.5, 0.85), detail, foot: 6 }));
  }
  // Rotunda facing the valley.
  const rr0 = rr(8.5, 11.5) * S;
  b.at(rr(-10, 10) * S, y0, D * 0.2, 0, (q) => {
    q.mat_(M.ASHLAR).prism(rr0, rr0, 0, rr0 * 1.15, 16);
    q.mat_(M.GOLD).lathe([[rr0, rr0 * 1.15], [rr0 + 0.5 * S, rr0 * 1.2], [rr0 + 0.5 * S, rr0 * 1.27], [rr0 * 0.95, rr0 * 1.28]], 16, { smooth: false, phase: Math.PI / 16 });
    for (let k = 0; k < 16; k += 2) onFace(q, k, 16, rr0 * 0.2, rr0 * Math.cos(Math.PI / 16), (g) => lancet(g, rr0 * 0.2, rr0 * 0.8, { detail }));
    q.at(0, rr0 * 1.28, 0, 0, (g) => dome(g, rr0 * 0.95, { sides: detail ? 24 : 14, ribs: 12 }));
  });
  // A scatter of free-standing needle spires for the skyline.
  const needles = detail ? 5 : 3;
  for (let i = 0; i < needles; i++) {
    const x = rr(-W * 0.48, W * 0.48), z = rr(-D * 0.1, D * 0.44), nh = rr(16, 34) * S;
    b.at(x, y0, z, 0, (q) => { q.mat_(M.MARBLE).prism(1.3 * S, 1.1 * S, 0, nh * 0.45, 6, { capTop: true }); q.at(0, nh * 0.45, 0, 0, (g) => spire(g, 1.05 * S, nh * 0.7, { sides: 6, mat: M.MARBLE })); });
  }
}

// Lamp post with a glowing lantern head.
export function lantern(b, h = 3.2) {
  b.mat_(M.MARBLE).cbox(0, 0, 0, 0.5, 0.35, 0.5);
  b.mat_(M.DARK).lathe([[0.1, 0.35], [0.07, h * 0.5], [0.06, h - 0.55], [0.16, h - 0.5]], 6);
  b.mat_(M.GLASS).prism(0.2, 0.26, h - 0.5, h - 0.05, 4);
  b.mat_(M.GOLD).lathe([[0.3, h - 0.05], [0.2, h + 0.08], [0.04, h + 0.2], [0, h + 0.36]], 4, { smooth: false, phase: Math.PI / 4 });
  b.lathe([[0.22, h - 0.56], [0.28, h - 0.5], [0.22, h - 0.46]], 4, { smooth: false, phase: Math.PI / 4 });
}

// A stone bench: a thick slab on two carved supports, long axis along x.
export function bench(b, w = 2.3) {
  for (const sx of [-1, 1]) {
    b.mat_(M.MARBLE).box(sx * (w / 2 - 0.42) - 0.16, 0, -0.24, 0.32, 0.4, 0.48);
    b.box(sx * (w / 2 - 0.42) - 0.22, 0, -0.28, 0.44, 0.08, 0.56);
  }
  b.mat_(M.MARBLE).box(-w / 2, 0.4, -0.3, w, 0.13, 0.6);
  b.mat_(M.GOLD).box(-w / 2 + 0.06, 0.445, 0.3, w - 0.12, 0.04, 0.012);
  b.box(-w / 2 + 0.06, 0.445, -0.312, w - 0.12, 0.04, 0.012);
}

// A long stone trough for a bed of flowers, running along x and centred on the origin.
// Returns the height of the soil.
export function trough(b, len = 6, d = 0.62) {
  b.mat_(M.MARBLE).box(-len / 2, 0, -d / 2, len, 0.1, d);
  b.box(-len / 2 + 0.06, 0.1, -d / 2 + 0.06, len - 0.12, 0.34, d - 0.12);
  b.box(-len / 2, 0.44, -d / 2, len, 0.1, d);
  b.mat_(M.GOLD).box(-len / 2 + 0.05, 0.3, -d / 2 + 0.045, len - 0.1, 0.035, d - 0.09);
  b.mat_(M.DARK).box(-len / 2 + 0.1, 0.5, -d / 2 + 0.1, len - 0.2, 0.03, d - 0.2);
  return 0.5;
}

// A stone urn for a flowering shrub (the plant itself is added by the forest). Returns the
// height of the soil.
export function planter(b, r = 0.75) {
  b.mat_(M.MARBLE).lathe([[r * 0.62, 0], [r * 0.7, 0.08], [r * 0.5, 0.16], [r * 0.42, 0.36], [r * 0.9, 0.8], [r, 1.0], [r * 1.07, 1.04], [r * 1.07, 1.12], [r * 0.9, 1.12], [r * 0.86, 1.04]], 14);
  b.mat_(M.GOLD).lathe([[r * 0.94, 0.83], [r * 1.0, 0.87], [r * 0.96, 0.91]], 14);
  b.mat_(M.DARK).lathe([[r * 0.88, 1.05], [0, 1.07]], 14);
  return 1.05;
}

// An armillary sphere on a pedestal: gilded rings at different tilts around a small orb,
// echoing the great rings of the Lattice out over the valley.
export function armillary(b, R = 1.3) {
  const flat = { smooth: false, phase: Math.PI / 8 };
  b.mat_(M.MARBLE).lathe([[0.95, 0], [0.95, 0.22], [0.74, 0.32], [0.62, 1.15], [0.76, 1.25], [0.76, 1.36], [0, 1.36]], 8, flat);
  b.mat_(M.FRIEZE).prism(0.66, 0.64, 0.5, 1.0, 8);
  b.mat_(M.GOLD).lathe([[0.2, 1.36], [0.09, 1.46], [0.07, 1.95], [0.14, 2.0]], 8);
  const cy = 2.0 + R;
  const ring = (r, t) => b.lathe([[r - t, -t], [r + t, -t], [r + t, t], [r - t, t], [r - t, -t]], 40);
  b.push().translate(0, cy, 0);
  ring(R, 0.05);                                             // horizon ring
  b.push().rotateX(Math.PI / 2); ring(R * 0.98, 0.045); b.pop();       // meridian
  b.push().rotateZ(0.41).rotateX(0.2); ring(R * 0.86, 0.04); b.pop();   // ecliptic, tilted
  b.push().rotateY(0.9).rotateX(Math.PI / 2 - 0.5); ring(R * 0.72, 0.035); b.pop();
  // The axis and the orb at the centre.
  b.push().rotateZ(0.41); b.lathe([[0.022, -R * 1.08], [0.022, R * 1.08]], 6); b.pop();
  b.lathe([[0, -0.24], [0.17, -0.17], [0.24, 0], [0.17, 0.17], [0, 0.24]], 12);
  b.pop();
  return cy + R;
}

// A Tuning Spire: stepped dais, slender shaft, and four gilded prongs cradling a crystal
// (the crystal itself is a separate glowing mesh owned by the game). Returns the crystal height.
// Radius of the spire's shaft (to its corners) at height y, for a spire of height h.
export function spireRadius(y, h) {
  const y1 = h * 0.35, y2 = h * 0.7;
  return y < y1 ? 1.12 + (0.96 - 1.12) * ((y - 2.8) / (y1 - 2.8)) : 0.96 + (0.76 - 0.96) * ((y - y1) / (y2 - y1));
}
// The instrument at the heart of each site: a stepped plinth and an eight-sided pedestal
// carry a tall tapering shaft with gilded corners, crowned by four prongs that cradle the
// crystal. The game strings eight threads of light up its faces (see Game._buildSpires).
export function tuningSpire(b, h = 22) {
  const PI = Math.PI, flat = { smooth: false, phase: PI / 8 };
  b.mat_(M.PAVING).lathe([[5.2, -4], [5.2, 0.25], [4.4, 0.25], [4.4, 0.5], [3.6, 0.5], [3.6, 0.75], [0, 0.75]], 24);
  b.mat_(M.GOLD).lathe([[3.3, 0.76], [3.1, 0.77]], 24);
  // Pedestal: base moulding, a carved die between corner colonnettes, and a cornice.
  b.mat_(M.MARBLE).lathe([[2.0, 0.75], [2.0, 0.98], [1.8, 1.08], [1.66, 1.24]], 8, flat);
  b.mat_(M.FRIEZE).prism(1.52, 1.52, 1.24, 2.34, 8);
  b.mat_(M.MARBLE).lathe([[1.52, 2.34], [1.66, 2.42], [1.86, 2.52], [1.86, 2.68], [1.2, 2.8], [0, 2.8]], 8, flat);
  for (let k = 0; k < 8; k++) {
    const a = (k + 0.5) * PI / 4;
    b.at(Math.cos(a) * 1.6, 1.24, Math.sin(a) * 1.6, 0, (q) => q.mat_(M.MARBLE).lathe([[0.14, 0], [0.14, 0.07], [0.1, 0.12], [0.085, 0.96], [0.14, 1.03], [0.14, 1.1]], 8));
  }
  b.mat_(M.GOLD).lathe([[1.9, 2.69], [1.86, 2.72], [1.26, 2.82]], 8, flat);
  // Shaft, with a slim gilded rib up every corner and a boss at each end of every face
  // where a string is anchored.
  const y1 = h * 0.35, y2 = h * 0.7;
  b.mat_(M.MARBLE).lathe([[1.12, 2.8], [0.96, y1], [0.76, y2]], 8, flat);
  b.mat_(M.GOLD);
  for (let k = 0; k < 8; k++) {
    b.push().rotateY((k + 0.5) * PI / 4);
    for (const [r0, ya, r1, yb] of [[1.12, 2.8, 0.96, y1], [0.96, y1, 0.76, y2]]) {
      const w = 0.055, o = 0.04, t = 0.09;
      b.quad([r0 + o, ya, -w], [r1 + o, yb, -w], [r1 + o, yb, w], [r0 + o, ya, w]);
      b.quad([r0 + o, ya, w], [r1 + o, yb, w], [r1 + o - t, yb, w], [r0 + o - t, ya, w]);
      b.quad([r0 + o - t, ya, -w], [r1 + o - t, yb, -w], [r1 + o, yb, -w], [r0 + o, ya, -w]);
    }
    b.pop();
    b.push().rotateY(k * PI / 4);
    const c = Math.cos(PI / 8);
    for (const y of [3.0, y2 - 0.3]) { const r = spireRadius(y, h) * c; b.box(r - 0.03, y - 0.09, -0.09, 0.14, 0.18, 0.18); }
    b.pop();
  }
  for (const f of [0.3, 0.5]) { const r = spireRadius(h * f, h); b.lathe([[r, h * f - 0.12], [r + 0.12, h * f], [r, h * f + 0.12]], 8, flat); }
  b.lathe([[0.76, y2 - 0.16], [0.9, y2 - 0.04], [0.9, y2 + 0.04]], 8, flat);
  const cy = h * 0.86;
  for (let k = 0; k < 4; k++) {
    b.push().rotateY((k / 4) * Math.PI * 2 + Math.PI / 4);
    // Each prong sweeps out and back in around the crystal.
    const pts = [[0.55, h * 0.7], [1.5, h * 0.76], [1.75, h * 0.84], [1.3, h * 0.93], [0.5, h * 1.0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [r0, y0] = pts[i], [r1, yb] = pts[i + 1], w = 0.16 - i * 0.025;
      b.quad([r0, y0, -w], [r1, yb, -w], [r1, yb, w], [r0, y0, w]);
      b.quad([r0, y0, w], [r1, yb, w], [r1 - 0.2, yb, w], [r0 - 0.2, y0, w]);
      b.quad([r0 - 0.2, y0, -w], [r1 - 0.2, yb, -w], [r1, yb, -w], [r0, y0, -w]);
      b.quad([r0 - 0.2, y0, w], [r1 - 0.2, yb, w], [r1 - 0.2, yb, -w], [r0 - 0.2, y0, -w]);
    }
    b.pop();
  }
  b.mat_(M.MARBLE).lathe([[0.72, h * 0.7], [0.9, h * 0.72], [0.4, h * 0.76], [0, h * 0.77]], 8);
  return cy;
}
// A city stepping down a cliff face: stacked terraces, each a little narrower and further
// out than the one above. Every wall shows two storeys, a row of deep loggia arches under a
// row of paired lancets, divided by string courses; a roofed colonnade runs along the back
// of each deck and a domed pavilion crowns the top. Built in a frame whose +z points out
// from the cliff; y = 0 is the cliff top at the rim.
export function cliffTiers(b, { w = 70, tiers = 3, step = 22, out = 9, detail = 0, seed = 1 } = {}) {
  const rnd = mulberry32(seed * 131 + 7);
  for (let k = 0; k < tiers; k++) {
    const tw = w * (1 - k * 0.16), y = -k * step, z = k * out, d = 16, face = d / 2;
    b.at(0, y, z, 0, (q) => {
      terrace(q, { w: tw, d, depth: step + 26, rail: 's', detail: 0 });
      const n = Math.max(3, Math.round(tw / 8.5)), bw = tw / n;
      const y0 = -step + 0.4;                         // the deck of the tier below
      for (let i = 0; i < n; i++) {
        const cx = -tw / 2 + (i + 0.5) * bw;
        // Ground storey: a deep arch, dark inside, some with a lit room behind.
        const aw = bw * 0.56, spring = step * 0.24;
        q.at(cx, y0, face + 0.03, 0, (g) => {
          g.mat_(rnd() < 0.35 ? M.GLASS : M.DARK); archPanel(g, 0, 0, 0.02, aw, spring, 1.05, 8);
          g.mat_(M.MARBLE); archFrame(g, 0, 0, 0, aw, spring, 1.05, 0.4, 0.34, 8);
        });
        // Upper storey: a pair of slim lancets.
        const ly = y0 + step * 0.52, lh = step * 0.27;
        for (const sx of [-0.2, 0.2]) {
          q.at(cx + sx * bw, ly, face + 0.03, 0, (g) => {
            g.mat_(rnd() < 0.6 ? M.GLASS : M.DARK); archPanel(g, 0, 0, 0.02, bw * 0.17, lh * 0.72, 1.3, 6);
            g.mat_(M.MARBLE).box(-bw * 0.11, -0.3, 0, bw * 0.22, 0.3, 0.28);
          });
        }
        q.mat_(M.MARBLE).box(cx - bw / 2 - 0.35, -step - 4, face, 0.7, step + 3.2, 0.7, '-z');
      }
      // String courses between the storeys and a gilded cornice under the parapet.
      q.mat_(M.MARBLE).box(-tw / 2 - 0.2, y0 + step * 0.46, face, tw + 0.4, 0.42, 0.5, '-z');
      q.box(-tw / 2 - 0.2, y0 + step * 0.86, face, tw + 0.4, 0.34, 0.42, '-z');
      q.mat_(M.GOLD).box(-tw / 2, -1.1, face + 0.36, tw, 0.3, 0.12);
      if (k > 0) {
        // Colonnade against the wall of the tier above, under a lean-to roof of slate.
        const len = tw * 0.72, cz = 2.2, wall = -out + face;
        q.at(-len / 2, 0, cz, 0, (g) => {
          const top = arcade(g, len, { bay: 4.4, colH: 4.4, t: 0.7, top: 1.0, detail: 0 });
          g.mat_(M.ROOF).quad([-0.5, top, 0.6], [len + 0.5, top, 0.6], [len + 0.5, top + 2.6, wall - cz], [-0.5, top + 2.6, wall - cz]);
          g.mat_(M.MARBLE).box(-0.5, top - 0.25, 0.35, len + 1.0, 0.25, 0.3);
        });
      } else {
        // The crown of the quarter: a domed pavilion flanked by slender towers.
        q.at(0, 0, -1.5, 0, (g) => { pavilion(g, { r: 5.2, colH: 6.2, n: 8, detail: 0 }); });
      }
      // A few small towers and needles along the deck.
      for (let i = 0; i < 2 + (k === 0 ? 1 : 0); i++) {
        const side = i % 2 ? 1 : -1, x = side * tw * (0.3 + 0.16 * rnd()), th = 12 + rnd() * 16;
        q.at(x, 0, -d * 0.18, 0, (g) => tower(g, { r: 2.2 + rnd() * 1.4, h: th, sides: 6, stages: 2, top: rnd() < 0.7 ? 'spire' : 'dome', spireH: th * 0.8, detail: 0, foot: 1, glassEvery: 2 }));
      }
    });
  }
}
