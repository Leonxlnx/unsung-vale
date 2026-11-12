// Curtains of greenery spilling over the rims of the mesas: ribbons of leaf sprays that start
// on the turf at the edge and hang down the rock, following the face so they never float or
// sink into it. One static mesh per leaf kind for the whole playable core.
import * as THREE from 'three';
import { fbm, mulberry32 } from '../../util/noise.js';

export class CliffVines {
  // exclude(x, z) keeps the curtains off buildings, waterfalls and the walking routes.
  constructor(terrain, forest, exclude = () => false) {
    const H = (x, z) => terrain.heightAt(x, z), rnd = mulberry32(4711);
    const lists = { 4: [], 9: [], 1: [] };       // green leaves, wisteria, pink blossom
    const half = 1010, step = 2.5;
    let count = 0;
    for (let gz = -half; gz < half; gz += step) for (let gx = -half; gx < half; gx += step) {
      const x = gx + rnd() * step, z = gz + rnd() * step, r1 = rnd(), r2 = rnd(), r3 = rnd(), r4 = rnd(), r5 = rnd();
      const h = H(x, z);
      if (h < 24) continue;
      // Downhill over a few metres: a rim has a real drop on one side...
      const e = 3, dx = H(x - e, z) - H(x + e, z), dz = H(x, z - e) - H(x, z + e), g = Math.hypot(dx, dz);
      if (g < 7) continue;
      const nx = dx / g, nz = dz / g;
      // ...and level ground on the other.
      if (Math.abs(H(x - nx * 2.5, z - nz * 2.5) - h) > 1.1) continue;
      // The curtains come in stretches, with bare rock between them.
      const clump = fbm(x / 46, z / 46, 3, 913) * 0.5 + 0.5;
      if (r1 > (clump > 0.43 ? 0.9 : 0.12) || exclude(x, z)) continue;
      // Walk out to the edge itself.
      let s0 = -1;
      for (let s = 0; s <= 4.5; s += 0.25) if (H(x + nx * s, z + nz * s) < h - 0.9) { s0 = s; break; }
      if (s0 < 0) continue;
      const topY = H(x + nx * Math.max(0, s0 - 0.5), z + nz * Math.max(0, s0 - 0.5));
      // Mostly modest trails, with a broad cascade here and there that reads from across the valley.
      const w = 2.4 + 5.2 * r2 * r2, segH = w * (0.9 + 0.3 * r3), n = 2 + Math.floor(r4 * 4.2);
      // Rows of the ribbon: the first lies on the turf behind the edge, the rest hang down
      // the face, each pushed out to where the rock actually is at that depth.
      const rows = [{ s: s0 - 0.9, y: topY + 0.3 }];
      let s = s0;
      for (let k = 1; k <= n; k++) {
        const y = topY - k * segH + 0.2;
        let found = false;
        for (let m = 0; m < 40; m++, s += 0.2) if (H(x + nx * s, z + nz * s) <= y) { found = true; break; }
        if (!found) break;                        // a ledge: the curtain ends above it
        rows.push({ s: s + 0.32, y });
      }
      if (rows.length < 2) continue;
      const kind = r5 < 0.8 ? 4 : r5 < 0.93 ? 9 : 1;
      lists[kind].push({ x, z, nx, nz, w, rows, ph: rnd() * 6.283, r: rnd() });
      count++;
    }
    this.count = count;

    this.group = new THREE.Group();
    for (const layer of [4, 9, 1]) {
      const list = lists[layer];
      if (!list.length) continue;
      const pos = [], nrm = [], uv = [], wind = [], leaf = [], idx = [];
      for (const c of list) {
        const tx = -c.nz, tz = c.nx, last = c.rows.length - 1;
        const N = new THREE.Vector3(c.nx * 0.75, 0.62, c.nz * 0.75).normalize();
        for (let k = 0; k < last; k++) {
          const a = c.rows[k], b = c.rows[k + 1];
          // The ribbon narrows toward its free end.
          const wa = c.w * 0.5 * (1 - 0.42 * (k / last)), wb = c.w * 0.5 * (1 - 0.42 * ((k + 1) / last));
          const base = pos.length / 3;
          for (const [row, u, v, hw, d] of [[b, -1, 0, wb, k + 1], [b, 1, 0, wb, k + 1], [a, 1, 1, wa, k], [a, -1, 1, wa, k]]) {
            pos.push(c.x + c.nx * row.s + tx * u * hw, row.y, c.z + c.nz * row.s + tz * u * hw);
            nrm.push(N.x, N.y, N.z);
            uv.push(0.5 + u * 0.4, 0.08 + v * 0.86);
            wind.push(0, c.ph, (d / last) * 1.6);       // only the hanging end stirs
            leaf.push(0.12 + 0.22 * (d / last), c.r);
          }
          idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
      }
      const one = (arr) => new THREE.InstancedBufferAttribute(new Float32Array(arr), 4);
      const g = new THREE.InstancedBufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('aWind', new THREE.Float32BufferAttribute(wind, 3));
      g.setAttribute('aLeaf', new THREE.Float32BufferAttribute(leaf, 2));
      g.setIndex(idx);
      g.setAttribute('iTree', one([0, 0, 0, 1])); g.setAttribute('iParam', one([0, 0.45, layer, 0]));
      g.instanceCount = 1;
      // Two sprays across each card keep the leaves in scale on the broad cascades.
      const m = new THREE.Mesh(g, forest._mkLeaf(layer, [0, 0], {}, 2));
      m.frustumCulled = false; m.matrixAutoUpdate = false;
      this.group.add(m);
    }
  }
}
