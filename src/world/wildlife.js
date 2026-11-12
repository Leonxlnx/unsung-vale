// Small life in the Vale: flocks of birds turning over the spires and the pools, and
// butterflies in the meadow round the hero. The birds are one instanced draw moved entirely
// in the vertex shader from the clock; the butterflies are a handful of instances set each
// frame over the ground near him. Neither is in the film.
import * as THREE from 'three';

const BIRD_VERT = /* glsl */ `
in vec4 iA;      // where the flock turns (x, y, z) and how wide
in vec4 iB;      // turn rate (signed), phase, rise and fall, spread of the flock
in vec4 iC;      // this bird's place in the flock (unit) and its seed
in float aSpan;  // 0 at the body, 1 at the wing tip
uniform float uTime;
out vec3 vWorld;
void main() {
  float seed = iC.w, ang = iB.y + uTime * iB.x, dir = sign(iB.x);
  vec3 off = iC.xyz * iB.w + vec3(sin(uTime * 0.31 + seed * 17.0), 0.6 * sin(uTime * 0.23 + seed * 5.0), cos(uTime * 0.27 + seed * 11.0)) * 1.4;
  float r = iA.w + off.x, a2 = ang + off.z / max(iA.w, 1.0);
  vec3 c = iA.xyz + vec3(cos(a2) * r, iB.z * sin(ang * 1.7 + seed * 0.4) + off.y, sin(a2) * r);
  vec3 fwd = vec3(-sin(a2), 0.0, cos(a2)) * dir, side = vec3(fwd.z, 0.0, -fwd.x);
  // Wings: a few beats, then a glide with the tips held a little high.
  float beat = smoothstep(-0.25, 0.25, sin(uTime * 0.37 + seed * 9.0));
  float ph = uTime * (8.5 + 2.5 * fract(seed * 7.3)) + seed * 6.283;
  float t1 = mix(0.16, 0.75 * sin(ph), beat), t2 = t1 + mix(0.1, 0.55 * sin(ph - 0.9), beat);
  float s = abs(position.x), sg = sign(position.x);
  float inner = min(s, 0.5), outer = max(s - 0.5, 0.0);
  vec2 w = vec2(inner * cos(t1) + outer * cos(t2), inner * sin(t1) + outer * sin(t2));
  // Lean into the turn; body dips a little on the downbeat.
  float bank = 0.42 * dir * clamp(60.0 / iA.w, 0.25, 1.0);
  vec3 up = normalize(vec3(0.0, 1.0, 0.0) * cos(bank) + side * sin(bank)), sd = normalize(side * cos(bank) - vec3(0.0, 1.0, 0.0) * sin(bank));
  float size = (1.0 + 0.35 * fract(seed * 3.7)) * (1.0 + smoothstep(200.0, 500.0, iA.w));
  vec3 p = c + (sd * (w.x * sg) + up * (w.y - 0.05 * sin(ph) * beat * (1.0 - aSpan)) + fwd * position.z) * size;
  vWorld = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const BIRD_FRAG = /* glsl */ `
