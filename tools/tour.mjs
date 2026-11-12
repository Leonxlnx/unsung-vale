// A visual tour in a real Chrome window: puts the game into one situation after another
// (conversation, map, a ride on a string, a wave fight, the last boss, a trial, swimming,
// tuning) and saves a screenshot of each. For looking at everything without playing two hours.
//   node tools/tour.mjs [--out tools/out/tour] [--only talk,map]
// The dev server must be running (npm run dev).
import { existsSync, mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const W = Number(arg('w', 1600)), H = Number(arg('h', 900)), out = arg('out', 'tools/out/tour'), only = arg('only', '').split(',').filter(Boolean);
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: chrome, headless: false, defaultViewport: null, args: [`--window-size=${W},${H + 90}`, '--ignore-gpu-blocklist', '--mute-audio', '--no-first-run', '--autoplay-policy=no-user-gesture-required'] });
const page = (await browser.pages())[0];
await page.setViewport({ width: W, height: H });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto(arg('url', 'http://localhost:5183') + '/', { timeout: 0 });
await page.waitForFunction(() => window.__ui && !document.getElementById('boot'), { timeout: 300000, polling: 500 });
await sleep(1500);
const shot = async (name) => { await page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 86 }); console.log('shot', name); };
const want = (name) => !only.length || only.includes(name);
const ev = (fn, ...a) => page.evaluate(fn, ...a);

if (want('title')) await shot('title');
await page.bringToFront();
await page.click('button[data-act="play"]');
await sleep(3500);
await page.keyboard.press('Space');
await sleep(2200);
await page.mouse.click(W / 2, H / 2);
await sleep(600);
// Helpers inside the page: nothing is saved, the hero cannot be hurt, spires can be set.
await ev(() => {
  const g = window.__game;
  g.save = () => {}; g.player.invulnerable = 1e9;
  window.__tour = {
    tune(ids) { for (const s of g.spires) if (ids.includes(s.id)) { s.tuned = true; s.power = 1; s.zoneR = 0; s.zone.z = 0; s.zone.w = 0; } g.enemies.list = g.enemies.list.filter((e) => !ids.includes(e.group) && !(ids.includes('cantor') && e.group === 'stair')); if (ids.includes('cantor')) g.bridgeOpen = true; g._skills(); g.story.leg = null; g.story._goal(); },
    tp(x, y, z, yaw = 0, pitch = -0.14, dist = 5.6) { g.world.stream(x, z, 8); g.player.spawn(x, y, z, yaw); g.player.invulnerable = 1e9; g.rig.snap(g.player); g.rig.yaw = yaw; g.rig.pitch = pitch; g.rig.distance = dist; },
    // Stand a few paces from a construct, looking at it.
    face(e, d = 12, pitch = 0.02, dist = 8) { const a = Math.atan2(g.player.pos.x - e.pos.x, g.player.pos.z - e.pos.z) || 0.5, x = e.pos.x + Math.sin(a) * d, z = e.pos.z + Math.cos(a) * d; this.tp(x, g.world.floorBelow(x, e.pos.y + 3, z, 8) + 0.1, z, a + Math.PI, pitch, dist); },
    clear(id) { for (const e of g.enemies.list) if (e.group === id) e.alive = false; g.enemies.list = g.enemies.list.filter((e) => e.group !== id); },
  };
});
if (want('terrace')) { await sleep(1200); await shot('terrace'); }

if (want('talk')) {
  await ev(() => { const g = window.__game, n = g.people.get('maren'); window.__tour.tp(n.x - 1.8, n.y + 0.1, n.z + 1.6, 2.3); });
  await sleep(700);
  await page.keyboard.press('KeyE');
  await sleep(1600); await shot('talk');
  for (let i = 0; i < 14; i++) { if (!(await ev(() => !!window.__game.people.talk))) break; await page.keyboard.press('KeyE'); await sleep(480); }
  await sleep(1500); await shot('quest_toast');
}
if (want('journal')) { await page.keyboard.press('KeyJ'); await sleep(900); await shot('journal'); await ev(() => document.querySelector('[data-jtab="hero"]').click()); await sleep(500); await shot('hero'); await page.keyboard.press('KeyJ'); await sleep(600); await page.mouse.click(W / 2, H / 2); await sleep(300); }

