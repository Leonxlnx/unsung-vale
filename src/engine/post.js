// Post-processing passes: aerial perspective, temporal anti-aliasing, bloom.
import * as THREE from 'three';
import { FullscreenPass, makeTarget } from './fullscreen.js';
import { COMMON, SKYMAP, ATMOSPHERE } from './glsl.js';
import { SKY_SAMPLE, SH_GLSL } from './sky.js';

// Depth helpers. With the reversed depth buffer NDC z runs 1 (near) to 0 (far) and equals
// the stored depth; without it NDC z is depth * 2 - 1 and far is 1.
export const DEPTH_GLSL = /* glsl */ `
uniform mat4 uProjInv;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
#ifdef REVERSED_DEPTH
  bool isSky(float d) { return d <= 0.0; }
  vec3 viewPosFromDepth(vec2 uv, float d) { vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, d, 1.0); return v.xyz / v.w; }
#else
  bool isSky(float d) { return d >= 1.0; }
  vec3 viewPosFromDepth(vec2 uv, float d) { vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return v.xyz / v.w; }
#endif
vec3 worldFromView(vec3 v) { return (uCamWorld * vec4(v, 1.0)).xyz; }
`;

export const FOG_GLSL = /* glsl */ `
uniform vec4 uHaze;   // x: extinction at sea level (1/m), y: scale height (m), z: sun glow, w: unused
uniform vec4 uMist;   // x: extinction at the lake surface, y: scale height, z: base height, w: unused
float fogOpticalDepth(float beta, float H, float h0, float h1, float dist) {
  float dh = h1 - h0;
  float a = exp(-max(h0, -200.0) / H), b = exp(-max(h1, -200.0) / H);
  float avg = abs(dh) > 0.05 ? (a - b) * H / dh : a;
  return beta * avg * dist;
}
// Returns in-scattered light in rgb and transmittance in a for a view ray segment.
vec4 fogBetween(vec3 ro, vec3 rd, float dist, vec3 sunDir, vec3 sunColor) {
  vec3 p1 = ro + rd * dist;
  float odH = fogOpticalDepth(uHaze.x, uHaze.y, ro.y, p1.y, dist);
  float odM = fogOpticalDepth(uMist.x, uMist.y, ro.y - uMist.z, p1.y - uMist.z, dist);
  float mu = dot(rd, sunDir);
  // Haze takes the colour of the sky at the horizon in this direction, plus a forward glow.
  vec3 hdir = normalize(vec3(rd.x, 0.05 + max(rd.y, 0.0) * 0.35, rd.z));
  vec3 hazeCol = sampleEnv(hdir, 1.0) + sunColor * uHaze.z * phaseHG(mu, 0.72);
  vec3 mistCol = shIrradiance(vec3(0.0, 1.0, 0.0)) * 0.9 + sunColor * (0.035 + 0.5 * uHaze.z * phaseHG(mu, 0.6));
  float od = odH + odM;
  float T = exp(-od);
  vec3 col = (hazeCol * odH + mistCol * odM) / max(od, 1e-6);
  return vec4(col * (1.0 - T), T);
}
`;

