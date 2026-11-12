// Player settings: stored in localStorage and applied to the renderer and game.
const KEY = 'unsung-vale-settings-v1';

export const PRESETS = {
  low:    { renderScale: 0.55, shadows: false, volumetrics: false, cover: 0.55, clouds: 0, cloudRes: 1024 },
  medium: { renderScale: 0.67, shadows: true, volumetrics: true, cover: 0.75, clouds: 1, cloudRes: 1024 },
  high:   { renderScale: 0.8, shadows: true, volumetrics: true, cover: 1.0, clouds: 1, cloudRes: 2048 },
  ultra:  { renderScale: 1.0, shadows: true, volumetrics: true, cover: 1.0, clouds: 2, cloudRes: 2048 },
};

const DEFAULTS = { preset: 'medium', ...PRESETS.medium, fov: 60, sensitivity: 1, invertY: false, master: 0.8, music: 0.55, sfx: 0.85, showFps: false };

export class Settings {
  constructor(renderer) {
    this.values = { ...DEFAULTS };
    // Discrete GPUs start one notch higher than integrated ones.
    try {
      const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
      const integrated = /Intel|UHD|Iris|Radeon\(TM\) Graphics|780M|760M|680M|Vega|Apple M1\b/i.test(name);
      if (!integrated && name) Object.assign(this.values, { preset: 'high', ...PRESETS.high });
      this.gpu = name;
    } catch { /* keep defaults */ }
    try { Object.assign(this.values, JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { /* ignore */ }
    this.listeners = [];
  }
  get(k) { return this.values[k]; }
  set(k, v) {
    this.values[k] = v;
    if (k === 'preset' && PRESETS[v]) Object.assign(this.values, PRESETS[v]);
    else if (k in PRESETS.low) this.values.preset = 'custom';
    try { localStorage.setItem(KEY, JSON.stringify(this.values)); } catch { /* ignore */ }
    for (const fn of this.listeners) fn(k, v);
  }
  onChange(fn) { this.listeners.push(fn); }
}

// Pushes the current values into the engine. Cheap to call again after any change.
export function applySettings(settings, { pipe, game, cover, audio }) {
  const v = settings.values;
  if (Math.abs(pipe.renderScale - v.renderScale) > 1e-3) pipe.setRenderScale(v.renderScale);
  pipe.shadows.enabled = v.shadows;
  if (pipe.volumetrics) pipe.volumetrics.enabled = v.volumetrics;
  if (cover) { cover.fade.value = cover.radius * v.cover; cover.scale = v.cover; }
  pipe.sky.setCloudQuality(v.cloudRes ?? 1024, v.cloudRes > 1024 ? 56 : 44);
  // Larger panoramas get more tiles per frame so a refresh takes about as long either way.
  pipe.sky.tilesPerFrame = (v.clouds === 0 ? 0 : v.clouds === 2 ? 2 : 1) * (v.cloudRes > 1024 ? 3 : 1);
  game.rig.baseFov = v.fov;
  game.input.sensitivity = v.sensitivity;
  game.input.invertY = v.invertY;
  audio?.setVolumes(v.master, v.music, v.sfx);
}
