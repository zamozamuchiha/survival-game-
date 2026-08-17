// The world map. You never walk between these — you travel from the map screen,
// which costs energy and starts a countdown you have to beat.

export const LOCATIONS = [
  {
    // The starting map. No countdown, everything you need for the first hour:
    // wood, stone and fibre to build with, a couple of crates to find, and only
    // a handful of slow walkers so a fresh player can learn to fight.
    // safe: nothing spawns here, nothing decays here, and you heal up while you
    // stand around building. Camp is where you plan the next run, not somewhere
    // you can quietly starve to death with your back turned.
    id: 'home', name: 'Home Camp', tier: 0, energy: 0, timer: 0, radius: 34, safe: true,
    desc: 'Your plot. No time limit. Chop wood, mine stone, build your base.',
    biome: { skyTop: 0x7fa8cc, skyHorizon: 0xc9d6cc, trees: 'tree_field', ground: 0x6d7a52, patch: [0x76825a, 0x7d6f4e, 0x64714b], tree: 0x35482e, fog: 0x27313a, sky: 0x27313a },
    decor: { tree: 68, bush: 50, rock: 26 },
    nodes: { tree: 16, bush: 10, rock: 12, wreck: 1 }, containers: 2,
    // Enough loose material lying around to get a stone axe and a pickaxe made
    // without owning a tool first — that's the whole point of the starting map.
    pickups: { branches: 18, stones: 15 },
    zombies: {}, loot: 'green',
  },
  {
    id: 'pine', name: 'Pine Bushes', tier: 1, energy: 6, timer: 300, radius: 44,
    desc: 'Quiet woodland. Wood, fibre and the odd stray walker.',
    biome: { skyTop: 0x6f97bd, skyHorizon: 0xbccbc0, trees: 'tree_forest', ground: 0x63784a, patch: [0x6f8352, 0x776a48, 0x5a6c42], tree: 0x2f4429, fog: 0x2a3630, sky: 0x2a3630 },
    decor: { tree: 210, bush: 105, rock: 40 },
    nodes: { tree: 30, bush: 14, rock: 8, wreck: 2 }, containers: 3,
    pickups: { branches: 14, stones: 10 },
    zombies: { walker: 5 }, loot: 'green',
  },
  {
    id: 'meadow', name: 'Ravaged Meadow', tier: 1, energy: 7, timer: 300, radius: 44,
    desc: 'Open ground. Easy stone, nowhere to hide.',
    biome: { skyTop: 0x86aecd, skyHorizon: 0xd6d6bd, trees: 'tree_field', ground: 0x7d8054, patch: [0x8a8b5c, 0x86754e, 0x6f7448], tree: 0x3d4a2c, fog: 0x333829, sky: 0x333829 },
    decor: { tree: 78, bush: 85, rock: 70 },
    nodes: { tree: 10, bush: 10, rock: 22, wreck: 4 }, containers: 4,
    pickups: { branches: 8, stones: 16 },
    zombies: { walker: 6, dog: 2 }, loot: 'green',
  },
  {
    id: 'village', name: 'Ravaged Villages', tier: 2, energy: 12, timer: 270, radius: 46,
    desc: 'Picked-over houses. Cloth, scrap, and the dead who lived here.',
    biome: { skyTop: 0x6d8296, skyHorizon: 0xc0bfb0, trees: 'tree_dead', ground: 0x6b6a52, patch: [0x777457, 0x6a5b45, 0x5d5f47], tree: 0x39422c, fog: 0x2e3030, sky: 0x2e3030 },
    decor: { tree: 95, bush: 55, rock: 40 },
    nodes: { tree: 10, rock: 8, wreck: 12, bush: 6 }, containers: 8,
    pickups: { branches: 8, stones: 8 },
    zombies: { walker: 8, runner: 4, dog: 2 }, loot: 'yellow',
  },
  {
    id: 'limestone', name: 'Limestone Ridge', tier: 2, energy: 12, timer: 270, radius: 44,
    desc: 'Iron in the rock. Toxic ones drift through the dust.',
    biome: { skyTop: 0x8ba2b5, skyHorizon: 0xd9d2c4, trees: 'tree_dead', ground: 0x8a8375, patch: [0x958d7d, 0x7d7466, 0x6f6a60], tree: 0x4a4c38, fog: 0x3a3833, sky: 0x3a3833 },
    decor: { tree: 44, bush: 34, rock: 120 },
    nodes: { rock: 20, iron: 16, tree: 4, wreck: 3 }, containers: 5,
    pickups: { branches: 5, stones: 18 },
    zombies: { walker: 6, toxic: 4, runner: 2 }, loot: 'yellow',
  },
  {
    id: 'redzone', name: 'Red Zone', tier: 3, energy: 20, timer: 240, radius: 46,
    desc: 'Military spill. Best loot in the region. You will not be alone.',
    biome: { skyTop: 0x5c5f68, skyHorizon: 0xa8968a, trees: 'tree_dead', ground: 0x5c5346, patch: [0x685c4c, 0x59493c, 0x4d4a40], tree: 0x33372a, fog: 0x2b2622, sky: 0x2b2622 },
    decor: { tree: 80, bush: 40, rock: 60 },
    nodes: { wreck: 14, rock: 8, iron: 8, tree: 4 }, containers: 10,
    pickups: { branches: 6, stones: 8 },
    zombies: { walker: 9, runner: 6, toxic: 4, dog: 4, brute: 2 }, loot: 'red',
  },
  {
    id: 'bunker', name: 'Bunker Alfa', tier: 3, energy: 26, timer: 210, radius: 38,
    desc: 'Sealed installation. Needs a keycard. Everything down here wants you dead.',
    biome: { skyTop: 0x2a2f39, skyHorizon: 0x4a4a52, trees: 'tree_dead', ground: 0x4a4a4e, patch: [0x545458, 0x424246, 0x3c3c40], tree: 0x2b2b2e, fog: 0x1c1e22, sky: 0x1c1e22 },
    decor: { tree: 18, bush: 12, rock: 90 },
    nodes: { wreck: 10, iron: 6 }, containers: 12,
    pickups: { branches: 2, stones: 6 },
    zombies: { runner: 8, toxic: 6, brute: 4, walker: 6 }, loot: 'bunker',
    requires: 'keycard',
  },
];

export const locationById = (id) => LOCATIONS.find((l) => l.id === id);

export const ENERGY_MAX = 100;
export const ENERGY_REGEN_PER_SEC = 0.9; // fast enough to keep a prototype playable
