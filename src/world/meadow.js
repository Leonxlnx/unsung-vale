// The meadow's colours and patches, shared by the grass blades and the ground under them, so
// that whatever shows between the blades is more grass and never a different surface.
// Both sides sample the same noise at the same scales (n1: 410 m, n2: 57 m, patch: 13 m).
// The patch noise breaks every lawn into areas a few strides across: lush here, dry there.
export const MEADOW_GLSL = /* glsl */ `
// 0 = lush, 1 = dry and golden. Broad drift across the mesa with patches a few strides wide.
float meadowFamily(vec4 n1, vec4 n2, float patchNoise) { return clamp(0.5 + (n1.a - 0.5) * 1.5 + (n2.a - 0.5) * 1.2 + (patchNoise - 0.5) * 1.3, 0.0, 1.0); }
// Low, dark, blue-green patches (clover and moss) scattered through the taller grass.
float meadowClover(float patchNoise) { return smoothstep(0.6, 0.7, patchNoise); }
// Light and dark through the sward: deeper, bluer green in the hollows of the pattern and
// paler, yellower growth between, whatever the family. a: metre-scale noise, b: ten-metre scale.
vec3 meadowShade(float a, float b) {
  return mix(vec3(0.7, 0.84, 0.8), vec3(1.32, 1.2, 0.86), smoothstep(0.34, 0.66, a * 0.55 + b * 0.45));
}
// Colour of a blade tip. r is a per-blade random pair; pass 0.5 for the average.
vec3 meadowTip(float fam, vec2 r) {
  vec3 lush = vec3(0.07, 0.19, 0.028), olive = vec3(0.15, 0.2, 0.045), gold = vec3(0.3, 0.26, 0.075);
  vec3 c = mix(lush, olive, smoothstep(0.3, 0.56, fam + (r.x - 0.5) * 0.34));
  return mix(c, gold, smoothstep(0.6, 0.86, fam + (r.y - 0.5) * 0.4) * 0.8);
}
`;
