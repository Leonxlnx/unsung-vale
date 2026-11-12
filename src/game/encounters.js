// Encounters: who stands where. The three courts of the inner Vale each have one guard; the
// five courts beyond the water are fought for in waves, the last led by an elite; the Crown
// ends with the Stillness. Packs also roam the wilds between the courts.
const ELITE = {
  lantern: { scale: 1.38, hp: 3.2, dmg: 1.35, elite: true, name: 'The Lantern Thrall' },
  stalker: { scale: 1.5, hp: 4.2, dmg: 1.4, speed: 1.12, elite: true, name: 'The Reed Stalker' },
  gilded: { scale: 1.28, hp: 2.4, dmg: 1.3, elite: true, name: 'The Gilded Warden' },
  cantor: { scale: 1.4, hp: 3.6, dmg: 1.3, recover: 0.7, elite: true, name: 'The Orchard Cantor' },
  veteran: { scale: 1.16, hp: 1.7, dmg: 1.2, tint: 0.6 },        // a tougher one of the rank and file
};

// Per court: a list of waves, each a list of [kind, count, elite?].
export const WAVES = {
  east: [[['thrall', 3], ['hound', 2]], [['lancer', 2], ['warden', 1], ['hound', 2]], [['thrall', 1, 'lantern'], ['thrall', 2]]],
  south3: [[['hound', 4]], [['chorister', 2], ['thrall', 2]], [['hound', 1, 'stalker'], ['hound', 3], ['lancer', 1]]],
  aurel: [[['warden', 2], ['lancer', 2]], [['brute', 1], ['thrall', 3], ['hound', 2]], [['warden', 1, 'gilded'], ['chorister', 1], ['thrall', 2, 'veteran']]],
  south1: [[['hound', 3], ['lancer', 2]], [['brute', 1], ['warden', 1], ['chorister', 1], ['thrall', 2]], [['chorister', 1, 'cantor'], ['hound', 4], ['thrall', 2, 'veteran']]],
  crown: [[['thrall', 3, 'veteran'], ['hound', 2], ['lancer', 1]], [['brute', 1], ['warden', 1], ['chorister', 2], ['hound', 2]], [['sovereign', 1]]],
};

// Packs in the wilds: [x, z, [[kind, count, elite?], ...]]. They guard nothing but give
// resonance, and stand between the hero and what lies off the paths.
const WILD = [
  [-262, -440, [['hound', 2]]], [-20, -468, [['thrall', 2], ['lancer', 1]]],
  [640, -470, [['hound', 3]]], [520, -380, [['thrall', 2], ['warden', 1]]],
  [470, 470, [['lancer', 2], ['hound', 2]]], [575, 395, [['chorister', 1], ['thrall', 2]]],
  [85, 585, [['hound', 3], ['thrall', 1, 'veteran']]], [44, 474, [['warden', 1], ['lancer', 1]]],
  [-455, 470, [['thrall', 3]]], [-350, 400, [['hound', 2], ['chorister', 1]]],
  [-1080, -100, [['thrall', 2, 'veteran'], ['lancer', 2]]], [-900, -200, [['hound', 4]]],
];

const ORDINAL = ['', 'Second wave', 'Last wave'];

export class Encounters {
  constructor(game) { this.g = game; this.wave = {}; this.wait = {}; }

  _ring(list, cx, cz, r, group, a0 = 0, near = null) {
    const E = this.g.enemies, flat = [];
    for (const [kind, n, elite] of list) for (let i = 0; i < n; i++) flat.push([kind, elite]);
    const out = [];
    flat.forEach(([kind, elite], i) => {
      const boss = kind === 'sovereign', a = a0 + (i / flat.length) * 6.283, rr = boss ? r * 1.1 : r * (0.8 + 0.4 * ((i * 7) % 3) / 2);
      out.push(E.spawn(kind, cx + Math.cos(a) * rr, cz + Math.sin(a) * rr, group, elite ? ELITE[elite] : null, near));
    });
    return out;
  }

