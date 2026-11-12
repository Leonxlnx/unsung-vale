// Strings of light: the old roads of the Vale. A string runs from a pylon at one court to a
// pylon at the next, over the lake and the gaps between the mesas. A string wakes when the
// spires it needs are singing, and can then be ridden either way: the hero hooks his blade
// over it and is carried across. They are how the outer courts are reached, and the quick way
// back to anywhere already restored.
import * as THREE from 'three';
import { NAMES } from './story.js';
import { MeshBuilder, M } from '../world/arch/builder.js';

const SEG = 72, SPEED = 34, HANG = 2.06;
const STRING_VERT = /* glsl */ `
in float aT; in float aSide;
uniform vec3 uA; uniform vec3 uB; uniform float uBump;
out vec2 vUv;
void main() {
  vec3 p = mix(uA, uB, aT); p.y += uBump * sin(3.14159 * aT);
  vec3 tang = normalize(uB - uA + vec3(0.0, uBump * 3.14159 * cos(3.14159 * aT), 0.0));
  vec3 side = normalize(cross(tang, cameraPosition - p));
  // Wider with distance, so it stays a line of light from across the valley.
  float w = 0.045 + distance(cameraPosition, p) * 0.0016;
  vUv = vec2(aT, aSide);
  gl_Position = projectionMatrix * viewMatrix * vec4(p + side * aSide * w, 1.0);
}`;
const STRING_FRAG = /* glsl */ `
uniform float uTime; uniform float uPower; uniform float uLen; uniform float uGrow; uniform float uFrom;
in vec2 vUv;
void main() {
  float along = mix(vUv.x, 1.0 - vUv.x, uFrom);
  if (along > uGrow) discard;
  float head = exp(-pow((uGrow - along) * uLen * 0.12, 2.0)) * step(uGrow, 0.999);
  float x = abs(vUv.y), core = exp(-x * x * 7.0);
  // Beads of light run along it, the way a plucked string shows its wave.
  float run = 0.5 + 0.5 * pow(0.5 + 0.5 * sin(vUv.x * uLen * 0.35 - uTime * 5.0), 3.0);
  float ends = smoothstep(0.0, 0.004, vUv.x) * smoothstep(0.0, 0.004, 1.0 - vUv.x);
  float a = core * run * ends * uPower;
  gl_FragColor = vec4(vec3(1.0, 0.76, 0.4) * a * 1.25 + vec3(1.0, 0.9, 0.7) * core * head * 6.0, 0.0);
}`;
const PYLON_VERT = /* glsl */ `
out vec3 vWorld;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const PYLON_FRAG = /* glsl */ `
uniform float uTime; uniform float uPower; uniform float uBase;
in vec3 vWorld;
void main() {
  vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld))), V = normalize(cameraPosition - vWorld);
  float f = pow(1.0 - abs(dot(N, V)), 2.5), up = clamp((vWorld.y - uBase - 1.0) / 6.6, 0.0, 1.0);
  // Facets of dark glass, each a slightly different grey; gold climbing inside toward the tip.
  vec3 glass = vec3(0.05, 0.055, 0.07) * (0.7 + 0.6 * abs(N.x + 0.4 * N.z)) + vec3(0.2, 0.2, 0.25) * f;
  float climb = 0.5 + 0.5 * sin(vWorld.y * 3.0 - uTime * 2.2);
  vec3 gold = vec3(1.0, 0.72, 0.32) * (0.05 + 1.5 * pow(up, 2.4) + 1.3 * f + 0.25 * climb * up);
  gl_FragColor = vec4(glass + gold * uPower, 1.0);
}`;
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class Strings {
  // nodes: { id: [x, z] }; links: [[idA, idB, [spires that must sing]], ...]
  constructor(game, pipe, nodes, links) {
    this.game = game; this.pipe = pipe; this.ride = null; this.goal = null;
    const W = game.world, time = pipe.globals.uTime;
    this.nodes = {};
    const geo = new THREE.OctahedronGeometry(1, 0).scale(0.3, 3.3, 0.3);
    // The crystal of each pylon floats over a faceted foot of marble banded with gold.
    const feet = new MeshBuilder();
    for (const [id, [x, z]] of Object.entries(nodes)) {
      W.stream(x, z, 6);
      const y = W.floorBelow(x, W.groundHeight(x, z) + 14, z, 40);
      const u = { uTime: time, uPower: { value: 0 }, uBase: { value: y } };
      const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: PYLON_VERT, fragmentShader: PYLON_FRAG, uniforms: u }));
      m.position.set(x, y + 4.3, z); m.updateMatrixWorld(); m.frustumCulled = false;
      pipe.scene.add(m);
      W.addCapsule([x, y, z], [x, y + 6.6, z], 0.42);
      feet.at(x, y, z, 0.39, (q) => {
        q.mat_(M.MARBLE).lathe([[0.95, -1.2], [0.95, 0.12], [0.74, 0.12], [0.62, 0.52], [0.7, 0.58], [0.7, 0.66], [0.3, 0.74], [0, 0.74]], 8, { smooth: false });
        q.mat_(M.GOLD).lathe([[0.71, 0.58], [0.74, 0.62], [0.71, 0.66]], 8, { smooth: false });
        q.mat_(M.GOLD).lathe([[0.2, 0.745], [0.12, 0.86], [0, 0.9]], 4, { smooth: false });
      });
      this.nodes[id] = { id, x, y, z, top: new THREE.Vector3(x, y + 7.7, z), u, mesh: m };
    }
    game.addProp(feet);
    const pos = new Float32Array((SEG + 1) * 2 * 3), aT = [], aSide = [], idx = [];
    for (let i = 0; i <= SEG; i++) { aT.push(i / SEG, i / SEG); aSide.push(-1, 1); if (i < SEG) { const o = i * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); } }
    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sgeo.setAttribute('aT', new THREE.Float32BufferAttribute(aT, 1)); sgeo.setAttribute('aSide', new THREE.Float32BufferAttribute(aSide, 1));
    sgeo.setIndex(idx);
    this.links = links.map(([a, b, needs]) => {
      const A = this.nodes[a], B = this.nodes[b], len = A.top.distanceTo(B.top);
      // Sag like a hung string where there is room; arch over whatever ground is in the way.
      let need = -1e9;
      for (let i = 1; i < 32; i++) { const t = i / 32, x = A.top.x + (B.top.x - A.top.x) * t, z = A.top.z + (B.top.z - A.top.z) * t; const sn = Math.sin(Math.PI * t); need = Math.max(need, (Math.max(0, W.groundHeight(x, z)) + 3 + 26 * sn - (A.top.y + (B.top.y - A.top.y) * t)) / sn); }
      const bump = need > 0 ? need * 1.05 : -Math.min(len * 0.035, -need * 0.6);
      const u = { uA: { value: A.top }, uB: { value: B.top }, uBump: { value: bump }, uTime: time, uPower: { value: 0 }, uLen: { value: len }, uGrow: { value: 1 }, uFrom: { value: 0 } };
      const m = new THREE.Mesh(sgeo, new THREE.ShaderMaterial({ vertexShader: STRING_VERT, fragmentShader: STRING_FRAG, uniforms: u, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor }));
      m.frustumCulled = false; m.renderOrder = 4; m.visible = false;
      pipe.sceneT.add(m);
      return { a, b, A, B, needs, len, bump, u, mesh: m };
    });
  }

  awake(l) { return l.needs.every((id) => this.game.spires.find((s) => s.id === id)?.tuned); }
  point(l, t, out) { return out.lerpVectors(l.A.top, l.B.top, t).setY(l.A.top.y + (l.B.top.y - l.A.top.y) * t + l.bump * Math.sin(Math.PI * t)); }

  // The hops from one court to another over strings that are awake, or null.
  route(from, to) {
    if (from === to) return null;
    const prev = { [from]: null }, q = [from];
    while (q.length) {
      const id = q.shift();
      if (id === to) { const hops = []; for (let c = to; prev[c]; c = prev[c].from) hops.unshift(prev[c]); return hops; }
      for (const l of this.links) {
        if (!this.awake(l)) continue;
        const o = l.a === id ? l.b : l.b === id ? l.a : null;
        if (o && !(o in prev)) { prev[o] = { l, from: id, to: o, dir: l.a === id ? 1 : -1 }; q.push(o); }
      }
    }
    return null;
  }
  // The pylon nearest to a place from which the court \`to\` can be reached.
  nearest(x, z, to = null) {
    let best = null, bd = 1e9;
    for (const n of Object.values(this.nodes)) {
      if (to && n.id !== to && !this.route(n.id, to)) continue;
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }
  // The pylon the hero is standing at, if any.
  at() { const p = this.game.player.pos; for (const n of Object.values(this.nodes)) if (Math.hypot(p.x - n.x, p.z - n.z) < 4.2 && Math.abs(p.y - n.y) < 3) return n; return null; }
  reachable(from) { return Object.keys(this.nodes).filter((id) => id !== from && this.route(from, id)); }

  update(dt, playing) {
    const g = this.game, p = g.player, show = !g.cine || !!g.cineAll;
    for (const l of this.links) {
      const on = this.awake(l);
      if (on && l.on === false && !g.cine) {
        // It has just woken: it runs out from whichever end the hero stands nearer to.
        l.u.uGrow.value = 0; l.u.uFrom.value = Math.hypot(p.pos.x - l.A.x, p.pos.z - l.A.z) < Math.hypot(p.pos.x - l.B.x, p.pos.z - l.B.z) ? 0 : 1; l.u.uPower.value = 1;
        g.emit('string', { phase: 'wake', a: l.a, b: l.b });
      }
      l.on = on;
      if (l.u.uGrow.value < 1) l.u.uGrow.value = Math.min(1, l.u.uGrow.value + dt * Math.max(0.16, 150 / l.len));
      l.u.uPower.value += ((on ? 1 : 0) - l.u.uPower.value) * Math.min(1, dt * 1.2); l.mesh.visible = show && l.u.uPower.value > 0.01;
    }
    for (const n of Object.values(this.nodes)) { n.u.uPower.value += ((this.links.some((l) => (l.a === n.id || l.b === n.id) && this.awake(l)) ? 1 : 0) - n.u.uPower.value) * Math.min(1, dt * 2); n.mesh.visible = show; n.mesh.rotation.y += dt * 0.3 * n.u.uPower.value; n.mesh.updateMatrixWorld(); }
    if (!playing) return;
    if (this.ride) { this._ride(dt); return; }
    this.cool = Math.max(0, (this.cool ?? 0) - dt);
    if (g.prompt || !p.grounded || p.state !== 'move' || this.cool > 0) return;
    const n = this.at();
    if (!n) return;
    // Where the journey leads, if it leads over the strings; otherwise the string that lies
    // nearest the way the camera looks.
    let hops = this.goal && this.goal !== n.id ? this.route(n.id, this.goal) : null;
    if (!hops) {
      let bs = -2;
      for (const l of this.links) {
        if ((l.a !== n.id && l.b !== n.id) || !this.awake(l)) continue;
        const o = l.a === n.id ? l.B : l.A, d = Math.hypot(o.x - n.x, o.z - n.z), s = ((o.x - n.x) * Math.sin(g.rig.yaw) + (o.z - n.z) * Math.cos(g.rig.yaw)) / d;
        if (s > bs) { bs = s; hops = [{ l, from: n.id, to: o.id, dir: l.a === n.id ? 1 : -1 }]; }
      }
    }
    if (!hops) return;
    const to = hops[hops.length - 1].to;
    g.prompt = { key: 'E', text: `Ride the string${hops.length > 1 ? 's' : ''} to ${NAMES[to] ?? 'the far side'}` };
    if (g.input.pressed.has('interact')) this.start(hops);
  }

  // Ride to a court from the pylon the hero stands at (used by the map).
  rideTo(id) { const n = this.at(), hops = n && this.route(n.id, id); if (!hops || this.ride) return false; this.start(hops); return true; }

  start(hops) {
    const g = this.game, p = g.player;
    const total = hops.reduce((s, h) => s + h.l.len, 0);
    this.ride = { hops, total, s: 0, t: 0, dur: Math.max(3.2, total / SPEED + 1.2), to: this.nodes[hops[hops.length - 1].to], from: p.pos.clone(), yaw0: p.yaw };
    p.setState('ride'); p.vel.set(0, 0, 0); p.invulnerable = 1e6; p.lockTarget = null; p.grounded = false;
    g.prompt = null;
    g.emit('ride', { phase: 'start', to: this.ride.to.id, seconds: this.ride.dur });
  }

  _at(s, out) {
    const r = this.ride;
    let i = 0, acc = 0;
    while (i < r.hops.length - 1 && s > acc + r.hops[i].l.len) { acc += r.hops[i].l.len; i++; }
    const h = r.hops[i], k = Math.max(0, Math.min(1, (s - acc) / h.l.len));
    return this.point(h.l, h.dir > 0 ? k : 1 - k, out);
  }

  _ride(dt) {
    const g = this.game, p = g.player, r = this.ride;
    r.t += dt;
    const u = Math.min(1, r.t / r.dur);
    // Away gently, fast through the middle, gently in.
    const e = u < 0.1 ? (u * u) / 0.18 : u > 0.9 ? 1 - ((1 - u) * (1 - u)) / 0.18 : (u - 0.05) / 0.9;
    const s = e * r.total, v = (s - r.s) / Math.max(dt, 1e-4); r.s = s;
    this._at(s, _a); this._at(Math.min(r.total, s + 2), _b);
    if (_b.distanceToSquared(_a) > 0.01) p.yaw += wrap(Math.atan2(_b.x - _a.x, _b.z - _a.z) - p.yaw) * Math.min(1, dt * 7);
    // The first moment lifts him from where he stood up to the string.
    const lift = Math.min(1, r.t / 0.45), le = lift * lift * (3 - 2 * lift);
    p.pos.set(_a.x, _a.y - HANG, _a.z);
    if (le < 1) p.pos.lerpVectors(r.from, p.pos, le);
    // The last moment sets him down beside the pylon.
    const tail = 1 - (r.dur - r.t) / 0.55;
    if (tail > 0) {
      if (!r.land) { const node = r.to, ox = node.x + Math.sin(p.yaw) * 2.6, oz = node.z + Math.cos(p.yaw) * 2.6; g.world.stream(ox, oz, 6); r.land = new THREE.Vector3(ox, g.world.floorBelow(ox, node.y + 2.5, oz, 8) + 0.02, oz); }
      const k = Math.min(1, tail); p.pos.lerp(r.land, k * k * (3 - 2 * k));
    }
    p.vel.set(Math.sin(p.yaw) * v, 0, Math.cos(p.yaw) * v); p.speed = 0; p.grounded = false; p.airTime = 1;
    p.viewY = p._viewY1 = p.pos.y;
    this.speed = v;
    // Sparks where the blade runs on the string.
    const n = Math.min(4, Math.floor(dt * v * 2.2 + Math.random()));
    for (let i = 0; i < n; i++) g.particles.spawn(_a.x, _a.y - 0.04, _a.z, { vel: [-Math.sin(p.yaw) * v * 0.25 + (Math.random() - 0.5) * 3, -0.5 - Math.random() * 3, -Math.cos(p.yaw) * v * 0.25 + (Math.random() - 0.5) * 3], life: 0.45, size: 0.05, color: [4.2, 3.0, 1.3], gravity: 7, streak: 0.12 });
    // The air he passes through: thin streaks coming at him from ahead.
    const ws = Math.min(5, Math.floor(dt * v * 1.6 + Math.random()));
    for (let i = 0; i < ws; i++) { const a = Math.random() * 6.283, rr = 1.2 + Math.random() * 3.2, fx = Math.sin(p.yaw), fz = Math.cos(p.yaw), d0 = 9 + Math.random() * 9; g.particles.spawn(p.pos.x + fx * d0 + Math.cos(a) * rr * fz, p.pos.y + 1.2 + Math.sin(a) * rr, p.pos.z + fz * d0 - Math.cos(a) * rr * fx, { vel: [-fx * v * 0.9, 0, -fz * v * 0.9], life: 0.32, size: 0.022, color: [1.3, 1.25, 1.1], streak: 0.5 }); }
    if (u >= 1) {
      const node = r.to;
      if (r.land) p.pos.copy(r.land);
      p.vel.set(0, 0, 0);
      p.setState('move'); p.invulnerable = 0.8; p.grounded = true; p.airTime = 0; p.fallStart = p.pos.y; p.viewY = p._viewY1 = p.pos.y;
      this.ride = null; this.speed = 0; this.cool = 1.6;        // a moment before the pylon offers the way back
      g.checkpoint = { x: p.pos.x, y: p.pos.y + 0.1, z: p.pos.z, yaw: p.yaw };
      g.rest();
      g.emit('ride', { phase: 'end', to: node.id });
    }
  }
}
