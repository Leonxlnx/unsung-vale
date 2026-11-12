// Player logic: a kinematic capsule with run, sprint, jump, dodge roll and sword combos.
// This file knows nothing about rendering; the hero visual reads its state each frame.
import * as THREE from 'three';

export const TUNE = {
  radius: 0.36, height: 1.82,
  walk: 1.7, run: 5.2, sprint: 7.8, accel: 26, airAccel: 9, turn: 12,
  gravity: 23, jump: 7.6, coyote: 0.12, buffer: 0.14,
  rollTime: 0.62, rollSpeed: 9.4, rollCost: 22, rollIFrames: [0.06, 0.44],
  staminaMax: 100, staminaRegen: 26, staminaDelay: 0.7, sprintCost: 9, jumpCost: 6,
  healthMax: 100,
  // Light combo steps: duration, active window, damage, lunge, stamina.
  combo: [
    { t: 0.46, hit: [0.14, 0.27], dmg: 18, lunge: 3.2, cost: 9, arc: 1.5, reach: 2.5 },
    { t: 0.46, hit: [0.13, 0.26], dmg: 21, lunge: 3.2, cost: 9, arc: 1.5, reach: 2.5 },
    { t: 0.7, hit: [0.22, 0.42], dmg: 36, lunge: 4.2, cost: 14, arc: 6.3, reach: 2.9 },
  ],
  heavy: { t: 0.86, hit: [0.33, 0.46], dmg: 58, lunge: 5.2, cost: 26, arc: 1.3, reach: 3.2 },
  pulseCooldown: 9, pulseRadius: 8.5,
  // Falling strike: a turn in the air, then straight down blade first.
  plunge: { cost: 16, hang: 0.26, dive: 30, radius: 3.8, dmg: 34, recover: 0.5 },
  swim: 2.7, swimFast: 4.0, swimCost: 5, swimDepth: 1.18,      // he floats with the water this far up his body
  // Sprinting strike: the run carried into a full turn of the blade.
  dash: { t: 0.7, hit: [0.2, 0.42], dmg: 46, lunge: 13, cost: 18, arc: 6.3, reach: 3.0 },
  // The refrain: he hums the note he carries and it mends him. A few to a journey between
  // places of rest; it takes a moment in which he cannot move or strike.
  refrain: { time: 0.95, at: 0.55, heal: 0.45, charges: 3 },
};

const _v = new THREE.Vector3();

export class Player {
  constructor(world) {
    this.world = world;
    // What he has been given along the way: more life, more breath, a keener edge, and the
    // things each spire teaches (see Game._skills).
    this.up = { health: 0, stamina: 0, blade: 0 }; this.skills = new Set();
    this.refrains = TUNE.refrain.charges; this.refrainMax = TUNE.refrain.charges; this.inCombat = false;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;                   // facing: (sin yaw, 0, cos yaw)
    this.grounded = false;
    this.state = 'move';            // move | roll | attack | hurt | dead
    this.stateTime = 0;
    this.health = this.healthMax;
    this.stamina = this.staminaMax;
    this.staminaWait = 0;
    this.comboStep = -1;
    this.attack = null;             // current attack descriptor
    this.attackQueued = false;
    this.hitDone = new Set();       // enemies already struck by the current swing
    this.invulnerable = 0;
    this.pulseTimer = 0;
    this.lockTarget = null;
    this.speed = 0;                 // horizontal speed, for animation
    this.moveDir = new THREE.Vector3(0, 0, 1);
    this.airTime = 0; this.coyote = 0; this.jumpBuffer = 0;
    this.fallStart = 0;
    this.lastSafe = new THREE.Vector3();
    this.safeTimer = 0;
    this.events = [];               // drained by the game each frame: { type, ... }
    this.stepPhase = 0;
    this.sprinting = false;
  }

