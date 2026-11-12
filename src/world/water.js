// Water: the valley lake / far estuary at sea level plus the elevated pools on the mesas.
// Drawn after the opaque scene so it can refract the scene colour and ray-march
// screen-space reflections against the linear depth copy.
import * as THREE from 'three';
import { FullscreenPass } from '../engine/fullscreen.js';
import { COMMON, SKYMAP, ATMOSPHERE } from '../engine/glsl.js';
import { SKY_SAMPLE, SH_GLSL } from '../engine/sky.js';
import { FOG_GLSL } from '../engine/post.js';
import { TERRAIN_SAMPLING } from './terrain.js';
import { POOLS, WORLD } from './layout.js';

// Tileable wave normals: gradient noise octaves summed with periodic wrapping.
const WAVE_BAKE = /* glsl */ `
vec2 h22(vec2 p, float per) {
  p = mod(p, per);
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy) * 2.0 - 1.0;
}
float gn(vec2 p, float per) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(normalize(h22(i, per)), f), b = dot(normalize(h22(i + vec2(1, 0), per)), f - vec2(1, 0));
  float c = dot(normalize(h22(i + vec2(0, 1), per)), f - vec2(0, 1)), d = dot(normalize(h22(i + vec2(1, 1), per)), f - vec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float height(vec2 uv) {
  float h = 0.0, a = 0.5, f = 4.0;
  for (int i = 0; i < 6; i++) {
    // Slightly ridged octaves read as wind ripples rather than blobs.
    float n = gn(uv * f + float(i) * 3.7, f);
    h += a * (1.0 - abs(n) * 1.6);
    a *= 0.52; f *= 2.0;
  }
  return h;
}
void main() {
  float e = 1.0 / 512.0;
  float hx = height(vUv + vec2(e, 0.0)) - height(vUv - vec2(e, 0.0));
  float hy = height(vUv + vec2(0.0, e)) - height(vUv - vec2(0.0, e));
  vec3 n = normalize(vec3(-hx * 9.0, -hy * 9.0, 1.0));
  outColor = vec4(n * 0.5 + 0.5, height(vUv));
}`;

const WATER_VERT = /* glsl */ `
out vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const WATER_FRAG = /* glsl */ `
${COMMON}
${SKYMAP}
${ATMOSPHERE}
${SKY_SAMPLE}
${SH_GLSL}
${FOG_GLSL}
${TERRAIN_SAMPLING}
uniform sampler2D uOpaque;
uniform sampler2D uLinDepth;
uniform sampler2D uWaves;
uniform mat4 uProjJ;
uniform vec2 uResolution;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uTime;
in vec3 vWorld;

vec3 waveNormal(vec2 xz, float dist) {
  vec2 w1 = vec2(0.9, 0.35) * uTime;
  vec3 a = texture(uWaves, xz / 23.0 + w1 * 0.021).xyz * 2.0 - 1.0;
  vec3 b = texture(uWaves, xz / 7.3 - w1.yx * 0.047 + 0.37).xyz * 2.0 - 1.0;
  vec3 c = texture(uWaves, xz / 97.0 + w1 * 0.006 + 0.11).xyz * 2.0 - 1.0;
  // Fine ripples fade with distance so the far lake becomes a calm mirror instead of noise.
  float fine = 1.0 / (1.0 + dist * 0.012), mid = 1.0 / (1.0 + dist * 0.0022);
  vec2 n = a.xy * 0.34 * mid + b.xy * 0.22 * fine + c.xy * 0.3;
  return normalize(vec3(n.x, 1.0, n.y));
}

