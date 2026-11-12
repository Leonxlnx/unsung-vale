// Object shadows. The sun never moves during play, so shadows are split three ways:
//   - terrain shadows come from the baked height-shadow maps (see terrain.js)
//   - a large static shadow map, rendered once at load, covers every fixed object in the core
//   - two small cascades around the camera add crisp detail and anything that moves
// Each frame therefore only pays for the two cascades.
import * as THREE from 'three';

export const SHADOW_GLSL = /* glsl */ `
uniform sampler2DShadow uShadowCsm;
uniform sampler2DShadow uShadowStatic;
uniform mat4 uCsmMat[2];
uniform mat4 uStaticMat;
uniform vec4 uShadowInfo;    // x: cascade texel (uv), y: static texel (uv), z: cascade fade distance, w: enabled

float shadowTap(sampler2DShadow tex, vec3 c) {
#ifdef REVERSED_DEPTH
  return texture(tex, c);
#else
  return texture(tex, vec3(c.xy, c.z * 0.5 + 0.5));
#endif
}
// 3x3 PCF built from four bilinear comparison taps plus the centre.
float shadowPcf(sampler2DShadow tex, vec3 c, vec2 texel) {
  float s = shadowTap(tex, c) * 2.0;
  s += shadowTap(tex, c + vec3(-texel.x, -texel.y, 0.0)) + shadowTap(tex, c + vec3(texel.x, -texel.y, 0.0));
  s += shadowTap(tex, c + vec3(-texel.x, texel.y, 0.0)) + shadowTap(tex, c + vec3(texel.x, texel.y, 0.0));
  return s / 6.0;
}
#ifdef SOFT_SHADOWS
uniform sampler2D uShadowRaw;   // the cascades again, readable as plain depth for the blocker search
uniform vec4 uSoft;             // x: 0 off, 0.75 near cascade only, 1 both; y: frame index, zw: penumbra (uv) per unit of depth, cascade 0 / 1
uniform vec4 uSoftLimit;        // xy: widest penumbra (uv) for cascade 0 / 1, z: narrowest (uv), w: unused
const vec2 DISC[12] = vec2[12](vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621),
  vec2(0.962, -0.195), vec2(0.473, -0.480), vec2(0.519, 0.767), vec2(0.185, -0.893),
  vec2(0.507, 0.064), vec2(0.896, 0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598));
// Soft shadows: measure how far above the receiver its blockers sit and widen the filter in
// proportion, so a shadow is crisp at the foot of the thing that casts it and soft far away.
// uv is local to cascade i; z is the receiver's depth as stored in the map; dz is how that
// depth changes across the map, so a sloping receiver is not taken for its own blocker.
float softShadow(int i, vec2 uv, float z, float bias, vec2 dz) {
  float rmax = i == 0 ? uSoftLimit.x : uSoftLimit.y;
  float a = ign(gl_FragCoord.xy + uSoft.y * 5.588) * 6.2831853;
  vec2 rx = vec2(cos(a), sin(a)), ry = vec2(-rx.y, rx.x);
  float sum = 0.0, cnt = 0.0;
  // Nine taps: the receiver's own spot, then a ring that crowds toward the centre so thin
  // casters close by (a leg, a sword) are found as surely as broad ones far away.
  for (int k = 0; k < 9; k++) {
    vec2 o = k == 0 ? vec2(0.0) : DISC[k - 1] * length(DISC[k - 1]);
    vec2 q = clamp(uv + (rx * o.x + ry * o.y) * rmax, 0.003, 0.997);
    float d = textureLod(uShadowRaw, vec2((q.x + float(i)) * 0.5, q.y), 0.0).r;
    float zq = z + dot(q - uv, dz);
#ifdef REVERSED_DEPTH
    float b = step(zq + bias, d);
#else
    float b = step(d, zq - bias);
#endif
    sum += d * b; cnt += b;
  }
  if (cnt < 0.5) return 1.0;
  if (cnt > 8.5) return 0.0;
  float pen = clamp(abs(sum / cnt - z) * (i == 0 ? uSoft.z : uSoft.w), uSoftLimit.z, rmax);
  float s = 0.0;
  for (int k = 0; k < 12; k++) {
    vec2 q = clamp(uv + (rx * DISC[k].x + ry * DISC[k].y) * pen, 0.003, 0.997);
    float zq = z + dot(q - uv, dz);
#ifdef REVERSED_DEPTH
    s += textureLod(uShadowCsm, vec3((q.x + float(i)) * 0.5, q.y, zq + bias), 0.0);
#else
    s += textureLod(uShadowCsm, vec3((q.x + float(i)) * 0.5, q.y, zq - bias), 0.0);
#endif
  }
  return s / 12.0;
}
#endif
// 1 = lit, 0 = shadowed by an object. p should already be nudged off the surface.
// One exit only: some shader compilers mishandle several returns inside the cascade loop.
float objectShadow(vec3 p) {
  float lit = -1.0;
#ifdef SOFT_SHADOWS
  vec3 dpx = dFdx(p), dpy = dFdy(p);
#endif
  if (uShadowInfo.w < 0.5) lit = 1.0;
  for (int i = 0; i < 2; i++) {
    if (lit >= 0.0) break;
    vec3 n = (uCsmMat[i] * vec4(p, 1.0)).xyz;
    vec2 e = abs(n.xy);
    if (max(e.x, e.y) >= 0.96) continue;
    vec2 uv = n.xy * 0.5 + 0.5;
    float bias = (i == 0 ? 0.0006 : 0.0016);
#ifdef REVERSED_DEPTH
    float z = n.z, zb = bias;
#else
    float z = n.z * 0.5 + 0.5, zb = bias * 0.5;
#endif
#ifdef SOFT_SHADOWS
    if (uSoft.x > (i == 0 ? 0.5 : 0.9)) {
      // How the receiver's depth changes across the map, from its screen-space slope.
      vec3 sx = mat3(uCsmMat[i]) * dpx, sy = mat3(uCsmMat[i]) * dpy;
      vec2 ux = sx.xy * 0.5, uy = sy.xy * 0.5;
      float det = ux.x * uy.y - ux.y * uy.x;
      vec2 dz = abs(det) > 1e-14 ? vec2(uy.y * sx.z - ux.y * sy.z, ux.x * sy.z - uy.x * sx.z) / det : vec2(0.0);
#ifndef REVERSED_DEPTH
      dz *= 0.5;
#endif
      float lim = 0.02 / (i == 0 ? uSoftLimit.x : uSoftLimit.y);
      lit = softShadow(i, uv, z, zb, clamp(dz, vec2(-lim), vec2(lim)));
    } else
#endif
    {
#ifdef REVERSED_DEPTH
      lit = shadowPcf(uShadowCsm, vec3((uv.x + float(i)) * 0.5, uv.y, n.z + bias), vec2(uShadowInfo.x * 0.5, uShadowInfo.x));
#else
      lit = shadowPcf(uShadowCsm, vec3((uv.x + float(i)) * 0.5, uv.y, n.z - bias), vec2(uShadowInfo.x * 0.5, uShadowInfo.x));
#endif
    }
  }
  if (lit < 0.0) {
    vec4 c = uStaticMat * vec4(p, 1.0);
    vec2 e = abs(c.xy);
    lit = 1.0;
    if (max(e.x, e.y) <= 0.995) {
#ifdef REVERSED_DEPTH
      lit = shadowPcf(uShadowStatic, vec3(c.xy * 0.5 + 0.5, c.z + 0.0025), vec2(uShadowInfo.y, uShadowInfo.y * 4.0));
#else
      lit = shadowPcf(uShadowStatic, vec3(c.xy * 0.5 + 0.5, c.z - 0.0025), vec2(uShadowInfo.y, uShadowInfo.y * 4.0));
#endif
    }
  }
  return lit;
}
`;

