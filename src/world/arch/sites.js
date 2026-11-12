// Places architecture in the world: the far cities that crown the mesas, the viaducts that
// link them, and (in sites added below) the hand-laid places the player walks through.
import * as THREE from 'three';
import { MeshBuilder } from './builder.js';
import { citadel, viaduct, terrace, arcade, pavilion, lantern, tuningSpire, tower, hall } from './kit.js';
import { M, column, balustrade, stairs, archWall, archRise } from './builder.js';
import { createArchMaterial } from './archMaterial.js';
import { Shadows } from '../../engine/shadows.js';
import { valleyAxisZ, CORE_MESAS } from '../layout.js';
import { hash2 } from '../../util/noise.js';

export class Architecture {
  constructor(pipe, terrain, mesas) {
    this.pipe = pipe; this.terrain = terrain; this.mesas = mesas;
    this.material = createArchMaterial(pipe, terrain);
    this.depthMaterial = Shadows.depthMaterial();
    this.group = new THREE.Group();
    this.stats = { meshes: 0, tris: 0 };
  }

  // Finishes a builder into a mesh. near = also drawn into the camera cascades.
  add(builder, { near = false } = {}) {
    const mesh = new THREE.Mesh(builder.build(), this.material);
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
    const c = mesh.geometry.boundingSphere.center;
    const inCore = Math.max(Math.abs(c.x), Math.abs(c.z)) < 1150;
    if (inCore) this.pipe.shadows.addCaster(mesh, this.depthMaterial, { dynamic: near, fixed: true });
    this.stats.meshes++; this.stats.tris += builder.triCount;
    return mesh;
  }

  // Citadel on a mesa, set toward the valley rim and facing out over it.
  citadelOn(mesa, { seed, scale = 1, detail = 0, along = 0, inset = 0.42 } = {}) {
    const side = Math.sign(valleyAxisZ(mesa.x) - mesa.z) || 1;
    const x = mesa.x + along, z = mesa.z + side * mesa.r * inset;
    const T = this.terrain;
    const h0 = Math.min(T.heightAt(x, z), T.heightAt(x + 20, z), T.heightAt(x - 20, z), T.heightAt(x, z + 15), T.heightAt(x, z - 15));
    const b = new MeshBuilder();
    b.at(x, h0, z, side > 0 ? 0 : Math.PI, (q) => citadel(q, { seed, scale, detail }));
    return this.add(b);
  }

