// MeshBuilder: a small toolkit for assembling architecture out of code.
// Geometry is accumulated in world space with a per-vertex material id; the architecture
// shader textures everything with world-space triplanar mapping, so no UVs are needed.
import * as THREE from 'three';

export const M = { ASHLAR: 0, MARBLE: 1, GOLD: 2, ROOF: 3, PAVING: 4, FRIEZE: 5, GLASS: 6, DARK: 7 };

const TAU = Math.PI * 2;

export class MeshBuilder {
  constructor() {
    this.pos = []; this.nrm = []; this.mat = []; this.idx = [];
    this.m = new THREE.Matrix4();
    this.stack = [];
    this.matId = M.ASHLAR;
    this.flip = false;
    this._v = new THREE.Vector3(); this._n = new THREE.Vector3(); this._nm = new THREE.Matrix3();
  }
  get vertexCount() { return this.pos.length / 3; }
  get triCount() { return this.idx.length / 3; }

  // --- transform stack ---
  push() { this.stack.push(this.m.clone()); return this; }
  pop() { this.m.copy(this.stack.pop()); return this; }
  translate(x, y, z) { this.m.multiply(_t.makeTranslation(x, y, z)); return this; }
  rotateY(a) { this.m.multiply(_t.makeRotationY(a)); return this; }
  rotateX(a) { this.m.multiply(_t.makeRotationX(a)); return this; }
  rotateZ(a) { this.m.multiply(_t.makeRotationZ(a)); return this; }
  scale(x, y, z) { this.m.multiply(_t.makeScale(x, y, z)); return this; }
  // Shear so that y rises by k for every unit of local x (used for sloping bridge decks).
  shearYX(k) { this.m.multiply(_t.set(1, 0, 0, 0, k, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)); return this; }
  // Runs fn with a local frame at (x, y, z) rotated by yaw, then restores the transform.
  at(x, y, z, yaw, fn) { this.push().translate(x, y, z); if (yaw) this.rotateY(yaw); fn(this); return this.pop(); }
  mat_(id) { this.matId = id; return this; }

