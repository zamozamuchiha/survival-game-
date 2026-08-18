import { RECIPES, STATIONS } from './recipes.js';
import { BUILDING } from './building.js';
import { ITEMS } from './items.js';
import { PLOTS } from './land.js';

// What each level opens up.
//
// The catalogue is *derived*, not typed out. A recipe already carries the level
// it needs, a building piece already carries its own, a plot already carries
// its own — writing those numbers again here would create a second truth, and
// the two would drift the first time anyone retuned one of them. So this file
// reads the existing tables and presents them under one shape:
//
//   { id, type, lvl, title, desc, icon, requires }
//
// Ids are namespaced by type, because an item and the recipe that makes it are
// different things to unlock and must not collide: `recipe:axe_stone` is not
// `item:axe_stone`.
//
// Adding new gated content means giving it a `lvl` in its own table. It appears
// here automatically.

export const UNLOCK_TYPES = ['recipe', 'building_piece', 'land_plot'];

export const recipeUnlockId = (out) => `recipe:${out}`;
export const buildUnlockId = (id) => `build:${id}`;
export const landUnlockId = (id) => `land:${id}`;

function fromRecipes() {
  return RECIPES.map((r) => {
    const item = ITEMS[r.out.id] ?? {};
    const station = STATIONS[r.station];
    return {
      id: recipeUnlockId(r.out.id),
      type: 'recipe',
      lvl: r.lvl ?? 1,
      title: item.name ?? r.out.id,
      desc: r.station === 'hands'
        ? 'Craftable by hand.'
        : `Crafted at a ${station?.name ?? r.station}.`,
      icon: item.icon ?? '🧱',
      // A recipe you cannot reach is not unlocked in any useful sense, so the
      // station it needs is a prerequisite in its own right.
      requires: r.station === 'hands' ? [] : [buildUnlockId(r.station)],
      ref: { kind: 'recipe', out: r.out.id, station: r.station },
    };
  });
}

function fromBuildings() {
  return Object.values(BUILDING).map((bp) => ({
    id: buildUnlockId(bp.item),
    type: 'building_piece',
    lvl: bp.lvl ?? 1,
    title: bp.label,
    desc: bp.hint ?? '',
    icon: bp.icon ?? '🧱',
    requires: bp.needs ? [buildUnlockId(bp.needs)] : [],
    ref: { kind: 'building', item: bp.item },
  }));
}

function fromPlots() {
  return PLOTS.filter((p) => !p.free).map((p) => ({
    id: landUnlockId(p.id),
    type: 'land_plot',
    lvl: p.lvl ?? 1,
    title: p.name,
    desc: 'Extra ground to build on. Bought with $SURV.',
    icon: '🗺️',
    requires: [],
    ref: { kind: 'land', plot: p.id },
  }));
}

export const UNLOCKS = [...fromRecipes(), ...fromBuildings(), ...fromPlots()];

const BY_ID = new Map(UNLOCKS.map((u) => [u.id, u]));
export const unlockById = (id) => BY_ID.get(id) ?? null;

/** Everything that becomes available exactly at `lvl`, for the level-up notice. */
export const unlocksAtLevel = (lvl) => UNLOCKS.filter((u) => u.lvl === lvl);

/** Everything still out of reach, cheapest first — for "coming up" lists. */
export const unlocksAbove = (lvl) =>
  UNLOCKS.filter((u) => u.lvl > lvl).sort((a, b) => a.lvl - b.lvl);