  buildFarCities() {
    const core = new Set(CORE_MESAS.map((m) => m.id));
    const byId = Object.fromEntries(this.mesas.map((m) => [m.id, m]));
    // The named cities around the playable valley.
    this.citadelOn(byId.aurel, { seed: 11, scale: 1.35, detail: 1, along: 70, inset: 0.3 });
    this.citadelOn(byId.crown, { seed: 12, scale: 1.2, detail: 1, along: -20, inset: 0.2 });
    this.citadelOn(byId.south1, { seed: 13, scale: 0.85, detail: 0, along: -60, inset: 0.4 });
    this.citadelOn(byId.south3, { seed: 14, scale: 0.95, detail: 0, along: 20, inset: 0.35 });
    this.citadelOn(byId.elder, { seed: 15, scale: 1.5, detail: 0, inset: 0.55 });
    // Smaller holds scattered over the outer mesas.
    const chosen = [];
    for (const m of this.mesas) {
      if (core.has(m.id) || m.pinnacle || m.r < 150) continue;
      const d = Math.abs(m.z - valleyAxisZ(m.x));
      const p = d < 900 ? 0.62 : d < 2200 ? 0.34 : 0.14;
      if (hash2(Math.round(m.x), Math.round(m.z), 77) > p) continue;
      const s = 0.55 + 0.6 * hash2(Math.round(m.x), Math.round(m.z), 78);
      this.citadelOn(m, { seed: 100 + chosen.length, scale: s, detail: 0 });
      chosen.push(m);
    }
    // Viaducts between neighbouring holds of similar height.
    const T = this.terrain, hAt = (x, z) => T.heightAt(x, z);
    let spans = 0;
    for (let i = 0; i < chosen.length && spans < 14; i++) for (let j = i + 1; j < chosen.length; j++) {
      const a = chosen[i], c = chosen[j];
      const d = Math.hypot(a.x - c.x, a.z - c.z), gap = d - a.r - c.r;
      if (gap > 260 || gap < 20 || Math.abs(a.h - c.h) > 45) continue;
      const ux = (c.x - a.x) / d, uz = (c.z - a.z) / d;
      const deck = Math.min(a.h, c.h) - 4;
      const b = new MeshBuilder();
      viaduct(b, hAt, a.x + ux * (a.r * 0.78), a.z + uz * (a.r * 0.78), c.x - ux * (c.r * 0.78), c.z - uz * (c.r * 0.78), deck, { width: 9, span: 34, detail: 0 });
      this.add(b);
      spans++;
      break;
    }
    return chosen.length;
  }
  // The places the player walks through, west to east: the Dawn Terrace where the game
  // starts, the high viaduct to the Petal Court, the long stair down to Cantor's Rise, the
  // gate where the light bridge begins, and the Choir on its island mesa.
  // Returns the gameplay anchors (spawn, spires, bridge ends) and the collision geometry.
  buildPlayable() {
    const T = this.terrain, H = (x, z) => T.heightAt(x, z);
    const out = { spires: [], solids: [], lanterns: [] };
    const finish = (b) => { const m = this.add(b, { near: true }); out.solids.push(m.geometry); return m; };
    const lamp = (b, x, y, z) => { b.at(x, y, z, 0, (q) => lantern(q)); out.lanterns.push([x, y + 2.95, z]); };

    // --- Dawn Terrace ---
    {
      const b = new MeshBuilder(), cx = -512, cz = -70, y = 210.4;
      // Local +z looks east over the valley, local +x runs north.
      b.at(cx, y, cz, Math.PI / 2, (q) => {
        terrace(q, { w: 42, d: 26, depth: 36, rail: '', detail: 1 });
        // Railing along the valley edge, left open where the lookout joins.
        for (const sx of [-1, 1]) q.at(sx > 0 ? 7.2 : -21, 0, 12.75, 0, (g) => balustrade(g, 13.8, { detail: 1 }));
        // Round lookout bastion pushing out over the drop.
        q.at(0, 0, 13, 0, (g) => {
          g.mat_(M.ASHLAR).lathe([[7.4, -36], [7.4, -0.75]], 24);
          g.mat_(M.MARBLE).lathe([[7.4, -0.75], [7.8, -0.6], [7.8, -0.3], [7.4, -0.3]], 24);
          g.mat_(M.PAVING).lathe([[7.4, -0.3], [7.4, 0], [0, 0]], 24);
          g.mat_(M.GOLD).lathe([[4.6, 0.012], [4.3, 0.014]], 32);
          g.lathe([[2.2, 0.012], [2.0, 0.014]], 24);
          for (let k = 0; k < 7; k++) {
            const a0 = (k / 7) * Math.PI, a1 = ((k + 1) / 7) * Math.PI;
            const x0 = Math.cos(a0) * 7.05, z0 = Math.sin(a0) * 7.05, x1 = Math.cos(a1) * 7.05, z1 = Math.sin(a1) * 7.05;
            g.at(x0, 0, z0, Math.atan2(-(z1 - z0), x1 - x0), (r) => balustrade(r, Math.hypot(x1 - x0, z1 - z0), { detail: 1 }));
          }
        });
        // Side arcades framing the view.
        for (const sx of [-1, 1]) q.at(sx * 17.5, 0, -11, -Math.PI / 2, (g) => arcade(g, 20, { bay: 5, colH: 5.2, detail: 1 }));
        // Broad steps down to the meadow behind (the stair frame rises toward the terrace).
        const rise = y - H(cx - 13 - 7, cz) + 0.3, run = rise * 2.3;
        q.at(0, -rise, -13 - run, -Math.PI / 2, (g) => stairs(g, run, rise, 18));
        for (const sx of [-1, 1]) q.mat_(M.ASHLAR).box(sx * 9.6 - 0.5, -rise - 2, -13 - run, 1.0, rise + 2.9, run);
      });
      for (const [dx, dz] of [[12.5, 20], [12.5, -20], [-12.5, 20], [-12.5, -20], [20.3, 0]]) lamp(b, cx + dx, y, cz + dz);
      // A small domed pavilion on the south lawn.
      const px = -540, pz = -22;
      b.at(px, H(px, pz) + 0.05, pz, 0, (q) => pavilion(q, { r: 4.6, colH: 5.2, n: 8, detail: 1 }));
      finish(b);
      out.spawn = { x: cx - 7, y: y + 0.1, z: cz, yaw: Math.PI / 2 };
      out.vista = { x: cx + 14, y: y + 1.7, z: cz };
    }

    // --- High viaduct: Dawn -> Petal ---
    {
      const b = new MeshBuilder();
      const a = [-566, -161], c = [-450, -286], ya = 210.2, yc = 178.5;
      const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
      viaduct(b, H, a[0], a[1], c[0], c[1], ya, { width: 6.4, span: 28, detail: 1, slope: (yc - ya) / L });
      finish(b);
    }

    // --- Petal Court: first spire in a ring of weathered columns ---
    {
      const b = new MeshBuilder(), sx = -372, sz = -392, y = H(sx, sz);
      b.at(sx, y, sz, 0, (q) => {
        q.mat_(M.PAVING).lathe([[19, -6], [19, 0.12], [0, 0.12]], 36);
        q.mat_(M.GOLD).lathe([[12.4, 0.13], [12.0, 0.135]], 36);
        const cyl = tuningSpire(q, 22);
        out.spires.push({ id: 'petal', x: sx, y: y + cyl, z: sz, base: y });
        for (let k = 0; k < 12; k++) {
          if (k === 3 || k === 8) continue;       // gaps where columns have fallen
          const a0 = (k / 12) * Math.PI * 2;
          q.at(Math.cos(a0) * 16.5, 0.12, Math.sin(a0) * 16.5, 0, (g) => column(g, 0.42, k % 5 === 0 ? 3.2 : 6.4, { sides: 12 }));
        }
      });
      for (const a0 of [0.6, 2.2, 3.8, 5.4]) lamp(b, sx + Math.cos(a0) * 20.5, H(sx + Math.cos(a0) * 20.5, sz + Math.sin(a0) * 20.5), sz + Math.sin(a0) * 20.5);
      finish(b);
    }

    // --- The long stair: Petal -> Cantor's Rise ---
    {
      const b = new MeshBuilder(), bx = -118, bz = -459, y0 = H(bx, bz) - 0.1, rise = 25.4, run = 56;
      b.at(bx, y0, bz, Math.PI, (q) => {
        stairs(q, run, rise, 9);
        // Stepped flank walls and two guardian towers at the foot.
        for (let i = 0; i < 7; i++) {
          const x = (i * run) / 7, h = ((i + 1) * rise) / 7;
          for (const sz of [-1, 1]) q.mat_(M.ASHLAR).box(x, -3, sz * 4.5 - 0.5, run / 7 + 0.1, h + 4.2, 1.0);
          for (const sz of [-1, 1]) q.mat_(M.MARBLE).box(x - 0.1, h + 1.2, sz * 4.5 - 0.6, run / 7 + 0.3, 0.25, 1.2);
        }
        q.mat_(M.PAVING).box(run, rise - 0.4, -7, 9, 0.4, 14);
      });
      for (const sz of [-1, 1]) b.at(bx + 5, y0, bz + sz * 9.5, 0, (q) => tower(q, { r: 2.6, h: 17, sides: 6, stages: 2, top: 'spire', spireH: 12, detail: 1, foot: 8 }));
      finish(b);
    }

    // --- Cantor's Rise: second spire before a hall, and the gate over the drop ---
    {
      const b = new MeshBuilder(), sx = 66, sz = -498, y = H(sx, sz);
      b.at(sx, y, sz, 0, (q) => {
        q.mat_(M.PAVING).lathe([[22, -6], [22, 0.12], [0, 0.12]], 40);
        q.mat_(M.GOLD).lathe([[14.4, 0.13], [14.0, 0.135]], 40);
        const cyl = tuningSpire(q, 24);
        out.spires.push({ id: 'cantor', x: sx, y: y + cyl, z: sz, base: y });
      });
      const hx = 96, hz = -590;
      b.at(hx, H(hx, hz), hz, 0, (q) => hall(q, { w: 50, d: 19, h: 25, bays: 7, detail: 1, foot: 10 }));
      for (const dx of [-31, 31]) b.at(hx + dx, H(hx + dx, hz + 4), hz + 4, 0, (q) => tower(q, { r: 4.2, h: 44, sides: 8, stages: 3, top: 'spire', spireH: 30, detail: 1, foot: 10 }));
      // Two arcades lead from the hall toward the spire.
      for (const dx of [-13, 13]) b.at(hx + dx, H(hx + dx, hz + 14), hz + 14, -Math.PI / 2, (q) => arcade(q, 30, { bay: 5, colH: 5.4, detail: 1 }));
      for (const a0 of [0.4, 1.9, 3.5, 5.0]) lamp(b, sx + Math.cos(a0) * 23.5, H(sx + Math.cos(a0) * 23.5, sz + Math.sin(a0) * 23.5), sz + Math.sin(a0) * 23.5);
      // The Choir Gate on the southern rim.
      const gx = 98, gz = -336, gy = H(gx, gz);
      b.at(gx, gy, gz, 0, (q) => {
        q.mat_(M.PAVING).box(-9, -8, -5, 18, 8.15, 10);
        q.mat_(M.ASHLAR); archWall(q, -8, 8, 0.15, 17, 2.4, 0, 8.6, 6.5, 1.0, 16);
        q.mat_(M.GOLD).box(-8.4, 17, -1.4, 16.8, 0.5, 2.8);
        for (const s2 of [-1, 1]) q.at(s2 * 7, 17.5, 0, 0, (g) => tower(g, { r: 1.2, h: 4, sides: 6, stages: 1, top: 'spire', spireH: 7, detail: 0, foot: 0.2, glassEvery: 2 }));
      });
      out.bridge = { from: [gx, gy + 0.2, gz + 4.5], to: [146, H(146, -104) + 0.2, -104] };
      finish(b);
    }

    // --- The Choir: a ring of tall arches around the last spire ---
    {
      const b = new MeshBuilder(), cx = 150, cz = -15, y = H(cx, cz);
      b.at(cx, y, cz, 0, (q) => {
        q.mat_(M.PAVING).lathe([[40, -8], [40, 0.1], [0, 0.1]], 48);
        q.mat_(M.GOLD).lathe([[30.4, 0.11], [30.0, 0.115]], 48);
        q.lathe([[9.3, 0.11], [9.0, 0.115]], 32);
        const n = 14, R = 34, chord = 2 * R * Math.sin(Math.PI / n);
        for (let k = 0; k < n; k++) {
          if (k === 10) continue;                // the way in from the bridge
          const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
          const x0 = Math.cos(a0) * R, z0 = Math.sin(a0) * R, x1 = Math.cos(a1) * R, z1 = Math.sin(a1) * R;
          q.at(x0, 0.1, z0, Math.atan2(-(z1 - z0), x1 - x0), (g) => arcade(g, chord, { bay: chord, colH: 9.5, t: 1.2, top: 2.4, detail: 1 }));
        }
        const cyl = tuningSpire(q, 28);
        out.spires.push({ id: 'choir', x: cx, y: y + cyl, z: cz, base: y });
      });
      finish(b);
      out.arena = { x: cx, y, z: cz, r: 31 };
    }
    return out;
  }
}