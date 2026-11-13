// Audio: music with cross-fades, ambience beds that follow where the player is, and
// one-shot effects with light positional panning. All sounds are licensed recordings listed
// in CREDITS.md and described by public/audio/manifest.json; nothing is synthesised.
export class AudioManager {
  constructor() {
    this.ready = false; this.buffers = new Map(); this.loading = new Map();
    this.vol = { master: 0.8, music: 0.55, sfx: 0.85 };
    this.music = null; this.musicName = null; this.amb = {};
    this.muffle = 0;
  }

  async init(base = '/audio/') {
    this.base = base;
    try {
      const res = await fetch(base + 'manifest.json');
      if (!res.ok) return false;
      this.manifest = await res.json();
    } catch { return false; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    const c = this.ctx;
    this.master = c.createGain(); this.master.connect(c.destination);
    // Music passes through a low-pass that closes inside a silenced zone.
    this.musicFilter = c.createBiquadFilter(); this.musicFilter.type = 'lowpass'; this.musicFilter.frequency.value = 20000;
    this.musicBus = c.createGain(); this.musicBus.connect(this.musicFilter); this.musicFilter.connect(this.master);
    this.sfxBus = c.createGain(); this.sfxBus.connect(this.master);
    // A touch of real space on every effect: a recorded impulse response of an open stone
    // court, fed from its own send so each sound can ask for more or less of it.
    this.reverbSend = c.createGain(); this.reverbSend.gain.value = 1;
    if (this.manifest.ir?.space) {
      const conv = c.createConvolver(), wet = c.createGain(); wet.gain.value = 0.55;
      this.reverbSend.connect(conv); conv.connect(wet); wet.connect(this.sfxBus);
      fetch(base + this.manifest.ir.space).then((r) => r.arrayBuffer()).then((b) => c.decodeAudioData(b)).then((buf) => { conv.buffer = buf; }).catch(() => {});
    }
    this.last = new Map();       // per effect: which variation played last, so none repeats twice running
    this.ambBus = c.createGain(); this.ambBus.connect(this.master);
    this.setVolumes(this.vol.master, this.vol.music, this.vol.sfx);
    this.ready = true;
    // Warm the cache with the short effects so the first sword swing is not late.
    for (const list of Object.values(this.manifest.sfx ?? {})) for (const f of [].concat(list)) this._load(f);
    return true;
  }

  // Browsers only allow sound after a user gesture.
  resume() { if (this.ctx?.state === 'suspended') this.ctx.resume(); }

  setVolumes(master, music, sfx) {
    this.vol = { master, music, sfx };
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(master, t, 0.05);
    this.musicBus.gain.setTargetAtTime(music, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(sfx, t, 0.05);
    this.ambBus.gain.setTargetAtTime(sfx * 0.8, t, 0.05);
  }

  _load(file) {
    if (this.buffers.has(file)) return Promise.resolve(this.buffers.get(file));
    if (!this.loading.has(file)) {
      this.loading.set(file, fetch(this.base + file).then((r) => r.arrayBuffer()).then((b) => this.ctx.decodeAudioData(b)).then((buf) => { this.buffers.set(file, buf); return buf; }).catch(() => null));
    }
    return this.loading.get(file);
  }

  _loop(file, bus, gain = 0) {
    const g = this.ctx.createGain(); g.gain.value = gain; g.connect(bus);
    const node = { gain: g, src: null };
    this._load(file).then((buf) => {
      if (!buf) return;
      const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.connect(g); s.start();
      node.src = s;
    });
    return node;
  }

  playMusic(name, fade = 2.5) {
    if (!this.ready || this.musicName === name) return;
    const entry = this.manifest.music?.[name];
    const t = this.ctx.currentTime;
    if (this.music) { const old = this.music; old.gain.gain.setTargetAtTime(0, t, fade / 3); setTimeout(() => { try { old.src?.stop(); } catch { /* already stopped */ } }, fade * 1500); }
    this.musicName = name; this.music = null;
    if (!entry) return;
    const g = this.ctx.createGain(); g.gain.value = 0; g.connect(this.musicBus);
    const node = { gain: g, src: null };
    this.music = node;
    this._load(entry.file).then((buf) => {
      if (!buf || this.music !== node) return;
      const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = entry.loop !== false; s.connect(g); s.start();
      node.src = s;
      g.gain.setTargetAtTime(1, this.ctx.currentTime, fade / 3);
      if (!s.loop) s.onended = () => { if (this.music === node) { this.musicName = null; this.onMusicEnd?.(name); } };
    });
  }

  // One-shot effect. opts: volume, pitch (playback rate), pan (-1..1), spread (random pitch),
  // delay (seconds from now), wet (how much of the space's reverb, 0..1).
  sfx(name, opts = {}) {
    if (!this.ready || this.ctx.state !== 'running') return;
    const list = this.manifest.sfx?.[name];
    if (!list) return;
    let file = list;
    if (Array.isArray(list)) {
      let i = Math.floor(Math.random() * list.length);
      if (list.length > 1 && i === this.last.get(name)) i = (i + 1 + Math.floor(Math.random() * (list.length - 1))) % list.length;
      this.last.set(name, i); file = list[i];
    }
    const when = this.ctx.currentTime + (opts.delay ?? 0);
    this._load(file).then((buf) => {
      if (!buf) return;
      const c = this.ctx, s = c.createBufferSource(); s.buffer = buf;
      s.playbackRate.value = (opts.pitch ?? 1) * (1 + (Math.random() - 0.5) * (opts.spread ?? 0.08));
      const g = c.createGain(); g.gain.value = opts.volume ?? 1;
      if (opts.pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, opts.pan)); s.connect(p); p.connect(g); } else s.connect(g);
      g.connect(this.sfxBus);
      const wet = opts.wet ?? 0.16;
      if (wet > 0) { const w = c.createGain(); w.gain.value = wet; g.connect(w); w.connect(this.reverbSend); }
      s.start(Math.max(when, c.currentTime));
    });
  }

