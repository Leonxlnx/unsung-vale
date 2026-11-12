// Where do the slow frames come from? Runs the game in a real window, times the parts of
// every frame on the CPU side (rules, interface, issuing the draw calls) against the time
// between presented frames, and prints the breakdown of the slowest ones.
//   node tools/hitch.mjs [--preset ultra] [--seconds 12]      (npm run dev must be up)
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const W = Number(arg('w', 1920)), H = Number(arg('h', 1080)), preset = arg('preset', 'ultra'), seconds = Number(arg('seconds', 12));
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await puppeteer.launch({ executablePath: chrome, headless: false, defaultViewport: null, args: [`--window-size=${W},${H + 90}`, '--ignore-gpu-blocklist', '--mute-audio', '--no-first-run'] });
const page = (await browser.pages())[0];
await page.setViewport({ width: W, height: H });
await page.goto(arg('url', 'http://localhost:5183'), { timeout: 0 });
await page.waitForFunction('window.__dbg && window.__ui && !document.getElementById("boot")', { timeout: 0, polling: 500 });
await new Promise((r) => setTimeout(r, 3000));
await page.bringToFront();
const res = await page.evaluate(async (preset, seconds) => {
  const G = window.__game, U = window.__ui, P = window.__pipe, D = window.__dbg;
  U.settings.set('preset', preset); U.apply(); D.ui(true);
  D.play(2, 0, 0, { tp: [-519, 210.5, -70, Math.PI / 2] });
  G.state = 'playing'; G.input.enabled = true;
  // The hero runs a loop round the terrace and down the path while we measure.
  let k = 0; G.input.puppet = { move: { x: 0, y: 1 }, look: { x: 0, y: 0 }, pressed: new Set(), held: new Set(['sprint']) };
  const turn = setInterval(() => { G.rig.yaw += 0.5; k++; if (k % 9 === 0) G.input.puppet.pressed.add('jump'); if (k % 7 === 0) G.input.puppet.pressed.add('attack'); }, 700);
  const part = {}, wrap = (obj, name, key) => { const f = obj[name].bind(obj); obj[name] = (...a) => { const t = performance.now(); const r = f(...a); part[key] = (part[key] ?? 0) + performance.now() - t; return r; }; };
  wrap(G, 'update', 'game'); wrap(U, 'update', 'ui'); wrap(P, 'render', 'render'); wrap(window.__terrain, 'bakeStep', 'bake'); wrap(P, 'setSize', 'resize');
  // What else happens only now and then: a shadow refresh, a cloud tile, a scale change.
  { const sh = P.shadows; for (const n of ['renderStatic', '_renderStatic', 'updateStatic']) if (typeof sh[n] === 'function') wrap(sh, n, 'shadowStatic'); }
  for (const [o, n, key] of [[G.enemies, 'update', 'enemies'], [G.hero ?? {}, 'update', 'hero'], [G.particles, 'update', 'particles'], [G.people, 'update', 'people'], [G.notes, 'update', 'notes'], [G.world, 'stream', 'stream']]) if (o[n]) wrap(o, n, key);
  await new Promise((r) => setTimeout(r, 2500));
  const frames = [];
  await new Promise((done) => { let last = performance.now(); const t0 = last; const f = (now) => { frames.push({ dt: now - last, ...part }); for (const q of Object.keys(part)) part[q] = 0; last = now; if (now - t0 < seconds * 1000) requestAnimationFrame(f); else done(); }; requestAnimationFrame(f); });
  clearInterval(turn); G.input.puppet = null;
  const keys = ['dt', 'resize', 'shadowStatic', 'game', 'ui', 'render', 'bake', 'enemies', 'hero', 'particles', 'people', 'notes', 'stream'];
  const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(2); };
  const stats = Object.fromEntries(keys.map((q) => [q, [pct(frames.map((f) => f[q] ?? 0), 0.5), pct(frames.map((f) => f[q] ?? 0), 0.95), pct(frames.map((f) => f[q] ?? 0), 0.999)]]));
  const slow = [...frames].sort((a, b) => b.dt - a.dt).slice(0, 14).map((f) => Object.fromEntries(keys.map((q) => [q, +(f[q] ?? 0).toFixed(1)])));
  const resized = frames.filter((f) => (f.resize ?? 0) > 0);
  return { n: frames.length, scale: P.renderScale, stats, slow, over25: frames.filter((f) => f.dt > 25).length, resizes: resized.length, resizeDt: resized.map((f) => Math.round(f.dt)) };
}, preset, seconds);
console.log(`${res.n} frames at scale ${res.scale}; ${res.over25} took longer than 25 ms; ${res.resizes} scale changes (frame times ${res.resizeDt.join(', ')} ms)`);
console.log('ms: median / 95th / worst'); for (const [k, v] of Object.entries(res.stats)) console.log(k.padEnd(10), v.join(' / '));
console.log('slowest frames:'); for (const f of res.slow) console.log(JSON.stringify(f));
await browser.close();
