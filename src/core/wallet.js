import { state } from './state.js';

// Currency.
//
// One currency exists today — $SURV — and it is a local, non-tradeable number in
// the save file. It is deliberately not implemented as an inventory item: the bag
// has weight, slots and a carry limit, none of which should ever apply to money,
// and an item id would make it lootable, droppable and stealable by accident.
//
// The shape here is the shape a ledger would need if the balance later came from
// somewhere else — a wallet, a server, a chain. Every caller goes through
// getBalance / canAfford / spend / grant and none of them touches the number, so
// swapping the store underneath is this file and nothing else. That is also why
// spend() reports success rather than throwing: a remote ledger can refuse.

/** Stable id. Never key anything off the display text. */
export const SURV = 'surv_token';

export const CURRENCIES = {
  [SURV]: { id: SURV, symbol: '$SURV', name: 'Survivor Token', icon: '🪙', decimals: 0 },
};

export const currencyDef = (id) => CURRENCIES[id] ?? null;

const listeners = [];
/** Called with (currencyId, balance, delta, reason) after any change. */
export function onWalletChange(fn) { listeners.push(fn); }
const emit = (id, delta, reason) =>
  listeners.forEach((fn) => fn(id, getBalance(id), delta, reason));

function ledger() {
  if (!state.wallet || typeof state.wallet !== 'object') state.wallet = {};
  return state.wallet;
}

export function getBalance(id = SURV) {
  const n = ledger()[id];
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function canAfford(amount, id = SURV) {
  return Number.isFinite(amount) && amount >= 0 && getBalance(id) >= amount;
}

/**
 * Takes `amount` out of the balance.
 *
 * @returns true if it was taken, false if the balance would not cover it. The
 *          caller must treat false as "nothing happened" — this never goes
 *          negative and never partially pays.
 */
export function spend(amount, reason = 'unknown', id = SURV) {
  if (!Number.isFinite(amount) || amount < 0) return false;
  if (!canAfford(amount, id)) return false;
  ledger()[id] = getBalance(id) - Math.floor(amount);
  emit(id, -Math.floor(amount), reason);
  return true;
}

export function grant(amount, reason = 'unknown', id = SURV) {
  if (!Number.isFinite(amount) || amount <= 0) return false;
  ledger()[id] = getBalance(id) + Math.floor(amount);
  emit(id, Math.floor(amount), reason);
  return true;
}

/**
 * A one-off payment, identified by key so it can never be made twice.
 *
 * Reloading, re-running startup, or calling this from two places all have to end
 * with the player having been paid exactly once, so the record of having paid
 * lives in the save next to the balance rather than in a module variable.
 */
export function grantOnce(key, amount, id = SURV) {
  if (!Array.isArray(state.granted)) state.granted = [];
  if (state.granted.includes(key)) return false;
  state.granted.push(key);
  return grant(amount, key, id);
}

/** "1,000,000 $SURV" — grouped, because six-figure balances are unreadable raw. */
export function formatMoney(amount, id = SURV) {
  const def = currencyDef(id);
  return `${Math.floor(amount).toLocaleString('en-US')} ${def?.symbol ?? id}`;
}
