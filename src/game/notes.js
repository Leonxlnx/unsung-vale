// Lost notes: small shards of the old song, left along the paths between the spires. They
// mark the way, mend a little health, and each one sounds the next step of a scale, so a
// walk down the path plays a rising tune. A few carry a line of the Vale's memory.
import * as THREE from 'three';

const VERT = /* glsl */ `
in float iPhase;
uniform float uTime;
out vec3 vWorld; out float vPhase;
void main() {
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = w.xyz; vPhase = iPhase;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const FRAG = /* glsl */ `
uniform float uTime;
in vec3 vWorld; in float vPhase;
void main() {
  vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  vec3 V = normalize(cameraPosition - vWorld);
  float f = pow(1.0 - abs(dot(N, V)), 2.0);
  float pulse = 0.8 + 0.2 * sin(uTime * 2.6 + vPhase);
  gl_FragColor = vec4(vec3(1.0, 0.7, 0.28) * (1.7 + 3.2 * f) * pulse, 1.0);
}`;

export const LINES = [
  'They tuned the spires at dusk, when the wind off the lake was lowest.',
  'A child could hear the chord from any roof in the Vale, and know the way home.',
  'The bridge to the Choir was never stone. It stood for as long as someone sang.',
  'When the first spire fell silent, the gardens kept flowering. Nobody had told them.',
  'The Mute did not break the song. They only waited for a breath between notes.',
  'Each court kept three bells out on its mesa, so that no one working in the fields was ever out of hearing.',
  'The strings of light were roads once. People rode them to market with baskets on their knees.',
  'Lamplighters went round the Lantern mesa at dusk. From the sea it looked like a second sunset.',
  'The archive at the Aurel Court holds every tune the Vale ever made, written small.',
  'In the orchard they sang to the trees at blossom time. The pears came sweeter for it, or so they said.',
  'Nobody was hurt when the silence came. They only stopped, each where they stood, mid-word.',
  'The Crown was the first spire raised and the first to fall quiet.',
];
// Steps of a major scale, as playback rates.
const SCALE = [1, 9 / 8, 5 / 4, 4 / 3, 3 / 2, 5 / 3, 15 / 8, 2];
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

export class Notes {
  // legs: { name: [[x, z], ...] } polylines; a note is set down every `gap` metres along them.
  // more: further places off the paths (appended, so earlier notes keep their numbers).
  constructor(game, pipe, legs, { gap = 46, avoid = [], extra = [], more = [] } = {}) {
    this.game = game; this.pipe = pipe;
    const W = game.world, list = [];
    for (const pts of Object.values(legs)) {
      let carry = gap * 0.5, side = 1;
      for (let i = 1; i < pts.length; i++) {
        const [ax, az] = pts[i - 1], [bx, bz] = pts[i], len = Math.hypot(bx - ax, bz - az);
        if (len > 200) { carry = gap * 0.5; continue; }             // a leap between mesas, not a path
        // Heights of the path at both ends: between them a note sits on whatever carries the
        // path there (a viaduct deck high over the valley floor, a stair), not on the ground below.
        const ya = W.floorBelow(ax, W.groundHeight(ax, az) + 40, az, 60), yb = W.floorBelow(bx, W.groundHeight(bx, bz) + 40, bz, 60);
        for (let d = carry; d < len; d += gap) {
          const t = d / len, nx = -(bz - az) / len, nz = (bx - ax) / len;
          const x = ax + (bx - ax) * t + nx * 1.1 * side, z = az + (bz - az) * t + nz * 1.1 * side;
          side = -side;
          if (avoid.some(([cx, cz, r]) => Math.hypot(x - cx, z - cz) < r)) continue;
          const y = W.floorBelow(x, Math.max(ya + (yb - ya) * t + 6, W.groundHeight(x, z) + 3), z, 40);
          list.push({ x, y: y + 1.15, z, taken: false, phase: list.length * 1.7, k: 1 });
        }
        carry = (carry + Math.ceil((len - carry) / gap) * gap) - len;
      }
    }
    for (const [x, z] of extra) list.unshift({ x, y: W.floorBelow(x, W.groundHeight(x, z) + 40, z, 60) + 1.15, z, taken: false, phase: 0.6, k: 1 });
    for (const [x, z] of more) list.push({ x, y: W.floorBelow(x, W.groundHeight(x, z) + 6, z, 12) + 1.15, z, taken: false, phase: list.length * 1.7, k: 1 });
    this.list = list;
    for (const i of game.notesTaken ?? []) if (list[i]) { list[i].taken = true; list[i].k = 0; }
    const geo = new THREE.OctahedronGeometry(1, 0).scale(0.15, 0.28, 0.15);
    geo.setAttribute('iPhase', new THREE.InstancedBufferAttribute(new Float32Array(list.map((n) => n.phase)), 1));
    this.mesh = new THREE.InstancedMesh(geo, new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { uTime: pipe.globals.uTime } }), list.length);
    this.mesh.frustumCulled = false; this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    pipe.scene.add(this.mesh);
    this.count = list.filter((n) => n.taken).length; this.streak = 0; this.streakT = 0;
  }

  get total() { return this.list.length; }

  update(dt, playing) {
    const g = this.game, p = g.player.pos, t = this.pipe.time, P = g.particles;
    this.mesh.visible = !g.cine;            // the film leaves them out
    if (g.cine) return;
    this.streakT -= dt; if (this.streakT <= 0) this.streak = 0;
    this.list.forEach((n, i) => {
      if (playing && !n.taken && Math.abs(p.y + 1 - n.y) < 2.2 && Math.hypot(p.x - n.x, p.z - n.z) < 2.3) {
        n.taken = true; this.count++;
        // Notes gathered in quick succession climb the scale; a pause starts the tune again.
        const step = this.streak++ % SCALE.length; this.streakT = 14;
        g.notesTaken = this.list.map((q, k) => (q.taken ? k : -1)).filter((k) => k >= 0); g.save();
        g.player.health = Math.min(g.player.healthMax, g.player.health + 6); if (g.player.refrains < g.player.refrainMax) { g.player.refrains++; g.emit('rest', { one: true }); }
        // A note is also a place to return to, unless something hostile is close.
        if (!g.enemies.list.some((e) => e.alive && e.state !== 'dormant' && e.pos.distanceTo(g.player.pos) < 30)) g.checkpoint = { x: n.x, y: n.y - 1.05, z: n.z, yaw: g.player.yaw };
        P.burst(n.x, n.y, n.z, 16, { speed: 3.2, life: 0.7, size: 0.05, color: [3.2, 2.4, 1.1], gravity: -1.5, drag: 1.6, up: 1 });
        g.vfx.wave(n.x, n.y - 1.0, n.z, { r0: 0.2, r1: 2.6, life: 0.55, strength: 0.4, width: 0.12, color: [1.6, 1.2, 0.6] });
        g.emit('note', { index: i, count: this.count, total: this.total, pitch: SCALE[step], line: this.count % 6 === 3 ? LINES[Math.floor(this.count / 6) % LINES.length] : null });
      }
      n.k += ((n.taken ? 0 : 1) - n.k) * Math.min(1, dt * 10);
      const near = Math.hypot(p.x - n.x, p.z - n.z) < 90;
      const s = n.k > 0.01 && near ? n.k : 0;
      _p.set(n.x, n.y + Math.sin(t * 1.4 + n.phase) * 0.07, n.z);
      _m.compose(_p, _q.setFromEuler(_e.set(0, t * 0.9 + n.phase, 0)), _s.set(s, s, s));
      this.mesh.setMatrixAt(i, _m);
      // A soft light around each one, so they read from a distance at dusk.
      if (s > 0.5 && Math.hypot(p.x - n.x, p.z - n.z) < 60) P.spawn(_p.x, _p.y, _p.z, { life: 0.1, size: 0.75, color: [1.5, 1.05, 0.45], alpha: 0.6 });
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
