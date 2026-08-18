import { ITEMS } from '../data/items.js';
import { RECIPES } from '../data/recipes.js';
import { state } from './state.js';
import { countItem, removeItem, addItem, canFit } from './inventory.js';
import { report } from './missions.js';
import { addXp, lockReason } from './progress.js';
import { recipeUnlockId } from '../data/unlocks.js';

export function recipesFor(station) {
  return RECIPES.filter((r) => r.station === station);
}

/**
 * Whether a recipe can be crafted right now, and why not if it can't.
 *
 * `locked` is reported separately from `ok` because the two are different
 * things to a player: missing materials is a shopping list, a locked recipe is a
 * level to reach. The menu greys them differently for that reason.
 */
export function recipeStatus(r) {
  const gate = lockReason(recipeUnlockId(r.out.id));
  if (gate) return { ok: false, locked: true, why: gate };
  for (const ing of r.in) {
    if (countItem(state.inv, ing.id) < ing.n) return { ok: false, why: 'Missing materials' };
  }
  if (!canFit(state.inv, r.out.id, r.out.n)) return { ok: false, why: 'No room in bag' };
  return { ok: true };
}

export function craft(r) {
  // Re-checked here rather than trusting the menu: this is the only place that
  // spends materials, so it is the only place that may decide a craft is legal.
  const st = recipeStatus(r);
  if (!st.ok) return st;
  for (const ing of r.in) removeItem(state.inv, ing.id, ing.n);
  addItem(state.inv, r.out.id, r.out.n);
  addXp(r.xp, 'craft');
  state.stats.crafted += r.out.n;
  report('craft', r.out.id, r.out.n);
  return { ok: true, made: `${ITEMS[r.out.id].name} ×${r.out.n}`, xp: r.xp };
}