const FOG_PASS = /* glsl */ `
${COMMON}
${SKYMAP}
${ATMOSPHERE}
${SKY_SAMPLE}
${SH_GLSL}
${DEPTH_GLSL}
${FOG_GLSL}
uniform sampler2D uColor;
uniform sampler2D uDepth;
uniform sampler2D uVol;
uniform sampler2D uAo;
uniform float uAoStrength;
uniform vec3 uVolInfo;     // x: enabled, y: march distance, z: unused
uniform vec4 uMute[3];     // xz centre, radius, strength: where the land has fallen silent
uniform float uTimeF;
uniform vec2 uVolSize;
uniform vec3 uSunDir;
uniform vec3 uSunColor;

float viewDist(vec2 uv) {
  float d = textureLod(uDepth, uv, 0.0).r;
  return isSky(d) ? 1.0e5 : length(viewPosFromDepth(uv, d));
}
// Depth-aware upsample of the quarter-resolution volumetrics so shafts do not bleed
// across silhouettes.
vec4 volumetric(float dist) {
  vec2 p = vUv * uVolSize - 0.5;
  vec2 base = floor(p), f = p - base;
  vec4 acc = vec4(0.0); float wsum = 0.0;
  for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
    vec2 o = vec2(float(i), float(j));
    vec2 uv = (base + o + 0.5) / uVolSize;
    float w = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y);
    float dd = min(viewDist(uv), uVolInfo.y), dc = min(dist, uVolInfo.y);
    w *= 1.0 / (1.0 + abs(dd - dc) * 40.0 / max(dc, 1.0));
    acc += textureLod(uVol, uv, 0.0) * w; wsum += w;
  }
  return acc / max(wsum, 1e-5);
}
void main() {
  vec3 col = texture(uColor, vUv).rgb;
  float d = texture(uDepth, vUv).r;
  bool sky = isSky(d);
  vec3 vp = viewPosFromDepth(vUv, sky ? 0.5 : d);
  float dist = sky ? 1.0e5 : length(vp);
  vec3 rd = normalize(worldFromView(vp) - uCamPos);
  if (!sky && uAoStrength > 0.0) {
    // Contact shadows from the half-resolution occlusion buffer; bright sunlit surfaces keep
    // most of their light so only the ambient part is really darkened.
    float ao = texture(uAo, vUv).r;
    col *= mix(1.0, ao, uAoStrength * (1.0 - 0.45 * saturate(luma(col) * 0.6)));
  }
  if (!sky) {
    // Silence drains the colour out of the world; a thin warm rim marks its edge.
    vec3 wp = uCamPos + rd * dist;
    for (int i = 0; i < 3; i++) {
      if (uMute[i].w <= 0.001) continue;
      float d = distance(wp.xz, uMute[i].xy) + (vnoise(wp.xz * 0.21) - 0.5) * 7.0 + sin(uTimeF * 0.7 + wp.x * 0.05) * 0.8;
      float m = (1.0 - smoothstep(uMute[i].z - 5.0, uMute[i].z, d)) * uMute[i].w;
      float g = luma(col);
      // Not plain grey: a cold duotone, indigo in the shade and silver where light still falls.
      vec3 duo = mix(vec3(0.6, 0.67, 0.96), vec3(0.95, 0.97, 1.0), smoothstep(0.0, 1.4, g)) * g * 1.12;
      col = mix(col, duo, m * 0.92);
      float rim = exp(-sq((d - uMute[i].z) / 1.6)) * uMute[i].w;
      col += vec3(1.0, 0.72, 0.35) * rim * (0.05 + g * 0.5);
    }
  }
  if (uVolInfo.x > 0.5) {
    vec4 v = volumetric(dist);
    vec4 far = vec4(0.0, 0.0, 0.0, 1.0);
    if (!sky && dist > uVolInfo.y) far = fogBetween(uCamPos + rd * uVolInfo.y, rd, dist - uVolInfo.y, uSunDir, uSunColor);
    col = col * v.a * far.a + v.rgb + v.a * far.rgb;
  } else if (!sky) {
    vec4 f = fogBetween(uCamPos, rd, dist, uSunDir, uSunColor);
    col = col * f.a + f.rgb;
  }
  outColor = vec4(col, 1.0);
}`;
const TAA_PASS = /* glsl */ `
${COMMON}
${DEPTH_GLSL}
uniform sampler2D uCurrent;
uniform sampler2D uHistory;
uniform sampler2D uDepth;
uniform mat4 uPrevViewProj;
uniform vec2 uJitter;        // this frame's jitter in uv units
uniform vec2 uRenderSize;
uniform vec2 uOutSize;
uniform float uBlend;
uniform float uReset;

vec3 toYCoCg(vec3 c) { return vec3(0.25 * c.r + 0.5 * c.g + 0.25 * c.b, 0.5 * c.r - 0.5 * c.b, -0.25 * c.r + 0.5 * c.g - 0.25 * c.b); }
vec3 fromYCoCg(vec3 c) { return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }
// Tonemapped space keeps bright pixels from dominating the neighbourhood statistics.
vec3 squash(vec3 c) { return c / (1.0 + luma(c)); }
vec3 expand(vec3 c) { return c / max(1.0 - luma(c), 1e-4); }

vec3 historyCatmullRom(vec2 uv) {
  vec2 pos = uv * uOutSize;
  vec2 tc = floor(pos - 0.5) + 0.5;
  vec2 f = pos - tc;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 t0 = (tc - 1.0) / uOutSize, t3 = (tc + 2.0) / uOutSize, t12 = (tc + w2 / w12) / uOutSize;
  vec3 c = textureLod(uHistory, vec2(t12.x, t0.y), 0.0).rgb * (w12.x * w0.y)
         + textureLod(uHistory, vec2(t0.x, t12.y), 0.0).rgb * (w0.x * w12.y)
         + textureLod(uHistory, vec2(t12.x, t12.y), 0.0).rgb * (w12.x * w12.y)
         + textureLod(uHistory, vec2(t3.x, t12.y), 0.0).rgb * (w3.x * w12.y)
         + textureLod(uHistory, vec2(t12.x, t3.y), 0.0).rgb * (w12.x * w3.y);
  float wsum = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  return max(c / wsum, 0.0);
}

void main() {
  vec2 texel = 1.0 / uRenderSize;
  // The jittered frame is the stable image shifted by uJitter, so look it up there.
  vec2 cuv = vUv + uJitter;

  // Neighbourhood statistics and the closest depth in a 3x3 for sharper edges.
  vec3 m1 = vec3(0.0), m2 = vec3(0.0), cur = vec3(0.0);
  float bestD = -1.0; vec2 bestUv = cuv;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y)) * texel;
    vec3 c = toYCoCg(squash(textureLod(uCurrent, cuv + o, 0.0).rgb));
    m1 += c; m2 += c * c;
    if (x == 0 && y == 0) cur = c;
    float d = textureLod(uDepth, cuv + o, 0.0).r;
#ifdef REVERSED_DEPTH
    if (d > bestD) { bestD = d; bestUv = cuv + o; }
#else
    if (bestD < 0.0 || d < bestD) { bestD = d; bestUv = cuv + o; }
#endif
  }
  m1 /= 9.0; m2 /= 9.0;
  vec3 sigma = sqrt(max(m2 - m1 * m1, 0.0));

  // Reproject with camera motion only.
  vec2 huv = vUv;
  if (!isSky(bestD)) {
    vec3 wp = worldFromView(viewPosFromDepth(bestUv, bestD));
    vec4 pc = uPrevViewProj * vec4(wp, 1.0);
    huv = vUv + (pc.xy / pc.w * 0.5 + 0.5 - (bestUv - uJitter));
  } else {
    vec4 v = uProjInv * vec4(cuv * 2.0 - 1.0, 0.5, 1.0);
    vec3 dir = normalize((uCamWorld * vec4(normalize(v.xyz / v.w), 0.0)).xyz);
    vec4 pc = uPrevViewProj * vec4(dir, 0.0);
    huv = pc.xy / pc.w * 0.5 + 0.5;
  }
  bool offscreen = huv.x < 0.0 || huv.x > 1.0 || huv.y < 0.0 || huv.y > 1.0;
  vec3 hist = toYCoCg(squash(historyCatmullRom(huv)));
  // Variance clip of the history toward the current neighbourhood.
  vec3 lo = m1 - sigma * 1.25, hi = m1 + sigma * 1.25;
  vec3 clipped = clamp(hist, lo, hi);
  float blend = (offscreen || uReset > 0.5) ? 1.0 : uBlend;
  vec3 res = mix(clipped, cur, blend);
  outColor = vec4(max(expand(fromYCoCg(res)), 0.0), 1.0);
}`;

