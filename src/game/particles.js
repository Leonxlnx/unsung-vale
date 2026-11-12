// Small pooled particle system for sparks, motes and glows. Simulated on the CPU (counts
// are tiny), drawn as soft additive camera-facing quads after the water.
import * as THREE from 'three';

const VERT = /* glsl */ `
in vec4 iPos;      // xyz, size
in vec4 iColor;    // rgb (HDR), alpha
in vec4 iVel;      // xyz velocity for streak stretch, w: streak amount
out vec2 vUv; out vec4 vColor; out float vViewZ;
void main() {
  vec4 mv = viewMatrix * vec4(iPos.xyz, 1.0);
  vec2 q = position.xy;
  // Stretch along the screen-space velocity so fast sparks read as streaks.
  vec3 vv = (viewMatrix * vec4(iVel.xyz, 0.0)).xyz;
  float sp = length(vv.xy);
  if (iVel.w > 0.0 && sp > 0.01) {
    vec2 d = vv.xy / sp, n = vec2(-d.y, d.x);
    mv.xy += (d * q.x * (1.0 + sp * iVel.w) + n * q.y) * iPos.w;
  } else mv.xy += q * iPos.w;
  vUv = position.xy; vColor = iColor; vViewZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform sampler2D uLinDepth;
uniform vec2 uResolution;
in vec2 vUv; in vec4 vColor; in float vViewZ;
void main() {
  float r = length(vUv);
  float a = (1.0 - smoothstep(0.0, 1.0, r));
  a = a * a * vColor.a;
  float sceneZ = texture(uLinDepth, gl_FragCoord.xy / uResolution).r;
  a *= clamp((sceneZ - vViewZ) * 2.0, 0.0, 1.0);
  gl_FragColor = vec4(vColor.rgb * a, a);
}`;

export class Particles {
  constructor(pipe, max = 640) {
    this.max = max;
    this.p = [];
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    for (const a of [this.aPos, this.aCol, this.aVel]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iColor', this.aCol); g.setAttribute('iVel', this.aVel);
    g.instanceCount = 0;
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: { ...pipe.sceneUniforms },
      transparent: true, depthWrite: false, blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation,
    }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 5;
  }

  // opts: { vel:[x,y,z], life, size, color:[r,g,b], gravity, drag, streak, grow, fade }
  spawn(x, y, z, o = {}) {
    if (this.p.length >= this.max) this.p.shift();
    this.p.push({ x, y, z, vx: o.vel?.[0] ?? 0, vy: o.vel?.[1] ?? 0, vz: o.vel?.[2] ?? 0, life: o.life ?? 0.5, age: 0, size: o.size ?? 0.1, color: o.color ?? [1, 1, 1], gravity: o.gravity ?? 0, drag: o.drag ?? 0, streak: o.streak ?? 0, grow: o.grow ?? 0, alpha: o.alpha ?? 1 });
  }

  burst(x, y, z, n, o = {}) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, e = Math.acos(2 * Math.random() - 1), sp = (o.speed ?? 4) * (0.35 + 0.65 * Math.random());
      const d = o.dir ?? [0, 0, 0], bias = o.bias ?? 0;
      this.spawn(x, y, z, { ...o, vel: [Math.sin(e) * Math.cos(a) * sp + d[0] * bias, Math.cos(e) * sp + d[1] * bias + (o.up ?? 0), Math.sin(e) * Math.sin(a) * sp + d[2] * bias], life: (o.life ?? 0.5) * (0.6 + 0.8 * Math.random()), size: (o.size ?? 0.08) * (0.6 + 0.8 * Math.random()) });
    }
  }

  update(dt) {
    const P = this.aPos.array, C = this.aCol.array, V = this.aVel.array;
    let n = 0;
    for (let i = 0; i < this.p.length; i++) {
      const q = this.p[i];
      q.age += dt;
      if (q.age >= q.life) { this.p.splice(i--, 1); continue; }
      q.vy -= q.gravity * dt;
      const k = Math.exp(-q.drag * dt);
      q.vx *= k; q.vy *= k; q.vz *= k;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      const t = q.age / q.life, o = n * 4;
      P[o] = q.x; P[o + 1] = q.y; P[o + 2] = q.z; P[o + 3] = q.size * (1 + q.grow * t);
      const f = (1 - t) * (1 - t) * q.alpha * Math.min(1, t * 12);
      C[o] = q.color[0]; C[o + 1] = q.color[1]; C[o + 2] = q.color[2]; C[o + 3] = f;
      V[o] = q.vx; V[o + 1] = q.vy; V[o + 2] = q.vz; V[o + 3] = q.streak;
      n++;
    }
    this.mesh.geometry.instanceCount = n;
    if (n) for (const a of [this.aPos, this.aCol, this.aVel]) { a.clearUpdateRanges(); a.addUpdateRange(0, n * 4); a.needsUpdate = true; }
  }
}
