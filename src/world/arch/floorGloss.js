// Reflections in the polished floors of the courts. The architecture shader already gives
// the paving its sheen and the reflected sky; this adds what stands on the floor (columns,
// balustrades, the hero) by tracing the mirrored ray through the finished opaque frame.
// It is drawn as thin sheets just above each floor, added on top of the scene.
import * as THREE from 'three';
import { COMMON, SKYMAP } from '../../engine/glsl.js';
import { SKY_SAMPLE } from '../../engine/sky.js';

const VERT = /* glsl */ `
out vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */ `
${COMMON}
${SKYMAP}
${SKY_SAMPLE}
uniform sampler2D uOpaque;
uniform sampler2D uLinDepth;
uniform mat4 uProjJ;
uniform vec2 uResolution;
uniform float uFrame;
uniform vec4 uPlazas[12];
in vec3 vWorld;
void main() {
  vec2 suv = gl_FragCoord.xy / uResolution;
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  float fade = 1.0 - smoothstep(50.0, 80.0, dist);
  if (fade <= 0.0 || V.y <= 0.02) discard;

  // The inlaid marble is polished; the flagstones around it are only worn smooth.
  float polished = 0.0;
  for (int i = 0; i < 12; i++) {
    float R = uPlazas[i].z;
    vec2 d = vWorld.xz - uPlazas[i].xy;
    float r = length(d) / max(R, 1e-3);
    if (R <= 0.0 || r > 1.0) continue;
    float n = uPlazas[i].w, a = atan(d.y, d.x);
    float t1 = abs(fract(a * n / TAU) - 0.5) * 2.0, t2 = abs(fract(a * n / TAU + 0.5) - 0.5) * 2.0;
    float s1 = 0.6 * mix(1.0, 0.36, pow(t1, 0.8)), s2 = 0.41 * mix(1.0, 0.45, pow(t2, 0.8));
    polished = max(polished, max(max(step(r, s1), step(r, s2)), max(step(0.655, r) * step(r, 0.7), step(0.87, r) * step(r, 0.985))));
  }
  float gloss = mix(0.42, 1.0, polished);

  // A slightly different mirror every frame: the anti-aliasing blends them into the soft
  // reflection of a honed surface rather than a wet one.
  vec2 rn = vec2(ign(gl_FragCoord.xy + uFrame * 5.588), ign(gl_FragCoord.yx + uFrame * 3.17 + 19.0)) - 0.5;
  float spread = mix(0.12, 0.04, polished);
  vec3 N = normalize(vec3(rn.x * spread, 1.0, rn.y * spread));
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  float F = 0.04 + 0.96 * pow(1.0 - saturate(V.y), 5.0);

  vec3 vp = (viewMatrix * vec4(vWorld, 1.0)).xyz;
  vec3 rv = normalize((viewMatrix * vec4(R, 0.0)).xyz);
  float viewZ = -vp.z;
  float stepLen = 0.3 + viewZ * 0.028, t = 0.2 + viewZ * 0.01 + stepLen * ign(gl_FragCoord.xy + uFrame * 7.31);
  float hit = 0.0; vec2 huv = suv;
  for (int i = 0; i < 24; i++) {
    vec3 p = vp + rv * t;
    vec4 c = uProjJ * vec4(p, 1.0);
    if (c.w <= 0.0) break;
    vec2 uv = c.xy / c.w * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
    float sz = textureLod(uLinDepth, uv, 0.0).r, rz = -p.z;
    if (rz > sz && rz - sz < stepLen * 2.0 + 0.4) { hit = 1.0; huv = uv; break; }
    stepLen *= 1.16;
    t += stepLen;
  }
  if (hit < 0.5) discard;
  vec2 edge = smoothstep(vec2(0.0), vec2(0.07), huv) * (1.0 - smoothstep(vec2(0.93), vec2(1.0), huv));
  vec3 hc = min(textureLod(uOpaque, huv, 0.0).rgb, vec3(24.0));
  // Whatever the ray hit stands in front of the sky the floor was already reflecting there.
  vec3 skyR = sampleEnv(R, 2.4);
  float k = F * gloss * fade * edge.x * edge.y * (1.0 - smoothstep(22.0, 48.0, t));
  vec3 add = (hc - skyR * 0.6) * k;
  // Never take more away than the floor has.
  vec3 base = textureLod(uOpaque, suv, 0.0).rgb;
  gl_FragColor = vec4(max(add, -0.85 * base), 0.0);
}`;

export class FloorGloss {
  // floors: [{ x, y, z, r }] discs (optionally half: true for the half facing +x) and
  // [{ x, y, z, w, d }] rectangles (w along x, d along z); y is the top of the paving.
  constructor(pipe, floors, plazas) {
    this.group = new THREE.Group();
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { ...pipe.sceneUniforms, ...pipe.sky.uniforms, uFrame: pipe.globals.uFrame, uPlazas: plazas },
      transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    });
    for (const f of floors) {
      const geo = f.r
        ? new THREE.CircleGeometry(f.r, 48, f.half ? -Math.PI / 2 : 0, f.half ? Math.PI : Math.PI * 2)
        : new THREE.PlaneGeometry(f.w, f.d);
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(f.x, f.y + 0.012, f.z);
      m.matrixAutoUpdate = false; m.updateMatrix();
      this.group.add(m);
    }
    this.group.updateMatrixWorld(true);
  }
}
