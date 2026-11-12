// Times a frame with parts of the scene switched off, to show where the milliseconds go.
//   node tools/profile.mjs [--w 1920 --h 1080 --preset medium]   (npm run dev must be up)
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const W = Number(arg('w', 1920)), H = Number(arg('h', 1080)), preset = arg('preset', 'medium');
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await puppeteer.launch({ executablePath: chrome, headless: false, defaultViewport: null, args: [`--window-size=${W},${H + 90}`, '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--mute-audio', '--no-first-run'] });
const page = (await browser.pages())[0];
await page.setViewport({ width: W, height: H });
await page.goto(arg('url', 'http://localhost:5183'), { timeout: 0 });
await page.waitForFunction('window.__dbg && window.__parts', { timeout: 0 });
await new Promise((r) => setTimeout(r, 6000));
const out = await page.evaluate(async (preset) => {
  const D = window.__dbg, P = window.__pipe, G = window.__game, X = window.__parts;
  const gl = P.renderer.getContext(), px = new Uint8Array(4);
  D.ui(false);
  D.play(60, 0, 0, { tp: [-600, 210.2, -180, 0.9] });
  const sync = () => { P.renderer.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
  const measure = () => {
    for (let i = 0; i < 12; i++) D.step(1); sync();
    const t = [];
    for (let i = 0; i < 40; i++) { const t0 = performance.now(); D.step(1); sync(); t.push(performance.now() - t0); }
    t.sort((a, b) => a - b);
    return +t[20].toFixed(1);
  };
  const rows = [];
  const base = measure();
  rows.push(['everything', base, P.renderer.info.render.calls, P.renderer.info.render.triangles]);
  const toggle = (name, off, on) => { off(); const v = measure(); rows.push([name, v, P.renderer.info.render.calls, P.renderer.info.render.triangles]); on(); };
  const vis = (o) => [() => { o.visible = false; }, () => { o.visible = true; }];
  toggle('no forest', ...vis(X.forest.group));
  toggle('no ground cover', ...vis(X.cover.group));
  toggle('no terrain', ...vis(X.terrain.mesh));
  toggle('no architecture', ...vis(X.arch.group));
  toggle('no water + falls', () => { X.water.group.visible = false; X.falls.group.visible = false; }, () => { X.water.group.visible = true; X.falls.group.visible = true; });
  toggle('no dressing', ...vis(X.dressing.group ?? { visible: true }));
  toggle('no shadows', () => { P.shadows.enabled = false; }, () => { P.shadows.enabled = true; });
  toggle('no volumetrics', () => { P.volumetrics.enabled = false; }, () => { P.volumetrics.enabled = true; });
  const rs = P.renderScale;
  toggle('half resolution', () => P.setRenderScale(rs * 0.5), () => P.setRenderScale(rs));
  toggle('nothing but post', () => { P.scene.visible = false; P.sceneT.visible = false; }, () => { P.scene.visible = true; P.sceneT.visible = true; });
  return { preset, size: [P.rw, P.rh], rows };
}, preset);
console.log(`preset ${out.preset} at ${out.size.join('x')}`);
for (const [name, ms, calls, tris] of out.rows) console.log(`${name.padEnd(20)} ${String(ms).padStart(6)} ms   saves ${(out.rows[0][1] - ms).toFixed(1).padStart(5)}   calls ${calls}  tris ${tris}`);
await browser.close();
