import { state } from './state.js';
import { save, load } from './save.js';
import { syncHand } from './hotbar.js';
import * as wallet from './wallet.js';
import * as land from './land.js';
import * as progress from './progress.js';
import { craft, recipeStatus } from './crafting.js';
import { RECIPES } from '../data/recipes.js';
import { PLOTS } from '../data/land.js';
import { recipeUnlockId, buildUnlockId, UNLOCKS } from '../data/unlocks.js';

// A runnable acceptance pass over progression, currency and land.
//
// A written checklist goes stale the first time someone changes a price. This
// runs the actual systems and says what happened, so it stays true or it fails.
//
// It snapshots every field it touches and puts them all back at the end,
// including on failure — running it must never cost the player anything. It does
// not touch the world or the base, so nothing built can be lost by it.
//
// Call it from the console: game.selftest()

// Everything the pass can move, directly or indirectly. `missions` is on the
// list because awarding experience fires a level-up, and the level-up handler
// saves — and because refreshMeasured() can close an objective while the test
// has the player at ten million experience. Leaving it out let a test run finish
// the player's mission chain for them.
const FIELDS = ['xp', 'wallet', 'land', 'granted', 'unlocksSeen', 'inv', 'missions', 'hotbar', 'equip'];

function snapshot() {
  const s = {};
  for (const f of FIELDS) s[f] = structuredClone(state[f]);
  return s;
}
function restore(s) {
  for (const f of FIELDS) state[f] = structuredClone(s[f]);
  land.refreshLand();
  // structuredClone gives equip and the hotbar separate copies of the held tool.
  syncHand();
}

export function selftest({ verbose = true } = {}) {
  const before = snapshot();
  const results = [];
  const check = (name, got, want) => {
    const pass = JSON.stringify(got) === JSON.stringify(want);
    results.push({ name, pass, got, want });
    return pass;
  };

  try {
    // ---- 1. the test balance is paid exactly once ----------------------
    state.wallet = {}; state.granted = [];
    wallet.grantOnce('t_funds', 1000);
    const firstPay = wallet.getBalance();
    wallet.grantOnce('t_funds', 1000);
    check('test funds paid once', [firstPay, wallet.getBalance()], [1000, 1000]);

    // ---- 2. buying a plot ---------------------------------------------
    state.land = []; land.refreshLand();
    state.wallet = { [wallet.SURV]: 10_000 };
    state.xp = 100_000;                                  // high enough for any gate
    const target = PLOTS.find((p) => !p.free);
    const buy = land.buyPlot(target.id);
    check('plot purchase succeeds', buy.ok, true);
    check('price was charged once', wallet.getBalance(), 10_000 - target.price);
    check('plot now owned', land.isUnlocked(target.id), true);

    // ---- 3. a second click cannot buy it again -------------------------
    const balAfter = wallet.getBalance();
    const again = land.buyPlot(target.id);
    check('second purchase refused', again.ok, false);
    check('no second charge', wallet.getBalance(), balAfter);

    // ---- 4. building is refused on land you do not own -----------------
    const mine = { gx: target.min.gx, gz: target.min.gz };
    const notMine = PLOTS.find((p) => !p.free && p.id !== target.id);
    check('owned cell is buildable', land.isBuildableCell(mine.gx, mine.gz), true);
    check('unowned cell is not', land.isBuildableCell(notMine.min.gx, notMine.min.gz), false);
    check('off-grid cell is not', land.isBuildableCell(999, 999), false);

    // ---- 5. purchases survive a save and load --------------------------
    save();
    state.land = []; state.wallet = {}; land.refreshLand();
    load();
    land.refreshLand();
    check('purchase survives reload', land.isUnlocked(target.id), true);
    check('balance survives reload', wallet.getBalance(), balAfter);

    // ---- 6. experience and levelling -----------------------------------
    state.xp = 0; state.unlocksSeen = [];
    const levelUps = [];
    progress.onLevelUp((e) => levelUps.push(e.to));
    const lvl0 = progress.playerLevel();
    progress.addXp(0, 'test'); progress.addXp(-10, 'test'); progress.addXp(NaN, 'test');
    check('bad xp is ignored', state.xp, 0);
    progress.addXp(5000, 'test');
    check('level rose', progress.playerLevel() > lvl0, true);
    check('a level-up event fired', levelUps.length > 0, true);

    // ---- 7. locked and unlocked recipes --------------------------------
    const high = RECIPES.reduce((a, b) => (b.lvl > a.lvl ? b : a));
    state.xp = 0;
    check('high recipe is locked', progress.isUnlocked(recipeUnlockId(high.out.id)), false);
    check('crafting it is refused', craft(high).ok, false);
    state.xp = 10_000_000;
    check('high recipe unlocks', progress.isUnlocked(recipeUnlockId(high.out.id)), true);

    // ---- 8. locked and unlocked building pieces -------------------------
    state.xp = 0;
    check('stone wall is locked', progress.isUnlocked(buildUnlockId('wall_stone')), false);
    check('wood wall is not', progress.isUnlocked(buildUnlockId('wall_wood')), true);

    // ---- 9. nothing is announced twice ----------------------------------
    state.xp = 10_000_000; state.unlocksSeen = [];
    const firstBatch = progress.takeNewUnlocks().length;
    const secondBatch = progress.takeNewUnlocks().length;
    check('unlocks reported once', [firstBatch > 0, secondBatch], [true, 0]);
    check('catalogue is populated', UNLOCKS.length > 0, true);

    // ---- 10. every recipe and piece is reachable ------------------------
    // A gate nobody can ever pass is a content bug, not a difficulty choice.
    state.xp = 10_000_000;
    const unreachable = UNLOCKS.filter((entry) => !progress.isUnlocked(entry.id));
    check('everything is reachable at max level', unreachable.map((u) => u.id), []);
  } finally {
    restore(before);
    save();
  }

  const failed = results.filter((r) => !r.pass);
  if (verbose) {
    for (const r of results) {
      const mark = r.pass ? 'PASS' : 'FAIL';
      console.log(`[selftest] ${mark}  ${r.name}`
        + (r.pass ? '' : `\n           got ${JSON.stringify(r.got)}, want ${JSON.stringify(r.want)}`));
    }
    console.log(`[selftest] ${results.length - failed.length}/${results.length} passed`);
  }
  return { passed: results.length - failed.length, total: results.length, failed, results };
}