const BLOOM_DOWN = /* glsl */ `
${COMMON}
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uFirst;
vec3 karis(vec3 c) { return c / (1.0 + luma(c)); }
void main() {
  vec2 t = uTexel;
  vec3 a = textureLod(uTex, vUv + t * vec2(-2, 2), 0.0).rgb, b = textureLod(uTex, vUv + t * vec2(0, 2), 0.0).rgb, c = textureLod(uTex, vUv + t * vec2(2, 2), 0.0).rgb;
  vec3 d = textureLod(uTex, vUv + t * vec2(-2, 0), 0.0).rgb, e = textureLod(uTex, vUv, 0.0).rgb, f = textureLod(uTex, vUv + t * vec2(2, 0), 0.0).rgb;
  vec3 g = textureLod(uTex, vUv + t * vec2(-2, -2), 0.0).rgb, h = textureLod(uTex, vUv + t * vec2(0, -2), 0.0).rgb, i = textureLod(uTex, vUv + t * vec2(2, -2), 0.0).rgb;
  vec3 j = textureLod(uTex, vUv + t * vec2(-1, 1), 0.0).rgb, k = textureLod(uTex, vUv + t * vec2(1, 1), 0.0).rgb;
  vec3 l = textureLod(uTex, vUv + t * vec2(-1, -1), 0.0).rgb, m = textureLod(uTex, vUv + t * vec2(1, -1), 0.0).rgb;
  vec3 col;
  if (uFirst > 0.5) {
    // Karis average on the first step stops single hot pixels from flickering.
    vec3 g0 = (a + b + d + e) * 0.25, g1 = (b + c + e + f) * 0.25, g2 = (d + e + g + h) * 0.25, g3 = (e + f + h + i) * 0.25, g4 = (j + k + l + m) * 0.25;
    float w0 = 1.0 / (1.0 + luma(g0)), w1 = 1.0 / (1.0 + luma(g1)), w2 = 1.0 / (1.0 + luma(g2)), w3 = 1.0 / (1.0 + luma(g3)), w4 = 1.0 / (1.0 + luma(g4));
    col = (g0 * w0 * 0.125 + g1 * w1 * 0.125 + g2 * w2 * 0.125 + g3 * w3 * 0.125 + g4 * w4 * 0.5) / (0.125 * (w0 + w1 + w2 + w3) + 0.5 * w4);
  } else {
    col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  outColor = vec4(max(col, 0.0), 1.0);
}`;

