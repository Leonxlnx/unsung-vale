// Pose rig. Poses are written as small rotations in the character's own space (x = its
// left, y = up, z = forward) relative to the rest pose, so they do not depend on how the
// modelling tool happened to orient each bone. For a bone b with rest world rotation W_b:
//   local_b = inverse(W_parent) * D_b * W_b
// where D_b is the pose rotation for that bone. Children inherit their parent's motion
// through the hierarchy as usual.
import * as THREE from 'three';

const key = (name) => name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _m = new THREE.Matrix4();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3(), _k = new THREE.Vector3(), _t = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _q4 = new THREE.Quaternion();

export class Rig {
  constructor(root) {
    this.bones = {};
    root.updateWorldMatrix(true, true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    root.traverse((o) => {
      if (!o.isBone) return;
      // Rest rotation in character space.
      const w = new THREE.Quaternion().setFromRotationMatrix(_m.multiplyMatrices(inv, o.matrixWorld));
      this.bones[key(o.name)] = { bone: o, rest: w, restLocal: o.quaternion.clone(), restPos: o.position.clone(), parentInv: null, pose: new THREE.Quaternion(), hasPose: false };
    });
    for (const b of Object.values(this.bones)) {
      const p = b.bone.parent?.isBone ? this.bones[key(b.bone.parent.name)] : null;
      b.parentInv = p ? p.rest.clone().invert() : new THREE.Quaternion();
    }
    this.root = root;
  }

  has(name) { return !!this.bones[key(name)]; }
  get(name) { return this.bones[key(name)]?.bone; }

  // Clears every pose back to rest.
  reset() { for (const b of Object.values(this.bones)) { b.pose.identity(); b.hasPose = false; } }

  // Adds a character-space rotation (radians) to a bone's pose. weight scales the angles.
  rot(name, x = 0, y = 0, z = 0, weight = 1) {
    const b = this.bones[key(name)];
    if (!b) return;
    _q.setFromEuler(_e.set(x * weight, y * weight, z * weight, 'YXZ'));
    b.pose.premultiply(_q); b.hasPose = true;
  }

  // The same about any axis given in character space (need not be unit length).
  rotAxis(name, ax, ay, az, angle) {
    const b = this.bones[key(name)];
    if (!b || !angle) return;
    const l = Math.hypot(ax, ay, az) || 1;
    _q.setFromAxisAngle(_v.set(ax / l, ay / l, az / l), angle);
    b.pose.premultiply(_q); b.hasPose = true;
  }

  // World orientation of a bone (its parents' matrices are brought up to date first).
  worldQ(bone, out) { bone.updateWorldMatrix(true, false); return out.setFromRotationMatrix(bone.matrixWorld); }

  // Turns a bone so that its orientation in the world is exactly q, whatever its parents do.
  setWorldQ(name, q, weight = 1) {
    const b = this.bones[key(name)];
    if (!b) return;
    this.worldQ(b.bone.parent, _q4).invert().multiply(q);
    if (weight >= 1) b.bone.quaternion.copy(_q4); else b.bone.quaternion.slerp(_q4, weight);
  }

  // The same in the character's own space: the bone's rest orientation turned by d (a
  // quaternion in character axes), e.g. a foot held flat on the ground while the leg moves.
  setCharQ(name, d, weight = 1) {
    const b = this.bones[key(name)];
    if (!b) return;
    this.worldQ(this.root, _q3).multiply(d).multiply(b.rest);
    this.setWorldQ(name, _q3, weight);
  }

  // Two-bone inverse kinematics: turns `upper` and `lower` so that the origin of `end`
  // reaches `target` (world space), bending toward `pole` (a world direction). Out-of-reach
  // targets are approached with the limb straight. weight blends against the pose the limb
  // already has.
  ik(upper, lower, end, target, pole, weight = 1) {
    const U = this.bones[key(upper)]?.bone, L = this.bones[key(lower)]?.bone, E = this.bones[key(end)]?.bone;
    if (!U || !L || !E || weight <= 0) return;
    const u0 = _q1.copy(U.quaternion), l0 = _q2.copy(L.quaternion);
    U.updateWorldMatrix(true, false); L.updateWorldMatrix(false, false); E.updateWorldMatrix(false, false);
    const a = _a.setFromMatrixPosition(U.matrixWorld), b = _b.setFromMatrixPosition(L.matrixWorld), c = _c.setFromMatrixPosition(E.matrixWorld);
    const lab = a.distanceTo(b), lcb = b.distanceTo(c);
    const dir = _d.copy(target).sub(a);
    const lat = Math.max(Math.abs(lab - lcb) + 1e-3, Math.min((lab + lcb) * 0.9995, dir.length()));
    dir.normalize();
    // The part of the pole that is square to the reach direction says which way the joint bends.
    const pp = _p.copy(pole).addScaledVector(dir, -pole.dot(dir));
    if (pp.lengthSq() < 1e-8) pp.set(dir.y, dir.z, dir.x).addScaledVector(dir, -(dir.x * dir.y + dir.y * dir.z + dir.z * dir.x));
    pp.normalize();
    const cosA = Math.max(-1, Math.min(1, (lab * lab + lat * lat - lcb * lcb) / (2 * lab * lat))), sinA = Math.sqrt(1 - cosA * cosA);
    const knee = _k.copy(a).addScaledVector(dir, lab * cosA).addScaledVector(pp, lab * sinA);
    // Upper bone: swing its child toward the joint position.
    _q.setFromUnitVectors(_v.copy(b).sub(a).normalize(), _v2.copy(knee).sub(a).normalize());
    this.worldQ(U, _q3).premultiply(_q);
    this.worldQ(U.parent, _q4).invert().multiply(_q3);
    U.quaternion.copy(_q4);
    U.updateWorldMatrix(false, false); L.updateWorldMatrix(false, false); E.updateWorldMatrix(false, false);
    // Lower bone: swing the end onto the target.
    b.setFromMatrixPosition(L.matrixWorld); c.setFromMatrixPosition(E.matrixWorld);
    _t.copy(a).addScaledVector(dir, lat);
    _q.setFromUnitVectors(_v.copy(c).sub(b).normalize(), _v2.copy(_t).sub(b).normalize());
    _q3.setFromRotationMatrix(L.matrixWorld).premultiply(_q);
    _q4.setFromRotationMatrix(U.matrixWorld).invert().multiply(_q3);
    L.quaternion.copy(_q4);
    if (weight < 1) { U.quaternion.copy(u0.slerp(U.quaternion, weight)); L.quaternion.copy(l0.slerp(L.quaternion, weight)); }
    U.updateWorldMatrix(false, true);
  }

  // Writes the accumulated poses into the bones' local rotations.
  apply() {
    for (const b of Object.values(this.bones)) {
      if (b.locked) continue;
      if (!b.hasPose) { b.bone.quaternion.copy(b.restLocal); continue; }
      b.bone.quaternion.copy(b.parentInv).multiply(b.pose).multiply(b.rest);
    }
  }
}

// Verlet spring chains for cloth-like bones (cape, tabard). Each bone's tail swings behind
// the body with gravity, wind and a simple collision against the torso and legs.
export class SpringChains {
  constructor(rig, chains, opts = {}) {
    this.rig = rig; this.opts = { drag: 0.14, stiffness: 2.2, gravity: 7.5, ...opts };
    this.chains = chains.map((names) => names.map((n) => rig.bones[key(n)]).filter(Boolean)).filter((c) => c.length);
    this.state = new Map();
    for (const chain of this.chains) for (let i = 0; i < chain.length; i++) {
      const b = chain[i]; b.locked = true;
      // The bone's length is the distance to its child, or its parent's length at the tip.
      const child = chain[i + 1];
      const len = child ? child.bone.position.length() : (i > 0 ? chain[i].bone.position.length() : 0.2);
      // Rest direction of the bone in its parent's space (toward the child / along +y for tips).
      const axis = child ? child.bone.position.clone().normalize() : new THREE.Vector3(0, 1, 0);
      this.state.set(b, { len: Math.max(0.03, len), axis, tail: new THREE.Vector3(), prev: new THREE.Vector3(), init: false });
    }
    this.wind = new THREE.Vector3();
    this.colliders = [];     // { a: Vector3, b: Vector3, r } capsules in world space
  }

