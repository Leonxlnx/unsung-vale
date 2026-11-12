// Places architecture in the world: the far cities that crown the mesas, the viaducts that
// link them, and (in sites added below) the hand-laid places the player walks through.
import * as THREE from 'three';
import { MeshBuilder } from './builder.js';
import { citadel, viaduct, terrace, arcade, pavilion, lantern, tuningSpire, tower, hall, cliffTiers, planter, armillary, bench, trough } from './kit.js';
import { M, column, balustrade, stairs, archWall, archRise, archFrame } from './builder.js';
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
    this.quarters = [];        // [x, z, radius] of the quarters built on the cliff rims
    this.farSolids = [];       // geometry of the cities on mesas the hero can reach: solid, like the playable sites
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
    this.farSolids.push(this.citadelOn(byId.aurel, { seed: 11, scale: 1.35, detail: 1, along: 70, inset: 0.3 }).geometry);
    this.farSolids.push(this.citadelOn(byId.crown, { seed: 12, scale: 1.2, detail: 1, along: -20, inset: 0.2 }).geometry);
    this.farSolids.push(this.citadelOn(byId.south1, { seed: 13, scale: 0.85, detail: 0, along: -60, inset: 0.4 }).geometry);
    this.farSolids.push(this.citadelOn(byId.south3, { seed: 14, scale: 0.95, detail: 0, along: 20, inset: 0.35 }).geometry);
    this.citadelOn(byId.elder, { seed: 15, scale: 1.5, detail: 0, inset: 0.55 });
    // The Evenspan: a two-tier viaduct striding across the lake east of the Choir, and
    // watchtowers on the pinnacles that stand in the water.
    {
      const b = new MeshBuilder(), a = [592, -262], c = [628, 252];
      const deck = Math.min(this.terrain.heightAt(a[0], a[1]), this.terrain.heightAt(c[0], c[1])) - 1.5;
      viaduct(b, (x, z) => this.terrain.heightAt(x, z), a[0], a[1], c[0], c[1], deck, { width: 11, span: 46, detail: 0 });
      this.farSolids.push(this.add(b).geometry);
      for (const id of ['pin1', 'pin3', 'pin6', 'pin5']) {
        const m = byId[id], t = new MeshBuilder();
        const y = this.terrain.heightAt(m.x, m.z);
        t.at(m.x, y, m.z, 0, (q) => tower(q, { r: m.r * 0.22 + 1.5, h: 22 + m.r * 0.6, sides: 8, stages: 2, top: 'spire', spireH: 20 + m.r * 0.5, detail: 0, foot: 12 }));
        this.add(t);
      }
    }
    // Quarters that step down the cliff faces toward the lake, on the valley-facing rims.
    for (const [x, z, yaw, w, tiers, seed] of [[150, 296, Math.PI, 96, 4, 1], [-330, 222, Math.PI, 70, 3, 2], [640, 238, Math.PI, 72, 3, 3], [260, -322, 0, 80, 3, 4], [600, -248, 0, 64, 3, 5], [-826, 30, Math.PI / 2, 80, 3, 6]]) {
      const b = new MeshBuilder();
      // Walk outward to the rim so the top tier sits right at the cliff edge.
      const dx = Math.sin(yaw), dz = Math.cos(yaw);
      let s = 0; const h0 = this.terrain.heightAt(x, z);
      while (s < 80 && this.terrain.heightAt(x + dx * (s + 6), z + dz * (s + 6)) > h0 - 8) s += 2;
      b.at(x + dx * s, h0 + 0.4, z + dz * s, yaw, (q) => cliffTiers(q, { w, tiers, step: 24, out: 10, detail: 0, seed }));
      this.quarters.push([x + dx * s, z + dz * s, w / 2 + 10]);
      this.farSolids.push(this.add(b).geometry);
    }
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
    const out = { spires: [], solids: [], lanterns: [], planters: [], beds: [], floors: [] };
    // Courts whose floors carry an inlaid rose: [x, z, radius, points].
    out.plazas = [[-515, -70, 9.5, 16], [-499, -70, 6.6, 8], [-372, -392, 18.5, 12], [66, -498, 21.4, 12], [150, -15, 29.6, 14]];
    out.plazas.forEach((p, i) => this.material.uniforms.uPlazas.value[i].set(...p));
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
        for (const sx of [-1, 1]) q.at(sx * 17.5, 0, -11, -Math.PI / 2, (g) => arcade(g, 20, { bay: 5, colH: 5.2, detail: 1, colR: 0.36, grand: true }));
        // Benches in the shade of the arcades, looking in across the terrace.
        for (const sx of [-1, 1]) for (const bz of [-8.5, -3.5, 1.5, 6.5]) q.at(sx * 19.2, 0, bz, Math.PI / 2, (g) => bench(g, 2.4));
        // Armillary spheres either side of the way out to the lookout, and urns of flowers.
        for (const sx of [-1, 1]) q.at(sx * 12.6, 0, 7.4, sx * 0.5, (g) => armillary(g, 1.25));
        for (const [px, pz] of [[-20, 11.4], [20, 11.4], [-8.6, 11.4], [8.6, 11.4], [-7.2, -11.6], [7.2, -11.6], [-13.4, -2.5], [13.4, -2.5]]) {
          let top = 0;
          q.at(px, 0, pz, 0, (g) => { top = planter(g, 0.72); });
          // Terrace frame: local +z is east, local +x is north (world -z).
          out.planters.push([cx + pz, y + top, cz - px]);
        }
        // Flower beds in stone troughs along the balustrade, between the urns.
        for (const sx of [-1, 1]) {
          let top = 0;
          q.at(sx * 14.3, 0, 11.95, 0, (g) => { top = trough(g, 8.4); });
          for (let i = 0; i < 6; i++) out.beds.push([cx + 11.95, y + top, cz - sx * (10.8 + i * 1.4), i]);
        }
        // Broad steps down to the meadow behind (the stair frame rises toward the terrace).
        const rise = y - H(cx - 13 - 7, cz) + 0.3, run = rise * 2.3;
        q.at(0, -rise, -13 - run, -Math.PI / 2, (g) => stairs(g, run, rise, 18));
        for (const sx of [-1, 1]) q.mat_(M.ASHLAR).box(sx * 9.6 - 0.5, -rise - 2, -13 - run, 1.0, rise + 2.9, run);
      });
      // Two lanterns flank the lookout rather than one at its tip, which stood in the middle of the view.
      for (const [dx, dz] of [[12.5, 20], [12.5, -20], [-12.5, 20], [-12.5, -20], [14.7, 6.3], [14.7, -6.3]]) lamp(b, cx + dx, y, cz + dz);
      // A small domed pavilion on the south lawn.
      const px = -540, pz = -22;
      b.at(px, H(px, pz) + 0.05, pz, 0, (q) => pavilion(q, { r: 4.6, colH: 5.2, n: 8, detail: 1 }));
      finish(b);
      out.floors.push({ x: cx, y, z: cz, w: 26, d: 42 }, { x: cx + 13, y, z: cz, r: 7.4, half: true });
      out.spawn = { x: cx - 7, y: y + 0.1, z: cz, yaw: Math.PI / 2 };
      out.vista = { x: cx + 14, y: y + 1.7, z: cz };
    }

    // --- High viaduct: Dawn -> Petal ---
    {
      const b = new MeshBuilder();
      // Both ends reach well back from the rim, so the deck meets solid ground a step high.
      const a = [-573.5, -152.9], c = [-446.6, -289.7], ya = H(a[0], a[1]) + 0.3, yc = H(c[0], c[1]) + 0.3;
      const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
      viaduct(b, H, a[0], a[1], c[0], c[1], ya, { width: 6.4, span: 28, detail: 1, slope: (yc - ya) / L, balusters: true });
      out.viaduct = { a, c, ya, yc };
      finish(b);
    }

    // --- Petal Court: first spire in a ring of weathered columns ---
    {
      const b = new MeshBuilder(), sx = -372, sz = -392, y = H(sx, sz);
      b.at(sx, y, sz, 0, (q) => {
        q.mat_(M.PAVING).lathe([[19, -6], [19, 0.12], [0, 0.12]], 36);
        q.mat_(M.GOLD).lathe([[12.4, 0.13], [12.0, 0.135]], 36);
        const cyl = tuningSpire(q, 22);
        out.spires.push({ id: 'petal', x: sx, y: y + cyl, z: sz, base: y, h: 22 });
        out.floors.push({ x: sx, y: y + 0.12, z: sz, r: 19 });
        for (let k = 0; k < 12; k++) {
          if (k === 3 || k === 8) continue;       // gaps where columns have fallen
          const a0 = (k / 12) * Math.PI * 2;
          q.at(Math.cos(a0) * 16.5, 0.12, Math.sin(a0) * 16.5, 0, (g) => column(g, 0.42, k % 5 === 0 ? 3.2 : 6.4, { sides: 12 }));
        }
        // Urns of blossom between the columns and the edge of the paving, clear of the two ways in.
        for (const a0 of [0.5, 1.3, 3.0, 3.9, 4.8]) {
          const px = Math.cos(a0) * 17.8, pz = Math.sin(a0) * 17.8;
          let top = 0;
          q.at(px, 0.12, pz, 0, (g) => { top = planter(g, 0.8); });
          out.planters.push([sx + px, y + 0.12 + top, sz + pz]);
        }
        // What is left of the ring beam: two spans still rest on their columns.
        for (const k of [1, 6]) {
          const a0 = (k / 12) * Math.PI * 2, a1 = ((k + 1) / 12) * Math.PI * 2;
          const x0 = Math.cos(a0) * 16.5, z0 = Math.sin(a0) * 16.5, x1 = Math.cos(a1) * 16.5, z1 = Math.sin(a1) * 16.5;
          q.at(x0, 6.52, z0, Math.atan2(-(z1 - z0), x1 - x0), (g) => {
            const len = Math.hypot(x1 - x0, z1 - z0);
            g.mat_(M.MARBLE).box(-0.7, 0, -0.5, len + 1.4, 0.55, 1.0);
            g.mat_(M.FRIEZE).box(-0.6, 0.55, -0.44, len + 1.2, 0.5, 0.88, '-y');
            g.mat_(M.MARBLE).box(-0.8, 1.05, -0.58, len + 1.6, 0.22, 1.16);
          });
        }
        // Where columns have fallen, their drums lie in the grass at the edge of the paving.
        for (const [k, turn] of [[3, 0.5], [8, -0.35]]) {
          const a0 = (k / 12) * Math.PI * 2, cx0 = Math.cos(a0) * 17.2, cz0 = Math.sin(a0) * 17.2;
          for (let i = 0; i < 3; i++) {
            q.push().translate(cx0 + Math.cos(a0 + 1.57) * (i * 1.9 - 1.6), 0.5, cz0 + Math.sin(a0 + 1.57) * (i * 1.9 - 1.6) + i * 0.4).rotateY(a0 + turn + i * 0.3).rotateZ(Math.PI / 2);
            q.mat_(M.MARBLE).lathe([[0, -0.75], [0.42, -0.75], [0.42, 0.75], [0, 0.75]], 12);
            q.pop();
          }
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
          for (const sz of [-1, 1]) {
            // A flank wall is also a retaining wall: where the hillside stands higher than
            // the stair it rises with it, so no bank of bare earth shows over its top.
            let top = h + 1.2;
            for (let k = 0; k <= 5; k++) for (const off of [3.8, 4.5, 5.2, 6.0]) top = Math.max(top, H(bx - (x + (k / 5) * (run / 7)), bz - sz * off) - y0 + 0.6);
            top = Math.min(top, h + 9);
            q.mat_(M.ASHLAR).box(x, -3, sz * 4.5 - 0.5, run / 7 + 0.1, top + 3, 1.0);
            q.mat_(M.MARBLE).box(x - 0.1, top, sz * 4.5 - 0.6, run / 7 + 0.3, 0.25, 1.2);
          }
        }
        q.mat_(M.PAVING).box(run, rise - 6, -7, 9, 6, 14, '-y');
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
        out.spires.push({ id: 'cantor', x: sx, y: y + cyl, z: sz, base: y, h: 24 });
        out.floors.push({ x: sx, y: y + 0.12, z: sz, r: 22 });
        for (let k = 0; k < 6; k++) {
          const a0 = (k / 6) * Math.PI * 2 + 0.26, px = Math.cos(a0) * 19.6, pz = Math.sin(a0) * 19.6;
          let top = 0;
          q.at(px, 0.12, pz, 0, (g) => { top = planter(g, 0.8); });
          out.planters.push([sx + px, y + 0.12 + top, sz + pz]);
        }
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
        // Dressed like a gate of ceremony: a moulded marble surround on both faces, corner
        // piers, and a carved band under the gilded cornice.
        q.mat_(M.MARBLE); archFrame(q, 0, 0.15, 1.2, 8.6, 6.5, 1.0, 0.75, 0.36, 16);
        q.at(0, 0, 0, Math.PI, (g) => { g.mat_(M.MARBLE); archFrame(g, 0, 0.15, 1.2, 8.6, 6.5, 1.0, 0.75, 0.36, 16); });
        for (const sx of [-1, 1]) {
          q.mat_(M.MARBLE).box(sx * 8 - 0.7, 0.15, -1.55, 1.4, 16.9, 3.1);
          q.mat_(M.GOLD).box(sx * 8 - 0.8, 5.2, -1.65, 1.6, 0.22, 3.3);
          q.box(sx * 8 - 0.8, 11.2, -1.65, 1.6, 0.22, 3.3);
        }
        q.mat_(M.FRIEZE).box(-7.3, 15.7, -1.26, 14.6, 1.15, 2.52, '+y-y');
        q.mat_(M.GOLD).box(-8.4, 17, -1.4, 16.8, 0.5, 2.8);
        for (const s2 of [-1, 1]) q.at(s2 * 7, 17.5, 0, 0, (g) => tower(g, { r: 1.2, h: 4, sides: 6, stages: 1, top: 'spire', spireH: 7, detail: 0, foot: 0.2, glassEvery: 2 }));
      });
      for (const sx of [-1, 1]) lamp(b, gx + sx * 6.2, H(gx + sx * 6.2, gz - 8), gz - 8);
      out.gate = { x: gx, y: gy, z: gz };
      // The bridge lands well inside the Choir's rim, on level ground.
      out.bridge = { from: [gx, gy + 0.2, gz + 4.5], to: [150, H(150, -84) + 0.3, -84] };
      finish(b);
    }

    // --- The outer courts: five more spires on the mesas round the lake, reached by the
    // strings of light. Each is a ring of columns round its spire, a little different from
    // the last, the Crown the grandest. ---
    out.outer = []; out.vines = []; out.banners = [];
    // A span of ring beam resting on two neighbouring columns: architrave, frieze, cornice.
    const beamSpan = (q, r, yTop, a0, a1) => {
      const x0 = Math.cos(a0) * r, z0 = Math.sin(a0) * r, x1 = Math.cos(a1) * r, z1 = Math.sin(a1) * r, len = Math.hypot(x1 - x0, z1 - z0);
      q.at(x0, yTop, z0, Math.atan2(-(z1 - z0), x1 - x0), (g) => {
        g.mat_(M.MARBLE).box(-0.7, 0, -0.5, len + 1.4, 0.55, 1.0);
        g.mat_(M.FRIEZE).box(-0.6, 0.55, -0.44, len + 1.2, 0.5, 0.88, '-y');
        g.mat_(M.MARBLE).box(-0.8, 1.05, -0.58, len + 1.6, 0.22, 1.16);
        g.mat_(M.GOLD).box(-0.8, 1.27, -0.6, len + 1.6, 0.05, 1.2, '-y');
      });
    };
    // away: the side of each court that faces away from where the string comes in; what is
    // particular to the court stands there.
    for (const [id, sx, sz, h, style, away] of [['east', 578, -437, 24, 0, 5.5], ['south3', 517, 437, 26, 1, 1.57], ['aurel', 136, 546, 28, 2, 2.9], ['south1', -405, 435, 26, 3, 3.4], ['crown', -1005, -168, 34, 4, 3.93]]) {
      const b = new MeshBuilder(), y = H(sx, sz) + 0.5, R = style === 4 ? 25 : 21, colH = style === 4 ? 8.4 : 6.4, n = style === 4 ? 16 : 12, TAU = Math.PI * 2;
      const near = (a, w, tol) => Math.abs(Math.atan2(Math.sin(a - w), Math.cos(a - w))) < tol;
      const way = (a, tol = Math.PI / n + 0.02) => near(a, away, tol) || near(a, away + Math.PI, tol);       // the two ways in
      const tangent = (a) => Math.atan2(-Math.cos(a), -Math.sin(a));      // yaw of something that faces the middle from angle a
      b.at(sx, y, sz, 0, (q) => {
        q.mat_(M.PAVING).lathe([[R, -9], [R, 0.12], [0, 0.12]], 48);
        // Three shallow steps all round, then a sloping apron, so the court can be walked onto
        // from the grass wherever the ground happens to lie a little lower.
        const r0 = style === 4 ? R + 8 : R, y0 = style === 4 ? -0.25 : 0.12;
        if (style === 4) q.mat_(M.PAVING).lathe([[R + 8, -9], [R + 8, -0.25], [R - 0.2, -0.25]], 48);
        q.mat_(M.MARBLE).lathe([[r0 + 1.5, -9], [r0 + 1.5, y0 - 0.38], [r0 + 1.0, y0 - 0.38], [r0 + 1.0, y0 - 0.2], [r0 + 0.5, y0 - 0.2], [r0 + 0.5, y0 - 0.02], [r0 - 0.05, y0 - 0.02]], 48);
        q.mat_(M.ASHLAR).lathe([[r0 + 5.6, y0 - 2.7], [r0 + 1.45, y0 - 0.4]], 48);
        q.mat_(M.GOLD).lathe([[R * 0.64, 0.13], [R * 0.62, 0.135]], 48);
        q.mat_(M.GOLD).lathe([[R * 0.87, 0.13], [R * 0.862, 0.135]], 48);
        const cyl = tuningSpire(q, h);
        out.spires.push({ id, x: sx, y: y + cyl, z: sz, base: y, h });
        out.floors.push({ x: sx, y: y + 0.12, z: sz, r: R });
        // A ring of columns carrying a beam, open toward the two ways in. Here and there a
        // span has come down.
        const ang = (k) => ((k + 0.5) / n) * TAU, stand = [];
        for (let k = 0; k < n; k++) {
          stand.push(!way(ang(k)));
          if (stand[k]) q.at(Math.cos(ang(k)) * (R - 2.8), 0.12, Math.sin(ang(k)) * (R - 2.8), 0, (g) => column(g, 0.45, colH, { sides: 12 }));
        }
        for (let k = 0; k < n; k++) { const k1 = (k + 1) % n; if (stand[k] && stand[k1] && (k * 5 + style * 3) % 7 !== 0) beamSpan(q, R - 2.8, 0.12 + colH, ang(k), ang(k1)); }
        // Urns of blossom at the foot of the columns.
        for (let k = 0; k < n; k += 2) {
          const a0 = (k / n) * TAU;
          if (way(a0, 0.5)) continue;
          const px = Math.cos(a0) * (R - 1.25), pz = Math.sin(a0) * (R - 1.25);
          let top = 0;
          q.at(px, 0.12, pz, 0, (g) => { top = planter(g, 0.78); });
          out.planters.push([sx + px, y + 0.12 + top, sz + pz]);
        }
        // What makes each court its own.
        if (style === 2) {
          // The Aurel Court: gold let into the floor, and two armillary spheres.
          for (const rr of [0.3, 0.46]) q.mat_(M.GOLD).lathe([[R * rr + 0.22, 0.13], [R * rr, 0.135]], 48);
          for (const da of [1.571, -1.571]) q.at(Math.cos(away + da) * (R - 6), 0.12, Math.sin(away + da) * (R - 6), away + da, (g) => armillary(g, 1.2));
        }
        if (style === 3) for (const da of [0.9, 2.2, -0.9, -2.2]) q.at(Math.cos(away + da) * (R - 5.2), 0.12, Math.sin(away + da) * (R - 5.2), tangent(away + da), (g) => bench(g, 2.4));
        if (style === 4) {
          // The Crown: on the lower terrace, a ring of great arches, two to a span, open to
          // the ways in.
          const n2 = 12, rr = R + 5.4;
          for (let k = 0; k < n2; k++) {
            const a0 = (k / n2) * TAU, a1 = ((k + 1) / n2) * TAU;
            if (way((a0 + a1) / 2, 0.3)) continue;
            const x0 = Math.cos(a0) * rr, z0 = Math.sin(a0) * rr, x1 = Math.cos(a1) * rr, z1 = Math.sin(a1) * rr, chord = Math.hypot(x1 - x0, z1 - z0);
            q.at(x0, -0.25, z0, Math.atan2(-(z1 - z0), x1 - x0), (g) => arcade(g, chord, { bay: chord / 2, colH: 8.2, t: 1.2, top: 2.0, detail: 1, colR: 0.5, grand: true }));
          }
        }
      });
      const at = (a, r) => [sx + Math.cos(a) * r, sz + Math.sin(a) * r];
      // Lamps on the grass at the foot of the steps, a pair to each way in.
      for (const w of [away, away + Math.PI]) for (const da of [-0.2, 0.2]) { const [lx, lz] = at(w + da, (style === 4 ? R + 8 : R) + 2.6); lamp(b, lx, H(lx, lz), lz); }
      if (style === 0) {
        // The Lantern Court: a second ring of lamps out on the grass, lamps between its
        // columns, and a light-tower behind it.
        for (let k = 0; k < 10; k++) { const a0 = k * 0.6283 + 0.31; if (way(a0, 0.3)) continue; const [lx, lz] = at(a0, R + 8.5); lamp(b, lx, H(lx, lz), lz); }
        for (const da of [0.75, 1.9, -0.75, -1.9]) { const [lx, lz] = at(away + da, R - 4.6); lamp(b, lx, y + 0.12, lz); }
        const [tx, tz] = at(away, R + 13);
        b.at(tx, H(tx, tz) - 0.3, tz, 0, (q) => tower(q, { r: 3.1, h: 23, sides: 8, stages: 3, top: 'spire', spireH: 13, detail: 1, foot: 6 }));
      }
      if (style === 1) {
        // The Reed Court: a pavilion beside the path to its pool, and an arcade at its back.
        const [px, pz] = at(5.55, R + 11);
        b.at(px, H(px, pz) + 0.05, pz, 0, (q) => pavilion(q, { r: 4.2, colH: 4.8, n: 8, detail: 1 }));
        const L = 18, [mx, mz] = at(away, R + 8.5), yaw = tangent(away) + Math.PI / 2, ux = Math.cos(yaw), uz = -Math.sin(yaw), by = H(mx, mz) - 0.15;
        b.at(mx - ux * L / 2, by, mz - uz * L / 2, yaw, (q) => arcade(q, L, { bay: 3.6, colH: 4.6, detail: 1 }));
        out.vines.push([[mx - ux * L / 2, by + 6.6, mz - uz * L / 2], [mx + ux * L / 2, by + 6.6, mz + uz * L / 2], { drop: 2.8, density: 1.4 }]);
      }
      if (style === 2) {
        // The Aurel Court: its archive, a hall between two towers, facing the spire.
        const [hx, hz] = at(away, R + 19), hy = Math.min(H(hx, hz), H(...at(away, R + 12))) - 0.2;
        b.at(hx, hy, hz, tangent(away), (q) => {
          hall(q, { w: 30, d: 12, h: 15, bays: 5, detail: 1, foot: 6 });
          for (const dx of [-19, 19]) q.at(dx, 0, 1, 0, (g) => tower(g, { r: 3.3, h: 26, sides: 8, stages: 3, top: 'spire', spireH: 14, detail: 1, foot: 6 }));
        });
      }
      if (style === 3) {
        // The Orchard Court: four pergolas among the fruit trees, hung with wisteria.
        for (const da of [0.785, 2.356, -0.785, -2.356]) {
          const a0 = away + da, L = 14, [mx, mz] = at(a0, R + 8), yaw = tangent(a0) + Math.PI / 2, ux = Math.cos(yaw), uz = -Math.sin(yaw), by = H(mx, mz) - 0.15;
          b.at(mx - ux * L / 2, by, mz - uz * L / 2, yaw, (q) => arcade(q, L, { bay: 3.5, colH: 4.2, detail: 1 }));
          out.vines.push([[mx - ux * L / 2, by + 6.2, mz - uz * L / 2], [mx + ux * L / 2, by + 6.2, mz + uz * L / 2], { drop: 3.0, density: 1.6 }]);
        }
      }
      if (style === 4) {
        // The Crown: two towers stand behind the ring, and banners hang in its arches.
        for (const da of [-0.36, 0.36]) { const [tx, tz] = at(away + da, R + 15.5); b.at(tx, H(tx, tz) - 0.3, tz, 0, (q) => tower(q, { r: 3.6, h: 30, sides: 8, stages: 4, top: 'spire', spireH: 17, detail: 1, foot: 6 })); }
        for (let k = 0; k < 12; k++) { const a0 = ((k + 0.5) / 12) * TAU; if (way(a0, 0.3) || k % 2) continue; const [bx, bz] = at(a0, R + 4.7); out.banners.push([bx, y + 8.6, bz, tangent(a0), 1.5, 5.6]); }
      }
      finish(b);
      this.material.uniforms.uPlazas.value[5 + style].set(sx, sz, R * 0.56, 8 + style * 2);
      out.outer.push({ id, x: sx, z: sz, y, r: R, away, style });
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
          q.at(x0, 0.1, z0, Math.atan2(-(z1 - z0), x1 - x0), (g) => arcade(g, chord, { bay: chord, colH: 9.5, t: 1.5, top: 2.8, detail: 1, colR: 0.72, grand: true }));
        }
        // An urn of blossom outside every pier, except either side of the way in.
        for (let k = 0; k < n; k++) {
          if (k === 10 || k === 11) continue;
          const a0 = (k / n) * Math.PI * 2, px = Math.cos(a0) * 37.7, pz = Math.sin(a0) * 37.7;
          let top = 0;
          q.at(px, 0.1, pz, 0, (g) => { top = planter(g, 0.85); });
          out.planters.push([cx + px, y + 0.1 + top, cz + pz]);
        }
        const cyl = tuningSpire(q, 28);
        out.spires.push({ id: 'choir', x: cx, y: y + cyl, z: cz, base: y, h: 28 });
        out.floors.push({ x: cx, y: y + 0.1, z: cz, r: 40 });
      });
      finish(b);
      out.arena = { x: cx, y, z: cz, r: 31 };
    }
    // The order of the journey: the three of the inner Vale, then round the lake to the Crown.
    const ORDER = ['petal', 'cantor', 'choir', 'east', 'south3', 'aurel', 'south1', 'crown'];
    out.spires.sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
    return out;
  }
}