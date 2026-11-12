// Frame pipeline: owns the renderer, render targets and the ordered list of passes.
import * as THREE from 'three';
import { FullscreenPass, makeTarget } from './fullscreen.js';
import { COMMON, SKYMAP } from './glsl.js';
import { Sky, SKY_SAMPLE } from './sky.js';
import { FogPass, TAAPass, BloomPass, AoPass } from './post.js';
import { Shadows } from './shadows.js';
import { Volumetrics } from './volumetrics.js';

const SKY_DRAW = /* glsl */ `
${COMMON}
${SKYMAP}
${SKY_SAMPLE}
uniform mat4 uProjInv;
uniform mat4 uCamWorld;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
void main() {
  vec4 v = uProjInv * vec4(vUv * 2.0 - 1.0, 0.5, 1.0);
  vec3 rd = normalize((uCamWorld * vec4(normalize(v.xyz / v.w), 0.0)).xyz);
  vec4 s = sampleSky(rd);
  vec3 col = s.rgb;
  // Sun disc with limb darkening, dimmed by the cloud transmittance stored in alpha.
  float ang = acos(clamp(dot(rd, uSunDir), -1.0, 1.0));
  float disc = 1.0 - smoothstep(0.0046, 0.0054, ang);
  float limb = 1.0 - 0.45 * sq(ang / 0.0054);
  col += uSunColor * disc * limb * 260.0 * s.a * step(0.0, rd.y + 0.004);
  outColor = vec4(col, 1.0);
}`;

// AgX base curve (after Troy Sobotka's AgX, minimal fit) with a slightly punchier look.
// Returns display-linear Rec.709 in 0..1. Needs uSaturation and uContrast uniforms.
export const AGX_GLSL = /* glsl */ `
uniform float uSaturation;
uniform float uContrast;
vec3 agxDefaultContrastApprox(vec3 x) {
  vec3 x2 = x * x, x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 agx(vec3 c) {
  const mat3 inMat = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051, 0.0784335999999992, 0.878468636469772, 0.0784336, 0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  const mat3 outMat = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438, -0.0980208811401368, 1.15190312990417, -0.0980434501171241, -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  const float minEv = -12.47393, maxEv = 4.026069;
  c = inMat * c;
  c = clamp(log2(max(c, 1e-10)), minEv, maxEv);
  c = (c - minEv) / (maxEv - minEv);
  c = agxDefaultContrastApprox(c);
  float l = luma(c);
  c = pow(max(c, 0.0), vec3(uContrast));
  c = l + uSaturation * (c - l);
  c = pow(max(outMat * c, 0.0), vec3(2.2));
  // Split tone: shadows lean cool, highlights lean warm, as in evening light.
  float lt = luma(c);
  return c * mix(vec3(0.9, 0.97, 1.09), vec3(1.07, 1.0, 0.9), smoothstep(0.04, 0.55, lt));
}`;

const TONEMAP = /* glsl */ `
${COMMON}
${AGX_GLSL}
uniform sampler2D uColor;
uniform sampler2D uBloom;
uniform float uBloomStrength;
uniform float uExposure;
uniform float uVignette;
uniform float uSharpen;
uniform vec2 uTexel;
void main() {
  vec3 c = textureLod(uColor, vUv, 0.0).rgb;
  if (uSharpen > 0.0) {
    // Contrast-adaptive sharpening, done in a compressed range so highlights do not ring.
    vec3 n = textureLod(uColor, vUv + vec2(0.0, uTexel.y), 0.0).rgb, s = textureLod(uColor, vUv - vec2(0.0, uTexel.y), 0.0).rgb;
    vec3 e = textureLod(uColor, vUv + vec2(uTexel.x, 0.0), 0.0).rgb, w = textureLod(uColor, vUv - vec2(uTexel.x, 0.0), 0.0).rgb;
    float lc = luma(c), ln = luma(n), ls = luma(s), le = luma(e), lw = luma(w);
    float mn = min(lc, min(min(ln, ls), min(le, lw))), mx = max(lc, max(max(ln, ls), max(le, lw)));
    float amp = sqrt(saturate(min(mn, 1.0 - min(mx, 1.0)) / max(mx, 1e-4)));
    float k = -amp * uSharpen * 0.2;
    vec3 sharp = (c + (n + s + e + w) * k) / (1.0 + 4.0 * k);
    c = max(mix(c, sharp, step(mx, 4.0)), 0.0);
  }
  c = mix(c, textureLod(uBloom, vUv, 0.0).rgb / 6.0, uBloomStrength);
  vec2 q = vUv - 0.5;
  c *= 1.0 - uVignette * smoothstep(0.25, 1.1, dot(q, q) * 2.2);
  c = agx(c * uExposure);
  c = linearToSrgb(saturate(c));
  c += (ign(gl_FragCoord.xy) - 0.5) / 255.0;
  outColor = vec4(c, 1.0);
}`;

