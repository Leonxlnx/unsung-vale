// The bells of the outer courts. Each court beyond the water kept three bells out on its mesa
// that answered its spire. The Mute stand over them now. Until all three have been rung the
// court does not stir: its guard stays in the ground and its spire will not answer. Ringing
// the third calls the court's guard up, and the fight for the court begins.
import * as THREE from 'three';

const VERT = /* glsl */ `
out vec3 vWorld;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const FRAG = /* glsl */ `
uniform float uTime; uniform float uPower; uniform float uGold;
in vec3 vWorld;
void main() {
  vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld))), V = normalize(cameraPosition - vWorld);
  float f = pow(1.0 - abs(dot(N, V)), 2.2), sun = 0.55 + 0.45 * clamp(dot(N, normalize(vec3(0.5, 0.45, 0.74))), 0.0, 1.0);
  // Posts of pale stone; a bell of dull bronze that takes light when it has been rung.
  vec3 stone = vec3(0.5, 0.48, 0.44) * sun, bronze = vec3(0.2, 0.15, 0.08) * sun + vec3(0.3, 0.24, 0.14) * f;
  vec3 lit = vec3(1.0, 0.74, 0.34) * (0.7 + 2.2 * f) * (0.88 + 0.12 * sin(uTime * 3.0));
  gl_FragColor = vec4(mix(stone, mix(bronze, lit, uPower), uGold), 1.0);
}`;

// Where the three bells of each court stand, and who guards them: [kind, count, veteran?].
export const BELLS = {
  east: { at: [[665, -520], [640, -350], [560, -560]], guard: [[['hound', 2]], [['thrall', 2]], [['lancer', 1], ['hound', 1]]] },
  south3: { at: [[720, 470], [600, 540], [730, 400]], guard: [[['thrall', 2], ['lancer', 1]], [['hound', 3]], [['chorister', 1], ['hound', 1]]] },
  aurel: { at: [[250, 540], [20, 620], [150, 640]], guard: [[['warden', 1], ['hound', 1]], [['thrall', 3]], [['chorister', 1], ['thrall', 1, true]]] },
  south1: { at: [[-500, 400], [-420, 540], [-290, 420]], guard: [[['chorister', 1], ['thrall', 2]], [['warden', 1], ['lancer', 1]], [['hound', 3], ['thrall', 1, true]]] },
  crown: { at: [[-1120, -120], [-930, -260], [-860, -90]], guard: [[['thrall', 2, true], ['hound', 2]], [['warden', 1], ['chorister', 1]], [['brute', 1], ['lancer', 1]]] },
};
const VETERAN = { scale: 1.16, hp: 1.7, dmg: 1.2, tint: 0.6 };

export class Bells {
  constructor(game, pipe) {
    this.g = game; this.pipe = pipe; this.list = [];
    const W = game.world, time = pipe.globals.uTime;
    // A frame of two posts and a beam, and the bell hanging in it.
    const post = (x) => new THREE.CylinderGeometry(0.09, 0.12, 3.1, 6).translate(x, 1.55, 0);
    const frame = new THREE.BufferGeometry();
    { const parts = [post(-0.8), post(0.8), new THREE.BoxGeometry(2.1, 0.16, 0.2).translate(0, 3.14, 0), new THREE.CylinderGeometry(0.42, 0.5, 0.16, 8).translate(-0.8, 0.08, 0), new THREE.CylinderGeometry(0.42, 0.5, 0.16, 8).translate(0.8, 0.08, 0)];
      const pos = []; for (const p of parts) pos.push(...p.toNonIndexed().attributes.position.array); frame.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); }
    const bell = new THREE.LatheGeometry([[0.03, 0], [0.16, -0.04], [0.25, -0.26], [0.29, -0.6], [0.4, -0.86], [0.46, -0.94], [0.43, -0.96]].map(([r, y]) => new THREE.Vector2(r, y)), 14);
    for (const [id, def] of Object.entries(BELLS)) {
      const rung = game.bellsRung?.[id] ?? [];
      def.at.forEach(([x, z], i) => {
        W.stream(x, z, 6);
        const y = W.floorBelow(x, W.groundHeight(x, z) + 3, z, 8), yaw = (i * 2.1 + x * 0.01) % 6.283;
        const mk = (geo, gold) => { const u = { uTime: time, uPower: { value: 0 }, uGold: { value: gold } }; const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: u, side: THREE.DoubleSide })); m.frustumCulled = false; pipe.scene.add(m); return m; };
        const fm = mk(frame, 0), bm = mk(bell, 1);
        fm.position.set(x, y, z); fm.rotation.y = yaw; fm.updateMatrixWorld();
        bm.position.set(x, y + 3.04, z); bm.rotation.y = yaw;
        for (const sx of [-0.8, 0.8]) W.addCapsule([x + Math.cos(yaw) * sx, y, z - Math.sin(yaw) * sx], [x + Math.cos(yaw) * sx, y + 3, z - Math.sin(yaw) * sx], 0.16);
        this.list.push({ id, i, x, y, z, yaw, frame: fm, bell: bm, rung: rung.includes(i), swing: 0, t: 0, group: `bell:${id}:${i}` });
      });
    }
  }

  count(id) { return this.list.filter((b) => b.id === id && b.rung).length; }
  done(id) { return !BELLS[id] || this.count(id) >= BELLS[id].at.length; }
  // The bell of a court still to be rung that is nearest to the hero.
  nearest(id) { const p = this.g.player.pos; let best = null, bd = 1e9; for (const b of this.list) { if (b.id !== id || b.rung) continue; const d = Math.hypot(b.x - p.x, b.z - p.z); if (d < bd) { bd = d; best = b; } } return best; }

  // Guards for every bell not yet rung (called when the encounters are set out).
  spawnGuards() {
    const g = this.g;
    for (const b of this.list) {
      if (b.rung || g.spires.find((s) => s.id === b.id)?.tuned) continue;
      const flat = []; for (const [kind, n, vet] of BELLS[b.id].guard[b.i]) for (let k = 0; k < n; k++) flat.push([kind, vet]);
      flat.forEach(([kind, vet], k) => { const a = b.yaw + (k / flat.length) * 6.283 + 0.5; g.enemies.spawn(kind, b.x + Math.cos(a) * 4.2, b.z + Math.sin(a) * 4.2, b.group, vet ? VETERAN : null, b.y); });
    }
  }

  ring(b) {
    const g = this.g, s = g.spires.find((q) => q.id === b.id);
    b.rung = true; b.swing = 1; b.t = 0;
    (g.bellsRung ??= {})[b.id] = this.list.filter((q) => q.id === b.id && q.rung).map((q) => q.i);
    const n = this.count(b.id), total = BELLS[b.id].at.length;
    for (const [dl, r] of [[0, 9], [0.3, 14], [0.6, 20]]) g.vfx.wave(b.x, b.y + 0.1, b.z, { r0: 0.5, r1: r, life: 1.3, strength: 1.0, width: 0.05, color: [3.2, 2.3, 1.0], delay: dl });
    g.vfx.wave(b.x, b.y + 2.4, b.z, { kind: 1, r0: 0.3, r1: 5, life: 0.6, strength: 1.2, width: 0.1, color: [3.2, 2.3, 1.0] });
    // Its voice runs off toward the court as a line of sparks.
    const dx = s.x - b.x, dz = s.z - b.z, d = Math.hypot(dx, dz);
    for (let k = 0; k < 60; k++) { const t = k / 60; g.particles.spawn(b.x + dx * t * 0.5, b.y + 2.4 + 6 * Math.sin(Math.PI * t * 0.5), b.z + dz * t * 0.5, { vel: [(dx / d) * 16, 1.5, (dz / d) * 16], life: 1.2 + t, size: 0.07, color: [4, 3, 1.4], drag: 0.3, streak: 0.14 }); }
    g.flash = Math.max(g.flash, 0.3);
    g.checkpoint = { x: g.player.pos.x, y: g.player.pos.y + 0.1, z: g.player.pos.z, yaw: g.player.yaw };
    g.emit('bell', { id: b.id, index: b.i, count: n, total, done: n >= total, pitch: [1, 5 / 4, 3 / 2][Math.min(2, n - 1)] });
    if (n >= total) g.encounters.callCourt(b.id);
    g.save();
  }

  update(dt, playing) {
    const g = this.g, p = g.player, show = !g.cine;
    for (const b of this.list) {
      const near = Math.hypot(p.pos.x - b.x, p.pos.z - b.z) < 320;
      b.frame.visible = b.bell.visible = show && near;
      if (!near) continue;
      b.t += dt; b.swing *= Math.exp(-dt * 0.55);
      const power = b.rung ? 1 : 0, u = b.bell.material.uniforms.uPower;
      u.value += (power - u.value) * Math.min(1, dt * 3);
      // It swings hard when struck and never quite comes to rest afterwards.
      const sw = (b.swing * 0.5 + (b.rung ? 0.035 : 0)) * Math.sin(b.t * 4.2);
      b.bell.rotation.set(sw * Math.sin(b.yaw + 1.57), b.yaw, sw * Math.cos(b.yaw + 1.57));
      b.bell.updateMatrixWorld();
    }
    if (!playing || g.prompt || p.state !== 'move' || !p.grounded) return;
    for (const b of this.list) {
      if (b.rung || Math.hypot(p.pos.x - b.x, p.pos.z - b.z) > 3.4 || Math.abs(p.pos.y - b.y) > 3) continue;
      if (g.enemies.aliveIn(b.group) > 0 || g.enemies.list.some((e) => e.alive && e.state !== 'dormant' && e.pos.distanceTo(p.pos) < 26)) return;
      g.prompt = { key: 'E', text: 'Ring the bell' };
      if (g.input.pressed.has('interact')) { g.prompt = null; this.ring(b); }
      return;
    }
  }
}
