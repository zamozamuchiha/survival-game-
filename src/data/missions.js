// Missions: the thread that pulls a new player through the opening hour.
//
// Each mission is a list of goals, each goal a counter that ticks when the game
// reports a matching event. Goals never read the inventory directly — they count
// what happened. Otherwise crafting an axe would undo "gather 12 wood" the moment
// the wood is spent, and the player would watch a finished objective come apart
// in front of them.
//
// Goal kinds, all matched on `what`:
//   collect   picked something up or was given it as loot
//   craft     made something
//   harvest   depleted a resource node ('tree', 'rock', 'iron', 'bush', 'wreck')
//   kill      killed a zombie type, or 'any'
//   build     placed a building piece
//   store     moved an item from the backpack into a storage box
//   travel    arrived in a location id
//
// `next` chains the following mission. Missions unlock in order, one at a time,
// so the player is never looking at a list of twelve things.

export const MISSIONS = [
  {
    id: 'first_gather',
    title: 'Pick the ground clean',
    brief: 'Branches and loose stones are lying everywhere. Gather enough to make your first tools.',
    goals: [
      { kind: 'collect', what: 'wood', n: 12, label: 'Gather wood' },
      { kind: 'collect', what: 'stone', n: 10, label: 'Gather stone' },
    ],
    reward: { xp: 15 },
    hint: 'Walk up to branches or stones on the ground and press E.',
    next: 'first_tools',
  },
  {
    id: 'first_tools',
    title: 'Something to work with',
    brief: 'Bare hands are no use against a tree trunk. Make an axe and a pickaxe.',
    goals: [
      { kind: 'craft', what: 'axe_stone', n: 1, label: 'Craft a Stone Axe' },
      { kind: 'craft', what: 'pick_stone', n: 1, label: 'Craft a Stone Pickaxe' },
    ],
    reward: { xp: 25 },
    hint: 'Press C to open crafting. Both are made by hand, no workbench needed.',
    next: 'first_harvest',
  },
  {
    id: 'first_harvest',
    title: 'Take what you need',
    brief: 'With the right tool in hand, the forest is a supply depot. Fell a tree and break a rock.',
    goals: [
      { kind: 'harvest', what: 'tree', n: 1, label: 'Fell a tree' },
      { kind: 'harvest', what: 'rock', n: 1, label: 'Break a rock' },
    ],
    reward: { xp: 40 },
    hint: 'Equip the right tool, stand near a tree or rock and hold SPACE.',
    next: 'first_shelter',
  },
  {
    id: 'first_shelter',
    title: 'Somewhere to keep it',
    brief: 'Nobody is going to build your camp for you. Lay a foundation, floor it, and wall it in.',
    goals: [
      { kind: 'build', what: 'foundation_wood', n: 1, label: 'Lay a foundation' },
      { kind: 'build', what: 'floor_wood', n: 1, label: 'Floor it' },
      { kind: 'build', what: 'wall_wood', n: 2, label: 'Put up two walls' },
    ],
    reward: { xp: 50 },
    hint: 'Press B at camp. Materials come straight out of your bag — no crafting first.',
    next: 'first_storage',
  },
  {
    id: 'first_storage',
    title: 'A place for everything',
    brief: 'A camp only starts being useful when it keeps your supplies safe. Build a box, then put something inside it.',
    goals: [
      { kind: 'build', what: 'box_storage', n: 1, label: 'Build a storage box' },
      { kind: 'store', what: 'any', n: 1, label: 'Store one item in it' },
    ],
    reward: { xp: 35 },
    hint: 'Choose Storage Box with B, build it on a floor, then press E beside it and click an item from your backpack.',
    next: 'first_run',
  },
  {
    id: 'first_run',
    title: 'Out past the treeline',
    brief: 'Everything worth having is somewhere else. Travel to Pine Bushes and come back alive.',
    goals: [
      { kind: 'travel', what: 'pine', n: 1, label: 'Reach Pine Bushes' },
      // Unreachable while data/locations.js has PEACEFUL set: nothing spawns to
      // kill. Turn the walkers back on, or drop this goal.
      { kind: 'kill', what: 'any', n: 2, label: 'Put down two of them' },
      { kind: 'travel', what: 'home', n: 1, label: 'Get back to camp' },
    ],
    reward: { xp: 80 },
    hint: 'Press M to travel. Watch the timer — when it runs out, the area is overrun.',
    next: null,
  },
];

export const missionById = (id) => MISSIONS.find((m) => m.id === id) ?? null;

/** The mission every new game starts on. */
export const FIRST_MISSION = MISSIONS[0].id;
