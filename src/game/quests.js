// What the people of the Vale ask of the hero, and what they say. A quest is a few steps
// (gather things, clear packs out of the wilds, reach places) and a return to whoever asked;
// each ends with a gift that makes him stronger. This file also owns the things that are
// gathered: small lights standing in the world, taken by walking (or swimming) through them.
import * as THREE from 'three';

const VERT = /* glsl */ `
in float aGlow;
out vec3 vWorld; out float vGlow;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; vGlow = aGlow; gl_Position = projectionMatrix * viewMatrix * w; }`;
const FRAG = /* glsl */ `
uniform float uTime; uniform float uGlow; uniform vec3 uColor; uniform vec3 uLight;
in vec3 vWorld; in float vGlow;
void main() {
  vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld))), V = normalize(cameraPosition - vWorld);
  float f = pow(1.0 - abs(dot(N, V)), 2.0), sun = 0.45 + 0.55 * clamp(dot(N, normalize(vec3(0.5, 0.45, 0.74))), 0.0, 1.0);
  vec3 matter = uColor * sun + uColor * f * 0.6;
  vec3 light = uLight * (1.2 + 2.6 * f) * (0.88 + 0.12 * sin(uTime * 3.1 + vWorld.x));
  gl_FragColor = vec4(mix(matter, matter * 0.4 + light * uGlow, vGlow), 1.0);
}`;

// What each kind of thing looks like: parts as [geometry, glows?], the colour of its matter
// and of its light, whether it stays once touched, how high it hangs and whether it turns.
const part = (geo, glow) => { const g = geo.index ? geo.toNonIndexed() : geo; g.setAttribute('aGlow', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(glow), 1)); return g; };
const join = (parts) => { const pos = [], gl = []; for (const g of parts) { pos.push(...g.attributes.position.array); gl.push(...g.attributes.aGlow.array); } const o = new THREE.BufferGeometry(); o.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); o.setAttribute('aGlow', new THREE.Float32BufferAttribute(gl, 1)); return o; };
const SHAPES = {
  'lantern seed': () => ({ geo: join([part(new THREE.SphereGeometry(0.13, 10, 8).scale(1, 1.35, 1), 1), part(new THREE.ConeGeometry(0.1, 0.14, 6).translate(0, 0.2, 0), 0), part(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 5).translate(0, 0.33, 0), 0)]), color: [0.1, 0.16, 0.05], light: [1.0, 0.82, 0.45], hang: 1.0, turn: 0.8 }),
  'survey mark': () => ({ geo: join([part(new THREE.CylinderGeometry(0.09, 0.17, 1.25, 4).translate(0, 0.625, 0), 0), part(new THREE.CylinderGeometry(0.24, 0.26, 0.1, 4).translate(0, 0.05, 0), 0), part(new THREE.OctahedronGeometry(0.11, 0).scale(1, 1.5, 1).translate(0, 1.45, 0), 1)]), color: [0.46, 0.44, 0.4], light: [1.0, 0.76, 0.36], stay: true, idle: 0.5, lit: 1.6 }),
  lamp: () => ({ geo: join([part(new THREE.CylinderGeometry(0.045, 0.07, 2.3, 6).translate(0, 1.15, 0), 0), part(new THREE.CylinderGeometry(0.2, 0.24, 0.12, 6).translate(0, 0.06, 0), 0), part(new THREE.OctahedronGeometry(0.21, 0).scale(1, 1.5, 1).translate(0, 2.62, 0), 1), part(new THREE.ConeGeometry(0.26, 0.16, 4).translate(0, 3.0, 0), 0)]), color: [0.06, 0.06, 0.07], light: [1.0, 0.74, 0.34], stay: true, idle: 0.1, lit: 1.9 }),
  float: () => ({ geo: join([part(new THREE.CylinderGeometry(0.2, 0.2, 0.34, 10), 0), part(new THREE.TorusGeometry(0.205, 0.03, 5, 14).rotateX(Math.PI / 2), 1), part(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 5).translate(0, 0.4, 0), 0), part(new THREE.OctahedronGeometry(0.06, 0).translate(0, 0.68, 0), 1)]), color: [0.3, 0.2, 0.1], light: [1.0, 0.9, 0.7], hang: -0.04, bob: 0.06 }),
  'golden pear': () => ({ geo: join([part(new THREE.SphereGeometry(0.12, 10, 8).scale(1, 1.1, 1), 1), part(new THREE.SphereGeometry(0.078, 8, 6).translate(0, 0.13, 0), 1), part(new THREE.CylinderGeometry(0.01, 0.014, 0.1, 5).translate(0.01, 0.24, 0), 0)]), color: [0.2, 0.12, 0.04], light: [1.0, 0.72, 0.22], hang: 0.9, turn: 0.6 }),
};

