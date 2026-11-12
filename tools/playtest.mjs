// Smoke test in a real Chrome window: starts a new game from the title screen, walks,
// jumps, rolls and swings with real keyboard and mouse events, and reports what happened.
//   node tools/playtest.mjs [--shot tools/out/playtest.png]
// The dev server must be running (npm run dev).
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const W = Number(arg('w', 1600)), H = Number(arg('h', 900)), shot = arg('shot', 'tools/out/playtest.png');
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
mkdirSync(path.dirname(shot), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: chrome, headless: false, defaultViewport: null, args: [`--window-size=${W},${H + 90}`, '--ignore-gpu-blocklist', '--mute-audio', '--no-first-run', '--autoplay-policy=no-user-gesture-required'] });
const page = (await browser.pages())[0];
await page.setViewport({ width: W, height: H });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto(arg('url', 'http://localhost:5183') + '/', { timeout: 0 });
await page.waitForFunction(() => window.__ui && !document.getElementById('boot'), { timeout: 240000, polling: 500 });
await sleep(1500);
await page.screenshot({ path: shot.replace('.png', '_title.png') });

const state = () => page.evaluate(() => { const g = window.__game, p = g.player; return { state: g.state, pos: p.pos.toArray().map((v) => +v.toFixed(1)), player: p.state, health: p.health, stamina: Math.round(p.stamina), locked: g.input.locked, objective: g.objective, audio: window.__audio?.ctx?.state, music: window.__audio?.musicName, hero: !!g.hero }; });
const log = [];
await page.bringToFront();                      // pointer lock is only granted to a focused window
await page.click('button[data-act="play"]');
await sleep(4200);
log.push(['opening', await state()]);
await page.screenshot({ path: shot.replace('.png', '_intro.png') });
await page.keyboard.press('Space');            // skips the opening
await sleep(1900);
await page.mouse.click(W / 2, H / 2);            // takes the pointer lock
await sleep(400);
log.push(['after begin', await state()]);
await page.keyboard.down('KeyW'); await sleep(1500); await page.keyboard.up('KeyW');
log.push(['walked forward', await state()]);
await page.keyboard.down('KeyA'); await sleep(900); await page.keyboard.press('Space'); await sleep(700); await page.keyboard.up('KeyA');
log.push(['strafed and jumped', await state()]);
for (let i = 0; i < 3; i++) { await page.mouse.down(); await page.mouse.up(); await sleep(330); }
log.push(['three strikes', await state()]);
await sleep(500);
await page.keyboard.down('KeyS'); await page.keyboard.press('KeyC'); await sleep(700); await page.keyboard.up('KeyS');
log.push(['rolled back', await state()]);
await page.mouse.move(W / 2 + 160, H / 2 - 20, { steps: 8 });
await sleep(600);
await page.screenshot({ path: shot });
await page.keyboard.press('Escape'); await sleep(700);
log.push(['paused', await state()]);
await page.screenshot({ path: shot.replace('.png', '_pause.png') });
for (const [k, v] of log) console.log(k.padEnd(20), JSON.stringify(v));
console.log(errors.length ? `errors (${errors.length}):\n` + errors.join('\n') : 'no console errors');
await browser.close();