  // Everything that should be standing, given which spires are tuned.
  reset() {
    const g = this.g, E = g.enemies, tuned = (id) => g.spires.find((s) => s.id === id)?.tuned;
    const ring = (kind, cx, cz, r, n, group, a0 = 0) => { for (let i = 0; i < n; i++) { const a = a0 + (i / n) * 6.283; E.spawn(kind, cx + Math.cos(a) * r, cz + Math.sin(a) * r, group); } };
    this.wave = {}; this.wait = {};
    if (!tuned('petal')) { ring('thrall', -372, -392, 8.5, 3, 'petal', 0.4); E.spawn('hound', -384, -404, 'petal'); }
    if (!tuned('cantor')) {
      E.spawn('thrall', -100, -455, 'stair'); E.spawn('thrall', -96, -465, 'stair'); E.spawn('lancer', -84, -459, 'stair');
      ring('thrall', 66, -498, 10, 2, 'cantor', 1.2); E.spawn('warden', 58, -508, 'cantor'); E.spawn('lancer', 92, -520, 'cantor'); E.spawn('hound', 40, -476, 'cantor'); E.spawn('hound', 80, -482, 'cantor');
    }
    if (!tuned('choir')) { E.spawn('colossus', 156, -4, 'choir'); E.spawn('chorister', 130, -32, 'choir'); E.spawn('lancer', 167, 6, 'choir'); }
    if (g.cine) return;                                   // the film keeps to the inner Vale
    for (const [id, waves] of Object.entries(WAVES)) {
      if (tuned(id)) continue;
      // A court stirs only once its three bells have been rung (see bells.js).
      if (g.bells && !g.bells.done(id)) continue;
      const s = g.spires.find((q) => q.id === id);
      this.wave[id] = 0; this._ring(waves[0], s.x, s.z, 9, id, 0.5, s.base);
    }
    g.bells?.spawnGuards();
    WILD.forEach(([x, z, list], i) => { if (g.wildDone?.includes(i)) return; this._ring(list, x, z, 3.5, `wild${i}`, i); });
  }

  // True once nothing is left to fight at a court.
  cleared(id) { const w = WAVES[id]; return this.g.enemies.aliveIn(id) === 0 && (!w || ((this.wave[id] ?? -1) >= w.length - 1 && (this.g.bells?.done(id) ?? true))); }
  // How the fight at a court stands, for the interface: [wave, of].
  progress(id) { const w = WAVES[id]; return w && this.wave[id] !== undefined ? [this.wave[id] + 1, w.length] : null; }

  // The third bell has rung: the court's first guard comes up out of the paving.
  callCourt(id) {
    const g = this.g, s = g.spires.find((q) => q.id === id), waves = WAVES[id];
    if (!waves || this.wave[id] !== undefined) return;
    this.wave[id] = 0;
    for (const e of this._ring(waves[0], s.x, s.z, 9, id, 0.5, s.base)) g.vfx.wave(e.pos.x, e.pos.y + 0.08, e.pos.z, { r0: 3.2, r1: 0.4, life: 0.9, strength: 0.9, width: 0.08, color: [2.4, 1.15, 4.6] });
  }

  update(dt) {
    const g = this.g, p = g.player;
    for (const [id, waves] of Object.entries(WAVES)) {
      const i = this.wave[id];
      if (i === undefined || i >= waves.length - 1 || g.enemies.aliveIn(id) > 0) continue;
      const s = g.spires.find((q) => q.id === id);
      if (s.tuned || Math.hypot(p.pos.x - s.x, p.pos.z - s.z) > 60) continue;
      // A breath, then the next wave pulls itself out of the paving.
      this.wait[id] = (this.wait[id] ?? 0) + dt;
      if (this.wait[id] < 1.8) continue;
      this.wait[id] = 0; this.wave[id] = i + 1;
      const foes = this._ring(waves[i + 1], s.x, s.z, 10, id, i * 1.3 + 0.9, s.base);
      for (const e of foes) {
        g.vfx.wave(e.pos.x, e.pos.y + 0.08, e.pos.z, { r0: 3.2, r1: 0.4, life: 0.9, strength: 0.9, width: 0.08, color: e.elite ? [4.2, 1.4, 0.8] : [2.4, 1.15, 4.6] });
        g.particles.burst(e.pos.x, e.pos.y + 0.2, e.pos.z, 14, { speed: 3, life: 0.8, size: 0.06, color: e.elite ? [5, 1.8, 0.9] : [3.2, 1.9, 5.6], gravity: -2, drag: 1, up: 2 });
      }
      g.emit('wave', { id, index: i + 1, total: waves.length, text: i + 1 === waves.length - 1 ? ORDINAL[2] : ORDINAL[1] });
    }
  }
}
