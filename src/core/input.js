const keys = new Set();
const pressed = new Set();   // drained once per frame by consumePress()
let attackHeld = false;
let attackQueued = false;

export function initInput(canvas) {
  addEventListener('keydown', (e) => {
    // Arrows scroll the page if they get through.
    if (['Space', 'Tab', 'KeyE', 'KeyC', 'KeyM', 'KeyB',
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
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
  /**
   * Whether the arrows drive movement or the camera.
   *
   * Set by the game from the current view: overhead has no camera to turn, so
   * there they stay a second set of movement keys; the close views take them for
   * looking. Kept as a flag rather than an import so input knows nothing about
   * cameras.
   */
  arrowsMove: true,

  get forward() { return keys.has('KeyW') || (this.arrowsMove && keys.has('ArrowUp')); },
  get back()    { return keys.has('KeyS') || (this.arrowsMove && keys.has('ArrowDown')); },
  get left()    { return keys.has('KeyA') || (this.arrowsMove && keys.has('ArrowLeft')); },
  get right()   { return keys.has('KeyD') || (this.arrowsMove && keys.has('ArrowRight')); },
  get sprint()  { return keys.has('ShiftLeft') || keys.has('ShiftRight'); },

  // Looking, on the arrows. Reported separately from movement so the close
  // views can turn the camera with them while the overhead view, which has no
  // camera to turn, keeps treating them as a second set of movement keys.
  get lookLeft()  { return !this.arrowsMove && keys.has('ArrowLeft'); },
  get lookRight() { return !this.arrowsMove && keys.has('ArrowRight'); },
  get lookUp()    { return !this.arrowsMove && keys.has('ArrowUp'); },
  get lookDown()  { return !this.arrowsMove && keys.has('ArrowDown'); },
  get interactHeld() { return keys.has('KeyE'); },

  /**
   * Sustained jog, toggled rather than held.
   *
   * Crossing the map at walking pace with a finger pinned to Shift is a chore,
   * and Shift-sprint is meant to be a burst you spend stamina on, not the way
   * you get anywhere. Set by the game when the toggle key is pressed.
   */
  jog: false,
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
