// Player settings: stored in localStorage and applied to the renderer and game.
const KEY = 'unsung-vale-settings-v1';

export const PRESETS = {
  low:    { renderScale: 0.55, shadows: false, volumetrics: false, reflections: false, cover: 0.55, clouds: 0, cloudRes: 1024, shadowRate: 2, softShadows: 0 },
  medium: { renderScale: 0.63, shadows: true, volumetrics: true, reflections: false, cover: 0.75, clouds: 1, cloudRes: 1024, shadowRate: 2, softShadows: 1 },
  high:   { renderScale: 0.8, shadows: true, volumetrics: true, reflections: true, cover: 1.0, clouds: 1, cloudRes: 2048, shadowRate: 1, softShadows: 2 },
  ultra:  { renderScale: 1.0, shadows: true, volumetrics: true, reflections: true, cover: 1.0, clouds: 2, cloudRes: 2048, shadowRate: 1, softShadows: 2 },
};

const DEFAULTS = { preset: 'medium', ...PRESETS.medium, targetFps: 50, fov: 60, sensitivity: 1, invertY: false, master: 0.8, music: 0.55, sfx: 0.85, showFps: false, challenge: 'standard' };

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
export function applySettings(settings, { pipe, game, cover, audio, gloss, governor = null }) {
  const v = settings.values;
  // The governor may run below the chosen render scale to hold the frame rate, never above it.
  if (governor) governor.setLimits(v.renderScale, v.targetFps ?? 0);
  else if (Math.abs(pipe.renderScale - v.renderScale) > 1e-3) pipe.setRenderScale(v.renderScale);
  pipe.shadows.enabled = v.shadows;
  pipe.shadows.rate = v.shadowRate ?? 1;
  // Soft penumbrae everywhere, only close to the camera (Medium), or not at all.
  const soft = v.softShadows ?? (v.preset === 'medium' ? 1 : v.preset === 'low' ? 0 : 2);
  pipe.shadows.soft = soft === 2 ? true : soft === 1 ? 'near' : false;
  if (pipe.volumetrics) pipe.volumetrics.enabled = v.volumetrics;
  // Settings saved before this option existed fall back to what their preset would choose.
  if (gloss) gloss.group.visible = v.reflections ?? (v.preset === 'high' || v.preset === 'ultra');
  if (cover) { cover.fade.value = cover.radius * v.cover; cover.scale = v.cover * (cover.lodBoost ?? 1); }
  pipe.sky.setCloudQuality(v.cloudRes ?? 1024, v.cloudRes > 1024 ? 56 : 44);
  // Larger panoramas get more tiles per frame so a refresh takes about as long either way.
  pipe.sky.tilesPerFrame = (v.clouds === 0 ? 0 : v.clouds === 2 ? 2 : 1) * (v.cloudRes > 1024 ? 3 : 1);
  game.rig.baseFov = v.fov;
  game.challenge = v.challenge ?? 'standard';
  game.input.sensitivity = v.sensitivity;
  game.input.invertY = v.invertY;
  audio?.setVolumes(v.master, v.music, v.sfx);
}
