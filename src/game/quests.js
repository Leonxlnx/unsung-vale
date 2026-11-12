// What the people of the Vale ask of the hero, and what they say. A quest is a few steps
// (gather things, clear packs out of the wilds, reach places) and a return to whoever asked;
// each ends with a gift that makes him stronger. This file also owns the things that are
// gathered: small lights standing in the world, taken by walking (or swimming) through them.
import * as THREE from 'three';

const VERT = /* glsl */ `
out vec3 vWorld;
void main() { vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const FRAG = /* glsl */ `
uniform float uTime;
in vec3 vWorld;
void main() {
  vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld))), V = normalize(cameraPosition - vWorld);
  float f = pow(1.0 - abs(dot(N, V)), 2.0);
  gl_FragColor = vec4(vec3(1.0, 0.9, 0.72) * (1.5 + 3.0 * f) * (0.85 + 0.15 * sin(uTime * 3.1 + vWorld.x)), 1.0);
}`;

// kind: gather (spots, taken by touch) | slay (packs of the wilds) | notes (lost notes found).
export const QUESTS = [
  { id: 'vellum', giver: 'sel', title: 'Lines on the Vellum', kind: 'gather', thing: 'survey mark', verb: 'Reach the survey marks', r: 3.2,
    spots: [[-497.5, -70, 212.1], [-300, -372], [-178.5, -459]], reward: { up: 'stamina', xp: 60 },
    offer: ['You came down from the terrace with your eyes open. Good. Most people only look at their feet.', 'I am drawing the Vale again, as it is now. Three of my survey marks still stand: the lookout here, the pool on the Petal mesa, the head of the long stair.', 'Stand at each one for me. Take this, so you can find your way back: my map, as far as it goes. Open it with M.'],
    wait: ['Three marks: the lookout, the Petal pool, the head of the long stair. The map will show you.'],
    done: ['All three. Then the old lines still hold, and I have been drawing the right country.', 'Here. Walking that far on one breath takes practice. This should help.'] },
  { id: 'count', giver: 'maren', title: "The Keeper's Count", kind: 'notes', verb: 'Find lost notes of the old song', need: 30, reward: { up: 'blade', xp: 120 },
    offer: ['You have found some of them already, haven\'t you. The lost notes. They fell out of the song when the spires went quiet.', 'Bring thirty home and I can set an edge on that blade that the Mute will remember.'],
    wait: ['Thirty notes. They lie along the paths, and out on the mesas where nobody walks any more.'],
    done: ['Thirty. Listen: you can almost hear the tune they belong to.', 'Give me the blade a moment. There. It sings a little, now.'] },
  { id: 'seeds', giver: 'ilse', title: 'Seeds of the Petal Court', kind: 'gather', thing: 'lantern seed', verb: 'Gather lantern seeds on the Petal mesa', r: 2.4,
    spots: [[-330, -372], [-296, -424], [-345, -452], [-408, -432], [-262, -384]], reward: { up: 'health', xp: 60 },
    offer: ['Oh. Oh, I was standing here a long time, wasn\'t I. The beds are a ruin.', 'The lantern flowers seeded while I slept. Five pods, somewhere out on the mesa. They glow; you cannot miss them.', 'Bring them back before the birds do and I will make you something that keeps a body on its feet.'],
    wait: ['Five lantern seeds, out on the mesa. They glow.'],
    done: ['All five, and not one cracked. You have gentle hands for someone who carries that.', 'Drink this. It is only petals and patience, but you will stand a little longer for it.'] },
  { id: 'stair', giver: 'tam', title: 'The Watch on the Stair', kind: 'slay', packs: [0, 1], verb: 'Clear the Mute from the road to the Rise', reward: { up: 'stamina', xp: 80 },
    offer: ['Forty years I rang the hours from this Rise, and nobody ever came up the stair afraid.', 'There are still Mute on the road. A pack at the foot of the long stair, more where the path climbs to us.', 'Clear them and I will teach you how a ringer breathes. You will run further on it.'],
    wait: ['Two packs on the road: one below the long stair, one on the climb to the Rise.'],
    done: ['The road is quiet the right way now. Thank you.', 'Breathe from here, low, not from the chest. There. You have it.'] },
  { id: 'voices', giver: 'vey', title: 'Voices for the Choir', kind: 'notes', verb: 'Find lost notes of the old song', need: 14, reward: { up: 'health', xp: 80 },
    offer: ['A choir of one spire is not a choir. But it is a start, and I am not proud.', 'Fourteen lost notes would give me a phrase to teach. You pass them on every road; pick them up.'],
    wait: ['Fourteen notes for the Choir. They are everywhere, once you start listening.'],
    done: ['There, hear that? A phrase. I can build a morning on that.', 'Take this for your trouble. Singers call it heart. It is mostly honey.'] },
  { id: 'lamps', giver: 'ruu', title: 'Lamps of the Lantern Court', kind: 'gather', thing: 'lamp', verb: 'Light the lamps round the Lantern mesa', r: 3,
    spots: [[640, -418], [612, -502], [522, -492], [498, -412], [604, -366]], reward: { up: 'health', xp: 100 },
    offer: ['They called it the Lantern Court because you could see it from the sea. Then the Mute came and I could not lift my arm to a single wick.', 'Five lamps stand out on the mesa. Touch each one; your note will do what my taper cannot. Mind the packs that roam there.'],
    wait: ['Five lamps on the mesa, out past the columns. The Mute walk there. Be quick, or be loud.'],
    done: ['Look at that. You can see it from the sea again.', 'A lamplighter\'s gift: keep a little flame under your ribs. You will take more before you fall.'] },
  { id: 'water', giver: 'nan', title: 'What the Water Took', kind: 'gather', thing: 'float', verb: 'Swim out to the floats on the Reed pool', r: 2.6, swim: true,
    spots: [[600, 330], [617, 318], [584, 342], [596, 309]], reward: { up: 'stamina', xp: 100 },
    offer: ['My nets went into the pool when the silence came, floats and all. I have been looking at them ever since. Could not move, you understand.', 'Four floats, out on the Reed pool, east of here along the worn path. You look like you can swim.'],
    wait: ['Four floats on the pool to the east. The water is cold but it holds you up.'],
    done: ['Every one. And you are dripping on my court, which is the best thing that has happened here in years.', 'Fishers hold their breath for a living. Here is how.'] },
  { id: 'debt', giver: 'pell', title: 'The Gilded Debt', kind: 'slay', packs: [6, 7], verb: 'Clear the Mute from the Aurel mesa', reward: { up: 'blade', xp: 120 },
    offer: ['The archive is open again, and the first thing I find in it is a debt. The Aurel Court promised to keep its own mesa clean.', 'Two packs still walk it, north by the old road and south toward the pool. One of them is led by something that has been standing a long time.', 'Pay the court\'s debt for it and the court will pay you. We kept a whetstone here that kings sent for.'],
    wait: ['Two packs on the Aurel mesa. I would go myself, but I am a clerk.'],
    done: ['Paid in full. I have written it down, which makes it true.', 'The stone, as promised. Three passes each side. No more, or you will have a razor and no sword.'] },
  { id: 'windfall', giver: 'hesk', title: 'Windfall', kind: 'gather', thing: 'golden pear', verb: 'Gather the windfall in the orchard', r: 2.4,
    spots: [[-456, 402], [-432, 498], [-360, 488], [-342, 412], [-398, 366], [-472, 452]], reward: { up: 'health', xp: 100 },
    offer: ['Eh? Speak up. No, do not, I have had enough quiet for one life. Sit. No? Then walk.', 'The golden pears came down while I stood here like a post. Six of them are still good, out among the trees.', 'Bring them in and I will press you the first cup this orchard has made since the fall.'],
    wait: ['Six golden pears, out in the orchard. They shine. Even I can see them.'],
    done: ['Six! And you did not eat one. I would have eaten one.', 'First pressing. Drink it standing up, it goes straight to the legs.'] },
];

const IDLE = {
  maren: [[0, ['The Vale is still out there under the quiet. Go and wake it.', 'Follow the path down from the lookout. The Petal Court is the nearest.']], [1, ['One voice. I heard it from here, and I am not ashamed to say I sat down.']], [3, ['Three voices, and the roads of light are awake. I had forgotten how they hum.', 'Five courts beyond the water are silent still. The strings will carry you; put your blade over one and hold on.']], [8, ['All of it. Every voice. Sit with me a while; there is nowhere you have to be.']]],
  odo: [[0, ['I make instruments. That blade of yours is one, whatever else it is.', 'Bring me what the Mute were holding of the song and I can do something with it.']]],
  sel: [[0, ['A map is a promise that a place is still there. I like keeping promises.']]],
  ilse: [[0, ['The petals fall the same whether anyone sings or not. But they fall better to music.']]],
  tam: [[0, ['You can see the whole inner Vale from this Rise. On a clear evening, further.']]],
  vey: [[0, ['Mind the acoustics. Everything you say in this court comes back improved.']]],
  ruu: [[0, ['Keep your lamps lit and your back to a wall. That is all I know about anything.']]],
  nan: [[0, ['The reeds talk when the wind is in them. Mostly complaints.']]],
  pell: [[0, ['Everything that happened here is written down somewhere. The trouble is the somewhere.']]],
  hesk: [[0, ['Trees do not hurry and neither do I. We get on.']]],
  first: [[0, ['I sang the first note here, before there was a spire to hold it.', 'You carried the last one all this way. That makes us colleagues.', 'Go where you like now. It is all singing. It will go on singing.']]],
};
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

export class Quests {
  constructor(game, pipe) {
    this.g = game; this.pipe = pipe;
    this.state = {};                 // id -> { s: 'active' | 'ready' | 'done', got: [spot indices] }
    this.items = [];                 // things standing in the world to be gathered
    const geo = new THREE.OctahedronGeometry(1, 0).scale(0.2, 0.34, 0.2);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { uTime: pipe.globals.uTime } }), 40);
    this.mesh.frustumCulled = false; this.mesh.count = 0; this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    pipe.scene.add(this.mesh);
    for (const [id, st] of Object.entries(game.questSave ?? {})) { this.state[id] = { s: st.s, got: [...(st.got ?? [])] }; if (st.s === 'active') this._place(this.def(id)); }
  }

  def(id) { return QUESTS.find((q) => q.id === id); }
  dump() { return this.state; }
  get active() { return QUESTS.filter((q) => this.state[q.id]?.s === 'active' || this.state[q.id]?.s === 'ready'); }
  get doneCount() { return QUESTS.filter((q) => this.state[q.id]?.s === 'done').length; }

  // Sets the things of a gathering quest down in the world.
  _place(q) {
    if (q.kind !== 'gather') return;
    const W = this.g.world, st = this.state[q.id];
    // A spot may name the height of the floor it stands on (a platform out over a drop).
    q.spots.forEach(([x, z, at], i) => {
      if (st.got.includes(i)) return;
      W.stream(x, z, 4);
      const water = W.waterLevel(x, z), ground = at !== undefined ? W.floorBelow(x, at + 2, z, 6) : W.floorBelow(x, W.groundHeight(x, z) + 30, z, 60);
      const y = (q.swim && Number.isFinite(water) ? Math.max(water, ground) + 0.55 : ground + 1.2);
      this.items.push({ q: q.id, i, x, y, z, k: 1, taken: false, phase: i * 1.9 });
    });
  }

  progress(q) {
    const g = this.g, st = this.state[q.id];
    if (q.kind === 'gather') return [st.got.length, q.spots.length];
    if (q.kind === 'slay') return [q.packs.filter((i) => g.wildDone.includes(i)).length, q.packs.length];
    return [Math.min(q.need, g.notes.count), q.need];
  }

  // What the interface shows under the main goal: the side quest nearest to done being done.
  tracker() {
    const list = this.active;
    if (!list.length) return null;
    const p = this.g.player.pos;
    let best = null, bd = 1e9;
    for (const q of list) { const m = this._mark(q); const d = m ? Math.hypot(m.x - p.x, m.z - p.z) : 5e3; if (d < bd) { bd = d; best = { q, m }; } }
    const { q, m } = best, st = this.state[q.id], [a, b] = this.progress(q);
    return { title: q.title, text: st.s === 'ready' ? `Return to ${this.g.people.get(q.giver).def.name}` : q.verb, count: st.s === 'ready' ? null : `${a} / ${b}`, mark: m };
  }

  // Where a quest wants the hero next.
  _mark(q) {
    const g = this.g, st = this.state[q.id], p = g.player.pos;
    if (st.s === 'ready') { const n = g.people.get(q.giver); return { x: n.x, y: n.y + 2.4, z: n.z, name: n.def.name }; }
    let best = null, bd = 1e9;
    if (q.kind === 'gather') for (const it of this.items) { if (it.q !== q.id || it.taken) continue; const d = Math.hypot(it.x - p.x, it.z - p.z); if (d < bd) { bd = d; best = { x: it.x, y: it.y + 0.8, z: it.z, name: q.thing[0].toUpperCase() + q.thing.slice(1) }; } }
    if (q.kind === 'slay') for (const i of q.packs) { if (g.wildDone.includes(i)) continue; const e = g.enemies.list.find((f) => f.alive && f.group === `wild${i}`); if (!e) continue; const d = Math.hypot(e.pos.x - p.x, e.pos.z - p.z); if (d < bd) { bd = d; best = { x: e.pos.x, y: e.pos.y + 3, z: e.pos.z, name: 'The Mute' }; } }
    return best;
  }

  // Everything a person has to say right now, and what follows from saying it.
  talkTo(n) {
    const g = this.g, id = n.def.id, mine = QUESTS.filter((q) => q.giver === id);
    const ready = mine.find((q) => this.state[q.id]?.s === 'ready'), active = mine.find((q) => this.state[q.id]?.s === 'active'), fresh = mine.find((q) => !this.state[q.id]);
    const tuned = g.spires.filter((s) => s.tuned).length;
    let lines, done = null;
    if (ready) { lines = ready.done; done = () => this._finish(ready); }
    else if (active) lines = active.wait;
    else if (fresh && !(g.metPeople ??= []).includes(id) && IDLE[id]) {
      // A first meeting: who they are, then what they want.
      lines = [...this._idle(id, tuned), ...fresh.offer]; done = () => this._start(fresh);
    } else if (fresh) { lines = fresh.offer; done = () => this._start(fresh); }
    else lines = this._idle(id, tuned);
    if (!(g.metPeople ??= []).includes(id)) g.metPeople.push(id);
    // The luthier's bench opens once he has said his piece.
    if (id === 'odo') { const after = done; done = () => { after?.(); g.openMenu('bench'); }; }
    g.people.speak(n, lines, () => { done?.(); g.save(); });
  }
  _idle(id, tuned) { const sets = IDLE[id] ?? [[0, ['...']]]; let pick = sets[0][1]; for (const [need, lines] of sets) if (tuned >= need) pick = lines; return pick; }

  _start(q) {
    const g = this.g;
    this.state[q.id] = { s: 'active', got: [] };
    if (q.id === 'vellum') { g.hasMap = true; g.emit('map', { phase: 'given' }); }
    this._place(q);
    g.emit('quest', { phase: 'start', title: q.title, text: q.verb });
    this._check(q);
  }
  _check(q) {
    const st = this.state[q.id];
    if (st.s !== 'active') return;
    const [a, b] = this.progress(q);
    if (a >= b) { st.s = 'ready'; this.g.emit('quest', { phase: 'ready', title: q.title, text: `Return to ${this.g.people.get(q.giver).def.name}` }); this.g.save(); }
  }
  _finish(q) {
    const g = this.g;
    this.state[q.id].s = 'done';
    g.grant(q.reward);
    g.emit('quest', { phase: 'done', title: q.title, reward: q.reward });
  }

  update(dt, playing) {
    const g = this.g, p = g.player, t = this.pipe.time, P = g.particles;
    this.mesh.visible = !g.cine;
    if (g.cine) return;
    // Things to gather.
    let n = 0;
    for (const it of this.items) {
      const d = Math.hypot(p.pos.x - it.x, p.pos.z - it.z), q = this.def(it.q);
      if (playing && !it.taken && d < q.r && Math.abs(p.pos.y + 1 - it.y) < 2.6 && p.state !== 'ride') {
        it.taken = true;
        const st = this.state[it.q]; st.got.push(it.i);
        P.burst(it.x, it.y, it.z, 22, { speed: 3.6, life: 0.8, size: 0.05, color: [3.4, 3.0, 2.2], gravity: -1.2, drag: 1.5, up: 1.2 });
        g.vfx.wave(it.x, it.y - 0.9, it.z, { r0: 0.2, r1: 3.2, life: 0.6, strength: 0.6, width: 0.1, color: [2.2, 1.9, 1.3] });
        g.emit('quest', { phase: 'item', title: q.title, thing: q.thing, count: st.got.length, total: q.spots.length });
        this._check(q); g.save();
      }
      it.k += ((it.taken ? 0 : 1) - it.k) * Math.min(1, dt * 9);
      if (it.k < 0.01 || d > 160 || n >= 40) continue;
      _p.set(it.x, it.y + Math.sin(t * 1.3 + it.phase) * 0.08, it.z);
      _m.compose(_p, _q.setFromEuler(_e.set(0, t * 1.1 + it.phase, 0)), _s.set(it.k, it.k, it.k));
      this.mesh.setMatrixAt(n++, _m);
      // A thread of light above each one, so it can be found from across a meadow.
      if (d < 120) { P.spawn(_p.x, _p.y, _p.z, { life: 0.1, size: 0.8, color: [1.5, 1.3, 0.9], alpha: 0.6 }); if (Math.random() < dt * 14) P.spawn(it.x + (Math.random() - 0.5) * 0.2, it.y + 0.3, it.z + (Math.random() - 0.5) * 0.2, { vel: [0, 2.2 + Math.random() * 2, 0], life: 1.6, size: 0.05, color: [2.6, 2.3, 1.6], drag: 0.3 }); }
    }
    this.mesh.count = n; this.mesh.instanceMatrix.needsUpdate = true;
    this.items = this.items.filter((it) => !it.taken || it.k > 0.01);
    if (!playing) return;
    // Packs cleared and notes found count without anyone having to be told.
    this.tick = (this.tick ?? 0) + dt;
    if (this.tick > 0.5) { this.tick = 0; for (const q of QUESTS) if (this.state[q.id]?.s === 'active' && q.kind !== 'gather') this._check(q); }
    // Someone to speak with.
    if (!g.prompt && !g.people.talk && !g.tuning.active && p.state === 'move' && p.grounded) {
      const who = g.people.near();
      if (who && !g.enemies.list.some((e) => e.alive && e.state !== 'dormant' && e.pos.distanceTo(p.pos) < 30)) {
        g.prompt = { key: 'E', text: `Speak with ${who.def.name}` };
        if (g.input.pressed.has('interact')) { g.prompt = null; this.talkTo(who); }
      }
    }
  }
}
