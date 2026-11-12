// The hero's visual: loads the generated model, gives it the game's materials, and animates
// it procedurally from the player's state. Legs and the sword arm are solved by inverse
// kinematics: the feet are placed on the ground (a gait cycle when moving, single steps when
// standing or fighting) and the blade is led along designed cuts, with the body following.
// Spring physics move the cape, and a ribbon of light follows the edge through each cut.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { COMMON, SKYMAP } from '../engine/glsl.js';
import { SKY_SAMPLE, SH_GLSL } from '../engine/sky.js';
import { LIGHTING } from '../engine/lighting.js';
import { TERRAIN_SAMPLING } from '../world/terrain.js';
import { Rig, SpringChains } from './rig.js';
import { TUNE } from '../game/player.js';

const TAU = Math.PI * 2;
const ease = (t) => t * t * (3 - 2 * t);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => ease(clamp01((x - a) / (b - a)));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

const HERO_VERT = /* glsl */ `
#include <skinning_pars_vertex>
out vec3 vWorld; out vec3 vNormal; out vec3 vRest;
void main() {
  #include <skinbase_vertex>
  vec3 objectNormal = normal;
  #include <skinnormal_vertex>
  vec3 transformed = position;
  #include <skinning_vertex>
  vec4 w = modelMatrix * vec4(transformed, 1.0);
  vWorld = w.xyz; vNormal = normalize(mat3(modelMatrix) * objectNormal); vRest = position;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const HERO_DEPTH_VERT = /* glsl */ `
