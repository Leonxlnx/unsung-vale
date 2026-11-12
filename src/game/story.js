// Story: the short opening, the lines that accompany the journey, and what the player is
// asked to do next. It owns no rules of its own: it watches the game, puts words on screen
// through the UI, and during the opening it leads the camera and the hero.
import * as THREE from 'three';

// The way from the terrace to each spire, as the paths run: breadcrumbs for the marker, so
// the next goal is always a short walk ahead instead of a number half a kilometre away.
export const LEGS = {
  petal: [[-538, -70], [-551, -100], [-562, -138], [-573, -152], [-447, -290], [-427, -320], [-398, -358], [-380, -378]],
  cantor: [[-358, -402], [-300, -424], [-232, -449], [-180, -459], [-118, -459], [-60, -470], [8, -488], [46, -496]],
  choir: [[72, -478], [85, -420], [96, -362], [98, -344], [98, -330], [150, -84], [150, -40]],
};
export const NAMES = { dawn: 'the Dawn Terrace', petal: 'the Petal Court', cantor: "Cantor's Rise", choir: 'the Choir', east: 'the Lantern Court', south3: 'the Reed Court', aurel: 'the Aurel Court', south1: 'the Orchard Court', crown: 'the Crown' };

const INTRO = 21;        // seconds
const LINES = [
  [1.2, 6.2, 'The Vale once sang. Its spires carried one chord from the mountains to the sea.'],
  [7.4, 12.6, 'Then the Mute came, and the song went out, one voice at a time.'],
  [14.2, 19.2, 'You kept the last note. Carry it back to them.'],
];
const ease = (t) => t * t * (3 - 2 * t), clamp01 = (x) => Math.max(0, Math.min(1, x));
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);

export class Story {
  constructor({ game, pipe, sites, terrain }) {
    this.game = game; this.pipe = pipe; this.sites = sites; this.terrain = terrain;
    this.t = 0; this.line = null; this.said = new Set(game.storySaid ?? []);
    this.leg = null; this.wp = 0; this.hintT = 0;
    game.story = this;
    game.on((type, d) => this._onGame(type, d));
    this._goal();
  }

  // --- the opening ---------------------------------------------------------------------

  begin() {
    const g = this.game, s = g.sites.spawn;
    g.respawnAtCheckpoint();
    for (let i = 0; i < 40 && !g.player.grounded; i++) g.player._integrate(1 / 60);     // settle onto the floor
    g.state = 'intro'; g.input.enabled = false;
    this.t = 0; this.skipping = 0;
    if (g.hero) { g.hero.kneel = 1; g.hero.feet.L.init = g.hero.feet.R.init = false; g.hero.cloth.reset(); }
    // Where the play camera will be when the opening hands over to it.
    g.rig.snap(g.player); g.rig.yaw = s.yaw ?? 0; g.rig.pitch = -0.2;
    g.emit('state', { state: 'intro' });
  }

  skip() { if (this.game.state === 'intro' && this.t > 0.8 && !this.skipping) { this.skipping = 0.001; this.game.emit('fade', { on: true }); } }

  _camera(pos, target, fov) {
    const c = this.pipe.camera;
    c.position.copy(pos); c.lookAt(target);
    if (Math.abs(c.fov - fov) > 0.01) { c.fov = fov; c.updateProjectionMatrix(); }
  }

