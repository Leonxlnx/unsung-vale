// Forest: places trees over the world and draws them at three levels of detail.
//   near  - full branch mesh and every leaf card
//   mid   - simplified wood, a third of the cards drawn larger
//   far   - one camera-facing quad per tree, textured from an atlas baked at load time
// Level changes are dithered (and smoothed by TAA) so there is no visible pop.
import * as THREE from 'three';
import { COMMON, SKYMAP } from '../../engine/glsl.js';
import { SKY_SAMPLE, SH_GLSL } from '../../engine/sky.js';
import { LIGHTING } from '../../engine/lighting.js';
import { TextureForge } from '../../engine/forge.js';
import { TERRAIN_SAMPLING } from '../terrain.js';
import { SPECIES, generateTree, buildWood, buildLeaves } from './treegen.js';
import { bakeLeafAtlas } from './leafAtlas.js';
import { fbm, mulberry32, smoothstep } from '../../util/noise.js';
import { FILM } from '../../engine/quality.js';

const BARK = /* glsl */ `
// Furrowed bark: long interlacing ridges running up the trunk, narrow plates split across
// here and there, with lichen and moss on the weather side.
void material(vec2 uv, out float h, out vec3 col, out float rough) {
  float warp = pfbm(uv, vec2(4.0, 2.0), 3, 1.0) - 0.5;
  vec2 q = vec2(uv.x + warp * 0.05, uv.y);
  float r1 = pridge(q, vec2(14.0, 1.0), 3, 2.0);
  float r2 = pridge(q + vec2(0.0, r1 * 0.05), vec2(31.0, 3.0), 3, 4.0);
  vec4 w = pworley(q, vec2(16.0, 2.0), 3.0);
  float plate = smoothstep(0.0, 0.1, w.y - w.x);
  float split = smoothstep(0.75, 0.9, pfbm(q, vec2(3.0, 22.0), 3, 6.0));
  float fine = pfbm(uv, vec2(70.0, 18.0), 3, 5.0);
  h = saturate(0.42 * r1 + 0.2 * r2 + 0.22 * plate * (1.0 - 0.5 * split) + 0.16 * fine);
  vec3 deep = srgb(0.13, 0.1, 0.08), ridge = srgb(0.43, 0.36, 0.29), grey = srgb(0.5, 0.47, 0.42);
  col = mix(deep, ridge, smoothstep(0.25, 0.75, h));
  col = mix(col, grey, smoothstep(0.7, 0.92, h) * 0.5) * (0.82 + 0.36 * fine);
  col = mix(col, srgb(0.32, 0.38, 0.2), smoothstep(0.62, 0.85, pfbm(uv, vec2(3.0, 2.0), 3, 7.0)) * 0.4);
  col = mix(col, srgb(0.62, 0.64, 0.52), smoothstep(0.8, 0.95, pfbm(uv, vec2(9.0, 7.0), 3, 9.0)) * 0.35);
  rough = 0.92;
}`;

const VARIANTS = [
  ['ember', 1], ['ember', 2], ['ember', 3], ['blossom', 1], ['blossom', 2], ['elder', 1], ['elder', 2],
  ['cypress', 1], ['cypress', 2], ['green', 1], ['green', 2], ['green', 3],
];
const NEAR = FILM ? 96 : 56, MID = FILM ? 300 : 160;      // metres: near -> mid -> billboard hand-over distances
const FRAMES = 8, CELL = 256;

const TREE_VERT_COMMON = /* glsl */ `
in vec4 iTree;     // xyz position, w scale
in vec4 iParam;    // x yaw, y seed, z leaf layer, w unused
in vec3 aWind;
uniform float uTime;
uniform vec3 uWind;   // xz = direction * strength
vec3 treeRotate(vec3 p) { float c = cos(iParam.x), s = sin(iParam.x); return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }
vec3 windOffset(vec3 wp) {
  float ph = dot(iTree.xz, vec2(0.031, 0.047));
  float gust = 0.55 + 0.3 * sin(uTime * 0.55 + ph) + 0.15 * sin(uTime * 1.3 + ph * 2.3);
  vec3 off = vec3(uWind.x, 0.0, uWind.z) * aWind.x * gust * 0.5;
  float b = aWind.y;
  off += vec3(sin(uTime * 1.7 + b), 0.4 * sin(uTime * 2.1 + b * 1.3), cos(uTime * 1.5 + b)) * aWind.x * 0.07 * length(uWind);
  off += vec3(sin(uTime * 5.1 + wp.x * 2.1 + b * 3.0), sin(uTime * 6.3 + wp.z * 1.7), sin(uTime * 4.6 + wp.y * 2.3)) * aWind.z * 0.03 * length(uWind);
  return off * iTree.w;
}`;

const LOD_FADE = /* glsl */ `
uniform vec2 uFade;   // x: fade-in end distance (0 = none), y: fade-out start distance
uniform float uFrame;
in float vTreeDist;
// Screen-door fade between levels of detail. The two neighbouring levels use complementary
// tests so every pixel is covered by exactly one of them.
void lodFade() {
  float dist = vTreeDist;
  float n = ign(gl_FragCoord.xy + uFrame * 5.588);
  if (uFade.x > 0.0 && n > (dist - uFade.x + 10.0) / 10.0) discard;
  if (uFade.y > 0.0 && n <= (dist - uFade.y) / 10.0) discard;
}`;

