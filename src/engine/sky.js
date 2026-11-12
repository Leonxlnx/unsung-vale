// Sky: physically based atmosphere plus volumetric clouds, both baked into warped panoramas.
//
// The atmosphere only changes when the sun moves, so it is baked once. Clouds are far more
// expensive on an integrated GPU, so they live in their own low-resolution panorama that is
// refreshed one small tile at a time into a back buffer and cross-faded with the front buffer.
// No single draw is ever long enough to stall the GPU. A tiny resolved copy with mips feeds
// fog colour, rough reflections and the ambient spherical harmonics.
import * as THREE from 'three';
import { FullscreenPass, makeTarget } from './fullscreen.js';
import { COMMON, SKYMAP, ATMOSPHERE } from './glsl.js';

const _cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const NOISE_GEN = /* glsl */ `
uniform float uSlice;
uniform int uMode;
vec3 h33(vec3 p) {
  uvec3 q = uvec3(ivec3(p)) * uvec3(1597334673u, 3812015801u, 2798796415u);
  q = (q.x ^ q.y ^ q.z) * uvec3(1597334673u, 3812015801u, 2798796415u);
  return -1.0 + 2.0 * vec3(q) * (1.0 / float(0xffffffffu));
}
float gradNoise(vec3 x, float freq) {
  vec3 p = floor(x), w = fract(x);
  vec3 u = w * w * w * (w * (w * 6.0 - 15.0) + 10.0);
  vec3 ga = h33(mod(p + vec3(0, 0, 0), freq)), gb = h33(mod(p + vec3(1, 0, 0), freq));
  vec3 gc = h33(mod(p + vec3(0, 1, 0), freq)), gd = h33(mod(p + vec3(1, 1, 0), freq));
  vec3 ge = h33(mod(p + vec3(0, 0, 1), freq)), gf = h33(mod(p + vec3(1, 0, 1), freq));
  vec3 gg = h33(mod(p + vec3(0, 1, 1), freq)), gh = h33(mod(p + vec3(1, 1, 1), freq));
  float va = dot(ga, w - vec3(0, 0, 0)), vb = dot(gb, w - vec3(1, 0, 0));
  float vc = dot(gc, w - vec3(0, 1, 0)), vd = dot(gd, w - vec3(1, 1, 0));
  float ve = dot(ge, w - vec3(0, 0, 1)), vf = dot(gf, w - vec3(1, 0, 1));
  float vg = dot(gg, w - vec3(0, 1, 1)), vh = dot(gh, w - vec3(1, 1, 1));
  return va + u.x * (vb - va) + u.y * (vc - va) + u.z * (ve - va) + u.x * u.y * (va - vb - vc + vd)
    + u.y * u.z * (va - vc - ve + vg) + u.z * u.x * (va - vb - ve + vf) + u.x * u.y * u.z * (-va + vb + vc - vd + ve - vf - vg + vh);
}
float worley(vec3 uv, float freq) {
  vec3 id = floor(uv), p = fract(uv);
  float md = 1e4;
  for (float x = -1.0; x <= 1.0; x++) for (float y = -1.0; y <= 1.0; y++) for (float z = -1.0; z <= 1.0; z++) {
    vec3 o = vec3(x, y, z);
    vec3 h = h33(mod(id + o, vec3(freq))) * 0.5 + 0.5 + o;
    vec3 d = p - h;
    md = min(md, dot(d, d));
  }
  return 1.0 - md;
}
float perlinFbm(vec3 p, float freq, int oct) {
  float g = exp2(-0.85), amp = 1.0, n = 0.0;
  for (int i = 0; i < oct; i++) { n += amp * gradNoise(p * freq, freq); freq *= 2.0; amp *= g; }
  return n;
}
float worleyFbm(vec3 p, float freq) {
  return worley(p * freq, freq) * 0.625 + worley(p * freq * 2.0, freq * 2.0) * 0.25 + worley(p * freq * 4.0, freq * 4.0) * 0.125;
}
float rmp(float x, float a, float b, float c, float d) { return (x - a) / (b - a) * (d - c) + c; }
float perlinWorley(vec3 p, float freq) {
  float pf = mix(1.0, perlinFbm(p, freq, 6), 0.5);
  pf = abs(pf * 2.0 - 1.0);
  return rmp(pf, 0.0, 1.0, worleyFbm(p, freq), 1.0);
}
void main() {
  vec3 p = vec3(vUv, uSlice);
  if (uMode == 0) {
    // Base shape: Perlin-Worley in r, with the low-frequency Worley erosion folded into g.
    float pw = perlinWorley(p, 4.0);
    float lf = worleyFbm(p, 4.0) * 0.625 + worleyFbm(p, 8.0) * 0.25 + worleyFbm(p, 16.0) * 0.125;
    // The constants stretch each field to fill 0..1 (measured 2nd to 98th percentile).
    float base = rmp(pw, lf - 1.0, 1.0, 0.0, 1.0);
    outColor = vec4(clamp((base - 0.62) / 0.35, 0.0, 1.0), lf, 0.0, 1.0);
  } else if (uMode == 1) {
    float hf = worleyFbm(p, 2.0) * 0.625 + worleyFbm(p, 4.0) * 0.25 + worleyFbm(p, 8.0) * 0.125;
    outColor = vec4(clamp((hf - 0.45) / 0.47, 0.0, 1.0), worleyFbm(p, 6.0), 0.0, 1.0);
  } else {
    // Weather map (2D, tileable): r = coverage field, g = how tall the clouds grow there.
    float a = perlinWorley(vec3(vUv, 0.31), 2.0);
    float b = perlinWorley(vec3(vUv, 0.67), 5.0);
    float t = perlinFbm(vec3(vUv, 0.13), 3.0, 3) * 0.5 + 0.5;
    outColor = vec4(clamp((a * 0.74 + b * 0.36 - 0.67) / 0.33, 0.0, 1.0), clamp((t - 0.25) / 0.45, 0.0, 1.0), 0.0, 1.0);
  }
}`;

