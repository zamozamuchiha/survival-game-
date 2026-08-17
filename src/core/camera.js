import * as THREE from 'three';

// Where the camera sits, as a few named views rather than one hardcoded angle.
//
// The prototype was built around a single fixed overhead shot, which is a fine
// default for a survival game but hides most of the work: at sixteen metres a
// growth ring on a sawn board is three pixels. The closer views exist so the
// material actually reaches the player.
//
// The close views take the mouse: pointer lock, yaw and pitch from raw movement,
// and the character turns to match. That trades away the free cursor the build
// system aims with, so while the mouse is captured the game aims from the middle
// of the screen instead — a crosshair rather than a pointer. Overhead keeps the
// cursor, because a top-down builder without one would be worse.

const OVERHEAD_DIR = new THREE.Vector3(0, 12.5, 10.5).normalize();

export const VIEWS = {
  overhead: {
    name: 'Overhead',
    note: 'The whole camp at a glance.',
    dist: [6, 30], start: 16.3,
    hideSelf: false,
  },
  shoulder: {
    name: 'Over the shoulder',
    note: 'Close enough to read the grain on a board.',
    dist: [1.8, 6], start: 3.4,
    height: 1.62,          // roughly the character's shoulder
    aimAt: 1.35,
    hideSelf: false,
  },
  first: {
    name: 'First person',
    note: 'Eye level. You see what your character sees.',
    dist: [0, 0], start: 0,
    height: 1.58,          // eye height on a 1.6m character
    aimAt: 1.58,
    hideSelf: true,
  },
};

export const VIEW_ORDER = ['overhead', 'shoulder', 'first'];

const KEY = 'lastlight.view';
let current = 'overhead';
try {
  const saved = localStorage.getItem(KEY);
  if (saved && VIEWS[saved]) current = saved;
} catch { /* private browsing, keep the default */ }

// One zoom distance per view, so switching back finds the framing you left.
const dist = {};
for (const [k, v] of Object.entries(VIEWS)) dist[k] = v.start;

export const viewName = () => current;
export const view = () => VIEWS[current];

export function setView(name) {
  if (!VIEWS[name]) return false;
  current = name;
  try { localStorage.setItem(KEY, name); } catch { /* ignore */ }
  return true;
}

export function cycleView() {
  setView(VIEW_ORDER[(VIEW_ORDER.indexOf(current) + 1) % VIEW_ORDER.length]);
  // Overhead wants its cursor back; the close views want the mouse.
  if (current === 'overhead') releaseLook();
  return current;
}

export function zoom(step) {
  const v = VIEWS[current];
  dist[current] = THREE.MathUtils.clamp(dist[current] + step, v.dist[0], v.dist[1]);
}

// ---------------------------------------------------------------- free look

let yaw = 0;
let pitch = 0;
let locked = false;
let canvas = null;
// Right-button drag, for when pointer lock is unavailable — it is refused in
// iframes, in some embedded views, and whenever the document is not focused,
// and a look control that only works sometimes is worse than one that always
// does. Same deltas, same maths, no permission needed.
let dragging = false;
let dragDist = 0;
// Once the player has taken the view for themselves, stop easing it back behind
// the character; otherwise the two fight each other every frame.
let userLooked = false;

const SENSITIVITY = 0.0022;
// Radians per second on the arrow keys. Fast enough to spin round without
// feeling like a chore, slow enough to line a shot up.
const KEY_TURN = 2.3;
const KEY_PITCH = 1.5;
const PITCH_LIMIT = Math.PI / 2 - 0.12;   // stop just short of straight up/down

export const lookLocked = () => locked;
/** True when the mouse is captured, so callers aim from the screen centre. */
export const aimFromCentre = () => locked;
/** True when the player is steering the view, by either route. */
export const looking = () => locked || userLooked;
/** True if the last right-button press was a look-around, not a click. */
export const wasLookDrag = () => dragDist > 6;

export function initLook(domElement) {
  canvas = domElement;

  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
  });

  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 2 || current === 'overhead') return;
    dragging = true;
    dragDist = 0;
  });
  addEventListener('mouseup', () => { dragging = false; });
  addEventListener('blur', () => { dragging = false; });

  document.addEventListener('mousemove', (e) => {
    if (current === 'overhead') return;
    if (!locked && !dragging) return;
    const dx = e.movementX ?? 0;
    const dy = e.movementY ?? 0;
    if (!locked) dragDist += Math.abs(dx) + Math.abs(dy);
    userLooked = true;
    yaw -= dx * SENSITIVITY;
    pitch -= dy * SENSITIVITY;
    pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
  });
}