// kind: gather (spots, taken by touch) | slay (packs of the wilds) | notes (lost notes found)
// | elites (named Mute brought down) | trials (trials won) | relics (reliquaries opened)
// | bells (bells rung) | echoes (echoes answered). after: offered once that one is done.
export const QUESTS = [
  { id: 'kept', giver: 'quill', title: 'What the Singers Kept', kind: 'relics', verb: 'Open reliquaries on the mesas', need: 4, reward: { up: 'stamina', xp: 150 },
    offer: ['The archive lists them. A reliquary on every mesa, each with one keepsake in it. A whistle, a bead, a splinter of something.', 'Nobody has opened one since the quiet. I should like to cross four off the list before the ink dries on today.'],
    wait: ['Four reliquaries. They stand off the paths; the map marks the ones people have told you of.'],
    done: ['Four, and each of them worn by somebody again. That is what they were for.', 'A copyist learns to sit still without tiring. It works standing up as well. Like so.'] },
  { id: 'nine', giver: 'imre', title: 'Nine Bells', kind: 'bells', verb: 'Ring the bells out on the mesas', need: 9, reward: { up: 'health', xp: 140 },
    offer: ['You rang ours. I heard them from inside the quiet, all three, and then I could move my hands.', 'There are fifteen out there on the five mesas. Ring nine and the wind will carry it the rest of the way.'],
    wait: ['Nine bells in all, counting ours. You will hear which ones are still dumb.'],
    done: ['Nine. On a still evening you can hear them answer each other now.', 'Here. Lamp oil and honey. Do not ask which is which; it does you good either way.'] },
  { id: 'answer', giver: 'sova', title: 'An Answer for the Silence', kind: 'echoes', verb: 'Answer echoes at the spires of courts that sing', need: 3, reward: { up: 'blade', xp: 300 },
    offer: ['It is over, and it is not. Stand at a spire that sings and you can hear the court remember its silence.', 'Wake that memory and the Mute come back as they were, and worse. Answer three of them. A valley that has been afraid should see it done more than once.'],
    wait: ['Three echoes, at any three courts. Stand at the spire and wake it.'],
    done: ['Three times, and the song did not falter once. I counted the lights the whole while.', 'Give me the blade. The Crown kept one whetstone back for a day like this.'] },
  { id: 'vellum2', giver: 'sel', after: 'vellum', title: 'The Far Sheets', kind: 'gather', thing: 'survey mark', verb: 'Reach the survey marks by the five pools beyond the water', r: 3.2,
    spots: [[568.8, -373.1], [610.5, 370.7], [71.3, 457.4], [-343.8, 363.7], [-902.5, 32]], reward: { up: 'stamina', xp: 160 },
    offer: ['You rode the strings. I can tell: people come back from it with their hair on sideways.', 'I set a mark by the pool on each of the five mesas, the summer before the quiet. If they stand, the far sheets of my map are still true.', 'Find them for me. They will show on your map once you are near.'],
    wait: ['Five marks, one by the pool on each mesa beyond the water.'],
    done: ['All five. Then the Vale is the shape I remember, edge to edge.', 'I have nothing to give a traveller but wind. Here is some.'] },
  { id: 'count2', giver: 'maren', after: 'count', title: 'The Whole Tune', kind: 'notes', verb: 'Find lost notes of the old song', need: 60, reward: { up: 'blade', xp: 260 },
    offer: ['Thirty notes made a phrase. I have been humming it all day and it wants an ending.', 'Sixty would be the whole tune, near enough. The far mesas are full of them.'],
    wait: ['Sixty notes for the whole tune. Listen for them out beyond the water.'],
    done: ['That is it. That is the tune my mother sang me. I had lost the middle.', 'Your blade knows it too, now. Mind how it cuts.'] },
  { id: 'names', giver: 'odo', title: 'Four Names', kind: 'elites', verb: 'Bring down the named Mute of the outer courts', need: 4, reward: { up: 'health', xp: 220 },
    offer: ['One thing more. Out on the mesas some of the Mute have stood so long that people gave them names.', 'The Lantern Thrall. The Reed Stalker. The Gilded Warden. The Orchard Cantor. Each holds a string of the old song wound tight inside it.', 'Bring them down and what they held comes back to you. I will know what to do with it.'],
    wait: ['Four named ones, one at each court between here and the Crown.'],
    done: ['Four strings, and every one still true after all that time. Remarkable.', 'There. Wound into you, where the Mute cannot get at them again.'] },
  { id: 'rings', giver: 'tam', after: 'stair', title: 'The Old Drills', kind: 'trials', verb: 'Win trials at the rings on the mesas', need: 5, reward: { up: 'stamina', xp: 200 },
    offer: ['You have seen the gold rings standing out in the grass? We drilled at those, when the Vale had singers who could fight.', 'Step up to one and answer it, and it will test you the way it tested us. Win five and you may call yourself a ringer.'],
    wait: ['Five trials at the rings. Some ask you to stand, some to run.'],
    done: ['Five. I would have you in my watch tomorrow, if I still had a watch.', 'A ringer breathes like this. Yes. Like that.'] },
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
  wen: [[0, ['Are you the one with the note? Maren said someone was coming with a note.']]],
  bram: [[0, ['I cut half the paving on this terrace. The other half was my father.']]],
  ode: [[0, ['The bees went quiet too, you know. They stood in the air like beads on a string.']]],
  lio: [[0, ['Four hundred and twelve steps. I have swept every one of them more often than I have eaten.']]],
  ansa: [[0, ['We stopped in the middle of a breath. I still had the next note ready. I have it now.']]],
  corr: [[0, ['I sing the low part. Nobody notices the low part until it is missing.']]],
  imre: [[0, ['A wick wants trimming every evening or the flame runs ragged. Same as people.']]],
  tolly: [[0, ['I mend the nets. Nan says I am the best at it. Nan says that to everyone.']]],
  quill: [[0, ['I was halfway through a word when the quiet came. I have finished it. It was "and".']]],
  marn: [[0, ['Up the ladder, down the ladder. The pears do not care who is singing.']]],
  sova: [[0, ['Nobody has stood in this court since the fall but the Mute, and now you.']]],
  first: [[0, ['I sang the first note here, before there was a spire to hold it.', 'You carried the last one all this way. That makes us colleagues.', 'Go where you like now. It is all singing. It will go on singing.']]],
};
// What else they say when asked again, one after another.
const CHAT = {
  maren: ['I keep the terrace swept. It is not much, but it was all there was to keep.', 'When the wind is right you can hear which courts are singing. Count them with me some evening.'],
  odo: ['A string wants to be at one pitch and no other. People are the same; they take longer to tune.', 'Every construct you break was holding a little of the song. That is all resonance is: the song, coming home.'],
  sel: ['I walked every one of these mesas when I was young. My knees have opinions about it now.', 'If you find a place that is not on the map, tell me. Or do not. Some places should stay found only once.'],
  ilse: ['Lantern flowers close when it is quiet. Look, they are open.', 'I talked to these beds the whole time I stood here. I think it helped. Them, I mean.'],
  tam: ['A ringer is only someone who shows up at the same hour every day. The bell does the rest.', 'Mind the long stair when it is wet.'],
  vey: ['Three spires made a chord. Eight will make a choir. I shall need more chairs.', 'You hum when you fight. Did you know? A little flat.'],
  ruu: ['I light them at dusk and put them out at dawn, and in between I worry about them.', 'The tower behind the court was the first thing ships saw. It will be again.'],
  nan: ['The pool has fish in it the size of your arm. They did not mind the quiet at all.', 'Reeds make good pipes if you cut them at the right moon. I always forget which.'],
  pell: ['I have found the tune your blade sings, in the archive. It is a lullaby. I thought you should know.', 'Do not touch the scrolls with wet gloves.'],
  wen: ['Can you make the sword sing on purpose? Do it again.', 'When I am big I am going to ride the strings all the way to the Crown.'],
  bram: ['Stone remembers a tune longer than people do. That is why they built the spires of it.', 'If you see cracked paving out on the mesas, do not tell me. I will only want to go and fix it.'],
  ode: ['Petal honey is the pale kind. You may have a jar when there is some.', 'They are dancing again. That means the flowers are good.'],
  lio: ['Mind you do not run on the stair. Well. You may run. You have earned it.', 'The view from the top landing is the best in the Vale, and I get it every morning.'],
  ansa: ['Vey says we will sing at dusk, when the wind off the lake is lowest. Come and listen.', 'There were forty of us. There will be again.'],
  corr: ['Stand in the middle of the court and hum. Go on. Hear that? That is what it was built for.', 'I dreamt, while I stood there. Mostly about breakfast.'],
  imre: ['Ruu lights them. I only keep them fit to be lit. It is the better half of the work.', 'You can count the lamps from the Evenspan if you have good eyes.'],
  tolly: ['There is a fish in the pool with one white fin. If you see it, it is mine.', 'I can hold my breath longer than you. Probably.'],
  quill: ['Pell reads. I copy. Between us nothing gets lost twice.', 'The ink froze in the well, all that time. It still writes.'],
  marn: ['Hesk will tell you he planted these trees. His grandmother planted these trees.', 'Take the low ones. I have a ladder for the rest.'],
  sova: ['The First Singer has not stopped smiling since she woke. It is a little alarming.', 'From here the strings run out to every court. I can see all eight lights. I count them hourly.'],
  hesk: ['That pergola was my grandmother\'s idea. The wisteria was the wisteria\'s.', 'You want a pear? Take two. They only fall otherwise.'],
};
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

