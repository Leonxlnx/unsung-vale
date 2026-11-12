// Shared GLSL chunks. Imported as strings and concatenated into shaders.

export const COMMON = /* glsl */ `
#define PI 3.14159265359
#define TAU 6.28318530718
#define saturate(x) clamp(x, 0.0, 1.0)

float remap(float v, float a, float b, float c, float d) { return c + (v - a) / (b - a) * (d - c); }
float remap01(float v, float a, float b) { return saturate((v - a) / (b - a)); }
float sq(float x) { return x * x; }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec3 hash32(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yzz) * p3.zyx); }
vec3 hash33(vec3 p3) { p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float vnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), u.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), u.x), u.y),
             mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), u.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), u.x), u.y), u.z);
}
float fbm2(vec2 p, int oct) {
  float a = 0.5, s = 0.0, n = 0.0;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < oct; i++) { s += a * vnoise(p); n += a; p = r * p * 2.03 + 17.1; a *= 0.5; }
  return s / n;
}
float fbm3(vec3 p, int oct) {
  float a = 0.5, s = 0.0, n = 0.0;
  for (int i = 0; i < oct; i++) { s += a * vnoise3(p); n += a; p = p * 2.02 + vec3(11.3, 5.7, 3.1); a *= 0.5; }
  return s / n;
}
// Interleaved gradient noise: good per-pixel dither for ray-march offsets.
float ign(vec2 px) { return fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715)))); }

vec3 srgbToLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 linearToSrgb(vec3 c) { c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
`;

// The sky panorama uses a warped latitude so most texels sit near the horizon,
// which is where cloud and haze detail matters.
export const SKYMAP = /* glsl */ `
const float SKY_POW = 1.7;
vec2 dirToSky(vec3 d) {
  float e = asin(clamp(d.y, -1.0, 1.0)) / 1.5707963;
  float t = sign(e) * pow(abs(e), 1.0 / SKY_POW);
  return vec2(atan(d.z, d.x) * 0.15915494 + 0.5, t * 0.5 + 0.5);
}
vec3 skyToDir(vec2 uv) {
  float t = uv.y * 2.0 - 1.0;
  float e = sign(t) * pow(abs(t), SKY_POW) * 1.5707963;
  float a = (uv.x - 0.5) * 6.2831853;
  return vec3(cos(e) * cos(a), sin(e), cos(e) * sin(a));
}
`;

export const ATMOSPHERE = /* glsl */ `
const float RG = 6360.0e3;
const float RT = 6460.0e3;
const vec3 BETA_R = vec3(5.802e-6, 13.558e-6, 33.1e-6);
const float BETA_M = 3.996e-6;
const float BETA_M_EXT = 4.44e-6;
const vec3 BETA_O = vec3(0.650e-6, 1.881e-6, 0.085e-6);
const float H_R = 8000.0;
const float H_M = 1200.0;

vec2 raySphere(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd), c = dot(ro, ro) - r * r, d = b * b - c;
  if (d < 0.0) return vec2(1e20, -1e20);
  d = sqrt(d);
  return vec2(-b - d, -b + d);
}
vec3 atmoDensity(float h) {
  h = max(h, 0.0);
  return vec3(exp(-h / H_R), exp(-h / H_M), max(0.0, 1.0 - abs(h - 25000.0) / 15000.0));
}
vec3 atmoExtinction(vec3 od) { return BETA_R * od.x + BETA_M_EXT * od.y + BETA_O * od.z; }

// Optical depth from p toward the sun, with samples packed near p where the air is dense.
vec3 sunOpticalDepth(vec3 p, vec3 L) {
  float tTop = raySphere(p, L, RT).y;
  vec3 od = vec3(0.0);
  float prev = 0.0;
  for (int i = 1; i <= 8; i++) {
    float f = float(i) / 8.0;
    float t = tTop * f * f;
    vec3 q = p + L * (0.5 * (t + prev));
    od += atmoDensity(length(q) - RG) * (t - prev);
    prev = t;
  }
  return od;
}
float phaseR(float mu) { return 0.0596831 * (1.0 + mu * mu); }
float phaseHG(float mu, float g) { float g2 = g * g; return 0.0795775 * (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5); }
`;
