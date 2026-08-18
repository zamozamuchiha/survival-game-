// Base blueprints are deliberately separate from inventory items. A blueprint
// describes where a thing can be placed and what it consumes; the renderer and
// save format only need the resulting item id. Adding stone or metal tiers later
// is therefore a data entry, not a special case in the building controller.
//
// Fields
//   layer      foundation | floor | wall | roof | object — which slot on a cell
//              it fills, and the whole of what the placement rules need to know
//   cost       taken from the bag when it goes up; half of it comes back down
//   models     generated model keys; one is picked per cell so a row of walls
//              isn't the same board pattern repeated
//   hp         how much punishment it takes
//   solid      collider radius, or false to walk through
//   clears     radius of grass it pushes aside, in metres
//   station    crafting station it provides when stood next to
//   capacity   storage slots
//   needs      station you must be standing at to build it
//   lvl        character level required

// ---- grid and heights, in metres -------------------------------------------

export const CELL = 2.0;         // one cell, and the length of one wall
export const WALL_H = 2.4;       // ground to wall top
export const FOUND_TOP = 0.10;   // top of a bare foundation
export const DECK_TOP = 0.18;    // walkable surface of a laid floor
export const PLOT = 9;           // cells from camp centre you may build within

// How much ground the camp is generated free of trees and boulders. Much smaller
// than the plot on purpose: the buildable area is deliberately larger than the
// world will hand you clear, so expanding the base means clearing the ground for
// it first. Placement refuses to drop a piece on a standing tree, and felling it
// is the way through.
export const CAMP_CLEAR_HALF = 3 * CELL + CELL / 2;

// Which socket each layer occupies on a cell. A cell can carry one of each, so a
// square holds a foundation, a floor, four walls, a roof and a crate at once.
// Heights are measured from the ground, not from the piece below: a wall starts
// at y = 0 and runs up past the floor's edge, which is what puts earth, then
// frame, then boards in view from a low angle. Objects are the exception — they
// always require a floor, so they stand on its deck rather than in it.
export const LAYERS = {
  foundation: { socket: 'cell', y: 0 },
  floor:      { socket: 'cell', y: 0 },
  wall:       { socket: 'edge', y: 0 },
  roof:       { socket: 'cell', y: WALL_H },
  object:     { socket: 'cell', y: DECK_TOP },
};

export const BUILDING = {
  foundation_wood: {
    item: 'foundation_wood', label: 'Timber foundation', icon: '🪨', layer: 'foundation',
    cost: { wood: 8, stone: 6 }, hint: 'Sets a solid base for a floor.',
    models: ['found_a', 'found_b'], hp: 600, clears: 1.0,
  },
  floor_wood: {
    item: 'floor_wood', label: 'Wood floor', icon: '🟧', layer: 'floor',
    cost: { wood: 6 }, hint: 'Requires a foundation.',
    models: ['plank_floor_a', 'plank_floor_b', 'plank_floor_c'], hp: 250, clears: 1.0,
  },
  wall_wood: {
    item: 'wall_wood', label: 'Wood wall', icon: '🪵', layer: 'wall',
    // Walls are bought by the dozen — a 3x3 deck needs twelve to close it — so
    // they are priced per panel, near the floor they stand on, rather than as a
    // single big-ticket piece. Fence 5 < floor 6 < wall 7 < foundation 8 < door 12.
    cost: { wood: 7, stone: 1 }, hint: 'Requires a floor.',
    models: ['plank_wall_a', 'plank_wall_b', 'plank_wall_c'],
    hp: 350, solid: 0.12, clears: 0.45,
  },
  door_wood: {
    item: 'door_wood', label: 'Wood door', icon: '🚪', layer: 'wall',
    cost: { wood: 12, stone: 2 }, hint: 'Requires a floor.',
    models: ['plank_door_a', 'plank_door_b'],
    hp: 250, solid: false, door: true, clears: 0.45,
  },
  roof_wood: {
    item: 'roof_wood', label: 'Wood roof', icon: '🏠', layer: 'roof',
    cost: { wood: 12, fiber: 4 }, hint: 'Requires a wall or door.',
    models: ['roof_a', 'roof_b'], hp: 200,
  },
  box_storage: {
    item: 'box_storage', label: 'Storage box', icon: '📦', layer: 'object',
    cost: { wood: 10 }, hint: 'Requires a floor.',
    models: ['crate_a', 'crate_b'], hp: 150, solid: 0.5, clears: 0.7, capacity: 24,
  },
  workbench: {
    item: 'workbench', label: 'Workbench', icon: '🛠️', layer: 'object',
    cost: { wood: 18, stone: 8 }, hint: 'Requires a floor.',
    models: ['bench_a', 'bench_b'], hp: 250, solid: 0.62, clears: 0.9,
    station: 'workbench',
  },

  // ---- later tiers ----------------------------------------------------
  // Nothing below is special-cased anywhere: each is the same shape of entry as
  // the ones above, which is the point of keeping the table the only authority.
  campfire: {
    item: 'campfire', label: 'Campfire', icon: '🔥', layer: 'object',
    cost: { wood: 12, stone: 8 }, hint: 'Cooks meat and boils water.',
    models: ['firepit_a', 'firepit_b'], hp: 80, solid: 0.45, clears: 0.8,
    station: 'campfire',
  },
  fence_wood: {
    item: 'fence_wood', label: 'Wood fence', icon: '🚧', layer: 'wall',
    cost: { wood: 5 }, hint: 'Stands on open ground.',
    models: ['fence_a', 'fence_b'], hp: 150, solid: 0.1, clears: 0.35,
    freestanding: true,
  },
  wall_stone: {
    item: 'wall_stone', label: 'Stone wall', icon: '🧱', layer: 'wall',
    cost: { stone: 24, wood: 4 }, hint: 'Requires a floor and a workbench.',
    models: ['stonewall_a', 'stonewall_b'], hp: 900, solid: 0.16, clears: 0.5,
    needs: 'workbench', lvl: 4,
  },
  furnace: {
    item: 'furnace', label: 'Furnace', icon: '🏭', layer: 'object',
    cost: { stone: 30, scrap: 8 }, hint: 'Smelts ore. Requires a workbench.',
    models: ['furnace_a'], hp: 400, solid: 0.65, clears: 0.9,
    station: 'furnace', needs: 'workbench', lvl: 5,
  },
};

export const BLUEPRINT_IDS = Object.keys(BUILDING);
export const blueprint = (id) => BUILDING[id] ?? null;

export function costText(cost) {
  return Object.entries(cost).map(([id, n]) => `${n} ${id}`).join(' · ');
}

/** Which socket kind a blueprint fills. */
export const socketOf = (bp) => LAYERS[bp.layer].socket;

/** Half of what it cost, rounded down — taking a thing apart loses you something. */
export function refundFor(id) {
  const bp = BUILDING[id];
  if (!bp) return [];
  return Object.entries(bp.cost)
    .map(([res, n]) => ({ id: res, n: Math.floor(n / 2) }))
    .filter((c) => c.n > 0);
}

// The build menu's tabs. Layer order is also build order, which is the order a
// first-time player needs to discover the pieces in.
export const BUILD_TABS = [
  { id: 'structure', name: 'Structure', layers: ['foundation', 'floor', 'wall', 'roof'] },
  { id: 'station',   name: 'Stations',  layers: ['object'] },
];

export const blueprintsIn = (tab) =>
  BLUEPRINT_IDS.filter((id) => tab.layers.includes(BUILDING[id].layer));
