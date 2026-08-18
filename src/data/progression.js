// The experience curve, and nothing else.
//
// It lived in data/recipes.js because recipes were the first thing that awarded
// experience. Levels now gate building pieces and land as well, so the curve
// belongs somewhere none of those has to import a sibling to reach. recipes.js
// re-exports it, so older call sites keep working.

/**
 * Experience needed to get from `lvl` to `lvl + 1`.
 *
 * Slightly superlinear: each level costs more than the last, but not so much
 * more that the tenth is out of reach. Tune here and the whole game moves —
 * nothing else knows the shape of the curve.
 */
export const XP_PER_LEVEL = (lvl) => Math.round(45 * Math.pow(lvl, 1.45));

export const MAX_LEVEL = 20;

/** @returns { lvl, into, need } — level, experience into it, experience it takes. */
export function levelFromXp(xp) {
  let lvl = 1;
  let spent = 0;
  while (lvl < MAX_LEVEL && spent + XP_PER_LEVEL(lvl) <= xp) {
    spent += XP_PER_LEVEL(lvl);
    lvl++;
  }
  return { lvl, into: xp - spent, need: XP_PER_LEVEL(lvl) };
}

/** Total experience required to reach `lvl` from nothing. */
export function xpForLevel(lvl) {
  let total = 0;
  for (let i = 1; i < lvl; i++) total += XP_PER_LEVEL(i);
  return total;
}