const DEPTH_FRAG = /* glsl */ `void main() {}`;

export class Shadows {
  constructor(pipe, opts = {}) {
    this.pipe = pipe;
    this.size = opts.size ?? 1536;
    this.splits = opts.splits ?? [26, 96];
    this.enabled = true;
    const reversed = pipe.reversed;

    const depthTarget = (w, h) => {
      const rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true, format: THREE.RedFormat, type: THREE.UnsignedByteType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
      const d = new THREE.DepthTexture(w, h, THREE.FloatType);
      d.compareFunction = reversed ? THREE.GreaterEqualCompare : THREE.LessEqualCompare;
      d.minFilter = d.magFilter = THREE.LinearFilter;
      rt.depthTexture = d;
      return rt;
    };
    this.csm = depthTarget(this.size * 2, this.size);
    // A second copy of the cascades without depth comparison, for the soft-shadow blocker search.
    this.csmRaw = new THREE.WebGLRenderTarget(this.size * 2, this.size, { depthBuffer: true, format: THREE.RedFormat, type: THREE.UnsignedByteType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.csmRaw.depthTexture = new THREE.DepthTexture(this.size * 2, this.size, THREE.FloatType);
    this.csmRaw.depthTexture.minFilter = this.csmRaw.depthTexture.magFilter = THREE.NearestFilter;
    pipe.renderer.initRenderTarget(this.csmRaw);
    this.soft = true;             // soft penumbrae on surfaces that ask for them: true, 'near' (first cascade only) or false
    this.rate = 1;                // 1: near cascade every frame; 2: cascades take turns
    this.softness = 0.012;        // penumbra radius per metre between blocker and receiver
    this.staticSize = opts.staticSize ?? [4096, 1024];
    this.static = depthTarget(...this.staticSize);

    this.cams = [new THREE.OrthographicCamera(), new THREE.OrthographicCamera()];
    this.staticCam = new THREE.OrthographicCamera();
    this.scene = new THREE.Scene();         // twins of everything that casts into the cascades
    this.staticScene = new THREE.Scene();   // twins of everything fixed in place
    this.scene.matrixWorldAutoUpdate = false; this.staticScene.matrixWorldAutoUpdate = false;
    this.twins = [];

    this.uniforms = {
      uShadowCsm: { value: this.csm.depthTexture },
      uShadowStatic: { value: this.static.depthTexture },
      uCsmMat: { value: [new THREE.Matrix4(), new THREE.Matrix4()] },
      uStaticMat: { value: new THREE.Matrix4() },
      uShadowInfo: { value: new THREE.Vector4(1 / this.size, 1 / this.staticSize[0], this.splits[1], 1) },
      uShadowRaw: { value: this.csmRaw.depthTexture },
      uSoft: { value: new THREE.Vector4(1, 0, 0, 0) },
      uSoftLimit: { value: new THREE.Vector4(0.01, 0.004, 1.2 / this.size, 0) },
    };
    this._staticDirty = true;
  }

  // A plain depth-only material for meshes that need no special vertex work.
  static depthMaterial(opts = {}) {
    return new THREE.ShaderMaterial({
      vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: DEPTH_FRAG, colorWrite: false, ...opts,
    });
  }

  // Registers a caster. depthMat must reproduce the mesh's vertex motion. Flags choose which
  // maps it is drawn into; staticMat lets far-only stand-ins (tree billboards) differ.
  addCaster(mesh, depthMat, { dynamic = true, fixed = false, staticMat = null } = {}) {
    const mk = (mat) => {
      const t = new THREE.Mesh(mesh.geometry, mat);
      t.matrixAutoUpdate = false;
      t.frustumCulled = mesh.frustumCulled;
      return t;
    };
    if (dynamic) { const t = mk(depthMat); this.scene.add(t); this.twins.push([mesh, t]); }
    if (fixed) { const t = mk(staticMat ?? depthMat); this.staticScene.add(t); this.twins.push([mesh, t]); this._staticDirty = true; }
  }

  _sync() {
    for (const [src, twin] of this.twins) {
      twin.visible = src.visible;
      twin.matrixWorld.copy(src.matrixWorld);
      // A skinned twin skins in world space and must undo the same world matrix as its source.
      if (twin.isSkinnedMesh) twin.bindMatrixInverse.copy(src.bindMatrixInverse);
    }
  }

  _fitOrtho(cam, center, radius, depthBack, snapTexels) {
    const sun = this.pipe.sky.sunDir;
    _m.lookAt(_o.set(0, 0, 0), _t.copy(sun).negate(), _up);          // rotation only
    _inv.copy(_m).invert();
    const c = _c.copy(center).applyMatrix4(_inv);
    if (snapTexels) {
      const texel = (radius * 2) / snapTexels;
      c.x = Math.round(c.x / texel) * texel; c.y = Math.round(c.y / texel) * texel;
    }
    c.applyMatrix4(_m);
    cam.position.copy(c).addScaledVector(sun, depthBack);
    cam.quaternion.setFromRotationMatrix(_m);
    cam.left = -radius; cam.right = radius; cam.top = radius; cam.bottom = -radius;
    cam.near = 0.5; cam.far = depthBack + radius + 60;
    if (this.pipe.reversed) cam._reversedDepth = true;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
  }

  // Renders the static map over the whole playable core. Call again if fixed casters change.
  bakeStatic() {
    const r = this.pipe.renderer, sun = this.pipe.sky.sunDir, cam = this.staticCam;
    _m.lookAt(_o.set(0, 0, 0), _t.copy(sun).negate(), _up);
    _inv.copy(_m).invert();
    const box = new THREE.Box3();
    for (const x of [-1040, 1040]) for (const y of [-5, 340]) for (const z of [-1040, 1040]) box.expandByPoint(_c.set(x, y, z).applyMatrix4(_inv));
    const cx = (box.min.x + box.max.x) / 2, cy = (box.min.y + box.max.y) / 2;
    cam.position.set(cx, cy, box.max.z + 50).applyMatrix4(_m);
    cam.quaternion.setFromRotationMatrix(_m);
    cam.left = box.min.x - cx; cam.right = box.max.x - cx; cam.bottom = box.min.y - cy; cam.top = box.max.y - cy;
    cam.near = 1; cam.far = box.max.z - box.min.z + 100;
    if (this.pipe.reversed) cam._reversedDepth = true;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    this._sync();
    r.setRenderTarget(this.static);
    r.clear(true, true, false);
    r.render(this.staticScene, cam);
    this.uniforms.uStaticMat.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this._staticDirty = false;
  }

  update(camera) {
    this.uniforms.uShadowInfo.value.w = this.enabled ? 1 : 0;
    this.uniforms.uSoft.value.x = this.soft === 'near' ? 0.75 : this.soft ? 1 : 0;
    this.uniforms.uSoft.value.y = this.pipe.globals.uFrame.value;
    if (!this.enabled) return;
    if (this._staticDirty) this.bakeStatic();
    const r = this.pipe.renderer, S = this.size;
    this._sync();
    camera.getWorldDirection(_dir);
    const camPos = _p.setFromMatrixPosition(camera.matrixWorld);
    const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), tanW = tanH * camera.aspect;
    let near = camera.near;
    this._frame = (this._frame ?? 0) + 1;
    for (let i = 0; i < 2; i++) {
      const far = this.splits[i];
      // The far cascade changes slowly, so it is redrawn only every third frame; its matrix
      // stays paired with the map it was drawn with. At half rate (the Medium preset) the two
      // cascades take turns instead: near on even frames, far on every fourth.
      const skip = this.rate === 2 ? (i === 0 ? this._frame % 2 === 1 : this._frame % 4 !== 1) : (i === 1 && this._frame % 3 !== 0);
      if (skip && this._frame > 4) { near = far; continue; }
      // Bounding sphere of the frustum slice: its size never changes, so the shadow edges
      // stay rock steady while the camera turns.
      const k = 1 + tanH * tanH + tanW * tanW;
      const mid = Math.min(far, 0.5 * (near + far) * k);
      const radius = Math.ceil(Math.hypot(far - mid, far * tanW, far * tanH) * 1.02);
      _center.copy(camPos).addScaledVector(_dir, mid);
      this._fitOrtho(this.cams[i], _center, radius, 260, S);
      this.csm.viewport.set(i * S, 0, S, S);
      this.csm.scissor.set(i * S, 0, S, S);
      this.csm.scissorTest = true;
      r.setRenderTarget(this.csm);
      r.clear(false, true, false);
      r.render(this.scene, this.cams[i]);
      this.uniforms.uCsmMat.value[i].multiplyMatrices(this.cams[i].projectionMatrix, this.cams[i].matrixWorldInverse);
      if (this.soft) {
        r.copyTextureToTexture(this.csm.depthTexture, this.csmRaw.depthTexture, _box.set(_v2a.set(i * S, 0), _v2b.set((i + 1) * S, S)), _v2c.set(i * S, 0));
        // Penumbra per unit of stored depth, and its limits, in this cascade's uv.
        const cam = this.cams[i], span = cam.far - cam.near, width = radius * 2;
        const soft = this.uniforms.uSoft.value, lim = this.uniforms.uSoftLimit.value;
        if (i === 0) { soft.z = (span * this.softness) / width; lim.x = 0.9 / width; } else { soft.w = (span * this.softness) / width; lim.y = 1.3 / width; }
      }
      near = far;
    }
    this.csm.scissorTest = false;
    this.csm.viewport.set(0, 0, S * 2, S);
  }
}

const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _o = new THREE.Vector3(), _t = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Vector3(), _dir = new THREE.Vector3(), _p = new THREE.Vector3(), _center = new THREE.Vector3();
const _box = new THREE.Box2(), _v2a = new THREE.Vector2(), _v2b = new THREE.Vector2(), _v2c = new THREE.Vector2();