const SUN_T = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunE;
uniform float uTurbidity;
vec3 sunTransmittance(vec3 p) {
  vec3 od = sunOpticalDepth(p, uSunDir);
  od.y *= uTurbidity;
  // Earth shadow: the sun is gone once the ray toward it dips below the horizon.
  vec2 g = raySphere(p, uSunDir, RG - 200.0);
  float vis = (g.x > 0.0 && g.x < 1e19) ? 0.0 : 1.0;
  return exp(-atmoExtinction(od)) * vis;
}`;

const ATMO_BAKE = /* glsl */ `
${COMMON}
${SKYMAP}
${ATMOSPHERE}
${SUN_T}
uniform float uMs;
uniform float uCamAlt;
uniform vec3 uAmbTop;
uniform vec3 uGroundAlbedo;
void main() {
  vec3 rd = skyToDir(vUv);
  vec3 ro = vec3(0.0, RG + uCamAlt, 0.0);
  vec2 tg = raySphere(ro, rd, RG);
  bool ground = tg.x > 0.0 && tg.x < 1e19;
  float tEnd = ground ? tg.x : raySphere(ro, rd, RT).y;
  float mu = dot(rd, uSunDir);
  float pr = phaseR(mu);
  float pm = mix(phaseHG(mu, 0.80), phaseHG(mu, 0.35), 0.35);
  vec3 od = vec3(0.0), sum = vec3(0.0);
  vec3 softL = normalize(uSunDir + vec3(0.0, 0.32, 0.0));
  float prev = 0.0;
  const int N = 24;
  for (int i = 1; i <= N; i++) {
    float f = float(i) / float(N);
    float t = tEnd * f * f;
    float dt = t - prev;
    vec3 p = ro + rd * (0.5 * (t + prev));
    vec3 d = atmoDensity(length(p) - RG);
    d.y *= uTurbidity;
    od += d * dt * 0.5;
    vec3 tv = exp(-atmoExtinction(od));
    vec3 ts = sunTransmittance(p);
    vec3 odSoft = sunOpticalDepth(p, softL);
    odSoft.y *= uTurbidity;
    vec3 tsSoft = exp(-atmoExtinction(odSoft));
    vec3 scatR = BETA_R * d.x, scatM = vec3(BETA_M * d.y);
    // Single scattering plus a soft isotropic fill standing in for multiple scattering.
    sum += tv * dt * uSunE * (ts * (scatR * pr + scatM * pm) + tsSoft * (scatR + scatM) * uMs * 0.0795775);
    od += d * dt * 0.5;
    prev = t;
  }
  if (ground) {
    // A plausible lit ground below the horizon so reflections and bounce light see something.
    vec3 gp = ro + rd * tg.x;
    vec3 irr = uSunE * sunTransmittance(gp + normalize(gp) * 30.0) * max(uSunDir.y, 0.0) + uAmbTop * 2.2;
    sum += exp(-atmoExtinction(od)) * uGroundAlbedo * irr / PI;
  }
  outColor = vec4(max(sum, 0.0), 1.0);
}`;

// Clouds use a flat-earth frame with a curvature term, which is cheaper and more precise in
// float32 than working at planet scale. Altitude = y + |xz|^2 / (2 R).
export const CLOUD_MAP = /* glsl */ `
const float CLOUD_POW = 1.7;
vec2 dirToCloudUv(vec3 d) {
  float e = asin(clamp(d.y, 0.0, 1.0)) / 1.5707963;
  return vec2(atan(d.z, d.x) * 0.15915494 + 0.5, pow(e, 1.0 / CLOUD_POW));
}
vec3 cloudUvToDir(vec2 uv) {
  float e = pow(uv.y, CLOUD_POW) * 1.5707963;
  float a = (uv.x - 0.5) * 6.2831853;
  return vec3(cos(e) * cos(a), sin(e), cos(e) * sin(a));
}`;

const CLOUD_BAKE = /* glsl */ `
${COMMON}
${SKYMAP}
${ATMOSPHERE}
${SUN_T}
${CLOUD_MAP}
uniform float uCamAlt;
uniform float uCloudTime;
uniform vec2 uWind;
uniform float uCoverage;
uniform float uDensity;
uniform float uSeed;
uniform vec3 uAmbTop;
uniform vec3 uAmbBottom;
uniform sampler3D uNoiseBase;
uniform sampler3D uNoiseDetail;
uniform sampler2D uWeather;
uniform sampler2D uAtmo;