export class Quests {
  constructor(game, pipe) {
    this.g = game; this.pipe = pipe;
    this.state = {};                 // id -> { s: 'active' | 'ready' | 'done', got: [spot indices] }
    this.items = [];                 // things standing in the world to be gathered
    this.group = new THREE.Group(); pipe.scene.add(this.group); this.shapes = {};
    // Things still to be gathered come back with a saved journey; so do the ones that stay
    // where they stand once touched (lamps lit, marks found).
    for (const [id, st] of Object.entries(game.questSave ?? {})) { this.state[id] = { s: st.s, got: [...(st.got ?? [])] }; const q = this.def(id); if (q && (st.s === 'active' || this._shape(q.thing)?.stay)) this._place(q); }
  }

  def(id) { return QUESTS.find((q) => q.id === id); }
  _shape(thing) { return thing && SHAPES[thing] ? (this.shapes[thing] ??= SHAPES[thing]()) : null; }
  dump() { return this.state; }
  get active() { return QUESTS.filter((q) => this.state[q.id]?.s === 'active' || this.state[q.id]?.s === 'ready'); }
  get doneCount() { return QUESTS.filter((q) => this.state[q.id]?.s === 'done').length; }
  get total() { return QUESTS.length; }

  // Sets the things of a gathering quest down in the world.
  _place(q) {
    if (q.kind !== 'gather') return;
    const W = this.g.world, st = this.state[q.id];
    // A spot may name the height of the floor it stands on (a platform out over a drop).
    const sh = this._shape(q.thing);
    q.spots.forEach(([x, z, at], i) => {
      const got = st.got.includes(i);
      if ((got && !sh.stay) || this.items.some((it) => it.q === q.id && it.i === i)) return;
      W.stream(x, z, 4);
      const water = W.waterLevel(x, z), ground = at !== undefined ? W.floorBelow(x, at + 2, z, 6) : W.floorBelow(x, W.groundHeight(x, z) + 30, z, 60);
      const base = q.swim && Number.isFinite(water) ? Math.max(water, ground) : ground;
      const u = { uTime: this.pipe.globals.uTime, uGlow: { value: 0 }, uColor: { value: new THREE.Vector3(...sh.color) }, uLight: { value: new THREE.Vector3(...sh.light) } };
      const mesh = new THREE.Mesh(sh.geo, new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: u, side: THREE.DoubleSide }));
      mesh.frustumCulled = false; this.group.add(mesh);
      // y is where the hero's reach is tested (about chest height above its foot).
      this.items.push({ q: q.id, i, x, y: base + 1.2, base, z, k: 1, taken: got, phase: i * 1.9, mesh, u, sh });
    });
  }

  progress(q) {
    const g = this.g, st = this.state[q.id];
    if (q.kind === 'gather') return [st.got.length, q.spots.length];
    if (q.kind === 'slay') return [q.packs.filter((i) => g.wildDone.includes(i)).length, q.packs.length];
    if (q.kind === 'elites') return [Math.min(q.need, (g.elitesDown ?? []).length), q.need];
    if (q.kind === 'trials') return [Math.min(q.need, g.trials.doneCount), q.need];
    if (q.kind === 'relics') return [Math.min(q.need, g.reliquaries?.openCount ?? 0), q.need];
    if (q.kind === 'bells') return [Math.min(q.need, g.bells?.list.filter((b) => b.rung).length ?? 0), q.need];
    if (q.kind === 'echoes') return [Math.min(q.need, (g.echoes ?? []).length), q.need];
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
    if (q.kind === 'gather') for (const it of this.items) { if (it.q !== q.id || it.taken) continue; const d = Math.hypot(it.x - p.x, it.z - p.z); if (d < bd) { bd = d; best = { x: it.x, y: it.base + (it.sh.stay ? 3.6 : 2.0), z: it.z, name: q.thing[0].toUpperCase() + q.thing.slice(1) }; } }
    if (q.kind === 'slay') for (const i of q.packs) { if (g.wildDone.includes(i)) continue; const e = g.enemies.list.find((f) => f.alive && f.group === `wild${i}`); if (!e) continue; const d = Math.hypot(e.pos.x - p.x, e.pos.z - p.z); if (d < bd) { bd = d; best = { x: e.pos.x, y: e.pos.y + 3, z: e.pos.z, name: 'The Mute' }; } }
    return best;
  }

  // Everything a person has to say right now, and what follows from saying it.
  talkTo(n) {
    const g = this.g, id = n.def.id, mine = QUESTS.filter((q) => q.giver === id);
    const ready = mine.find((q) => this.state[q.id]?.s === 'ready'), active = mine.find((q) => this.state[q.id]?.s === 'active'), fresh = mine.find((q) => !this.state[q.id] && (!q.after || this.state[q.after]?.s === 'done'));
    const tuned = g.spires.filter((s) => s.tuned).length;
    let lines, done = null;
    if (ready) { lines = ready.done; done = () => this._finish(ready); }
    else if (active) {
      // What they are waiting for, and between reminders whatever else is on their mind.
      const n0 = ((this.chatN ??= {})[id] = (this.chatN[id] ?? -1) + 1), more = CHAT[id];
      lines = n0 % 2 === 0 || !more ? active.wait : [more[((n0 - 1) >> 1) % more.length]];
    }
    else if (fresh && !(g.metPeople ??= []).includes(id) && IDLE[id]) {
      // A first meeting: who they are, then what they want.
      lines = [...this._idle(id, tuned), ...fresh.offer]; done = () => this._start(fresh);
    } else if (fresh) { lines = fresh.offer; done = () => this._start(fresh); }
    else {
      // Their line for where the journey stands, the first time; after that, whatever else is on their mind.
      const n0 = ((this.chatN ??= {})[id] = (this.chatN[id] ?? -1) + 1), more = CHAT[id];
      lines = n0 === 0 || !more ? this._idle(id, tuned) : [more[(n0 - 1) % more.length]];
    }
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
    this.group.visible = !g.cine;
    if (g.cine) return;
    // Things to gather.
    for (const it of this.items) {
      const d = Math.hypot(p.pos.x - it.x, p.pos.z - it.z), q = this.def(it.q), sh = it.sh;
      if (playing && !it.taken && d < q.r && Math.abs(p.pos.y + 1 - it.y) < 2.6 && p.state !== 'ride') {
        it.taken = true;
        const st = this.state[it.q]; st.got.push(it.i);
        P.burst(it.x, it.y, it.z, 22, { speed: 3.6, life: 0.8, size: 0.05, color: [3.4, 3.0, 2.2], gravity: -1.2, drag: 1.5, up: 1.2 });
        g.vfx.wave(it.x, it.base + 0.08, it.z, { r0: 0.2, r1: sh.stay ? 5 : 3.2, life: 0.7, strength: 0.7, width: 0.1, color: [2.6, 2.1, 1.2] });
        g.emit('quest', { phase: 'item', title: q.title, thing: q.thing, count: st.got.length, total: q.spots.length });
        this._check(q); g.save();
      }
      // Taken things fade out, except those that stay and take light instead.
      it.k += ((it.taken && !sh.stay ? 0 : 1) - it.k) * Math.min(1, dt * 9);
      const show = it.k > 0.01 && d < 220;
      it.mesh.visible = show;
      if (!show) continue;
      const hang = sh.hang ?? 0, bob = sh.hang !== undefined ? Math.sin(t * 1.3 + it.phase) * (sh.bob ?? 0.08) : 0;
      it.mesh.position.set(it.x, it.base + hang + bob, it.z);
      it.mesh.rotation.y = (sh.turn ?? 0) * t + it.phase;
      it.mesh.scale.setScalar(it.k);
      it.mesh.updateMatrixWorld();
      it.u.uGlow.value += ((it.taken ? sh.lit ?? 1 : sh.idle ?? 1) - it.u.uGlow.value) * Math.min(1, dt * 4);
      // A thread of light above each one still to be found, so it shows from across a meadow.
      if (!it.taken && d < 120) {
        const top = it.base + (sh.stay ? 3.2 : (sh.hang ?? 0) + 0.5);
        P.spawn(it.x, top - 0.3, it.z, { life: 0.1, size: 0.7, color: [1.5, 1.3, 0.9], alpha: 0.5 });
        if (Math.random() < dt * 14) P.spawn(it.x + (Math.random() - 0.5) * 0.2, top, it.z + (Math.random() - 0.5) * 0.2, { vel: [0, 2.2 + Math.random() * 2, 0], life: 1.6, size: 0.05, color: [2.6, 2.3, 1.6], drag: 0.3 });
      }
    }
    for (const it of this.items) if (it.taken && !it.sh.stay && it.k <= 0.01) { this.group.remove(it.mesh); it.mesh.material.dispose(); }
    this.items = this.items.filter((it) => !it.taken || it.sh.stay || it.k > 0.01);
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