/** Asks for the mouse. Only works from inside a user gesture. */
export function grabLook() {
  if (locked || !canvas || current === 'overhead') return;
  // May be refused — in an iframe, without focus, or by policy. The right-button
  // drag above covers those cases, so a refusal costs nothing but a log line.
  try {
    const p = canvas.requestPointerLock?.();
    if (p && p.catch) p.catch(() => {});
  } catch { /* drag-to-look still works */ }
}

export function releaseLook() {
  if (locked) document.exitPointerLock?.();
}

/**
 * Turns the view from the arrow keys.
 *
 * The reliable route: no pointer lock to be refused, no button to hold, and it
 * works the same in every browser and every embedded frame. The mouse paths are
 * conveniences layered on top of this, not the other way round.
 */
export function turnFromKeys(dt, input) {
  if (current === 'overhead') return false;
  const turn = (input.lookLeft ? 1 : 0) - (input.lookRight ? 1 : 0);
  const tilt = (input.lookUp ? 1 : 0) - (input.lookDown ? 1 : 0);
  if (!turn && !tilt) return false;

  yaw += turn * KEY_TURN * dt;
  pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch + tilt * KEY_PITCH * dt));
  userLooked = true;
  return true;
}

/** Where the player is looking, for the body to turn towards. */
export const lookYaw = () => yaw;
const wanted = new THREE.Vector3();
const probe = new THREE.Vector3();

/**
 * Places the camera for this frame.
 *
 * @param camera   the THREE camera
 * @param player   the player entity
 * @param dt       frame time
 * @param knock    screen-shake offset
 * @param blocked  optional (from, to) => distance, to keep the close views out
 *                 of walls; returns how far along the ray is clear
 */
export function placeCamera(camera, player, dt, knock, blocked = null) {
  const v = VIEWS[current];
  const p = player.position;

  if (current === 'overhead') {
    const d = dist.overhead;
    camera.position.set(
      p.x + OVERHEAD_DIR.x * d + knock.x,
      OVERHEAD_DIR.y * d + knock.y,
      p.z + OVERHEAD_DIR.z * d + knock.z);
    camera.lookAt(p.x, 1.1, p.z);
    return;
  }

  // With the mouse captured, yaw and pitch are the player's to set. Without it,
  // the camera eases round behind whichever way the body is facing, so the view
  // still works before anyone has clicked to grab the mouse.
  if (!locked && !userLooked) {
    const delta = ((player.mesh.rotation.y - yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    yaw += delta * Math.min(1, dt * 7);
    pitch += (-0.12 - pitch) * Math.min(1, dt * 4);
  }

  const eye = p.y + v.height;
  const cp = Math.cos(pitch);
  const aheadY = Math.sin(pitch);

  if (current === 'first') {
    camera.position.set(p.x + knock.x * 0.3, eye + knock.y * 0.3, p.z + knock.z * 0.3);
    camera.lookAt(
      p.x + Math.sin(yaw) * cp * 8,
      eye + aheadY * 8,
      p.z + Math.cos(yaw) * cp * 8);
    return;
  }

  // Shoulder: behind and a little to the right, pulled in if a wall is in the way.
  let back = dist.shoulder;
  const place = (d) => wanted.set(
    p.x - Math.sin(yaw) * cp * d,
    eye + 0.35 - aheadY * d,
    p.z - Math.cos(yaw) * cp * d);

  place(back);
  if (blocked) {
    probe.set(p.x, eye, p.z);
    const clear = blocked(probe, wanted);
    if (clear < back) place(Math.max(v.dist[0] * 0.5, clear - 0.2));
  }
  camera.position.set(wanted.x + knock.x * 0.5, wanted.y + knock.y * 0.5, wanted.z + knock.z * 0.5);
  camera.lookAt(
    p.x + Math.sin(yaw) * cp * 2.5,
    p.y + v.aimAt + aheadY * 2.5,
    p.z + Math.cos(yaw) * cp * 2.5);
}

/** Snaps the swing so switching views doesn't spin the world. */
export function resetYaw(player) {
  yaw = player?.mesh?.rotation.y ?? 0;
  pitch = -0.12;
  userLooked = false;
}