in vec3 vWorld;
void main() {
  vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (N.y < 0.0) N = -N;
  float sun = clamp(dot(N, normalize(vec3(0.5, 0.45, 0.74))), 0.0, 1.0), below = step(cameraPosition.y, vWorld.y);
  // Pale above where the sun catches them, dusk-grey seen from underneath.
  vec3 col = mix(vec3(0.78, 0.74, 0.68) * (0.45 + 0.75 * sun), vec3(0.2, 0.2, 0.25), below * 0.8);
  gl_FragColor = vec4(col, 1.0);
}`;

const FLY_VERT = /* glsl */ `
in float aSide;   // -1 or 1: which wing
in vec4 iTint;    // colour, and seed in w
uniform float uTime;
out vec3 vCol; out vec2 vUv;
void main() {
  float seed = iTint.w, ph = uTime * (13.0 + 5.0 * fract(seed * 3.1)) + seed * 40.0;
  // Wings close over the back and open flat, quick and a little uneven.
  float open = 0.25 + 1.05 * abs(sin(ph)) * (0.75 + 0.25 * sin(ph * 0.37));
  vec3 p = position;
  p = vec3(p.x * cos(open) , abs(p.x) * sin(open), p.z);
  vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vCol = iTint.rgb; vUv = vec2(abs(position.x), position.z);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const FLY_FRAG = /* glsl */ `
in vec3 vCol; in vec2 vUv;
void main() {
  // A darker edge and body line, as on a painted wing.
  float edge = smoothstep(0.075, 0.1, vUv.x) + 0.6 * smoothstep(0.02, 0.0, vUv.x);
  gl_FragColor = vec4(vCol * (1.0 - 0.55 * clamp(edge, 0.0, 1.0)), 1.0);
}`;

export class Wildlife {
  constructor(game, pipe, pools = []) {
    this.g = game; this.pipe = pipe;
    const time = pipe.globals.uTime, rnd = (() => { let s = 20261112; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();

    // --- birds ---
    // One bird: two wings of two panels each, and a sliver of body and tail.
    const pos = [], span = [], idx = [];
    const v = (x, z, s) => { pos.push(x, 0, z); span.push(s); return pos.length / 3 - 1; };
    for (const sg of [-1, 1]) {
      const a = v(0, 0.16, 0), b = v(0, -0.12, 0), c = v(sg * 0.5, 0.2, 0.5), d = v(sg * 0.5, -0.04, 0.5), e = v(sg * 1.0, 0.02, 1);
      idx.push(a, c, b, b, c, d, c, e, d);
    }
    { const a = v(0.035, 0.3, 0), b = v(-0.035, 0.3, 0), c = v(0.06, -0.34, 0), d = v(-0.06, -0.34, 0); idx.push(a, b, c, b, d, c); }
    const flocks = [];
    for (const s of game.sites.spires) flocks.push([s.x, s.y + 16 + rnd() * 10, s.z, 26 + rnd() * 16, 0.16, 5, 6, 9 + Math.floor(rnd() * 5)]);
    for (const p of pools) flocks.push([p.x, p.level + 9 + rnd() * 6, p.z, p.r * (0.7 + rnd() * 0.4), 0.2, 3, 5, 7 + Math.floor(rnd() * 4)]);
    flocks.push([game.sites.spawn.x + 30, game.sites.spawn.y + 22, game.sites.spawn.z, 60, 0.11, 6, 7, 11]);
    // Long travellers over the lake and along the valley.
    for (const [x, y, z, r, n] of [[0, 150, -60, 520, 13], [120, 230, 80, 760, 15], [-250, 120, 150, 380, 11], [300, 190, -200, 420, 12], [-600, 300, 0, 300, 10]]) flocks.push([x, y, z, r, 5.5 / r, 14, 9, n]);
    const A = [], B = [], C = [];
    for (const [x, y, z, r, rate, rise, spread, n] of flocks) {
      const dir = rnd() < 0.5 ? -1 : 1, ph = rnd() * 6.283, sp = rate * (0.8 + rnd() * 0.4) * dir;
      for (let k = 0; k < n; k++) {
        // A loose skein: each a little behind and to one side of the one before.
        const row = Math.ceil(k / 2), sd = k % 2 ? 1 : -1;
        A.push(x, y, z, r); B.push(sp, ph, rise, spread / 6);
        C.push(sd * row * 1.0 + (rnd() - 0.5) * 1.5, (rnd() - 0.5) * 2.4, -dir * row * 2.6 + (rnd() - 0.5) * 2, rnd());
      }
    }
    const bg = new THREE.InstancedBufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); bg.setAttribute('aSpan', new THREE.Float32BufferAttribute(span, 1)); bg.setIndex(idx);
    bg.setAttribute('iA', new THREE.InstancedBufferAttribute(new Float32Array(A), 4)); bg.setAttribute('iB', new THREE.InstancedBufferAttribute(new Float32Array(B), 4)); bg.setAttribute('iC', new THREE.InstancedBufferAttribute(new Float32Array(C), 4));
    bg.instanceCount = A.length / 4;
    this.birds = new THREE.Mesh(bg, new THREE.ShaderMaterial({ vertexShader: BIRD_VERT, fragmentShader: BIRD_FRAG, uniforms: { uTime: time }, side: THREE.DoubleSide }));
    this.birds.frustumCulled = false;
    pipe.scene.add(this.birds);

    // --- butterflies ---
    const N = 42, fp = [], fs = [], fi = [];
    for (const sg of [-1, 1]) { const o = fp.length / 3; fp.push(0, 0, 0.055, 0, 0, -0.045, sg * 0.1, 0, 0.085, sg * 0.085, 0, -0.07); fs.push(sg, sg, sg, sg); fi.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3)); fg.setAttribute('aSide', new THREE.Float32BufferAttribute(fs, 1)); fg.setIndex(fi);
    const tints = [[1.5, 1.42, 1.2], [1.6, 1.3, 0.45], [0.75, 1.0, 1.7], [1.7, 0.85, 0.35], [1.5, 1.42, 1.2], [1.2, 0.8, 1.5]], tint = new Float32Array(N * 4);
    this.flies = [];
    for (let i = 0; i < N; i++) { const t = tints[i % tints.length], seed = rnd(); tint.set([t[0], t[1], t[2], seed], i * 4); this.flies.push({ hx: (rnd() - 0.5) * 56, hz: (rnd() - 0.5) * 56, seed, h: 0.5 + rnd() * 1.1 }); }
    fg.setAttribute('iTint', new THREE.InstancedBufferAttribute(tint, 4));
    this.fly = new THREE.InstancedMesh(fg, new THREE.ShaderMaterial({ vertexShader: FLY_VERT, fragmentShader: FLY_FRAG, uniforms: { uTime: time }, side: THREE.DoubleSide }), N);
    this.fly.frustumCulled = false;
    pipe.scene.add(this.fly);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(); this._e = new THREE.Euler();
  }

  update(dt) {
    const g = this.g, show = !g.cine;
    this.birds.visible = show; this.fly.visible = show;
    if (!show) return;
    const p = g.player.pos, W = g.world, t = this.pipe.globals.uTime.value, SPAN = 56;
    this.flies.forEach((f, i) => {
      // Each keeps to its own patch of a square of meadow that moves with the hero, wandering
      // in loops over it; over stone or water there are none.
      const wx = f.hx + 5 * Math.sin(t * 0.21 + f.seed * 30) + 2.2 * Math.sin(t * 0.83 + f.seed * 7), wz = f.hz + 5 * Math.cos(t * 0.17 + f.seed * 12) + 2.2 * Math.cos(t * 0.71 + f.seed * 19);
      const x = p.x + ((((wx - p.x) % SPAN) + SPAN * 1.5) % SPAN) - SPAN / 2, z = p.z + ((((wz - p.z) % SPAN) + SPAN * 1.5) % SPAN) - SPAN / 2;
      const gh = W.groundHeight(x, z), ok = Math.abs(gh - p.y) < 9 && !Number.isFinite(W.waterLevel(x, z)) && (f.ok = (f.n = ((f.n ?? i) + 1) % 20) ? f.ok ?? true : W.floorBelow(x, gh + 6, z, 8) < gh + 0.2);
      const edge = Math.min(1, (SPAN / 2 - Math.max(Math.abs(x - p.x), Math.abs(z - p.z))) / 4), sc = ok ? Math.max(0, edge) : 0;
      const y = gh + f.h + 0.25 * Math.sin(t * 2.3 + f.seed * 50) + 0.12 * Math.sin(t * 5.1 + f.seed * 9);
      const yaw = Math.atan2(Math.cos(t * 0.21 + f.seed * 30) + 0.9 * Math.cos(t * 0.83 + f.seed * 7), -Math.sin(t * 0.17 + f.seed * 12) - 0.9 * Math.sin(t * 0.71 + f.seed * 19));
      this._m.compose(this._p.set(x, y, z), this._q.setFromEuler(this._e.set(0.25, yaw, 0, 'YXZ')), this._s.setScalar(sc * (0.85 + 0.5 * f.seed)));
      this.fly.setMatrixAt(i, this._m);
    });
    this.fly.instanceMatrix.needsUpdate = true;
  }
}
