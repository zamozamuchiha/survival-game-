// Weighted loot tables. Each roll picks one entry; `n` is the count range.
// Containers roll `rolls` times, so a red-zone crate can pay out several times.

const T = (id, weight, min = 1, max = 1) => ({ id, weight, min, max });

export const LOOT_TABLES = {
  green: {
    rolls: [1, 2],
    table: [
      T('fiber', 20, 3, 8), T('wood', 18, 4, 10), T('stone', 14, 3, 7),
      T('cloth', 12, 1, 3), T('berries', 12, 1, 4), T('mushroom', 8, 1, 3),
      T('dirty_water', 8, 1, 2), T('scrap', 6, 1, 3), T('bandage', 4, 1, 1),
      T('seeds', 4, 1, 2), T('leather', 3, 1, 2),
    ],
  },
  yellow: {
    rolls: [2, 3],
    table: [
      T('scrap', 18, 3, 8), T('cloth', 14, 2, 6), T('leather', 12, 2, 5),
      T('canned_food', 10, 1, 2), T('nails', 9, 3, 9), T('dirty_water', 8, 1, 3),
      T('iron_ore', 8, 2, 5), T('bandage', 7, 1, 3), T('coal', 6, 1, 4),
      T('first_aid', 4, 1, 1), T('ammo_9mm', 4, 4, 10), T('rope', 4, 1, 2),
      T('hat_cloth', 2, 1, 1), T('boots_cloth', 2, 1, 1),
    ],
  },
  red: {
    rolls: [2, 4],
    table: [
      T('scrap', 14, 5, 12), T('iron_ore', 12, 3, 8), T('iron_bar', 10, 1, 4),
      T('gunpowder', 9, 2, 6), T('ammo_9mm', 9, 8, 20), T('canned_food', 8, 1, 3),
      T('first_aid', 7, 1, 2), T('leather', 7, 3, 7), T('coal', 6, 2, 6),
      T('ammo_rifle', 5, 3, 8), T('clean_water', 5, 1, 2), T('antidote', 4, 1, 2),
      T('helmet_scrap', 2, 1, 1), T('pistol', 2, 1, 1), T('keycard', 2, 1, 1),
    ],
  },
  bunker: {
    rolls: [3, 5],
    table: [
      T('iron_bar', 14, 3, 8), T('gunpowder', 12, 4, 10), T('ammo_rifle', 11, 6, 14),
      T('ammo_9mm', 10, 12, 30), T('first_aid', 9, 1, 3), T('scrap', 9, 8, 18),
      T('canned_food', 8, 2, 4), T('clean_water', 7, 1, 3), T('antidote', 6, 1, 3),
      T('jacket_leather', 4, 1, 1), T('pistol', 3, 1, 1), T('rifle', 2, 1, 1),
      T('bag_large', 2, 1, 1), T('keycard', 3, 1, 2),
    ],
  },
};

// What a corpse leaves behind, by zombie type.
export const ZOMBIE_DROPS = {
  walker: [T('cloth', 30, 1, 2), T('leather', 18, 1, 2), T('raw_meat', 14, 1, 1), T('scrap', 10, 1, 2)],
  runner: [T('cloth', 26, 1, 3), T('leather', 22, 1, 3), T('raw_meat', 16, 1, 2), T('bandage', 6, 1, 1)],
  dog:    [T('raw_meat', 44, 1, 3), T('leather', 30, 1, 2)],
  toxic:  [T('antidote', 16, 1, 1), T('cloth', 24, 1, 3), T('gunpowder', 12, 1, 3), T('scrap', 18, 1, 3)],
  brute:  [T('leather', 30, 3, 6), T('raw_meat', 24, 2, 4), T('iron_ore', 18, 2, 5), T('first_aid', 10, 1, 1)],
};

export function rollTable(table, rng) {
  const total = table.reduce((s, e) => s + e.weight, 0);
  let r = rng() * total;
  for (const e of table) {
    r -= e.weight;
    if (r <= 0) return { id: e.id, n: rng.int(e.min, e.max) };
  }
  return null;
}

export function rollContainer(tableId, rng) {
  const def = LOOT_TABLES[tableId];
  if (!def) return [];
  const rolls = rng.int(def.rolls[0], def.rolls[1]);
  const out = [];
  for (let i = 0; i < rolls; i++) {
    const r = rollTable(def.table, rng);
    if (r) out.push(r);
  }
  return out;
}

export function rollDrops(type, rng) {
  const t = ZOMBIE_DROPS[type];
  if (!t) return [];
  // Not every corpse pays out.
  if (rng() < 0.35) return [];
  const r = rollTable(t, rng);
  return r ? [r] : [];
}
