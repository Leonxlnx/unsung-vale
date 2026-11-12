// Collision world: the terrain height field, bounding-volume hierarchies over the walkable
// architecture and the boulders, and capsules for tree trunks. Characters are capsules; the
// camera and ground probes use rays.
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { WORLD, POOLS } from '../world/layout.js';

const _seg = new THREE.Line3(), _box = new THREE.Box3(), _tp = new THREE.Vector3(), _cp = new THREE.Vector3();
const _ray = new THREE.Ray(), _start = new THREE.Vector3();
const GRID = 8;                                   // metres per cell of the trunk grid
const gkey = (ix, iz) => (ix + 4096) * 8192 + (iz + 4096);

// Closest points between segments p1-q1 and p2-q2 (after Ericson). Writes them to c1 and c2
// and returns the squared distance between them.
function segSeg(p1, q1, p2, q2, c1, c2) {
  const d1x = q1.x - p1.x, d1y = q1.y - p1.y, d1z = q1.z - p1.z, d2x = q2.x - p2.x, d2y = q2.y - p2.y, d2z = q2.z - p2.z;
  const rx = p1.x - p2.x, ry = p1.y - p2.y, rz = p1.z - p2.z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z, e = d2x * d2x + d2y * d2y + d2z * d2z, f = d2x * rx + d2y * ry + d2z * rz;
  let s, t;
  if (a <= 1e-9 && e <= 1e-9) { s = t = 0; }
  else if (a <= 1e-9) { s = 0; t = Math.max(0, Math.min(1, f / e)); }
  else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= 1e-9) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
    else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z, den = a * e - b * b;
      s = den > 1e-9 ? Math.max(0, Math.min(1, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); } else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }
    }
  }
  c1.set(p1.x + d1x * s, p1.y + d1y * s, p1.z + d1z * s);
  c2.set(p2.x + d2x * t, p2.y + d2y * t, p2.z + d2z * t);
  return c1.distanceToSquared(c2);
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c1 = new THREE.Vector3(), _c2 = new THREE.Vector3();

export class CollisionWorld {
  constructor(terrain) {
    this.terrain = terrain;
    this.solids = [];        // { bvh, box }
    this.caps = [];          // flat: ax, ay, az, bx, by, bz, r per capsule
    this.grid = new Map();   // cell key -> capsule indices
    this.lazy = [];          // { cx, cz, r, build, done }: geometry built when the player nears
  }

  // Adds a world-space geometry (identity transform) as solid, walkable collision.
  addGeometry(geometry) {
    const bvh = new MeshBVH(geometry, { targetLeafSize: 8 });
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    this.solids.push({ bvh, box: geometry.boundingBox.clone().expandByScalar(2) });
  }

