// Input: keyboard + mouse with pointer lock, and a gamepad if one is connected.
// Game code reads actions (move vector, look delta, pressed/held buttons), never raw keys.

const DEFAULT_KEYS = {
  forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'], jump: ['Space'], dodge: ['ControlLeft', 'AltLeft', 'KeyC'],
  interact: ['KeyE'], lock: ['KeyQ', 'Tab'], pulse: ['KeyF'], pause: ['Escape', 'KeyP'], photo: ['KeyH'],
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
      if (document.pointerLockElement === canvas) { this._dx += e.movementX; this._dy += e.movementY; this.usingPad = false; }
    });
    canvas.addEventListener('wheel', (e) => { this._wheel = (this._wheel ?? 0) + Math.sign(e.deltaY); }, { passive: true });
  }

  lockPointer() { this.canvas.requestPointerLock?.()?.catch?.(() => {}); }
  unlockPointer() { if (document.pointerLockElement) document.exitPointerLock(); }
  get locked() { return document.pointerLockElement === this.canvas; }

  // Call once per frame before game logic.
  update() {
    this.pressed = this._down; this._down = new Set();
    const k = (a) => DEFAULT_KEYS[a].some((c) => this.keys.has(c));
    this.held.clear();
    for (const a of Object.keys(DEFAULT_KEYS)) if (k(a)) this.held.add(a);
    let mx = (k('right') ? 1 : 0) - (k('left') ? 1 : 0), my = (k('forward') ? 1 : 0) - (k('back') ? 1 : 0);
    const s = 0.0023 * this.sensitivity;
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
      const map = { 0: 'jump', 1: 'dodge', 2: 'attack', 3: 'heavy', 4: 'pulse', 5: 'attack', 7: 'heavy', 9: 'pause', 10: 'sprint', 11: 'lock', 12: 'photo', 3.5: 'interact' };
      map[14] = 'interact'; map[13] = 'interact';
      pad.buttons.forEach((b, i) => {
        const a = map[i];
        if (!a) return;
        if (b.pressed) { this.held.add(a); if (!this._padPrev[i]) { this.pressed.add(a); this.usingPad = true; } }
        this._padPrev[i] = b.pressed;
      });
      if (pad.buttons[6]?.value > 0.5) this.held.add('sprint');
    }
    const l = Math.hypot(mx, my);
    if (l > 1) { mx /= l; my /= l; }
    this.move.x = mx; this.move.y = my;
    this.look.x = lx; this.look.y = ly;
    if (!this.enabled) { this.pressed = new Set([...this.pressed].filter((a) => a === 'pause')); this.move.x = this.move.y = 0; this.look.x = this.look.y = 0; this.held.clear(); }
  }
}