#include <skinning_pars_vertex>
void main() {
  #include <skinbase_vertex>
  vec3 transformed = position;
  #include <skinning_vertex>
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(transformed, 1.0);
}`;
export const HERO_FRAG = /* glsl */ `
${COMMON}
${SKYMAP}
${SKY_SAMPLE}
${SH_GLSL}
${TERRAIN_SAMPLING}
${LIGHTING}
uniform vec3 uAlbedo; uniform vec4 uSurf;   // rough, metal, sheen, emissive
uniform float uTime; uniform float uFlash;
in vec3 vWorld; in vec3 vNormal; in vec3 vRest;
void main() {
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vWorld);
  // Fine variation in rest space so it stays put as the body moves.
  float n = fbm3(vRest * 38.0, 3), n2 = vnoise3(vRest * 9.0);
  // Cloth is evenly dyed; metal and leather carry more wear.
  float grain = uSurf.z > 0.3 ? 0.05 : 0.12;
  vec3 alb = uAlbedo * (0.86 + 0.24 * n2) * (1.0 - grain + 2.0 * grain * n);
  float rough = clamp(uSurf.x + (n - 0.5) * 0.16, 0.06, 1.0);
  float vis = sunVisibility(vWorld + N * 0.03 + uSunDir * 0.06);
  vec3 col = shadeSurface(alb, rough, uSurf.y, N, V, vis, 0.9, 0.0);
  col += alb * (1.0 - 0.7 * uSurf.y) * lampLight(vWorld, N);
  float fres = pow(1.0 - saturate(dot(N, V)), 3.0);
  // Cloth catches the sky along its edges.
  col += alb * shIrradiance(N) * fres * uSurf.z * 2.0;
  // Thin cloth lets the low sun through: the cape glows when he stands against the light.
  col += alb * uSunColor * (0.3183 * 0.6 * saturate(dot(-N, uSunDir)) * vis * step(0.3, uSurf.z));
  // The blade carries its own light.
  col += uAlbedo * uSurf.w * (0.5 + 1.6 * fres + 0.15 * sin(uTime * 3.0 + vRest.y * 14.0));
  col += vec3(1.0, 0.9, 0.8) * uFlash;
  gl_FragColor = vec4(col, 1.0);
}`;

// The cut is drawn twice. A sheet in the plane the blade swept: brightest along the line the
// tip drew, thinning to nothing behind it, with fine lanes of light like brushed air. And a
// streak along the tip's path that always faces the camera, so the cut still reads when the
// sheet is seen edge-on. Both lay a little colour over what is behind them as well as adding
// light, which keeps them visible against sunlit stone.
const TRAIL_FRAG = /* glsl */ `
uniform float uGain;
in vec2 vUv;
float h1(float x) { return fract(sin(x * 127.1) * 43758.5453); }
void main() {
  float age = vUv.x, y = vUv.y, life = 1.0 - age;
  float edge = smoothstep(0.8, 0.96, y) * (1.0 - smoothstep(0.975, 1.0, y));
  float sheet = pow(y, 2.2);
  float lane = floor(y * 38.0), s = h1(lane);
  float streak = 0.5 + 0.5 * smoothstep(0.35, 0.6, fract(s * 9.0 + age * (0.5 + 1.5 * s)));
  float head = smoothstep(0.0, 0.05, age);
  float a = head * (edge * 1.6 * pow(life, 1.1) + sheet * streak * 0.8 * pow(life, 1.8));
  vec3 col = mix(vec3(1.0, 0.5, 0.16), vec3(1.0, 0.9, 0.7), clamp(pow(life, 1.5) * (0.3 + 0.7 * edge), 0.0, 1.0));
  gl_FragColor = vec4(col * a * uGain, clamp(a * 0.55, 0.0, 0.8));
}`;
const STREAK_FRAG = /* glsl */ `
uniform float uGain;
in vec2 vUv;
void main() {
  float age = vUv.x, x = (vUv.y - 0.5) * 2.0, life = 1.0 - age;
  float core = exp(-x * x * 9.0), halo = exp(-x * x * 2.2);
  float head = smoothstep(0.0, 0.04, age);
  float a = head * (core * 1.5 * pow(life, 1.3) + halo * 0.35 * pow(life, 2.0));
  vec3 col = mix(vec3(1.0, 0.55, 0.2), vec3(1.0, 0.95, 0.82), core * life);
  gl_FragColor = vec4(col * a * uGain, clamp(a * 0.5, 0.0, 0.85));
}`;

// name -> [albedo rgb, rough, metal, sheen, emissive]
const LOOKS = {
  armor: [[0.74, 0.73, 0.7], 0.34, 0.9, 0, 0], gold: [[1.0, 0.76, 0.36], 0.3, 1, 0, 0], cloth: [[0.03, 0.085, 0.105], 0.86, 0, 0.5, 0],
  cape: [[0.3, 0.028, 0.04], 0.82, 0, 0.55, 0], leather: [[0.075, 0.048, 0.032], 0.58, 0, 0.1, 0], mask: [[0.88, 0.86, 0.82], 0.24, 0, 0, 0],
  blade: [[0.55, 0.9, 1.0], 0.12, 0.3, 0, 1.2], undersuit: [[0.022, 0.022, 0.028], 0.7, 0, 0.2, 0],
};

// --- gait -----------------------------------------------------------------------------
// Seconds for one full cycle (two steps) at a given ground speed.
const CYCLE = [[0, 1.3], [1.0, 1.12], [1.8, 0.98], [3.2, 0.78], [5.4, 0.66], [8.0, 0.54], [12, 0.5]];
function cycleTime(v) {
  for (let i = 1; i < CYCLE.length; i++) if (v <= CYCLE[i][0]) { const [a, ta] = CYCLE[i - 1], [b, tb] = CYCLE[i]; return lerp(ta, tb, (v - a) / (b - a)); }
  return 0.5;
}
// Rest positions of the foot's joints in the character's space (x left, y up, z forward).
// (The heights are read from the model when it loads.)
const ANKLE = [0.112, 0.085, -0.012];
let HIP_Y = 0.985;
// How the ankle moves when the foot rolls: onto the ball (pitch > 0, heel up) or the heel.
function footRoll(pitch) {
  const py = ANKLE[1], pz = pitch > 0 ? -0.137 : 0.058, c = Math.cos(pitch), s = Math.sin(pitch);
  return [py * c - pz * s - py, py * s + pz * c - pz];        // [dy, dz]
}

// --- sword poses ----------------------------------------------------------------------
// The sword is described in the upper body's own space: origin at the chest joint, axes
// turning with the chest. g = where the hand grips, d = where the blade points.
const SW = {
  idle: { g: [-0.27, -0.33, 0.14], d: [-0.12, -0.5, 0.85] },
  run: { g: [-0.31, -0.24, -0.04], d: [-0.22, -0.74, -0.63] },
  sprint: { g: [-0.34, -0.2, -0.12], d: [-0.32, -0.4, -0.86] },
  guard: { g: [-0.2, -0.14, 0.32], d: [0.2, 0.62, 0.76] },
  air: { g: [-0.4, -0.06, 0.06], d: [-0.45, 0.35, -0.82] },
  tune: { g: [-0.1, 0.42, 0.24], d: [0.03, 1, 0.06] },
  plant: { g: [-0.03, -0.04, 0.34], d: [0.0, -1, 0.07] },
  dive: { g: [-0.04, 0.16, 0.22], d: [0.0, -0.98, 0.2] },
  coil: { g: [-0.08, 0.5, -0.06], d: [-0.05, 0.7, -0.7] },
  // Riding a string: the blade laid across it overhead, one hand on the grip, one on the flat.
  ride: { g: [-0.31, 0.7, 0.1], d: [1, 0.02, 0] },
};
// The scabbard hangs from the belt on the left hip, pointing down, back and a little out.
const SCAB_DIR = new THREE.Vector3(0.22, -0.78, -0.58).normalize();
const SCAB = { pos: new THREE.Vector3(0.192, 0, 0.05).addScaledVector(SCAB_DIR, -0.03), q: new THREE.Quaternion(), grip: new THREE.Vector3() };
const SHOULDER_R = new THREE.Vector3(-0.18, 0.215, 0), ELBOW_HINT = new THREE.Vector3(-0.1, -0.24, -0.08);
const _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3(), _bm = new THREE.Matrix4();
// Orientation of the sword (blade along its y, flat facing its z) from a blade direction and
// a hint for the flat's normal.
function swordQ(d, n, out) {
  _by.set(d[0], d[1], d[2]).normalize();
  _bz.set(n[0], n[1], n[2]).addScaledVector(_by, -(n[0] * _by.x + n[1] * _by.y + n[2] * _by.z));
  if (_bz.lengthSq() < 1e-6) _bz.set(1, 0, 0).addScaledVector(_by, -_by.x);
  _bz.normalize(); _bx.crossVectors(_by, _bz);
  return out.setFromRotationMatrix(_bm.makeBasis(_bx, _by, _bz));
}
// The flat a relaxed wrist gives: square to both forearm and blade.
function naturalFlat(g, d) {
  const f = _bx.set(g[0], g[1], g[2]).sub(SHOULDER_R).sub(ELBOW_HINT).normalize();
  const n = _bz.crossVectors(f, _by.set(d[0], d[1], d[2]).normalize());
  return n.lengthSq() < 1e-4 ? [-1, 0, 0] : n.normalize().toArray();
}
swordQ(SCAB_DIR.toArray(), [0.935, 0, 0.355], SCAB.q);
SCAB.grip.set(0, -0.045, 0).applyQuaternion(SCAB.q).add(SCAB.pos);
for (const s of Object.values(SW)) { s.n = naturalFlat(s.g, s.d); s.q = swordQ(s.d, s.n, new THREE.Quaternion()); s.gv = new THREE.Vector3(...s.g); }

// --- attacks --------------------------------------------------------------------------
// Each strike is a short list of keys: t in seconds, sw = [grip xyz, blade dir xyz] in the
// upper body's space, hips / chest = [pitch, yaw, roll] (positive yaw turns left), pel = the
// pelvis offset, L / R = where each foot wants to stand [x, z, yaw, lift], la = left arm
// [swing, out, elbow], two = left hand on the grip, spin = whole turns of the body, lock =
// feet carried with the body instead of planted on the ground.
const Z3 = [0, 0, 0];
const STAND = { L: [0.13, 0.03, 0.14, 0], R: [-0.13, -0.03, -0.14, 0] };
const FIGHT = { L: [0.14, 0.2, 0.1, 0], R: [-0.16, -0.2, -0.5, 0] };
const KNEEL = { L: [0.15, 0.24, 0.05, 0], R: [-0.14, -0.36, -0.1, 0] };
const ATTACKS = [
  // 1: a wide cut from behind the right shoulder round to the left, stepping in with the
  // right foot. Seen from behind, the blade comes round the right side and across the front.
  { keys: [
    { t: 0.1, sw: [-0.42, 0.2, 0.02, -0.9, 0.42, 0.05], hips: [-0.03, -0.28, 0], chest: [-0.08, -0.47, 0.1], pel: [-0.04, -0.06, -0.05], L: [0.14, 0.16, 0.1, 0], R: [-0.18, -0.2, -0.55, 0], la: [-0.1, 0.05, 0.5] },
    { t: 0.145, sw: [-0.43, 0.21, 0, -0.9, 0.4, -0.02], hips: [-0.04, -0.3, 0], chest: [-0.1, -0.52, 0.1], pel: [-0.04, -0.07, -0.06], L: [0.14, 0.16, 0.1, 0], R: [-0.18, -0.2, -0.55, 0], la: [-0.15, 0.05, 0.5] },
    { t: 0.205, sw: [-0.3, 0.06, 0.42, -0.5, 0.15, 0.85], hips: [0.06, 0.0, 0], chest: [0.1, 0.05, 0], pel: [0, -0.08, 0.08], L: [0.15, -0.08, 0.25, 0], R: [-0.13, 0.34, -0.1, 0.06], la: [0.2, 0.15, 0.55] },
    { t: 0.265, sw: [-0.14, -0.14, 0.46, -0.15, -0.3, 0.92], hips: [0.1, 0.4, -0.02], chest: [0.22, 0.75, -0.1], pel: [0.03, -0.1, 0.13], L: [0.16, -0.24, 0.4, 0], R: [-0.12, 0.4, -0.05, 0], la: [0.55, 0.3, 0.6] },
    { t: 0.34, sw: [-0.1, -0.18, 0.42, 0.16, -0.28, 0.93], hips: [0.1, 0.44, -0.02], chest: [0.22, 0.85, -0.1], pel: [0.03, -0.11, 0.14], L: [0.16, -0.24, 0.4, 0], R: [-0.12, 0.4, -0.05, 0], la: [0.6, 0.3, 0.6] },
    { t: 0.46, sw: [-0.16, -0.2, 0.34, 0.3, -0.1, 0.95], hips: [0.05, 0.2, 0], chest: [0.08, 0.4, -0.03], pel: [0, -0.07, 0.07], L: [0.16, -0.22, 0.4, 0], R: [-0.12, 0.34, -0.05, 0], la: [0.3, 0.2, 0.55] },
  ] },
  // 2: back the other way, rising from the left hip to high on the right, the left foot
  // passing forward.
  { keys: [
    { t: 0.09, sw: [0.02, -0.12, 0.38, 0.77, -0.35, 0.51], hips: [0.06, 0.45, 0], chest: [0.1, 0.85, -0.06], pel: [0.03, -0.09, 0.06], L: [0.16, -0.24, 0.42, 0], R: [-0.12, 0.38, -0.05, 0], la: [0.45, 0.3, 0.7] },
    { t: 0.135, sw: [0.03, -0.13, 0.37, 0.8, -0.36, 0.46], hips: [0.06, 0.48, 0], chest: [0.1, 0.9, -0.06], pel: [0.03, -0.09, 0.06], L: [0.16, -0.24, 0.42, 0], R: [-0.12, 0.38, -0.05, 0], la: [0.45, 0.3, 0.7] },
    { t: 0.19, sw: [-0.18, 0, 0.48, 0.3, 0, 0.95], hips: [0.06, 0.02, 0], chest: [0.08, 0.02, 0], pel: [0, -0.09, 0.1], L: [0.14, 0.3, 0.05, 0.06], R: [-0.15, -0.05, -0.3, 0], la: [0.0, 0.25, 0.6] },
    { t: 0.25, sw: [-0.42, 0.24, 0.2, -0.69, 0.5, 0.51], hips: [0.04, -0.4, 0], chest: [0.04, -0.75, 0.08], pel: [-0.02, -0.1, 0.13], L: [0.14, 0.4, 0.0, 0], R: [-0.17, -0.28, -0.62, 0], la: [-0.5, 0.3, 0.5] },
    { t: 0.33, sw: [-0.43, 0.3, 0.14, -0.67, 0.6, 0.43], hips: [0.04, -0.44, 0], chest: [0.02, -0.85, 0.08], pel: [-0.02, -0.11, 0.14], L: [0.14, 0.4, 0.0, 0], R: [-0.17, -0.28, -0.62, 0], la: [-0.6, 0.3, 0.5] },
    { t: 0.46, sw: [-0.3, -0.08, 0.3, -0.3, 0.25, 0.92], hips: [0.03, -0.2, 0], chest: [0.05, -0.4, 0], pel: [0, -0.07, 0.07], L: [0.14, 0.34, 0.0, 0], R: [-0.17, -0.24, -0.6, 0], la: [-0.3, 0.2, 0.5] },
  ] },
  // 3: a full turn with the blade held out, landing in a low cut across the front.
  { spin: [0.15, 0.43], keys: [
    { t: 0.14, sw: [-0.43, 0.06, 0.1, -0.92, 0.12, 0.3], hips: [0.06, -0.5, 0], chest: [0.1, -0.9, 0.05], pel: [-0.02, -0.18, 0.0], L: [0.14, 0.3, 0.0, 0], R: [-0.17, -0.24, -0.6, 0], la: [0.3, 0.3, 0.7] },
    { t: 0.2, sw: [-0.43, 0.06, 0.1, -0.93, 0.1, 0.32], hips: [0.06, -0.45, 0], chest: [0.1, -0.8, 0.05], pel: [-0.02, -0.14, 0.0], L: [0.13, 0.1, 0, 0.02], R: [-0.13, -0.1, 0, 0.04], la: [0.2, 0.5, 0.6], lock: 1 },
    { t: 0.31, sw: [-0.43, 0.08, 0.14, -0.9, 0.14, 0.4], hips: [0.02, -0.1, 0], chest: [0.04, -0.2, 0], pel: [0, 0.05, 0.04], L: [0.12, 0.06, 0, 0.12], R: [-0.12, -0.08, 0, 0.18], la: [-0.2, 0.7, 0.4], lock: 1 },
    { t: 0.42, sw: [-0.24, -0.08, 0.44, -0.3, -0.2, 0.93], hips: [0.1, 0.25, 0], chest: [0.16, 0.5, -0.05], pel: [0.02, -0.12, 0.12], L: [0.17, -0.26, 0.4, 0.02], R: [-0.13, 0.42, -0.05, 0.03], la: [-0.5, 0.5, 0.5], lock: 0.5 },
    { t: 0.5, sw: [-0.14, -0.16, 0.46, -0.1, -0.26, 0.95], hips: [0.14, 0.38, 0], chest: [0.22, 0.75, -0.06], pel: [0.02, -0.18, 0.16], L: [0.17, -0.28, 0.42, 0], R: [-0.13, 0.44, -0.05, 0], la: [-0.6, 0.4, 0.5] },
    { t: 0.7, sw: [-0.16, -0.2, 0.34, 0.2, -0.1, 0.97], hips: [0.05, 0.18, 0], chest: [0.08, 0.34, -0.03], pel: [0, -0.08, 0.08], L: [0.16, -0.24, 0.4, 0], R: [-0.12, 0.34, -0.05, 0], la: [0.2, 0.2, 0.55] },
  ] },
  // Heavy: both hands, a leap, and the blade brought down from overhead into the ground.
  { keys: [
    { t: 0.18, sw: [-0.1, 0.56, -0.1, -0.04, 0.6, -0.8], hips: [-0.1, 0, 0], chest: [-0.28, 0, 0], pel: [0, -0.2, -0.08], L: [0.15, 0.12, 0.1, 0], R: [-0.16, -0.2, -0.35, 0], two: 1 },
    { t: 0.26, sw: [-0.09, 0.6, -0.04, -0.02, 0.8, -0.6], hips: [-0.12, 0, 0], chest: [-0.3, 0, 0], pel: [0, 0.06, 0.02], L: [0.13, 0.2, 0, 0.16], R: [-0.13, -0.16, -0.1, 0.24], two: 1, lock: 1 },
    { t: 0.31, sw: [-0.08, 0.56, 0.12, 0, 0.96, -0.28], hips: [-0.06, 0, 0], chest: [-0.18, 0, 0], pel: [0, 0.14, 0.1], L: [0.13, 0.0, 0.1, 0.2], R: [-0.13, 0.26, 0, 0.26], two: 1, lock: 1 },
    { t: 0.37, sw: [-0.07, 0.14, 0.5, 0, 0.5, 0.87], hips: [0.16, 0, 0], chest: [0.3, 0, 0], pel: [0, -0.08, 0.18], L: [0.16, -0.3, 0.3, 0.05], R: [-0.13, 0.46, 0, 0.05], two: 1, lock: 0.6 },
    { t: 0.43, sw: [-0.07, -0.12, 0.5, 0.02, 0.34, 0.94], hips: [0.3, 0, 0], chest: [0.5, 0, 0], pel: [0, -0.3, 0.24], L: [0.17, -0.4, 0.3, 0], R: [-0.13, 0.48, 0, 0], two: 1 },
    { t: 0.6, sw: [-0.07, -0.13, 0.49, 0.02, 0.31, 0.95], hips: [0.3, 0, 0], chest: [0.48, 0, 0], pel: [0, -0.32, 0.24], L: [0.17, -0.4, 0.3, 0], R: [-0.13, 0.48, 0, 0], two: 1 },
    { t: 0.86, sw: [-0.16, -0.2, 0.34, 0.1, -0.1, 0.99], hips: [0.08, 0.1, 0], chest: [0.12, 0.2, 0], pel: [0, -0.1, 0.1], L: [0.16, -0.26, 0.4, 0], R: [-0.12, 0.36, -0.05, 0], two: 0.3 },
  ] },
];
// The flat of the blade at each key is the one a relaxed wrist gives there (forearm along the
// edge), kept from flipping between neighbouring keys.
for (const { keys } of ATTACKS) {
  let prev = null;
  for (const k of keys) {
    const n = new THREE.Vector3(...naturalFlat(k.sw, k.sw.slice(3)));
    if (prev && n.dot(prev) < -0.6) n.negate();
    prev = n.clone();
    k.g = new THREE.Vector3(k.sw[0], k.sw[1], k.sw[2]);
    k.q = swordQ(k.sw.slice(3), n.toArray(), new THREE.Quaternion());
  }
}
const _v0 = new THREE.Vector3(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q0 = new THREE.Quaternion(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e0 = new THREE.Euler();
const YAXIS = new THREE.Vector3(0, 1, 0);

export class Hero {
  static async load(pipe, url = '/models/hero.glb') {
    const gltf = await new GLTFLoader().loadAsync(url);
    return new Hero(pipe, gltf.scene);
  }

  constructor(pipe, scene) {
    this.pipe = pipe; this.root = scene;
    this.flash = { value: 0 };
    const mats = {};
    const D = pipe.depthDefines;
    const mat = (name) => {
      const k = Object.keys(LOOKS).find((x) => name.toLowerCase().includes(x)) ?? 'armor';
      const [alb, rough, metal, sheen, em] = LOOKS[k];
      return (mats[k] ??= new THREE.ShaderMaterial({
        vertexShader: HERO_VERT, fragmentShader: HERO_FRAG, defines: D, side: THREE.DoubleSide,
        uniforms: { ...pipe.lit(), uAlbedo: { value: new THREE.Vector3(...alb) }, uSurf: { value: new THREE.Vector4(rough, metal, sheen, em) }, uFlash: this.flash },
      }));
    };
    const depth = new THREE.ShaderMaterial({ vertexShader: HERO_DEPTH_VERT, fragmentShader: 'void main() {}', colorWrite: false, side: THREE.DoubleSide });
    scene.traverse((o) => {
      if (!o.isMesh) return;
      o.material = Array.isArray(o.material) ? o.material.map((m) => mat(m.name)) : mat(o.material.name);
      o.frustumCulled = false;
      // Shadow twin: skinned meshes need their own bound copy in the shadow scene.
      const twin = o.isSkinnedMesh ? new THREE.SkinnedMesh(o.geometry, depth) : new THREE.Mesh(o.geometry, depth);
      if (o.isSkinnedMesh) twin.bind(o.skeleton, o.bindMatrix);
      twin.matrixAutoUpdate = false; twin.frustumCulled = false;
      pipe.shadows.scene.add(twin);
      pipe.shadows.twins.push([o, twin]);
    });
    pipe.scene.add(scene);
    this.bladeGlow = mats.blade?.uniforms.uSurf.value ?? null;

    this.rig = new Rig(scene);
    // Where the ankle and the hip joint sit when he simply stands.
    {
      const v = new THREE.Vector3(), foot = this.rig.get('Foot.L'), leg = this.rig.get('UpperLeg.L');
      scene.updateWorldMatrix(true, true);
      if (foot && leg) { ANKLE[1] = foot.getWorldPosition(v).y - scene.position.y; HIP_Y = leg.getWorldPosition(v).y - scene.position.y; }
    }
    const col = (c) => [1, 2, 3, 4, 5].map((i) => `Cape.${c}.${i}`);
    this.cloth = new SpringChains(this.rig, [col('L'), col('C'), col('R'), ['Tabard.F'], ['Tabard.B']], { drag: 0.2, stiffness: 1.2, gravity: 11 });
    this.sword = scene.getObjectByName('Sword');
    // What a relaxed wrist looks like: the forearm's direction as the hand sees it at rest.
    const R = this.rig, hand = R.bones.handr, fore = R.bones.lowerarmr;
    if (hand && fore && this.sword) {
      scene.updateWorldMatrix(true, true);
      const w = hand.bone.getWorldPosition(new THREE.Vector3()), e = fore.bone.getWorldPosition(new THREE.Vector3());
      this.foreLen = w.distanceTo(e);
      this.foreInHand = w.sub(e).normalize().applyQuaternion(hand.rest.clone().invert());
      // Middle of the grip, in the hand's space.
      this.gripInHand = new THREE.Vector3(0, -0.045, 0).applyQuaternion(this.sword.quaternion).add(this.sword.position);
    }
    this.time = 0; this.phase = 0; this.gait = 0; this.lean = 0; this.yawVel = 0; this.lastYaw = 0; this.accLean = 0;
    this.airBlend = 0; this.landSquash = 0; this.hurtK = 0; this.rollK = 0; this.deadK = 0; this.combat = 0; this.combatHold = 0; this.tuneK = 0;
    this.lastSpeed = 0; this.gy = { L: 0, R: 0 }; this.pelDrop = 0; this.headYaw = 0;
    this.feet = { L: this._foot(1), R: this._foot(-1) };
    this.swG = SW.idle.gv.clone(); this.swQ = SW.idle.q.clone();
    // The sword starts in its scabbard; it is drawn for a fight and put away after it.
    this.handBone = this.sword?.parent ?? null;
    this.swordInHand = this.sword ? { pos: this.sword.position.clone(), q: this.sword.quaternion.clone() } : null;
    this.sheathed = false; this.armFree = 0; this.drawnHold = 0; this.swimK = 0;
    if (this.sword) this._sheathe();
    this.atk = { w: 0, key: null, from: null, hips: [0, 0, 0], chest: [0, 0, 0], pel: [0, 0, 0], L: [...STAND.L], R: [...STAND.R], la: [0, 0, 0], two: 0, spin: 0, lock: 0 };
    this.uPos = new THREE.Vector3(); this.uQ = new THREE.Quaternion(); this.uPos0 = new THREE.Vector3(); this.uQ0 = new THREE.Quaternion(); this.uInit = false;
    this.tip = new THREE.Vector3(); this.tipVel = new THREE.Vector3();
    this._buildTrail();
  }

  _foot(side) { return { side, pos: new THREE.Vector3(), yaw: 0, step: -1, from: new THREE.Vector3(), fromYaw: 0, dur: 0.2, h: 0.06, lift: 0, init: false, stance: true }; }

  _buildTrail() {
    const N = 40;
    this.trailN = N; this.trailPts = [];       // { b, t, at }: blade base and tip in the world, and when
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(N * 2 * 2), 2));
    const idx = [];
    for (let i = 0; i < N - 1; i++) { const o = i * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
    geo.setIndex(idx);
    const mk = (g, frag, gain) => {
      const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
        vertexShader: 'out vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }', fragmentShader: frag,
        uniforms: { uGain: { value: gain } }, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      }));
      m.frustumCulled = false; m.renderOrder = 6; m.visible = false;
      this.pipe.sceneT.add(m);
      return m;
    };
    this.trail = mk(geo, TRAIL_FRAG, 2.2);
    this.streak = mk(geo.clone(), STREAK_FRAG, 2.6);
  }

  // Sword pose of an attack at time t (seconds into it), in the upper body's space.
  _attackSword(step, t, from, outG, outQ) {
    const keys = ATTACKS[step].keys;
    let i = 0;
    while (i < keys.length - 1 && t > keys[i].t) i++;
    const b = keys[i], a = i > 0 ? keys[i - 1] : from, t0 = i > 0 ? a.t : 0;
    const k = ease(clamp01((t - t0) / Math.max(1e-4, b.t - t0)));
    outG.lerpVectors(a.g, b.g, k); outQ.slerpQuaternions(a.q, b.q, k);
    return { a, b, k };
  }

  update(dt, p, game) {
    const R = this.rig, W = game.world;
    this.time += dt;
    const t = this.time;
    this.flash.value = Math.max(0, this.flash.value - dt * 4);
    const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
    const speed = p.speed, grounded = p.grounded;
    const PY = (this.visY = p.viewY ?? p.pos.y);       // smoothed over steps (see Player)
    const runK = sstep(2.9, 3.9, speed), sprK = sstep(5.9, 7.6, speed);

    // --- slow state: how much of each behaviour is in the pose ---
    let dyaw = wrap(p.yaw - this.lastYaw); this.lastYaw = p.yaw;
    this.yawVel += (dyaw / Math.max(dt, 1e-4) - this.yawVel) * Math.min(1, 8 * dt);
    const moving = grounded && p.state === 'move';
    this.gait += ((moving ? sstep(0.3, 1.1, speed) : 0) - this.gait) * Math.min(1, 8 * dt);
    this.airBlend += ((!grounded && p.state !== 'roll' && p.state !== 'attack' && p.airTime > 0.06 ? 1 : 0) - this.airBlend) * Math.min(1, 10 * dt);
    this.landSquash = Math.max(0, this.landSquash - dt * 3.4);
    this.hurtK += ((p.state === 'hurt' ? 1 : 0) - this.hurtK) * Math.min(1, 14 * dt);
    this.rollK += ((p.state === 'roll' ? 1 : 0) - this.rollK) * Math.min(1, 15 * dt);
    this.deadK += ((p.state === 'dead' ? 1 : 0) - this.deadK) * Math.min(1, 9 * dt);
    this.downK = (this.downK ?? 0) + ((p.state === 'down' ? 1 : 0) - (this.downK ?? 0)) * Math.min(1, (p.state === 'down' ? 11 : 5) * dt);
    const tuning = game.tuning?.active && game.tuning.phase !== 'return' ? 1 : game.prompt && game.input.held.has('interact') ? clamp01((game.prompt.progress ?? 0) * 3 + 0.3) : 0;
    this.tuneK += (tuning - this.tuneK) * Math.min(1, 7 * dt);
    // Ready for a fight while something is awake nearby, and for a moment after a strike.
    let threat = !!p.lockTarget;
    if (!threat) for (const e of game.enemies.list) if (e.alive && e.state !== 'dormant' && e.pos.distanceToSquared(p.pos) < 196) { threat = true; break; }
    if (p.state === 'attack') this.combatHold = 1.6;
    const swimming = p.state === 'swim', riding = p.state === 'ride';
    this.rideK = (this.rideK ?? 0) + ((riding ? 1 : 0) - (this.rideK ?? 0)) * Math.min(1, (riding ? 7 : 5) * dt);
    const ride = ease(clamp01(this.rideK));
    this.swimK += ((swimming ? 1 : 0) - this.swimK) * Math.min(1, 6 * dt);
    // Drawn while there is something to fight (and for a few breaths after), or a use for it.
    const plunging = p.state === 'plunge';
    this.plungeK = (this.plungeK ?? 0) + ((plunging ? 1 : 0) - (this.plungeK ?? 0)) * Math.min(1, 14 * dt);
    this.impactK = (this.impactK ?? 0) + ((plunging && p.plungeHit ? 1 : 0) - (this.impactK ?? 0)) * Math.min(1, (plunging && p.plungeHit ? 30 : 7) * dt);
    if (threat || p.state === 'attack' || plunging) this.drawnHold = 4;
    if (riding) this.drawnHold = Math.max(this.drawnHold, 1.2);
    this.drawnHold = Math.max(0, this.drawnHold - dt);
    const wantDrawn = !swimming && (this.drawnHold > 0 || (this.kneel ?? 0) > 0.3 || tuning > 0);
    if (wantDrawn && this.sheathed && this.uInit) this._draw();
    this.armFree += ((this.sheathed ? 1 : 0) - this.armFree) * Math.min(1, 8 * dt);
    this.combatHold = Math.max(0, this.combatHold - dt);
    this.combat += ((threat || this.combatHold > 0 ? 1 : 0) - this.combat) * Math.min(1, 5 * dt);
    const fight = this.combat * (1 - 0.75 * this.gait * runK);
    // Leaning into acceleration and into turns.
    const acc = (speed - this.lastSpeed) / Math.max(dt, 1e-4); this.lastSpeed = speed;
    this.accLean += (Math.max(-1, Math.min(1, acc / 30)) * (moving ? 1 : 0) - this.accLean) * Math.min(1, 7 * dt);
    this.lean += (Math.max(-1, Math.min(1, this.yawVel / 6)) * this.gait - this.lean) * Math.min(1, 6 * dt);
    this.flipK = (this.flipK ?? 0) + ((plunging && !p.plungeHit ? 1 : 0) - (this.flipK ?? 0)) * Math.min(1, 20 * dt);
    const g = this.gait, sw = ease(clamp01(this.swimK)), ikW = ease(clamp01(1 - this.rollK * 1.2)) * (1 - this.deadK) * (1 - sw) * (1 - this.flipK) * (1 - ease(clamp01(this.downK)));
    const kn = Math.max(ease(clamp01(this.kneel ?? 0)), this.impactK ?? 0);

    // --- attack channels ---
    const A = this.atk;
    const attacking = p.state === 'attack' && p.attack;
    if (attacking) {
      const step = Math.min(3, p.comboStep);
      if (A.key !== p.attack || A.step !== step || p.stateTime < A.time) {
        // A new strike starts from wherever the body and blade are now.
        A.key = p.attack; A.step = step;
        A.from = { t: 0, g: this.swG.clone(), q: this.swQ.clone(), hips: [...A.hips], chest: [...A.chest], pel: [...A.pel], L: [...A.L], R: [...A.R], la: [...A.la], two: A.two, lock: A.lock };
      }
      A.time = p.stateTime;
      const { a, b, k } = this._attackSword(step, p.stateTime, A.from, this.swG, this.swQ);
      const mix3 = (name, def) => { const x = a[name] ?? def, y = b[name] ?? def, o = A[name]; for (let i = 0; i < x.length; i++) o[i] = lerp(x[i], y[i], k); };
      mix3('hips', Z3); mix3('chest', Z3); mix3('pel', Z3); mix3('L', FIGHT.L); mix3('R', FIGHT.R); mix3('la', Z3);
      A.two = lerp(a.two ?? 0, b.two ?? 0, k); A.lock = lerp(a.lock ?? 0, b.lock ?? 0, k);
      // A turn of the whole body runs on its own clock, so it never stalls between keys.
      const sp = ATTACKS[step].spin;
      A.spin = sp ? sstep(sp[0], sp[1], p.stateTime) : 0;
      A.w = Math.min(1, A.w + dt * 16);
    } else {
      A.key = null; A.time = 0;
      const d = Math.exp(-dt * 9);
      for (const n of ['hips', 'chest', 'pel', 'la']) for (let i = 0; i < 3; i++) A[n][i] *= d;
      A.two *= d; A.lock *= d; A.spin = 0; A.w *= Math.exp(-dt * 7);
    }
    const spinYaw = attacking ? A.spin * TAU : 0;

    // --- gait: where each foot would be in the cycle ---
    // The stretch of ground a foot stays on is limited by the length of the leg; the cadence
    // then follows from the speed, so the planted foot never has to slide.
    const duty = lerp(0.62, 0.32, runK) - 0.06 * sprK;
    const Lc = Math.min(speed * duty * cycleTime(speed), lerp(0.86, 1.12, runK));
    const T = speed > 0.3 ? Lc / (speed * duty) : cycleTime(speed);
    if (grounded && speed > 0.25 && p.state === 'move') {
      const before = this.phase;
      this.phase = (this.phase + dt / T) % 1;
      // A footfall each time one of the feet comes round to its strike.
      if (g > 0.4 && (this.phase < before || (before < 0.5 && this.phase >= 0.5))) game.emit('player', { type: 'step', run: runK, sprint: sprK > 0.5 });
    }
    const vlx = p.vel.x * cy - p.vel.z * sy, vlz = p.vel.x * sy + p.vel.z * cy;
    const vl = Math.hypot(vlx, vlz), dirx = vl > 0.2 ? vlx / vl : 0, dirz = vl > 0.2 ? vlz / vl : 1;
    const fwd = lerp(0.4, 0.36, runK) * Lc;
    const halfW = lerp(0.105, 0.06, runK) - 0.02 * sprK;
    const gaitFoot = (side) => {
      const phi = (this.phase + (side > 0 ? 0 : 0.5)) % 1;
      let along, y = 0, pitch = 0, abs = 1, stance = true;
      if (phi < duty) {
        const u = phi / duty;
        along = fwd - Lc * u;
        pitch = lerp(-0.3, -0.05, runK) * (1 - sstep(0, 0.22, u)) + lerp(0.5, 0.72, runK) * sstep(0.62, 1, u);
      } else {
        const s = (phi - duty) / (1 - duty);
        along = lerp(fwd - Lc, fwd, ease(s)) + 0.05 * Math.sin(Math.PI * s) * runK;
        y = lerp(0.09, 0.3 + 0.16 * sprK, runK) * Math.pow(Math.sin(Math.PI * Math.pow(s, lerp(0.85, 0.7, runK))), 1.2);
        pitch = lerp(lerp(0.5, 0.72, runK), lerp(-0.3, -0.05, runK), sstep(0.3, 1, s));
        abs = 1 - sstep(0, 0.2, s) + sstep(0.7, 1, s);
        stance = false;
      }
      const [ry, rz] = footRoll(Math.max(pitch, 0) * abs + Math.min(pitch, 0));
      return { x: side * halfW + dirx * (along + rz), y: y + ry, z: ANKLE[2] + dirz * (along + rz), pitch, abs, stance, phi };
    };
    const gf = { L: gaitFoot(1), R: gaitFoot(-1) };
    const ph = this.phase * TAU;

    // --- pelvis and spine ---
    const br = Math.sin(t * 1.5), sway = Math.sin(t * 0.47);
    // Walking sinks at each footfall and rises over the standing leg; running is the other
    // way round: lowest over the planted foot, highest in flight.
    const bobWalk = -0.022 * Math.cos(2 * ph - 0.4), bobRun = 0.045 * Math.cos(2 * (ph - TAU * (0.25 + duty * 0.5)));
    let pelY = lerp(-0.004 - 0.002 * br, lerp(-0.03 + bobWalk, -0.034 - 0.02 * sprK + bobRun * 0.7, runK), g);
    let pelX = lerp(0.012 * sway, lerp(0.022, 0.01, runK) * Math.sin(ph), g), pelZ = 0;
    pelY -= 0.07 * fight * (1 - g);
    pelY -= 0.3 * this.landSquash * this.landSquash;
    pelX += A.pel[0]; pelY += A.pel[1]; pelZ += A.pel[2];
    pelY -= 0.18 * this.hurtK; pelZ -= 0.06 * this.hurtK;
    pelY -= 0.46 * kn; pelZ += 0.03 * kn;

    this.root.position.set(p.pos.x, PY, p.pos.z);
    this.root.rotation.set(0, p.yaw + spinYaw, 0);
    R.reset();
    const fwdLean = (lerp(0.04, lerp(0.16, 0.3, sprK), runK)) * g + 0.12 * this.accLean;
    const pelYaw = -lerp(0.07, 0.12, runK) * Math.cos(ph) * g, pelRoll = lerp(0.05, 0.035, runK) * Math.sin(ph) * g;
    R.rot('Hips', fwdLean * 0.5 + A.hips[0], pelYaw + A.hips[1] - 0.12 * fight * (1 - g), pelRoll - this.lean * 0.2 + A.hips[2]);
    R.rot('Spine', fwdLean * 0.4 + 0.008 * br + A.chest[0] * 0.45, -pelYaw * 1.1 + A.chest[1] * 0.45 - 0.1 * fight * (1 - g), -pelRoll * 0.7 - this.lean * 0.1 + A.chest[2] * 0.5);
    if (kn > 0.001) { R.rot('Spine', 0.1 * kn); R.rot('Chest', 0.14 * kn); R.rot('Head', 0.34 * kn); }
    R.rot('Chest', fwdLean * 0.3 + 0.012 * br + A.chest[0] * 0.55, -pelYaw * 1.2 + A.chest[1] * 0.55 - 0.1 * fight * (1 - g), -pelRoll * 0.5 + A.chest[2] * 0.5);
    // The head stays level and looks where he is going, or at what he is fighting.
    let look = 0;
    if (p.lockTarget) look = wrap(Math.atan2(p.lockTarget.pos.x - p.pos.x, p.lockTarget.pos.z - p.pos.z) - p.yaw);
    else look = Math.max(-0.5, Math.min(0.5, this.yawVel * 0.12)) + 0.12 * Math.sin(t * 0.31) * (1 - g) * (1 - this.combat);
    this.headYaw += (Math.max(-1, Math.min(1, look)) - this.headYaw) * Math.min(1, 6 * dt);
    const bodyYaw = A.hips[1] + A.chest[1] - 0.32 * fight * (1 - g);
    R.rot('Neck', -(fwdLean * 0.5 + A.chest[0] * 0.3), (this.headYaw - bodyYaw) * 0.4, 0);
    R.rot('Head', -(fwdLean * 0.55 + A.chest[0] * 0.35 + A.hips[0] * 0.5), (this.headYaw - bodyYaw) * 0.5, this.lean * 0.1);

    // --- arms (the right one is placed by the sword further down) ---
    const swing = Math.cos(ph);
    // Left arm: opposite to the left leg, elbow closing as it comes forward.
    const laSwing = lerp(0.38, 0.8, runK) * swing * g, laBend = lerp(0.28 + 0.2 * Math.max(0, -swing), 1.25 + 0.3 * Math.max(0, -swing), runK) * g + 0.22 * (1 - g);
    R.rot('UpperArm.L', 0.04, 0, -0.66 + 0.1 * runK * g);
    R.rot('UpperArm.L', laSwing + A.la[0] - 0.25 * fight * (1 - g), 0, A.la[1] + 0.1 * fight * (1 - g));
    // The elbow is a hinge square to the arm: it closes forward.
    R.rotAxis('LowerArm.L', -0.64, -0.77, 0, laBend + A.la[2] + 0.5 * fight * (1 - g));
    R.rot('Hand.L', 0, 0, -0.1);
    R.rot('Shoulder.L', 0, -laSwing * 0.12, 0); R.rot('Shoulder.R', 0, -laSwing * 0.12, 0);
    R.rot('UpperArm.R', 0.05, 0, 0.6);        // a sensible start for the solver
    if (this.armFree > 0.01) {
      // Sword away: the right arm swings like the left, in step with the other leg.
      const f = this.armFree, bendR = lerp(0.28 + 0.2 * Math.max(0, swing), 1.25 + 0.3 * Math.max(0, swing), runK) * g + 0.22 * (1 - g);
      R.rot('UpperArm.R', -0.01 * f, 0, (0.06 - 0.1 * runK * g) * f);
      R.rot('UpperArm.R', -laSwing * f, 0, 0);
      R.rotAxis('LowerArm.R', -0.64, 0.77, 0, bendR * f);
      R.rot('Hand.R', 0, 0, 0.1 * f);
    }
    if (sw > 0.01) {
      // Swimming: the body lies along the water, the head up; a breaststroke with the arms
      // and an easy kick behind.
      const ph2 = p.stepPhase * TAU, reach = 0.5 + 0.5 * Math.cos(ph2), pull = Math.max(0, Math.sin(ph2));
      R.rot('Hips', 1.22 * sw, 0, 0.05 * Math.sin(ph2) * sw); R.rot('Spine', -0.12 * sw); R.rot('Chest', -0.16 * sw);
      R.rot('Neck', -0.45 * sw); R.rot('Head', -0.5 * sw);
      for (const [s, sg] of [['L', 1], ['R', -1]]) {
        R.rot(`UpperArm.${s}`, -(1.5 + 0.9 * reach) * sw, 0, sg * (0.25 + 0.9 * pull) * sw);
        R.rotAxis(`LowerArm.${s}`, -0.64, -0.77 * sg, 0, (0.25 + 0.9 * pull * (1 - reach)) * sw);
        const kick = Math.sin(ph2 * 2 + (sg > 0 ? 0 : Math.PI));
        R.rot(`UpperLeg.${s}`, (-0.12 + 0.22 * kick) * sw, 0, sg * 0.05 * sw); R.rot(`LowerLeg.${s}`, (0.3 + 0.25 * kick) * sw); R.rot(`Foot.${s}`, 0.6 * sw);
      }
      pelY += 0.03 * Math.sin(ph2) * sw;
    }

    if (ride > 0.001) {
      const swingR = 0.05 * Math.sin(t * 2.1), v = clamp01((game.strings?.speed ?? 0) / 30);
      R.rot('Hips', (0.1 + 0.3 * v) * ride, 0, swingR * ride); R.rot('Spine', -0.1 * v * ride); R.rot('Chest', -0.12 * v * ride);
      R.rot('Neck', -0.14 * v * ride); R.rot('Head', -0.16 * v * ride);
    }
    // --- airborne, landing, hurt ---
    if (this.airBlend > 0.01) {
      this.fallK = (this.fallK ?? 0) + (clamp01(-p.vel.y / 9) - (this.fallK ?? 0)) * Math.min(1, 9 * dt);
      const w = this.airBlend, falling = this.fallK;
      R.rot('UpperArm.L', -0.25, 0, 0.35 + 0.45 * falling, w);
      R.rot('Spine', 0.08 - 0.12 * falling, 0, 0, w);
    }
    if (this.landSquash > 0) { const k = this.landSquash * this.landSquash; R.rot('Spine', 0.3 * k); R.rot('Chest', 0.12 * k); }
if (this.hurtK > 0.01) {
      const w = this.hurtK, side = Math.sin(wrap((p.hurtDir ?? p.yaw + Math.PI) - p.yaw)), back = -Math.cos(wrap((p.hurtDir ?? p.yaw + Math.PI) - p.yaw));
      R.rot('Hips', -0.12 * back * w, 0, 0.2 * side * w); R.rot('Spine', -0.34 * back * w, 0.3 * side * w, 0.2 * side * w); R.rot('Chest', -0.28 * back * w, 0.25 * side * w);
      R.rot('Neck', -0.2 * back * w, -0.3 * side * w); R.rot('Head', -0.3 * back * w, -0.35 * side * w);
      R.rot('UpperArm.L', -0.5 * w, 0, 0.45 * w); R.rotAxis('LowerArm.L', -0.64, -0.77, 0, 0.5 * w);
    }

    // --- whole-body actions that are posed directly ---
    let rollSpin = 0;
    if (p.state === 'plunge' && !p.plungeHit) {
      const k = clamp01(p.stateTime / (TUNE.plunge.hang + 0.06));
      rollSpin = ease(k) * TAU;
      const tuck = Math.sin(Math.PI * k);
      R.rot('Spine', 0.35 * tuck); R.rot('Chest', 0.25 * tuck); R.rot('Head', 0.2 * tuck);
      // Knees drawn up through the turn, then the legs trail the fall.
      for (const s of ['L', 'R']) { R.rot(`UpperLeg.${s}`, -(1.2 * tuck + 0.15 * k)); R.rot(`LowerLeg.${s}`, 1.6 * tuck + 0.5 * k); R.rot(`Foot.${s}`, 0.5); }
    }
    if (this.rollK > 0.01) {
      const k = clamp01(p.stateTime / TUNE.rollTime), w = p.state === 'roll' ? Math.sin(Math.PI * k) ** 0.6 : this.rollK * 0.3;
      if (p.state === 'roll') rollSpin = ease(k) * TAU;
      pelY -= 0.48 * w;
      for (const s of ['L', 'R']) { R.rot(`UpperLeg.${s}`, -1.5 * w); R.rot(`LowerLeg.${s}`, 1.9 * w); }
      R.rot('UpperArm.L', -0.7 * w); R.rotAxis('LowerArm.L', -0.64, -0.77, 0, 1.2 * w);
      R.rot('UpperArm.R', -0.7 * w); R.rotAxis('LowerArm.R', -0.64, 0.77, 0, 1.2 * w);
      R.rot('Spine', 0.55 * w); R.rot('Chest', 0.45 * w); R.rot('Head', 0.45 * w);
    }
    if (this.downK > 0.01) {
      const k = ease(clamp01(this.downK)), air = p.grounded ? 0 : 1;
      pelY -= (0.78 - 0.25 * air) * k;
      R.rot('Hips', -(1.3 - 0.4 * air) * k, 0, 0.12 * k); R.rot('Spine', -0.15 * k); R.rot('Chest', 0.1 * k); R.rot('Head', 0.35 * k);
      R.rot('UpperLeg.L', (0.5 - 0.9 * air) * k, 0, 0.15 * k); R.rot('LowerLeg.L', (0.7 + 0.5 * air) * k);
      R.rot('UpperLeg.R', (0.15 - 0.7 * air) * k, 0, -0.2 * k); R.rot('LowerLeg.R', (0.25 + 0.6 * air) * k);
      R.rot('UpperArm.L', -0.6 * k, 0, 0.9 * k); R.rot('UpperArm.R', -0.5 * k, 0, -0.8 * k);
    }
    if (this.deadK > 0.01) {
      const k = ease(clamp01(p.stateTime / 0.9)) * this.deadK;
      pelY -= 0.82 * k;
      R.rot('Hips', -1.35 * k, 0, 0.2 * k); R.rot('Spine', -0.1 * k); R.rot('Head', -0.3 * k);
      R.rot('UpperLeg.L', 0.5 * k); R.rot('LowerLeg.L', 0.6 * k); R.rot('UpperArm.L', 0, 0, 0.7 * k);
    }

    // --- feet: stand targets, steps, ground ---
    const feet = this.feet, bodyYawW = p.yaw + spinYaw, cb = Math.cos(bodyYawW), sb = Math.sin(bodyYawW);
    const toWorld = (x, y, z, out) => out.set(p.pos.x + x * cb + z * sb, PY + y, p.pos.z - x * sb + z * cb);
    const stand = (s) => { const a = STAND[s], b = FIGHT[s], c = A[s], k = KNEEL[s], w = A.w, f = fight * (1 - g); return [lerp(lerp(lerp(a[0], b[0], f), c[0], w), k[0], kn), lerp(lerp(lerp(a[1], b[1], f), c[1], w), k[1], kn), lerp(lerp(lerp(a[2], b[2], f), c[2], w), k[2], kn), c[3] * w]; };
    const air = this.airBlend, rising = clamp01(p.vel.y / 6), lockW = Math.max(A.lock, air);       // how far the feet are carried with the body (a leap, a turn)
    const order = ['L', 'R'];
    const ankles = {};
    for (const s of order) {
      const f = feet[s], st = stand(s), o = gf[s];
      const want = toWorld(st[0], 0, st[1] + ANKLE[2], _v0), wantYaw = bodyYawW + st[2];
      // First frame, or the body was moved somewhere else in one go: the feet go with it.
      if (!f.init || Math.hypot(want.x - f.pos.x, want.z - f.pos.z) > 2.5) { f.pos.copy(want); f.yaw = wantYaw; f.init = true; f.step = -1; f.lift = 0; }
      // Planted feet stay where they are until the body has moved away from them, then step.
      // While the gait or the body carries a foot outright, its planted place simply goes
      // along, so it is in the right spot the moment it is set down again.
      if (g > 0.98) { toWorld(o.x, 0, o.z, f.pos); f.yaw = bodyYawW; f.step = -1; f.lift = 0; }
      else if (lockW > 0.98) { f.pos.copy(want); f.yaw = wantYaw; f.step = -1; f.lift = 0; }
      else if (f.step >= 0) {
        f.step += dt / f.dur;
        const k = ease(Math.min(1, f.step));
        f.pos.lerpVectors(f.from, want, k); f.yaw = f.fromYaw + wrap(wantYaw - f.fromYaw) * k; f.lift = Math.sin(Math.PI * k) * f.h;
        if (f.step >= 1) { f.step = -1; f.lift = 0; if (grounded && ikW > 0.5) game.emit('player', { type: 'step', soft: true }); }
      } else {
        // One foot at a time, unless the body has got well away from this one.
        const err = Math.hypot(want.x - f.pos.x, want.z - f.pos.z), yerr = Math.abs(wrap(wantYaw - f.yaw)), other = feet[s === 'L' ? 'R' : 'L'];
        if ((err > (attacking ? 0.1 : 0.2) || yerr > 0.55) && (other.step < 0 || err > 0.5)) {
          f.from.copy(f.pos); f.fromYaw = f.yaw; f.step = 0; f.dur = Math.max(0.1, Math.min(0.24, 0.1 + err * 0.22)) * (attacking ? 0.9 : 1); f.h = 0.04 + Math.min(0.1, err * 0.14);
        }
      }
      // Height of the ground under the foot, eased so a kerb is a step and not a jolt.
      const fx = g > 0.5 ? p.pos.x + (o.x * cb + o.z * sb) : f.pos.x, fz = g > 0.5 ? p.pos.z + (-o.x * sb + o.z * cb) : f.pos.z;
      const floor = grounded ? W.floorBelow(fx, p.pos.y + 0.55, fz, 1.2) - PY : 0;
      this.gy[s] += (Math.max(-0.45, Math.min(0.45, floor)) - this.gy[s]) * Math.min(1, 18 * dt);
      // Blend: planted / stepping foot, the gait cycle, the air pose.
      const a = (ankles[s] = { pos: new THREE.Vector3(), yaw: wrap(f.yaw - bodyYawW), pitch: 0, abs: 1 });
      a.pos.set(f.pos.x, PY + ANKLE[1] + f.lift + this.gy[s], f.pos.z);
      if (lockW > 0.001) {
        // Carried with the body: eased in and out, never switched.
        const k = ease(lockW);
        _v1.set(want.x, PY + ANKLE[1] + st[3] + this.gy[s], want.z);
        a.pos.lerp(_v1, k); a.yaw = lerp(a.yaw, st[2], k);
      }
      a.pitch = f.step >= 0 ? 0.25 * Math.sin(Math.PI * Math.min(1, f.step)) : 0;
      // Kneeling: the back foot is up on its toes.
      if (kn > 0.001 && s === 'R') { a.pitch += 1.05 * kn; a.pos.y += 0.1 * kn; }
      if (g > 0.001) {
        toWorld(o.x, ANKLE[1] + o.y + this.gy[s] * (o.stance ? 1 : 0.6), o.z, _v1);
        a.pos.lerp(_v1, g); a.yaw = lerp(a.yaw, 0, g); a.pitch = lerp(a.pitch, o.pitch, g); a.abs = lerp(1, o.abs, g);
      }
      if (air > 0.001) {
        // Rising: the leading knee drives up and the other leg trails. Falling: both reach down.
        const L = s === 'L';
        toWorld(f.side * 0.11, ANKLE[1] + lerp(L ? 0.1 : 0.05, L ? 0.36 : 0.12, rising), lerp(L ? 0.1 : -0.1, L ? 0.2 : -0.3, rising), _v1);
        a.pos.lerp(_v1, air); a.yaw = lerp(a.yaw, 0, air); a.pitch = lerp(a.pitch, 0.5, air); a.abs = lerp(a.abs, 0.3, air);
      }
      if (ride > 0.001) {
        // Hanging: one knee a little drawn up, both legs trailing with the speed.
        const L = s === 'L', v = clamp01((game.strings?.speed ?? 0) / 30), sw2 = 0.04 * Math.sin(t * 2.1 + (L ? 0 : 1.3));
        toWorld(f.side * 0.1, ANKLE[1] + (L ? 0.3 : 0.1) + 0.12 * v, (L ? -0.05 : -0.3) - 0.3 * v + sw2, _v1);
        a.pos.lerp(_v1, ride); a.yaw = lerp(a.yaw, 0, ride); a.pitch = lerp(a.pitch, 0.75, ride); a.abs = lerp(a.abs, 0.4, ride);
      }
    }
    // A wide stance, or ground that falls away under one foot, lowers the pelvis so both
    // legs can reach.
    {
      let need = 0;
      for (const s of order) {
        const a = ankles[s], hx = p.pos.x + (feet[s].side * 0.095 + pelX) * cb + pelZ * sb, hz = p.pos.z - (feet[s].side * 0.095 + pelX) * sb + pelZ * cb;
        const horiz = Math.hypot(a.pos.x - hx, a.pos.z - hz), reach = 0.897;
        const top = a.pos.y + Math.sqrt(Math.max(0.04, reach * reach - horiz * horiz));
        need = Math.max(need, PY + HIP_Y + pelY - top);
      }
      need = Math.min(0.4, need) * (1 - g * 0.85) * (1 - air);
      this.pelDrop += (need - this.pelDrop) * Math.min(1, 20 * dt);
      pelY -= this.pelDrop;
    }

    // --- write the pose ---
    this.debugPose?.(R, p);
    R.apply();
    const hips = R.bones.hips;
    if (hips) { hips.bone.position.copy(hips.restPos); hips.bone.position.x += pelX; hips.bone.position.y += pelY; hips.bone.position.z += pelZ; }
    if (rollSpin) {
      // Somersault about the hips.
      const piv = (hips?.restPos.y ?? 1) + pelY;
      this.root.position.y += piv; this.root.rotateX(rollSpin); this.root.translateY(-piv);
    }
    this.root.updateMatrixWorld(true);

    // --- legs ---
    if (ikW > 0.001) for (const s of order) {
      const a = ankles[s], f = feet[s];
      const py = bodyYawW + a.yaw * 0.6, pole = _v2.set(Math.sin(py) + f.side * 0.14 * Math.cos(py), 0.05, Math.cos(py) - f.side * 0.14 * Math.sin(py));
      R.ik(`UpperLeg.${s}`, `LowerLeg.${s}`, `Foot.${s}`, a.pos, pole, ikW);
      _q0.setFromEuler(_e0.set(a.pitch, a.yaw, 0, 'YXZ'));
      R.setCharQ(`Foot.${s}`, _q0, a.abs * ikW);
      // The toes stay on the ground while the heel comes up.
      if (a.pitch > 0.02) { _q1.setFromAxisAngle(YAXIS, a.yaw); R.setCharQ(`Toe.${s}`, _q1, a.abs * ikW * 0.8); }
    }
    this.root.updateMatrixWorld(true);

    // --- sword and right arm ---
    const chest = R.bones.chest;
    if (chest && this.sword && this.foreInHand) {
      chest.bone.updateWorldMatrix(true, false);
      this.uPos0.copy(this.uPos); this.uQ0.copy(this.uQ);
      this.uPos.setFromMatrixPosition(chest.bone.matrixWorld);
      this.uQ.setFromRotationMatrix(chest.bone.matrixWorld).multiply(_q0.copy(chest.rest).invert());
      if (!this.uInit) { this.uPos0.copy(this.uPos); this.uQ0.copy(this.uQ); this.uInit = true; }
      if (!attacking) {
        // Carried low when walking, trailing behind at a run, raised between him and a foe.
        const armSwing = swing * g;
        let tg = _v0.copy(SW.idle.gv), tq = _q0.copy(SW.idle.q);
        const runW = g * runK;
        if (runW > 0.001) { tg.lerp(SW.run.gv, runW); tq.slerp(SW.run.q, runW); }
        if (sprK * g > 0.001) { tg.lerp(SW.sprint.gv, sprK * g); tq.slerp(SW.sprint.q, sprK * g); }
        if (fight > 0.001) { tg.lerp(SW.guard.gv, fight); tq.slerp(SW.guard.q, fight); }
        if (air > 0.001) { tg.lerp(SW.air.gv, air * 0.8); tq.slerp(SW.air.q, air * 0.8); }
        if (this.tuneK > 0.001) { tg.lerp(SW.tune.gv, this.tuneK); tq.slerp(SW.tune.q, this.tuneK); }
        if (kn > 0.001) { tg.lerp(SW.plant.gv, kn); tq.slerp(SW.plant.q, kn); }
        if (plunging && !p.plungeHit) { const pose = p.stateTime < TUNE.plunge.hang * 0.7 ? SW.coil : SW.dive; tg.copy(pose.gv); tq.copy(pose.q); }
        if (ride > 0.001) { tg.lerp(SW.ride.gv, ride); tq.slerp(SW.ride.q, ride); }
        tg.z += armSwing * lerp(0.05, 0.1, runK); tg.y += 0.02 * Math.abs(armSwing) * runK + 0.004 * br;
        if (!wantDrawn && !this.sheathed) {
          // Putting it away: the point finds the scabbard's mouth and the blade slides home.
          this._scabbardInU(_v3, _q1);
          tg = _v0.copy(_v3); tq = _q0.copy(_q1);
          if (this.swG.distanceTo(tg) < 0.035 && this.swQ.angleTo(tq) < 0.2) this._sheathe();
        }
        const k = Math.min(1, dt * (plunging ? 26 : p.state === 'move' ? 11 : 16));
        this.swG.lerp(tg, k); this.swQ.slerp(tq, k);
      }
      if (this.sheathed) this._scabbardInU(this.swG, this.swQ);       // the hand's target stays on the hilt while it lets go
      const armW = clamp01(1 - this.rollK * 1.5) * (1 - this.deadK) * (1 - this.armFree) * (1 - sw) * (1 - 0.85 * ease(clamp01(this.downK)));
      this._placeSword(this.swG, this.swQ, this.uPos, this.uQ, armW);
      // Second hand on the grip for the heavy strike.
      const two = Math.max(A.two, kn, this.plungeK ?? 0, ride);
      if (two > 0.01) {
        const d = _v0.set(0, 1, 0).applyQuaternion(this.sword.getWorldQuaternion(_q0));
        // On the grip below the right hand; riding a string, out along the flat of the blade.
        const gp = this.sword.localToWorld(_v1.set(0, lerp(-0.11, 0.6, ride), 0));
        const pole = _v2.set(0.6, -0.7, -0.3).applyQuaternion(this.uQ);
        R.ik('UpperArm.L', 'LowerArm.L', 'Hand.L', gp.addScaledVector(d, -0.02), pole, two * armW);
      }
      this.root.updateMatrixWorld(true);
    }

    // --- cloth ---
    const cols = this.cloth.colliders; cols.length = 0;
    const wp = (name, v) => { const b = R.get(name); return b ? b.getWorldPosition(v) : null; };
    const hp = wp('Hips', new THREE.Vector3()), cp = wp('Chest', new THREE.Vector3());
    if (hp && cp) cols.push({ a: hp.clone().add(new THREE.Vector3(0, -0.45, 0)), b: cp.clone().add(new THREE.Vector3(0, 0.25, 0)), r: 0.21 });
    for (const s of ['L', 'R']) { const a = wp(`UpperLeg.${s}`, new THREE.Vector3()), b = wp(`Foot.${s}`, new THREE.Vector3()); if (a && b) cols.push({ a, b, r: 0.12 }); }
    // A light breeze from the valley, plus the air the hero moves through.
    this.cloth.wind.set(0.28 + Math.sin(t * 0.7) * 0.14 - p.vel.x * 0.05, 0, 0.14 - p.vel.z * 0.05);
    this.cloth.update(dt, t);
    this.root.updateMatrixWorld(true);

    // --- blade trail ---
    if (this.sword) {
      const diving = p.state === 'plunge' && !p.plungeHit && p.stateTime > TUNE.plunge.hang * 0.6;
      const cutting = diving || (attacking && p.stateTime > p.attack.hit[0] - 0.035 && p.stateTime < p.attack.hit[1] + 0.03);
      const base = this.sword.localToWorld(new THREE.Vector3(0, 0.12, 0)), tip = this.sword.localToWorld(new THREE.Vector3(0, 0.985, 0));
      if (dt > 0) this.tipVel.subVectors(tip, this.tip).multiplyScalar(1 / dt);
      this.tip.copy(tip);
      if (cutting && !diving && this._cutT !== undefined && dt > 0) {
        // In-between positions of the blade for this frame, so the arc is smooth at any
        // frame rate: the designed cut at intermediate times, carried by the body's motion.
        const N = Math.max(1, Math.min(6, Math.round(dt * 240)));
        for (let i = 1; i < N; i++) {
          const u = i / N, tt = lerp(this._cutT, p.stateTime, u);
          this._attackSword(A.step, tt, A.from, _v0, _q0);
          _q1.slerpQuaternions(this.uQ0, this.uQ, u); _v1.lerpVectors(this.uPos0, this.uPos, u);
          const sq = _q2.copy(_q1).multiply(_q0);
          const gp = _v0.applyQuaternion(_q1).add(_v1);
          // Sub-samples follow the ideal cut; nudge them by how far the real blade is from it.
          const b = new THREE.Vector3(0, 0.165, 0).applyQuaternion(sq).add(gp), tp = new THREE.Vector3(0, 1.03, 0).applyQuaternion(sq).add(gp);
          if (this._cutErr) { b.addScaledVector(this._cutErr[0], 1); tp.addScaledVector(this._cutErr[1], 1); }
          this.trailPts.push({ b, t: tp, at: t - dt * (1 - u) });
        }
        // How far the drawn blade is from the designed one right now.
        this._attackSword(A.step, p.stateTime, A.from, _v0, _q0);
        const sq = _q2.copy(this.uQ).multiply(_q0), gp = _v0.applyQuaternion(this.uQ).add(this.uPos);
        this._cutErr = [base.clone().sub(new THREE.Vector3(0, 0.165, 0).applyQuaternion(sq).add(gp)), tip.clone().sub(new THREE.Vector3(0, 1.03, 0).applyQuaternion(sq).add(gp))];
      }
      if (cutting) { this.trailPts.push({ b: base, t: tip, at: t }); this._cutT = p.stateTime; } else { this._cutT = undefined; this._cutErr = null; }
      if (this.bladeGlow) this.bladeGlow.w += ((cutting ? 3.4 : 1.2) - this.bladeGlow.w) * Math.min(1, dt * 18);
      const LIFE = 0.13;
      while (this.trailPts.length && (t - this.trailPts[0].at > LIFE || this.trailPts.length > this.trailN)) this.trailPts.shift();
      const n = this.trailPts.length;
      this.trail.visible = this.streak.visible = n > 2;
      if (n > 2) {
        const pos = this.trail.geometry.attributes.position, uv = this.trail.geometry.attributes.uv;
        const sp = this.streak.geometry.attributes.position, su = this.streak.geometry.attributes.uv;
        const cam = this.pipe.camera.position;
        for (let i = 0; i < this.trailN; i++) {
          const j = Math.min(n - 1, i), q = this.trailPts[j], age = clamp01((t - q.at) / LIFE);
          // The crescent narrows toward its tail: the inner edge closes up on the tip's line.
          const inner = 0.22 + 0.7 * age;
          pos.setXYZ(i * 2, lerp(q.b.x, q.t.x, inner), lerp(q.b.y, q.t.y, inner), lerp(q.b.z, q.t.z, inner)); pos.setXYZ(i * 2 + 1, q.t.x, q.t.y, q.t.z);
          uv.setXY(i * 2, age, 0); uv.setXY(i * 2 + 1, age, 1);
          // The streak: a band across the tip's path, turned to face the camera.
          const a = this.trailPts[Math.max(0, j - 1)].t, b = this.trailPts[Math.min(n - 1, j + 1)].t;
          const side = _v0.subVectors(b, a).cross(_v1.subVectors(cam, q.t));
          const sl = side.length(), w = (0.02 + 0.075 * Math.pow(1 - age, 0.6)) / (sl > 1e-6 ? sl : 1);
          sp.setXYZ(i * 2, q.t.x - side.x * w, q.t.y - side.y * w, q.t.z - side.z * w); sp.setXYZ(i * 2 + 1, q.t.x + side.x * w, q.t.y + side.y * w, q.t.z + side.z * w);
          su.setXY(i * 2, age, 0); su.setXY(i * 2 + 1, age, 1);
        }
        pos.needsUpdate = true; uv.needsUpdate = true; sp.needsUpdate = true; su.needsUpdate = true;
      }
    }
  }

  // Leads the right hand so the sword's grip sits at g with orientation q (both in the
  // upper body's space, given by uPos / uQ), choosing the elbow that leaves the wrist relaxed.
  _placeSword(g, q, uPos, uQ, weight) {
    if (weight <= 0.001) return;
    const R = this.rig;
    const grip = _v0.copy(g).applyQuaternion(uQ).add(uPos);
    const hand = _q1.copy(uQ).multiply(q).multiply(_q2.copy(this.sword.quaternion).invert());      // the hand's orientation in the world
    const wrist = _v1.copy(this.gripInHand).applyQuaternion(hand).negate().add(grip);
    const sh = R.bones.upperarmr.bone.getWorldPosition(_v2);
    const pole = _v3.copy(this.foreInHand).applyQuaternion(hand).multiplyScalar(-this.foreLen).add(wrist).sub(sh);
    pole.addScaledVector(_v4.set(-0.25, -0.6, -0.45).applyQuaternion(uQ), 0.12);
    R.ik('UpperArm.R', 'LowerArm.R', 'Hand.R', wrist, pole, weight);
    // Now that the arm is placed, turn the sword about its own blade so the hand sits
    // straight on the forearm (the edge falls in line with the arm, as a wrist allows), and
    // place the arm once more for the hand's new position.
    const fore = R.bones.lowerarmr.bone, hb = R.bones.handr.bone;
    fore.updateWorldMatrix(true, false); hb.updateWorldMatrix(false, false);
    const fa = _v2.setFromMatrixPosition(hb.matrixWorld).sub(_v3.setFromMatrixPosition(fore.matrixWorld)).normalize();
    const d = _v4.set(0, 1, 0).applyQuaternion(_q2.copy(uQ).multiply(q));
    const n = _v3.crossVectors(fa, d);
    if (n.lengthSq() > 0.01) {
      n.normalize();
      const sq = swordQ([d.x, d.y, d.z], [n.x, n.y, n.z], _q2);
      hand.copy(sq).multiply(_q0.copy(this.sword.quaternion).invert());
      wrist.copy(this.gripInHand).applyQuaternion(hand).negate().add(grip);
      const sh2 = R.bones.upperarmr.bone.getWorldPosition(_v2);
      const pole2 = _v3.copy(this.foreInHand).applyQuaternion(hand).multiplyScalar(-this.foreLen).add(wrist).sub(sh2);
      pole2.addScaledVector(_v4.set(-0.25, -0.6, -0.45).applyQuaternion(uQ), 0.12);
      R.ik('UpperArm.R', 'LowerArm.R', 'Hand.R', wrist, pole2, weight);
    }
    R.setWorldQ('Hand.R', hand, weight);
  }

  // Puts the sword in the scabbard (it then rides on the hips) or back into the hand.
  _sheathe() {
    const hips = this.rig.get('Hips');
    if (!hips || !this.sword) return;
    hips.add(this.sword); this.sword.position.copy(SCAB.pos); this.sword.quaternion.copy(SCAB.q);
    this.sheathed = true;
  }
  _draw() {
    if (!this.sheathed || !this.handBone) return;
    // The hand takes the hilt where it is: the pose the blade is led from starts at the hip.
    this._scabbardInU(this.swG, this.swQ);
    this.handBone.add(this.sword); this.sword.position.copy(this.swordInHand.pos); this.sword.quaternion.copy(this.swordInHand.q);
    this.sheathed = false;
  }
  // The scabbard's grip point and the sword's orientation there, in the upper body's space.
  _scabbardInU(outG, outQ) {
    const hips = this.rig.get('Hips');
    hips.updateWorldMatrix(true, false);
    const hq = _q2.setFromRotationMatrix(hips.matrixWorld), inv = _q0.copy(this.uQ).invert();
    outG.copy(SCAB.grip).applyQuaternion(hq).add(_v4.setFromMatrixPosition(hips.matrixWorld)).sub(this.uPos).applyQuaternion(inv);
    outQ.copy(inv).multiply(hq).multiply(SCAB.q);
  }

  onLand(fell) { this.landSquash = Math.min(1, 0.4 + fell * 0.12); }
  onHit() { this.flash.value = 0.25; }
}