const float CLOUD_BOTTOM = 2300.0;
const float CLOUD_TOP = 6400.0;
const float INV_2R = 0.5 / 6360.0e3;

float altOf(vec3 p) { return p.y + dot(p.xz, p.xz) * INV_2R; }

float shellT(vec3 rd, float h) {
  float a = (1.0 - rd.y * rd.y) * INV_2R, c = uCamAlt - h;
  if (a < 1e-12) return -c / max(rd.y, 1e-5);
  return (-rd.y + sqrt(max(rd.y * rd.y - 4.0 * a * c, 0.0))) / (2.0 * a);
}

float cloudDensity(vec3 p, bool detail) {
  float h = (altOf(p) - CLOUD_BOTTOM) / (CLOUD_TOP - CLOUD_BOTTOM);
  if (h <= 0.0 || h >= 1.0) return 0.0;
  vec3 wp = vec3(p.x + uWind.x * uCloudTime, p.y, p.z + uWind.y * uCloudTime);
  vec2 w = textureLod(uWeather, wp.xz / 104000.0, 0.0).rg;
  float cov = saturate((w.r - (1.0 - uCoverage)) / uCoverage);
  if (cov <= 0.01) return 0.0;
  float topH = mix(0.28, 1.0, smoothstep(0.2, 0.85, cov) * (0.55 + 0.45 * w.g));
  float hg = smoothstep(0.0, 0.07, h) * (1.0 - smoothstep(topH * 0.5, topH, h));
  float base = textureLod(uNoiseBase, wp * (1.0 / 8200.0), 0.0).r * hg;
  float d = saturate((base - (1.0 - cov)) / cov) * cov;
  if (d <= 0.0) return 0.0;
  if (detail) {
    float hf = textureLod(uNoiseDetail, wp * (1.0 / 1500.0) + vec3(uCloudTime * 0.004), 0.0).r;
    float m = mix(hf, 1.0 - hf, saturate(h * 5.0));
    d = saturate((d - m * 0.36) / (1.0 - m * 0.36));
  }
  return d * uDensity;
}

