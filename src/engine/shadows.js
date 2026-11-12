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
// 1 = lit, 0 = shadowed by an object. p should already be nudged off the surface.
float objectShadow(vec3 p) {
  if (uShadowInfo.w < 0.5) return 1.0;
  for (int i = 0; i < 2; i++) {
    vec4 c = uCsmMat[i] * vec4(p, 1.0);
    vec3 n = c.xyz;
    vec2 e = abs(n.xy);
    if (max(e.x, e.y) < 0.96) {
      vec2 uv = n.xy * 0.5 + 0.5;
      uv.x = (uv.x + float(i)) * 0.5;
      float bias = (i == 0 ? 0.0006 : 0.0016);
#ifdef REVERSED_DEPTH
      return shadowPcf(uShadowCsm, vec3(uv, n.z + bias), vec2(uShadowInfo.x * 0.5, uShadowInfo.x));
#else
      return shadowPcf(uShadowCsm, vec3(uv, n.z - bias), vec2(uShadowInfo.x * 0.5, uShadowInfo.x));
#endif
    }
  }
  vec4 c = uStaticMat * vec4(p, 1.0);
  vec2 e = abs(c.xy);
  if (max(e.x, e.y) > 0.995) return 1.0;
#ifdef REVERSED_DEPTH
  return shadowPcf(uShadowStatic, vec3(c.xy * 0.5 + 0.5, c.z + 0.0025), vec2(uShadowInfo.y, uShadowInfo.y * 4.0));
#else
  return shadowPcf(uShadowStatic, vec3(c.xy * 0.5 + 0.5, c.z - 0.0025), vec2(uShadowInfo.y, uShadowInfo.y * 4.0));
#endif
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
    this.staticSize = [4096, 1024];
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
      // stays paired with the map it was drawn with.
      if (i === 1 && this._frame % 3 !== 0 && this._frame > 3) { near = far; continue; }
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
      near = far;
    }
    this.csm.scissorTest = false;
    this.csm.viewport.set(0, 0, S * 2, S);
  }
}

const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _o = new THREE.Vector3(), _t = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Vector3(), _dir = new THREE.Vector3(), _p = new THREE.Vector3(), _center = new THREE.Vector3();