  // --- low level ---
  vert(x, y, z, nx, ny, nz) {
    const v = this._v.set(x, y, z).applyMatrix4(this.m);
    this._nm.getNormalMatrix(this.m);
    const n = this._n.set(nx, ny, nz).applyMatrix3(this._nm).normalize();
    this.pos.push(v.x, v.y, v.z); this.nrm.push(n.x, n.y, n.z); this.mat.push(this.matId);
    return this.pos.length / 3 - 1;
  }
  tri(a, b, c) { if (this.flip) this.idx.push(a, c, b); else this.idx.push(a, b, c); }
  // Flat quad from four points in counter-clockwise order seen from outside.
  quad(a, b, c, d) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const i0 = this.vert(a[0], a[1], a[2], nx, ny, nz), i1 = this.vert(b[0], b[1], b[2], nx, ny, nz);
    const i2 = this.vert(c[0], c[1], c[2], nx, ny, nz), i3 = this.vert(d[0], d[1], d[2], nx, ny, nz);
    this.tri(i0, i1, i2); this.tri(i0, i2, i3);
  }
  triFlat(a, b, c) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    this.tri(this.vert(a[0], a[1], a[2], nx, ny, nz), this.vert(b[0], b[1], b[2], nx, ny, nz), this.vert(c[0], c[1], c[2], nx, ny, nz));
  }

  // --- primitives ---
  // Axis-aligned box given its minimum corner and size. skip lists faces to leave out
  // ('+x','-x','+y','-y','+z','-z'), which saves triangles on hidden sides.
  box(x, y, z, sx, sy, sz, skip = '') {
    const x1 = x + sx, y1 = y + sy, z1 = z + sz;
    if (!skip.includes('+x')) this.quad([x1, y, z1], [x1, y, z], [x1, y1, z], [x1, y1, z1]);
    if (!skip.includes('-x')) this.quad([x, y, z], [x, y, z1], [x, y1, z1], [x, y1, z]);
    if (!skip.includes('+y')) this.quad([x, y1, z1], [x1, y1, z1], [x1, y1, z], [x, y1, z]);
    if (!skip.includes('-y')) this.quad([x, y, z], [x1, y, z], [x1, y, z1], [x, y, z1]);
    if (!skip.includes('+z')) this.quad([x, y, z1], [x1, y, z1], [x1, y1, z1], [x, y1, z1]);
    if (!skip.includes('-z')) this.quad([x1, y, z], [x, y, z], [x, y1, z], [x1, y1, z]);
    return this;
  }
  // Box centred on x/z, sitting on y.
  cbox(cx, y, cz, sx, sy, sz, skip) { return this.box(cx - sx / 2, y, cz - sz / 2, sx, sy, sz, skip); }

  // Surface of revolution around the local y axis. profile = [[radius, y], ...] bottom to top.
  // smooth controls shading around the circumference; a0..a1 limits the sweep (for ribs).
  lathe(profile, sides, { smooth = true, a0 = 0, a1 = TAU, capTop = false, capBottom = false, phase = 0 } = {}) {
    const full = Math.abs(a1 - a0 - TAU) < 1e-6;
    const n = profile.length;
    // Profile normals (in the r/y plane), averaged between neighbouring segments.
    const pn = profile.map((p, i) => {
      const a = profile[Math.max(0, i - 1)], b = profile[Math.min(n - 1, i + 1)];
      const dr = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dr, dy) || 1;
      return [dy / l, -dr / l];
    });
    for (let s = 0; s < sides; s++) {
      const t0 = a0 + ((a1 - a0) * s) / sides + phase, t1 = a0 + ((a1 - a0) * (s + 1)) / sides + phase;
      const tm = (t0 + t1) / 2;
      for (let i = 0; i < n - 1; i++) {
        const [r0, y0] = profile[i], [r1, y1] = profile[i + 1];
        if (r0 < 1e-5 && r1 < 1e-5) continue;
        const ring = (r, y, t, k, tn) => {
          const c = Math.cos(t), sn = Math.sin(t), cn = Math.cos(tn), snn = Math.sin(tn);
          // Per-segment profile normal when the profile has a hard corner is handled by the caller duplicating points.
          return this.vert(r * c, y, r * sn, pn[k][0] * cn, pn[k][1], pn[k][0] * snn);
        };
        const na = smooth ? t0 : tm, nb = smooth ? t1 : tm;
        const v00 = ring(r0, y0, t0, i, na), v01 = ring(r0, y0, t1, i, nb);
        const v10 = ring(r1, y1, t0, i + 1, na), v11 = ring(r1, y1, t1, i + 1, nb);
        if (r0 > 1e-5) this.tri(v00, v11, v01);
        if (r1 > 1e-5) this.tri(v00, v10, v11);
      }
    }
    const cap = (k, up) => {
      const [r, y] = profile[k];
      if (r < 1e-5) return;
      const c0 = this.vert(0, y, 0, 0, up ? 1 : -1, 0);
      for (let s = 0; s < sides; s++) {
        const t0 = a0 + ((a1 - a0) * s) / sides + phase, t1 = a0 + ((a1 - a0) * (s + 1)) / sides + phase;
        const a = this.vert(r * Math.cos(t0), y, r * Math.sin(t0), 0, up ? 1 : -1, 0), b = this.vert(r * Math.cos(t1), y, r * Math.sin(t1), 0, up ? 1 : -1, 0);
        if (up) this.tri(c0, b, a); else this.tri(c0, a, b);
      }
    };
    if (capTop) cap(n - 1, true);
    if (capBottom) cap(0, false);
    void full;
    return this;
  }

  // Straight prism between two heights with a regular polygon section (flat shaded).
  prism(r0, r1, y0, y1, sides, opts = {}) {
    return this.lathe([[r0, y0], [r1, y1]], sides, { smooth: false, phase: Math.PI / sides, ...opts });
  }

  // Extrudes a closed 2D outline (in the local x/y plane, counter-clockwise) through depth
  // along -z, without end caps. Used for mouldings and frames.
  ribbon(points, z0, z1, closed = true) {
    const n = points.length, m = closed ? n : n - 1;
    for (let i = 0; i < m; i++) {
      const a = points[i], b = points[(i + 1) % n];
      this.quad([a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]);
    }
    return this;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aMat', new THREE.Float32BufferAttribute(this.mat, 1));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

const _t = new THREE.Matrix4();

// --- shapes ---

// Points along an arch from the left springing to the right, in (x, y) with the springing
// line at y = 0. sharp = 0.5 gives a round arch, 1 an equilateral pointed one, more a lancet.
export function archCurve(width, sharp = 1, n = 12) {
  const half = width / 2, pts = [];
  if (sharp <= 0.5) {
    for (let i = 0; i <= n; i++) { const a = Math.PI * (1 - i / n); pts.push([Math.cos(a) * half, Math.sin(a) * half]); }
    return pts;
  }
  const R = sharp * width, cx = R - half, apex = Math.sqrt(Math.max(R * R - cx * cx, 0));
  const aEnd = Math.atan2(apex, -cx);      // angle at the apex seen from the left arc's centre
  const h = Math.floor(n / 2);
  for (let i = 0; i <= h; i++) { const a = Math.PI + (aEnd - Math.PI) * (i / h); pts.push([cx + Math.cos(a) * R, Math.sin(a) * R]); }
  for (let i = h - 1; i >= 0; i--) pts.push([-pts[i][0], pts[i][1]]);
  return pts;
}
export function archRise(width, sharp = 1) {
  if (sharp <= 0.5) return width / 2;
  const R = sharp * width, cx = R - width / 2;
  return Math.sqrt(Math.max(R * R - cx * cx, 0));
}

// A wall panel from x0..x1 and y0..y1, thickness t centred on z = 0, pierced by one arched
// opening centred at cx. Leaves the opening empty; faces both ways.
export function archWall(b, x0, x1, y0, y1, t, cx, width, springY, sharp = 1, n = 12) {
  const zf = t / 2, zb = -t / 2, xl = cx - width / 2, xr = cx + width / 2;
  const curve = archCurve(width, sharp, n).map(([x, y]) => [cx + x, springY + y]);
  const face = (z, front) => {
    const q = (a, bb, c, d) => (front ? b.quad([a[0], a[1], z], [bb[0], bb[1], z], [c[0], c[1], z], [d[0], d[1], z]) : b.quad([d[0], d[1], z], [c[0], c[1], z], [bb[0], bb[1], z], [a[0], a[1], z]));
    if (xl > x0 + 1e-4) q([x0, y0], [xl, y0], [xl, y1], [x0, y1]);
    if (x1 > xr + 1e-4) q([xr, y0], [x1, y0], [x1, y1], [xr, y1]);
    for (let i = 0; i < curve.length - 1; i++) q(curve[i], curve[i + 1], [curve[i + 1][0], y1], [curve[i][0], y1]);
  };
  face(zf, true); face(zb, false);
  // Jambs, intrados, top and ends.
  b.quad([xl, y0, zf], [xl, y0, zb], [xl, springY, zb], [xl, springY, zf]);
  b.quad([xr, y0, zb], [xr, y0, zf], [xr, springY, zf], [xr, springY, zb]);
  for (let i = 0; i < curve.length - 1; i++) {
    const p = curve[i], q = curve[i + 1];
    b.quad([p[0], p[1], zf], [p[0], p[1], zb], [q[0], q[1], zb], [q[0], q[1], zf]);
  }
  b.quad([x0, y1, zf], [x1, y1, zf], [x1, y1, zb], [x0, y1, zb]);
  b.quad([x0, y0, zb], [x0, y0, zf], [x0, y1, zf], [x0, y1, zb]);
  b.quad([x1, y0, zf], [x1, y0, zb], [x1, y1, zb], [x1, y1, zf]);
}

// A flat arched panel (glass, a recess or a door leaf) facing +z at depth z.
export function archPanel(b, cx, y0, z, width, springY, sharp = 1, n = 10) {
  const xl = cx - width / 2, xr = cx + width / 2;
  b.quad([xl, y0, z], [xr, y0, z], [xr, springY, z], [xl, springY, z]);
  const curve = archCurve(width, sharp, n).map(([x, y]) => [cx + x, springY + y]);
  for (let i = 0; i < curve.length - 1; i++) b.triFlat([cx, springY, z], [curve[i + 1][0], curve[i + 1][1], z], [curve[i][0], curve[i][1], z]);
}

// A raised moulding that follows an arch and its jambs, facing +z. Used to frame windows.
export function archFrame(b, cx, y0, z, width, springY, sharp, band, depth, n = 10) {
  const outer = archCurve(width + band * 2, sharp, n).map(([x, y]) => [cx + x, springY + y]);
  const inner = archCurve(width, sharp, n).map(([x, y]) => [cx + x, springY + y]);
  const zf = z + depth;
  for (let i = 0; i < outer.length - 1; i++) {
    b.quad([inner[i][0], inner[i][1], zf], [inner[i + 1][0], inner[i + 1][1], zf], [outer[i + 1][0], outer[i + 1][1], zf], [outer[i][0], outer[i][1], zf]);
    b.quad([outer[i][0], outer[i][1], zf], [outer[i + 1][0], outer[i + 1][1], zf], [outer[i + 1][0], outer[i + 1][1], z], [outer[i][0], outer[i][1], z]);
  }
  const xl = cx - width / 2, xr = cx + width / 2;
  b.box(xl - band, y0, z, band, springY - y0, depth, '-z');
  b.box(xr, y0, z, band, springY - y0, depth, '-z');
}

// --- kit pieces (all built around the local origin; position them with b.at) ---

// Classical column: plinth, base rings, tapered shaft, capital. Height includes everything.
export function column(b, radius, height, { sides = 12, shaftMat = M.MARBLE, gold = true } = {}) {
  const r = radius, h = height;
  b.mat_(M.MARBLE).cbox(0, 0, 0, r * 2.9, r * 0.5, r * 2.9);
  b.mat_(shaftMat).lathe([
    [r * 1.32, r * 0.5], [r * 1.36, r * 0.72], [r * 1.12, r * 0.86], [r * 1.18, r * 1.05], [r, r * 1.25],
    [r * 0.98, h * 0.4], [r * 0.84, h - r * 2.3],
  ], sides);
  b.mat_(gold ? M.GOLD : M.MARBLE).lathe([[r * 0.86, h - r * 2.3], [r * 0.98, h - r * 2.15], [r * 0.86, h - r * 2.0]], sides);
  b.mat_(M.MARBLE).lathe([[r * 0.84, h - r * 2.0], [r * 0.92, h - r * 1.5], [r * 1.25, h - r * 0.75], [r * 1.42, h - r * 0.45]], sides);
  b.cbox(0, h - r * 0.45, 0, r * 3.0, r * 0.45, r * 3.0);
}

// Needle spire with a gilded finial. The base ring sits at y = 0.
export function spire(b, radius, height, { sides = 8, mat = M.ROOF, finial = true } = {}) {
  const r = radius, h = height;
  b.mat_(M.MARBLE).prism(r * 1.12, r * 1.12, 0, r * 0.18, sides, { capTop: true });
  if (mat === M.ROOF) {
    // Slate below, gilded above: the upper spire is sheathed in gold and takes the evening sun.
    b.mat_(M.ROOF).lathe([[r, r * 0.18], [r * 0.8, h * 0.16], [r * 0.5, h * 0.48]], sides, { smooth: false, phase: Math.PI / sides });
    b.mat_(M.GOLD).lathe([[r * 0.5, h * 0.48], [r * 0.56, h * 0.487], [r * 0.56, h * 0.5], [r * 0.485, h * 0.507], [r * 0.2, h * 0.84], [r * 0.045, h]], sides, { smooth: false, phase: Math.PI / sides });
  } else {
    b.mat_(mat).lathe([[r, r * 0.18], [r * 0.8, h * 0.16], [r * 0.5, h * 0.48], [r * 0.2, h * 0.84], [r * 0.045, h]], sides, { smooth: false, phase: Math.PI / sides });
  }
  if (finial) {
    b.mat_(M.GOLD).lathe([[r * 0.1, h * 0.84], [r * 0.24, h * 0.86], [r * 0.24, h * 0.875], [r * 0.08, h * 0.89]], 8);
    b.lathe([[r * 0.045, h], [r * 0.13, h + r * 0.14], [r * 0.16, h + r * 0.28], [r * 0.1, h + r * 0.42], [r * 0.022, h + r * 0.6], [r * 0.012, h + r * 1.6], [0, h + r * 1.8]], 8);
  }
}

// Dome with gilded ribs and a lantern. kind 0 = hemisphere, 1 = pointed.
export function dome(b, radius, { kind = 1, sides = 20, ribs = 8, mat = M.MARBLE, lantern = true } = {}) {
  const r = radius, prof = [];
  const n = 12, top = kind === 1 ? 1.22 : 1.0;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 0.5;
    const bulge = kind === 1 ? 1 + 0.06 * Math.sin(a * 2) : 1;
    prof.push([Math.cos(a) * r * bulge * (kind === 1 ? Math.pow(Math.cos(a), 0.12) : 1), Math.sin(a) * r * top]);
  }
  prof[n][0] = r * 0.05;
  b.mat_(M.MARBLE).lathe([[r * 1.06, -r * 0.1], [r * 1.09, -r * 0.03], [r * 1.02, 0]], sides);
  b.mat_(mat).lathe(prof, sides);
  if (ribs) {
    b.mat_(M.GOLD);
    const rp = prof.map(([pr, py]) => [pr + r * 0.022, py]);
    const w = 0.055;
    for (let k = 0; k < ribs; k++) b.lathe(rp, 1, { a0: (k / ribs) * TAU - w / 2, a1: (k / ribs) * TAU + w / 2, smooth: false });
  }
  if (lantern) {
    const y = r * top;
    b.mat_(M.GOLD).lathe([[r * 0.1, y - r * 0.02], [r * 0.14, y + r * 0.05], [r * 0.07, y + r * 0.1], [r * 0.11, y + r * 0.2], [r * 0.03, y + r * 0.32], [r * 0.015, y + r * 0.75], [0, y + r * 0.82]], 8);
  }
  return r * top;
}

