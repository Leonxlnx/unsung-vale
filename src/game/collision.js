// Collision world: the terrain height field plus bounding-volume hierarchies over the
// walkable architecture. Characters are capsules; the camera and ground probes use rays.
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

const _seg = new THREE.Line3(), _box = new THREE.Box3(), _tp = new THREE.Vector3(), _cp = new THREE.Vector3();
const _ray = new THREE.Ray(), _start = new THREE.Vector3();

export class CollisionWorld {
  constructor(terrain) {
    this.terrain = terrain;
    this.solids = [];        // { bvh, box }
  }

  // Adds a world-space geometry (identity transform) as solid, walkable collision.
  addGeometry(geometry) {
    const bvh = new MeshBVH(geometry, { maxLeafTris: 8 });
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    this.solids.push({ bvh, box: geometry.boundingBox.clone().expandByScalar(2) });
  }

  groundHeight(x, z) { return this.terrain.heightAt(x, z); }

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
    return grounded;
  }
}
