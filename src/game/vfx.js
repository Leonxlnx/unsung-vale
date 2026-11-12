// Effects drawn after the opaque scene: shockwaves that bend the picture behind them, and
// ribbons of light that wind up a spire when it is tuned. Sparks and glows live in
// particles.js; this file is for the effects that need the finished frame or real geometry.
import * as THREE from 'three';

// --- shockwaves: a ring on the ground (kind 0) or a bubble facing the camera (kind 1) ---
const WAVE_VERT = /* glsl */ `
in vec4 iPos;      // xyz centre, w radius now
in vec4 iInfo;     // x kind, y strength, z relative width of the front, w fade 0..1
in vec3 iColor;
out vec2 vUv; out vec4 vInfo; out vec3 vColor; out vec2 vDir;
void main() {
  vec3 wp;
  if (iInfo.x < 0.5) wp = iPos.xyz + vec3(position.x, 0.0, position.y) * iPos.w * 1.3;
  else {
    vec3 r = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]), u = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    wp = iPos.xyz + (r * position.x + u * position.y) * iPos.w * 1.3;
  }
  vUv = position.xy * 1.3; vInfo = iInfo; vColor = iColor;
  vec4 c = projectionMatrix * viewMatrix * vec4(wp, 1.0), cc = projectionMatrix * viewMatrix * vec4(iPos.xyz, 1.0);
  // Which way is "outward" on screen for this fragment.
  vDir = c.xy / max(c.w, 1e-3) - cc.xy / max(cc.w, 1e-3);
  gl_Position = c;
}`;
const WAVE_FRAG = /* glsl */ `
uniform sampler2D uOpaque;
uniform vec2 uResolution;
in vec2 vUv; in vec4 vInfo; in vec3 vColor; in vec2 vDir;
void main() {
  float r = length(vUv);
  float x = (r - 1.0) / vInfo.z;
  float band = exp(-x * x);                       // the front itself
  float wake = (1.0 - smoothstep(0.0, 1.0, r)) * 0.08 * step(vInfo.x, 0.5);   // faint light left behind on the ground
  if (band + wake < 0.004) discard;
  vec2 suv = gl_FragCoord.xy / uResolution;
  vec2 dir = normalize(vDir + vec2(1e-6));
  // The front bends what lies behind it, as heat does over a road: pushed outward ahead of
  // the crest and pulled back behind it.
  float bend = band * x * vInfo.y * vInfo.w * 0.06;
  vec3 refr = textureLod(uOpaque, clamp(suv - dir * bend, 0.002, 0.998), 0.0).rgb;
  float a = band * vInfo.w;
  vec3 glow = vColor * (band * band + wake) * vInfo.w;
  gl_FragColor = vec4(refr * a + glow, a);
}`;

// --- spire helix: strands of light spiralling up the shaft and on into the beam ---
const HELIX_VERT = /* glsl */ `
in float iStrand;
uniform vec3 uBase; uniform float uHeight; uniform float uTime; uniform float uRise; uniform float uPower;
out vec2 vUv; out float vHead;
void main() {
  float t = position.x;                                   // 0 at the foot, 1 at the top
  float turns = 5.0, ph = iStrand * 1.5708 + uTime * (0.6 + 2.4 * (1.0 - uPower * 0.6));
  float a = t * turns * 6.2832 + ph;
  // Wide at the dais, drawn in tight where it meets the beam, then opening again far above.
  float rad = mix(3.6, 0.9, smoothstep(0.0, 0.35, t)) + 2.2 * smoothstep(0.55, 1.0, t) * t;
  vec3 c = uBase + vec3(cos(a) * rad, t * uHeight, sin(a) * rad);
  vec3 tang = normalize(vec3(-sin(a) * rad * turns * 6.2832, uHeight, cos(a) * rad * turns * 6.2832));
  vec3 side = normalize(cross(tang, normalize(cameraPosition - c)));
  float w = 0.10 + 0.5 * t;
  vUv = vec2(t, position.y);
  // The head of each strand climbs with uRise; nothing is drawn above it.
  vHead = uRise * 1.25 - t;
  gl_Position = projectionMatrix * viewMatrix * vec4(c + side * position.y * w, 1.0);
}`;
const HELIX_FRAG = /* glsl */ `
uniform float uTime; uniform float uPower; uniform vec3 uColor;
in vec2 vUv; in float vHead;
void main() {
  if (vHead < 0.0) discard;
  float across = 1.0 - abs(vUv.y);
  float core = across * across * across;
  // Pulses of light run up the strand; the head burns brightest.
  float run = 0.55 + 0.45 * sin(vUv.x * 46.0 - uTime * 7.0);
  float head = exp(-vHead * 9.0) * 3.5;
  float fadeTop = 1.0 - smoothstep(0.7, 1.0, vUv.x);
  float a = core * (run * 0.5 + head + 0.15) * fadeTop * uPower;
  gl_FragColor = vec4(uColor * a, 0.0);
}`;

