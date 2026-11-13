// Cinematic director: a timeline of shots played with a fixed time step. Each shot places
// the camera, drives the hero through the same input the player uses, and sets the story
// state (which spires are tuned, which enemies are awake), so the film is the game itself.
import * as THREE from 'three';

const ease = (t) => t * t * (3 - 2 * t);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const lerp = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// Smooth path through points (Catmull-Rom).
function along(points, t, easing = true) {
  const k = (easing ? ease(clamp01(t)) : clamp01(t)) * (points.length - 1);
  const i = Math.min(points.length - 2, Math.floor(k)), u = k - i;
  const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) out[c] = 0.5 * ((2 * p1[c]) + (-p0[c] + p2[c]) * u + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * u * u + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * u * u * u);
  return out;
}

export class Director {
  constructor({ pipe, game, sites, terrain }) {
    this.pipe = pipe; this.game = game; this.sites = sites; this.terrain = terrain;
    this.time = 0; this.index = -1; this.shotTime = 0;
    this.puppet = { move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, pressed: new Set(), held: new Set() };
    this.focus = new THREE.Vector3();          // smoothed look-at point
    this.shots = this.buildShots();
    this.duration = this.shots.reduce((s, x) => s + x.dur, 0);
  }

  // lens: [focus distance in metres, blur]. blur is the circle of confusion in pixels (on a
  // 2160-line frame) times metres; 0 keeps everything sharp.
  cam(pos, target, fov = 40, lens = null) {
    const c = this.pipe.camera;
    c.position.set(pos[0], pos[1], pos[2]);
    c.lookAt(target[0], target[1], target[2]);
    this.pipe.dof = lens ? { focus: lens[0], blur: lens[1] } : null;
    if (Math.abs(c.fov - fov) > 1e-3) { c.fov = fov; c.updateProjectionMatrix(); }
  }

  begin() {
    const g = this.game;
    g.state = 'playing'; g.cine = true; g.input.enabled = true; g.input.puppet = this.puppet;
    g.bakeGround?.(false);
    this.time = 0; this.index = -1;
  }
  end() { const g = this.game; g.cine = false; g.input.puppet = null; g.bakeGround?.(true); g.cineSetup({ tuned: [] }); g.load(); g._charms?.(); g.toHome(); }

  // Steers the hero toward a point by setting the movement stick; the camera yaw used for
  // movement is fixed to the travel direction so "forward" means "toward the goal".
  walkTo(x, z, { sprint = false, stop = 0.4 } = {}) {
    const p = this.game.player, dx = x - p.pos.x, dz = z - p.pos.z, d = Math.hypot(dx, dz);
    if (d < stop) { this.puppet.move.y = 0; this.puppet.held.delete('sprint'); return true; }
    this.game.rig.yaw = Math.atan2(dx, dz);
    this.puppet.move.x = 0; this.puppet.move.y = 1;
    if (sprint) this.puppet.held.add('sprint'); else this.puppet.held.delete('sprint');
    return false;
  }

  // A simple duellist: close on the nearest enemy, strike in combos, roll away from wind-ups.
  fight(dt) {
    const g = this.game, p = g.player;
    p.stamina = 100; p.health = Math.max(p.health, 70);
    let best = null, bd = 1e9;
    for (const e of g.enemies.list) { if (!e.alive || e.state === 'dormant') continue; const d = e.pos.distanceTo(p.pos); if (d < bd) { bd = d; best = e; } }
    this.puppet.move.x = this.puppet.move.y = 0;
    if (!best) return null;
    g.rig.yaw = Math.atan2(best.pos.x - p.pos.x, best.pos.z - p.pos.z);
    this._atk = (this._atk ?? 0) - dt;
    if (best.state === 'windup' && best.t > best.def.windup * 0.55 && bd < best.def.reach + 1.5 && p.state === 'move') { this.puppet.move.x = 1; this.puppet.pressed.add('dodge'); }
    else if (bd > 2.3 + best.def.radius) this.puppet.move.y = 1;
    else if (this._atk <= 0) { this.puppet.pressed.add('attack'); this._atk = 0.3; }
    return best;
  }