const BLOOM_UP = /* glsl */ `
uniform sampler2D uTex;      // smaller mip being upsampled
uniform sampler2D uBase;     // this level's downsampled image
uniform vec2 uTexel;
uniform float uRadius;
void main() {
  vec2 t = uTexel * uRadius;
  vec3 s = textureLod(uTex, vUv + vec2(-t.x, t.y), 0.0).rgb + textureLod(uTex, vUv + vec2(t.x, t.y), 0.0).rgb
         + textureLod(uTex, vUv + vec2(-t.x, -t.y), 0.0).rgb + textureLod(uTex, vUv + vec2(t.x, -t.y), 0.0).rgb;
  s += 2.0 * (textureLod(uTex, vUv + vec2(0.0, t.y), 0.0).rgb + textureLod(uTex, vUv + vec2(0.0, -t.y), 0.0).rgb
            + textureLod(uTex, vUv + vec2(t.x, 0.0), 0.0).rgb + textureLod(uTex, vUv + vec2(-t.x, 0.0), 0.0).rgb);
  s += 4.0 * textureLod(uTex, vUv, 0.0).rgb;
  outColor = vec4(textureLod(uBase, vUv, 0.0).rgb + s / 16.0, 1.0);
}`;

// Scalable ambient obscurance (after McGuire et al.), at half resolution. Normals are
// rebuilt from depth, samples follow a rotated spiral, and TAA averages the noise away.
const AO_PASS = /* glsl */ `
${COMMON}
${DEPTH_GLSL}
uniform sampler2D uDepth;
uniform vec2 uTexel;
uniform float uProjScale;
uniform float uFrame;
uniform float uRadius;
const int N = 10;
vec3 vpos(vec2 uv) { float d = textureLod(uDepth, uv, 0.0).r; return viewPosFromDepth(uv, isSky(d) ? 1e-6 : d); }
void main() {
  float d = textureLod(uDepth, vUv, 0.0).r;
  if (isSky(d)) { outColor = vec4(1.0); return; }
  vec3 P = viewPosFromDepth(vUv, d);
  vec3 r = vpos(vUv + vec2(uTexel.x, 0.0)) - P, l = P - vpos(vUv - vec2(uTexel.x, 0.0));
  vec3 u = vpos(vUv + vec2(0.0, uTexel.y)) - P, dn = P - vpos(vUv - vec2(0.0, uTexel.y));
  vec3 dx = abs(r.z) < abs(l.z) ? r : l, dy = abs(u.z) < abs(dn.z) ? u : dn;
  vec3 n = normalize(cross(dx, dy));
  float dist = -P.z;
  float R = uRadius * (1.0 + dist * 0.025);
  float rpx = R * uProjScale / max(dist, 0.1);
  if (rpx < 1.5) { outColor = vec4(1.0); return; }
  rpx = min(rpx, 90.0);
  float phi = ign(gl_FragCoord.xy + uFrame * 5.588) * 6.2831853;
  float sum = 0.0, R2 = R * R;
  for (int i = 0; i < N; i++) {
    float a = (float(i) + 0.5) / float(N);
    float ang = a * 43.98 + phi;
    vec3 Q = vpos(vUv + vec2(cos(ang), sin(ang)) * a * rpx * uTexel);
    vec3 v = Q - P;
    float vv = dot(v, v), vn = dot(v, n);
    float f = max(R2 - vv, 0.0);
    sum += f * f * f * max((vn - 0.012 * dist - 0.02) / (0.01 + vv), 0.0);
  }
  float ao = max(0.0, 1.0 - sum * 5.0 / (R2 * R2 * R2 * float(N)) * 1.15);
  outColor = vec4(ao);
}`;

