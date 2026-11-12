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

const pipe = new Pipeline(canvas, { renderScale: Number(params.get('scale')) || 1, sky: { ...WORLD.sun } });
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
];
terrain.bakePaths(routes, [
  // Paved courts and platforms, where no grass should push through the stone.
  [-372, -392, -372, -392, 18.7], [66, -498, 66, -498, 21.7], [150, -15, 150, -15, 39.7], [94, -336, 102, -336, 4.9],
  // The long stair between the Petal mesa and Cantor's Rise, and its upper landing.
  [-172, -459, -119, -459, 5.4], [-178.5, -459, -178.5, -459, 6.6],
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

await stage(0.56, 'Letting the water fall');
const falls = new Waterfalls(pipe, terrain, arch.mesas);
window.__falls = falls;
pipe.sceneT.add(falls.group);

await stage(0.64, 'Growing the forest');
const forest = new Forest(pipe, terrain);
window.__forest = forest;
// Keep trees off the paved sites and the routes between them.
const clear = [...POOLS.map((p) => [p.x, p.z, p.r + 5]), [-512, -70, 34], [-540, -22, 9], [-372, -392, 24], [66, -498, 27], [96, -590, 34], [98, -336, 13], [150, -15, 44], [-146, -459, 34]];
forest.populate((x, z) => clear.some(([cx, cz, r]) => (x - cx) * (x - cx) + (z - cz) * (z - cz) < r * r), [
  { x: -531, z: -93, species: 'ember', scale: 1.3 }, { x: -533, z: -46, species: 'blossom', scale: 1.25 }, { x: -549, z: -34, species: 'elder', scale: 1.0 },
  { x: -356, z: -420, species: 'blossom', scale: 1.2 }, { x: -392, z: -376, species: 'ember', scale: 1.15 }, { x: 40, z: -520, species: 'blossom', scale: 1.2 },
  // A few old giants that stand well above the canopy and mark the sites from afar.
  { x: -582, z: -96, species: 'elder', scale: 1.9 }, { x: -604, z: -28, species: 'blossom', scale: 2.0 },
  { x: -300, z: -452, species: 'elder', scale: 1.8 }, { x: 18, z: -562, species: 'blossom', scale: 2.0 },
  { x: 192, z: 22, species: 'blossom', scale: 1.8 }, { x: 100, z: -30, species: 'elder', scale: 1.7 },
  { x: 40, z: 600, species: 'elder', scale: 2.4 }, { x: -420, z: 360, species: 'blossom', scale: 2.6 }, { x: -330, z: 470, species: 'elder', scale: 2.3 },
  { x: 600, z: -400, species: 'elder', scale: 2.4 }, { x: 600, z: 470, species: 'blossom', scale: 2.6 }, { x: -900, z: -160, species: 'elder', scale: 2.6 },
]);
forest.addGreatTree(2750, terrain.heightAt(2750, 1480) - 6, 1480);
pipe.scene.add(forest.group);
const cover = new GroundCover(pipe, terrain, forest.leafAtlas, forest.wind);
pipe.scene.add(cover.group);
// Boulders under the cliffs and along the shore, stones in the meadows; none on the sites
// or across the routes between them.
const onRoute = (x, z) => routes.some((r) => r.some((a, i) => {
  if (i === 0) return false;
  const b = r[i - 1], dx = a[0] - b[0], dz = a[1] - b[1], t = Math.max(0, Math.min(1, ((x - b[0]) * dx + (z - b[1]) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - b[0] - dx * t, z - b[1] - dz * t) < 6;
}));
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
dressing.finish();
pipe.scene.add(dressing.group);
pipe.sceneT.add(dressing.groupT);

await stage(0.82, 'Waking the valley');
const game = new Game({ pipe, terrain, arch, sites, canvas });
window.__game = game;
window.__parts = { terrain, water, falls, forest, cover, rocks, dressing, arch, lattice, vines, gloss };
// The hero model is generated by tools/blender/hero.py; until it exists a stand-in is used.
fetch('/models/hero.glb', { method: 'HEAD' }).then((r) => (r.ok && /model|octet/.test(r.headers.get('content-type') ?? '') ? Hero.load(pipe) : null)).then((h) => { if (h) { game.attachHero(h); window.__hero = h; } }).catch((e) => console.warn('hero model not loaded', e));
const audio = new AudioManager();
window.__audio = audio;
const apply = () => applySettings(settings, { pipe, game, cover, audio, gloss });
const ui = new UI({ game, settings, apply });
window.__ui = ui;
const updateAudio = connectAudio(audio, game, ui, falls);
audio.init().then((ok) => { if (ok) apply(); });
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => audio.resume());
if (params.get('scale')) settings.values.renderScale = Number(params.get('scale'));
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
  ui.update(dt);
  updateAudio(dt);
  pipe.render(dt);
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
  settings.values.renderScale = 1; settings.values.shadows = true; settings.values.volumetrics = true; settings.values.cover = 1; settings.values.reflections = true;
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
  strip({ n = 8, every = 4, moveY = 1, press = [], hold = [], dist = 4.4, side = 1, height = 1.1, tp = null, fov = 34 } = {}) {
    this.ui(false);
    freeCam = true; game.state = 'playing'; game.cine = true; game.input.enabled = true;
    const inp = game.input, real = inp.update.bind(inp);
    let first = press;
    inp.update = () => { inp.pressed = new Set(first ?? []); first = null; inp.held = new Set(hold); inp.move.x = 0; inp.move.y = moveY; inp.look.x = 0; inp.look.y = 0; inp.zoom = 0; };
    if (tp) { game.player.spawn(...tp); game.rig.yaw = tp[3] ?? 0; }
    let c = document.getElementById('sheet');
    if (!c) { c = document.createElement('canvas'); c.id = 'sheet'; c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:9'; document.body.appendChild(c); }
    c.width = canvas.width; c.height = canvas.height;
    const ctx = c.getContext('2d'), cols = Math.ceil(n / 2), w = c.width / cols, h = c.height / 2;
    pipe.camera.fov = fov; pipe.camera.updateProjectionMatrix();
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < every; k++) {
        const p = game.player.pos, yaw = game.player.yaw, fx = Math.sin(yaw), fz = Math.cos(yaw);
        pipe.camera.position.set(p.x + fz * dist * side, p.y + height, p.z - fx * dist * side);
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
  // A contact sheet of the film: one pass through the timeline, a still at each given time.
  reel(times = [3, 9, 14.5, 19.5, 26, 34.5, 40.5, 44], cols = 4) {
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
  filmStill(t, sub = 3) {
    freeCam = true; ui.root.style.display = 'none';
    const film = (this._film ??= new FilmOutput(pipe));
    if (film.w !== canvas.width || film.h !== canvas.height) film.setSize(canvas.width, canvas.height);
    director.begin();
    const world = (dt) => { director.advance(dt); lattice.update(dt); game.update(dt); };
    while (director.time < t) world(1 / 30);
    for (let i = 0; i < 4; i++) film.frame(world, 1 / 60, sub, 0.5);
    const px = film.readSdr(), w = film.w, h = film.h;
    let c = document.getElementById('sheet');
    if (!c) { c = document.createElement('canvas'); c.id = 'sheet'; c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:9'; document.body.appendChild(c); }
    c.width = w; c.height = h;
    const img = new ImageData(w, h);
    for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    c.getContext('2d').putImageData(img, 0, 0);
    pipe.renderer.setRenderTarget(null);
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
