// Bakes the terrain height maps from the analytic layout into public/world.
// Usage: node tools/build-world.mjs [--threads 4] [--preview]
// Uses a small number of worker threads on purpose so it never saturates the machine.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { gzipSync, deflateSync, crc32 } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { WORLD, makeTerrain, sunDirection } from '../src/world/layout.js';

const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(__filename), '..');

if (!isMainThread) {
  const { size, res, row0, row1 } = workerData;
  const { height } = makeTerrain();
  const out = new Float32Array((row1 - row0) * res);
  const step = size / res, half = size / 2;
  for (let j = row0; j < row1; j++) {
    const z = -half + (j + 0.5) * step;
    for (let i = 0; i < res; i++) out[(j - row0) * res + i] = height(-half + (i + 0.5) * step, z);
  }
  parentPort.postMessage(out, [out.buffer]);
} else {
  const args = process.argv.slice(2);
  const threads = Math.max(1, Math.min(6, Number(args[args.indexOf('--threads') + 1]) || 4));
  const wantPreview = args.includes('--preview');

  async function bake(size, res) {
    const data = new Float32Array(res * res);
    const chunk = Math.ceil(res / (threads * 4));
    const jobs = [];
    for (let r = 0; r < res; r += chunk) jobs.push([r, Math.min(res, r + chunk)]);
    let next = 0;
    await Promise.all(Array.from({ length: threads }, async () => {
      while (next < jobs.length) {
        const [row0, row1] = jobs[next++];
        await new Promise((resolve, reject) => {
          const w = new Worker(__filename, { workerData: { size, res, row0, row1 } });
          w.once('message', (buf) => { data.set(buf, row0 * res); resolve(); });
          w.once('error', reject);
        });
      }
    }));
    return data;
  }

  function quantise(data, lo, hi) {
    const q = new Uint16Array(data.length);
    const k = 65535 / (hi - lo);
    for (let i = 0; i < data.length; i++) q[i] = Math.max(0, Math.min(65535, Math.round((data[i] - lo) * k)));
    return q;
  }

  function png(w, h, rgb) {
    const raw = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) {
      raw[y * (w * 3 + 1)] = 0;
      rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
    }
    const chunk = (type, body) => {
      const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
      const td = Buffer.concat([Buffer.from(type), body]);
      const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
      return Buffer.concat([len, td, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  }

  function preview(data, res, size, outRes, file) {
    const sun = sunDirection();
    const sd = [sun[0], Math.max(sun[1], 0.35), sun[2]];
    const sl = Math.hypot(...sd); sd[0] /= sl; sd[1] /= sl; sd[2] /= sl;
    const rgb = Buffer.alloc(outRes * outRes * 3);
    const f = res / outRes, cell = size / res;
    const at = (i, j) => data[Math.max(0, Math.min(res - 1, j)) * res + Math.max(0, Math.min(res - 1, i))];
    for (let y = 0; y < outRes; y++) {
      for (let x = 0; x < outRes; x++) {
        const i = Math.floor(x * f), j = Math.floor(y * f);
        const h = at(i, j);
        const nx = (at(i - 1, j) - at(i + 1, j)) / (2 * cell), nz = (at(i, j - 1) - at(i, j + 1)) / (2 * cell);
        const nl = Math.hypot(nx, 1, nz);
        const lit = Math.max(0, (nx * sd[0] + sd[1] + nz * sd[2]) / nl);
        const slope = 1 - 1 / nl;
        let c;
        if (h < 0) c = [40, 90 + h * 2, 140 + h * 2];
        else if (h > 1500) c = [235, 238, 245];
        else if (slope > 0.45) c = [150, 140, 128];
        else c = [70 + h * 0.25, 120 + h * 0.2, 60 + h * 0.1];
        const s = 0.35 + 0.85 * lit;
        const o = (y * outRes + x) * 3;
        rgb[o] = Math.min(255, c[0] * s); rgb[o + 1] = Math.min(255, c[1] * s); rgb[o + 2] = Math.min(255, c[2] * s);
      }
    }
    writeFileSync(file, png(outRes, outRes, rgb));
  }

  const t0 = Date.now();
  const outDir = path.join(root, 'public', 'world');
  mkdirSync(outDir, { recursive: true });
  mkdirSync(path.join(root, 'tools', 'out'), { recursive: true });

  const region = await bake(WORLD.regionSize, WORLD.regionRes);
  console.log(`region baked in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const core = await bake(WORLD.coreSize, WORLD.coreRes);
  console.log(`core baked in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const range = (d) => { let lo = 1e9, hi = -1e9; for (let i = 0; i < d.length; i++) { if (d[i] < lo) lo = d[i]; if (d[i] > hi) hi = d[i]; } return [lo, hi]; };
  const [rLo, rHi] = range(region), [cLo, cHi] = range(core);
  const meta = {
    region: { size: WORLD.regionSize, res: WORLD.regionRes, min: Math.floor(rLo) - 1, max: Math.ceil(rHi) + 1 },
    core: { size: WORLD.coreSize, res: WORLD.coreRes, min: Math.floor(cLo) - 1, max: Math.ceil(cHi) + 1 },
  };
  const rq = quantise(region, meta.region.min, meta.region.max), cq = quantise(core, meta.core.min, meta.core.max);
  const rz = gzipSync(Buffer.from(rq.buffer), { level: 9 }), cz = gzipSync(Buffer.from(cq.buffer), { level: 9 });
  writeFileSync(path.join(outDir, 'region_h.bin'), rz);
  writeFileSync(path.join(outDir, 'core_h.bin'), cz);
  writeFileSync(path.join(outDir, 'world.json'), JSON.stringify(meta));
  console.log(`heights: region ${rLo.toFixed(1)}..${rHi.toFixed(1)} m (${(rz.length / 1e6).toFixed(1)} MB), core ${cLo.toFixed(1)}..${cHi.toFixed(1)} m (${(cz.length / 1e6).toFixed(1)} MB)`);

  if (wantPreview) {
    preview(region, WORLD.regionRes, WORLD.regionSize, 1024, path.join(root, 'tools', 'out', 'region.png'));
    preview(core, WORLD.coreRes, WORLD.coreSize, 1024, path.join(root, 'tools', 'out', 'core.png'));
  }
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
