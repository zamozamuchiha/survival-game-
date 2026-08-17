import { state } from './state.js';

const KEY = 'lastlight.save.v1';
// Explicit allow-list, so nothing transient sneaks into the save. Anything added
// to state that should survive a reload has to be named here too.
const FIELDS = ['hp', 'maxHp', 'hunger', 'thirst', 'stamina', 'poison', 'xp',
  'energy', 'inv', 'equip', 'base', 'graves', 'seenLocations', 'stats',
  'character', 'missions'];

export function save() {
  try {
    const data = {};
    for (const f of FIELDS) data[f] = state[f];
    data.savedAt = Date.now();
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
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
