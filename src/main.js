import * as THREE from 'three';
import { Pipeline } from './engine/pipeline.js';
import { Terrain } from './world/terrain.js';
import { Water } from './world/water.js';
import { WORLD, buildMesas, POOLS } from './world/layout.js';
import { Forest } from './world/flora/forest.js';
import { GroundCover } from './world/flora/grass.js';
import { Architecture } from './world/arch/sites.js';
import { Waterfalls } from './world/waterfalls.js';
import { Lattice } from './world/landmarks.js';
import { Dressing } from './world/dressing.js';
import { Game } from './game/game.js';
import { Settings, applySettings } from './game/settings.js';
import { UI } from './ui/ui.js';
import { AudioManager } from './audio/audio.js';
import { connectAudio } from './audio/director.js';
import { Hero } from './anim/hero.js';
import { Director } from './cine/director.js';
import { FilmOutput } from './cine/output.js';
import { Rocks } from './world/rocks.js';
import { CliffVines } from './world/flora/cliffVines.js';
import { FloorGloss } from './world/arch/floorGloss.js';
import { FILM } from './engine/quality.js';
import { Boats } from './world/boats.js';
import { Story, LEGS } from './game/story.js';
import { Governor } from './engine/governor.js';

const canvas = document.getElementById('view');
const params = new URLSearchParams(location.search);
const boot = document.getElementById('boot');
// Lets the browser paint the progress bar between the heavy construction steps.
const stage = (p, text) => new Promise((resolve) => {
  boot.querySelector('i').style.transform = `scaleX(${p})`;
  boot.querySelector('p').textContent = text;
  // Normally the next animation frame; a short timer keeps loading moving in a background tab.
  const t = setTimeout(resolve, 60);
  requestAnimationFrame(() => { clearTimeout(t); setTimeout(resolve, 0); });
});

const pipe = new Pipeline(canvas, { renderScale: Number(params.get('scale')) || 1, sky: { ...WORLD.sun }, shadows: FILM ? { size: 3072, staticSize: [8192, 2048] } : {} });
window.__pipe = pipe;
const settings = new Settings(pipe.renderer);

// --- world ---
await stage(0.08, 'Raising the mesas');
const terrain = await Terrain.load(pipe);
window.__terrain = terrain;
pipe.attachWorld();
pipe.scene.add(terrain.mesh);
const water = new Water(pipe, terrain);
pipe.sceneT.add(water.group);

// Walking routes between the sites, worn into the turf.
const routes = [
  [[-538, -70], [-551, -100], [-562, -138], [-572, -151]],
  [[-447, -291], [-427, -320], [-398, -358], [-380, -378]],
  [[-358, -402], [-300, -424], [-232, -449], [-180, -459]],
  [[-110, -459], [-60, -470], [8, -488], [46, -496]],
  [[72, -478], [85, -420], [96, -362], [98, -344]],
  [[-524, -48], [-536, -30]],
  // On the outer mesas: from each court to its pool.
  [[569, -414], [562, -372]], [[538, 425], [572, 352]], [[124, 524], [92, 452]], [[-388, 416], [-348, 356]], [[-978, -150], [-905, -98], [-878, 16]],
];
terrain.bakePaths(routes, [
  // Paved courts and platforms, where no grass should push through the stone.
  [-372, -392, -372, -392, 18.7], [66, -498, 66, -498, 21.7], [150, -15, 150, -15, 39.7], [94, -336, 102, -336, 4.9],
  // The long stair between the Petal mesa and Cantor's Rise, and its upper landing.
  [-172, -459, -119, -459, 5.4], [-178.5, -459, -178.5, -459, 6.6],
  // The five courts beyond the water.
  [578, -437, 578, -437, 23.6], [517, 437, 517, 437, 23.6], [136, 546, 136, 546, 23.6], [-405, 435, -405, 435, 23.6], [-1005, -168, -1005, -168, 35.6], [540, 416.4, 540, 416.4, 5.6], [602, -461, 602, -461, 4.6], [93.6, 541, 100.8, 570.2, 8.5],
]);
await stage(0.3, 'Building the cities');
const arch = new Architecture(pipe, terrain, buildMesas());
window.__arch = arch;
arch.buildFarCities();
await stage(0.44, 'Laying the paths');
const sites = arch.buildPlayable();
pipe.scene.add(arch.group);
pipe.setLamps(sites.lanterns);
// What stands on the polished floors of the courts is mirrored in them (High and Ultra).
const gloss = new FloorGloss(pipe, sites.floors, arch.material.uniforms.uPlazas);
pipe.sceneT.add(gloss.group);
const lattice = new Lattice(pipe, arch.material);
pipe.scene.add(lattice.group);
const boats = new Boats(pipe, terrain, arch.material);
pipe.scene.add(boats.group);

await stage(0.56, 'Letting the water fall');
const falls = new Waterfalls(pipe, terrain, arch.mesas);
window.__falls = falls;
pipe.sceneT.add(falls.group);

await stage(0.64, 'Growing the forest');
const forest = new Forest(pipe, terrain);
window.__forest = forest;
// Keep trees off the paved sites and the routes between them.
const clear = [...POOLS.map((p) => [p.x, p.z, p.r + 5]), [-512, -70, 34], [-540, -22, 9], [-372, -392, 24], [66, -498, 27], [96, -590, 34], [98, -336, 13], [150, -15, 44], [-146, -459, 34], [578, -437, 27], [517, 437, 27], [136, 546, 27], [-405, 435, 33], [-1005, -168, 47], [540, 416.4, 9],
  // ...and what stands behind them: the light-tower, the Reed arcade, the Aurel archive.
  [602, -461, 8], [517, 466.5, 12], [97, 556, 25]];