  // Forget all motion: the cloth hangs at rest from wherever the body is next updated.
  // Call after moving the character somewhere else in one step.
  reset() { for (const s of this.state.values()) s.init = false; }

  update(dt, time) {
    const o = this.opts;
    dt = Math.min(dt, 1 / 30);
    for (const chain of this.chains) for (const b of chain) {
      const s = this.state.get(b), bone = b.bone, parent = bone.parent;
      parent.updateWorldMatrix(false, false);
      // Rest orientation this frame given where the parent is now.
      const pq = _q.setFromRotationMatrix(parent.matrixWorld);
      const head = _v.copy(bone.position).applyMatrix4(parent.matrixWorld);
      const restQ = pq.clone().multiply(b.restLocal);
      const restDir = s.axis.clone().applyQuaternion(restQ).normalize();
      if (!s.init) { s.tail.copy(head).addScaledVector(restDir, s.len); s.prev.copy(s.tail); s.init = true; }
      const vel = _v2.copy(s.tail).sub(s.prev).multiplyScalar(1 - o.drag);
      s.prev.copy(s.tail);
      s.tail.add(vel);
      s.tail.addScaledVector(restDir, o.stiffness * dt);
      s.tail.y -= o.gravity * dt * dt * 6;
      const gust = 0.6 + 0.4 * Math.sin(time * 2.1 + head.x * 0.7) + 0.25 * Math.sin(time * 5.3 + head.z);
      s.tail.addScaledVector(this.wind, dt * gust);
      // Keep the cloth outside the body.
      for (const c of this.colliders) {
        const ab = c.b.clone().sub(c.a), t = Math.max(0, Math.min(1, s.tail.clone().sub(c.a).dot(ab) / ab.lengthSq()));
        const cp = c.a.clone().addScaledVector(ab, t), d = s.tail.clone().sub(cp), dl = d.length();
        if (dl < c.r && dl > 1e-5) s.tail.copy(cp).addScaledVector(d, c.r / dl);
      }
      // Restore the bone's length, then aim the bone at its tail.
      const dir = s.tail.clone().sub(head).normalize();
      s.tail.copy(head).addScaledVector(dir, s.len);
      const aim = new THREE.Quaternion().setFromUnitVectors(restDir, dir);
      const worldQ = aim.multiply(restQ);
      bone.quaternion.copy(pq.invert().multiply(worldQ));
      bone.updateMatrix();
      bone.matrixWorld.multiplyMatrices(parent.matrixWorld, bone.matrix);
    }
  }
}