  // A solid capsule from a to b (arrays), e.g. a length of tree trunk. Not walkable.
  addCapsule(a, b, r) {
    const i = this.caps.length / 7;
    this.caps.push(a[0], a[1], a[2], b[0], b[1], b[2], r);
    const x0 = Math.floor((Math.min(a[0], b[0]) - r) / GRID), x1 = Math.floor((Math.max(a[0], b[0]) + r) / GRID);
    const z0 = Math.floor((Math.min(a[2], b[2]) - r) / GRID), z1 = Math.floor((Math.max(a[2], b[2]) + r) / GRID);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const k = gkey(ix, iz); let l = this.grid.get(k);
      if (!l) this.grid.set(k, l = []);
      l.push(i);
    }
  }

  // Registers geometry that is only built once the player comes within reach of (cx, cz).
  addLazy(cx, cz, r, build) { this.lazy.push({ cx, cz, r, build, done: false }); }

  // Builds the pending geometry nearest to (x, z); call once a frame with where the player is.
  stream(x, z, budget = 2) {
    for (let n = 0; n < budget; n++) {
      let best = null, bd = 1e9;
      for (const l of this.lazy) {
        if (l.done) continue;
        const d = Math.hypot(l.cx - x, l.cz - z) - l.r;
        if (d < 48 && d < bd) { bd = d; best = l; }
      }
      if (!best) return;
      best.done = true;
      const g = best.build();
      if (g) this.addGeometry(g);
    }
  }

  groundHeight(x, z) { return this.terrain.heightAt(x, z); }

  // Height of the water surface over (x, z): the lake at sea level, or a pool on a mesa.
  // Returns -Infinity where the ground is dry.
  waterLevel(x, z) {
    const g = this.terrain.heightAt(x, z);
    for (const p of POOLS) { const dx = x - p.x, dz = z - p.z; if (dx * dx + dz * dz < p.r * p.r && g < p.level) return p.level; }
    return g < WORLD.waterLevel ? WORLD.waterLevel : -Infinity;
  }

  // Highest solid surface under (x, z) at or below yFrom, including the terrain.
  floorBelow(x, yFrom, z, maxDrop = 60) {
    let best = this.terrain.heightAt(x, z);
    _ray.origin.set(x, yFrom, z); _ray.direction.set(0, -1, 0);
    for (const s of this.solids) {
      if (x < s.box.min.x || x > s.box.max.x || z < s.box.min.z || z > s.box.max.z) continue;
      const hit = s.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, maxDrop);
      if (hit && hit.point.y > best) best = hit.point.y;
    }
    return best;
  }

  // Distance to the first hit along a ray, or maxDist. Terrain is marched, meshes are exact.
  raycast(origin, dir, maxDist) {
    let best = maxDist;
    _ray.origin.copy(origin); _ray.direction.copy(dir);
    for (const s of this.solids) {
      if (!_ray.intersectsBox(s.box)) continue;
      const hit = s.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, best);
      if (hit && hit.distance < best) best = hit.distance;
    }
    // Trunks: ray against each nearby capsule's cylinder.
    if (this.caps.length) {
      const C = this.caps, ex = origin.x + dir.x * best, ez = origin.z + dir.z * best;
      const x0 = Math.floor((Math.min(origin.x, ex) - 2) / GRID), x1 = Math.floor((Math.max(origin.x, ex) + 2) / GRID);
      const z0 = Math.floor((Math.min(origin.z, ez) - 2) / GRID), z1 = Math.floor((Math.max(origin.z, ez) + 2) / GRID);
      if ((x1 - x0) * (z1 - z0) < 400) for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
        const l = this.grid.get(gkey(ix, iz));
        if (!l) continue;
        for (const i of l) {
          const o = i * 7, r = C[o + 6];
          const bax = C[o + 3] - C[o], bay = C[o + 4] - C[o + 1], baz = C[o + 5] - C[o + 2];
          const oax = origin.x - C[o], oay = origin.y - C[o + 1], oaz = origin.z - C[o + 2];
          const baba = bax * bax + bay * bay + baz * baz, bard = bax * dir.x + bay * dir.y + baz * dir.z, baoa = bax * oax + bay * oay + baz * oaz;
          const rdoa = dir.x * oax + dir.y * oay + dir.z * oaz, oaoa = oax * oax + oay * oay + oaz * oaz;
          const A = baba - bard * bard, B = baba * rdoa - baoa * bard, Cc = baba * oaoa - baoa * baoa - r * r * baba;
          const h = B * B - A * Cc;
          if (h < 0 || A < 1e-9) continue;
          const t = (-B - Math.sqrt(h)) / A, y = baoa + t * bard;
          if (t > 0 && t < best && y > 0 && y < baba) best = t;
        }
      }
    }
    const T = this.terrain, step = 0.5;
    for (let t = step; t < best; t += step) {
      const x = origin.x + dir.x * t, y = origin.y + dir.y * t, z = origin.z + dir.z * t;
      if (y < T.heightAt(x, z) + 0.05) { best = Math.max(0, t - step); break; }
    }
    return best;
  }

  // Pushes a capsule (feet at pos, given radius and height) out of the solids.
  // Returns true if it ended up standing on something.
  resolveCapsule(pos, radius, height, velY) {
    let grounded = false;
    _seg.start.set(pos.x, pos.y + radius, pos.z);
    _seg.end.set(pos.x, pos.y + height - radius, pos.z);
    _start.copy(_seg.start);
    for (const s of this.solids) {
      _box.makeEmpty(); _box.expandByPoint(_seg.start); _box.expandByPoint(_seg.end);
      _box.min.addScalar(-radius); _box.max.addScalar(radius);
      if (!_box.intersectsBox(s.box)) continue;
      s.bvh.shapecast({
        intersectsBounds: (b) => b.intersectsBox(_box),
        intersectsTriangle: (tri) => {
          const d = tri.closestPointToSegment(_seg, _tp, _cp);
          if (d < radius) {
            const depth = radius - d;
            const dir = _cp.sub(_tp);
            const l = dir.length();
            if (l < 1e-6) dir.set(0, 1, 0); else dir.multiplyScalar(1 / l);
            _seg.start.addScaledVector(dir, depth); _seg.end.addScaledVector(dir, depth);
          }
        },
      });
    }
    const dx = _seg.start.x - _start.x, dy = _seg.start.y - _start.y, dz = _seg.start.z - _start.z;
    pos.x += dx; pos.y += dy; pos.z += dz;
    // Being pushed mostly upward while not rising means there is a floor underneath.
    if (dy > Math.abs(Math.hypot(dx, dz)) * 0.7 && dy > 1e-5 && velY <= 0.01) grounded = true;
    this.resolveTrunks(pos, radius, height);
    return grounded;
  }

  // Slides a capsule around the tree trunks: pushed out sideways only, never up or down.
  resolveTrunks(pos, radius, height) {
    if (!this.caps.length) return;
    const C = this.caps, ix0 = Math.floor((pos.x - radius - 1.5) / GRID), ix1 = Math.floor((pos.x + radius + 1.5) / GRID), iz0 = Math.floor((pos.z - radius - 1.5) / GRID), iz1 = Math.floor((pos.z + radius + 1.5) / GRID);
    for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
      const l = this.grid.get(gkey(ix, iz));
      if (!l) continue;
      for (const i of l) {
        const o = i * 7, min = radius + C[o + 6];
        _seg.start.set(pos.x, pos.y + radius, pos.z); _seg.end.set(pos.x, pos.y + height - radius, pos.z);
        _a.set(C[o], C[o + 1], C[o + 2]); _b.set(C[o + 3], C[o + 4], C[o + 5]);
        const d2 = segSeg(_seg.start, _seg.end, _a, _b, _c1, _c2);
        if (d2 >= min * min) continue;
        let nx = _c1.x - _c2.x, nz = _c1.z - _c2.z;
        const nl = Math.hypot(nx, nz);
        if (nl < 1e-4) { nx = 1; nz = 0; } else { nx /= nl; nz /= nl; }
        const depth = min - Math.sqrt(d2);
        pos.x += nx * depth; pos.z += nz * depth;
      }
    }
  }
}
