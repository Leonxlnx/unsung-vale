// Pose rig. Poses are written as small rotations in the character's own space (x = its
// left, y = up, z = forward) relative to the rest pose, so they do not depend on how the
// modelling tool happened to orient each bone. For a bone b with rest world rotation W_b:
//   local_b = inverse(W_parent) * D_b * W_b
// where D_b is the pose rotation for that bone. Children inherit their parent's motion
// through the hierarchy as usual.
import * as THREE from 'three';

const key = (name) => name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _m = new THREE.Matrix4();

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
