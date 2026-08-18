import { state } from './state.js';
import { level } from './state.js';
import { PLOTS, plotById, plotCoordFor, inPlotBounds, HOME_PLOT, LAND_HALF_CELLS } from '../data/land.js';
import { SURV, canAfford, spend, getBalance, formatMoney } from './wallet.js';

// Which ground you own, and buying more of it.
//
// Definitions live in data/land.js; this file holds only what changes — the set
// of plots bought — and the rules for buying. The buildable test is the hot path
// (every frame of aiming a piece calls it), so the unlocked set is kept as a Set
// rather than scanned out of the save each time.

const listeners = [];
/** Called with (plot) after a plot is unlocked. */
export function onLandChange(fn) { listeners.push(fn); }

let unlockedSet = null;

function ensure() {
  if (!Array.isArray(state.land)) state.land = [];
  // The home plot is free and must never depend on having been written to a save:
  // a corrupted or pre-land save would otherwise leave the player unable to build
  // anywhere at all.
  if (!state.land.includes(HOME_PLOT)) state.land.push(HOME_PLOT);
  // Drop ids that no longer exist, so retuning the grid cannot strand a save.
  state.land = [...new Set(state.land.filter((id) => plotById(id)))];
  unlockedSet = new Set(state.land);
  return state.land;
}

/** Call after loading a save, so the cached set matches what was loaded. */
export function refreshLand() { unlockedSet = null; ensure(); }

export function isUnlocked(plotId) {
  if (!unlockedSet) ensure();
  return unlockedSet.has(plotId);
}

export const unlockedPlots = () => PLOTS.filter((p) => isUnlocked(p.id));
export const lockedPlots = () => PLOTS.filter((p) => !isUnlocked(p.id));

/** The plot a cell belongs to, or null if the cell is off the grid entirely. */
export function plotAt(gx, gz) {
  if (Math.abs(gx) > LAND_HALF_CELLS || Math.abs(gz) > LAND_HALF_CELLS) return null;
  const [px, pz] = plotCoordFor(gx, gz);
  const plot = PLOTS.find((p) => p.px === px && p.pz === pz);
  return plot && inPlotBounds(plot, gx, gz) ? plot : null;
}

/** The one question the build system asks: may a piece go on this cell? */
export function isBuildableCell(gx, gz) {
  const plot = plotAt(gx, gz);
  return !!plot && isUnlocked(plot.id);
}

/** Why a cell is refused, for the message under the cursor. */
export function refusalFor(gx, gz) {
  const plot = plotAt(gx, gz);
  if (!plot) return 'Outside your plot';
  if (isUnlocked(plot.id)) return true;
  return `${plot.name} is not yours yet`;
}

/**
 * Everything the UI needs about one plot, in one place, so the panel never has
 * to work out for itself why a button is disabled.
 */
export function plotStatus(id) {
  const plot = plotById(id);
  if (!plot) return null;
  const owned = isUnlocked(plot.id);
  const lvl = level().lvl;
  const levelOk = lvl >= plot.lvl;
  const affordable = canAfford(plot.price);
  return {
    plot,
    owned,
    levelOk,
    affordable,
    balance: getBalance(SURV),
    canBuy: !owned && !plot.free && levelOk && affordable,
    reason: owned ? 'Owned'
      : plot.free ? 'Yours from the start'
      : !levelOk ? `Requires level ${plot.lvl}`
      : !affordable ? `Costs ${formatMoney(plot.price)} — you have ${formatMoney(getBalance(SURV))}`
      : null,
  };
}

// Guards a purchase that is already in flight. A double click, or a click while
// the confirm is still open, must not be able to run the sequence twice — the
// spend and the unlock are two steps and anything between them is a window.
let buying = null;

/**
 * Buys a plot.
 *
 * Order matters: every check passes before a single token moves, and the plot is
 * only recorded as owned once the spend has actually succeeded. If the spend
 * fails the world is untouched.
 *
 * @returns { ok, plot?, reason?, spent? }
 */
export function buyPlot(id) {
  const plot = plotById(id);
  if (!plot) return { ok: false, reason: 'No such plot' };
  if (buying === id) return { ok: false, reason: 'Already buying that' };

  buying = id;
  try {
    ensure();
    if (isUnlocked(id)) return { ok: false, reason: 'You already own this' };
    if (plot.free) return { ok: false, reason: 'This plot is not for sale' };
    if (level().lvl < plot.lvl) return { ok: false, reason: `Requires level ${plot.lvl}` };
    if (!canAfford(plot.price)) {
      return { ok: false, reason: `Not enough $SURV — ${formatMoney(plot.price)} needed` };
    }
    if (!spend(plot.price, `land:${id}`)) return { ok: false, reason: 'Payment failed' };

    state.land.push(id);
    unlockedSet.add(id);
    listeners.forEach((fn) => fn(plot));
    return { ok: true, plot, spent: plot.price };
  } finally {
    buying = null;
  }
}