  spawn(x, y, z, yaw = 0) {
    this.pos.set(x, y, z); this.vel.set(0, 0, 0); this.yaw = yaw; this.viewY = this._viewY1 = y;
    this.lastSafe.copy(this.pos);
    this.state = 'move'; this.health = this.healthMax; this.stamina = this.staminaMax; this.windUsed = false; this.refrains = this.refrainMax;
  }

  get healthMax() { return TUNE.healthMax + 20 * this.up.health + (this.skills.has('gift') ? 20 : 0); }
  get staminaMax() { return TUNE.staminaMax + 15 * this.up.stamina + (this.skills.has('gift') ? 15 : 0); }
  get power() { return 1 + 0.12 * this.up.blade; }

  get facing() { return _v.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  emit(type, data) { this.events.push({ type, ...data }); }

  setState(s) { this.state = s; this.stateTime = 0; }

  damage(amount, from) {
    if (this.state === 'dead' || this.invulnerable > 0) return false;
    if (this.state === 'roll' && this.stateTime > TUNE.rollIFrames[0] && this.stateTime < TUNE.rollIFrames[1]) { this.emit('evade'); return false; }
    this.health = Math.max(0, this.health - amount);
    // Second wind: once in a life, a blow that should have ended him does not.
    if (this.health <= 0 && this.skills.has('wind') && !this.windUsed) { this.windUsed = true; this.health = Math.round(this.healthMax * 0.3); this.invulnerable = 1.6; this.sinceHurt = 0; this.emit('wind'); return true; }
    this.invulnerable = 0.55; this.sinceHurt = 0;
    const heavy = amount >= 22 && this.state !== 'swim';
    if (from) { _v.copy(this.pos).sub(from).setY(0).normalize(); const sp = heavy ? 9 : 6.5; this.vel.x = _v.x * sp; this.vel.z = _v.z * sp; this.hurtDir = Math.atan2(_v.x, _v.z); }
    this.attack = null; this.comboStep = -1;
    if (this.health <= 0) { this.setState('dead'); this.emit('death'); }
    else if (heavy) { this.setState('down'); this.vel.y = 4.4; this.grounded = false; this.invulnerable = 1.5; if (from) this.yaw = this.hurtDir + Math.PI; this.emit('hurt', { amount, heavy: true }); }
    else { this.setState('hurt'); this.emit('hurt', { amount }); }
    return true;
  }

  spend(cost) {
    if (this.stamina < Math.min(cost, 8)) return false;
    this.stamina = Math.max(0, this.stamina - cost);
    this.staminaWait = TUNE.staminaDelay;
    return true;
  }

  startAttack(desc, index) {
    if (!this.spend(desc.cost)) return false;
    this.attack = desc; this.comboStep = index; this.attackQueued = false; this.hitDone.clear();
    this.setState('attack');
    // Turn toward the lock target or the stick before committing.
    const want = this._wish.lengthSq() > 0.04 ? this._wish : this.facing;
    const foe = this.lockTarget ?? this.aimAssist?.(want.x, want.z) ?? null;
    if (foe) this.yaw = Math.atan2(foe.pos.x - this.pos.x, foe.pos.z - this.pos.z);
    else if (this._wish.lengthSq() > 0.04) this.yaw = Math.atan2(this._wish.x, this._wish.z);
    const f = this.facing;
    // The lunge carries about lunge / 7.5 metres; with a foe ahead it ends at striking distance.
    let lunge = desc.lunge;
    if (foe) { const gap = Math.hypot(foe.pos.x - this.pos.x, foe.pos.z - this.pos.z) - (foe.def?.radius ?? 0.5) - desc.reach * 0.5; lunge = Math.max(0.6, Math.min(desc.lunge * 2, gap * 7.5)); }
    this.vel.x = f.x * lunge; this.vel.z = f.z * lunge;
    this.emit('swing', { index });
    return true;
  }

  // True while the blade can hurt something.
  get attackActive() { return this.state === 'attack' && this.attack && this.stateTime >= this.attack.hit[0] && this.stateTime <= this.attack.hit[1]; }

  update(dt, input, camYaw) {
    const T = TUNE;
    this.stateTime += dt;
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.pulseTimer = Math.max(0, this.pulseTimer - dt);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    if (this.staminaWait > 0) this.staminaWait -= dt; else this.stamina = Math.min(this.staminaMax, this.stamina + T.staminaRegen * dt);

    // Movement wish in world space, relative to the camera.
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
    this._wish ??= new THREE.Vector3();
    const wish = this._wish.set(fx * input.move.y - fz * input.move.x, 0, fz * input.move.y + fx * input.move.x);
    const wishLen = Math.min(1, wish.length());
    if (wishLen > 1e-3) wish.multiplyScalar(1 / wish.length());

    if (this.state === 'dead') { this.vel.x *= Math.exp(-6 * dt); this.vel.z *= Math.exp(-6 * dt); this._integrate(dt); return; }
    // Carried along a string of light: the string moves him (see strings.js).
    if (this.state === 'ride') return;
    // Water deep enough to float in: swim. Shallow water is waded through like ground.
    const surface = this.world.waterLevel(this.pos.x, this.pos.z);
    this.water = surface;
    if (this.state !== 'swim' && this.state !== 'hurt' && surface - this.pos.y > T.swimDepth + 0.1) {
      if (this.vel.y < -6 || this.airTime > 0.3) this.emit('splash', { speed: -this.vel.y });
      this.setState('swim'); this.attack = null; this.comboStep = -1; this.sprinting = false;
    }
    if (this.state === 'swim') { this._swim(dt, input, wish, wishLen, surface); return; }
    if (input.pressed.has('jump')) this.jumpBuffer = T.buffer;

    if (input.pressed.has('walk')) this.walking = !this.walking;
    this.sinceHurt = (this.sinceHurt ?? 99) + dt;
    if (this.sinceHurt > 9 && !this.inCombat && this.health < this.healthMax * 0.5) this.health = Math.min(this.healthMax * 0.5, this.health + 2.5 * dt);
    if (this.state === 'move') {
      this.sprinting = input.held.has('sprint') && wishLen > 0.5 && this.stamina > 1 && this.grounded;
      if (this.sprinting) this.walking = false;
      if (this.sprinting) { this.stamina = Math.max(0, this.stamina - T.sprintCost * dt); this.staminaWait = 0.25; }
      const top = (this.sprinting ? T.sprint : wishLen > 0.55 && !this.walking ? T.run : T.walk) * (this.lockTarget ? 0.82 : 1);
      const accel = this.grounded ? T.accel : T.airAccel;
      const tx = wish.x * top * wishLen, tz = wish.z * top * wishLen;
      const k = Math.min(1, (accel * dt) / Math.max(0.001, Math.hypot(tx - this.vel.x, tz - this.vel.z)));
      this.vel.x += (tx - this.vel.x) * k; this.vel.z += (tz - this.vel.z) * k;
      // Face the lock target, otherwise the direction of travel.
      let targetYaw = null;
      if (this.lockTarget) targetYaw = Math.atan2(this.lockTarget.pos.x - this.pos.x, this.lockTarget.pos.z - this.pos.z);
      else if (wishLen > 0.05) targetYaw = Math.atan2(wish.x, wish.z);
      if (targetYaw !== null) {
        let d = targetYaw - this.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.yaw += d * Math.min(1, T.turn * dt);
      }
      if (this.jumpBuffer > 0 && (this.grounded || this.coyote > 0) && this.spend(T.jumpCost)) {
        this.vel.y = T.jump; this.grounded = false; this.coyote = 0; this.jumpBuffer = 0; this.emit('jump');
      }
      if (input.pressed.has('dodge') && this.grounded && this.spend(T.rollCost)) {
        this.setState('roll');
        const d = wishLen > 0.2 ? wish : this.facing;
        this.rollDir = new THREE.Vector3(d.x, 0, d.z).normalize();
        this.yaw = Math.atan2(this.rollDir.x, this.rollDir.z);
        this.emit('roll');
      } else if (input.pressed.has('attack') && !this.grounded && this.airTime > 0.08 && this.spend(T.plunge.cost)) {
        this.setState('plunge'); this.plungeHit = false; this.plungeTop = this.pos.y;
        // Lean the fall toward a foe below, if there is one.
        const foe = this.lockTarget ?? this.aimAssist?.(this.facing.x, this.facing.z, 9) ?? null;
        this.plungeAim = foe ? foe.pos.clone() : null;
        if (foe) this.yaw = Math.atan2(foe.pos.x - this.pos.x, foe.pos.z - this.pos.z);
        this.emit('plungeStart');
      } else if (input.pressed.has('attack') && this.grounded && this.sprinting && this.skills.has('dash')) { if (this.startAttack(T.dash, 2)) this.emit('dash'); }
      else if (input.pressed.has('attack') && this.grounded) this.startAttack(T.combo[0], 0);
      else if (input.pressed.has('heavy') && this.grounded) this.startAttack(T.heavy, 3);
      else if (input.pressed.has('heal') && this.grounded && this.refrains > 0 && this.health < this.healthMax) { this.setState('heal'); this.healed = false; this.vel.x = this.vel.z = 0; this.emit('healStart'); }
      else if (input.pressed.has('pulse') && this.pulseTimer <= 0 && this.grounded && this.skills.has('pulse')) { this.pulseTimer = this.skills.has('surge') ? 6 : T.pulseCooldown; this.emit('pulse'); }
    } else if (this.state === 'roll') {
      const t = this.stateTime / T.rollTime;
      const sp = T.rollSpeed * (1 - 0.62 * t * t);
      this.vel.x = this.rollDir.x * sp; this.vel.z = this.rollDir.z * sp;
      if (t >= 1) this.setState('move');
    } else if (this.state === 'attack') {
      const a = this.attack;
      const drag = Math.exp(-7.5 * dt);
      this.vel.x *= drag; this.vel.z *= drag;
      if (input.pressed.has('attack')) this.attackQueued = true;
      if (input.pressed.has('dodge') && this.stateTime > a.hit[1] && this.spend(T.rollCost)) {
        this.setState('roll'); this.attack = null; this.comboStep = -1;
        const d = wishLen > 0.2 ? wish : this.facing;
        this.rollDir = new THREE.Vector3(d.x, 0, d.z).normalize();
        this.yaw = Math.atan2(this.rollDir.x, this.rollDir.z);
        this.emit('roll');
      } else if (this.attackQueued && this.comboStep < 2 && this.comboStep >= 0 && this.stateTime > a.t * 0.62) {
        if (!this.startAttack(T.combo[this.comboStep + 1], this.comboStep + 1)) this.attackQueued = false;
      } else if (this.stateTime >= a.t) { this.attack = null; this.comboStep = -1; this.setState('move'); }
    } else if (this.state === 'plunge') {
      const P = T.plunge;
      if (!this.plungeHit) {
        if (this.stateTime < P.hang) {
          // Hang for the turn: the fall is held back and forward speed bleeds off.
          // (He rises a little more as he turns, and drifts toward the foe he means to land on.)
          this.vel.y = Math.max(this.vel.y, 4.6 - this.stateTime * 16);
          if (this.plungeAim) { const dx = this.plungeAim.x - this.pos.x, dz = this.plungeAim.z - this.pos.z, d = Math.hypot(dx, dz), sp = Math.min(11, d * 4); this.vel.x = d > 0.05 ? (dx / d) * sp : 0; this.vel.z = d > 0.05 ? (dz / d) * sp : 0; }
          else { const k = Math.exp(-5 * dt); this.vel.x *= k; this.vel.z *= k; }
        } else {
          this.vel.y = -P.dive;
          if (this.plungeAim) { const dx = this.plungeAim.x - this.pos.x, dz = this.plungeAim.z - this.pos.z, d = Math.hypot(dx, dz); const sp = Math.min(14, d * 6); this.vel.x = d > 0.05 ? (dx / d) * sp : 0; this.vel.z = d > 0.05 ? (dz / d) * sp : 0; }
        }
        this._integrate(dt);
        if (this.state === 'plunge' && this.grounded) {
          this.plungeHit = true; this.stateTime = 0; this.vel.x = this.vel.z = 0;
          this.emit('plunge', { height: Math.max(0, this.plungeTop - this.pos.y) });
        }
        return;
      }
      const k = Math.exp(-12 * dt); this.vel.x *= k; this.vel.z *= k;
      if (this.stateTime > P.recover) this.setState('move');
    } else if (this.state === 'down') {
      // On his back: slides to a stop, then gets up (a roll gets him up sooner).
      if (this.grounded) { const k = Math.exp(-7 * dt); this.vel.x *= k; this.vel.z *= k; }
      if (this.grounded && this.stateTime > 0.5 && input.pressed.has('dodge') && this.spend(T.rollCost * 0.5)) {
        this.setState('roll'); const d = wishLen > 0.2 ? wish : this.facing; this.rollDir = new THREE.Vector3(d.x, 0, d.z).normalize(); this.yaw = Math.atan2(this.rollDir.x, this.rollDir.z); this.emit('roll');
      } else if (this.stateTime > 1.15 && this.grounded) { this.setState('move'); this.invulnerable = Math.max(this.invulnerable, 0.35); }
    } else if (this.state === 'heal') {
      const R = T.refrain, k = Math.exp(-10 * dt); this.vel.x *= k; this.vel.z *= k;
      if (!this.healed && this.stateTime >= R.at) { this.healed = true; this.refrains--; const before = this.health; this.health = Math.min(this.healthMax, this.health + this.healthMax * R.heal); this.emit('heal', { amount: this.health - before }); }
      if (this.stateTime >= R.time) this.setState('move');
    } else if (this.state === 'hurt') {
      const drag = Math.exp(-6 * dt);
      this.vel.x *= drag; this.vel.z *= drag;
      if (this.stateTime > 0.42) this.setState('move');
    }
    this._integrate(dt);
  }

  // Afloat: he rides at the surface, steers like on land but slower, and leaves the water
  // where the bottom comes up under him or with a kick up onto a low bank.
  _swim(dt, input, wish, wishLen, surface) {
    const T = TUNE, W = this.world;
    const fast = input.held.has('sprint') && wishLen > 0.5 && this.stamina > 1;
    if (fast) { this.stamina = Math.max(0, this.stamina - T.swimCost * dt); this.staminaWait = 0.25; }
    const top = (fast ? T.swimFast : T.swim) * wishLen;
    const k = Math.min(1, 5 * dt);
    this.vel.x += (wish.x * top - this.vel.x) * k; this.vel.z += (wish.z * top - this.vel.z) * k;
    if (wishLen > 0.05) { let d = Math.atan2(wish.x, wish.z) - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); this.yaw += d * Math.min(1, 5 * dt); }
    // Buoyancy: a soft spring toward floating height.
    const floatY = surface - T.swimDepth;
    this.vel.y += ((floatY - this.pos.y) * 9 - this.vel.y * 3.2) * dt;
    // A kick: enough to get the hands onto a bank or a low quay.
    if (input.pressed.has('jump') && this.pos.y > floatY - 0.3 && this.spend(T.jumpCost)) { this.vel.y = 5.6; this.emit('splash', { speed: 3 }); }
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt; this.pos.y += this.vel.y * dt;
    W.resolveCapsule(this.pos, T.radius, T.height, this.vel.y);
    const g = W.floorBelow(this.pos.x, this.pos.y + 0.6, this.pos.z, 3);
    if (this.pos.y < g) { this.pos.y = g; if (this.vel.y < 0) this.vel.y = 0; }
    this.grounded = false; this.airTime = 0; this.fallStart = this.pos.y; this.coyote = 0;
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    if (this.speed > 0.2) this.moveDir.set(this.vel.x / this.speed, 0, this.vel.z / this.speed);
    this.viewY = this._viewY1 = this.pos.y;
    // Strokes, for sound and ripples.
    this.stepPhase += (0.5 + this.speed * 0.35) * dt;
    if (this.stepPhase >= 1) { this.stepPhase -= 1; this.emit('stroke', { speed: this.speed }); }
    // Out: the ground under him is within standing depth, or he has risen clear of the water.
    const here = W.waterLevel(this.pos.x, this.pos.z);
    if (here - g < T.swimDepth - 0.12 || this.pos.y > here - 0.25) { this.setState('move'); this.grounded = this.pos.y - g < 0.08; }
  }

