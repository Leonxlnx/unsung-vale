// Places architecture in the world: the far cities that crown the mesas, the viaducts that
// link them, and (in sites added below) the hand-laid places the player walks through.
import * as THREE from 'three';
import { MeshBuilder } from './builder.js';
import { citadel, viaduct } from './kit.js';
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
}
