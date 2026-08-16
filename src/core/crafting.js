import { ITEMS } from '../data/items.js';
import { RECIPES } from '../data/recipes.js';
import { state, level } from './state.js';
import { countItem, removeItem, addItem, canFit } from './inventory.js';

export function recipesFor(station) {
  return RECIPES.filter((r) => r.station === station);
}

export function recipeStatus(r) {
  const lv = level().lvl;
  if (lv < r.lvl) return { ok: false, why: `Requires level ${r.lvl}` };
  for (const ing of r.in) {
    if (countItem(state.inv, ing.id) < ing.n) return { ok: false, why: 'Missing materials' };
  }
  if (!canFit(state.inv, r.out.id, r.out.n)) return { ok: false, why: 'No room in bag' };
  return { ok: true };
}

export function craft(r) {
  const st = recipeStatus(r);
  if (!st.ok) return st;
  for (const ing of r.in) removeItem(state.inv, ing.id, ing.n);
  addItem(state.inv, r.out.id, r.out.n);
  state.xp += r.xp;
  state.stats.crafted += r.out.n;
  return { ok: true, made: `${ITEMS[r.out.id].name} ×${r.out.n}`, xp: r.xp };
}