  _integrate(dt) {
    const T = TUNE, W = this.world;
    const wasGrounded = this.grounded;
    this.vel.y -= T.gravity * dt;
    if (this.vel.y < -55) this.vel.y = -55;
    // Sub-step so fast moves never tunnel through thin geometry.
    const dist = Math.hypot(this.vel.x, this.vel.y, this.vel.z) * dt;
    const steps = Math.max(1, Math.min(6, Math.ceil(dist / (T.radius * 0.7))));
    let grounded = false;
    for (let s = 0; s < steps; s++) {
      const h = dt / steps;
      // Steep rock cannot be climbed: cancel motion that gains too much height too fast.
      const nx = this.pos.x + this.vel.x * h, nz = this.pos.z + this.vel.z * h;
      const g0 = W.groundHeight(this.pos.x, this.pos.z), g1 = W.groundHeight(nx, nz);
      const run = Math.hypot(nx - this.pos.x, nz - this.pos.z);
      const onTerrain = this.pos.y - g0 < 0.5;
      if (wasGrounded && this.vel.y <= 0.01 && run > 1e-4) {
        // Is there a low step right in front of the leading edge? Then stand on it already.
        const ux = (nx - this.pos.x) / run, uz = (nz - this.pos.z) / run;
        const ahead = W.floorBelow(nx + ux * T.radius * 0.8, this.pos.y + 0.56, nz + uz * T.radius * 0.8, 0.9);
        if (ahead > this.pos.y + 0.04 && ahead <= this.pos.y + 0.5) this.pos.y = ahead;
      }
      if (onTerrain && run > 1e-5 && (g1 - g0) / run > 1.25) { this.vel.x *= 0.2; this.vel.z *= 0.2; }
      else { this.pos.x = nx; this.pos.z = nz; }
      const px = this.pos.x - (onTerrain && run > 1e-5 && (g1 - g0) / run > 1.25 ? 0 : this.vel.x * h), pz = this.pos.z - (onTerrain && run > 1e-5 && (g1 - g0) / run > 1.25 ? 0 : this.vel.z * h), py = this.pos.y;
      this.pos.y += this.vel.y * h;
      if (W.resolveCapsule(this.pos, T.radius, T.height, this.vel.y)) grounded = true;
      // Step up: if a low ledge stopped us, try again from half a metre higher and settle
      // onto whatever floor is there (kerbs, plinths, the lips of paved platforms).
      const moved = Math.hypot(this.pos.x - px, this.pos.z - pz);
      if (wasGrounded && run > 1e-4 && moved < run * 0.5 && this.vel.y <= 0.01) {
        const sx = this.pos.x, sy = this.pos.y, sz = this.pos.z;
        this.pos.set(nx, py + 0.5, nz);
        W.resolveCapsule(this.pos, T.radius, T.height, 0);
        const floor = W.floorBelow(this.pos.x, this.pos.y + 0.1, this.pos.z, 0.8);
        if (Math.hypot(this.pos.x - px, this.pos.z - pz) > run * 0.7 && floor > py - 0.05 && floor <= py + 0.52) { this.pos.y = floor; grounded = true; }
        else this.pos.set(sx, sy, sz);
      }
      const g = W.groundHeight(this.pos.x, this.pos.z);
      if (this.pos.y <= g) { this.pos.y = g; grounded = true; }
    }
    // Stay glued to stairs and gentle drops instead of hopping down them.
    if (!grounded && wasGrounded && this.vel.y <= 0) {
      const floor = W.floorBelow(this.pos.x, this.pos.y + 0.5, this.pos.z, 1.1);
      if (floor > this.pos.y - 0.42) { this.pos.y = floor; grounded = true; }
    }
    if (grounded && this.vel.y <= 0.01) {
      const floor = W.floorBelow(this.pos.x, this.pos.y + 0.4, this.pos.z, 0.6);
      if (Math.abs(floor - this.pos.y) < 0.07) this.pos.y = floor;
    }
    if (grounded) {
      if (!wasGrounded) {
        const fell = this.fallStart - this.pos.y;
        this.emit('land', { fell });
        if (fell > 14 && this.state !== 'dead' && this.state !== 'plunge') this.damage(Math.min(70, (fell - 14) * 3.2));
      }
      if (this.vel.y < 0) this.vel.y = 0;
      this.coyote = T.coyote; this.airTime = 0; this.fallStart = this.pos.y;
      // Slide off slopes that are too steep to stand on.
      const e = 0.6, gx = (W.groundHeight(this.pos.x + e, this.pos.z) - W.groundHeight(this.pos.x - e, this.pos.z)) / (2 * e), gz = (W.groundHeight(this.pos.x, this.pos.z + e) - W.groundHeight(this.pos.x, this.pos.z - e)) / (2 * e);
      const slope = Math.hypot(gx, gz);
      if (slope > 1.3 && this.pos.y - W.groundHeight(this.pos.x, this.pos.z) < 0.3) { this.vel.x -= (gx / slope) * 22 * dt; this.vel.z -= (gz / slope) * 22 * dt; this.sliding = true; } else this.sliding = false;
    } else {
      if (wasGrounded) this.fallStart = this.pos.y;
      this.fallStart = Math.max(this.fallStart, this.pos.y);
      this.coyote = Math.max(0, this.coyote - dt); this.airTime += dt;
    }
    this.grounded = grounded;
    // A height that rises over steps and kerbs instead of jumping with them: what the body is
    // drawn at and what the camera follows. In the air it is simply the true height.
    if (this.viewY === undefined || !grounded || !wasGrounded || Math.abs(this.pos.y - this.viewY) > 0.6 || this.state === 'roll') this.viewY = this._viewY1 = this.pos.y;
    else { const k = Math.min(1, 24 * dt); this._viewY1 += (this.pos.y - this._viewY1) * k; this.viewY += (this._viewY1 - this.viewY) * k; }
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    if (this.speed > 0.2) this.moveDir.set(this.vel.x / this.speed, 0, this.vel.z / this.speed);

    // Remember the last firm footing; deep water or a long fall puts the player back there.
    this.safeTimer -= dt;
    if (grounded && !this.sliding && this.safeTimer <= 0 && this.state !== 'dead' && !(this.water - this.pos.y > 0.3)) { this.lastSafe.copy(this.pos); this.safeTimer = 0.6; }
    if (this.pos.y < -40 && this.state !== 'dead') this.respawn(12);          // only a fall out of the world

    // Footstep timing follows distance travelled on the ground.
    if (this.autoSteps !== false && grounded && this.speed > 0.8 && this.state === 'move') {
      this.stepPhase += this.speed * dt / (this.sprinting ? 1.25 : 0.95);
      if (this.stepPhase >= 1) { this.stepPhase -= 1; this.emit('step'); }
    }
  }

  respawn(damage = 0) {
    this.pos.copy(this.lastSafe); this.vel.set(0, 0, 0); this.fallStart = this.pos.y;
    this.invulnerable = 1.2;
    if (damage) { this.health = Math.max(1, this.health - damage); this.emit('hurt', { amount: damage }); }
    this.setState('move');
    this.emit('respawn');
  }
}
