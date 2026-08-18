import { state } from './state.js';
import { syncHand } from './hotbar.js';

const KEY = 'lastlight.save.v1';
// A rolling second slot. One save that is overwritten on every change is one
// mistake away from gone — a bug, a bad edit, anything that writes a worse state
// than the one it replaced. The backup is only refreshed when the save it is
// replacing has aged past BACKUP_AGE, so a burst of bad writes cannot flush a
// good snapshot: whatever the last few minutes did, there is still a version
// from before it.
const BACKUP = 'lastlight.save.v1.bak';
const BACKUP_AGE = 4 * 60 * 1000;
// Explicit allow-list, so nothing transient sneaks into the save. Anything added
// to state that should survive a reload has to be named here too.
const FIELDS = ['hp', 'maxHp', 'hunger', 'thirst', 'stamina', 'poison', 'xp',
  'energy', 'inv', 'equip', 'base', 'graves', 'seenLocations', 'stats',
  'character', 'missions', 'granted', 'wallet', 'land', 'unlocksSeen', 'hotbar'];

export function save() {
  try {
    const data = {};
    for (const f of FIELDS) data[f] = state[f];
    data.savedAt = Date.now();
    rollBackup();
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

/** Moves the save about to be overwritten into the backup slot, now and then. */
function rollBackup() {
  try {
    const current = localStorage.getItem(KEY);
    if (!current) return;
    const bak = localStorage.getItem(BACKUP);
    if (bak) {
      const age = (JSON.parse(current).savedAt ?? 0) - (JSON.parse(bak).savedAt ?? 0);
      if (age < BACKUP_AGE) return;      // the backup is still recent enough
    }
    localStorage.setItem(BACKUP, current);
  } catch { /* quota, private mode: a missing backup must never break saving */ }
}

/** What the backup holds, for deciding whether it is worth going back to. */
export function backupInfo() {
  try {
    const raw = localStorage.getItem(BACKUP);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return {
      savedAt: data.savedAt ?? null,
      pieces: Object.keys(data.base ?? {}).length,
      xp: data.xp ?? 0,
    };
  } catch {
    return null;
  }
}

/** Swaps the backup in as the live save. The replaced save is kept as the backup. */
export function restoreBackup() {
  try {
    const bak = localStorage.getItem(BACKUP);
    if (!bak) return false;
    const current = localStorage.getItem(KEY);
    localStorage.setItem(KEY, bak);
    if (current) localStorage.setItem(BACKUP, current);   // so it swaps back
    return load();
  } catch {
    return false;
  }
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    for (const f of FIELDS) if (data[f] !== undefined) state[f] = data[f];

    // Energy accrues while the tab is closed, same as the real thing.
    if (data.savedAt) {
      const away = (Date.now() - data.savedAt) / 1000;
      state.energy = Math.min(100, state.energy + away * 0.9);
    }
    state.locationId = 'home';
    state.timeLeft = 0;
    // JSON cannot record that equip.weapon and the active hotbar slot are the
    // same object, so loading always produces two copies of the held tool and
    // wear would then only land on one of them. Re-link here rather than at the
    // call sites: everything that loads a save needs this, including the backup
    // restore and the self-test.
    syncHand();

    // Never load straight into a corpse. If the last save caught you dead, the
    // grave already holds your loot, so wake up at home with your vitals reset.
    if (!(state.hp > 0)) {
      state.hp = state.maxHp || 100;
      state.hunger = Math.max(state.hunger, 45);
      state.thirst = Math.max(state.thirst, 45);
      state.stamina = 100;
      state.poison = 0;
    }
    return true;
  } catch {
    return false;
  }
}

export function wipe() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
