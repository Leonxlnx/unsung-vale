// Measures frame cost per quality preset in a real Chrome window (npm run dev must be up).
//   node tools/perf.mjs [--w 1920 --h 1080]
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const W = Number(arg('w', 1920)), H = Number(arg('h', 1080));
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await puppeteer.launch({ executablePath: chrome, headless: false, defaultViewport: null, args: [`--window-size=${W},${H + 90}`, '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--mute-audio', '--no-first-run'] });
const page = (await browser.pages())[0];
await page.setViewport({ width: W, height: H });
const done = new Promise((resolve) => page.on('console', (m) => { const t = m.text(); if (t.startsWith('[perf]')) console.log(t); if (t.includes('[perf] done')) resolve(); if (m.type() === 'error') console.log('ERR', t); }));
await page.goto(`${arg('url', 'http://localhost:5183')}/?perf=1`, { timeout: 0 });
await done;
await browser.close();