const WOOD_VERT = /* glsl */ `
${TREE_VERT_COMMON}
out vec3 vWorld; out vec3 vNormal; out vec2 vUv; out float vH; out float vTreeDist;
void main() {
  vTreeDist = distance(iTree.xyz, cameraPosition);
  vec3 wp = treeRotate(position) * iTree.w + iTree.xyz;
  wp += windOffset(wp);
  vWorld = wp; vNormal = treeRotate(normal); vUv = uv; vH = aWind.x;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const WOOD_FRAG = /* glsl */ `
${COMMON}
${SKYMAP}
${SKY_SAMPLE}
${SH_GLSL}
${TERRAIN_SAMPLING}
${LIGHTING}
${LOD_FADE}
uniform sampler2DArray uBarkA;
uniform sampler2DArray uBarkB;
uniform vec3 uBarkTint;
in vec3 vWorld; in vec3 vNormal; in vec2 vUv; in float vH;
void main() {
  lodFade();
  vec4 a = texture(uBarkA, vec3(vUv, 0.0)), b = texture(uBarkB, vec3(vUv, 0.0));
  vec3 N = normalize(vNormal);
  vec3 alb = a.rgb * uBarkTint;
#ifdef BAKE_ALBEDO
  gl_FragColor = vec4(alb, 1.0); return;
#endif
#ifdef BAKE_NORMAL
  gl_FragColor = vec4(N * 0.5 + 0.5, 0.75); return;
#endif
  vec3 V = normalize(cameraPosition - vWorld);
  // Under the canopy the wood sits in the crown's shade.
  float ao = b.a * mix(1.0, 0.45, smoothstep(0.1, 0.5, vH));
  float vis = sunVisibility(vWorld + N * 0.08 + uSunDir * 0.15) * mix(1.0, 0.5, smoothstep(0.08, 0.4, vH));
  gl_FragColor = vec4(shadeSurface(alb, b.b, 0.0, N, V, vis, ao, 0.0), 1.0);
}`;

const LEAF_VERT = /* glsl */ `
${TREE_VERT_COMMON}
in vec2 aLeaf;
out vec3 vWorld; out vec3 vNormal; out vec2 vUv; out vec3 vLeaf; out float vTreeDist;
void main() {
  vTreeDist = distance(iTree.xyz, cameraPosition);
  vec3 wp = treeRotate(position) * iTree.w + iTree.xyz;
  wp += windOffset(wp);
  vWorld = wp; vNormal = treeRotate(normal); vUv = uv; vLeaf = vec3(aLeaf, iParam.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

// Leaf shading shared by the card meshes and the far billboards. Nc is the smooth normal of
// the crown (it decides what the crown shades of itself), N the normal of the leaf itself.
const LEAF_SHADE = /* glsl */ `
vec3 shadeLeaves(vec3 alb, vec3 Nc, vec3 N, vec3 V, vec3 wp, float inner, float thin) {
  float ao = mix(1.0, 0.24, inner);
  float tv = sunVisibility(wp + uSunDir * 0.7);
  // The crown shades its own far side and its core; the rim stays bright.
  float self = smoothstep(-0.55, 0.45, dot(Nc, uSunDir));
  float vis = tv * mix(1.0, self, 0.85) * mix(1.0, 0.3, inner);
  vec3 col = shadeSurface(alb, 0.52, 0.0, N, V, vis, ao, 0.0);
  // Thin leaves glow when the sun is behind them, mostly around the edge of the crown. The
  // light that comes through a leaf is yellower and more saturated than what it reflects.
  float back = pow(saturate(dot(-V, uSunDir)), 3.0) * 0.9 + saturate(dot(-N, uSunDir)) * 0.4;
  vec3 through = mix(alb, sqrt(alb) * 0.5, 0.5) * vec3(1.1, 1.0, 0.7);
  col += through * uSunColor * 0.3183 * back * tv * (1.0 - inner * 0.85) * 0.6 * thin;
  return col;
}`;

const LEAF_FRAG = /* glsl */ `
${COMMON}
${SKYMAP}
${SKY_SAMPLE}
${SH_GLSL}
${TERRAIN_SAMPLING}
${LIGHTING}
${LOD_FADE}
${LEAF_SHADE}
uniform sampler2DArray uLeaves;
uniform sampler2DArray uLeavesB;
uniform float uLeafLayer;
uniform float uLeafTile;     // sprays per card edge: 1 for ordinary trees, more for the colossal one
in vec3 vWorld; in vec3 vNormal; in vec2 vUv; in vec3 vLeaf;
void main() {
  vec2 uvt = vUv * uLeafTile, dux = dFdx(uvt), duy = dFdy(uvt);
  vec4 t = textureGrad(uLeaves, vec3(fract(uvt), uLeafLayer), dux, duy);
  vec4 tb = textureGrad(uLeavesB, vec3(fract(uvt), uLeafLayer), dux, duy);
#ifdef LEAF_TILED
  // A second layer of sprays, turned and shifted half a tile, fills the gaps between the
  // first so the tiles never line up into rows of dots.
  vec2 uv2 = uvt.yx * 1.31 + 0.5;
  vec4 t2 = textureGrad(uLeaves, vec3(fract(uv2), uLeafLayer), dux.yx * 1.31, duy.yx * 1.31);
  if (t2.a > t.a) { t = t2; tb = textureGrad(uLeavesB, vec3(fract(uv2), uLeafLayer), dux.yx * 1.31, duy.yx * 1.31); tb.rg = tb.gr; }
#endif
  vec3 dpx = dFdx(vWorld), dpy = dFdy(vWorld);
  // Far crowns keep more of each card so they stay full instead of thinning into specks.
#if defined(BAKE_ALBEDO) || defined(BAKE_NORMAL)
  if (t.a < 0.22) discard;
#elif defined(FIXED_ALPHA)
  // Hanging curtains keep their ragged outline at any distance instead of filling in.
  if (t.a < 0.36) discard;
#else
  if (t.a < mix(0.4, 0.2, saturate(vTreeDist / 110.0))) discard;
#endif
  lodFade();
  // Per-tree and per-card colour drift.
  vec3 alb = t.rgb * mix(vec3(0.8, 0.86, 0.92), vec3(1.18, 1.07, 0.94), vLeaf.z) * (0.84 + 0.3 * vLeaf.y);
  // Some sprays of a red or pink crown turn toward orange and peach, as real crowns do.
  alb.g += 0.3 * alb.r * step(alb.g, alb.r * 0.62) * smoothstep(0.58, 0.95, fract(vLeaf.y * 7.31 + vLeaf.z));
  vec3 Nc = normalize(vNormal);
  // Each leaf leans its own way: tilt the crown normal by the baked leaf normal, using the
  // card's frame rebuilt from screen-space derivatives.
  float det = dux.x * duy.y - duy.x * dux.y;
  vec3 T = (dpx * duy.y - dpy * dux.y) * sign(det), Bt = (dpy * dux.x - dpx * duy.x) * sign(det);
  vec2 tl = (tb.rg - 0.5) * 2.0;
  vec3 N = normalize(Nc + (normalize(T + 1e-9) * tl.x + normalize(Bt + 1e-9) * tl.y) * 0.85);
#ifdef BAKE_ALBEDO
  gl_FragColor = vec4(alb, 1.0); return;
#endif
#ifdef BAKE_NORMAL
  gl_FragColor = vec4(normalize(mix(Nc, N, 0.6)) * 0.5 + 0.5, 1.0 - vLeaf.x * 0.9); return;
#endif
  vec3 V = normalize(cameraPosition - vWorld);
  gl_FragColor = vec4(shadeLeaves(alb, Nc, N, V, vWorld, vLeaf.x, tb.b), 1.0);
}`;

const IMP_VERT = /* glsl */ `
in vec4 iTree;     // xyz position, w scale
in vec4 iParam;    // x yaw, y seed, z atlas row, w quad size (m, unscaled)
out vec2 vUv; out vec3 vWorld; out vec4 vInfo; out float vTreeDist;
void main() {
  vec3 toCam = cameraPosition - iTree.xyz;
  vTreeDist = length(toCam);
  vec2 dir = normalize(toCam.xz);
  vec3 right = vec3(dir.y, 0.0, -dir.x);
  float size = iParam.w * iTree.w;
  vec3 wp = iTree.xyz + right * position.x * size * 0.5 + vec3(0.0, position.y * size, 0.0);
  // Pick the baked view closest to where the camera sits in the tree's own frame.
  float phi = atan(dir.y, dir.x) + iParam.x;
  float frame = mod(floor(phi / 6.2831853 * ${FRAMES}.0 + 0.5), ${FRAMES}.0);
  vUv = vec2((frame + position.x * 0.5 + 0.5) / ${FRAMES}.0, position.y);
  vWorld = wp;
  vInfo = vec4(iParam.x, iParam.y, iParam.z, frame);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const IMP_FRAG = /* glsl */ `
${COMMON}
${SKYMAP}
${SKY_SAMPLE}
${SH_GLSL}
${TERRAIN_SAMPLING}
${LIGHTING}
${LEAF_SHADE}
uniform sampler2D uImpA;
uniform sampler2D uImpB;
uniform float uRows;
uniform float uFrame;
in vec2 vUv; in vec3 vWorld; in vec4 vInfo; in float vTreeDist;
void main() {
  vec2 uv = vec2(vUv.x, (vInfo.z + clamp(vUv.y, 0.004, 0.996)) / uRows);
  vec4 a = texture(uImpA, uv);
  if (a.a < 0.5) discard;
  // Hand over from the mid-detail mesh.
  if (ign(gl_FragCoord.xy + uFrame * 5.588) > (vTreeDist - ${(MID - 10).toFixed(1)}) / 10.0) discard;
  vec4 b = texture(uImpB, uv);
  vec3 n = normalize(b.xyz * 2.0 - 1.0);
  float c = cos(vInfo.x), s = sin(vInfo.x);
  vec3 N = vec3(c * n.x + s * n.z, n.y, -s * n.x + c * n.z);
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 alb = a.rgb * mix(vec3(0.78, 0.84, 0.92), vec3(1.2, 1.08, 0.94), vInfo.y);
  gl_FragColor = vec4(shadeLeaves(alb, N, N, V, vWorld, 1.0 - b.a, 0.8), 1.0);
}`;

const WOOD_DEPTH_VERT = /* glsl */ `
${TREE_VERT_COMMON}
void main() {
  vec3 wp = treeRotate(position) * iTree.w + iTree.xyz;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp + windOffset(wp), 1.0);
}`;
const LEAF_DEPTH_VERT = /* glsl */ `
${TREE_VERT_COMMON}
out vec2 vUv;
void main() {
  vec3 wp = treeRotate(position) * iTree.w + iTree.xyz;
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp + windOffset(wp), 1.0);
}`;
const LEAF_DEPTH_FRAG = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray uLeaves;
uniform float uLeafLayer;
in vec2 vUv;
void main() { if (texture(uLeaves, vec3(vUv, uLeafLayer)).a < 0.4) discard; }`;
// Far trees enter the static shadow map as quads turned to face the sun.
const IMP_DEPTH_VERT = /* glsl */ `
in vec4 iTree; in vec4 iParam;
uniform vec3 uSunDir;
uniform vec3 uCamPos;
uniform float uSkipNear;
out vec2 vUv; out float vRow;
void main() {
  // In the camera cascades, trees close enough to be real meshes are left out here.
  if (uSkipNear > 0.0 && distance(iTree.xyz, uCamPos) < uSkipNear) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 dir = normalize(uSunDir.xz);
  vec3 right = vec3(dir.y, 0.0, -dir.x);
  float size = iParam.w * iTree.w;
  vec3 wp = iTree.xyz + right * position.x * size * 0.5 + vec3(0.0, position.y * size, 0.0);
  float phi = atan(dir.y, dir.x) + iParam.x;
  float frame = mod(floor(phi / 6.2831853 * 8.0 + 0.5), 8.0);
  vUv = vec2((frame + position.x * 0.5 + 0.5) / 8.0, position.y);
  vRow = iParam.z;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;
const IMP_DEPTH_FRAG = /* glsl */ `
uniform sampler2D uImpA;
uniform float uRows;
in vec2 vUv; in float vRow;
void main() { if (texture(uImpA, vec2(vUv.x, (vRow + clamp(vUv.y, 0.004, 0.996)) / uRows)).a < 0.5) discard; }`;

function geometryFrom(data, extra = {}) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(data.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(data.normal, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(data.uv, 2));
  g.setAttribute('aWind', new THREE.BufferAttribute(data.wind, 3));
  if (data.leaf) g.setAttribute('aLeaf', new THREE.BufferAttribute(data.leaf, 2));
  g.setIndex(new THREE.BufferAttribute(data.index, 1));
  Object.assign(g, extra);
  return g;
}

const SHRUB_FAR = FILM ? 150 : 84, SHRUB_CELL = 48;
const BARK_TINT = { ember: [0.8, 0.72, 0.7], blossom: [0.62, 0.52, 0.52], elder: [1.25, 1.2, 1.15], cypress: [0.95, 0.72, 0.6], green: [0.9, 0.85, 0.75] };

export class Forest {
  constructor(pipe, terrain) {
    this.pipe = pipe; this.terrain = terrain;
    const r = pipe.renderer, g = pipe.globals;
    this.group = new THREE.Group();
    this.wind = new THREE.Vector3(0.7, 0, 0.35);
    const atlas = bakeLeafAtlas(r, FILM ? 1024 : 512);
    this.leafAtlas = atlas.a; this.leafAtlasB = atlas.b;
    this.bark = new TextureForge(r).bake([{ name: 'bark', code: BARK, bump: 12 }], 512);

    const shared = { ...pipe.lit(), uWind: { value: this.wind } };
    const D = pipe.depthDefines;
    this.shared = shared;
    const mkWood = (tint, fade, defines = {}) => new THREE.ShaderMaterial({
      vertexShader: WOOD_VERT, fragmentShader: WOOD_FRAG, defines: { ...D, ...defines },
      uniforms: { ...shared, uBarkA: { value: this.bark.a }, uBarkB: { value: this.bark.b }, uBarkTint: { value: new THREE.Vector3(...tint) }, uFade: { value: new THREE.Vector2(...fade) } },
    });
    const mkLeaf = (layer, fade, defines = {}, tile = 1) => new THREE.ShaderMaterial({
      vertexShader: LEAF_VERT, fragmentShader: LEAF_FRAG, defines: { ...D, ...defines }, side: THREE.DoubleSide,
      uniforms: { ...shared, uLeaves: { value: this.leafAtlas }, uLeavesB: { value: this.leafAtlasB }, uLeafLayer: { value: layer }, uLeafTile: { value: tile }, uFade: { value: new THREE.Vector2(...fade) } },
    });

    const woodDepth = new THREE.ShaderMaterial({ vertexShader: WOOD_DEPTH_VERT, fragmentShader: 'void main() {}', uniforms: shared, colorWrite: false });
    const leafDepths = {};
    const leafDepth = (layer) => (leafDepths[layer] ??= new THREE.ShaderMaterial({
      vertexShader: LEAF_DEPTH_VERT, fragmentShader: LEAF_DEPTH_FRAG, side: THREE.DoubleSide, colorWrite: false,
      uniforms: { ...shared, uLeaves: { value: this.leafAtlas }, uLeafLayer: { value: layer } },
    }));

    this._mkWood = mkWood; this._mkLeaf = mkLeaf;
    // Build every variant at both mesh levels of detail.
    this.variants = VARIANTS.map(([species, seed], vi) => {
      const tree = generateTree(species, seed * 17 + vi);
      const layer = SPECIES[species].leaf;
      const lods = [
        { max: FILM ? 260 : 96, wood: buildWood(tree, 2, [9, 6, 4, 3]), leaves: buildLeaves(tree, 1, 1), fade: [0, NEAR - 10] },
        { max: FILM ? 2400 : 768, wood: buildWood(tree, 1, [6, 4, 3, 3]), leaves: buildLeaves(tree, 0.2, 1.75), fade: [NEAR, MID - 10] },
      ].map((l, li) => {
        const iTree = new THREE.InstancedBufferAttribute(new Float32Array(l.max * 4), 4);
        const iParam = new THREE.InstancedBufferAttribute(new Float32Array(l.max * 4), 4);
        iTree.setUsage(THREE.DynamicDrawUsage); iParam.setUsage(THREE.DynamicDrawUsage);
        const meshes = [[l.wood, mkWood(BARK_TINT[species], l.fade)], [l.leaves, mkLeaf(layer, l.fade)]].map(([data, mat], k) => {
          const geo = geometryFrom(data);
          geo.setAttribute('iTree', iTree); geo.setAttribute('iParam', iParam);
          geo.instanceCount = 0;
          const m = new THREE.Mesh(geo, mat);
          m.frustumCulled = false; m.matrixAutoUpdate = false;
          this.group.add(m);
          // Only the near meshes cast real shadows; everything farther is drawn into the
          // shadow maps as a sun-facing billboard, which costs two triangles per tree.
          if (li === 0) pipe.shadows.addCaster(m, k === 0 ? woodDepth : leafDepth(layer));
          return m;
        });
        return { ...l, iTree, iParam, meshes, count: 0 };
      });
      const halfW = Math.max(tree.crownRadius * 1.05, 1.5);
      const size = Math.max(tree.height + 1.2, halfW * 2) * 1.04;
      return { species, tree, layer, lods, size };
    });

    this._bakeImpostors(mkWood, mkLeaf);
    this.trees = [];
    this.chunks = new Map();
  }

  // Renders each variant from 8 directions into an albedo atlas and a normal/occlusion atlas.
  _bakeImpostors(mkWood, mkLeaf) {
    const r = this.pipe.renderer, rows = this.variants.length;
    const mkRT = (srgb) => {
      const rt = new THREE.WebGLRenderTarget(FRAMES * CELL, rows * CELL, { depthBuffer: true, type: THREE.UnsignedByteType, format: THREE.RGBAFormat, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
      rt.texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      return rt;
    };
    this.impA = mkRT(true); this.impB = mkRT(false);
    const one = () => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array([0, 0, 0, 1]), 4), b = new THREE.InstancedBufferAttribute(new Float32Array([0, 0.5, 0, 0]), 4);
      return [a, b];
    };
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    const oldWind = this.wind.clone();
    this.wind.set(0, 0, 0);
    const prevColor = new THREE.Color(); r.getClearColor(prevColor); const prevAlpha = r.getClearAlpha();
    for (const [target, def, clear] of [[this.impA, { BAKE_ALBEDO: 1 }, 0x000000], [this.impB, { BAKE_NORMAL: 1 }, 0x8080ff]]) {
      r.setRenderTarget(target);
      r.setClearColor(clear, 0);
      r.clear(true, true, false);
      this.variants.forEach((v, row) => {
        const [iTree, iParam] = one();
        const scene = new THREE.Scene();
        const mats = [mkWood(BARK_TINT[v.species], [0, 0], def), mkLeaf(v.layer, [0, 0], def)];
        [v.lods[0].wood, v.lods[0].leaves].forEach((data, k) => {
          const geo = geometryFrom(data);
          geo.setAttribute('iTree', iTree); geo.setAttribute('iParam', iParam);
          geo.instanceCount = 1;
          const m = new THREE.Mesh(geo, mats[k]);
          m.frustumCulled = false;
          scene.add(m);
        });
        const half = v.size / 2;
        cam.left = -half; cam.right = half; cam.bottom = 0; cam.top = v.size;
        cam.updateProjectionMatrix();
        for (let f = 0; f < FRAMES; f++) {
          const phi = (f / FRAMES) * Math.PI * 2;
          cam.position.set(Math.cos(phi) * 80, 0, Math.sin(phi) * 80);
          cam.up.set(0, 1, 0);
          cam.lookAt(0, 0, 0);
          cam.position.y = 0;
          cam.updateMatrixWorld();
          target.viewport.set(f * CELL, row * CELL, CELL, CELL);
          target.scissor.set(f * CELL, row * CELL, CELL, CELL);
          target.scissorTest = true;
          r.setRenderTarget(target);
          r.render(scene, cam);
        }
        mats.forEach((m) => m.dispose());
      });
      target.scissorTest = false;
      target.viewport.set(0, 0, FRAMES * CELL, rows * CELL);
    }
    r.setClearColor(prevColor, prevAlpha);
    r.setRenderTarget(null);
    this.wind.copy(oldWind);

    this.impMaterial = new THREE.ShaderMaterial({
      vertexShader: IMP_VERT, fragmentShader: IMP_FRAG, defines: this.pipe.depthDefines,
      uniforms: { ...this.shared, uImpA: { value: this.impA.texture }, uImpB: { value: this.impB.texture }, uRows: { value: rows } },
    });
    const impDepth = (skipNear) => new THREE.ShaderMaterial({
      vertexShader: IMP_DEPTH_VERT, fragmentShader: IMP_DEPTH_FRAG, colorWrite: false,
      uniforms: { uSunDir: this.pipe.globals.uSunDir, uImpA: { value: this.impA.texture }, uRows: { value: rows }, uCamPos: this.pipe.camUniforms.uCamPos, uSkipNear: { value: skipNear } },
    });
    this.impDepth = impDepth(0);
    this.impDepthCsm = impDepth(NEAR - 6);
    const q = new THREE.BufferGeometry();
    q.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0]), 3));
    q.setIndex([0, 1, 2, 0, 2, 3]);
    this.impQuad = q;
  }

  // One colossal tree, drawn as a single always-visible mesh pair.
  addGreatTree(x, y, z) {
    const tree = generateTree('great', 4);
    const one = (arr) => new THREE.InstancedBufferAttribute(new Float32Array(arr), 4);
    const iTree = one([x, y, z, 1]), iParam = one([0.6, 0.35, SPECIES.great.leaf, 0]);
    const parts = [[buildWood(tree, 3, [14, 9, 6, 4]), this._mkWood(BARK_TINT.elder, [0, 0])], [buildLeaves(tree, 1, 1), this._mkLeaf(SPECIES.great.leaf, [0, 0], { LEAF_TILED: 1 }, 4)]];
    for (const [data, mat] of parts) {
      const geo = geometryFrom(data);
      geo.setAttribute('iTree', iTree); geo.setAttribute('iParam', iParam);
      geo.instanceCount = 1;
      const m = new THREE.Mesh(geo, mat);
      m.frustumCulled = false; m.matrixAutoUpdate = false;
      this.group.add(m);
    }
    return tree;
  }

  // Scatters trees with noise-driven groves. Returns the number placed.
  populate(exclude = () => false, extra = []) {
    const T = this.terrain, rnd = mulberry32(90210);
    const byName = {};
    this.variants.forEach((v, i) => { (byName[v.species] ??= []).push(i); });
    const pick = (name) => { const l = byName[name]; return l[Math.floor(rnd() * l.length)]; };
    const trees = this.trees;
    const scatter = (half, cell, inner, far) => {
      for (let gz = -half; gz < half; gz += cell) for (let gx = -half; gx < half; gx += cell) {
        const x = gx + rnd() * cell, z = gz + rnd() * cell, r1 = rnd(), r2 = rnd(), r3 = rnd(), r4 = rnd();
        if (Math.max(Math.abs(x), Math.abs(z)) < inner) continue;
        if (far && x * x + z * z > half * half) continue;
        const h = T.heightAt(x, z);
        if (h < 1.3 || h > 900) continue;
        const e = far ? 6 : 1.6;
        const sx = T.heightAt(x + e, z) - T.heightAt(x - e, z), sz = T.heightAt(x, z + e) - T.heightAt(x, z - e);
        if (Math.hypot(sx, sz) / (2 * e) > 0.42) continue;
        const grove = fbm(x / 170, z / 170, 3, 501) * 0.5 + 0.5;
        const low = h < 62;
        let density = low ? smoothstep(0.4, 0.62, grove) * 0.7 : smoothstep(0.5, 0.7, grove) * 0.5;
        density = Math.max(density, 0.03) * (far ? 1.6 : 1);
        if (r1 > density || exclude(x, z)) continue;
        const kind = fbm(x / 290, z / 290, 2, 777) * 0.5 + 0.5;
        let sp;
        if (r2 < 0.12) sp = 'cypress';
        else if (low) sp = r3 < 0.9 ? 'green' : r3 < 0.94 ? 'ember' : r3 < 0.97 ? 'elder' : 'blossom';   // the lowland forest is green; colour is an accent
        else if (kind < 0.4) sp = r3 < 0.5 ? 'ember' : r3 < 0.88 ? 'green' : 'elder';
        else if (kind < 0.55) sp = r3 < 0.5 ? 'blossom' : r3 < 0.8 ? 'green' : 'ember';
        else sp = r3 < 0.68 ? 'green' : r3 < 0.86 ? 'elder' : 'blossom';
        trees.push({ x, y: h - 0.15, z, s: 0.8 + 0.5 * r4, yaw: rnd() * 6.283, seed: rnd(), v: pick(sp) });
      }
    };
    scatter(1000, 7.5, 0, false);
    scatter(4600, 15, 1000, true);
    // Hand-placed trees that frame particular views.
    for (const e of extra) trees.push({ x: e.x, y: T.heightAt(e.x, e.z) - 0.15, z: e.z, s: e.scale ?? 1, yaw: rnd() * 6.283, seed: rnd(), v: pick(e.species) });
    this._buildChunks();
    return trees.length;
  }

  _buildChunks() {
    const C = 128;
    this.chunkSize = C;
    for (const t of this.trees) {
      const key = Math.floor(t.x / C) + ',' + Math.floor(t.z / C);
      let c = this.chunks.get(key);
      if (!c) { c = { cx: Math.floor(t.x / C), cz: Math.floor(t.z / C), list: [] }; this.chunks.set(key, c); }
      c.list.push(t);
    }
    // Far billboards: one instanced mesh per block (smaller blocks in the core where culling
    // matters most, big ones outside to keep the draw count down).
    const blocks = new Map();
    for (const t of this.trees) {
      const B = Math.max(Math.abs(t.x), Math.abs(t.z)) < 1024 ? 512 : 1536;
      const key = B + ':' + Math.floor(t.x / B) + ',' + Math.floor(t.z / B);
      (blocks.get(key) ?? blocks.set(key, []).get(key)).push(t);
    }
    for (const list of blocks.values()) {
      const n = list.length, a = new Float32Array(n * 4), b = new Float32Array(n * 4);
      const box = new THREE.Box3();
      list.forEach((t, i) => {
        const v = this.variants[t.v];
        a.set([t.x, t.y, t.z, t.s], i * 4);
        b.set([t.yaw, t.seed, t.v, v.size], i * 4);
        box.expandByPoint(_v.set(t.x, t.y, t.z)); box.expandByPoint(_v.set(t.x, t.y + v.size * t.s, t.z));
      });
      const geo = new THREE.InstancedBufferGeometry();
      geo.setAttribute('position', this.impQuad.getAttribute('position'));
      geo.setIndex(this.impQuad.getIndex());
      geo.setAttribute('iTree', new THREE.InstancedBufferAttribute(a, 4));
      geo.setAttribute('iParam', new THREE.InstancedBufferAttribute(b, 4));
      geo.instanceCount = n;
      geo.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
      geo.boundingSphere.radius += 30;
      const m = new THREE.Mesh(geo, this.impMaterial);
      m.matrixAutoUpdate = false;
      this.group.add(m);
      this.pipe.shadows.addCaster(m, this.impDepthCsm, { dynamic: true, fixed: true, staticMat: this.impDepth });
    }
  }

  // Refills the near and mid instance buffers from the chunks around the camera.
  // Shrubs: low bushes, some in flower, thickest around the edges of the groves. They ride
  // the tree pipeline with one level of detail and no billboard: past SHRUB_FAR they are gone.
  addShrubs(exclude) {
    const T = this.terrain, rnd = mulberry32(60611), C = SHRUB_CELL;
    // [leaf layer, share of all shrubs]
    const kinds = [[4, 0.62], [1, 0.2], [2, 0.18]];
    this.shrubs = kinds.map(([layer], k) => {
      const tree = generateTree('shrub', 301 + k * 7), max = FILM ? 900 : 320;
      const iTree = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
      const iParam = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
      iTree.setUsage(THREE.DynamicDrawUsage); iParam.setUsage(THREE.DynamicDrawUsage);
      const fade = [0, SHRUB_FAR - 12];
      const meshes = [[buildWood(tree, 1, [5, 4, 3, 3]), this._mkWood(BARK_TINT.green, fade)], [buildLeaves(tree, 1, 1), this._mkLeaf(layer, fade)]].map(([data, mat]) => {
        const geo = geometryFrom(data);
        geo.setAttribute('iTree', iTree); geo.setAttribute('iParam', iParam);
        geo.instanceCount = 0;
        const m = new THREE.Mesh(geo, mat);
        m.frustumCulled = false; m.matrixAutoUpdate = false; m.visible = false;
        this.group.add(m);
        return m;
      });
      return { layer, iTree, iParam, meshes, count: 0, max };
    });
    this.shrubCells = new Map();
    this._listPos = null;
    const step = 6.5, half = 1000;
    let n = 0;
    for (let gz = -half; gz < half; gz += step) for (let gx = -half; gx < half; gx += step) {
      const x = gx + rnd() * step, z = gz + rnd() * step, r1 = rnd(), r2 = rnd(), r3 = rnd();
      const h = T.heightAt(x, z);
      if (h < 1.6 || h > 300) continue;
      const e = 1.5, sx = T.heightAt(x + e, z) - T.heightAt(x - e, z), sz = T.heightAt(x, z + e) - T.heightAt(x, z - e);
      if (Math.hypot(sx, sz) / (2 * e) > 0.4) continue;
      // The same grove noise the trees use: bushes ring the groves and thin out in the open.
      const grove = fbm(x / 170, z / 170, 3, 501) * 0.5 + 0.5;
      const edge = smoothstep(0.36, 0.5, grove) * (1 - smoothstep(0.6, 0.8, grove));
      if (r1 > 0.03 + 0.3 * edge || exclude(x, z)) continue;
      const k = r2 < kinds[0][1] ? 0 : r2 < kinds[0][1] + kinds[1][1] ? 1 : 2;
      const key = Math.floor(x / C) + ',' + Math.floor(z / C);
      let c = this.shrubCells.get(key);
      if (!c) this.shrubCells.set(key, c = []);
      c.push({ x, y: h - 0.06, z, s: 0.7 + 0.75 * r3, yaw: rnd() * 6.283, seed: rnd(), k });
      n++;
    }
    return n;
  }

  // One shrub at an exact spot (a planter, say). kind: 0 green, 1 pink blossom, 2 lilac.
  addShrubAt(x, y, z, scale = 0.6, kind = 1) {
    const key = Math.floor(x / SHRUB_CELL) + ',' + Math.floor(z / SHRUB_CELL);
    let c = this.shrubCells.get(key);
    if (!c) this.shrubCells.set(key, c = []);
    c.push({ x, y, z, s: scale, yaw: (x * 12.9898 + z * 78.233) % 6.283, seed: Math.abs(Math.sin(x * 3.7 + z * 1.3)), k: kind });
    this._listPos = null;
  }

  _updateShrubs(cam) {
    for (const s of this.shrubs) s.count = 0;
    const C = SHRUB_CELL, R = Math.ceil((SHRUB_FAR + 4) / C);
    const ccx = Math.floor(cam.x / C), ccz = Math.floor(cam.z / C);
    for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
      const c = this.shrubCells.get((ccx + i) + ',' + (ccz + j));
      if (!c) continue;
      for (const t of c) {
        if (Math.hypot(t.x - cam.x, t.y - cam.y, t.z - cam.z) > SHRUB_FAR + 2) continue;
        const s = this.shrubs[t.k];
        if (s.count >= s.max) continue;
        const o = s.count * 4;
        s.iTree.array[o] = t.x; s.iTree.array[o + 1] = t.y; s.iTree.array[o + 2] = t.z; s.iTree.array[o + 3] = t.s;
        s.iParam.array[o] = t.yaw; s.iParam.array[o + 1] = t.seed; s.iParam.array[o + 2] = s.layer; s.iParam.array[o + 3] = 0;
        s.count++;
      }
    }
    for (const s of this.shrubs) {
      for (const m of s.meshes) { m.geometry.instanceCount = s.count; m.visible = s.count > 0; }
      if (s.count) for (const at of [s.iTree, s.iParam]) { at.clearUpdateRanges(); at.addUpdateRange(0, s.count * 4); at.needsUpdate = true; }
    }
  }

  update(camera) {
    const cam = _v.setFromMatrixPosition(camera.matrixWorld);
    // The lists carry a margin of a couple of metres beyond every fade band, so they only
    // need rebuilding once the camera has moved a little. Most frames skip all of this.
    if (this._listPos && cam.distanceToSquared(this._listPos) < 1.44 && this._listTrees === this.trees.length) return;
    (this._listPos ??= new THREE.Vector3()).copy(cam); this._listTrees = this.trees.length;
    if (this.shrubs) this._updateShrubs(cam);
    for (const v of this.variants) for (const l of v.lods) l.count = 0;
    const C = this.chunkSize, R = Math.ceil((MID + 10) / C);
    const ccx = Math.floor(cam.x / C), ccz = Math.floor(cam.z / C);
    for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
      const c = this.chunks.get((ccx + i) + ',' + (ccz + j));
      if (!c) continue;
      for (const t of c.list) {
        const d = Math.hypot(t.x - cam.x, t.y - cam.y, t.z - cam.z);
        if (d > MID + 4) continue;
        const v = this.variants[t.v];
        for (let li = 0; li < 2; li++) {
          if (li === 0 ? d > NEAR + 2 : d < NEAR - 12) continue;
          const l = v.lods[li];
          if (l.count >= l.max) continue;
          const o = l.count * 4;
          l.iTree.array[o] = t.x; l.iTree.array[o + 1] = t.y; l.iTree.array[o + 2] = t.z; l.iTree.array[o + 3] = t.s;
          l.iParam.array[o] = t.yaw; l.iParam.array[o + 1] = t.seed; l.iParam.array[o + 2] = v.layer; l.iParam.array[o + 3] = 0;
          l.count++;
        }
      }
    }
    for (const v of this.variants) for (const l of v.lods) {
      for (const m of l.meshes) { m.geometry.instanceCount = l.count; m.visible = l.count > 0; }
      if (l.count) {
        for (const at of [l.iTree, l.iParam]) { at.clearUpdateRanges(); at.addUpdateRange(0, l.count * 4); at.needsUpdate = true; }
      }
    }
  }
}

const _v = new THREE.Vector3();
