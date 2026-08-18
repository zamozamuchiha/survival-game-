import { state } from './state.js';
import { addItem } from './inventory.js';
import { ITEMS } from '../data/items.js';

// Two hands' worth of tools, switched with the number keys.
//
// A survival game asks you to alternate between an axe and a pickaxe constantly,
// and doing that through the inventory screen means four clicks for something
// that should be one key. So there are two primary slots and pressing 1 or 2
// puts that one in your hands.
//
// The slots are the storage. `state.equip.weapon` is kept pointing at the active
// slot's *same object*, not a copy, so everything that already reads
// `equip.weapon` — the player's swing, the HUD, durability wear — keeps working
// untouched and cannot drift out of step: wearing the axe down mutates the one
// object both names refer to.
//
// That reference is the only thing a reload cannot preserve, since JSON has no
// way to say "these two are the same object". syncHand() re-links them, and is
// called once after loading.

export const SLOTS = 2;

const listeners = [];
/** Called after the active slot changes or its contents do. */
export function onHotbarChange(fn) { listeners.push(fn); }
const emit = () => listeners.forEach((fn) => fn(activeIndex(), slots()));

function ensure() {
  let h = state.hotbar;
  if (!h || !Array.isArray(h.slots)) {
    // First run, or a save from before the hotbar existed: whatever was in hand
    // becomes slot one, so nobody loses a tool to the upgrade.
    h = { slots: [state.equip?.weapon ?? null, null], active: 0 };
  }
  while (h.slots.length < SLOTS) h.slots.push(null);
  h.slots.length = SLOTS;
  if (!(h.active >= 0 && h.active < SLOTS)) h.active = 0;
  state.hotbar = h;
  return h;
}

export const slots = () => ensure().slots;
export const activeIndex = () => ensure().active;
export const slotAt = (i) => ensure().slots[i] ?? null;

/**
 * Points `equip.weapon` at the active slot.
 *
 * The only writer of `equip.weapon` in the codebase. Everything else reads it.
 */
export function syncHand() {
  const h = ensure();
  state.equip.weapon = h.slots[h.active] ?? null;
}

/** Switches to slot `i`. Returns what is now in hand, or null. */
export function selectSlot(i) {
  const h = ensure();
  if (i < 0 || i >= SLOTS || h.active === i) return null;
  h.active = i;
  syncHand();
  emit();
  return h.slots[i];
}

/**
 * Puts an item into a slot.
 *
 * @param i     which slot, or null for "wherever it fits" — the active one if
 *              empty, otherwise the first empty, otherwise replace the active
 * @returns whatever was displaced, for the caller to put back in the bag
 */
export function equipToSlot(item, i = null) {
  const h = ensure();
  let target = i;
  if (target === null) {
    if (!h.slots[h.active]) target = h.active;
    else {
      const free = h.slots.findIndex((s) => !s);
      target = free >= 0 ? free : h.active;
    }
  }
  const displaced = h.slots[target] ?? null;
  h.slots[target] = item;
  // Taking something out puts it in your hand: picking an axe and then having to
  // press a number before you can swing it is a step nobody wants.
  h.active = target;
  syncHand();
  emit();
  return displaced;
}

/** Empties a slot, handing back what was in it. */
export function clearSlot(i) {
  const h = ensure();
  const was = h.slots[i] ?? null;
  h.slots[i] = null;
  syncHand();
  emit();
  return was;
}

/** Moves a slot's contents back to the bag. Returns false if the bag is full. */
export function stowSlot(i) {
  const was = slotAt(i);
  if (!was) return true;
  if (addItem(state.inv, was.id, was.n, was.dur) > 0) return false;
  clearSlot(i);
  return true;
}

/** For the HUD: what each slot holds, ready to draw. */
export function hotbarView() {
  const h = ensure();
  return h.slots.map((s, i) => {
    const def = s ? ITEMS[s.id] : null;
    return {
      index: i,
      key: String(i + 1),
      active: i === h.active,
      item: s,
      name: def?.name ?? null,
      icon: def?.icon ?? null,
      // Durability as a fraction, or null for things that never wear out.
      wear: def?.dur && s?.dur !== undefined ? Math.max(0, s.dur / def.dur) : null,
      broken: !!(def?.dur && s?.dur !== undefined && s.dur <= 0),
    };
  });
}
