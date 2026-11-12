// Shared surface lighting. Every lit material in the scene calls shadeSurface() so the
// sun, sky ambient, reflections and shadows stay consistent everywhere.
// Requires COMMON, SKYMAP, SKY_SAMPLE, SH_GLSL and TERRAIN_SAMPLING to be included first.
import { SHADOW_GLSL } from './shadows.js';

export const LIGHTING = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;     // sun irradiance at ground level
uniform float uBounce;
${SHADOW_GLSL}
uniform sampler2D uWeatherTex;
uniform vec4 uCloudShadow;  // xy: drift offset (m), z: threshold, w: strength

// Slow patches of cloud shade drifting over the land.
float cloudShadow(vec3 p) {
  vec2 q = p.xz + uSunDir.xz * ((4300.0 - p.y) / max(uSunDir.y, 0.08)) + uCloudShadow.xy;
  float w = textureLod(uWeatherTex, q / 9000.0, 0.0).r;
  return 1.0 - uCloudShadow.w * smoothstep(uCloudShadow.z, uCloudShadow.z + 0.2, w);
}
// Sun visibility at a world position: terrain, objects and clouds combined.
float sunVisibility(vec3 p) { return terrainSunVis(p) * objectShadow(p) * cloudShadow(p); }

// Sunlight thrown back by lit cliff walls and ground. The sky probe cannot know about it, so
// faces turned away from the sun get a warm fill, strongest on walls and weaker on floors.
vec3 bounceLight(vec3 N) {
  vec2 lh = normalize(uSunDir.xz);
  float away = saturate(0.4 - 0.6 * dot(N.xz, lh));
  return uSunColor * (uBounce * away * (1.0 - 0.35 * saturate(N.y)));
}

vec3 envBRDF(vec3 F0, float rough, float ndv) {
  vec4 r = rough * vec4(-1.0, -0.0275, -0.572, 0.022) + vec4(1.0, 0.0425, 1.04, -0.04);
  float a004 = min(r.x * r.x, exp2(-9.28 * ndv)) * r.x + r.y;
  vec2 ab = vec2(-1.04, 1.04) * a004 + r.zw;
  return F0 * ab.x + ab.y;
}

// translucency: 0 for solid surfaces, up to 1 for thin leaves and petals.
vec3 shadeSurface(vec3 albedo, float rough, float metal, vec3 N, vec3 V, float sunVis, float ao, float translucency) {
  vec3 L = uSunDir, H = normalize(V + L);
  float ndl = saturate(dot(N, L)), ndv = max(dot(N, V), 1e-3), ndh = saturate(dot(N, H)), vdh = saturate(dot(V, H));
  vec3 F0 = mix(vec3(0.04), albedo, metal);
  float a = rough * rough, a2 = a * a;
  float D = a2 / (PI * sq(ndh * ndh * (a2 - 1.0) + 1.0));
  float k = sq(rough + 1.0) * 0.125;
  float G = (ndl / (ndl * (1.0 - k) + k)) * (ndv / (ndv * (1.0 - k) + k));
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - vdh, 5.0);
  vec3 spec = min(D * G / max(4.0 * ndl * ndv, 1e-3), 60.0) * F;
  vec3 kd = (1.0 - F) * (1.0 - metal);
  vec3 col = (kd * albedo * 0.3183 + spec) * uSunColor * ndl * sunVis;
  // Light passing through thin foliage when the sun is behind it.
  if (translucency > 0.0) {
    float back = saturate(dot(-N, L)) * 0.6 + pow(saturate(dot(-V, L)), 4.0) * 0.8;
    col += albedo * uSunColor * 0.3183 * back * translucency * sunVis;
  }
  // Sky ambient and environment reflection, with horizon fade for the specular part.
  vec3 R = reflect(-V, N);
  vec3 envS = sampleEnv(R, rough * 6.0) * envBRDF(F0, rough, ndv) * saturate(1.0 + dot(R, N));
  col += (kd * albedo * (shIrradiance(N) + bounceLight(N)) + envS * mix(1.0, ao, 0.7)) * ao;
  return col;
}
`;
