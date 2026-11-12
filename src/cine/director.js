// Cinematic director: a timeline of shots played with a fixed time step. Each shot can
// place the camera, drive the hero through the same input the player uses, and set world
// state (which spires are tuned, which enemies are awake), so the film is the game itself.
import * as THREE from 'three';

const ease = (t) => t * t * (3 - 2 * t);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

// Smooth path through points (Catmull-Rom), with eased time.
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
    this.shots = this.buildShots();
    this.duration = this.shots.reduce((s, x) => s + x.dur, 0);
  }

  // Camera helper: position, look-at target and field of view.
  cam(pos, target, fov = 40) {
    const c = this.pipe.camera;
    c.position.set(pos[0], pos[1], pos[2]);
    c.lookAt(target[0], target[1], target[2]);
    if (Math.abs(c.fov - fov) > 1e-3) { c.fov = fov; c.updateProjectionMatrix(); }
  }

  begin() {
    const g = this.game;
    g.state = 'playing'; g.cine = true; g.input.enabled = true; g.input.puppet = this.puppet;
    this.time = 0; this.index = -1;
  }

  end() { const g = this.game; g.cine = false; g.input.puppet = null; g.toHome(); }

  // Moves the film forward by dt (called once per sub-frame by the film output).
  advance(dt) {
    let t = this.time, i = 0;
    while (i < this.shots.length - 1 && t >= this.shots[i].dur) { t -= this.shots[i].dur; i++; }
    const shot = this.shots[i];
    if (i !== this.index) {
      this.index = i;
      this.puppet.move.x = this.puppet.move.y = 0; this.puppet.held.clear(); this.puppet.pressed.clear();
      shot.setup?.(this);
      this.pipe.taa.reset = true;
    }
    this.shotTime = t;
    shot.update(this, t, t / shot.dur, dt);
    this.time += dt;
  }

  buildShots() {
    const v = this.sites.vista;
    return [
      {
        // Opening: a slow rise over the terrace toward the rings.
        dur: 6,
        update: (d, t, k) => {
          const p = along([[v.x - 30, v.y + 0.4, v.z - 6], [v.x - 18, v.y + 1.4, v.z - 2], [v.x - 4, v.y + 3.4, v.z + 1]], k);
          d.cam(p, [v.x + 400, v.y + 60 - 30 * k, v.z + 90], 38 + 6 * k);
        },
      },
      {
        // Glide down the valley between the mesas.
        dur: 6,
        update: (d, t, k) => {
          const p = along([[-380, 150, 30], [-180, 112, -20], [40, 104, 60], [230, 118, 20]], k, false);
          const q = along([[-380, 150, 30], [-180, 112, -20], [40, 104, 60], [230, 118, 20], [520, 130, 60]], Math.min(1, k * 0.75 + 0.2), false);
          d.cam(p, [q[0] + 60, q[1] - 6, q[2] + 12], 46);
        },
      },
    ];
  }
}