if (want('map') || want('ride') || want('waves')) {
  await ev(() => { const g = window.__game; g.hasMap = true; window.__tour.tune(['petal', 'cantor', 'choir']); const n = g.strings.nodes.choir; window.__tour.tp(n.x + 1.6, n.y + 0.1, n.z + 1.6, 1.2); });
  await sleep(900); await shot('pylon');
  await page.keyboard.press('KeyM'); await sleep(1100); await shot('map');
  // Click the Lantern Court on the map to ride there.
  const pt = await ev(() => { const r = document.querySelector('#journey .chart').getBoundingClientRect(), s = window.__game.spires.find((q) => q.id === 'east'); return [r.left + ((s.x + 1150) / 2300) * r.width, r.top + ((s.z + 1150) / 2300) * r.height]; });
  await page.mouse.move(pt[0], pt[1]); await sleep(400); await shot('map_hover');
  await page.mouse.click(pt[0], pt[1]);
  await sleep(5200); await shot('ride');
  await page.waitForFunction(() => !window.__game.strings.ride, { timeout: 60000, polling: 300 });
  await sleep(800); await shot('arrive');
  await page.keyboard.down('KeyW'); await sleep(1300); await page.keyboard.up('KeyW');
  await sleep(2600); await shot('waves');
  for (let i = 0; i < 3; i++) { await page.mouse.down(); await page.mouse.up(); await sleep(330); }
  await sleep(200); await shot('strike');
}
if (want('elite')) {
  await ev(() => { const g = window.__game; window.__tour.clear('east'); g.encounters.wave.east = 1; g.encounters.wait.east = 1.7; const s = g.spires.find((q) => q.id === 'east'); window.__tour.tp(s.x + 6, s.base + 0.2, s.z + 12, Math.PI, -0.1, 7); });
  await sleep(3600);
  await ev(() => { const g = window.__game, e = g.enemies.list.find((q) => q.elite && q.alive); if (e) window.__tour.face(e, 9, -0.02, 6); });
  await sleep(900); await shot('elite');
}
if (want('boss')) {
  await ev(() => { const g = window.__game; window.__tour.tune(['petal', 'cantor', 'choir', 'east', 'south3', 'aurel', 'south1']); window.__tour.clear('crown'); g.encounters.wave.crown = 1; g.encounters.wait.crown = 1.7; const s = g.spires.find((q) => q.id === 'crown'); window.__tour.tp(s.x + 4, s.base + 0.2, s.z + 17, Math.PI, 0.02, 9); });
  await sleep(5200);
  await ev(() => { const g = window.__game, e = g.enemies.list.find((q) => q.kind === 'sovereign'); if (e) window.__tour.face(e, 16, 0.1, 9); });
  await sleep(1300); await shot('boss');
  await ev(() => { const g = window.__game, b = g.enemies.list.find((e) => e.kind === 'sovereign'); if (b) b.hp = b.def.hp * 0.6; });
  await sleep(4200); await shot('boss_phase');
  await ev(() => window.__tour.clear('crown'));
}
if (want('trial')) {
  await ev(() => { const g = window.__game, t = g.trials.list[0]; window.__tour.tp(t.x + 2.2, t.y + 0.1, t.z + 1.5, -2.2, -0.1, 7); });
  await sleep(900); await shot('trial_ring');
  await page.keyboard.press('KeyE'); await sleep(3200); await shot('trial_fight');
  await ev(() => { const g = window.__game; g.trials._end(false); const t = g.trials.list[1]; window.__tour.tp(t.x + 2.2, t.y + 0.1, t.z + 1.5, 0.3, -0.1, 7); });
  await sleep(900); await page.keyboard.press('KeyE'); await sleep(1500);
  await ev(() => { const g = window.__game, r = g.trials.run; if (r) { const gt = r.t.gates[0]; g.rig.yaw = Math.atan2(gt.x - g.player.pos.x, gt.z - g.player.pos.z); } });
  await sleep(700); await shot('trial_run');
  await ev(() => window.__game.trials.run && window.__game.trials._end(false));
}
if (want('item')) {
  await ev(() => { const g = window.__game, Q = g.quests; if (!Q.state.seeds) Q._start(Q.def('seeds')); const it = Q.items.find((i) => i.q === 'seeds'); window.__tour.tp(it.x - 5, it.y - 1.1, it.z - 3, Math.atan2(5, 3), -0.08, 6); });
  await sleep(1800); await shot('item');
}
if (want('swim')) {
  await ev(() => window.__tour.tp(-300, 174.5, -330, 0.6, -0.25, 6));
  await page.keyboard.down('KeyW'); await sleep(2600); await shot('swim'); await page.keyboard.up('KeyW');
}
if (want('courts')) {
  // Each of the outer courts, restored, seen from where the string sets the hero down.
  await ev(() => { window.__tour.tune(['petal', 'cantor', 'choir', 'east', 'south3', 'aurel', 'south1', 'crown']); window.__dbg.ui(false); });
  for (const id of ['east', 'south3', 'aurel', 'south1', 'crown']) {
    await ev((id) => { const g = window.__game, c = g.sites.outer.find((o) => o.id === id), a = c.away + Math.PI + 0.4, r = c.r + (c.style === 4 ? 27 : 17), x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r; window.__tour.tp(x, g.world.floorBelow(x, c.y + 6, z, 14) + 0.1, z, Math.atan2(c.x - x, c.z - z), 0.08, 13); }, id);
    await sleep(3200); await shot('court_' + id);
  }
  await ev(() => window.__dbg.ui(true));
}
if (want('bell')) {
  await ev(() => { const g = window.__game, b = g.bells.list.find((q) => !q.rung) ?? g.bells.list[0]; b.rung = false; window.__tour.clear(b.group); window.__tour.tp(b.x + 2.6, b.y + 0.1, b.z + 2.0, Math.atan2(-2.6, -2.0), -0.02, 6.5); });
  await sleep(1100); await shot('bell');
  await page.keyboard.press('KeyE'); await sleep(1000); await shot('bell_rung');
}
if (want('brute')) {
  await ev(() => { const g = window.__game, p = g.player.pos, e = g.enemies.spawn('brute', p.x + 7, p.z + 3, 'tour', null, p.y); e.state = 'rise'; e.t = 0; window.__brute = e; });
  await sleep(2600);
  await ev(() => window.__tour.face(window.__brute, 7.5, 0, 6));
  await sleep(1500); await shot('brute');
  await ev(() => window.__tour.clear('tour'));
}
if (want('tuning')) {
  await ev(() => { const g = window.__game, s = g.spires.find((q) => !q.tuned) ?? g.spires[7]; s.tuned = false; window.__tour.clear(s.id); g.encounters.wave[s.id] = 9; window.__tour.tp(s.x + 3.5, s.base + 0.2, s.z + 3.5, Math.PI + 0.78, -0.1, 6); });
  await sleep(1200); await page.keyboard.press('KeyE'); await sleep(2700); await shot('tuning');
  // Strike the notes as a player would, by the game's own clock.
  for (let i = 0; i < 400; i++) { const st = await ev(() => { const T = window.__game.tuning; return T.active ? [T.phase, T.ring, T.bt - T.period] : null; }); if (!st || st[0] !== 'beats') break; if (st[1] && Math.abs(st[2]) < 0.06) { await page.keyboard.press('KeyE'); await sleep(120); } else await sleep(16); }
  await sleep(3200); await shot('finale');
  await sleep(6500); await shot('woken');
}
console.log(errors.length ? `errors (${errors.length}):\n` + [...new Set(errors)].join('\n') : 'no console errors');
await browser.close();