void main() {
  vec3 rd = cloudUvToDir(vUv);
  vec3 ro = vec3(0.0, uCamAlt, 0.0);
  float t0 = shellT(rd, CLOUD_BOTTOM), t1 = min(shellT(rd, CLOUD_TOP), 240000.0);
  vec3 sky = textureLod(uAtmo, dirToSky(rd), 0.0).rgb;
  float jitter = ign(gl_FragCoord.xy + uSeed);
  float mu = dot(rd, uSunDir);
  float phase = mix(phaseHG(mu, 0.78), phaseHG(mu, -0.25), 0.42) + 0.05 * phaseHG(mu, 0.97);
  // Sun colour at cloud altitude, evaluated once per pixel.
  vec3 pMid = ro + rd * (0.5 * (t0 + t1));
  vec3 sunC = uSunE * sunTransmittance(vec3(0.0, RG + altOf(pMid), 0.0));

  float T = 1.0, wsum = 0.0, dist = 0.0;
  vec3 L = vec3(0.0);
  if (t1 > t0) {
    const int N = 44;
    float dt = (t1 - t0) / float(N);
    for (int i = 0; i < N; i++) {
      if (T < 0.015) break;
      float t = t0 + (float(i) + jitter) * dt;
      vec3 p = ro + rd * t;
      float d = cloudDensity(p, true);
      if (d > 0.0) {
        float h = saturate((altOf(p) - CLOUD_BOTTOM) / (CLOUD_TOP - CLOUD_BOTTOM));
        // Three widening taps toward the sun approximate the self-shadowing integral.
        float od = cloudDensity(p + uSunDir * 150.0, false) * 300.0
                 + cloudDensity(p + uSunDir * 620.0, false) * 800.0
                 + cloudDensity(p + uSunDir * 1900.0, false) * 1900.0;
        float tl = max(exp(-od), 0.62 * exp(-od * 0.22));
        float powder = 1.0 - exp(-d * 190.0);
        vec3 amb = mix(uAmbBottom, uAmbTop, sqrt(h));
        // Thick cloud is dominated by multiple scattering, which is close to isotropic, so
        // blend the single-scatter phase toward 1/(4 pi) and keep the forward peak on top.
        float phaseEff = mix(phase, 0.0796, 0.62) + 0.35 * phase * tl;
        vec3 S = (sunC * tl * phaseEff * mix(1.0, powder, 0.5) * PI + amb) * d;
        float e = exp(-d * dt);
        L += T * (S - S * e) / max(d, 1e-6);
        wsum += T * (1.0 - e);
        dist += T * (1.0 - e) * t;
        T *= e;
      }
    }
  }
  dist = wsum > 0.0 ? dist / wsum : 0.0;
  float a = 1.0 - T;

  // High cirrus: a thin streaked sheet that catches the warm light.
  float ts = shellT(rd, 9500.0);
  vec3 pc = ro + rd * ts;
  vec2 q = (pc.xz + uWind * uCloudTime * 2.2) / 9000.0;
  q = mat2(0.86, 0.5, -0.5, 0.86) * q;
  float streak = fbm2(vec2(q.x * 0.55, q.y * 3.4) + fbm2(q * 1.3, 3) * 1.6, 5);
  float cover = fbm2(q * 0.35 + 4.2, 3);
  float ca = smoothstep(0.5, 0.82, streak) * smoothstep(0.42, 0.7, cover) * 0.5 * smoothstep(0.004, 0.06, rd.y);
  vec3 sunHi = uSunE * sunTransmittance(vec3(0.0, RG + 9500.0, 0.0));
  vec3 cc = (sunHi * (0.11 + 0.9 * phaseHG(mu, 0.7)) + uAmbTop * 0.9) * ca;
  vec3 cAer = exp(-ts * vec3(0.6e-5, 0.9e-5, 1.5e-5));
  cc = mix(sky * ca, cc, cAer);

  // Aerial perspective: distant clouds dissolve into the sky colour behind them.
  vec3 aer = exp(-dist * vec3(0.9e-5, 1.25e-5, 2.0e-5));
  vec3 cl = mix(sky * a, L, aer);
  // Composite cirrus behind the cumulus. Output is premultiplied radiance plus opacity.
  outColor = vec4(max(cl + cc * (1.0 - a), 0.0), 1.0 - (1.0 - a) * (1.0 - ca));
}`;

// GLSL for reading the sky from other shaders.
export const SKY_SAMPLE = /* glsl */ `
${CLOUD_MAP}
uniform sampler2D uSkyAtmo;
uniform sampler2D uCloudA;
uniform sampler2D uCloudB;
uniform float uCloudMix;
uniform sampler2D uSkyEnv;
vec4 sampleClouds(vec3 d) {
  if (d.y <= 0.0) return vec4(0.0);
  vec2 uv = dirToCloudUv(d);
  return mix(textureLod(uCloudA, uv, 0.0), textureLod(uCloudB, uv, 0.0), uCloudMix);
}
// rgb = sky radiance, a = how much of the sun disc survives the clouds.
vec4 sampleSky(vec3 d) {
  vec3 atmo = textureLod(uSkyAtmo, dirToSky(d), 0.0).rgb;
  vec4 c = sampleClouds(d);
  return vec4(atmo * (1.0 - c.a) + c.rgb, 1.0 - c.a);
}
vec3 sampleEnv(vec3 d, float lod) { return textureLod(uSkyEnv, dirToSky(d), lod).rgb; }
`;

const RESOLVE = /* glsl */ `
${COMMON}
${SKYMAP}
${SKY_SAMPLE}
void main() {
  outColor = vec4(min(sampleSky(skyToDir(vUv)).rgb, vec3(60.0)), 1.0);
}`;

// --- CPU mirror of the sun transmittance so the light colour matches the baked sky. ---
const RG = 6360e3, RT = 6460e3;
const BETA_R = [5.802e-6, 13.558e-6, 33.1e-6], BETA_M_EXT = 4.44e-6, BETA_O = [0.65e-6, 1.881e-6, 0.085e-6];
export function sunTransmittanceCPU(alt, sunDir, turbidity) {
  const py = RG + alt;
  const b = py * sunDir[1], c = py * py - RT * RT;
  const tTop = -b + Math.sqrt(b * b - c);
  let odR = 0, odM = 0, odO = 0, prev = 0;
  const N = 48;
  for (let i = 1; i <= N; i++) {
    const f = i / N, t = tTop * f * f, tm = 0.5 * (t + prev);
    const h = Math.max(0, Math.hypot(sunDir[0] * tm, py + sunDir[1] * tm, sunDir[2] * tm) - RG);
    odR += Math.exp(-h / 8000) * (t - prev);
    odM += Math.exp(-h / 1200) * (t - prev) * turbidity;
    odO += Math.max(0, 1 - Math.abs(h - 25000) / 15000) * (t - prev);
    prev = t;
  }
  return [0, 1, 2].map((k) => Math.exp(-(BETA_R[k] * odR + BETA_M_EXT * odM + BETA_O[k] * odO)));
}

export class Sky {
  constructor(renderer, opts = {}) {
    this.renderer = renderer;
    this.cloudW = opts.cloudWidth ?? 1024;
    this.cloudH = opts.cloudHeight ?? 256;
    this.tile = opts.tile ?? 32;            // tile edge in texels
    this.tilesPerFrame = opts.tilesPerFrame ?? 1;
    this.fadeSeconds = opts.fadeSeconds ?? 4;
    this.sunDir = new THREE.Vector3(1, 0.15, 0.3).normalize();
    this.sunIrradiance = new THREE.Vector3(1.0, 0.97, 0.93).multiplyScalar(22);
    this.turbidity = 5.5;
    this.cloudTime = 0;
    this.windSpeed = 1;
    this.sunColor = new THREE.Color();
    this.sh = Array.from({ length: 9 }, () => new THREE.Vector3());

    this.atmo = makeTarget(1024, 512);
    this.atmo.texture.wrapS = THREE.RepeatWrapping;
    const cloudTarget = () => {
      const t = makeTarget(this.cloudW, this.cloudH);
      t.texture.wrapS = THREE.RepeatWrapping;
      return t;
    };
    this.cloudFront = cloudTarget();
    this.cloudBack = cloudTarget();
    this.env = makeTarget(256, 128, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    this.env.texture.wrapS = THREE.RepeatWrapping;
    this.tiny = makeTarget(32, 16, { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.mix = 1;
    this.cursor = 0;
    this.ready = false;
    this._sweep = 0;
    this._bakeTarget = null;

    this._makeNoise();

    const sun = { uSunDir: { value: this.sunDir }, uSunE: { value: this.sunIrradiance }, uTurbidity: { value: this.turbidity } };
    this.ambTop = new THREE.Vector3(0.16, 0.24, 0.42);
    this.ambBottom = new THREE.Vector3(0.2, 0.17, 0.2);
    this.atmoBake = new FullscreenPass({
      fragment: ATMO_BAKE,
      uniforms: { ...sun, uMs: { value: 2.6 }, uCamAlt: { value: 350 }, uAmbTop: { value: this.ambTop }, uGroundAlbedo: { value: new THREE.Vector3(0.1, 0.12, 0.07) } },
    });
    this.cloudBake = new FullscreenPass({
      fragment: CLOUD_BAKE,
      uniforms: {
        ...sun,
        uCamAlt: { value: 350 },
        uCloudTime: { value: 0 },
        uWind: { value: new THREE.Vector2(14, 5) },
        uCoverage: { value: 0.66 },
        uDensity: { value: 0.035 },
        uSeed: { value: 0 },
        uAmbTop: { value: this.ambTop },
        uAmbBottom: { value: this.ambBottom },
        uNoiseBase: { value: this.noiseBase.texture },
        uNoiseDetail: { value: this.noiseDetail.texture },
        uWeather: { value: this.weather.texture },
        uAtmo: { value: this.atmo.texture },
      },
    });

    // Uniforms that the rest of the engine reads.
    this.uniforms = {
      uSkyAtmo: { value: this.atmo.texture },
      uCloudA: { value: this.cloudFront.texture },
      uCloudB: { value: this.cloudBack.texture },
      uCloudMix: { value: 1 },
      uSkyEnv: { value: this.env.texture },
    };
    this.resolve = new FullscreenPass({ fragment: RESOLVE, uniforms: this.uniforms });
    this.setSun(opts.azimuthDeg ?? 16, opts.elevationDeg ?? 9);
  }

  _makeNoise() {
    const r = this.renderer;
    const pass = new FullscreenPass({ fragment: NOISE_GEN, uniforms: { uSlice: { value: 0 }, uMode: { value: 0 } } });
    const make3D = (n, mode) => {
      const rt = new THREE.WebGL3DRenderTarget(n, n, n, { depthBuffer: false });
      const t = rt.texture;
      t.format = THREE.RGFormat; t.type = THREE.UnsignedByteType;
      t.minFilter = t.magFilter = THREE.LinearFilter;
      t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
      t.generateMipmaps = false;
      pass.uniforms.uMode.value = mode;
      for (let i = 0; i < n; i++) {
        pass.uniforms.uSlice.value = (i + 0.5) / n;
        r.setRenderTarget(rt, i);
        r.render(pass.mesh, _cam);
      }
      return rt;
    };
    this.noiseBase = make3D(64, 0);
    this.noiseDetail = make3D(32, 1);
    this.weather = new THREE.WebGLRenderTarget(512, 512, { depthBuffer: false, format: THREE.RGFormat, type: THREE.UnsignedByteType });
    this.weather.texture.wrapS = this.weather.texture.wrapT = THREE.RepeatWrapping;
    pass.uniforms.uMode.value = 2;
    pass.render(r, this.weather);
    pass.dispose();
    r.setRenderTarget(null);
  }

  setSun(azimuthDeg, elevationDeg) {
    const az = THREE.MathUtils.degToRad(azimuthDeg), el = THREE.MathUtils.degToRad(elevationDeg);
    this.sunDir.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
    const t = sunTransmittanceCPU(350, this.sunDir.toArray(), this.turbidity);
    this.sunColor.setRGB(this.sunIrradiance.x * t[0], this.sunIrradiance.y * t[1], this.sunIrradiance.z * t[2]);
    this.invalidate();
  }

  invalidate() { this.ready = false; }

  _bakeAtmosphere() {
    // 32 scissored tiles of about 1.5 ms each.
    for (let y = 0; y < 512; y += 128) for (let x = 0; x < 1024; x += 128) this.atmoBake.renderRegion(this.renderer, this.atmo, x, y, 128, 128);
  }

  _bakeCloudTiles(count) {
    const nx = Math.ceil(this.cloudW / this.tile), ny = Math.ceil(this.cloudH / this.tile), total = nx * ny;
    for (let k = 0; k < count && this.cursor < total; k++, this.cursor++) {
      const tx = this.cursor % nx, ty = Math.floor(this.cursor / nx);
      this.cloudBake.renderRegion(this.renderer, this._bakeTarget, tx * this.tile, ty * this.tile, this.tile, this.tile);
    }
    return this.cursor >= total;
  }

  _startSweep(time) {
    this._bakeTarget = this.cloudBack;
    this.cloudBake.uniforms.uCloudTime.value = time;
    this.cloudBake.uniforms.uSeed.value = (this._sweep % 16) * 7.31;
    this.cursor = 0;
  }

  _finishSweep(instant) {
    [this.cloudFront, this.cloudBack] = [this.cloudBack, this.cloudFront];
    this.uniforms.uCloudA.value = this.cloudBack.texture;    // previous clouds
    this.uniforms.uCloudB.value = this.cloudFront.texture;   // newest clouds
    this.mix = instant ? 1 : 0;
    this._sweep++;
    this._bakeTarget = null;
    this._needSH = true;
  }

  // Bakes everything now. Called on load and whenever the sun moves; two passes so the
  // cloud ambient can pick up the measured sky light from the first.
  bakeFull() {
    this._bakeAtmosphere();
    for (let pass = 0; pass < 2; pass++) {
      this._startSweep(this.cloudTime);
      while (!this._bakeCloudTiles(8)) { /* small scissored draws */ }
      this._finishSweep(true);
      this.uniforms.uCloudMix.value = 1;
      this.resolve.render(this.renderer, this.env);
      this._computeSH();
    }
    this._needSH = false;
    this.ready = true;
  }

  update(dt) {
    this.cloudTime += dt * this.windSpeed;
    if (!this.ready) this.bakeFull();
    if (this.mix < 1) {
      this.mix = Math.min(1, this.mix + dt / this.fadeSeconds);
    } else {
      if (!this._bakeTarget) this._startSweep(this.cloudTime + this.fadeSeconds * this.windSpeed);
      if (this.tilesPerFrame > 0 && this._bakeCloudTiles(this.tilesPerFrame)) this._finishSweep(false);
    }
    this.uniforms.uCloudMix.value = this.mix;
    this.resolve.render(this.renderer, this.env);
    if (this._needSH && this.mix >= 1) { this._computeSH(); this._needSH = false; }
  }

  _computeSH() {
    const w = 32, h = 16;
    this.resolve.render(this.renderer, this.tiny);
    const buf = new Float32Array(w * h * 4);
    this.renderer.readRenderTargetPixels(this.tiny, 0, 0, w, h, buf);
    const sh = this.sh;
    for (const v of sh) v.set(0, 0, 0);
    let wsum = 0;
    const P = 1.7;
    for (let j = 0; j < h; j++) {
      const t = ((j + 0.5) / h) * 2 - 1;
      const e = Math.sign(t) * Math.pow(Math.abs(t), P) * Math.PI * 0.5;
      // Solid angle of a texel under the warped latitude: cos(e) * de/dt.
      const sa = Math.cos(e) * P * Math.pow(Math.abs(t), P - 1);
      for (let i = 0; i < w; i++) {
        const a = ((i + 0.5) / w - 0.5) * Math.PI * 2;
        const x = Math.cos(e) * Math.cos(a), y = Math.sin(e), z = Math.cos(e) * Math.sin(a);
        const o = (j * w + i) * 4;
        const r = Math.min(buf[o], 40), g = Math.min(buf[o + 1], 40), b = Math.min(buf[o + 2], 40);
        const basis = shBasis(x, y, z);
        for (let k = 0; k < 9; k++) { sh[k].x += r * basis[k] * sa; sh[k].y += g * basis[k] * sa; sh[k].z += b * basis[k] * sa; }
        wsum += sa;
      }
    }
    const norm = (4 * Math.PI) / wsum;
    // Fold in the cosine lobe (and the 1/PI) so shaders get diffuse radiance for albedo 1 directly.
    const A = [1, 2 / 3, 2 / 3, 2 / 3, 0.25, 0.25, 0.25, 0.25, 0.25];
    for (let k = 0; k < 9; k++) sh[k].multiplyScalar(norm * A[k]);
    // Feed the measured sky light back into the cloud ambient for the next bake.
    const up = this.evalSH(0, 1, 0), down = this.evalSH(0, -1, 0);
    this.ambTop.copy(up).multiplyScalar(0.6);
    this.ambBottom.copy(down).multiplyScalar(0.55).addScaledVector(up, 0.18);
  }

  evalSH(x, y, z) {
    const b = shBasis(x, y, z), out = new THREE.Vector3();
    for (let k = 0; k < 9; k++) out.addScaledVector(this.sh[k], b[k]);
    return out;
  }
}

function shBasis(x, y, z) {
  return [0.282095, 0.488603 * y, 0.488603 * z, 0.488603 * x, 1.092548 * x * y, 1.092548 * y * z, 0.315392 * (3 * z * z - 1), 1.092548 * x * z, 0.546274 * (x * x - y * y)];
}

// Matches shBasis above. Returns diffuse radiance for a white surface with normal n.
export const SH_GLSL = /* glsl */ `
uniform vec3 uSH[9];
vec3 shIrradiance(vec3 n) {
  return max(uSH[0] * 0.282095 + uSH[1] * (0.488603 * n.y) + uSH[2] * (0.488603 * n.z) + uSH[3] * (0.488603 * n.x)
    + uSH[4] * (1.092548 * n.x * n.y) + uSH[5] * (1.092548 * n.y * n.z) + uSH[6] * (0.315392 * (3.0 * n.z * n.z - 1.0))
    + uSH[7] * (1.092548 * n.x * n.z) + uSH[8] * (0.546274 * (n.x * n.x - n.y * n.y)), vec3(0.0));
}`;