  _intro(dt) {
    const g = this.game, p = g.player, s = g.sites.spawn, t = this.t;
    if (this.skipping) {
      this.skipping += dt;
      if (this.skipping > 0.55) { this._finishIntro(); g.emit('fade', { on: false }); }
      return;
    }
    this.t += dt;
    // Words.
    const cur = LINES.find(([a, b]) => t >= a && t < b);
    if ((cur?.[2] ?? null) !== this.line) { this.line = cur?.[2] ?? null; g.emit('caption', { text: this.line }); }
    const hero = g.hero, fx = Math.sin(s.yaw ?? 0), fz = Math.cos(s.yaw ?? 0);
    if (t < 7) {
      // Over the terrace toward the evening: the whole valley, the rings, the great tree.
      const k = t / 7;
      _a.set(-545 + 26 * k, 244 - 5 * k, -44 - 5 * k);
      const yaw = 0.16 + 0.1 * k;
      _b.set(_a.x + Math.cos(yaw), _a.y - 0.07, _a.z + Math.sin(yaw));
      this._camera(_a, _b, 56);
    } else if (t < 13.4) {
      // The first spire, grey inside its silence.
      const k = (t - 7) / 6.4, sp = g.spires[0];
      const a = 2.2 - 0.35 * k;
      _a.set(sp.x + Math.cos(a) * 52, sp.base + 26 - 4 * k, sp.z + Math.sin(a) * 52);
      _b.set(sp.x, sp.base + 11, sp.z);
      this._camera(_a, _b, 50);
    } else {
      // The hero, kneeling at the edge of the terrace; he rises, and the view settles behind him.
      const k = clamp01((t - 13.4) / (INTRO - 13.4)), e = ease(k);
      const a = (s.yaw ?? 0) + 0.7 + (Math.PI - 0.7) * e;           // from in front of him round to behind
      const d = 3.2 + 1.2 * e, h = 0.75 + 0.9 * e;
      _a.set(p.pos.x + Math.sin(a) * d, p.pos.y + h, p.pos.z + Math.cos(a) * d);
      _b.set(p.pos.x + fx * 0.4 * e, p.pos.y + 1.05 + 0.35 * e, p.pos.z + fz * 0.4 * e);
      this._camera(_a, _b, 46 + 14 * e);
      if (hero) hero.kneel = 1 - ease(clamp01((t - 15.6) / 2.2));
      // The last moments ease into exactly where the play camera stands.
      if (k > 0.72) {
        const w = ease((k - 0.72) / 0.28), c = this.pipe.camera;
        const pos = c.position.clone(), quat = c.quaternion.clone();
        g.rig.update(0, p, { look: { x: 0, y: 0 }, zoom: 0 });
        c.position.lerpVectors(pos, c.position, w); c.quaternion.copy(quat.slerp(c.quaternion, w));
      }
    }
    if (this.t >= INTRO) this._finishIntro();
  }

  _finishIntro() {
    const g = this.game;
    if (g.hero) g.hero.kneel = 0;
    this.line = null; g.emit('caption', { text: null });
    g.introSeen = true; g.save();
    g.rig.snap(g.player); g.rig.yaw = g.sites.spawn.yaw ?? 0; g.rig.pitch = -0.2;
    this._goal();
    g.start();
  }

  // --- words ---------------------------------------------------------------------------

  // Shows a line once per journey.
  say(id, text, hold = 6) {
    if (this.said.has(id)) return;
    this.said.add(id); this.game.storySaid = [...this.said]; this.game.save();
    this.queue = (this.queue ?? []); this.queue.push([text, hold]);
  }

  _onGame(type, d) {
    const g = this.game;
    if (type === 'enemy' && d.type === 'wake') {
      if (d.enemy.kind === 'sovereign') this.say('stillness', 'The Stillness. Where it stands, no note has sounded since the fall.', 7);
      else if (d.enemy.def.boss) this.say('boss', 'The Unsung: a silence as old as the Choir itself.');
      else if (d.enemy.elite) this.say('elite', 'Some of the Mute have stood in the silence so long that they have names.');
      else this.say('mute', 'The Mute. Shards of the silence, drawn to anything that still sings.');
    }
    if (type === 'tuned') {
      const id = d.spire.id;
      if (id === 'petal') this.say('petal', 'The Petal Court answers. Far to the east, a second voice stirs.', 7);
      if (id === 'cantor') this.say('cantor', 'Two voices now. Across the water the old bridge remembers its shape.', 7);
      if (id === 'choir') { this.say('choir', 'Three voices, one chord. The inner Vale remembers its song.', 7); this.say('roads', 'And the old roads wake: strings of light, out over the water, to five courts that are silent still.', 8); }
      if (id === 'east') this.say('east', 'The Lantern Court burns again. The string runs on, south across the lake.', 7);
      if (id === 'south3') this.say('south3', 'Reeds and water, and a voice among them. Five now.', 7);
      if (id === 'aurel') this.say('aurel', 'The Aurel Court gives back its gold. Two remain, and the silence knows it.', 7);
      if (id === 'south1') this.say('south1', 'The orchard wakes. Only the Crown is left, where the Mute first fell.', 7);
      if (id === 'crown') this.say('crown', 'Eight voices. The whole Vale sings, from the mountains to the sea.', 9);
      this.leg = null; this._goal();
    }
    if (type === 'enemy' && d.type === 'death') this._goal();
    if (type === 'enemy' && d.type === 'phase') this.say(`phase${d.enemy.kind}${d.phase}`, d.phase > 1 ? 'It is breaking. So is its patience.' : 'It gathers itself, and calls the others to it.', 5);
    if (type === 'wave') this._goal();
    if (type === 'note') {
      if (d.count === 1) this.say('note', 'A lost note of the old song. There are more along the paths.', 6);
      else if (d.line) { this.queue = (this.queue ?? []); this.queue.push([d.line, 7]); }
      if (d.count === d.total) this.say('notes', 'Every note is home.', 6);
    }
    if (type === 'respawn') { this.leg = null; this._goal(); }
  }

