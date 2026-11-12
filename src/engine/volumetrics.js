// Volumetric haze and mist with light shafts. A short ray-march at quarter resolution
// accumulates sunlight scattered by the air between the camera and the scene, shadowed by
// the terrain, by buildings and trees (static shadow map) and by drifting cloud shade.
// The result is upsampled with a depth-aware filter and composited by the fog pass, which
// continues analytically beyond the march distance.
import * as THREE from 'three';
import { FullscreenPass, makeTarget } from './fullscreen.js';
import { COMMON, SKYMAP, ATMOSPHERE } from './glsl.js';
import { SKY_SAMPLE, SH_GLSL } from './sky.js';
import { DEPTH_GLSL, FOG_GLSL } from './post.js';
import { LIGHTING } from './lighting.js';
import { TERRAIN_SAMPLING } from '../world/terrain.js';

const VOL = /* glsl */ `
${COMMON}
${SKYMAP}
${ATMOSPHERE}
${SKY_SAMPLE}
${SH_GLSL}
${DEPTH_GLSL}
${FOG_GLSL}
${TERRAIN_SAMPLING}
${LIGHTING}
uniform sampler2D uDepth;
uniform sampler3D uNoise3;
uniform float uTime;
uniform float uFrame;
uniform float uMaxDist;
uniform vec3 uWindDir;
const int STEPS = 16;

// Extinction at a point: thin high haze plus low mist broken up by drifting noise.
vec2 densities(vec3 p) {
  float haze = uHaze.x * exp(-max(p.y, -200.0) / uHaze.y);
  float mist = uMist.x * exp(-max(p.y - uMist.z, -50.0) / uMist.y);
  if (mist > 1e-6) {
    vec3 q = p * (1.0 / 240.0) + uWindDir * uTime * 0.012;
    float n = textureLod(uNoise3, q, 0.0).r;
    float n2 = textureLod(uNoise3, q * 3.7 + 0.3, 0.0).r;
    mist *= smoothstep(0.25, 0.85, n * 0.75 + n2 * 0.35) * 2.6;
  }
  return vec2(haze, mist);
}

void main() {
  float d = texture(uDepth, vUv).r;
  vec3 vp = viewPosFromDepth(vUv, isSky(d) ? 0.5 : d);
  vec3 rd = normalize(worldFromView(vp) - uCamPos);
  float dist = isSky(d) ? uMaxDist : min(length(vp), uMaxDist);
  float mu = dot(rd, uSunDir);
  float phase = mix(phaseHG(mu, 0.74), phaseHG(mu, 0.2), 0.4);
  vec3 hdir = normalize(vec3(rd.x, 0.05 + max(rd.y, 0.0) * 0.35, rd.z));
  vec3 skyCol = sampleEnv(hdir, 1.0);
  vec3 ambient = shIrradiance(vec3(0.0, 1.0, 0.0));

  float jitter = ign(gl_FragCoord.xy + uFrame * 5.588);
  vec3 L = vec3(0.0);
  float T = 1.0;
  // Quadratic step distribution: fine near the camera, coarse far away.
  float prev = 0.0;
  for (int i = 0; i < STEPS; i++) {
    float f = (float(i) + jitter) / float(STEPS);
    float t1 = dist * f * f + dist * f * 0.08;
    t1 = min(t1, dist);
    float dt = t1 - prev;
    vec3 p = uCamPos + rd * (prev + dt * 0.5);
    prev = t1;
    vec2 dn = densities(p);
    float sigma = dn.x + dn.y;
    if (sigma < 1e-7) continue;
    float vis = terrainSunVis(p) * cloudShadow(p);
    // Buildings and trees: one unfiltered tap of the static map is enough for shafts.
    vec4 sc = uStaticMat * vec4(p, 1.0);
    if (max(abs(sc.x), abs(sc.y)) < 0.995) vis *= shadowTap(uShadowStatic, vec3(sc.xy * 0.5 + 0.5, sc.z + 0.004));
    vec3 S = (uSunColor * phase * vis * 1.7 + skyCol * 0.2 + ambient * 0.22) * dn.x
           + (uSunColor * (0.03 + phase * 0.9) * vis * 1.7 + ambient * 0.85) * dn.y;
    float e = exp(-sigma * dt);
    L += T * S * (1.0 - e) / sigma;
    T *= e;
  }
  outColor = vec4(L, T);
}`;

export class Volumetrics {
  constructor(pipe) {
    this.pipe = pipe;
    this.maxDist = 1400;
    this.enabled = true;
    const g = pipe.globals;
    this.pass = new FullscreenPass({
      fragment: VOL,
      defines: pipe.depthDefines,
      uniforms: {
        ...pipe.lit(), ...pipe.camUniforms, ...pipe.fog.uniforms,
        uDepth: { value: null }, uNoise3: { value: pipe.sky.noiseDetail.texture },
        uMaxDist: { value: this.maxDist }, uWindDir: { value: new THREE.Vector3(0.9, 0.05, 0.4) },
        uTime: g.uTime, uFrame: g.uFrame,
      },
    });
  }
  setSize(rw, rh) {
    this.target?.dispose();
    this.target = makeTarget(Math.max(2, Math.ceil(rw / 4)), Math.max(2, Math.ceil(rh / 4)));
  }
  render(renderer, depth) {

    this.pass.uniforms.uDepth.value = depth;
    this.pass.uniforms.uMaxDist.value = this.maxDist;
    this.pass.render(renderer, this.target);
    return this.target.texture;
  }
}
