import { ITEMS } from '../data/items.js';
import { levelFromXp } from '../data/progression.js';
import { ENERGY_MAX } from '../data/locations.js';
import { makeSlots, totalWeight } from './inventory.js';

const BASE_SLOTS = 10;   // pockets, before any bag
const BASE_CARRY = 22;   // kg

export const state = {
  hp: 100, maxHp: 100,
  hunger: 100, thirst: 100, stamina: 100,
  poison: 0,
  xp: 0,
  energy: ENERGY_MAX,

  inv: makeSlots(BASE_SLOTS),
  // `equip.weapon` is whatever the active hotbar slot holds — see core/hotbar.js,
  // which is the only thing that writes it.
  equip: { weapon: null, head: null, body: null, feet: null, back: null },
  // Two primary slots, switched with the number keys. { slots: [a, b], active }
  hotbar: null,

  // Chosen in the character creator on first run.
  character: { body: 'female', name: 'Survivor', tint: 0x4a6b7a, created: false },

  locationId: 'home',
  timeLeft: 0,

  // { done: [ids], progress: { missionId: [countPerGoal] }, seen: [ids] }
  // Status is derived from done[] + requires[], never stored — see core/missions.js
  missions: null,

  // Currency ledger, keyed by currency id — see core/wallet.js. Not an inventory
  // item on purpose: money has no weight and must not take a bag slot.
  wallet: null,    // { surv_token: n }
  // Ids of the land plots bought — see data/land.js. The home plot is implied.
  land: null,      // [plotId]
  // Unlocks the player has already been shown, so nothing is announced twice.
  unlocksSeen: null,

  base: {},        // "x,z" -> { item, build, hp, station?, contents? }
  graves: {},      // locationId -> [{ id, n, dur }]
  seenLocations: ['home', 'pine'],

  stats: { kills: 0, crafted: 0, deaths: 0, runs: 0 },

  // One-off deliveries already made, by id. Stops a hand-out from arriving again
  // on every load, and from coming back after the player throws it away.
  granted: [],
};

export function slotCount() {
  const bag = state.equip.back;
  return BASE_SLOTS + (bag ? ITEMS[bag.id]?.slots ?? 0 : 0);
}

export function carryLimit() {
  const bag = state.equip.back;
  return BASE_CARRY + (bag ? ITEMS[bag.id]?.carry ?? 0 : 0);
}

export function carriedWeight() {
  let w = totalWeight(state.inv);
  for (const s of Object.values(state.equip)) {
    if (s) w += (ITEMS[s.id]?.weight ?? 0) * s.n;
  }
  return w;
}

export const overloaded = () => carriedWeight() > carryLimit();

/** Grows or shrinks the bag to match the equipped backpack. Never destroys items:
 *  shrinking only reclaims trailing empty slots. */
export function resizeInventory() {
  const want = slotCount();
  while (state.inv.length < want) state.inv.push(null);
  while (state.inv.length > want && state.inv[state.inv.length - 1] === null) {
    state.inv.pop();
  }
}

export function level() { return levelFromXp(state.xp); }

/** Total damage reduction from worn armor, capped so armor never trivialises hits. */
export function armorRating() {
  let r = 0;
  for (const key of ['head', 'body', 'feet']) {
    const s = state.equip[key];
    if (s && s.dur > 0) r += ITEMS[s.id]?.armor ?? 0;
  }
  return Math.min(0.7, r);
}

export function resetRun() {
  state.hp = state.maxHp;
  state.hunger = 100;
  state.thirst = 100;
  state.stamina = 100;
  state.poison = 0;
}
