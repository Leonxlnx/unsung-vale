// Input: keyboard + mouse with pointer lock, and a gamepad if one is connected.
// Game code reads actions (move vector, look delta, pressed/held buttons), never raw keys.

const DEFAULT_KEYS = {
  forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'], jump: ['Space'], dodge: ['ControlLeft', 'AltLeft', 'KeyC'],
  interact: ['KeyE'], lock: ['KeyQ', 'Tab'], walk: ['KeyX'], pulse: ['KeyF'], pause: ['Escape', 'KeyP'], photo: ['KeyH'], map: ['KeyM'], journal: ['KeyJ'], heal: ['KeyR'],
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();     // actions that went down this frame
    this.held = new Set();
    this.look = { x: 0, y: 0 };
    this.move = { x: 0, y: 0 };
    this.mouse = { attack: false, heavy: false };
    this.sensitivity = 1;
    this.invertY = false;
    this.enabled = false;
    this.usingPad = false;
    this._padPrev = [];
    this._dx = 0; this._dy = 0;
    this._down = new Set();

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      for (const [action, codes] of Object.entries(DEFAULT_KEYS)) if (codes.includes(e.code)) this._down.add(action);
      if (this.enabled && ['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ControlLeft', 'AltLeft'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (document.pointerLockElement !== canvas) { this.lockPointer(); return; }
      if (e.button === 0) this._down.add('attack');
      if (e.button === 2) this._down.add('heavy');
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== canvas) return;
      // The first report after the pointer is captured, and the odd rogue one later, can carry
      // a jump of hundreds of counts that the hand never made: those are dropped.
      if (this._skipMove > 0) { this._skipMove--; return; }
      if (Math.abs(e.movementX) > 900 || Math.abs(e.movementY) > 900) return;
      this._dx += e.movementX; this._dy += e.movementY; this.usingPad = false;
    });
    document.addEventListener('pointerlockchange', () => { this._skipMove = 2; this._dx = 0; this._dy = 0; });
    canvas.addEventListener('wheel', (e) => { this._wheel = (this._wheel ?? 0) + Math.sign(e.deltaY); }, { passive: true });
  }

  // Raw mouse counts where the browser offers them: the view then turns exactly as far as
  // the hand moves, without the operating system's pointer acceleration on top.
  lockPointer() {
    if (document.pointerLockElement === this.canvas) return;
    let p;
    try { p = this.canvas.requestPointerLock?.({ unadjustedMovement: true }); } catch { p = null; }
    if (p?.catch) p.catch(() => this.canvas.requestPointerLock?.()?.catch?.(() => {}));
    else if (!p) this.canvas.requestPointerLock?.();
  }
  unlockPointer() { if (document.pointerLockElement) document.exitPointerLock(); }
  get locked() { return document.pointerLockElement === this.canvas; }

  // Call once per frame before game logic.
  update() {
    if (this.puppet) {
      // Scripted input (the cinematic director drives the hero through this).
      const u = this.puppet;
      this.pressed = new Set(u.pressed); u.pressed.clear();
      this.held = new Set(u.held);
      this.move.x = u.move.x; this.move.y = u.move.y; this.look.x = u.look.x; this.look.y = u.look.y; this.zoom = 0;
      return;
    }
    this.pressed = this._down; this._down = new Set();
    const k = (a) => DEFAULT_KEYS[a].some((c) => this.keys.has(c));
    this.held.clear();
    for (const a of Object.keys(DEFAULT_KEYS)) if (k(a)) this.held.add(a);
    let mx = (k('right') ? 1 : 0) - (k('left') ? 1 : 0), my = (k('forward') ? 1 : 0) - (k('back') ? 1 : 0);
    const s = 0.0016 * this.sensitivity;
    let lx = this._dx * s, ly = this._dy * s * (this.invertY ? -1 : 1);
    this._dx = 0; this._dy = 0;
    this.zoom = this._wheel ?? 0; this._wheel = 0;

    const pad = navigator.getGamepads?.().find((p) => p && p.connected && p.mapping === 'standard');
    if (pad) {
      const dz = (v) => (Math.abs(v) < 0.16 ? 0 : (v - Math.sign(v) * 0.16) / 0.84);
      const ax = dz(pad.axes[0]), ay = dz(pad.axes[1]), rx = dz(pad.axes[2]), ry = dz(pad.axes[3]);
      if (ax || ay || rx || ry) this.usingPad = true;
      if (ax || ay) { mx = ax; my = -ay; }
      lx += rx * 0.045 * this.sensitivity; ly += ry * 0.032 * this.sensitivity * (this.invertY ? -1 : 1);
      const map = { 0: 'jump', 1: 'dodge', 2: 'attack', 3: 'heavy', 4: 'pulse', 5: 'attack', 7: 'heavy', 9: 'pause', 10: 'sprint', 11: 'lock', 3.5: 'interact' };
      map[14] = 'interact'; map[13] = 'interact'; map[8] = 'map'; map[15] = 'journal'; map[12] = 'heal';
      pad.buttons.forEach((b, i) => {
        const a = map[i];
        if (!a) return;
        if (b.pressed) { this.held.add(a); if (!this._padPrev[i]) { this.pressed.add(a); this.usingPad = true; } }
        this._padPrev[i] = b.pressed;
      });
      if (pad.buttons[6]?.value > 0.5) this.held.add('sprint');
    }
    if (this.sprintToggle) {
      if (this.pressed.has('sprint')) this._sprintOn = !this._sprintOn;
      if (!mx && !my) this._sprintOn = false;                 // standing still ends it
      if (this._sprintOn) this.held.add('sprint'); else this.held.delete('sprint');
    }
    const l = Math.hypot(mx, my);
    if (l > 1) { mx /= l; my /= l; }
    this.move.x = mx; this.move.y = my;
    this.look.x = lx; this.look.y = ly;
    if (!this.enabled) { this.pressed = new Set([...this.pressed].filter((a) => a === 'pause' || a === 'map' || a === 'journal')); this.move.x = this.move.y = 0; this.look.x = this.look.y = 0; this.held.clear(); }
  }
}
