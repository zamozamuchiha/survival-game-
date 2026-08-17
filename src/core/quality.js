// Graphics quality, as a few named settings rather than a slider per feature.
//
// The prototype was built and looked at on one machine and quietly assumed that
// machine's GPU. At the top setting the scene is four and a half million
// triangles, three million of which are re-drawn every frame into a 2048px
// shadow map, on a canvas rendered at twice the display's pixel count. That is
// fine on a discrete card and hopeless on integrated graphics.
//
// The knobs below are the four that actually cost something, in order:
//
//   sceneryShadows  trees and rocks casting — 2.4M triangles through the shadow
//                   pass every frame, far and away the largest single cost
//   shadowRes       the shadow map is redrawn each frame, so its area is paid
//                   for 60 times a second
//   pixelRatio      a Retina panel means four screen pixels per logical one
//   grassClusters   1.46M triangles of grass in the main pass
//
// Nothing here changes what the world contains, only how much of it is drawn —
// so switching levels never invalidates a save.

const KEY = 'lastlight.quality';

export const LEVELS = {
  low: {
    name: 'Low',
    note: 'For integrated graphics. Shadows from buildings and people only.',
    pixelRatio: 1,
    shadowRes: 1024,
    shadowExtent: 20,
    sceneryShadows: false,
    grassClusters: 9000,
    grassPatch: 40,
  },
  medium: {
    name: 'Medium',
    note: 'Everything casts, at half the shadow detail.',
    pixelRatio: 1.5,
    shadowRes: 1024,
    shadowExtent: 24,
    sceneryShadows: true,
    grassClusters: 16000,
    grassPatch: 46,
  },
  high: {
    name: 'High',
    note: 'Wants a dedicated graphics card.',
    pixelRatio: 2,
    shadowRes: 2048,
    shadowExtent: 26,
    sceneryShadows: true,
    grassClusters: 26000,
    grassPatch: 52,
  },
};

export const ORDER = ['low', 'medium', 'high'];

/**
 * Medium by default rather than high.
 *
 * A first-time player on a laptop should get something that runs, and can move
 * up if their machine has the headroom. The reverse — discovering the game is
 * unplayable and having to find a setting to fix it — is how people conclude it
 * is broken and stop.
 */
let current = 'medium';

try {
  const saved = localStorage.getItem(KEY);
  if (saved && LEVELS[saved]) current = saved;
} catch { /* private browsing, keep the default */ }

export const quality = () => LEVELS[current];
export const qualityName = () => current;

export function setQuality(name) {
  if (!LEVELS[name]) return false;
  current = name;
  try { localStorage.setItem(KEY, name); } catch { /* ignore */ }
  return true;
}

/** Steps to the next level up, wrapping back to the lowest. */
export function cycleQuality() {
  const i = ORDER.indexOf(current);
  setQuality(ORDER[(i + 1) % ORDER.length]);
  return current;
}
