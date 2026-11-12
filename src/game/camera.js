// Third-person follow camera: orbits the player's shoulder, pulls in when geometry is in
// the way, widens slightly at a sprint, and frames a locked-on enemy.
import * as THREE from 'three';

const _pivot = new THREE.Vector3(), _dir = new THREE.Vector3(), _want = new THREE.Vector3(), _right = new THREE.Vector3();

export class CameraRig {
  constructor(camera, world) {
    this.camera = camera; this.world = world;
    this.yaw = 0; this.pitch = -0.12;
    this.distance = 4.4; this.current = 4.4;
    this.baseFov = 60; this.fov = 60;
    this.follow = new THREE.Vector3();
    this.shake = 0;
    this.shoulder = 0.55;
    this.time = 0;
  }

  snap(player) {
    this.follow.copy(player.pos);
    this.yaw = player.yaw;
    this.current = this.distance;
  }

  addShake(amount) { this.shake = Math.min(1, this.shake + amount); }

  update(dt, player, input) {
    this.time += dt;
    this.yaw -= input.look.x;
    this.pitch = Math.max(-1.15, Math.min(1.05, this.pitch - input.look.y));
    if (input.zoom) this.distance = Math.max(2.4, Math.min(7.5, this.distance + input.zoom * 0.5));

    const target = player.lockTarget;
    if (target) {
      // Ease the view around so both fighters stay in frame.
      const want = Math.atan2(target.pos.x - player.pos.x, target.pos.z - player.pos.z);
      let d = want - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, 4.5 * dt);
      this.pitch += (-0.2 - this.pitch) * Math.min(1, 2.5 * dt);
    }

    // The pivot trails the player slightly so motion reads as weight, not as a rigid mount.
    const k = 1 - Math.exp(-14 * dt);
    this.follow.lerp(player.pos, k);
    this.follow.y += (player.pos.y - this.follow.y) * (1 - Math.exp(-9 * dt)) * 0.5;

    const cp = Math.cos(this.pitch);
    _dir.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    _right.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    _pivot.copy(this.follow); _pivot.y += 1.55;
    // Shoulder offset, shortened if a wall is right beside the player.
    const side = Math.min(this.shoulder, this.world.raycast(_pivot, _right, this.shoulder + 0.3) - 0.25);
    _pivot.addScaledVector(_right, Math.max(0, side));

    _dir.negate();
    const free = this.world.raycast(_pivot, _dir, this.distance + 0.4) - 0.3;
    const wantDist = Math.max(0.7, Math.min(this.distance, free));
    // Pull in instantly, ease back out.
    this.current = wantDist < this.current ? wantDist : this.current + (wantDist - this.current) * (1 - Math.exp(-4 * dt));
    _want.copy(_pivot).addScaledVector(_dir, this.current);
    const floor = this.world.groundHeight(_want.x, _want.z) + 0.25;
    if (_want.y < floor) _want.y = floor;

    this.shake = Math.max(0, this.shake - dt * 2.6);
    const s = this.shake * this.shake * 0.22;
    this.camera.position.copy(_want);
    this.camera.position.x += Math.sin(this.time * 61) * s; this.camera.position.y += Math.sin(this.time * 73 + 1) * s;
    _dir.negate();
    this.camera.lookAt(_want.x + _dir.x, _want.y + _dir.y, _want.z + _dir.z);
    this.camera.rotateZ(Math.sin(this.time * 47) * s * 0.06);

    const fovWant = this.baseFov + (player.sprinting ? 7 : 0) + (player.state === 'roll' ? 3 : 0);
    this.fov += (fovWant - this.fov) * (1 - Math.exp(-5 * dt));
    if (Math.abs(this.camera.fov - this.fov) > 0.01) { this.camera.fov = this.fov; this.camera.updateProjectionMatrix(); }
  }
}