const LINDEPTH = /* glsl */ `
uniform sampler2D uDepth;
uniform mat4 uProjInv;
void main() {
  float d = texture(uDepth, vUv).r;
#ifdef REVERSED_DEPTH
  vec4 v = uProjInv * vec4(vUv * 2.0 - 1.0, d, 1.0);
  outColor = vec4(d <= 0.0 ? 1.0e6 : -v.z / v.w);
#else
  vec4 v = uProjInv * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  outColor = vec4(d >= 1.0 ? 1.0e6 : -v.z / v.w);
#endif
}`;

const COPY = /* glsl */ `
uniform sampler2D uTex;
void main() { outColor = texture(uTex, vUv); }`;

export class Pipeline {
  constructor(canvas, opts = {}) {
    const renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, alpha: false, depth: false, stencil: false,
      powerPreference: 'high-performance', reversedDepthBuffer: true,
    });
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.autoClear = false;
    renderer.info.autoReset = false;
    renderer.setPixelRatio(1);
    this.renderer = renderer;
    this.reversed = renderer.capabilities.reversedDepthBuffer === true;
    this.depthDefines = this.reversed ? { REVERSED_DEPTH: 1 } : {};

    this.scene = new THREE.Scene();
    this.sceneT = new THREE.Scene();     // water and other surfaces that read the opaque scene
    this.camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.3, 120000);
    this.renderScale = opts.renderScale ?? 1;
    this.exposure = 0.3;
    this.time = 0;
    this.onBeforeScene = [];     // callbacks(camera) run after the camera is final for the frame

    this.sky = new Sky(renderer, opts.sky);

    // Uniform holders shared by reference with every material in the scene.
    this.globals = {
      uTime: { value: 0 },
      uFrame: { value: 0 },
      uSunDir: { value: this.sky.sunDir },
      uSunColor: { value: this.sky.sunColor },
      uSH: { value: this.sky.sh },
      ...this.sky.uniforms,
    };
    this.camUniforms = {
      uProjInv: { value: new THREE.Matrix4() },
      uCamWorld: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() },
    };

    this.shadows = new Shadows(this, opts.shadows);
    this.cloudShadow = new THREE.Vector4(0, 0, 0.7, 0.72);
    this.terrainUniforms = {};      // filled in by the terrain once it has loaded

    this.skyPass = new FullscreenPass({
      fragment: SKY_DRAW,
      uniforms: { ...this.sky.uniforms, ...this.camUniforms, uSunDir: this.globals.uSunDir, uSunColor: this.globals.uSunColor },
    });
    // Copies of the opaque scene that water, particles and effects sample.
    this.sceneUniforms = {
      uOpaque: { value: null }, uLinDepth: { value: null },
      uProjJ: { value: new THREE.Matrix4() }, uResolution: { value: new THREE.Vector2() },
    };
    this.linDepthPass = new FullscreenPass({ fragment: LINDEPTH, defines: this.depthDefines, uniforms: { uDepth: { value: null }, uProjInv: this.camUniforms.uProjInv } });
    this.copyPass = new FullscreenPass({ fragment: COPY, uniforms: { uTex: { value: null } } });
    this.fog = new FogPass(this);
    this.ao = new AoPass(this);
    this.taa = new TAAPass(this);
    this.bloom = new BloomPass();
    this.tonemap = new FullscreenPass({
      fragment: TONEMAP,
      uniforms: {
        uColor: { value: null }, uBloom: { value: null }, uBloomStrength: { value: 0.06 }, uExposure: { value: this.exposure },
        uSaturation: { value: 1.3 }, uContrast: { value: 1.08 }, uVignette: { value: 0.22 }, uSharpen: { value: 0.5 }, uTexel: { value: new THREE.Vector2() },
      },
    });
    this._viewProj = new THREE.Matrix4();
    this.setSize(canvas.clientWidth || 1280, canvas.clientHeight || 720);
  }

  // Call after touching the GL context directly. three's own reset also switches the
  // reversed depth buffer off, which would silently break every depth test, so restore it.
  resetGL() {
    this.renderer.resetState();
    if (this.reversed) {
      const depth = this.renderer.state.buffers.depth;
      depth.setReversed(true);
      depth.setClear(1);          // becomes 0 on the GL side while reversed
    }
  }

  // Called once the terrain exists: passes that sample the terrain maps are created here.
  attachWorld() {
    this.volumetrics = new Volumetrics(this);
    this.volumetrics.setSize(this.rw, this.rh);
  }

  // Every uniform a lit surface material needs, shared by reference.
  lit() {
    const g = this.globals;
    return {
      ...this.sky.uniforms, ...this.shadows.uniforms, ...this.terrainUniforms,
      uSunDir: g.uSunDir, uSunColor: g.uSunColor, uSH: g.uSH, uTime: g.uTime, uFrame: g.uFrame,
      uWeatherTex: { value: this.sky.weather.texture }, uCloudShadow: { value: this.cloudShadow },
    };
  }

  setSize(w, h) {
    this.displayW = Math.max(2, Math.floor(w));
    this.displayH = Math.max(2, Math.floor(h));
    this.renderer.setSize(this.displayW, this.displayH, false);
    const rw = Math.max(2, Math.round(this.displayW * this.renderScale)), rh = Math.max(2, Math.round(this.displayH * this.renderScale));
    this.rw = rw; this.rh = rh;
    this.rtScene?.dispose();
    this.rtFog?.dispose();
    this.rtScene = makeTarget(rw, rh, { depthBuffer: true });
    this.rtScene.depthTexture = new THREE.DepthTexture(rw, rh, THREE.FloatType);
    this.rtScene.depthTexture.minFilter = this.rtScene.depthTexture.magFilter = THREE.NearestFilter;
    this.rtFog = makeTarget(rw, rh);
    this.volumetrics?.setSize(rw, rh);
    this.ao.setSize(rw, rh);
    this.rtOpaque?.dispose();
    this.rtLinDepth?.dispose();
    this.rtOpaque = makeTarget(rw, rh);
    this.rtLinDepth = makeTarget(rw, rh, { type: THREE.FloatType, format: THREE.RedFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.sceneUniforms.uOpaque.value = this.rtOpaque.texture;
    this.sceneUniforms.uLinDepth.value = this.rtLinDepth.texture;
    this.sceneUniforms.uResolution.value.set(rw, rh);
    this.taa.setSize(this.displayW, this.displayH);
    this.bloom.setSize(this.displayW, this.displayH);
    this.tonemap.uniforms.uTexel.value.set(1 / this.displayW, 1 / this.displayH);
    this.camera.aspect = this.displayW / this.displayH;
    this.camera.updateProjectionMatrix();
  }

  setRenderScale(s) { this.renderScale = s; this.setSize(this.displayW, this.displayH); }

  // opts.toScreen = false stops after anti-aliasing and returns the HDR colour texture
  // (used by the film output, which grades and encodes frames itself).
  render(dt, opts = {}) {
    const r = this.renderer;
    this.time += dt;
    this.globals.uTime.value = this.time;
    this.globals.uFrame.value = (this.globals.uFrame.value + 1) % 64;
    r.info.reset();
    this.sky.update(dt);

    const cam = this.camera;
    cam.updateMatrixWorld();
    if (this.reversed) cam._reversedDepth = true;
    cam.updateProjectionMatrix();
    this._viewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);   // unjittered
    this.taa.applyJitter(cam, this.rw, this.rh);
    this.camUniforms.uProjInv.value.copy(cam.projectionMatrixInverse);
    this.camUniforms.uCamWorld.value.copy(cam.matrixWorld);
    this.camUniforms.uCamPos.value.setFromMatrixPosition(cam.matrixWorld);
    for (const fn of this.onBeforeScene) fn(cam, dt);
    this.cloudShadow.x = this.sky.cloudTime * 14; this.cloudShadow.y = this.sky.cloudTime * 5;
    this.shadows.update(cam);

    // Opaque scene on top of the sky.
    r.setRenderTarget(this.rtScene);
    r.clear(false, true, false);
    this.skyPass.render(r, this.rtScene);
    r.setRenderTarget(this.rtScene);
    r.render(this.scene, cam);

    // Second phase: surfaces that refract or reflect the opaque scene.
    if (this.sceneT.children.length) {
      this.copyPass.uniforms.uTex.value = this.rtScene.texture;
      this.copyPass.render(r, this.rtOpaque);
      this.linDepthPass.uniforms.uDepth.value = this.rtScene.depthTexture;
      this.linDepthPass.render(r, this.rtLinDepth);
      this.sceneUniforms.uProjJ.value.copy(cam.projectionMatrix);
      r.setRenderTarget(this.rtScene);
      r.render(this.sceneT, cam);
    }

    const vol = this.volumetrics?.enabled ? this.volumetrics.render(r, this.rtScene.depthTexture) : null;
    const ao = this.ao.enabled ? this.ao.render(r, this.rtScene.depthTexture, cam) : null;
    this.fog.render(r, this.rtScene.texture, this.rtScene.depthTexture, this.rtFog, vol, this.volumetrics?.maxDist ?? 0, ao);

    let color = this.rtFog.texture;
    if (this.taa.enabled) {
      color = this.taa.render(r, this.rtFog.texture, this.rtScene.depthTexture, this.rw, this.rh);
      this.taa.prevViewProj.copy(this._viewProj);
    }
    if (opts.toScreen === false) return color;
    const bloom = this.bloom.render(r, color);

    const u = this.tonemap.uniforms;
    u.uColor.value = this.debugTex ?? color;
    u.uBloom.value = bloom;
    u.uBloomStrength.value = this.debugTex ? 0 : this.bloomStrength ?? 0.06;
    u.uExposure.value = this.exposure;
    this.tonemap.render(r, null);
  }
}