// ...and off the walking routes: a trunk in the middle of a path is in the way.
const onRoute = (x, z) => routes.some((r) => r.some((a, i) => {
  if (i === 0) return false;
  const b = r[i - 1], dx = a[0] - b[0], dz = a[1] - b[1], t = Math.max(0, Math.min(1, ((x - b[0]) * dx + (z - b[1]) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - b[0] - dx * t, z - b[1] - dz * t) < 6;
}));
forest.populate((x, z) => onRoute(x, z) || clear.some(([cx, cz, r]) => (x - cx) * (x - cx) + (z - cz) * (z - cz) < r * r), [
  { x: -531, z: -93, species: 'ember', scale: 1.3 }, { x: -533, z: -46, species: 'blossom', scale: 1.25 }, { x: -549, z: -34, species: 'elder', scale: 1.0 },
  { x: -356, z: -420, species: 'blossom', scale: 1.2 }, { x: -392, z: -376, species: 'ember', scale: 1.15 }, { x: 40, z: -520, species: 'blossom', scale: 1.2 },
  // A few old giants that stand well above the canopy and mark the sites from afar.
  { x: -582, z: -96, species: 'elder', scale: 1.9 }, { x: -604, z: -28, species: 'blossom', scale: 2.0 },
  { x: -300, z: -452, species: 'elder', scale: 1.8 }, { x: 18, z: -562, species: 'blossom', scale: 2.0 },
  { x: 192, z: 22, species: 'blossom', scale: 1.8 }, { x: 100, z: -30, species: 'elder', scale: 1.7 },
  { x: 40, z: 600, species: 'elder', scale: 2.4 }, { x: -420, z: 360, species: 'blossom', scale: 2.6 }, { x: -330, z: 470, species: 'elder', scale: 2.3 },
  { x: 600, z: -400, species: 'elder', scale: 2.4 }, { x: 600, z: 470, species: 'blossom', scale: 2.6 }, { x: -900, z: -160, species: 'elder', scale: 2.6 },
  // Each outer court stands among trees of its own: embers round the Lantern Court, a green
  // grove at the Reed Court, pale elders at the Aurel Court, fruit blossom at the Orchard
  // Court and the Crown. None on the side where its buildings stand.
  ...sites.outer.flatMap((c) => Array.from({ length: 11 }, (_, k) => {
    const a = k * 0.571 + 0.3 + c.style, r = c.r + (c.style === 4 ? 21 : 13) + (k % 3) * 3.5;
    if (Math.abs(Math.atan2(Math.sin(a - c.away), Math.cos(a - c.away))) < (c.style === 2 ? 1.0 : 0.6)) return null;
    const sp = [['ember', 'ember', 'blossom'], ['green', 'cypress', 'green'], ['elder', 'elder', 'blossom'], ['blossom', 'ember', 'blossom'], ['blossom', 'elder', 'blossom']][c.style][k % 3];
    return { x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r, species: sp, scale: 1.0 + 0.14 * (k % 3) + (c.style === 4 ? 0.25 : 0) };
  }).filter(Boolean)),
]);
forest.addGreatTree(2750, terrain.heightAt(2750, 1480) - 6, 1480);
pipe.scene.add(forest.group);
const cover = new GroundCover(pipe, terrain, forest.leafAtlas, forest.wind, FILM ? { radius: 120 } : {});
if (FILM) cover.lodBoost = 1.6;       // full blade density further out as well
pipe.scene.add(cover.group);
// Boulders under the cliffs and along the shore, stones in the meadows; none on the sites
// or across the routes between them.
const offLimits = (x, z) => onRoute(x, z) || clear.some(([cx, cz, r]) => (x - cx) * (x - cx) + (z - cz) * (z - cz) < (r + 4) * (r + 4));
const rocks = new Rocks(pipe, terrain, offLimits);
forest.addShrubs(offLimits);
sites.planters.forEach(([x, y, z], i) => forest.addShrubAt(x, y - 0.1, z, 0.55 + 0.1 * (i % 3), 1 + (i % 2)));
sites.beds.forEach(([x, y, z, i]) => forest.addShrubAt(x, y - 0.12, z, 0.34 + 0.06 * (i % 3), 1 + (i % 2)));
pipe.scene.add(rocks.group);
// Greenery spilling over the cliff rims, kept off the buildings on the rims and the waterfalls.
const vines = new CliffVines(terrain, forest, (x, z) => offLimits(x, z)
  || arch.quarters.some(([qx, qz, r]) => (x - qx) * (x - qx) + (z - qz) * (z - qz) < r * r)
  || POOLS.some((p) => { const ax = (x - p.x) * p.out[0] + (z - p.z) * p.out[1], ac = Math.abs(-(x - p.x) * p.out[1] + (z - p.z) * p.out[0]); return ax > 0 && ax < 160 && ac < 13; }));
pipe.scene.add(vines.group);

// Banners and wisteria on the Dawn Terrace arcades, petals on the wind, birds over the valley.
const dressing = new Dressing(pipe, terrain, forest);
for (const [z, face] of [[-87.5, 1], [-52.5, -1]]) {
  for (const off of [-0.6, 0.6]) dressing.vines([-523, 219.2, z + off], [-503, 219.2, z + off], { drop: 3.4, density: 1.5 });
  for (let i = 1; i <= 3; i++) dressing.banner(-523 + 5 * i, 215.4, z + face * 0.62, face > 0 ? 0 : Math.PI, 1.25, 3.8);
}
// Long banners down both faces of the Choir Gate.
for (const sx of [-1, 1]) for (const [dz, yaw] of [[1.3, 0], [-1.3, Math.PI]]) dressing.banner(sites.gate.x + sx * 5.9, sites.gate.y + 14.6, sites.gate.z + dz, yaw, 1.5, 7.2);
// Wisteria on the pergolas of the outer courts, banners in the arches of the Crown.
for (const [a, b, o] of sites.vines ?? []) for (const off of [-0.45, 0.45]) dressing.vines([a[0], a[1], a[2] + off], [b[0], b[1], b[2] + off], o);
for (const bn of sites.banners ?? []) dressing.banner(...bn);
dressing.finish();
pipe.scene.add(dressing.group);
pipe.sceneT.add(dressing.groupT);

await stage(0.82, 'Waking the valley');
const game = new Game({ pipe, terrain, arch, sites, canvas, forest, rocks });
window.__game = game;
window.__parts = { terrain, water, falls, forest, cover, rocks, dressing, arch, lattice, vines, gloss, boats };
// The hero model is generated by tools/blender/hero.py; until it exists a stand-in is used.
fetch('/models/hero.glb', { method: 'HEAD' }).then((r) => (r.ok && /model|octet/.test(r.headers.get('content-type') ?? '') ? Hero.load(pipe) : null)).then((h) => { if (h) { game.attachHero(h); window.__hero = h; } }).catch((e) => console.warn('hero model not loaded', e));
const story = new Story({ game, pipe, sites, terrain });
window.__story = story;
const audio = new AudioManager();
window.__audio = audio;
// Holds the chosen frame rate by adjusting the internal resolution (never in a film capture).
const governor = FILM || params.get('perf') ? null : new Governor(pipe);
window.__gov = governor;
const apply = () => applySettings(settings, { pipe, game, cover, audio, gloss, governor });
const ui = new UI({ game, settings, apply, story });
window.__ui = ui;
const updateAudio = connectAudio(audio, game, ui, falls);
audio.init().then((ok) => { if (ok) apply(); });
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => audio.resume());
if (params.get('scale')) settings.values.renderScale = Number(params.get('scale'));
// Previewing the film look outside a capture: the capture's own quality settings.
if (FILM) Object.assign(settings.values, { renderScale: 1, shadows: true, volumetrics: true, cover: 1, reflections: true, shadowRate: 1, softShadows: 2 });
apply();

pipe.onBeforeScene.push((cam) => { terrain.bakeStep(2); terrain.select(cam); forest.update(cam); cover.update(cam); rocks.update(cam); dressing.update(cam); });

function resize() { pipe.setSize(window.innerWidth, window.innerHeight); }
window.addEventListener('resize', resize);
resize();

// --- title-screen camera: a slow drift over the valley from the lookout ---
const homeCam = { t: 0 };
function updateHomeCamera(dt) {
  homeCam.t += dt;
  const v = sites.vista, t = homeCam.t;
  pipe.camera.position.set(v.x - 6 + Math.sin(t * 0.05) * 3, v.y + 5.5 + Math.sin(t * 0.07) * 1.2, v.z - 9 + Math.cos(t * 0.04) * 5);
  const yaw = 0.12 + Math.sin(t * 0.045) * 0.16;
  pipe.camera.lookAt(pipe.camera.position.x + Math.cos(yaw), pipe.camera.position.y - 0.02 + Math.sin(t * 0.06) * 0.03, pipe.camera.position.z + Math.sin(yaw));
  if (Math.abs(pipe.camera.fov - 58) > 0.01) { pipe.camera.fov = 58; pipe.camera.updateProjectionMatrix(); }
}

let freeCam = false;
function tick(dt) {
  lattice.update(dt);
  game.update(dt);
  if (game.state === 'home' && !freeCam) updateHomeCamera(dt);
  if (!game.cine) story.update(dt);
  ui.update(dt);
  updateAudio(dt);
  const live = governor && game.state !== 'home' && sessionStorage.getItem('uvHold') !== '1';
  if (live) governor.begin();
  pipe.render(dt);
  if (live) governor.end(dt);
}

// Finish the load-time bakes behind the loading screen, a few tiles per frame.
{
  const total = terrain._queue.length;
  while (terrain._queue.length) {
    for (let i = 0; i < 6 && terrain._queue.length; i++) tick(1 / 60);
    await stage(0.84 + 0.15 * (1 - terrain._queue.length / total), 'Casting the evening light');
  }
  for (let i = 0; i < 4; i++) tick(1 / 60);
}
boot.classList.add('gone');
setTimeout(() => boot.remove(), 1200);
ui.hideLoading();

// --- film capture: ?capture=1&w=3840&h=2160&fps=60&seconds=45&server=http://localhost:5199 ---
const director = new Director({ pipe, game, sites, terrain });
window.__director = director;
async function runCapture() {
  const w = Number(params.get('w')) || 1920, h = Number(params.get('h')) || 1080, fps = Number(params.get('fps')) || 60;
  const seconds = Math.min(Number(params.get('to') ?? params.get('seconds')) || director.duration, director.duration), sub = Number(params.get('sub')) || 3;
  const server = params.get('server'), from = Number(params.get('from')) || 0;
  ui.root.style.display = 'none';
  // Film quality: full resolution, densest detail, clouds refreshed quickly.
  settings.values.renderScale = 1; settings.values.shadows = true; settings.values.volumetrics = true; settings.values.cover = 1; settings.values.reflections = true; settings.values.softShadows = 2;
  apply();
  pipe.setSize(w, h);
  terrain.lodScale = 3;
  pipe.sky.setCloudQuality(4096, 72); pipe.sky.tilesPerFrame = 8;
  pipe.shadows.rate = 1;
  const film = new FilmOutput(pipe);
  film.setSize(w, h);
  director.begin();
  const post = (kind, data) => fetch(`${server}/frame/${kind}`, { method: 'POST', body: data, headers: { 'content-type': 'application/octet-stream' } });
  const world = (dt) => { director.advance(dt); lattice.update(dt); game.update(dt); };
  const total = Math.round(seconds * fps);
  console.log(`[cine] rendering ${total} frames at ${w}x${h}, ${sub} sub-frames each`);
  // Skipped lead-in frames still run the simulation so a resumed render lines up exactly.
  for (let f = 0; f < total; f++) {
    if (f < from * fps) { world(1 / fps); continue; }
    film.frame(world, 1 / fps, sub, 0.5);
    if (server) { await post('hdr', film.readHdr()); await post('sdr', film.readSdr()); }
    if (f % 20 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  if (server) await fetch(`${server}/done`, { method: 'POST' });
  console.log('[cine] finished');
}

// --- development hooks: step frames by hand, aim a free camera, measure GPU time ---
const look = { yaw: 0.2, pitch: -0.1 };
function applyLook() {
  const d = new THREE.Vector3(Math.cos(look.pitch) * Math.cos(look.yaw), Math.sin(look.pitch), Math.cos(look.pitch) * Math.sin(look.yaw));
  pipe.camera.lookAt(pipe.camera.position.clone().add(d));
}
window.__dbg = {
  look(yaw, pitch, fov) { freeCam = true; look.yaw = yaw; look.pitch = pitch; if (fov) { pipe.camera.fov = fov; pipe.camera.updateProjectionMatrix(); } applyLook(); },
  pos(x, y, z) { freeCam = true; pipe.camera.position.set(x, y, z); applyLook(); },
  step(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) tick(dt); },
  settle() { this.step(8); return 0; },
  ui(on) { ui.root.style.display = on ? '' : 'none'; },
  // Renders several preset views into one 2x2 sheet drawn over the page, so a single
  // screenshot shows them all.
  sheet(views = this.views, frames = 10) {
    this.ui(false);
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
  // Magnifies a region of the frame (in canvas pixels) over the page for pixel-level checks.
  crop(x, y, w, h, frames = 4) {
    this.ui(false);
    let c = document.getElementById('sheet');
    if (!c) { c = document.createElement('canvas'); c.id = 'sheet'; c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:9'; document.body.appendChild(c); }
    c.width = canvas.width; c.height = canvas.height;
    this.step(frames);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(canvas, x, y, w, h, 0, 0, c.width, c.height);
  },
  views: [
    [-505, 236, -40, 0.2, -0.1, 62],       // valley from above the dawn terrace
    [60, 215, 255, 0.95, -0.06, 55],       // Aurel citadel
    [-120, 150, -60, -1.25, -0.12, 62],    // cliff and fall
    [-600, 212, -180, 0.75, 0.08, 60],     // meadow and trees
  ],
  // Films the hero from the side while a scripted input plays, as a strip of snapshots:
  // the quickest way to judge a walk cycle or an attack without watching it live.
  strip({ n = 8, every = 4, moveY = 1, press = [], hold = [], dist = 4.4, side = 1, height = 1.1, tp = null, fov = 34, az = 0, again = null, lead = 0 } = {}) {
    this.ui(false);
    freeCam = true; game.state = 'playing'; game.cine = true; game.input.enabled = true;
    const inp = game.input, real = inp.update.bind(inp);
    let first = press;
    let fr = 0;
    inp.update = () => { inp.pressed = new Set(first ?? []); first = null; if (again && fr > 0 && fr % again === 0) inp.pressed.add(press[0]); fr++; inp.held = new Set(hold); inp.move.x = 0; inp.move.y = moveY; inp.look.x = 0; inp.look.y = 0; inp.zoom = 0; };
    if (tp) { game.player.spawn(...tp); game.rig.yaw = tp[3] ?? 0; }
    for (let k = 0; k < lead; k++) { const hold0 = first; first = null; tick(1 / 60); first = hold0; }
    let c = document.getElementById('sheet');
    if (!c) { c = document.createElement('canvas'); c.id = 'sheet'; c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:9'; document.body.appendChild(c); }
    c.width = canvas.width; c.height = canvas.height;
    const ctx = c.getContext('2d'), cols = Math.ceil(n / 2), w = c.width / cols, h = c.height / 2;
    pipe.camera.fov = fov; pipe.camera.updateProjectionMatrix();
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < every; k++) {
        const p = game.player.pos, yaw = game.player.yaw, fx = Math.sin(yaw), fz = Math.cos(yaw);
        const ca = Math.cos(az), sa = Math.sin(az);
        pipe.camera.position.set(p.x + (fz * ca + fx * sa) * dist * side, p.y + height, p.z + (-fx * ca + fz * sa) * dist * side);
        pipe.camera.lookAt(p.x, p.y + 1.0, p.z);
        tick(1 / 60);
      }
      // Keep the middle of the frame, where the hero is, at the cell's aspect ratio.
      const sw = canvas.height * (w / h);
      ctx.drawImage(canvas, (canvas.width - sw) / 2, 0, sw, canvas.height, (i % cols) * w, Math.floor(i / cols) * h, w, h);
    }
    inp.update = real; game.input.enabled = false;
    return { state: game.player.state, pos: game.player.pos.toArray().map((v) => +v.toFixed(1)) };
  },
  // The same through the game's own camera, as the player sees it: a grid of frames cropped
  // around the hero. fit shrinks the sheet for screenshots of a scaled display.
  shots({ n = 6, every = 3, press = [], moveY = 0, moveX = 0, tp = [-522, 210.5, -70, Math.PI / 2], zoom = 2.4, lead = 30, again = 0, hold = [], pitch = -0.12, dist = 4.4, yawOff = 0, lookX = 0, fit = true } = {}) {
    this.ui(false);
    let c = document.getElementById('sheet');
    if (!c) { c = document.createElement('canvas'); c.id = 'sheet'; c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:9'; document.body.appendChild(c); }
    c.width = canvas.width; c.height = canvas.height;
    if (fit) c.style.width = c.style.height = 100 / devicePixelRatio + '%';
    const cols = Math.ceil(n / 2), w = c.width / cols, h = c.height / 2, ctx = c.getContext('2d'), v = new THREE.Vector3();
    game.cine = false; game.rig.distance = dist;
    this.play(lead, 0, 0, { tp });
    game.rig.pitch = pitch; game.rig.yaw = tp[3] + yawOff;
    this.play(4, 0, 0);
    for (let i = 0; i < n; i++) {
      this.play(every, moveY, moveX, { press: i === 0 || (again && i % again === 0) ? [...press] : [], hold, lookX });
      v.set(game.player.pos.x, game.player.pos.y + 1.0, game.player.pos.z).project(pipe.camera);
      const cx = (v.x * 0.5 + 0.5) * canvas.width, cy = (-v.y * 0.5 + 0.5) * canvas.height, sh = canvas.height / zoom, sw = sh * (w / h);
      ctx.drawImage(canvas, cx - sw / 2, cy - sh / 2, sw, sh, (i % cols) * w, Math.floor(i / cols) * h, w, h);
    }
    return { state: game.player.state, combo: game.player.comboStep };
  },
  fit() { const c = document.getElementById('sheet'); if (c) c.style.width = c.style.height = 100 / devicePixelRatio + '%'; },
  // Plays the game for n frames with a fixed stick input (x strafe, y forward).
  play(n = 60, moveY = 1, moveX = 0, opts = {}) {
    freeCam = false;
    game.state = 'playing'; game.input.enabled = true;
    const inp = game.input, real = inp.update.bind(inp);
    inp.update = () => { inp.pressed = new Set(opts.press ?? []); opts.press = null; inp.held = new Set(opts.hold ?? []); inp.move.x = moveX; inp.move.y = moveY; inp.look.x = opts.lookX ?? 0; inp.look.y = 0; inp.zoom = 0; };
    if (opts.tp) { game.player.spawn(...opts.tp); game.rig.snap(game.player); if (opts.tp[3] !== undefined) game.rig.yaw = opts.tp[3]; }
    for (let i = 0; i < n; i++) tick(1 / 60);
    inp.update = real;
    game.input.enabled = false;
    const p = game.player;
    return { pos: p.pos.toArray().map((v) => +v.toFixed(2)), grounded: p.grounded, state: p.state, stamina: Math.round(p.stamina), health: p.health, enemies: game.enemies.list.filter((e) => e.alive).length, objective: game.objective };
  },
  // Jumps the cinematic to time t (seconds) by simulating up to it, then shows that frame.
  cine(t) {
    freeCam = true; ui.root.style.display = 'none';
    director.begin();
    const dt = 1 / 30;
    while (director.time < t) { director.advance(dt); lattice.update(dt); game.update(dt); }
    for (let i = 0; i < 6; i++) { director.advance(1 / 240); lattice.update(1 / 240); game.update(1 / 240); pipe.render(1 / 240); }
    return { time: +director.time.toFixed(2), shot: director.index + 1, player: game.player.pos.toArray().map((v) => Math.round(v)) };
  },
  // Plays the whole game with a simple bot, without drawing: it walks the route, fights
  // whatever wakes and tunes each spire. Call it repeatedly (each call simulates `seconds`
  // of play) until `done` is true. An end-to-end check of routes, collision and rules.
  bot(seconds = 120) {
    const d = director, g = game, p = g.player, dt = 1 / 30;
    let b = this._bot;
    if (!b || b.done) {
      g.cineSetup({ tuned: [] }); d.begin();           // cinematic mode: nothing is saved
      p.spawn(sites.spawn.x, sites.spawn.y, sites.spawn.z, sites.spawn.yaw);
      b = this._bot = { i: 0, t: 0, stuck: 0, last: p.pos.clone(), log: [], done: false, route: [
        [-538, -70], [-551, -100], [-562, -138], [-573, -152], [-447, -290], [-427, -320], [-398, -358], [-380, -378], [-372, -386.5, 'petal'],
        [-358, -402], [-300, -424], [-232, -449], [-180, -459], [-118, -459], [-60, -470], [8, -488], [46, -496], [63.5, -494, 'cantor'],
        [72, -478], [85, -420], [96, -362], [98, -344], [98, -330], [150, -84], [150, -40], [150, -20.5, 'choir']] };
    }
    const until = b.t + seconds;
    while (b.t < until && b.i < b.route.length && b.stuck < 8) {
      const [x, z, spire] = b.route[b.i];
      d.puppet.pressed.clear(); d.puppet.held.clear(); d.puppet.move.x = d.puppet.move.y = 0;
      const foe = g.enemies.list.some((e) => e.alive && e.state !== 'dormant' && e.pos.distanceTo(p.pos) < 26);
      if (p.state !== 'dead') {
        if (foe) d.fight(dt);
        else if (spire) {
          const s = g.spires.find((q) => q.id === spire);
          const guard = g.enemies.list.find((e) => e.alive && e.group === spire);
          if (s.tuned) { b.log.push(`${Math.round(b.t)}s tuned ${spire}`); b.i++; }
          else if (guard) d.walkTo(guard.pos.x, guard.pos.z, { stop: 3 });      // wake whoever still sleeps
          else if (d.walkTo(x, z, { stop: 1.5 })) d.puppet.held.add('interact');
        } else if (d.walkTo(x, z, { sprint: true, stop: 2.2 })) b.i++;
      }
      g.update(dt); b.t += dt;
      if (Math.round(b.t / dt) % 120 === 0) {
        if (p.pos.distanceTo(b.last) < 0.6 && !foe && p.state !== 'dead') { b.stuck++; b.log.push(`${Math.round(b.t)}s stuck at ${p.pos.toArray().map(Math.round)} before waypoint ${b.i}`); d.puppet.pressed.add('jump'); } else b.stuck = Math.max(0, b.stuck - 1);
        b.last.copy(p.pos);
      }
    }
    b.done = b.i >= b.route.length || b.stuck >= 8 || b.t > 1500;
    const res = { seconds: Math.round(b.t), waypoint: `${b.i}/${b.route.length}`, done: b.done, ended: !!g.ended, tuned: g.spires.filter((s) => s.tuned).map((s) => s.id), pos: p.pos.toArray().map(Math.round), health: Math.round(p.health), log: b.log.slice(-10) };
    if (b.done) d.end();
    return res;
  },
  // Plays the game as a player would, without drawing: no film mode, the real rules. It
  // follows whatever the story asks (paths, strings, waves, tuning by striking the notes) and
  // fights what wakes. Call repeatedly until `done`. opts.fresh starts a new journey;
  // opts.cheat keeps the bot alive (it is no duellist), so the run measures the road, not it.
  botPlay(seconds = 120, { fresh = false, cheat = true, side = true } = {}) {
    const d = director, g = game, p = g.player, dt = 1 / 30, pu = d.puppet;
    let b = this._play;
    if (!b || fresh) {
      if (fresh) {
        g.cine = false; g.input.puppet = null;
        g.cineSetup({ tuned: [] });
        for (const sp of g.spires) { sp.tuned = false; sp.power = 0; sp.zoneR = sp.zoneR0; sp.zone.z = sp.zoneR; sp.zone.w = 1; }
        g.enemies.list.length = 0; g.wildDone = []; g.xp = 0; g.bought = 0; g.ended = false; g.hasMap = false; g.metPeople = [];
        Object.assign(p.up, { health: 0, stamina: 0, blade: 0 }); g._skills();
        g.quests.state = {}; for (const it of g.quests.items) g.quests.group.remove(it.mesh); g.quests.items = []; g.trials.run = null; g.trials.list.forEach((t) => { t.done = false; }); g.trialsDone = []; g.bellsRung = {}; g.bells.list.forEach((q) => { q.rung = false; }); g.notes.list.forEach((n) => { n.taken = false; n.k = 1; }); g.notes.count = 0;
        for (const n of g.people.list) { n.awake = !n.spire; n.k = n.awake ? 1 : 0; g.people._dye(n); }
        g._spawnEncounters(); g.story.said.add('lookout'); p.spawn(sites.spawn.x, sites.spawn.y, sites.spawn.z, sites.spawn.yaw); g.story.leg = null; g.story._goal();
      }
      b = this._play = { t: 0, stuck: 0, last: p.pos.clone(), log: [], deaths: 0, obj: '', talkT: 0, sideT: 0, time: { story: 0, side: 0, fight: 0, talk: 0, ride: 0, tune: 0 } };
    }
    g.state = 'playing'; g.cine = false; g.input.enabled = true; g.input.puppet = pu;
    const save = g.save; g.save = () => {};                       // a bot run never touches the player's save
    const until = b.t + seconds, Q = g.quests;
    const go = (x, z, stop, sprint = true) => {
      // Straight at it; when something is in the way, sidestep for a moment.
      const there = d.walkTo(x, z, { sprint, stop });
      if (b.sideT > 0) { pu.move.x = b.sideDir; pu.move.y = 0.4; }
      return there;
    };
    while (b.t < until && b.stuck < 14) {
      pu.pressed.clear(); pu.held.clear(); pu.move.x = pu.move.y = 0;
      b.sideT -= dt;
      if (g.trials.run) b.trialOn = g.trials.run.t;
      else if (b.trialOn) { b.log.push(`${Math.round(b.t)}s ${b.trialOn.def.name} ${b.trialOn.done ? 'won' : 'lost'}`); if (!b.trialOn.done) (b.failed ??= []).push(b.trialOn.def.id); b.trialOn = null; }
      if (g.state === 'menu') { if (g.menu === 'bench') { let k; while ((k = ['blade', 'health', 'stamina'].find((u) => p.up[u] < 8)) && g.buy(k)) b.log.push(`${Math.round(b.t)}s bought ${k}`); } g.closeMenu(); g.input.enabled = true; g.input.puppet = pu; }
      const foe = g.enemies.list.some((e) => e.alive && e.state !== 'dormant' && e.pos.distanceTo(p.pos) < 26);
      const T = g.tuning;
      let mode = 'story';
      if (g.objective !== b.obj) { b.obj = g.objective; b.log.push(`${Math.round(b.t)}s ${b.obj}`); }
      if (p.state === 'dead') { if (!b.dead) { b.dead = true; b.deaths++; b.leg = null; b.log.push(`${Math.round(b.t)}s died at ${p.pos.toArray().map(Math.round)}`); } }
      else {
        b.dead = false;
        const tr = side ? g.tracker() : null;
        const trial = side && !foe && !g.trials.run ? g.trials.list.find((t) => !t.done && !b.failed?.includes(t.def.id) && Math.hypot(t.x - p.pos.x, t.z - p.pos.z) < 300) : null;
        // Someone awake nearby with something new to say, or a side quest close at hand.
        const who = side && !foe ? g.people.list.find((n) => n.awake && n.k >= 0.9 && Math.hypot(n.x - p.pos.x, n.z - p.pos.z) < 70 && (!g.metPeople?.includes(n.def.id) || Q.active.some((q) => q.giver === n.def.id && Q.state[q.id].s === 'ready'))) : null;
        const near = tr?.mark && Math.hypot(tr.mark.x - p.pos.x, tr.mark.z - p.pos.z) < 330 ? tr.mark : null;
        if (g.people.talk) { mode = 'talk'; b.talkT += dt; if (b.talkT > 3.2) { b.talkT = 0; pu.pressed.add('interact'); } }         // a reader's pace
        else if (T.active) { mode = 'tune'; if (T.phase === 'beats' && T.ring && Math.abs(T.bt - T.period) < 0.04) pu.pressed.add('interact'); }
        else if (p.state === 'ride') mode = 'ride';
        else if (foe) { mode = 'fight'; const hp = p.health, st = p.stamina; d.fight(dt); if (!cheat) { p.health = hp; p.stamina = st; } }
        else if (g.prompt && (/^(Tune|Take|Open|Ring)/.test(g.prompt.text) || (trial && /^Begin/.test(g.prompt.text)) || (who && /^Speak/.test(g.prompt.text)) || (g.marker?.name === 'String of light' && !near && /^Ride/.test(g.prompt.text)))) pu.pressed.add('interact');
        else if (who) { mode = 'side'; go(who.x, who.z, 2.3); }
        else if (near) { mode = 'side'; go(near.x, near.z, 0.6); }
        else if (trial) { mode = 'side'; go(trial.x, trial.z, 2.6); }
        else if (g.marker) {
          const m = g.marker, next = g.spires.find((q) => !q.tuned);
          // Whoever still sleeps at the court has to be woken before the spire will answer.
          const guard = next && !m.way && !m.ride ? g.enemies.list.find((e) => e.alive && e.group === next.id) : null;
          if (guard) go(guard.pos.x, guard.pos.z, 3, false);
          else if (m.way && LEGS[g.story.leg]) {
            // Keep to the path itself: the marker may already point a bend ahead.
            const leg = LEGS[g.story.leg];
            if (b.leg !== g.story.leg) { b.leg = g.story.leg; let bd = 1e9; leg.forEach(([x, z], i) => { const dd = Math.hypot(x - p.pos.x, z - p.pos.z); if (dd < bd) { bd = dd; b.wi = i; } }); }
            if (b.wi < leg.length) { if (d.walkTo(leg[b.wi][0], leg[b.wi][1], { sprint: true, stop: 2.2 })) b.wi++; }
            else d.walkTo(m.x, m.z, { sprint: true, stop: 2.2 });
          } else go(m.x, m.z, m.ride ? 2.6 : 1.5);
        } else if (g.ended && tr?.mark) { mode = 'side'; go(tr.mark.x, tr.mark.z, 0.6); }
        else if (g.ended) break;
      }
      b.time[mode] += dt;
      g.update(dt); story.update(dt); b.t += dt;
      if (Math.round(b.t / dt) % 120 === 0) {
        if (p.pos.distanceTo(b.last) < 0.6 && !foe && p.state === 'move' && !T.active && !g.people.talk) { b.stuck++; b.sideT = 1.3; b.sideDir = b.stuck % 2 ? 1 : -1; if (b.stuck % 3 === 0) b.log.push(`${Math.round(b.t)}s stuck at ${p.pos.toArray().map(Math.round)} (${g.objective})`); pu.pressed.add('jump'); g.update(dt); } else b.stuck = Math.max(0, b.stuck - 1);
        b.last.copy(p.pos);
      }
    }
    g.save = save; g.input.puppet = null; g.input.enabled = false;
    const tr = g.tracker();
    return { trials: g.trials.list.filter((t) => t.done).map((t) => t.def.id), seconds: Math.round(b.t), done: (!!g.ended && !Q.active.length) || b.stuck >= 14, ended: !!g.ended, tuned: g.spires.filter((q) => q.tuned).map((q) => q.id), pos: p.pos.toArray().map(Math.round), health: Math.round(p.health), deaths: b.deaths, xp: g.xp, up: { ...p.up },
      quests: Object.fromEntries(Object.entries(Q.state).map(([k, v]) => [k, v.s])), side: tr ? `${tr.title}: ${tr.text} ${tr.count ?? ''}` : null, notes: g.notes.count, time: Object.fromEntries(Object.entries(b.time).map(([k, v]) => [k, Math.round(v)])), objective: g.objective, log: b.log.slice(-12) };
  },
  // Random input at a list of places [x, z], without drawing: looks for falls through the
  // world, places the hero cannot get out of, and broken numbers.
  fuzz(places, seconds = 30, seed = 1) {
    const g = game, p = g.player, pu = director.puppet, dt = 1 / 30, out = [];
    let r = seed * 9301 + 49297; const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
    g.state = 'playing'; g.cine = false; g.input.enabled = true; g.input.puppet = pu;
    const save = g.save; g.save = () => {};
    for (const [x, z] of places) {
      g.world.stream(x, z, 8);
      const y0 = g.world.floorBelow(x, g.world.groundHeight(x, z) + 40, z, 80);
      p.spawn(x, y0 + 0.2, z, rnd() * 6.28); p.invulnerable = 1e9; g.rig.snap(p);
      let under = 0, stuck = 0, still = 0, nan = false, last = p.pos.clone(), minY = 1e9, far = 0, mx = 0, my = 1;
      for (let t = 0, k = 0; t < seconds; t += dt, k++) {
        pu.pressed.clear(); pu.held.clear();
        if (k % 18 === 0) { const a = rnd() * 6.28; mx = Math.sin(a); my = Math.cos(a); g.rig.yaw = rnd() * 6.28; }
        pu.move.x = mx; pu.move.y = my;
        if (rnd() < 0.02) pu.pressed.add('jump'); if (rnd() < 0.015) pu.pressed.add('dodge'); if (rnd() < 0.02) pu.pressed.add('attack'); if (rnd() < 0.5) pu.held.add('sprint');
        g.update(dt);
        if (!Number.isFinite(p.pos.x + p.pos.y + p.pos.z)) { nan = true; break; }
        const gh = g.world.groundHeight(p.pos.x, p.pos.z);
        if (p.pos.y < gh - 1.5 && p.state !== 'swim') under++;
        minY = Math.min(minY, p.pos.y - gh);
        if (k % 45 === 44) { if (p.pos.distanceTo(last) < 0.25 && p.state === 'move') { still++; if (still >= 3) stuck++; } else still = 0; last.copy(p.pos); }
        far = Math.max(far, Math.hypot(p.pos.x - x, p.pos.z - z));
        if (p.state === 'dead') { p.spawn(x, y0 + 0.2, z, 0); p.invulnerable = 1e9; }
      }
      if (under || stuck || nan) out.push({ at: [x, z], under, stuck, nan, minY: +minY.toFixed(1), end: p.pos.toArray().map(Math.round), far: Math.round(far) });
    }
    g.save = save; g.input.puppet = null; g.input.enabled = false; p.invulnerable = 0;
    return { places: places.length, bad: out };
  },
  // A contact sheet of the film: one pass through the timeline, a still at each given time.
  reel(times = [3, 9, 14.5, 19.5, 25, 32, 38, 43.5], cols = 4) {
    freeCam = true; ui.root.style.display = 'none';
    let c = document.getElementById('sheet');
    if (!c) { c = document.createElement('canvas'); c.id = 'sheet'; c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:9'; document.body.appendChild(c); }
    c.width = canvas.width; c.height = canvas.height;
    const ctx = c.getContext('2d'), rows = Math.ceil(times.length / cols), w = c.width / cols, h = c.height / rows;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height);
    director.begin();
    const dt = 1 / 30;
    times.forEach((t, i) => {
      while (director.time < t) { director.advance(dt); lattice.update(dt); game.update(dt); }
      pipe.taa.reset = true;
      for (let k = 0; k < 8; k++) { director.advance(1 / 240); lattice.update(1 / 240); game.update(1 / 240); pipe.render(1 / 240); }
      // Letterbox each still into its cell at the film's 16:9.
      const ch = Math.min(h, (w * 9) / 16), sh = Math.min(canvas.height, (canvas.width * 9) / 16);
      ctx.drawImage(canvas, 0, (canvas.height - sh) / 2, canvas.width, sh, (i % cols) * w, Math.floor(i / cols) * h + (h - ch) / 2, w, ch);
    });
    return { time: +director.time.toFixed(2) };
  },
  // One finished film frame at time t, exactly as the capture would grade it (depth of
  // field, motion blur, tone curve), shown over the page.
  // With size = [w, h] the frame is rendered at that resolution (3840 x 2160, say) and
  // crop = [x, y, w, h] shows that part of it pixel for pixel, to judge the 4K film here.
  filmStill(t, sub = 3, { size = null, crop = null } = {}) {
    freeCam = true; ui.root.style.display = 'none';
    const old = [pipe.displayW, pipe.displayH];
    if (size) pipe.setSize(size[0], size[1]);
    const film = (this._film ??= new FilmOutput(pipe));
    if (film.w !== canvas.width || film.h !== canvas.height) film.setSize(canvas.width, canvas.height);
    director.begin();
    const world = (dt) => { director.advance(dt); lattice.update(dt); game.update(dt); };
    while (director.time < t) world(1 / 30);
    for (let i = 0; i < 4; i++) film.frame(world, 1 / 60, sub, 0.5);
    const px = film.readSdr(), w = film.w, h = film.h;
    let c = document.getElementById('sheet');
    if (!c) { c = document.createElement('canvas'); c.id = 'sheet'; c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:9'; document.body.appendChild(c); }
    const [cx, cy, cw, ch] = crop ?? [0, 0, w, h];
    c.width = cw; c.height = ch;
    const img = new ImageData(cw, ch);
    for (let y = 0; y < ch; y++) { const o = ((h - 1 - cy - y) * w + cx) * 4; img.data.set(px.subarray(o, o + cw * 4), y * cw * 4); }
    c.getContext('2d').putImageData(img, 0, 0);
    pipe.renderer.setRenderTarget(null);
    if (size) pipe.setSize(old[0], old[1]);
    return { time: +director.time.toFixed(2), dof: pipe.dof };
  },
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

if (params.get('capture')) { await runCapture(); }

// --- ?perf=1: measures each quality preset at a few viewpoints and logs the results ---
async function runPerf() {
  const gl = pipe.renderer.getContext(), px = new Uint8Array(4);
  const spots = [['terrace', -519, 210.5, -70, Math.PI / 2], ['meadow', -600, 210.2, -180, 0.9], ['court', -372, 178.4, -410, 0]];
  ui.root.style.display = 'none';
  game.state = 'playing'; game.input.enabled = false;
  const out = [];
  for (const preset of ['low', 'medium', 'high', 'ultra']) {
    settings.set('preset', preset); apply();
    for (const [name, x, y, z, yaw] of spots) {
      game.player.spawn(x, y, z, yaw); game.rig.snap(game.player); game.rig.yaw = yaw; game.rig.pitch = -0.08;
      for (let i = 0; i < 40; i++) tick(1 / 60);
      pipe.renderer.setRenderTarget(null);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);     // drain the warm-up frames
      const times = [];
      for (let i = 0; i < 60; i++) {
        const t0 = performance.now();
        tick(1 / 60);
        pipe.renderer.setRenderTarget(null);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);   // waits for the GPU
        times.push(performance.now() - t0);
      }
      times.sort((a, b) => a - b);
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      out.push(`${preset.padEnd(6)} ${name.padEnd(8)} ${pipe.rw}x${pipe.rh}  avg ${avg.toFixed(1)} ms  med ${times[30].toFixed(1)}  p95 ${times[56].toFixed(1)}  max ${times[59].toFixed(0)} ms  (${(1000 / avg).toFixed(0)} fps, ${(1000 / times[30]).toFixed(0)} typical)  tris ${pipe.renderer.info.render.triangles}  calls ${pipe.renderer.info.render.calls}`);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  console.log('[perf]\n' + out.join('\n'));
  console.log('[perf] done');
}
if (params.get('perf')) { await runPerf(); }

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  // Development: sessionStorage.uvHold = '1' stops the page drawing on its own, so frames are
  // only rendered when stepped through __dbg (keeps the GPU free while other work runs).
  if (sessionStorage.getItem('uvHold') !== '1') tick(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
