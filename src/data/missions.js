// The mission table.
//
// One entry per mission, and this file is the only place that knows what a
// mission is. Nothing here runs: core/missions.js reads the table, tracks
// progress against it and decides what is unlocked. Adding a mission — required
// or optional, now or much later — is an entry here and nothing else.
//
// Fields
//   id        stable key. Saved progress is filed under it, so never rename one
//             that has shipped; add a new mission instead.
//   chapter   which chapter it belongs to, see CHAPTERS below
//   title     shown in the HUD tracker
//   brief     one line, shown when the mission unlocks
//   goals     every one must be met before the mission completes
//   requires  ids that must be completed first. [] means available from the
//             start. This is what makes the order strict, and what lets a later
//             side mission hang off any point in the chain without re-chaining
//             everything after it.
//   optional  true for side missions: they never block the required line and the
//             tracker shows them beneath it
//   reward    given once, on completion
//   hint      shown only while the mission is untouched — once the player is
//             clearly getting on with it, telling them which key to press is
//             noise
//
// Goal kinds, all matched against `what`:
//   collect   picked something up or was given it as loot
//   craft     made something
//   harvest   depleted a resource node ('tree', 'rock', 'iron', 'bush', 'wreck')
//   build     placed a building piece, by blueprint id
//   store     moved an item into a storage box
//   kill      killed a zombie type, or 'any'
//   travel    arrived at a location id
//   enclose   measured, not counted: how much of the floor's outer edge carries
//             a wall or door. The target moves with the size of the deck, so it
//             needs no `n` — see registerMeasure() in core/missions.js
//   stockpile measured: how much of `what` is in the bag, against what finishing
//             the shell will cost. Also needs no `n`.
//
// Goals count events, never inventory. Otherwise crafting an axe would undo
// "gather 10 wood" the moment the wood is spent, and the player would watch a
// finished objective come apart in front of them.

// Chapters group the missions into stretches with a shape of their own. They
// carry no rules — unlocking is still `requires` and nothing else — but they give
// the player a sense of where they are in a longer arc than "objective 3 of 5",
// and they give later content somewhere to hang.
export const CHAPTERS = [
  {
    n: 1,
    title: 'Introduction',
    brief: 'Learn what the ground gives you, and what to make of it.',
  },
  {
    n: 2,
    title: 'Shelter',
    brief: 'A floor is not a home. Close it in and give your supplies a place.',
  },
];

export const chapterByNumber = (n) => CHAPTERS.find((c) => c.n === n) ?? null;

export const MISSIONS = [
  {
    id: 'gather_basics',
    chapter: 1,
    title: 'Pick the ground clean',
    brief: 'Branches and loose stones are lying everywhere. Gather enough to make your first tools.',
    requires: [],
    goals: [
      { kind: 'collect', what: 'stone', n: 10, label: 'Gather stone' },
      { kind: 'collect', what: 'wood', n: 10, label: 'Gather wood' },
    ],
    reward: { xp: 15 },
    hint: 'Walk up to branches or stones on the ground and press <kbd>E</kbd>.',
  },
  {
    id: 'first_tools',
    chapter: 1,
    title: 'Something to work with',
    brief: 'Bare hands are no use against a tree trunk. Make an axe and a pickaxe.',
    requires: ['gather_basics'],
    goals: [
      { kind: 'craft', what: 'axe_stone', n: 1, label: 'Craft a Stone Axe' },
      { kind: 'craft', what: 'pick_stone', n: 1, label: 'Craft a Stone Pickaxe' },
    ],
    reward: { xp: 25 },
    hint: 'Press <kbd>C</kbd> to craft. Both are made by hand — 5 wood and 5 stone each.',
  },
  {
    id: 'gather_walls',
    chapter: 2,
    title: 'Timber for the walls',
    brief: 'Closing the whole floor edge takes a lot of tree. Chop and quarry until the bag can pay for it.',
    requires: ['first_tools'],
    goals: [
      // Measured against the bag, and against a target taken from the wall price
      // and the number of open edges — so it asks for exactly enough to finish
      // the shell, and moves if either the price or the deck changes.
      { kind: 'stockpile', what: 'wood', label: 'Wood in your bag' },
      { kind: 'stockpile', what: 'stone', label: 'Stone in your bag' },
    ],
    reward: { xp: 30 },
    hint: 'Stone Axe for trees, Stone Pickaxe for rock. Stand close and hold <kbd>SPACE</kbd>.',
  },
  {
    id: 'first_walls',
    chapter: 2,
    title: 'Wall it in',
    brief: 'A floor is not shelter. Run walls all the way round the edge of it.',
    requires: ['gather_walls'],
    goals: [
      // Measured, not counted: the target is however many edges the deck you
      // actually have exposes, so extending the floor extends the job. A door
      // closes its edge just as well as a wall.
      { kind: 'enclose', what: 'base', label: 'Close the floor edge' },
    ],
    reward: { xp: 40 },
    hint: 'Press <kbd>B</kbd> and pick Wood wall. Walls sit on the outer edge of the floor — one per open edge.',
  },
  {
    id: 'first_storage',
    chapter: 2,
    title: 'A place for everything',
    brief: 'A camp only starts being useful when it keeps your supplies safe.',
    requires: ['first_walls'],
    goals: [
      { kind: 'build', what: 'box_storage', n: 1, label: 'Build a storage box' },
      { kind: 'store', what: 'any', n: 1, label: 'Store one item in it' },
    ],
    reward: { xp: 35 },
    hint: 'Build it on a floor, then press <kbd>E</kbd> beside it.',
  },
  {
    id: 'first_harvest',
    chapter: 1,
    title: 'Take what you need',
    brief: 'With the right tool in hand, the forest is a supply depot.',
    requires: ['first_tools'],
    optional: true,
    goals: [
      { kind: 'harvest', what: 'tree', n: 1, label: 'Fell a tree' },
      { kind: 'harvest', what: 'rock', n: 1, label: 'Break a rock' },
    ],
    reward: { xp: 40 },
    hint: 'Equip the right tool, stand near a tree or rock and hold <kbd>SPACE</kbd>.',
  },
];

export const missionById = (id) => MISSIONS.find((m) => m.id === id) ?? null;
