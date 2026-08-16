// Every item in the game. Systems read these fields; nothing is hardcoded elsewhere.
//
//   cat      resource | food | med | tool | weapon | ammo | armor | build | misc
//   stack    max per inventory slot
//   weight   kg per unit
//   tool     which harvest verb it boosts: chop | mine | salvage
//   dmg      damage per hit (weapons and tools both fight)
//   speed    seconds between swings
//   reach    metres
//   dur      max durability; each use costs 1 point
//   armor    fraction of incoming damage absorbed
//   slot     head | body | feet | back  (armor/backpack only)

export const ITEMS = {
  // ---- raw resources --------------------------------------------------
  wood:      { name: 'Wood',        icon: '🪵', cat: 'resource', stack: 100, weight: 0.4 },
  stone:     { name: 'Stone',       icon: '🪨', cat: 'resource', stack: 100, weight: 0.6 },
  scrap:     { name: 'Scrap Metal', icon: '⚙️', cat: 'resource', stack: 100, weight: 0.5 },
  fiber:     { name: 'Plant Fiber', icon: '🌾', cat: 'resource', stack: 100, weight: 0.1 },
  leather:   { name: 'Leather',     icon: '🟫', cat: 'resource', stack: 50,  weight: 0.3 },
  iron_ore:  { name: 'Iron Ore',    icon: '🔶', cat: 'resource', stack: 50,  weight: 1.0 },
  iron_bar:  { name: 'Iron Bar',    icon: '🔩', cat: 'resource', stack: 50,  weight: 0.9 },
  coal:      { name: 'Coal',        icon: '⚫', cat: 'resource', stack: 50,  weight: 0.4 },
  rope:      { name: 'Rope',        icon: '🪢', cat: 'resource', stack: 30,  weight: 0.2 },
  cloth:     { name: 'Cloth',       icon: '🧵', cat: 'resource', stack: 50,  weight: 0.15 },
  nails:     { name: 'Nails',       icon: '📌', cat: 'resource', stack: 100, weight: 0.05 },
  gunpowder: { name: 'Gunpowder',   icon: '💥', cat: 'resource', stack: 50,  weight: 0.1 },
  seeds:     { name: 'Seeds',       icon: '🌱', cat: 'resource', stack: 30,  weight: 0.05 },

  // ---- consumables ----------------------------------------------------
  berries:      { name: 'Berries',      icon: '🫐', cat: 'food', stack: 20, weight: 0.1, food: 10, water: 6, use: 1.0 },
  mushroom:     { name: 'Mushroom',     icon: '🍄', cat: 'food', stack: 20, weight: 0.1, food: 8, hp: -4, use: 1.0 },
  raw_meat:     { name: 'Raw Meat',     icon: '🥩', cat: 'food', stack: 10, weight: 0.5, food: 14, hp: -10, use: 1.5 },
  cooked_meat:  { name: 'Cooked Meat',  icon: '🍖', cat: 'food', stack: 10, weight: 0.4, food: 38, hp: 6, use: 1.5 },
  canned_food:  { name: 'Canned Food',  icon: '🥫', cat: 'food', stack: 10, weight: 0.6, food: 30, use: 1.5 },
  carrot:       { name: 'Carrot',       icon: '🥕', cat: 'food', stack: 20, weight: 0.2, food: 16, water: 8, use: 1.0 },
  dirty_water:  { name: 'Dirty Water',  icon: '🧴', cat: 'food', stack: 10, weight: 1.0, water: 22, hp: -8, use: 1.2 },
  clean_water:  { name: 'Clean Water',  icon: '💧', cat: 'food', stack: 10, weight: 1.0, water: 42, use: 1.2 },

  bandage:   { name: 'Bandage',   icon: '🩹', cat: 'med', stack: 10, weight: 0.1, hp: 25, use: 2.0 },
  first_aid: { name: 'First Aid', icon: '🧰', cat: 'med', stack: 5,  weight: 0.5, hp: 65, cure: true, use: 3.0 },
  antidote:  { name: 'Antidote',  icon: '💊', cat: 'med', stack: 10, weight: 0.1, cure: true, use: 1.5 },

  // ---- tools ----------------------------------------------------------
  axe_stone:     { name: 'Stone Axe',     icon: '🪓', cat: 'tool', stack: 1, weight: 2.0, tool: 'chop', power: 1,    dmg: 14, speed: 0.55, reach: 2.8, dur: 120 },
  axe_iron:      { name: 'Iron Axe',      icon: '🪓', cat: 'tool', stack: 1, weight: 2.6, tool: 'chop', power: 2,    dmg: 26, speed: 0.50, reach: 3.0, dur: 320 },
  pick_stone:    { name: 'Stone Pickaxe', icon: '⛏️', cat: 'tool', stack: 1, weight: 2.2, tool: 'mine', power: 1,    dmg: 12, speed: 0.60, reach: 2.8, dur: 140 },
  pick_iron:     { name: 'Iron Pickaxe',  icon: '⛏️', cat: 'tool', stack: 1, weight: 2.8, tool: 'mine', power: 2,    dmg: 22, speed: 0.55, reach: 3.0, dur: 360 },
  crowbar:       { name: 'Crowbar',       icon: '🔧', cat: 'tool', stack: 1, weight: 2.4, tool: 'salvage', power: 1, dmg: 20, speed: 0.60, reach: 2.8, dur: 260 },

  // ---- weapons --------------------------------------------------------
  spear:    { name: 'Spear',      icon: '🔱', cat: 'weapon', stack: 1, weight: 1.8, dmg: 22, speed: 0.70, reach: 3.6, dur: 150 },
  bat:      { name: 'Nailed Bat', icon: '🏏', cat: 'weapon', stack: 1, weight: 2.2, dmg: 30, speed: 0.60, reach: 2.9, dur: 220 },
  machete:  { name: 'Machete',    icon: '🗡️', cat: 'weapon', stack: 1, weight: 1.6, dmg: 38, speed: 0.45, reach: 2.9, dur: 300 },
  pistol:   { name: 'Pistol',     icon: '🔫', cat: 'weapon', stack: 1, weight: 1.2, dmg: 44, speed: 0.42, dur: 220, ranged: true, ammo: 'ammo_9mm', spread: 0.055, maxRange: 34 },
  rifle:    { name: 'Hunting Rifle', icon: '🎯', cat: 'weapon', stack: 1, weight: 3.4, dmg: 92, speed: 1.15, dur: 260, ranged: true, ammo: 'ammo_rifle', spread: 0.018, maxRange: 60 },

  ammo_9mm:   { name: '9mm Rounds',   icon: '🔸', cat: 'ammo', stack: 120, weight: 0.02 },
  ammo_rifle: { name: 'Rifle Rounds', icon: '🔹', cat: 'ammo', stack: 60,  weight: 0.04 },

  // ---- armor ----------------------------------------------------------
  hat_cloth:     { name: 'Cloth Hood',     icon: '🧢', cat: 'armor', stack: 1, weight: 0.4, slot: 'head', armor: 0.06, dur: 120 },
  helmet_scrap:  { name: 'Scrap Helmet',   icon: '⛑️', cat: 'armor', stack: 1, weight: 1.6, slot: 'head', armor: 0.14, dur: 260 },
  jacket_cloth:  { name: 'Padded Jacket',  icon: '🧥', cat: 'armor', stack: 1, weight: 1.2, slot: 'body', armor: 0.10, dur: 180 },
  jacket_leather:{ name: 'Leather Jacket', icon: '🧥', cat: 'armor', stack: 1, weight: 2.0, slot: 'body', armor: 0.22, dur: 340 },
  boots_cloth:   { name: 'Wrapped Boots',  icon: '👢', cat: 'armor', stack: 1, weight: 0.6, slot: 'feet', armor: 0.05, dur: 140 },
  boots_leather: { name: 'Leather Boots',  icon: '🥾', cat: 'armor', stack: 1, weight: 1.1, slot: 'feet', armor: 0.12, dur: 280 },

  bag_small: { name: 'Small Bag',     icon: '👜', cat: 'armor', stack: 1, weight: 0.5, slot: 'back', slots: 16, carry: 42 },
  bag_med:   { name: 'Backpack',      icon: '🎒', cat: 'armor', stack: 1, weight: 1.2, slot: 'back', slots: 24, carry: 68 },
  bag_large: { name: 'Trekking Pack', icon: '🎒', cat: 'armor', stack: 1, weight: 2.0, slot: 'back', slots: 32, carry: 95 },

  // ---- buildables (placed on the home grid) ---------------------------
  floor_wood:  { name: 'Wooden Floor',   icon: '🟧', cat: 'build', stack: 50, weight: 1.0, build: 'floor',   hp: 120 },
  wall_wood:   { name: 'Wooden Wall',    icon: '🚧', cat: 'build', stack: 50, weight: 1.5, build: 'wall',    hp: 200 },
  wall_stone:  { name: 'Stone Wall',     icon: '🧱', cat: 'build', stack: 50, weight: 3.0, build: 'wall',    hp: 520 },
  door_wood:   { name: 'Wooden Door',    icon: '🚪', cat: 'build', stack: 10, weight: 2.0, build: 'door',    hp: 160 },
  box_storage: { name: 'Storage Box',    icon: '📦', cat: 'build', stack: 10, weight: 4.0, build: 'storage', hp: 100, capacity: 24 },
  campfire:    { name: 'Campfire',       icon: '🔥', cat: 'build', stack: 5,  weight: 3.0, build: 'station', station: 'campfire' },
  workbench:   { name: 'Workbench',      icon: '🛠️', cat: 'build', stack: 5,  weight: 8.0, build: 'station', station: 'workbench' },
  furnace:     { name: 'Melting Furnace',icon: '🏭', cat: 'build', stack: 5,  weight: 12.0, build: 'station', station: 'furnace' },
  garden_bed:  { name: 'Garden Bed',     icon: '🪴', cat: 'build', stack: 10, weight: 5.0, build: 'garden' },

  // ---- keys / quest ---------------------------------------------------
  keycard: { name: 'Bunker Keycard', icon: '🎫', cat: 'misc', stack: 5, weight: 0.05 },
};

export const FISTS = { name: 'Fists', icon: '👊', dmg: 7, speed: 0.5, reach: 2.3 };

export const item = (id) => ITEMS[id];
export const isStackable = (id) => (ITEMS[id]?.stack ?? 1) > 1;
