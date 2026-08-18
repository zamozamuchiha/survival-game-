// station: 'hands' can be crafted anywhere; anything else needs that station
// built at home and stood next to. lvl is the character level required.
//
// Base pieces are not in here. Building spends raw resources straight out of the
// bag at the moment you place a piece — see data/building.js — so a recipe that
// turned wood into a "wall item" would only be a second, worse inventory for the
// same materials.

export const STATIONS = {
  hands:     { name: 'By Hand',  icon: '👐' },
  campfire:  { name: 'Campfire', icon: '🔥' },
  workbench: { name: 'Workbench',icon: '🛠️' },
  furnace:   { name: 'Furnace',  icon: '🏭' },
};

export const RECIPES = [
  // ---- by hand --------------------------------------------------------
  // The first two tools are deliberately cheap. Everything in the game is
  // gated behind owning them, so the opening is the one stretch where the
  // player has no way to speed themselves up — making them grind for it buys
  // nothing but the time it takes.
  { station: 'hands', lvl: 1, xp: 4,  time: 1.2, out: { id: 'axe_stone', n: 1 },  in: [{ id: 'wood', n: 5 }, { id: 'stone', n: 5 }] },
  { station: 'hands', lvl: 1, xp: 4,  time: 1.2, out: { id: 'pick_stone', n: 1 }, in: [{ id: 'wood', n: 5 }, { id: 'stone', n: 5 }] },
  { station: 'hands', lvl: 1, xp: 3,  time: 0.8, out: { id: 'spear', n: 1 },      in: [{ id: 'wood', n: 14 }, { id: 'fiber', n: 6 }] },
  { station: 'hands', lvl: 1, xp: 2,  time: 0.6, out: { id: 'rope', n: 1 },       in: [{ id: 'fiber', n: 8 }] },
  { station: 'hands', lvl: 2, xp: 3,  time: 0.8, out: { id: 'bandage', n: 2 },    in: [{ id: 'cloth', n: 3 }, { id: 'fiber', n: 4 }] },
  { station: 'hands', lvl: 2, xp: 5,  time: 1.0, out: { id: 'bag_small', n: 1 },  in: [{ id: 'cloth', n: 8 }, { id: 'rope', n: 2 }] },

  // ---- campfire -------------------------------------------------------
  { station: 'campfire', lvl: 1, xp: 3, time: 3.0, out: { id: 'cooked_meat', n: 1 }, in: [{ id: 'raw_meat', n: 1 }, { id: 'wood', n: 2 }] },
  { station: 'campfire', lvl: 1, xp: 3, time: 2.5, out: { id: 'clean_water', n: 1 }, in: [{ id: 'dirty_water', n: 1 }, { id: 'wood', n: 2 }] },
  { station: 'campfire', lvl: 3, xp: 4, time: 2.0, out: { id: 'coal', n: 2 },        in: [{ id: 'wood', n: 10 }] },
  { station: 'campfire', lvl: 4, xp: 6, time: 3.0, out: { id: 'antidote', n: 1 },    in: [{ id: 'mushroom', n: 3 }, { id: 'clean_water', n: 1 }] },

  // ---- workbench ------------------------------------------------------
  { station: 'workbench', lvl: 2, xp: 5,  time: 1.5, out: { id: 'nails', n: 8 },        in: [{ id: 'scrap', n: 4 }] },
  { station: 'workbench', lvl: 3, xp: 8,  time: 2.0, out: { id: 'bat', n: 1 },          in: [{ id: 'wood', n: 18 }, { id: 'nails', n: 12 }] },
  { station: 'workbench', lvl: 3, xp: 7,  time: 2.0, out: { id: 'crowbar', n: 1 },      in: [{ id: 'scrap', n: 14 }, { id: 'iron_bar', n: 2 }] },
  { station: 'workbench', lvl: 4, xp: 10, time: 2.5, out: { id: 'axe_iron', n: 1 },     in: [{ id: 'wood', n: 14 }, { id: 'iron_bar', n: 6 }] },
  { station: 'workbench', lvl: 4, xp: 10, time: 2.5, out: { id: 'pick_iron', n: 1 },    in: [{ id: 'wood', n: 14 }, { id: 'iron_bar', n: 7 }] },
  { station: 'workbench', lvl: 5, xp: 14, time: 3.0, out: { id: 'machete', n: 1 },      in: [{ id: 'iron_bar', n: 9 }, { id: 'leather', n: 4 }] },
  { station: 'workbench', lvl: 3, xp: 6,  time: 1.8, out: { id: 'jacket_cloth', n: 1 }, in: [{ id: 'cloth', n: 12 }, { id: 'fiber', n: 8 }] },
  { station: 'workbench', lvl: 4, xp: 9,  time: 2.2, out: { id: 'jacket_leather', n: 1 },in: [{ id: 'leather', n: 14 }, { id: 'rope', n: 3 }] },
  { station: 'workbench', lvl: 4, xp: 7,  time: 2.0, out: { id: 'helmet_scrap', n: 1 }, in: [{ id: 'scrap', n: 12 }, { id: 'cloth', n: 4 }] },
  { station: 'workbench', lvl: 3, xp: 6,  time: 1.8, out: { id: 'boots_leather', n: 1 },in: [{ id: 'leather', n: 8 }, { id: 'rope', n: 2 }] },
  { station: 'workbench', lvl: 4, xp: 8,  time: 2.0, out: { id: 'bag_med', n: 1 },      in: [{ id: 'leather', n: 12 }, { id: 'rope', n: 4 }] },
  { station: 'workbench', lvl: 6, xp: 16, time: 3.0, out: { id: 'bag_large', n: 1 },    in: [{ id: 'leather', n: 22 }, { id: 'rope', n: 8 }, { id: 'iron_bar', n: 4 }] },
  { station: 'workbench', lvl: 6, xp: 20, time: 4.0, out: { id: 'ammo_9mm', n: 12 },    in: [{ id: 'gunpowder', n: 4 }, { id: 'scrap', n: 6 }] },
  { station: 'workbench', lvl: 8, xp: 30, time: 5.0, out: { id: 'ammo_rifle', n: 8 },   in: [{ id: 'gunpowder', n: 6 }, { id: 'iron_bar', n: 3 }] },

  // ---- furnace --------------------------------------------------------
  { station: 'furnace', lvl: 5, xp: 6,  time: 3.0, out: { id: 'iron_bar', n: 1 }, in: [{ id: 'iron_ore', n: 2 }, { id: 'coal', n: 1 }] },
];

// The curve moved to data/progression.js once levels started gating building and
// land as well as recipes. Re-exported so nothing that already imports it here
// has to change.
export { XP_PER_LEVEL, levelFromXp, xpForLevel, MAX_LEVEL } from './progression.js';
