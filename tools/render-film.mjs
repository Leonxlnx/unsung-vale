// Renders the whole cinematic in segments and joins them, so a long 4K render can be
// stopped and resumed without losing finished work.
//
//   npm run build && npm run preview        (in another terminal; serves the built game on :5184)
//   node tools/render-film.mjs --w 3840 --h 2160 --fps 60 --out renders/unsung-vale
//
// Segments that already exist (and have the right frame count) are skipped.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const W = arg('w', '3840'), H = arg('h', '2160'), FPS = Number(arg('fps', 60)), TOTAL = Number(arg('seconds', 45)), SEG = Number(arg('segment', 5));
const OUT = arg('out', 'renders/unsung-vale'), SUB = arg('sub', '3'), THREADS = arg('threads', '6'), ONLY = arg('only', '');
const URL_BASE = arg('url', 'http://localhost:5184');       // the built game: npm run build && npm run preview
const dir = path.join(path.dirname(OUT), 'parts');
mkdirSync(dir, { recursive: true });

const frames = (file) => {
  if (!existsSync(file) || statSync(file).size < 1000) return 0;
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  return Number(r.stdout.trim()) || 0;
};

const parts = [];
for (let from = 0, i = 0; from < TOTAL - 1e-6; from += SEG, i++) {
  const to = Math.min(TOTAL, from + SEG), base = path.join(dir, `part${String(i).padStart(2, '0')}`);
  parts.push(base);
  if (ONLY && !ONLY.split(',').includes(String(i))) continue;
  const want = Math.round((to - from) * FPS);
  if (frames(`${base}-hdr10.mp4`) === want && frames(`${base}-sdr.mp4`) === want) { console.log(`[film] part ${i} (${from}-${to} s) already rendered`); continue; }
  console.log(`[film] rendering part ${i}: ${from}-${to} s`);
  const r = spawnSync('node', ['tools/capture.mjs', '--w', W, '--h', H, '--fps', String(FPS), '--from', String(from), '--to', String(to), '--sub', SUB, '--threads', THREADS, '--url', URL_BASE, '--out', base], { stdio: 'inherit' });
  if (r.status !== 0 || frames(`${base}-hdr10.mp4`) !== want) { console.error(`[film] part ${i} failed; run the same command again to resume`); process.exit(1); }
}

for (const kind of ['hdr10', 'sdr']) {
  const list = path.join(dir, `${kind}.txt`);
  writeFileSync(list, parts.map((p) => `file '${path.resolve(`${p}-${kind}.mp4`).replace(/\\/g, '/')}'`).join('\n'));
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'warning', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', ...(kind === 'hdr10' ? ['-tag:v', 'hvc1'] : ['-movflags', '+faststart']), `${OUT}-${kind}.mp4`], { stdio: 'inherit' });
  console.log(r.status === 0 ? `[film] wrote ${OUT}-${kind}.mp4` : `[film] joining ${kind} failed`);
}
