import { state } from './state.js';
import { levelFromXp, MAX_LEVEL } from '../data/progression.js';
import { UNLOCKS, unlockById, unlocksAtLevel } from '../data/unlocks.js';

// Experience, levels, and what a level opens up.
//
// Experience used to be `state.xp += n` scattered across the codebase. That was
// fine while nothing depended on the number changing; it stopped being fine the
// moment a level could open a recipe, a building piece or a plot of land, because
// then *every* award has to be able to trigger a level-up. Every award now comes
// through addXp() and there is exactly one place a level can change.
//
// Unlocking is derived, never stored: content is available if the player's level
// is high enough and its prerequisites are met. Nothing to migrate, nothing to
// go stale, and no way for a save to claim something the tables no longer offer.
// The only thing stored is which unlocks have already been *announced*, so
// nothing is reported as new twice.

const levelListeners = [];
const xpListeners = [];

/** Called with ({ from, to, unlocked }) when the player levels up. */
export function onLevelUp(fn) { levelListeners.push(fn); }
/** Called with (amount, source, total) on every award. */
export function onXpGain(fn) { xpListeners.push(fn); }

export const playerLevel = () => levelFromXp(state.xp).lvl;
export const levelInfo = () => levelFromXp(state.xp);

/**
 * Awards experience.
 *
 * @param amount  how much; anything not a positive number is ignored rather than
 *                corrupting the total
 * @param source  where it came from ('harvest', 'craft', 'build', 'mission',
 *                'kill', 'pickup'), for the log and for future tuning
 */
export function addXp(amount, source = 'unknown') {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const before = playerLevel();
  state.xp = Math.max(0, (state.xp ?? 0) + Math.round(amount));
  const after = playerLevel();

  xpListeners.forEach((fn) => fn(Math.round(amount), source, state.xp));

  // One event per level crossed, so gaining three levels at once announces all
  // three rather than swallowing the ones in between.
  for (let lvl = before + 1; lvl <= after; lvl++) {
    const unlocked = unlocksAtLevel(lvl).filter((u) => prerequisitesMet(u));
    levelListeners.forEach((fn) => fn({ from: lvl - 1, to: lvl, unlocked }));
  }
  return Math.round(amount);
}

// ---------------------------------------------------------------- unlocks

function seen() {
  if (!Array.isArray(state.unlocksSeen)) state.unlocksSeen = [];
  return state.unlocksSeen;
}

function prerequisitesMet(entry, depth = 0) {
  if (!entry?.requires?.length) return true;
  // Cheap guard against a table that accidentally requires itself.
  if (depth > 4) return true;
  return entry.requires.every((id) => {
    const need = unlockById(id);
    return need ? isUnlocked(id, depth + 1) : true;
  });
}

/** The level a piece of content needs, or null if there is no such content. */
export function requiredLevel(contentId) {
  return unlockById(contentId)?.lvl ?? null;
}

/**
 * Is this content available to the player right now?
 *
 * Unknown ids answer true: content that was never gated is not locked, and a
 * caller asking about something outside the catalogue should not be blocked by
 * an omission in a data table.
 */
export function isUnlocked(contentId, depth = 0) {
  const entry = unlockById(contentId);
  if (!entry) return true;
  if (playerLevel() < entry.lvl) return false;
  return prerequisitesMet(entry, depth);
}

/** Why it is locked, in words, or null if it isn't. */
export function lockReason(contentId) {
  const entry = unlockById(contentId);
  if (!entry) return null;
  if (playerLevel() < entry.lvl) return `Unlocks at level ${entry.lvl}`;
  if (!prerequisitesMet(entry)) {
    const missing = entry.requires
      .map((id) => unlockById(id))
      .filter((need) => need && !isUnlocked(need.id));
    if (missing.length) return `Needs ${missing.map((m) => m.title).join(', ')}`;
  }
  return null;
}

/** Everything available now. */
export const availableUnlocks = () => UNLOCKS.filter((u) => isUnlocked(u.id));

/**
 * Unlocks the player has not been told about yet, marked as told.
 *
 * Reading and marking in one call is deliberate: two callers both asking "what
 * is new?" must not both be handed the same list.
 */
export function takeNewUnlocks() {
  const known = seen();
  const fresh = availableUnlocks().filter((u) => !known.includes(u.id));
  for (const u of fresh) known.push(u.id);
  return fresh;
}

/**
 * Marks everything currently available as already announced.
 *
 * Called once after a save loads: a returning player must not be shown twenty
 * "new!" notices for content they unlocked days ago.
 */
export function primeUnlocks() {
  const known = seen();
  for (const u of availableUnlocks()) if (!known.includes(u.id)) known.push(u.id);
}

export { MAX_LEVEL };