  // --- goals ---------------------------------------------------------------------------

  // Works out what the player is asked to do, and where the marker points.
  _goal() {
    const g = this.game, next = g.spires.find((s) => !s.tuned);
    let text, mark = null;
    if (!next) text = 'The Vale sings again';
    else if (!this.said.has('lookout') && next.id === 'petal') { text = 'Walk to the lookout'; const v = g.sites.vista; mark = { x: v.x - 3, y: v.y - 0.4, z: v.z, name: 'Lookout', arrive: 5 }; }
    else {
      const leg = LEGS[next.id] ?? [], alive = !g.encounters.cleared(next.id);
      if (this.leg !== next.id) { this.leg = next.id; this.wp = leg.length ? this._nearestWp(next.id) : 0; }
      const near = Math.hypot(g.player.pos.x - next.x, g.player.pos.z - next.z) < 60;
      const pylon = !near && !leg.length ? g.strings?.nearest(g.player.pos.x, g.player.pos.z, next.id) : null;
      if (g.strings) g.strings.goal = leg.length ? null : next.id;
      if (pylon && pylon.id !== next.id) {
        // Beyond the inner Vale the way is over the strings of light.
        text = `Ride the strings to ${NAMES[next.id]}`;
        mark = { x: pylon.x, y: pylon.y + 8.5, z: pylon.z, name: 'String of light', ride: true };
      } else if (this.wp < leg.length && !near) {
        const [x, z] = leg[this.wp];
        text = `Follow the path to ${NAMES[next.id]}`;
        mark = { x, y: g.world.floorBelow(x, this.terrain.heightAt(x, z) + 60, z, 90) + 1.6, z, name: NAMES[next.id].replace(/^the /, 'The '), way: true };
      } else {
        text = alive ? `Break the silence at ${NAMES[next.id]}` : `Tune the spire at ${NAMES[next.id]}`;
        mark = { x: next.x, y: next.base + 9, z: next.z, name: NAMES[next.id].replace(/^the /, 'The ') };
      }
    }
    g.marker = mark;
    if (text !== g.objective) { g.objective = text; g.emit('objective', { text }); }
  }

  _nearestWp(id) {
    // Start from the breadcrumb that lies ahead of where the player already is.
    const leg = LEGS[id], p = this.game.player.pos;
    let best = 0, bd = 1e9;
    leg.forEach(([x, z], i) => { const d = Math.hypot(x - p.x, z - p.z); if (d < bd) { bd = d; best = i; } });
    return bd < 14 ? Math.min(leg.length, best + 1) : best;
  }

  update(dt) {
    const g = this.game, p = g.player;
    if (g.state === 'intro') { this._intro(dt); return; }
    if (g.state !== 'playing' || g.tuning?.active || g.people?.talk) return;
    // Lines wait their turn.
    this.lineT = (this.lineT ?? 0) - dt;
    if (this.lineT <= 0 && this.line) { this.line = null; g.emit('caption', { text: null }); this.lineT = 0.7; }
    else if (this.lineT <= 0 && this.queue?.length) { const [text, hold] = this.queue.shift(); this.line = text; this.lineT = hold; g.emit('caption', { text }); }
    // Arriving at things.
    const m = g.marker;
    if (m?.arrive && Math.hypot(p.pos.x - m.x, p.pos.z - m.z) < m.arrive) {
      this.say('lookout', 'Three spires stood over the Vale. All three are silent. The nearest waits below, on the Petal Court.', 8);
      this._goal();
    } else if (m?.arrive && Math.hypot(p.pos.x - m.x, p.pos.z - m.z) > 70) {
      // Wandered off without visiting the lookout: let it go and point down the path.
      this.said.add('lookout'); g.storySaid = [...this.said]; this._goal();
    } else if (m?.ride || (g.strings?.goal && !m?.ride && (this.goalT = (this.goalT ?? 0) + dt) > 1)) {
      // Off across the strings: look again now and then, the hero may be a mesa further on.
      this.goalT = (this.goalT ?? 0) + dt;
      if (this.goalT > 1) { this.goalT = 0; this._goal(); }
    } else if (m?.way) {
      const leg = LEGS[this.leg];
      // Pass a breadcrumb by reaching it, or by being nearer to a later one.
      for (let i = leg.length - 1; i >= this.wp; i--) if (Math.hypot(p.pos.x - leg[i][0], p.pos.z - leg[i][1]) < 11) { this.wp = i + 1; this._goal(); break; }
      const next = g.spires.find((s) => !s.tuned);
      if (next && Math.hypot(p.pos.x - next.x, p.pos.z - next.z) < 60) this._goal();
    }
  }
}
