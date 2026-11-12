import * as THREE from 'three';
import { Pipeline } from './engine/pipeline.js';
import { Terrain } from './world/terrain.js';
import { Water } from './world/water.js';
import { WORLD } from './world/layout.js';
import { Forest } from './world/flora/forest.js';
import { GroundCover } from './world/flora/grass.js';
import { Architecture } from './world/arch/sites.js';
import { Waterfalls } from './world/waterfalls.js';
import { Lattice } from './world/landmarks.js';
import { buildMesas } from './world/layout.js';

const canvas = document.getElementById('view');
const params = new URLSearchParams(location.search);
const pipe = new Pipeline(canvas, { renderScale: Number(params.get('scale')) || 1, sky: { ...WORLD.sun } });
window.__pipe = pipe;

pipe.camera.position.set(-505, 232, -40);
const look = { yaw: Number(params.get('yaw')) || 0.12, pitch: Number(params.get('pitch')) || -0.16 };

function applyLook() {
  const d = new THREE.Vector3(Math.cos(look.pitch) * Math.cos(look.yaw), Math.sin(look.pitch), Math.cos(look.pitch) * Math.sin(look.yaw));
  pipe.camera.lookAt(pipe.camera.position.clone().add(d));
}
applyLook();

canvas.addEventListener('mousemove', (e) => {
  if (e.buttons & 1) { look.yaw += e.movementX * 0.004; look.pitch = Math.max(-1.4, Math.min(1.4, look.pitch - e.movementY * 0.004)); applyLook(); }
});

const terrain = await Terrain.load(pipe);
window.__terrain = terrain;
pipe.attachWorld();
pipe.scene.add(terrain.mesh);
const water = new Water(pipe, terrain);
pipe.sceneT.add(water.group);
const arch = new Architecture(pipe, terrain, buildMesas());
window.__arch = arch;
console.log('far holds:', arch.buildFarCities(), JSON.stringify(arch.stats));
pipe.scene.add(arch.group);
const lattice = new Lattice(pipe, arch.material);
window.__lattice = lattice;
pipe.scene.add(lattice.group);
const falls = new Waterfalls(pipe, terrain, arch.mesas);
window.__falls = falls;
pipe.sceneT.add(falls.group);
const forest = new Forest(pipe, terrain);
window.__forest = forest;
console.log('trees placed:', forest.populate());
forest.addGreatTree(2750, terrain.heightAt(2750, 1480) - 6, 1480);
pipe.scene.add(forest.group);
const cover = new GroundCover(pipe, terrain, forest.leafAtlas, forest.wind);
window.__cover = cover;
pipe.scene.add(cover.group);
pipe.onBeforeScene.push((cam) => { terrain.bakeStep(2); terrain.select(cam); forest.update(cam); cover.update(cam); lattice.update(1 / 60); });

function resize() { pipe.setSize(window.innerWidth, window.innerHeight); }
window.addEventListener('resize', resize);
resize();

// Debug hooks used while developing: step frames by hand, aim the camera, measure GPU time.
window.__dbg = {
  look(yaw, pitch, fov) { look.yaw = yaw; look.pitch = pitch; if (fov) { pipe.camera.fov = fov; pipe.camera.updateProjectionMatrix(); } applyLook(); },
  pos(x, y, z) { pipe.camera.position.set(x, y, z); applyLook(); },
  step(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) pipe.render(dt); },
  // Renders several preset views into one 2x2 sheet drawn over the page, so a single
  // screenshot shows them all.
  sheet(views = this.views, frames = 10) {
    let c = document.getElementById('sheet');
    if (!c) { c = document.createElement('canvas'); c.id = 'sheet'; c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:9'; document.body.appendChild(c); }
    c.width = canvas.width; c.height = canvas.height;
    const ctx = c.getContext('2d'), w = c.width / 2, h = c.height / 2;
    views.slice(0, 4).forEach((v, i) => {
      this.pos(v[0], v[1], v[2]); this.look(v[3], v[4], v[5] ?? 60);
      pipe.taa.reset = true;
      this.step(frames);
      ctx.drawImage(canvas, (i % 2) * w, Math.floor(i / 2) * h, w, h);
    });
  },
  hideSheet() { document.getElementById('sheet')?.remove(); },
  views: [
    [-505, 236, -40, 0.2, -0.1, 62],       // valley from the dawn terrace
    [60, 215, 255, 0.95, -0.06, 55],       // Aurel citadel
    [-120, 150, -60, -1.25, -0.12, 62],    // cliff and fall
    [-600, 212, -180, 0.75, 0.08, 60],     // meadow and trees
  ],
  gpuMs(n = 20) {
    const gl = pipe.renderer.getContext(), px = new Uint8Array(4);
    gl.finish();
    const t0 = performance.now();
    for (let i = 0; i < n; i++) pipe.render(1 / 60);
    pipe.renderer.setRenderTarget(null);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return +((performance.now() - t0) / n).toFixed(2);
  },
};

let last = performance.now(), frames = 0, acc = 0;
window.__stats = { fps: 0, ms: 0 };
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  pipe.render(dt);
  frames++; acc += dt;
  if (acc >= 1) { window.__stats.fps = frames / acc; window.__stats.ms = (acc / frames) * 1000; frames = 0; acc = 0; }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