export class Vfx {
  constructor(pipe, max = 48) {
    this.pipe = pipe; this.max = max; this.waves = []; this.helices = [];
    this.group = new THREE.Group();
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.aInfo = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    for (const a of [this.aPos, this.aInfo, this.aCol]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iInfo', this.aInfo); g.setAttribute('iColor', this.aCol);
    g.instanceCount = 0;
    this.waveMesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      vertexShader: WAVE_VERT, fragmentShader: WAVE_FRAG, uniforms: { ...pipe.sceneUniforms },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    }));
    this.waveMesh.frustumCulled = false; this.waveMesh.renderOrder = 7;
    this.group.add(this.waveMesh);
  }

  // A shockwave. kind 0: a ring spreading over the ground; 1: a bubble seen from any side.
  // It grows from r0 to r1 over life seconds (after an optional delay), easing out.
  wave(x, y, z, { kind = 0, r0 = 0.3, r1 = 6, life = 0.6, strength = 1, width = 0.12, color = [3, 2.2, 1], delay = 0 } = {}) {
    if (this.waves.length >= this.max) this.waves.shift();
    this.waves.push({ x, y, z, kind, r0, r1, life, strength, width, color, age: -delay });
  }

  // Strands of light around a spire: { x, base, z, h }. Returns a handle with .start() to
  // send the strands climbing (the moment of tuning) and .power to dim or brighten them.
  helix(spire, color = [5, 3.6, 1.6]) {
    const N = 160, pos = [], idx = [];
    for (let i = 0; i <= N; i++) pos.push(i / N, -1, 0, i / N, 1, 0);
    for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.setAttribute('iStrand', new THREE.InstancedBufferAttribute(new Float32Array([0, 1, 2, 3]), 1));
    g.instanceCount = 4;
    const uniforms = {
      uBase: { value: new THREE.Vector3(spire.x, spire.base + 0.8, spire.z) }, uHeight: { value: spire.h * 3.2 },
      uTime: this.pipe.globals.uTime, uRise: { value: 0 }, uPower: { value: 0 }, uColor: { value: new THREE.Vector3(...color) },
    };
    const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
      vertexShader: HELIX_VERT, fragmentShader: HELIX_FRAG, uniforms, side: THREE.DoubleSide,
      transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    }));
    m.frustumCulled = false; m.renderOrder = 6; m.visible = false;
    this.group.add(m);
    const h = { mesh: m, uniforms, rise: 0, power: 0, target: 0, start() { this.rise = 0.0001; this.target = 1; this.power = 1.6; }, set(on) { this.rise = on ? 1 : 0; this.target = on ? 1 : 0; this.power = on ? 0.45 : 0; } };
    this.helices.push(h);
    return h;
  }

  update(dt) {
    const P = this.aPos.array, I = this.aInfo.array, C = this.aCol.array;
    let n = 0;
    for (let i = 0; i < this.waves.length; i++) {
      const w = this.waves[i];
      w.age += dt;
      if (w.age >= w.life) { this.waves.splice(i--, 1); continue; }
      if (w.age < 0) continue;
      const t = w.age / w.life, e = 1 - (1 - t) * (1 - t) * (1 - t);
      P.set([w.x, w.y, w.z, w.r0 + (w.r1 - w.r0) * e], n * 4);
      I.set([w.kind, w.strength, w.width, (1 - t) * (1 - t) * Math.min(1, t * 14)], n * 4);
      C.set(w.color, n * 3);
      n++;
    }
    this.waveMesh.geometry.instanceCount = n;
    this.waveMesh.visible = n > 0;
    if (n) for (const a of [this.aPos, this.aInfo, this.aCol]) { a.clearUpdateRanges(); a.addUpdateRange(0, n * a.itemSize); a.needsUpdate = true; }
    for (const h of this.helices) {
      // The strands climb in about three seconds, flare, then settle to a steady glow.
      if (h.rise > 0 && h.rise < 1) h.rise = Math.min(1, h.rise + dt / 3.2);
      const rest = h.target * 0.45;
      h.power += (rest - h.power) * Math.min(1, dt * 0.5);
      h.uniforms.uRise.value = h.rise; h.uniforms.uPower.value = h.power;
      h.mesh.visible = h.rise > 0 && h.power > 0.01;
    }
  }
}