export class AoPass {
  constructor(pipe) {
    this.pipe = pipe; this.enabled = true; this.radius = 1.3;
    this.pass = new FullscreenPass({
      fragment: AO_PASS, defines: pipe.depthDefines,
      uniforms: { ...pipe.camUniforms, uDepth: { value: null }, uTexel: { value: new THREE.Vector2() }, uProjScale: { value: 1 }, uFrame: pipe.globals.uFrame, uRadius: { value: this.radius } },
    });
  }
  setSize(rw, rh) {
    this.target?.dispose();
    this.target = makeTarget(Math.ceil(rw / 2), Math.ceil(rh / 2), { type: THREE.UnsignedByteType, format: THREE.RedFormat });
    this.pass.uniforms.uTexel.value.set(1 / rw, 1 / rh);
    this.rh = rh;
  }
  render(renderer, depth, camera) {
    const u = this.pass.uniforms;
    u.uDepth.value = depth; u.uRadius.value = this.radius;
    u.uProjScale.value = 0.5 * this.rh * camera.projectionMatrix.elements[5];
    this.pass.render(renderer, this.target);
    return this.target.texture;
  }
}

export class FogPass {
  constructor(pipe) {
    const g = pipe.globals;
    this.haze = new THREE.Vector4(1.0e-4, 900, 0.085, 0);
    this.mist = new THREE.Vector4(3.0e-4, 85, 2, 0);
    this.mute = [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()];
    this.uniforms = { uHaze: { value: this.haze }, uMist: { value: this.mist } };
    this.pass = new FullscreenPass({
      fragment: FOG_PASS,
      defines: pipe.depthDefines,
      uniforms: {
        uColor: { value: null }, uDepth: { value: null }, uVol: { value: null }, uVolInfo: { value: new THREE.Vector3() }, uVolSize: { value: new THREE.Vector2(1, 1) },
        uMute: { value: this.mute }, uTimeF: g.uTime, uAo: { value: null }, uAoStrength: { value: 0 },
        ...pipe.camUniforms, ...pipe.sky.uniforms, ...this.uniforms, uSunDir: g.uSunDir, uSunColor: g.uSunColor, uSH: g.uSH,
      },
    });
  }
  render(renderer, color, depth, target, vol = null, volMax = 0, ao = null) {
    const u = this.pass.uniforms;
    u.uAo.value = ao; u.uAoStrength.value = ao ? this.aoStrength ?? 0.9 : 0;
    u.uColor.value = color;
    u.uDepth.value = depth;
    u.uVol.value = vol;
    u.uVolInfo.value.set(vol ? 1 : 0, volMax, 0);
    if (vol) u.uVolSize.value.set(vol.image.width, vol.image.height);
    this.pass.render(renderer, target);
  }
}

