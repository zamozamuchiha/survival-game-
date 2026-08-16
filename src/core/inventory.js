import { ITEMS } from '../data/items.js';

// A slot is either null or { id, n, dur? }. Durable items always occupy their
// own slot so each one can carry its own wear value.

export const makeSlots = (n) => Array.from({ length: n }, () => null);

export function countItem(slots, id) {
  let total = 0;
  for (const s of slots) if (s && s.id === id) total += s.n;
  return total;
}

export function totalWeight(slots) {
  let w = 0;
  for (const s of slots) if (s) w += (ITEMS[s.id]?.weight ?? 0) * s.n;
  return w;
}

export function freeSlots(slots) {
  return slots.reduce((c, s) => c + (s ? 0 : 1), 0);
}

/** Adds up to `n`; returns how many did NOT fit. */
export function addItem(slots, id, n = 1, dur) {
  const def = ITEMS[id];
  if (!def) return n;
  const max = def.stack ?? 1;

  if (max > 1) {
    for (const s of slots) {
      if (!s || s.id !== id || s.n >= max) continue;
      const room = max - s.n;
      const put = Math.min(room, n);
      s.n += put;
      n -= put;
      if (n === 0) return 0;
    }
  }

  for (let i = 0; i < slots.length && n > 0; i++) {
    if (slots[i]) continue;
    const put = Math.min(max, n);
    slots[i] = { id, n: put };
    if (def.dur) slots[i].dur = dur ?? def.dur;
    n -= put;
  }
  return n;
}

export function canFit(slots, id, n = 1) {
  const probe = slots.map((s) => (s ? { ...s } : null));
  return addItem(probe, id, n) === 0;
}

/** Removes `n` of `id` across stacks. Returns true only if all of it was removed. */
export function removeItem(slots, id, n = 1) {
  if (countItem(slots, id) < n) return false;
  for (let i = 0; i < slots.length && n > 0; i++) {
    const s = slots[i];
    if (!s || s.id !== id) continue;
    const take = Math.min(s.n, n);
    s.n -= take;
    n -= take;
    if (s.n === 0) slots[i] = null;
  }
  return true;
}

export function removeAt(slots, index, n = Infinity) {
  const s = slots[index];
  if (!s) return null;
  const take = Math.min(s.n, n);
  const out = { id: s.id, n: take, dur: s.dur };
  s.n -= take;
  if (s.n === 0) slots[index] = null;
  return out;
}

export function moveSlot(from, fromIdx, to, toIdx) {
  const a = from[fromIdx];
  if (!a) return false;
  const b = to[toIdx];
  const max = ITEMS[a.id]?.stack ?? 1;

  if (b && b.id === a.id && max > 1 && b.n < max) {
    const put = Math.min(max - b.n, a.n);
    b.n += put;
    a.n -= put;
    if (a.n === 0) from[fromIdx] = null;
    return true;
  }
  from[fromIdx] = b ?? null;
  to[toIdx] = a;
  return true;
}

/** Dumps every slot into a plain list — used when you die. */
export function drainAll(slots) {
  const out = [];
  for (let i = 0; i < slots.length; i++) {
    if (slots[i]) { out.push(slots[i]); slots[i] = null; }
  }
  return out;
}