void main() {
  vec2 suv = gl_FragCoord.xy / uResolution;
  vec3 V = normalize(cameraPosition - vWorld);
  float dist = distance(cameraPosition, vWorld);
  float viewZ = -(viewMatrix * vec4(vWorld, 1.0)).z;
  vec3 N = waveNormal(vWorld.xz, dist);

  // Refraction: scene behind the surface, bent by the wave normal and limited near the shore.
  float sceneZ = texture(uLinDepth, suv).r;
  float thick = max(sceneZ - viewZ, 0.0);
  vec2 ruv = suv + N.xz * 0.035 * saturate(thick * 0.4) / (1.0 + viewZ * 0.02);
  float sceneZ2 = texture(uLinDepth, ruv).r;
  if (sceneZ2 < viewZ) { ruv = suv; sceneZ2 = sceneZ; }
  float depth = max(sceneZ2 - viewZ, 0.0) * max(V.y, 0.25);
  vec3 refr = textureLod(uOpaque, ruv, 0.0).rgb;

  float vis = terrainSunVis(vWorld + vec3(0.0, 0.3, 0.0));
  vec3 skyUp = shIrradiance(vec3(0.0, 1.0, 0.0));
  vec3 light = uSunColor * max(uSunDir.y, 0.0) * vis * 0.3183 + skyUp;
  vec3 absorb = exp(-depth * vec3(0.42, 0.11, 0.085));
  vec3 scatter = vec3(0.012, 0.085, 0.082) * light;
  vec3 body = refr * absorb + scatter * (1.0 - absorb.g);

  // Screen-space reflection against the linear depth, falling back to the sky.
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 refl = sampleSky(R).rgb;
  vec3 vp = (viewMatrix * vec4(vWorld, 1.0)).xyz;
  vec3 rv = normalize((viewMatrix * vec4(R, 0.0)).xyz);
  float t = 1.5 + viewZ * 0.02, stepLen = 2.0 + viewZ * 0.045;
  float jitter = ign(gl_FragCoord.xy + fract(uTime) * 61.0);
  t += stepLen * jitter;
  float hit = 0.0; vec2 huv = suv;
  for (int i = 0; i < 28; i++) {
    vec3 p = vp + rv * t;
    vec4 c = uProjJ * vec4(p, 1.0);
    vec2 uv = c.xy / c.w * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || c.w <= 0.0) break;
    float sz = textureLod(uLinDepth, uv, 0.0).r;
    float rz = -p.z;
    if (rz > sz && rz - sz < stepLen * 2.5 + sz * 0.06) { hit = 1.0; huv = uv; break; }
    stepLen *= 1.17;
    t += stepLen;
  }
  if (hit > 0.5) {
    vec2 edge = smoothstep(vec2(0.0), vec2(0.06), huv) * (1.0 - smoothstep(vec2(0.94), vec2(1.0), huv));
    vec3 hc = textureLod(uOpaque, huv, 0.0).rgb;
    // The reflected scene is seen through extra air; fade it toward the sky reflection a little.
    float hazeT = exp(-t * uHaze.x * 2.0);
    refl = mix(refl, mix(refl, hc, hazeT), edge.x * edge.y);
  }

  float ndv = saturate(dot(N, V));
  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  // Sun glitter.
  vec3 H = normalize(V + uSunDir);
  float ndh = saturate(dot(N, H));
  float rough = 0.045 + 0.1 * saturate(dist / 4000.0);
  float a2 = rough * rough;
  float d = a2 / (PI * sq(ndh * ndh * (a2 - 1.0) + 1.0));
  vec3 spec = uSunColor * vis * min(d, 900.0) * (0.02 + 0.98 * pow(1.0 - saturate(dot(V, H)), 5.0)) * saturate(dot(N, uSunDir)) * 0.25;

  vec3 col = mix(body, refl, fres) + spec;
  // Soft foam line where the water meets the land.
  float shore = 1.0 - smoothstep(0.0, 0.55, thick);
  float foamN = texture(uWaves, vWorld.xz / 3.1 + uTime * 0.02).a;
  col = mix(col, light * 0.55, shore * smoothstep(0.45, 0.75, foamN + shore * 0.35) * 0.8);
  gl_FragColor = vec4(col, 1.0);
}`;

export class Water {
  constructor(pipe, terrain) {
    this.pipe = pipe;
    const r = pipe.renderer, g = pipe.globals;

    const waves = new THREE.WebGLRenderTarget(512, 512, { depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    waves.texture.wrapS = waves.texture.wrapT = THREE.RepeatWrapping;
    waves.texture.anisotropy = 8;
    const wb = new FullscreenPass({ fragment: WAVE_BAKE });
    wb.render(r, waves);
    wb.dispose();
    this.waves = waves;

    this.uniforms = { uWaves: { value: waves.texture }, ...pipe.sceneUniforms };
    this.material = new THREE.ShaderMaterial({
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      uniforms: {
        ...this.uniforms, ...pipe.sky.uniforms, ...terrain.uniforms, ...pipe.fog.uniforms,
        uSunDir: g.uSunDir, uSunColor: g.uSunColor, uSH: g.uSH, uTime: g.uTime,
      },
    });

    this.group = new THREE.Group();
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(120000, 120000).rotateX(-Math.PI / 2), this.material);
    sea.position.y = WORLD.waterLevel;
    sea.frustumCulled = false;
    this.group.add(sea);
    for (const p of POOLS) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(p.r + 10, 40).rotateX(-Math.PI / 2), this.material);
      m.position.set(p.x, p.level, p.z);
      this.group.add(m);
    }
    this.group.updateMatrixWorld(true);
  }
}