const HALTON = Array.from({ length: 16 }, (_, i) => {
  const h = (b) => { let f = 1, r = 0, n = i + 1; while (n > 0) { f /= b; r += f * (n % b); n = Math.floor(n / b); } return r; };
  return [h(2) - 0.5, h(3) - 0.5];
});

export class TAAPass {
  constructor(pipe) {
    this.pipe = pipe;
    this.prevViewProj = new THREE.Matrix4();
    this.jitter = new THREE.Vector2();
    this.index = 0;
    this.reset = true;
    this.enabled = true;
    this.pass = new FullscreenPass({
      fragment: TAA_PASS,
      defines: pipe.depthDefines,
      uniforms: {
        uCurrent: { value: null }, uHistory: { value: null }, uDepth: { value: null }, ...pipe.camUniforms,
        uPrevViewProj: { value: this.prevViewProj }, uJitter: { value: this.jitter },
        uRenderSize: { value: new THREE.Vector2() }, uOutSize: { value: new THREE.Vector2() }, uBlend: { value: 0.1 }, uReset: { value: 1 },
      },
    });
  }
  setSize(w, h) {
    this.history?.forEach((t) => t.dispose());
    this.history = [makeTarget(w, h), makeTarget(w, h)];
    this.pass.uniforms.uOutSize.value.set(w, h);
    this.reset = true;
  }
  // Offsets the projection by a sub-pixel amount. Call after camera.updateProjectionMatrix().
  applyJitter(camera, rw, rh) {
    if (!this.enabled) { this.jitter.set(0, 0); return; }
    const [jx, jy] = HALTON[this.index = (this.index + 1) % HALTON.length];
    const e = camera.projectionMatrix.elements;
    e[8] += (jx * 2) / rw; e[9] += (jy * 2) / rh;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    // Clip-space x = P00 * x + P02 * z with z negative in front, so content shifts by -jx.
    this.jitter.set(-jx / rw, -jy / rh);
  }
  render(renderer, current, depth, rw, rh) {
    const u = this.pass.uniforms;
    const [a, b] = this.history;
    u.uCurrent.value = current; u.uDepth.value = depth; u.uHistory.value = a.texture;
    u.uRenderSize.value.set(rw, rh);
    u.uReset.value = this.reset ? 1 : 0;
    this.pass.render(renderer, b);
    this.history = [b, a];
    this.reset = false;
    return b.texture;
  }
}

export class BloomPass {
  constructor() {
    this.levels = 6;
    this.down = new FullscreenPass({ fragment: BLOOM_DOWN, uniforms: { uTex: { value: null }, uTexel: { value: new THREE.Vector2() }, uFirst: { value: 0 } } });
    this.up = new FullscreenPass({ fragment: BLOOM_UP, uniforms: { uTex: { value: null }, uBase: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1 } } });
  }
  setSize(w, h) {
    this.mips?.forEach((t) => t.dispose());
    this.ups?.forEach((t) => t.dispose());
    this.mips = []; this.ups = [];
    for (let i = 0; i < this.levels; i++) {
      w = Math.max(2, Math.floor(w / 2)); h = Math.max(2, Math.floor(h / 2));
      this.mips.push(makeTarget(w, h));
      this.ups.push(makeTarget(w, h));
    }
  }
  render(renderer, source) {
    let src = source, sw = source.image?.width, sh = source.image?.height;
    for (let i = 0; i < this.levels; i++) {
      const dst = this.mips[i];
      this.down.uniforms.uTex.value = src;
      this.down.uniforms.uTexel.value.set(0.5 / dst.width, 0.5 / dst.height);
      this.down.uniforms.uFirst.value = i === 0 ? 1 : 0;
      this.down.render(renderer, dst);
      src = dst.texture;
    }
    let acc = this.mips[this.levels - 1].texture;
    for (let i = this.levels - 2; i >= 0; i--) {
      const dst = this.ups[i];
      this.up.uniforms.uTex.value = acc;
      this.up.uniforms.uBase.value = this.mips[i].texture;
      this.up.uniforms.uTexel.value.set(1 / dst.width, 1 / dst.height);
      this.up.render(renderer, dst);
      acc = dst.texture;
    }
    return acc;
  }
}
