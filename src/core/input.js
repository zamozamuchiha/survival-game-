const keys = new Set();
const pressed = new Set();   // drained once per frame by consumePress()
let attackHeld = false;
let attackQueued = false;

export function initInput(canvas) {
  addEventListener('keydown', (e) => {
    if (['Space', 'Tab', 'KeyE', 'KeyC', 'KeyM', 'KeyB'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    pressed.add(e.code);
    if (e.code === 'Space') { attackHeld = true; attackQueued = true; }
  });
  addEventListener('keyup', (e) => {
    keys.delete(e.code);
    if (e.code === 'Space') attackHeld = false;
  });
  addEventListener('blur', () => { keys.clear(); attackHeld = false; });

  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    attackHeld = true;
    attackQueued = true;
  });
  addEventListener('mouseup', (e) => { if (e.button === 0) attackHeld = false; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

export const input = {
  get forward() { return keys.has('KeyW') || keys.has('ArrowUp'); },
  get back()    { return keys.has('KeyS') || keys.has('ArrowDown'); },
  get left()    { return keys.has('KeyA') || keys.has('ArrowLeft'); },
  get right()   { return keys.has('KeyD') || keys.has('ArrowRight'); },
  get sprint()  { return keys.has('ShiftLeft') || keys.has('ShiftRight'); },
  get interactHeld() { return keys.has('KeyE'); },
  get attackHeld() { return attackHeld; },

  /** True once per physical key press. */
  consumePress(code) {
    if (!pressed.has(code)) return false;
    pressed.delete(code);
    return true;
  },
  consumeAttack() { const v = attackQueued; attackQueued = false; return v; },
  clearFrame() { pressed.clear(); },
  releaseAll() { keys.clear(); attackHeld = false; pressed.clear(); },
};
