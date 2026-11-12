// Scattered rock: talus boulders at the feet of the cliffs, stones in the shallows along the
// shore, and small outcrops in the meadows. Each boulder is a faceted, plane-cut lump shaded
// with the same rock layers as the cliffs, so it reads as a piece that fell from them.
import * as THREE from 'three';
import { COMMON, SKYMAP } from '../engine/glsl.js';
import { SKY_SAMPLE, SH_GLSL } from '../engine/sky.js';
import { LIGHTING } from '../engine/lighting.js';
import { TERRAIN_SAMPLING } from './terrain.js';
import { TERRAIN_MATERIALS } from './terrainMaterials.js';
import { mulberry32, fbm } from '../util/noise.js';

const CELL = 128;            // metres per culling cell
const REACH = 340;           // boulders are drawn within this distance of the camera
const SMALL = 110;           // small stones only within this distance

// A lump: an icosphere pushed in by a few random planes, then roughened along its radius.
// Faces keep their own vertices, so every facet shades flat like broken stone.
function lump(seed, detail) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const rnd = mulberry32(seed), p = g.attributes.position, v = new THREE.Vector3(), n = new THREE.Vector3();
  const planes = [];
  for (let k = 0; k < 7; k++) {
    n.set(rnd() * 2 - 1, rnd() * 1.4 - 0.5, rnd() * 2 - 1).normalize();
    planes.push([n.clone(), 0.55 + 0.35 * rnd()]);
  }
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    // Roughen as a function of direction only, so shared corners stay welded.
    const d = v.clone().normalize();
    v.multiplyScalar(0.86 + 0.2 * fbm(d.x * 1.7 + seed, d.y * 1.7 + d.z * 2.3, 2, seed + 3));
    for (const [pn, pd] of planes) { const over = v.dot(pn) - pd; if (over > 0) v.addScaledVector(pn, -over); }
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

