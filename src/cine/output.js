// Film output. Renders finished frames for the cinematic at any resolution and hands them
// to the capture server (tools/capture.mjs) as raw pixels:
//   - HDR10 master: 10-bit PQ, BT.2020, read back as packed 2-10-10-10
//   - SDR companion: 8-bit sRGB from the same grade
// Motion blur comes from averaging several sub-frames spread over a 180-degree shutter.
// Depth of field is a gather blur on each sub-frame, sized by a thin-lens circle of confusion.
import * as THREE from 'three';
import { FullscreenPass, makeTarget } from '../engine/fullscreen.js';
import { COMMON } from '../engine/glsl.js';
import { AGX_GLSL } from '../engine/pipeline.js';

const GRADE = /* glsl */ `
${COMMON}
${AGX_GLSL}
uniform sampler2D uColor;
uniform sampler2D uBloom;
uniform float uBloomStrength;
uniform float uExposure;
uniform float uVignette;
vec3 graded() {
  vec3 c = textureLod(uColor, vUv, 0.0).rgb;
  c = mix(c, textureLod(uBloom, vUv, 0.0).rgb / 6.0, uBloomStrength);
  vec2 q = vUv - 0.5;
  c *= 1.0 - uVignette * smoothstep(0.25, 1.1, dot(q, q) * 2.2);
  return c * uExposure;
}`;

const HDR_OUT = /* glsl */ `
${GRADE}
uniform float uPaperWhite;   // nits for SDR-range white
uniform float uPeak;         // nits for the brightest highlights
void main() {
  vec3 scene = graded();
  vec3 sdr = agx(scene);                       // display-linear, Rec.709, 0..1
  // Everything the SDR grade shows keeps its look at paper white; pixels whose scene
  // luminance ran past the SDR range (sun, glints, lit glass, crystals) are opened up
  // toward the display peak.
  float Y = luma(scene);
  float h = smoothstep(0.0, 1.0, log2(max(Y, 1e-6)) / 4.5);
  vec3 nits = sdr * uPaperWhite * (1.0 + (uPeak / uPaperWhite - 1.0) * h * h);
  const mat3 TO2020 = mat3(0.6274, 0.0691, 0.0164, 0.3293, 0.9195, 0.0880, 0.0433, 0.0114, 0.8956);
  vec3 y = clamp(TO2020 * nits / 10000.0, 0.0, 1.0);
  // SMPTE ST 2084 (PQ) encoding.
  vec3 ym = pow(y, vec3(0.1593017578125));
  vec3 pq = pow((0.8359375 + 18.8515625 * ym) / (1.0 + 18.6875 * ym), vec3(78.84375));
  pq += (ign(gl_FragCoord.xy) - 0.5) / 1023.0;
  outColor = vec4(saturate(pq), 1.0);
}`;

const SDR_OUT = /* glsl */ `
${GRADE}
void main() {
  vec3 c = linearToSrgb(saturate(agx(graded())));
  c += (ign(gl_FragCoord.xy) - 0.5) / 255.0;
  outColor = vec4(c, 1.0);
}`;

// Depth of field. Each tap of a golden-angle disc counts only if its own blur circle is wide
// enough to reach this pixel, so sharp things keep their edges and the background cannot
// smear over a subject that is in focus.
const DOF = /* glsl */ `
${COMMON}
uniform sampler2D uColor;
uniform sampler2D uDepth;     // linear view depth in metres
uniform vec2 uTexel;
uniform vec4 uDof;            // x: focus distance (m), y: blur scale (pixels x metres), z: widest radius (pixels), w: tap rotation
float coc(float z) { return clamp(uDof.y * (1.0 / uDof.x - 1.0 / max(z, 0.05)), -uDof.z, uDof.z); }
void main() {
  float z0 = textureLod(uDepth, vUv, 0.0).r;
  float c0 = abs(coc(z0));
  vec4 acc = vec4(textureLod(uColor, vUv, 0.0).rgb, 1.0);
  float a = ign(gl_FragCoord.xy) * 6.2831853 + uDof.w;
  for (int i = 0; i < 40; i++) {
    float r = sqrt((float(i) + 0.5) / 40.0) * uDof.z;
    float th = float(i) * 2.39996323 + a;
    vec2 uv = vUv + vec2(cos(th), sin(th)) * r * uTexel;
    float z = textureLod(uDepth, uv, 0.0).r;
    float c = abs(coc(z));
    if (z > z0) c = min(c, c0 * 2.0);
    float w = smoothstep(r - 1.0, r + 1.0, c);
    acc += vec4(textureLod(uColor, uv, 0.0).rgb, 1.0) * w;
  }
  outColor = vec4(acc.rgb / acc.a, 1.0);
}`;

const ACCUM = /* glsl */ `
uniform sampler2D uTex; uniform float uWeight;
void main() { outColor = vec4(textureLod(uTex, vUv, 0.0).rgb * uWeight, uWeight); }`;