  advance(dt) {
    // A hair ahead of the clock, so rounding never leaves the first sub-frame after a cut in
    // the shot before it.
    let t = this.time + 1e-5, i = 0;
    while (i < this.shots.length - 1 && t >= this.shots[i].dur) { t -= this.shots[i].dur; i++; }
    const shot = this.shots[i];
    if (i !== this.index) {
      this.index = i;
      this.puppet.move.x = this.puppet.move.y = 0; this.puppet.held.clear(); this.puppet.pressed.clear();
      this._atk = 0; this._flag = {};
      // A ride along a string ends with its shot.
      if (this.game.strings?.ride) { this.game.strings.ride = null; this.game.strings.speed = 0; this.game.player.invulnerable = 0; }
      shot.setup?.(this);
      this.pipe.taa.reset = true;
    }
    this.shotTime = t;
    shot.update(this, t, t / shot.dur, dt);
    this.time += dt;
  }

  buildShots() {
    const T = this.terrain, H = (x, z) => T.heightAt(x, z);
    const terrace = [-512, 210.4, -70];
    const petal = this.sites.spires[0], cantor = this.sites.spires[1], choir = this.sites.spires[2];
    const vd = this.sites.viaduct, va = vd.a, vc = vd.c, vyaw = Math.atan2(vc[0] - va[0], vc[1] - va[1]);
    const vLen = Math.hypot(vc[0] - va[0], vc[1] - va[1]), vStart = 25;      // metres along the deck where the run begins
    const vdir = [Math.sin(vyaw), Math.cos(vyaw)];
    const br = this.sites.bridge;
    // Where the Colossus stands in the Choir, and the way from the spire out past it.
    const col = [156, -4], cl = Math.hypot(col[0] - choir.x, col[1] - choir.z), cu = [(col[0] - choir.x) / cl, (col[1] - choir.z) / cl];
    return [
      { // 1. Dawn: the Cantor at the lookout, the Lattice ahead.
        dur: 6.5,
        setup: (d) => d.game.cineSetup({ tuned: [], player: [terrace[0] + 15.5, terrace[1] + 0.05, terrace[2] - 1.5, Math.PI / 2] }),
        update: (d, t, k) => {
          // Drift up behind the Cantor so the rings rise over his shoulder.
          const h = d.game.player.pos;
          const p = along([[h.x - 15, h.y + 0.9, h.z - 5.5], [h.x - 9.5, h.y + 1.35, h.z - 3.6], [h.x - 5.2, h.y + 1.9, h.z - 2.0]], k);
          const near = Math.hypot(p[0] - h.x, p[1] - h.y - 1.2, p[2] - h.z);
          d.cam(p, [h.x + 260, h.y + 38 - 8 * k, h.z + 70], lerp(34, 38, k), [lerp(near, 400, ease(clamp01(k * 1.5))), 70]);
        },
      },
      { // 2. Down the valley between the mesas.
        dur: 5.5,
        update: (d, t, k) => {
          // Low over the lake, threading the pinnacles and passing south of the Choir.
          const path = [[-470, 172, 24], [-250, 128, 8], [-40, 104, 96], [150, 100, 150], [330, 112, 40], [600, 126, 30]];
          const a = along(path, k * 0.8, false), b = along(path, Math.min(1, k * 0.8 + 0.16), false);
          d.cam(a, [b[0], b[1] - 4, b[2]], 46);
        },
      },
      { // 3. Sprinting the high viaduct, backlit.
        dur: 5,
        setup: (d) => d.game.cineSetup({ tuned: [], player: [va[0] + vdir[0] * vStart, vd.ya + ((vd.yc - vd.ya) * vStart) / vLen + 0.2, va[1] + vdir[1] * vStart, vyaw] }),
        update: (d, t, k) => {
          const p = d.game.player.pos;
          d.walkTo(vc[0], vc[1], { sprint: true, stop: 6 });
          // A crane out over the drop on the shaded side: he runs past, the sun behind him.
          const side = [-vdir[1], vdir[0]];
          const lead = 11 - 17 * k;
          const cp = [p.x - side[0] * 8.5 + vdir[0] * lead, p.y + 3.6 - 1.2 * k, p.z - side[1] * 8.5 + vdir[1] * lead];
          d.cam(cp, [p.x + vdir[0] * 0.8, p.y + 1.15, p.z + vdir[1] * 0.8], 36, [Math.hypot(cp[0] - p.x, cp[1] - p.y - 1.1, cp[2] - p.z), 80]);
        },
      },
      { // 4. The Petal Court lies silent; the Mute pull themselves together.
        dur: 5,
        setup: (d) => d.game.cineSetup({ tuned: [], player: [petal.x - 4, petal.base + 0.2, petal.z + 26, Math.PI] }),
        update: (d, t, k) => {
          const g = d.game, e = g.enemies.list.find((x) => x.group === 'petal');
          d.walkTo(petal.x - 3, petal.z + 15, { stop: 0.6 });
          if (t > 0.7 && !d._flag.woke) { d._flag.woke = true; for (const x of g.enemies.list) if (x.group === 'petal') { x.state = 'rise'; x.t = 0; } }
          // Hold the constructs until the fight shot.
          for (const x of g.enemies.list) if (x.group === 'petal' && x.state === 'chase') { x.t = 0; x.vel.set(0, 0, 0); x.pos.copy(x.home); }
          const c = e ? e.home : new THREE.Vector3(petal.x, petal.base, petal.z);
          const a = 2.2 + 0.5 * k;
          d.cam([c.x + Math.cos(a) * (5.2 - 1.4 * k), c.y + 0.5 + 1.2 * k, c.z + Math.sin(a) * (5.2 - 1.4 * k)], [c.x, c.y + 0.5 + 1.1 * k, c.z], 36, [5.2 - 1.4 * k, 110]);
        },
      },
      { // 5. The duel.
        dur: 6.5,
        setup: (d) => {
          const g = d.game;
          g.cineSetup({ tuned: [], player: [petal.x - 3, petal.base + 0.2, petal.z + 14, Math.PI] });
          for (const x of g.enemies.list) if (x.group === 'petal') { x.state = 'chase'; x.assembled = 1; x.hp = 44; x.snap = true; }
          d.focus.set(petal.x, petal.base + 1.2, petal.z + 9);
        },
        update: (d, t, k, dt) => {
          const g = d.game, p = g.player;
          const e = d.fight(dt);
          const c = e ? p.pos.clone().lerp(e.pos, 0.5) : p.pos.clone();
          d.focus.lerp(new THREE.Vector3(c.x, c.y + 1.15, c.z), Math.min(1, 3 * dt));
          const a = 0.5 + k * 1.9, r = 6.8 - 1.2 * Math.sin(k * Math.PI);
          d.cam([d.focus.x + Math.cos(a) * r, d.focus.y + 0.5 + 0.6 * k, d.focus.z + Math.sin(a) * r], [d.focus.x, d.focus.y, d.focus.z], 38, [r, 60]);
        },
      },
      { // 6. Tuning the spire: light, and colour flooding back.
        dur: 7,
        setup: (d) => {
          const g = d.game;
          g.cineSetup({ tuned: [], player: [petal.x + 0.6, petal.base + 0.9, petal.z + 5.2, Math.PI] });
          g.enemies.list = g.enemies.list.filter((x) => x.group !== 'petal');
        },
        update: (d, t, k) => {
          const p = d.game.player.pos;
          if (t > 0.6) d.puppet.held.add('interact');
          // Start close and low on the raised blade, then crane up and back as the wave spreads.
          const u = ease(clamp01((t - 2.0) / 5));
          const pos = mix3([p.x + 2.6, p.y + 0.9, p.z + 3.6], [petal.x + 24, petal.base + 17, petal.z + 44], u);
          const tgt = mix3([petal.x, petal.base + 3.5, petal.z], [petal.x, petal.base + 11, petal.z], u);
          d.cam(pos, tgt, lerp(34, 46, u), [Math.hypot(pos[0] - p.x, pos[1] - p.y - 1.2, pos[2] - p.z), 85 * (1 - u)]);
        },
      },
      { // 7. The light bridge forms toward the Choir.
        dur: 5,
        setup: (d) => d.game.cineSetup({ tuned: ['petal', 'cantor'], bridge: 0.0001, player: [br.from[0], br.from[1] + 0.1, br.from[2] + 0.5, 0.21] }),
        update: (d, t, k) => {
          const p = d.game.player.pos;
          d.walkTo(lerp(br.from[0], br.to[0], 0.3), lerp(br.from[2], br.to[2], 0.3), { stop: 1 });
          // Behind the Cantor at the bridge head, rising as the span races away to the Choir.
          const L = Math.hypot(br.to[0] - br.from[0], br.to[2] - br.from[2]);
          const dx = (br.to[0] - br.from[0]) / L, dz = (br.to[2] - br.from[2]) / L, e = ease(k);
          const back = 4.2 + 1.3 * e;
          // Starts above the grass at the bridge head so no blades stand in front of the lens.
          d.cam([p.x - dx * back - dz * 1.7, p.y + 2.05 + 1.5 * e, p.z - dz * back + dx * 1.7],
            [lerp(br.from[0], br.to[0], 0.6), lerp(br.from[1], br.to[1], 0.6) + 6, lerp(br.from[2], br.to[2], 0.6)], 42);
        },
      },
      { // 8. The Choir: what keeps it gets to its feet.
        dur: 4.5,
        setup: (d) => {
          const g = d.game;
          g.cineSetup({ tuned: ['petal', 'cantor'], player: [col[0] + cu[0] * 14, choir.base + 0.2, col[1] + cu[1] * 14, Math.atan2(-cu[0], -cu[1])] });
          g.enemies.list = g.enemies.list.filter((x) => x.group !== 'choir' || x.kind === 'colossus');
        },
        update: (d, t, k) => {
          const g = d.game, p = g.player.pos, e = g.enemies.list.find((x) => x.kind === 'colossus');
          d.walkTo(col[0] + cu[0] * 10, col[1] + cu[1] * 10, { stop: 0.6 });
          if (t > 0.4 && !d._flag.woke && e) { d._flag.woke = true; e.state = 'rise'; e.t = 0; }
          if (e && e.state === 'chase') { e.t = 0; e.vel.set(0, 0, 0); e.pos.copy(e.home); }
          // Low behind his shoulder, looking up at it as it stands.
          const pos = [p.x + cu[0] * (4.4 - 0.9 * k) + cu[1] * 1.9, p.y + 0.7 + 0.3 * k, p.z + cu[1] * (4.4 - 0.9 * k) - cu[0] * 1.9];
          d.cam(pos, [col[0], choir.base + 2.4 + 2.6 * k, col[1]], lerp(40, 35, k), [Math.hypot(pos[0] - col[0], pos[2] - col[1]), 55]);
        },
      },
      { // 9. The Colossus.
        dur: 6,
        setup: (d) => {
          const g = d.game;
          g.cineSetup({ tuned: ['petal', 'cantor'], player: [col[0] + cu[0] * 8, choir.base + 0.2, col[1] + cu[1] * 8, Math.atan2(-cu[0], -cu[1])] });
          g.enemies.list = g.enemies.list.filter((x) => x.group !== 'choir' || x.kind === 'colossus');
          for (const x of g.enemies.list) if (x.kind === 'colossus') { x.state = 'chase'; x.assembled = 1; x.snap = true; }
          d.focus.set(col[0] + cu[0] * 4, choir.base + 2, col[1] + cu[1] * 4);
        },
        update: (d, t, k, dt) => {
          const p = d.game.player, e = d.fight(dt);
          const c = e ? p.pos.clone().lerp(e.pos, 0.55) : p.pos.clone();
          d.focus.lerp(new THREE.Vector3(c.x, choir.base + 2, c.z), Math.min(1, 3 * dt));
          // A wide, low circle, so the size of the thing is plain, the spire behind it.
          const a = Math.atan2(cu[1], cu[0]) - 0.75 + 1.5 * k, r = 11.5 - 1.5 * Math.sin(k * Math.PI);
          d.cam([d.focus.x + Math.cos(a) * r, d.focus.y - 0.9 + 0.8 * k, d.focus.z + Math.sin(a) * r], [d.focus.x, d.focus.y + 0.5, d.focus.z], 40, [r, 35]);
        },
      },
      { // 10. Along a string of light to the Lantern Court.
        dur: 5.5,
        setup: (d) => {
          const g = d.game, S = g.strings, n = S.nodes.choir, o = S.nodes.east;
          g.cineSetup({ tuned: ['petal', 'cantor', 'choir'], player: [n.x + 1.2, n.y + 0.1, n.z, Math.atan2(o.x - n.x, o.z - n.z)] });
          // Taken up a fifth of the way along, where the string runs fastest.
          if (S.rideTo('east')) { const r = S.ride; r.t = r.dur * 0.2; r.s = ((0.2 - 0.05) / 0.9) * r.total; }
        },
        update: (d, t, k, dt) => {
          // The film carries him along itself: the strings do not run their rides in it.
          const S = d.game.strings; if (S.ride) S._ride(dt);
          const p = d.game.player, f = [Math.sin(p.yaw), Math.cos(p.yaw)], e = ease(k);
          // Beside him at first, then falling back until the whole string is ahead.
          const back = lerp(4.5, 8.5, e), out = lerp(4.2, 1.6, e);
          d.cam([p.pos.x - f[0] * back + f[1] * out, p.pos.y + 2.2 + 1.0 * k, p.pos.z - f[1] * back - f[0] * out], [p.pos.x + f[0] * 16, p.pos.y + 1.4, p.pos.z + f[1] * 16], 48);
        },
      },
      // 11-13. The Vale with every spire singing, crossed from the west to the far shore.
      ...[
        [6, [-640, 286, -40], [-420, 240, -150], [-372, 196, -392], [66, 176, -498]],
        [6, [-160, 250, 120], [80, 230, 60], [150, 110, -15], [578, 150, -437]],
        [7, [260, 300, 200], [420, 360, 120], [900, 160, 500], [2750, 330, 1480]],
      ].map(([dur, a0, a1, b0, b1]) => ({
        dur,
        setup: (d) => d.game.cineSetup({ tuned: ['petal', 'cantor', 'choir'], player: [terrace[0] + 15.5, terrace[1] + 0.05, terrace[2] - 1.5, Math.PI / 2] }),
        update: (d, t, k) => {
          const e = k * (0.35 + 0.65 * (k * (2 - k)));          // away at speed, settling as the leg ends
          const a = mix3(a0, a1, e), b = mix3(b0, b1, e);
          a[1] = Math.max(a[1], H(a[0], a[2]) + 12);
          d.cam(a, b, 50);
        },
      })),
      { // 14. The valley at day's end: the longest look at the whole of it.
        dur: 4.5,
        setup: (d) => d.game.cineSetup({ tuned: ['petal', 'cantor', 'choir'], player: [terrace[0] + 15.5, terrace[1] + 0.05, terrace[2] - 1.5, Math.PI / 2] }),
        update: (d, t, k) => {
          // Rising back from above the lookout, clear of the trees, as the whole valley opens.
          const p = along([[terrace[0] + 10, terrace[1] + 13, terrace[2] + 22], [terrace[0] + 3, terrace[1] + 20, terrace[2] + 27], [terrace[0] - 6, terrace[1] + 29, terrace[2] + 33]], k);
          d.cam(p, [terrace[0] + 320, terrace[1] + 14, terrace[2] + 50], 44);
        },
      },
    ];
  }
}
