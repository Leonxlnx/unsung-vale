// The Lattice: colossal rings standing over the mouth of the valley, around the low sun.
// They are the world's signature landmark and the thing the player's actions change.
import * as THREE from 'three';
import { MeshBuilder, M } from './arch/builder.js';

const TAU = Math.PI * 2;

// A ring in the local x/z plane (axis = y), built as a lathe with a faceted cross-section.
function ringBand(b, R, w, t, { sides = 180, teeth = 0, toothLen = 0 } = {}) {
  // Outer gilded rim, stone flanks, inner gilded rim.
  b.mat_(M.MARBLE).lathe([[R - w, -t], [R + w, -t]], sides);                        // lower flank
  b.lathe([[R + w, t], [R - w, t]], sides);                                          // upper flank
  b.mat_(M.GOLD).lathe([[R + w, -t], [R + w + t * 0.35, -t * 0.4], [R + w + t * 0.35, t * 0.4], [R + w, t]], sides);
  b.lathe([[R - w, t], [R - w - t * 0.3, t * 0.4], [R - w - t * 0.3, -t * 0.4], [R - w, -t]], sides);
  b.mat_(M.FRIEZE).lathe([[R - w * 0.45, -t * 1.04], [R + w * 0.45, -t * 1.04]], sides);
  b.lathe([[R + w * 0.45, t * 1.04], [R - w * 0.45, t * 1.04]], sides);
  // Regular blocks around the rim give the eye something to measure the size by.
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * TAU;
    b.push().rotateY(a).translate(R + w, 0, 0);
    b.mat_(M.MARBLE).box(0, -t * 0.7, -toothLen * 0.5, toothLen * 0.9, t * 1.4, toothLen);
    b.mat_(M.GOLD).box(toothLen * 0.9, -t * 0.35, -toothLen * 0.3, toothLen * 0.3, t * 0.7, toothLen * 0.6);
    b.pop();
  }
}

export class Lattice {
  constructor(pipe, material) {
    this.group = new THREE.Group();
    this.center = new THREE.Vector3(3700, 430, 760);
    this.rings = [];
    const make = (R, w, t, opts, rx, ry, rz, spin) => {
      const b = new MeshBuilder();
      ringBand(b, R, w, t, opts);
      if (opts.pendants) {
        // Long plumb spindles hanging inside the ring, like the weights of a great clock.
        for (let i = 0; i < opts.pendants; i++) {
          // The ring stands with local +x up, so pendants hang from the top arc toward -x.
          const a = Math.PI * (0.18 + 0.64 * (i / (opts.pendants - 1)));
          const L = 120 + 260 * Math.abs(Math.sin(i * 2.4 + 1));
          b.push().translate(Math.sin(a) * (R - w), 0, Math.cos(a) * (R - w)).rotateZ(Math.PI / 2);
          b.mat_(M.GOLD).lathe([[1.2, 0], [1.2, L * 0.82], [5.5, L * 0.86], [7.5, L * 0.92], [3.0, L * 0.97], [0, L]], 8);
          b.pop();
        }
      }
      const mesh = new THREE.Mesh(b.build(), material);
      mesh.frustumCulled = false;
      const pivot = new THREE.Group();
      pivot.position.copy(this.center);
      pivot.rotation.set(rx, ry, rz);
      pivot.add(mesh);
      this.group.add(pivot);
      this.rings.push({ mesh, pivot, spin, tris: b.triCount });
      return mesh;
    };
    // The great ring stands upright across the valley; the others tilt and turn within it.
    make(1500, 26, 15, { sides: 220, teeth: 72, toothLen: 30, pendants: 9 }, 0.0, 0.32, Math.PI / 2, 0.0);
    make(1010, 13, 8, { sides: 180, teeth: 48, toothLen: 18 }, 0.5, 0.1, Math.PI / 2 - 0.5, 0.006);
    make(1840, 5, 3.4, { sides: 220 }, -0.45, 0.5, Math.PI / 2 + 0.35, -0.004);
    make(640, 6, 4, { sides: 140, teeth: 36, toothLen: 10 }, 0.9, -0.3, Math.PI / 2 - 0.2, 0.011);
    this.group.updateMatrixWorld(true);
  }

  update(dt) {
    for (const r of this.rings) {
      if (!r.spin) continue;
      r.mesh.rotation.y += r.spin * dt;
      r.mesh.updateMatrixWorld();
    }
  }
}