const ROCK_VERT = /* glsl */ `
out vec3 vWorld; out vec3 vNormal; out float vUp;
void main() {
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vUp = position.y * 0.5 + 0.5;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const L_ROCK = TERRAIN_MATERIALS.findIndex((m) => m.name === 'rock').toFixed(1);
const L_MOSS = TERRAIN_MATERIALS.findIndex((m) => m.name === 'moss').toFixed(1);

const ROCK_FRAG = /* glsl */ `
${COMMON}
${SKYMAP}
${SKY_SAMPLE}
${SH_GLSL}
${TERRAIN_SAMPLING}
${LIGHTING}
uniform sampler2DArray uTA;
uniform sampler2DArray uTB;
uniform sampler2D uNoise;
in vec3 vWorld; in vec3 vNormal; in float vUp;
void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorld);
  // Fracture detail from the cliff's close-up layer, projected on the two steepest axes.
  vec3 w = pow(abs(N), vec3(4.0)); w /= w.x + w.y + w.z;
  vec2 ux = vWorld.zy / 3.4, uy = vWorld.xz / 3.4, uz = vWorld.xy / 3.4;
  vec4 a = textureGrad(uTA, vec3(ux, ${L_ROCK}), dFdx(ux), dFdy(ux)) * w.x + textureGrad(uTA, vec3(uy, ${L_ROCK}), dFdx(uy), dFdy(uy)) * w.y + textureGrad(uTA, vec3(uz, ${L_ROCK}), dFdx(uz), dFdy(uz)) * w.z;
  vec4 b = textureGrad(uTB, vec3(ux, ${L_ROCK}), dFdx(ux), dFdy(ux)) * w.x + textureGrad(uTB, vec3(uy, ${L_ROCK}), dFdx(uy), dFdy(uy)) * w.y + textureGrad(uTB, vec3(uz, ${L_ROCK}), dFdx(uz), dFdy(uz)) * w.z;
  vec4 n1 = texture(uNoise, vWorld.xz / 37.0 + vWorld.y * 0.02);
  // The same limestone as the cliffs: cream to grey, stained warm in places.
  vec3 stone = mix(vec3(0.17, 0.17, 0.165), vec3(0.33, 0.3, 0.24), n1.r);
  stone = mix(stone, vec3(0.27, 0.19, 0.12), smoothstep(0.6, 0.85, n1.b) * 0.4);
  vec3 alb = stone * a.rgb * 2.0;
  // Moss and lichen settle on the tops; the foot stays dark and damp.
  float top = smoothstep(0.35, 0.75, N.y + (n1.g - 0.5) * 0.5) * smoothstep(0.25, 0.5, n1.a);
  vec2 um = vWorld.xz / 2.6;
  vec3 moss = textureGrad(uTA, vec3(um, ${L_MOSS}), dFdx(um), dFdy(um)).rgb;
  alb = mix(alb, moss, top * 0.8);
  float foot = smoothstep(0.02, 0.45, vUp);
  alb *= mix(0.4, 1.0, foot);
  float wet = 1.0 - smoothstep(-0.2, 0.7, vWorld.y);
  alb *= mix(1.0, 0.5, wet);
  float rough = mix(mix(b.b, 0.95, top), 0.3, wet);
  float ao = b.a * mix(0.35, 1.0, foot);
  float vis = sunVisibility(vWorld + N * 0.15 + uSunDir * 0.15);
  vec3 col = shadeSurface(alb, rough, 0.0, N, V, vis, ao, 0.0);
  col += alb * lampLight(vWorld, N) * ao;
  gl_FragColor = vec4(col, 1.0);
}`;

export class Rocks {
  // exclude(x, z) keeps the paved sites and the routes between them clear.
  constructor(pipe, terrain, exclude = () => false) {
    this.terrain = terrain;
    this.group = new THREE.Group();
    const depth = new THREE.ShaderMaterial({ vertexShader: 'void main() { gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0); }', fragmentShader: 'void main() {}', colorWrite: false });
    const material = new THREE.ShaderMaterial({
      vertexShader: ROCK_VERT, fragmentShader: ROCK_FRAG, defines: pipe.depthDefines,
      uniforms: { ...pipe.lit(), uTA: terrain.surfaceUniforms.uTA, uTB: terrain.surfaceUniforms.uTB, uNoise: terrain.surfaceUniforms.uNoise },
    });
    const big = [lump(11, 2), lump(23, 2), lump(37, 2)], small = [lump(41, 1), lump(53, 1)];
    const T = terrain, H = (x, z) => T.heightAt(x, z), rnd = mulberry32(9041);
    const cells = new Map();
    const put = (x, z, size, isBig) => {
      const key = Math.floor(x / CELL) + ',' + Math.floor(z / CELL) + (isBig ? 'b' : 's');
      let c = cells.get(key);
      if (!c) cells.set(key, c = { big: isBig, cx: (Math.floor(x / CELL) + 0.5) * CELL, cz: (Math.floor(z / CELL) + 0.5) * CELL, list: [] });
      c.list.push([x, z, size]);
    };
    const half = 1000;
    for (let i = 0; i < 52000; i++) {
      const x = (rnd() * 2 - 1) * half, z = (rnd() * 2 - 1) * half, r1 = rnd(), r2 = rnd();
      const h = H(x, z);
      if (h < -2.2 || h > 280) continue;
      const e = 2, sx = H(x + e, z) - H(x - e, z), sz = H(x, z + e) - H(x, z - e), slope = Math.hypot(sx, sz) / (2 * e);
      if (slope > 0.75) continue;
      if (h < 70) {
        // Lowlands: is there a cliff rising close by? Then this is talus.
        let wall = 0;
        let wallFar = 0;
        for (const [dx, dz] of [[14, 0], [-14, 0], [0, 14], [0, -14], [10, 10], [-10, 10], [10, -10], [-10, -10]]) { wall = Math.max(wall, H(x + dx, z + dz) - h); wallFar = Math.max(wallFar, H(x + dx * 2.2, z + dz * 2.2) - h); }
        const shore = h < 2.2 ? 1 : 0;
        if (wall > 22) put(x, z, 0.8 + 3.0 * r2 * r2, true);
        else if (wallFar > 22) { if (r1 < 0.5) put(x, z, 0.5 + 1.8 * r2 * r2, true); }
        else if (shore && r1 < 0.16 * (fbm(x / 60, z / 60, 2, 31) * 0.5 + 0.9)) put(x, z, 0.45 + 1.6 * r2 * r2, true);
        else if (r1 < 0.012) put(x, z, 0.5 + 1.2 * r2, true);
      } else if (slope < 0.2 && !exclude(x, z)) {
        // Mesa tops: stones gather in a few rough patches of the meadow.
        const patch = fbm(x / 46, z / 46, 3, 77) * 0.5 + 0.5;
        if (patch > 0.62 && r1 < 0.22 * (patch - 0.62) / 0.38) put(x, z, 0.32 + 0.75 * r2 * r2, false);
      }
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), eul = new THREE.Euler(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
    this.cells = [];
    let count = 0;
    for (const c of cells.values()) {
      const geos = c.big ? big : small;
      const mesh = new THREE.InstancedMesh(geos[Math.floor(rnd() * geos.length)], material, c.list.length);
      c.list.forEach(([x, z, s], i) => {
        const sy = 0.55 + 0.4 * rnd();
        eul.set((rnd() - 0.5) * 0.7, rnd() * 6.283, (rnd() - 0.5) * 0.7);
        // Sunk a third into the ground so nothing looks placed on top of it.
        pos.set(x, H(x, z) + s * sy * 0.3, z);
        scl.set(s * (0.8 + 0.5 * rnd()), s * sy, s * (0.8 + 0.5 * rnd()));
        mesh.setMatrixAt(i, m4.compose(pos, q.setFromEuler(eul), scl));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      // A depth-only twin that shares the instances, switched on only near the camera.
      const twin = new THREE.InstancedMesh(mesh.geometry, depth, c.list.length);
      twin.instanceMatrix = mesh.instanceMatrix; twin.frustumCulled = false; twin.matrixAutoUpdate = false; twin.visible = false;
      pipe.shadows.scene.add(twin);
      this.cells.push({ mesh, twin, cx: c.cx, cz: c.cz, y: H(c.cx, c.cz), reach: c.big ? REACH : SMALL });
      count += c.list.length;
    }
    this.count = count;
    this.group.updateMatrixWorld(true);
  }

  update(camera) {
    const p = _v.setFromMatrixPosition(camera.matrixWorld);
    for (const c of this.cells) {
      const d = Math.hypot(c.cx - p.x, c.cz - p.z);
      c.mesh.visible = d < c.reach + CELL * 0.75;
      c.twin.visible = d < 96 + CELL * 0.75;
    }
  }
}

const _v = new THREE.Vector3();