// Balustrade along +x from x = 0 to length, standing on y = 0, centred on z = 0.
export function balustrade(b, length, { height = 1.05, detail = 1 } = {}) {
  const postEvery = 3.2, nPosts = Math.max(1, Math.round(length / postEvery));
  const seg = length / nPosts;
  b.mat_(M.MARBLE);
  b.box(0, 0, -0.17, length, 0.14, 0.34);
  b.box(0, height - 0.16, -0.2, length, 0.16, 0.4);
  for (let i = 0; i <= nPosts; i++) {
    b.box(i * seg - 0.19, 0, -0.19, 0.38, height + 0.1, 0.38);
    b.at(i * seg, 0, 0, 0, (q) => q.mat_(M.GOLD).lathe([[0.1, height + 0.1], [0.17, height + 0.2], [0.11, height + 0.33], [0, height + 0.4]], 6));
    b.mat_(M.MARBLE);
  }
  if (detail > 0) {
    // Turned balusters between the posts.
    const per = Math.max(2, Math.round(seg / 0.42));
    for (let i = 0; i < nPosts; i++) for (let k = 1; k < per; k++) {
      b.at(i * seg + (k * seg) / per, 0.14, 0, 0, (q) => q.lathe([[0.075, 0], [0.105, 0.12], [0.05, 0.3], [0.085, 0.55], [0.05, height - 0.4], [0.075, height - 0.3]], 6));
    }
  } else {
    b.box(0, 0.14, -0.05, length, height - 0.3, 0.1);
  }
}

// Flight of steps rising along +x: total run and rise, width along z centred on 0.
export function stairs(b, run, rise, width, { solid = true } = {}) {
  const n = Math.max(1, Math.round(rise / 0.17)), tr = run / n, rs = rise / n;
  b.mat_(M.PAVING);
  // Each step keeps its riser (the face toward the foot of the flight); what is left out is
  // the back of a step, which the next one stands against.
  for (let i = 0; i < n; i++) b.box(i * tr, solid ? 0 : i * rs, -width / 2, tr + 0.02, solid ? (i + 1) * rs : rs, width, !solid ? '' : i === n - 1 ? '-y' : '-y+x');
}