  // A sound that is held: starts (or keeps) playing while on is true and fades away when it
  // is not. Used for the tone of a spire being tuned.
  hold(name, on, volume = 0.4) {
    if (!this.ready) return;
    this.holds ??= {};
    const h = this.holds[name], t = this.ctx.currentTime;
    if (on && !h) {
      const list = this.manifest.sfx?.[name];
      if (!list) return;
      const g = this.ctx.createGain(); g.gain.value = 0; g.connect(this.sfxBus);
      const node = (this.holds[name] = { gain: g, src: null });
      this._load([].concat(list)[0]).then((buf) => {
        if (!buf || this.holds[name] !== node) return;
        const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = true;
        // Loop the sustained second half, so a long hold keeps its swell without a restart.
        s.loopStart = buf.duration * 0.5; s.loopEnd = buf.duration * 0.96;
        s.connect(g); s.start(); node.src = s;
        g.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.15);
      });
    } else if (!on && h) {
      h.gain.gain.setTargetAtTime(0, t, 0.12);
      const src = h.src; setTimeout(() => { try { src?.stop(); } catch { /* already stopped */ } }, 700);
      this.holds[name] = null;
    }
  }

  // Effect at a world position: quieter with distance, panned by where it is on screen.
  sfxAt(name, pos, listener, right, opts = {}) {
    const dx = pos.x - listener.x, dy = pos.y - listener.y, dz = pos.z - listener.z;
    const d = Math.hypot(dx, dy, dz);
    const vol = (opts.volume ?? 1) / (1 + (d / (opts.range ?? 9)) ** 2);
    if (vol < 0.02) return;
    // Far sounds carry more of the space with them.
    this.sfx(name, { ...opts, volume: vol, wet: Math.min(0.6, 0.16 + d * 0.012), pan: d > 0.5 ? ((dx * right.x + dz * right.z) / d) * 0.7 : 0 });
  }

  // Ambience mix. ctx: { fall: 0..1 nearness to a waterfall, lake: 0..1, mute: 0..1 inside silence }
  update(dt, ctx) {
    if (!this.ready) return;
    const A = this.manifest.amb ?? {}, t = this.ctx.currentTime;
    const want = { wind: 0.5 + 0.2 * (1 - ctx.mute), birds: 0.55 * (1 - ctx.mute) * (1 - ctx.fall * 0.5), waterfall: ctx.fall * 0.9, water_lap: ctx.lake * 0.5 };
    for (const [k, v] of Object.entries(want)) {
      if (!A[k]) continue;
      if (!this.amb[k]) { if (v < 0.01) continue; this.amb[k] = this._loop(A[k].file ?? A[k], this.ambBus, 0); }
      this.amb[k].gain.gain.setTargetAtTime(v, t, 0.6);
    }
    // Inside a silenced zone the music sinks under a low-pass, like sound through a wall.
    this.muffle += (ctx.mute - this.muffle) * Math.min(1, dt * 1.5);
    this.musicFilter.frequency.setTargetAtTime(20000 * Math.pow(0.02, this.muffle), t, 0.1);
  }
}
