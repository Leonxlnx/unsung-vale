// Frame rate as a player sees it: lets the page run freely in a real window and counts the
// frames it presents, for each quality preset at a few places.
//   node tools/fps.mjs [--w 1920 --h 1080 --presets ultra,high]   (npm run dev must be up)
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const W = Number(arg('w', 1920)), H = Number(arg('h', 1080)), presets = arg('presets', 'ultra').split(',');
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await puppeteer.launch({ executablePath: chrome, headless: false, defaultViewport: null, args: [`--window-size=${W},${H + 90}`, '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-frame-rate-limit', '--disable-gpu-vsync', '--mute-audio', '--no-first-run'] });
const page = (await browser.pages())[0];
await page.setViewport({ width: W, height: H });
await page.goto(arg('url', 'http://localhost:5183'), { timeout: 0 });
await page.waitForFunction('window.__dbg && window.__parts && window.__hero', { timeout: 0 });
await new Promise((r) => setTimeout(r, 5000));
const spots = { terrace: [-519, 210.5, -70, Math.PI / 2], meadow: [-600, 210.2, -180, 0.9], court: [-372, 178.4, -410, 0] };
for (const preset of presets) {
  for (const [name, tp] of Object.entries(spots)) {
    const r = await page.evaluate(async (preset, tp) => {
      const G = window.__game, U = window.__ui, D = window.__dbg;
      U.settings.set('preset', preset); U.apply(); D.ui(false);
      D.play(2, 0, 0, { tp });
      G.state = 'playing';                      // the page's own loop now runs the game
      await new Promise((r) => setTimeout(r, 1500));
      const times = [];
      await new Promise((done) => { let last = performance.now(); const f = (now) => { times.push(now - last); last = now; if (times.length < 240) requestAnimationFrame(f); else done(); }; requestAnimationFrame(f); });
      times.sort((a, b) => a - b);
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      return { avg: +avg.toFixed(1), med: +times[120].toFixed(1), p95: +times[228].toFixed(1), size: [window.__pipe.rw, window.__pipe.rh], scale: +window.__pipe.renderScale.toFixed(2) };
    }, preset, tp);
    console.log(`${preset.padEnd(7)} ${name.padEnd(8)} ${r.size.join('x')} (scale ${r.scale})  ${(1000 / r.avg).toFixed(0)} fps avg  ${(1000 / r.med).toFixed(0)} typical  ${(1000 / r.p95).toFixed(0)} low`);
  }
}
await browser.close();
