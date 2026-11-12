// Slender white barges on the lake: something to measure the valley by, and a sign that
// people live here. Built from the same stone-and-gold materials as the architecture.
import * as THREE from 'three';
import { MeshBuilder, M, spire } from './arch/builder.js';
import { Shadows } from '../engine/shadows.js';

// One barge, bow toward +x, waterline at y = 0.
function barge(b, L = 9.5, W = 1.3) {
  const N = 12, st = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, mid = Math.sin(Math.PI * t);
    st.push({
      x: (t - 0.5) * L,
      w: W * Math.pow(Math.sin(Math.PI * (0.035 + 0.93 * t)), 0.62),
      draft: 0.12 + 0.3 * mid,
      sy: 0.5 + 1.15 * Math.pow(Math.abs(2 * t - 1), 3),          // the sheer rises to both ends
    });
  }
  // Emits a quad facing the given way, whatever order its corners come in.
  const q = (a, p, c, d, want) => {
    const ux = p[0] - a[0], uy = p[1] - a[1], uz = p[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    const facing = (uy * vz - uz * vy) * want[0] + (uz * vx - ux * vz) * want[1] + (ux * vy - uy * vx) * want[2];
    if (facing < 0) b.quad(a, d, c, p); else b.quad(a, p, c, d);
  };
  const deck = 0.36;
  for (let i = 0; i < N; i++) for (const s of [1, -1]) {
    const pts = [st[i], st[i + 1]].map((o) => ({
      K: [o.x, -o.draft, 0], B: [o.x, -o.draft * 0.45, s * 0.74 * o.w], G: [o.x, o.sy, s * o.w],
      Gi: [o.x, o.sy, s * 0.84 * o.w], D: [o.x, o.sy - deck, s * 0.8 * o.w], C: [o.x, o.sy - deck, 0],
    }));
    const [A, Z] = pts;
    b.mat_(M.MARBLE); q(A.K, Z.K, Z.B, A.B, [0, -1, s * 0.6]); q(A.B, Z.B, Z.G, A.G, [0, -0.25, s]);
    b.mat_(M.GOLD); q(A.G, Z.G, Z.Gi, A.Gi, [0, 1, 0]);
    b.mat_(M.MARBLE); q(A.Gi, Z.Gi, Z.D, A.D, [0, 0.2, -s]);
    b.mat_(M.DARK); q(A.D, Z.D, Z.C, A.C, [0, 1, 0]);
  }
  // Stem and stern posts sweep up and curl over, gilded.
  for (const [x0, dir, n, seg] of [[L / 2 - 0.1, 1, 7, 0.4], [-L / 2 + 0.1, -1, 5, 0.34]]) {
    b.push().translate(x0, st[0].sy - 0.1, 0);
    b.mat_(M.GOLD);
    for (let j = 0; j < n; j++) {
      // Lean out at first, then curl back over the boat.
      b.rotateZ(-dir * (j < 2 ? 0.16 : -0.42));
      b.box(-0.05, 0, -0.06, 0.1, seg, 0.12);
      b.translate(0, seg * 0.94, 0);
    }
    b.lathe([[0, -0.02], [0.13, 0.06], [0.16, 0.16], [0.1, 0.27], [0, 0.32]], 8);
    b.pop();
  }
  // A canopy amidships under a gilded pyramid roof, and a lantern at the bow.
  const cy = st[N / 2].sy - deck;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.at(sx * 0.95 - 0.3, cy, sz * 0.6, 0, (g) => g.mat_(M.DARK).lathe([[0.035, 0], [0.035, 1.55]], 6));
  b.mat_(M.MARBLE).box(-1.45, cy + 1.55, -0.8, 2.3, 0.08, 1.6);
  b.at(-0.3, cy + 1.63, 0, Math.PI / 4, (g) => spire(g, 1.0, 0.95, { sides: 4, mat: M.GOLD }));
  b.at(L * 0.33, st[9].sy - deck, 0, 0, (g) => {
    g.mat_(M.DARK).lathe([[0.03, 0], [0.03, 1.05]], 6);
    g.mat_(M.GLASS).prism(0.09, 0.12, 1.05, 1.3, 4);
    g.mat_(M.GOLD).lathe([[0.15, 1.3], [0.05, 1.4], [0, 1.5]], 4, { smooth: false, phase: Math.PI / 4 });
  });
}

export class Boats {
  constructor(pipe, terrain, material) {
    // [x, z, heading, scale]: out on the open water, and a pair moored below the southern quarter.
    const spots = [[-262, 18, 0.5, 1], [-148, -44, 2.6, 0.9], [-36, 74, -0.3, 1.1], [64, 124, 0.9, 1], [248, 44, 2.2, 1], [336, -14, -0.6, 0.9],
      [522, 22, 0.3, 1.15], [118, 168, 1.7, 0.9], [176, 172, 1.4, 1], [-420, -30, 0.2, 0.9], [700, -40, 2.8, 1]];
    const b = new MeshBuilder();
    this.count = 0;
    for (const [x, z, yaw, s] of spots) {
      if (terrain.heightAt(x, z) > -1.6) continue;       // only where the lake is deep enough to float
      b.push().translate(x, -0.04, z).rotateY(yaw).scale(s, s, s);
      barge(b);
      b.pop();
      this.count++;
    }
    this.group = new THREE.Group();
    if (!this.count) return;
    const mesh = new THREE.Mesh(b.build(), material);
    mesh.matrixAutoUpdate = false; mesh.frustumCulled = false;
    this.group.add(mesh);
    pipe.shadows.addCaster(mesh, Shadows.depthMaterial(), { dynamic: false, fixed: true });
  }
}