export class FilmOutput {
  constructor(pipe) {
    this.pipe = pipe;
    const u = () => ({ uColor: { value: null }, uBloom: { value: null }, uBloomStrength: { value: 0.06 }, uExposure: { value: 0.3 }, uVignette: { value: 0.22 }, uSaturation: pipe.tonemap.uniforms.uSaturation, uContrast: pipe.tonemap.uniforms.uContrast });
    this.hdr = new FullscreenPass({ fragment: HDR_OUT, uniforms: { ...u(), uPaperWhite: { value: 203 }, uPeak: { value: 1000 } } });
    this.sdr = new FullscreenPass({ fragment: SDR_OUT, uniforms: u() });
    this.dof = new FullscreenPass({ fragment: DOF, uniforms: { uColor: { value: null }, uDepth: { value: null }, uTexel: { value: new THREE.Vector2() }, uDof: { value: new THREE.Vector4(10, 0, 1, 0) } } });
    this.accum = new FullscreenPass({ fragment: ACCUM, uniforms: { uTex: { value: null }, uWeight: { value: 1 } }, blending: THREE.CustomBlending });
    Object.assign(this.accum.material, { blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation, transparent: true });
  }

  setSize(w, h) {
    this.w = w; this.h = h;
    for (const t of [this.rtAccum, this.rtHdr, this.rtSdr, this.rtDof]) t?.dispose();
    this.rtDof = makeTarget(w, h);
    this.dof.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.rtAccum = makeTarget(w, h, { type: THREE.FloatType });
    this.rtHdr = makeTarget(w, h);
    this.rtSdr = makeTarget(w, h, { type: THREE.UnsignedByteType });
    // A raw 10-bit framebuffer to pack the PQ image for read-back.
    const gl = this.pipe.renderer.getContext();
    if (this.fb10) { gl.deleteFramebuffer(this.fb10); gl.deleteRenderbuffer(this.rb10); }
    this.rb10 = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.rb10);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGB10_A2, w, h);
    this.fb10 = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb10);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.rb10);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.pipe.resetGL();
    this.buf10 = new Uint32Array(w * h);
    this.buf8 = new Uint8Array(w * h * 4);
  }

  // Renders one output frame. advance(dt) moves the world forward; it is called once per
  // sub-frame so fast motion smears across the open part of the shutter.
  frame(advance, dt, subframes = 3, shutter = 0.5) {
    const pipe = this.pipe, r = pipe.renderer;
    r.setRenderTarget(this.rtAccum);
    r.setClearColor(0x000000, 0); r.clear(true, false, false);
    const sub = (dt * shutter) / subframes;
    let first = 0;
    for (let i = 0; i < subframes; i++) {
      advance(sub);
      // A cut inside the open shutter: drop what was gathered before it, so no frame ever
      // blends two shots (the director asks for an anti-aliasing reset on every cut).
      if (i > 0 && pipe.taa.reset) { r.setRenderTarget(this.rtAccum); r.clear(true, false, false); first = i; }
      let color = pipe.render(sub, { toScreen: false });
      // pipe.dof = { focus (m), blur (pixels x metres at 2160 lines) } is set by the director.
      const d = pipe.dof;
      if (d && d.blur > 0) {
        const k = this.h / 2160, u = this.dof.uniforms;
        u.uColor.value = color; u.uDepth.value = pipe.rtLinDepth.texture;
        u.uDof.value.set(d.focus, d.blur * k, Math.max(2, (d.max ?? 26) * k), i * 2.1);
        this.dof.render(r, this.rtDof);
        color = this.rtDof.texture;
      }
      this.accum.uniforms.uTex.value = color; this.accum.uniforms.uWeight.value = 1 / (subframes - first);
      this.accum.render(r, this.rtAccum);
    }
    advance(dt * (1 - shutter));          // shutter closed for the rest of the frame
    const bloom = pipe.bloom.render(r, this.rtAccum.texture);
    for (const p of [this.hdr, this.sdr]) { p.uniforms.uColor.value = this.rtAccum.texture; p.uniforms.uBloom.value = bloom; p.uniforms.uExposure.value = pipe.exposure; p.uniforms.uBloomStrength.value = pipe.bloomStrength ?? 0.06; }
    this.hdr.render(r, this.rtHdr);
    this.sdr.render(r, this.rtSdr);
  }

  // Packed 10-bit PQ pixels (bottom row first) for the frame just rendered.
  readHdr() {
    const r = this.pipe.renderer, gl = r.getContext();
    const src = r.properties.get(this.rtHdr).__webglFramebuffer;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.fb10);
    gl.blitFramebuffer(0, 0, this.w, this.h, 0, 0, this.w, this.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb10);
    gl.readPixels(0, 0, this.w, this.h, gl.RGBA, gl.UNSIGNED_INT_2_10_10_10_REV, this.buf10);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.pipe.resetGL();
    return this.buf10;
  }

  readSdr() {
    this.pipe.renderer.readRenderTargetPixels(this.rtSdr, 0, 0, this.w, this.h, this.buf8);
    return this.buf8;
  }
}
