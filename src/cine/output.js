// Film output. Renders finished frames for the cinematic at any resolution and hands them
// to the capture server (tools/capture.mjs) as raw pixels:
//   - HDR10 master: 10-bit PQ, BT.2020, read back as packed 2-10-10-10
//   - SDR companion: 8-bit sRGB from the same grade
// Motion blur comes from averaging several sub-frames spread over a 180-degree shutter.
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

const ACCUM = /* glsl */ `
uniform sampler2D uTex; uniform float uWeight;
void main() { outColor = vec4(textureLod(uTex, vUv, 0.0).rgb * uWeight, uWeight); }`;

export class FilmOutput {
  constructor(pipe) {
    this.pipe = pipe;
    const u = () => ({ uColor: { value: null }, uBloom: { value: null }, uBloomStrength: { value: 0.06 }, uExposure: { value: 0.3 }, uVignette: { value: 0.22 }, uSaturation: pipe.tonemap.uniforms.uSaturation, uContrast: pipe.tonemap.uniforms.uContrast });
    this.hdr = new FullscreenPass({ fragment: HDR_OUT, uniforms: { ...u(), uPaperWhite: { value: 203 }, uPeak: { value: 1000 } } });
    this.sdr = new FullscreenPass({ fragment: SDR_OUT, uniforms: u() });
    this.accum = new FullscreenPass({ fragment: ACCUM, uniforms: { uTex: { value: null }, uWeight: { value: 1 } }, blending: THREE.CustomBlending });
    Object.assign(this.accum.material, { blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation, transparent: true });
  }

  setSize(w, h) {
    this.w = w; this.h = h;
    for (const t of [this.rtAccum, this.rtHdr, this.rtSdr]) t?.dispose();
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
    for (let i = 0; i < subframes; i++) {
      advance(sub);
      const color = pipe.render(sub, { toScreen: false });
      this.accum.uniforms.uTex.value = color; this.accum.uniforms.uWeight.value = 1 / subframes;
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
