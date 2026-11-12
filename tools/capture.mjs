// Renders the in-game cinematic to video files.
//
//   node tools/capture.mjs --w 3840 --h 2160 --fps 60 --seconds 45 --out renders/unsung-vale
//
// The game page (opened with ?capture=1) renders every frame offline at a fixed time step
// and POSTs raw pixels here; this script pipes them straight into ffmpeg, so nothing large
// ever touches the disk. Two files come out: an HDR10 master (HEVC Main10, PQ, BT.2020) and
// an SDR companion (H.264, BT.709). The video carries no audio track.
// Start the dev server first (npm run dev).
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const W = Number(arg('w', 3840)), H = Number(arg('h', 2160)), FPS = Number(arg('fps', 60));
// --from / --to (seconds) render only part of the film; --seconds is a synonym for --to.
const SECONDS = Number(arg('to', arg('seconds', 45)));
const SUB = Number(arg('sub', 3)), FROM = Number(arg('from', 0)), PORT = Number(arg('port', 5199));
const OUT = arg('out', 'renders/unsung-vale'), URL_BASE = arg('url', 'http://localhost:5183');
const SDR = arg('sdr', '1') !== '0', THREADS = Number(arg('threads', 6));
const CHROME = arg('chrome', ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync));
mkdirSync(path.dirname(OUT), { recursive: true });

function encoder(name, args) {
  const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'warning', '-y', ...args], { stdio: ['pipe', 'inherit', 'inherit'] });
  p.on('exit', (code) => console.log(`[ffmpeg ${name}] exited with ${code}`));
  return p;
}
const size = `${W}x${H}`;
const hdr = encoder('hdr', [
  '-f', 'rawvideo', '-pix_fmt', 'x2bgr10le', '-s', size, '-r', String(FPS), '-i', '-',
  '-vf', 'vflip,zscale=matrix=2020_ncl:range=limited,format=yuv420p10le',
  '-c:v', 'libx265', '-preset', 'medium', '-crf', '15', '-tag:v', 'hvc1',
  '-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'bt2020nc', '-color_range', 'tv',
  '-x265-params', `pools=${THREADS}:hdr10=1:hdr10-opt=1:repeat-headers=1:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,50):max-cll=1000,300`,
  '-an', `${OUT}-hdr10.mp4`,
]);
const sdr = SDR ? encoder('sdr', [
  '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', size, '-r', String(FPS), '-i', '-',
  '-vf', 'vflip,zscale=matrix=709:range=limited,format=yuv420p',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-threads', String(Math.max(2, THREADS - 2)),
  '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', '-movflags', '+faststart',
  '-an', `${OUT}-sdr.mp4`,
]) : null;

let frames = 0, finished;
const done = new Promise((resolve) => { finished = resolve; });
const t0 = Date.now();
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  if (req.url.startsWith('/frame/')) {
    const enc = req.url.includes('/hdr') ? hdr : sdr;
    if (!enc) { req.resume(); res.writeHead(200).end(); return; }
    // Respect back-pressure so the browser never renders faster than ffmpeg can encode.
    for await (const chunk of req) { if (!enc.stdin.write(chunk)) await new Promise((r) => enc.stdin.once('drain', r)); }
    if (req.url.includes('/hdr')) {
      frames++;
      if (frames % 30 === 0) { const el = (Date.now() - t0) / 1000; const total = Math.round((SECONDS - FROM) * FPS); console.log(`[capture] ${frames}/${total} frames, ${(el / frames).toFixed(2)} s/frame, about ${Math.round(((total - frames) * el) / frames / 60)} min left`); }
    }
    res.writeHead(200).end('ok');
    return;
  }
  if (req.url.startsWith('/done')) { res.writeHead(200).end('ok'); finished(); return; }
  res.writeHead(404).end();
});
server.listen(PORT);

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: false, defaultViewport: null,
  args: ['--window-size=1100,700', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--mute-audio', '--no-first-run', '--no-default-browser-check'],
});
const page = (await browser.pages())[0] ?? (await browser.newPage());
page.on('console', (m) => { const t = m.text(); if (t.startsWith('[cine]') || m.type() === 'error') console.log(t); });
page.on('pageerror', (e) => console.log('[page error]', e.message));
const q = new URLSearchParams({ capture: '1', w: W, h: H, fps: FPS, to: SECONDS, sub: SUB, from: FROM, server: `http://localhost:${PORT}` });
await page.goto(`${URL_BASE}/?${q}`, { waitUntil: 'load', timeout: 0 });
await done;
hdr.stdin.end(); sdr?.stdin.end();
await Promise.all([hdr, sdr].filter(Boolean).map((p) => new Promise((r) => p.once('exit', r))));
await browser.close();
server.close();
console.log(`[capture] wrote ${OUT}-hdr10.mp4${SDR ? ` and ${OUT}-sdr.mp4` : ''} (${frames} frames in ${((Date.now() - t0) / 60000).toFixed(1)} min)`);
