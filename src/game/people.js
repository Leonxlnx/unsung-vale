// The people of the Vale. They wear the same pale masks as the hero and long dyed robes.
// Where a spire is silent they stand as grey statues, heads bowed; when it is tuned they
// wake, colour runs back into their clothes, and they have something to say. The Dawn
// Terrace never fell silent, so the three who live there are awake from the start.
// Each figure is built here from simple turned shapes and animated by hand: a sway, a
// breath, a head that follows the hero.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HERO_FRAG } from '../anim/hero.js';

const VERT = /* glsl */ `
out vec3 vWorld; out vec3 vNormal; out vec3 vRest;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz; vNormal = normalize(mat3(modelMatrix) * normal); vRest = position;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const DEPTH_VERT = 'void main() { gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }';
const STONE = [[0.4, 0.4, 0.42], 0.92, 0, 0, 0];
const GOLD = [[1.0, 0.76, 0.36], 0.32, 1, 0, 0], MASK = [[0.88, 0.86, 0.82], 0.26, 0, 0, 0], DARK = [[0.02, 0.02, 0.025], 0.6, 0, 0, 0], WOOD = [[0.16, 0.1, 0.06], 0.7, 0, 0.1, 0];
// Dyes: deep, a little dusty, each court its own.
const DYE = {
  teal: [0.03, 0.16, 0.17], wine: [0.3, 0.03, 0.05], indigo: [0.06, 0.07, 0.24], ochre: [0.42, 0.24, 0.05], moss: [0.1, 0.17, 0.05],
  plum: [0.2, 0.05, 0.2], slate: [0.12, 0.15, 0.19], rust: [0.36, 0.11, 0.04], cream: [0.6, 0.54, 0.42], rose: [0.4, 0.12, 0.14],
};
const cloth = (c) => [DYE[c], 0.86, 0, 0.5, 0];

// name, role, where (court id and a spot on its floor), which way they face, and their look.
export const PEOPLE = [
  { id: 'maren', name: 'Maren', role: 'Keeper of the Terrace', site: 'dawn', at: [-506.5, -63.5], yaw: -2.2, robe: 'indigo', mantle: 'cream', prop: 'staff', h: 1.04 },
  { id: 'odo', name: 'Odo', role: 'Luthier', site: 'dawn', at: [-517, -55], yaw: 2.6, robe: 'ochre', mantle: 'slate', prop: 'lute', h: 0.95 },
  { id: 'sel', name: 'Sel', role: 'Mapmaker', site: 'dawn', at: [-521.5, -84], yaw: 0.6, robe: 'moss', mantle: 'cream', prop: 'scroll', h: 0.98 },
  { id: 'ilse', name: 'Ilse', role: 'Gardener of the Petal Court', site: 'petal', ring: [13, 16], robe: 'rose', mantle: 'moss', h: 0.94 },
  { id: 'tam', name: 'Tam', role: 'Ringer of the Rise', site: 'cantor', ring: [15, 6], robe: 'slate', mantle: 'ochre', prop: 'staff', h: 1.06 },
  { id: 'vey', name: 'Vey', role: 'Master of the Choir', site: 'choir', ring: [22, 2], robe: 'wine', mantle: 'cream', h: 1.0 },
  { id: 'ruu', name: 'Ruu', role: 'Lamplighter', site: 'east', ring: [13, 3], robe: 'rust', mantle: 'indigo', prop: 'staff', h: 0.97 },
  { id: 'nan', name: 'Nan', role: 'Fisher of the Reed Court', site: 'south3', ring: [13, 6], robe: 'teal', mantle: 'cream', h: 0.93 },
  { id: 'pell', name: 'Pell', role: 'Archivist of the Aurel Court', site: 'aurel', ring: [13, 10], robe: 'plum', mantle: 'ochre', prop: 'scroll', h: 1.02 },
  { id: 'hesk', name: 'Hesk', role: 'Keeper of the Orchard', site: 'south1', ring: [13, 14], robe: 'moss', mantle: 'rust', prop: 'staff', h: 0.92 },
  { id: 'first', name: 'The First Singer', role: 'of the Crown', site: 'crown', ring: [16, 14], robe: 'cream', mantle: 'wine', h: 1.1 },
];

const tube = (a, b, r0, r1, seg = 9) => {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), len = A.distanceTo(B);
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, false);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()));
  g.translate(A.x, A.y, A.z);
  return g;
};
const lathe = (pts, seg = 14, sz = 1) => { const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg); g.scale(1, 1, sz); return g; };
const ring = (r, y, t = 0.012, sz = 1) => { const g = new THREE.TorusGeometry(r, t, 5, 20); g.rotateX(Math.PI / 2); g.scale(1, 1, sz); g.translate(0, y, 0); return g; };
const merged = (list) => mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => { for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); return g; }));

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _from = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
const ease = (t) => t * t * (3 - 2 * t), clamp01 = (x) => Math.max(0, Math.min(1, x));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class People {
  constructor(game, pipe) {
    this.game = game; this.pipe = pipe; this.list = []; this.talk = null;
    const W = game.world, depth = new THREE.ShaderMaterial({ vertexShader: DEPTH_VERT, fragmentShader: 'void main() {}', colorWrite: false, side: THREE.DoubleSide });
    for (const def of PEOPLE) {
      // Where they stand: a named spot, or a place on the ring of their court.
      let x, z, yaw = def.yaw ?? 0;
      const spire = game.spires.find((s) => s.id === def.site);
      if (def.at) [x, z] = def.at;
      else { const a = (def.ring[1] / 24) * 6.283; x = spire.x + Math.cos(a) * def.ring[0]; z = spire.z + Math.sin(a) * def.ring[0]; yaw = Math.atan2(spire.x - x, spire.z - z); }
      W.stream(x, z, 6);
      const y = W.floorBelow(x, (spire?.base ?? W.groundHeight(x, z)) + 3, z, 12);
      const n = { def, x, y, z, yaw, home: yaw, spire, awake: !spire || spire.tuned, k: !spire || spire.tuned ? 1 : 0, t: Math.random() * 10, headYaw: 0, gesture: 0, mats: [], meshes: [] };
      this._build(n, depth);
      W.addCapsule([x, y, z], [x, y + 1.7 * def.h, z], 0.34);
      this.list.push(n);
    }
  }

  _mat(n, look) {
    const m = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: HERO_FRAG, defines: this.pipe.depthDefines, side: THREE.DoubleSide,
      uniforms: { ...this.pipe.lit(), uAlbedo: { value: new THREE.Vector3() }, uSurf: { value: new THREE.Vector4() }, uFlash: { value: 0 } } });
    n.mats.push({ m, look });
    return m;
  }

  _build(n, depth) {
    const d = n.def, robe = this._mat(n, cloth(d.robe)), mantle = this._mat(n, cloth(d.mantle)), gold = this._mat(n, GOLD), mask = this._mat(n, MASK), dark = this._mat(n, DARK);
    const root = (n.root = new THREE.Group());
    root.position.set(n.x, n.y, n.z); root.rotation.y = n.yaw; root.scale.setScalar(d.h);
    const add = (parent, geo, mat) => { const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; parent.add(m); n.meshes.push(m); this.pipe.shadows.addCaster(m, depth, { dynamic: true }); return m; };
    const body = (n.body = new THREE.Group()); root.add(body);
    add(body, lathe([[0.37, 0], [0.34, 0.04], [0.27, 0.5], [0.205, 0.95], [0.2, 1.05], [0.225, 1.28], [0.2, 1.4], [0.085, 1.5], [0.0, 1.5]], 16, 0.8), robe);
    add(body, lathe([[0.315, 1.14], [0.3, 1.2], [0.25, 1.36], [0.16, 1.47], [0.09, 1.53], [0, 1.53]], 16, 0.86), mantle);
    add(body, merged([ring(0.362, 0.035, 0.013, 0.8), ring(0.212, 1.0, 0.016, 0.8), ring(0.315, 1.145, 0.011, 0.86), ...(d.prop === 'scroll' ? [tube([-0.16, 0.9, -0.2], [0.14, 1.34, -0.2], 0.035, 0.035, 8)] : [])]), gold);
    // Sleeves: from the shoulders down and in, the hands hidden where they meet.
    for (const sg of [1, -1]) {
      const arm = new THREE.Group(); arm.position.set(sg * 0.205, 1.34, 0); body.add(arm);
      add(arm, merged([tube([0, 0, 0], [sg * 0.03, -0.31, 0.03], 0.07, 0.085), tube([sg * 0.03, -0.3, 0.02], [-sg * 0.15, -0.36, 0.2], 0.085, 0.1)]), robe);
      n[sg > 0 ? 'armL' : 'armR'] = arm;
    }
    const head = (n.head = new THREE.Group()); head.position.set(0, 1.61, 0); body.add(head);
    { const hood = new THREE.SphereGeometry(0.14, 14, 10); hood.scale(1, 1.08, 1.12); hood.translate(0, 0.01, -0.025);
      const drape = lathe([[0.15, -0.1], [0.135, -0.02], [0.1, 0.06]], 14, 1.0); drape.translate(0, -0.04, -0.03);
      add(head, merged([hood, drape]), robe); }
    { const face = new THREE.SphereGeometry(0.1, 14, 10); face.scale(0.86, 1.1, 0.5); face.translate(0, -0.005, 0.085); add(head, face, mask); }
    add(head, merged([new THREE.BoxGeometry(0.036, 0.009, 0.012).translate(0.036, 0.012, 0.133), new THREE.BoxGeometry(0.036, 0.009, 0.012).translate(-0.036, 0.012, 0.133)]), dark);
    add(head, ring(0.139, 0.075, 0.008, 1.1).translate(0, 0, -0.025), gold);
    if (d.prop === 'staff') {
      const wood = this._mat(n, WOOD);
      add(body, tube([-0.34, 0, 0.16], [-0.3, 1.86, 0.1], 0.018, 0.015, 7), wood);
      add(body, new THREE.OctahedronGeometry(0.07, 0).scale(0.7, 1.5, 0.7).translate(-0.298, 1.96, 0.097), gold);
    }
    if (d.prop === 'lute') {
      const wood = this._mat(n, WOOD);
      const bowl = new THREE.SphereGeometry(0.15, 12, 8); bowl.scale(0.8, 1.1, 0.45);
      const g = merged([bowl, tube([0, 0.12, 0], [0, 0.5, 0], 0.022, 0.018, 6)]); g.rotateZ(0.7); g.translate(0.02, 0.98, -0.2);
      add(body, g, wood);
    }
    this.pipe.scene.add(root);
    this._dye(n);
  }

  // Stone when asleep, dyed when awake, and every shade between while waking.
  _dye(n) {
    const k = ease(clamp01(n.k));
    for (const { m, look } of n.mats) {
      const [a, r, me, sh, em] = look;
      m.uniforms.uAlbedo.value.set(STONE[0][0] + (a[0] - STONE[0][0]) * k, STONE[0][1] + (a[1] - STONE[0][1]) * k, STONE[0][2] + (a[2] - STONE[0][2]) * k);
      m.uniforms.uSurf.value.set(STONE[1] + (r - STONE[1]) * k, me * k, sh * k, em * k);
    }
  }

  get(id) { return this.list.find((n) => n.def.id === id); }
  // The one the hero could speak with now.
  near() {
    const p = this.game.player;
    let best = null, bd = 3.1;
    for (const n of this.list) { if (!n.awake || n.k < 0.9) continue; const d = Math.hypot(p.pos.x - n.x, p.pos.z - n.z); if (d < bd && Math.abs(p.pos.y - n.y) < 2) { bd = d; best = n; } }
    return best;
  }

  // Begins a conversation: lines is a list of strings; done runs when the last is closed.
  speak(n, lines, done = null) {
    const g = this.game, p = g.player, cam = this.pipe.camera;
    this.talk = { n, lines, i: 0, done, t: 0, phase: 'in', from: { pos: cam.position.clone(), quat: cam.quaternion.clone(), fov: cam.fov } };
    p.vel.x = p.vel.z = 0; p.lockTarget = null; p.yaw = Math.atan2(n.x - p.pos.x, n.z - p.pos.z);
    p.invulnerable = 1e6;                         // nothing reaches him while he listens
    g.emit('dialogue', { phase: 'open', name: n.def.name, role: n.def.role, text: lines[0], last: lines.length === 1 });
  }

  _view(outPos, outLook) {
    // Over the hero's shoulder, the speaker a little off centre.
    const g = this.game, p = g.player.pos, n = this.talk.n;
    const dx = n.x - p.x, dz = n.z - p.z, d = Math.hypot(dx, dz) || 1, ux = dx / d, uz = dz / d;
    outPos.set(p.x - ux * 1.7 + uz * 0.95, p.y + 1.72, p.z - uz * 1.7 - ux * 0.95);
    const fl = g.world.groundHeight(outPos.x, outPos.z) + 0.4; if (outPos.y < fl) outPos.y = fl;
    outLook.set(n.x - uz * 0.25, n.y + 1.5 * n.def.h, n.z + ux * 0.25);
  }

  update(dt, playing) {
    const g = this.game, p = g.player, cam = this.pipe.camera, cine = !!g.cine;
    for (const n of this.list) {
      const dist = Math.hypot(p.pos.x - n.x, p.pos.z - n.z), show = !cine && dist < 260;
      if (n.shown !== show) { n.shown = show; for (const m of n.meshes) m.visible = show; }
      // Waking: the spire sings, a breath passes, colour comes back from the hem upward.
      if (!n.awake && n.spire?.tuned) { n.awake = true; n.wakeT = 2.2; }
      if (n.awake && n.k < 1) {
        if ((n.wakeT = (n.wakeT ?? 0) - dt) < 0) {
          const before = n.k; n.k = Math.min(1, n.k + dt / 2.6); this._dye(n);
          if (before === 0) { g.vfx.wave(n.x, n.y + 0.06, n.z, { r0: 0.3, r1: 3, life: 0.9, strength: 0.7, width: 0.1, color: [3.0, 2.2, 1.0] }); g.emit('people', { type: 'wake', id: n.def.id, name: n.def.name }); }
          if (show && Math.random() < dt * 30) g.particles.spawn(n.x + (Math.random() - 0.5) * 0.6, n.y + n.k * 1.7, n.z + (Math.random() - 0.5) * 0.6, { vel: [0, 0.8 + Math.random(), 0], life: 0.9, size: 0.04, color: [3.2, 2.4, 1.1], drag: 0.8 });
        }
      }
      if (!show) continue;
      const k = ease(clamp01(n.k)), talking = this.talk?.n === n;
      n.t += dt * k;
      // Turn to whoever comes near, and back to their own business when left alone.
      const toP = Math.atan2(p.pos.x - n.x, p.pos.z - n.z), close = k > 0.9 && dist < 7;
      n.yaw += wrap((close ? toP : n.home) - n.yaw) * Math.min(1, dt * (talking ? 5 : 1.6)) * k;
      n.headYaw += ((k > 0.9 && dist < 14 ? Math.max(-0.9, Math.min(0.9, wrap(toP - n.yaw))) : 0.25 * Math.sin(n.t * 0.3)) - n.headYaw) * Math.min(1, dt * 4);
      n.gesture += ((talking && this.talk.phase !== 'out' ? 1 : 0) - n.gesture) * Math.min(1, dt * 5);
      n.root.rotation.y = n.yaw;
      n.body.rotation.z = 0.014 * Math.sin(n.t * 0.8) * k; n.body.rotation.x = 0.01 * Math.sin(n.t * 0.55 + 1) * k;
      n.body.scale.y = 1 + 0.005 * Math.sin(n.t * 1.5) * k;
      n.head.rotation.set((1 - k) * 0.32 + 0.05 * Math.sin(n.t * 2.3) * n.gesture, n.headYaw, 0.05 * Math.sin(n.t * 1.1) * n.gesture);
      // A speaking hand: the right sleeve lifts and turns with the words.
      n.armR.rotation.set(-(0.5 + 0.18 * Math.sin(n.t * 2.6)) * n.gesture, 0, -0.25 * n.gesture);
      n.armL.rotation.set(-0.12 * n.gesture, 0, 0);
      n.root.updateMatrixWorld(true);
    }
    if (!playing) return;
    const T = this.talk;
    if (T) {
      T.t += dt;
      this._view(_v, _from.pos);
      const hold = () => { cam.position.copy(_v); cam.lookAt(_from.pos); if (Math.abs(cam.fov - 44) > 0.01) { cam.fov = 44; cam.updateProjectionMatrix(); } };
      if (T.phase === 'in') {
        hold();
        const w = ease(clamp01(T.t / 0.7));
        cam.position.lerpVectors(T.from.pos, cam.position, w); cam.quaternion.copy(_q.copy(T.from.quat).slerp(cam.quaternion, w));
        cam.fov = T.from.fov + (44 - T.from.fov) * w; cam.updateProjectionMatrix();
        if (T.t >= 0.7) { T.phase = 'hold'; T.t = 0; }
      } else if (T.phase === 'hold') {
        hold();
        const inp = g.input.pressed;
        if (T.t > 0.25 && (inp.has('interact') || inp.has('attack') || inp.has('jump'))) {
          T.i++; T.t = 0;
          if (T.i >= T.lines.length) { T.phase = 'out'; T.from = { pos: cam.position.clone(), quat: cam.quaternion.clone(), fov: cam.fov }; g.rig.snap(p); g.rig.yaw = p.yaw; g.rig.pitch = -0.16; g.emit('dialogue', { phase: 'close' }); }
          else g.emit('dialogue', { phase: 'line', name: T.n.def.name, role: T.n.def.role, text: T.lines[T.i], last: T.i === T.lines.length - 1 });
        }
      } else {
        const w = ease(clamp01(T.t / 0.6));
        g.rig.update(0, p, { look: { x: 0, y: 0 }, zoom: 0 });
        cam.position.lerpVectors(T.from.pos, cam.position, w); cam.quaternion.copy(_q.copy(T.from.quat).slerp(cam.quaternion, w));
        if (T.t >= 0.6) { this.talk = null; p.invulnerable = 0.5; T.done?.(); }
      }
    }
  }
}
