import * as THREE from 'three';

const tri = new THREE.BufferGeometry();
tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

export const FS_VERT = /* glsl */ `
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.5, 1.0);
}`;

const FS_HEAD = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler3D;
precision highp sampler2DArray;
precision highp sampler2DShadow;
in vec2 vUv;
`;

// A single full-screen triangle with a raw GLSL3 fragment shader.
export class FullscreenPass {
  constructor({ fragment, uniforms = {}, defines = {}, blending = THREE.NoBlending, outputs = 'layout(location = 0) out vec4 outColor;' }) {
    this.uniforms = uniforms;
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: FS_VERT,
      fragmentShader: FS_HEAD + outputs + '\n' + fragment,
      uniforms,
      defines,
      depthTest: false,
      depthWrite: false,
      blending,
    });
    if (blending !== THREE.NoBlending) this.material.transparent = true;
    this.mesh = new THREE.Mesh(tri, this.material);
    this.mesh.frustumCulled = false;
  }

  render(renderer, target = null) {
    renderer.setRenderTarget(target);
    renderer.render(this.mesh, cam);
  }

  // Renders only a rectangle of the target. Used to spread heavy bakes over many frames
  // so no single draw ever runs long enough to stall the GPU.
  renderRegion(renderer, target, x, y, w, h, layer = 0) {
    target.scissor.set(x, y, w, h);
    target.scissorTest = true;
    renderer.setRenderTarget(target, layer);
    renderer.render(this.mesh, cam);
    target.scissorTest = false;
  }

  dispose() { this.material.dispose(); }
}

export function makeTarget(w, h, opts = {}) {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
    colorSpace: THREE.NoColorSpace,
    ...opts,
  });
}
