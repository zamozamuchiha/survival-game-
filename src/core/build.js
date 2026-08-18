import { state } from './state.js';
import { isUnlocked, lockReason } from './progress.js';
import { buildUnlockId } from '../data/unlocks.js';
import { countItem, removeItem, addItem } from './inventory.js';
import { BUILDING, blueprint, refundFor } from '../data/building.js';

// The build loop: pick a blueprint, aim it, pay for it, put it up.
//
// Nothing here knows what a foundation or a wall is — it asks the catalogue what
// a blueprint costs and asks the base where it may go. Adding a piece is an
// entry in data/building.js and a model; this file does not change.

export class BuildController {
  constructor({ base, station, onPlaced, onRemoved }) {
    this.base = base;
    this.station = station ?? (() => null);   // which station the player stands at
    this.onPlaced = onPlaced ?? (() => {});
    this.onRemoved = onRemoved ?? (() => {});

    this.active = false;
    this.selected = null;
    this.rot = 0;
    this.target = null;
    /** Demolition mode: the cursor picks pieces to take down, not places to build. */
    this.removing = false;
    this.removeKey = null;
  }

  /**
   * Switches between building and taking down.
   *
   * Right-click already removed a piece, but a hidden verb with no cursor
   * feedback is one nobody finds: you click at a spot, something somewhere
   * within a couple of metres disappears, and if nothing was in range you get
   * no answer at all. A mode you can see yourself in fixes both.
   */
  toggleRemove() {
    this.removing = !this.removing;
    this.removeKey = null;
    if (this.removing) this.base?.hideGhost();
    return this.removing;
  }

  open(id = null) {
    this.active = true;
    if (id) this.select(id);
    this.base?.setBuildMode(true);
  }

  close() {
    this.active = false;
    this.target = null;
    this.removing = false;
    this.removeKey = null;
    this.base?.showRemoveTarget(null);
    this.base?.setBuildMode(false);
  }

  select(id) {
    this.selected = BUILDING[id] ? id : null;
    this.rot = 0;
    this.target = null;
    this.removing = false;      // picking something to build means you want to build
  }

  rotate() { this.rot = (this.rot + 1) % 4; }

  // ---- can we afford it, and are we allowed it ------------------------

  /** What's missing from the bag for one of these, if anything. */
  missingFor(id) {
    const bp = blueprint(id);
    if (!bp) return [];
    return Object.entries(bp.cost)
      .map(([res, n]) => ({ id: res, n, have: countItem(state.inv, res) }))
      .filter((c) => c.have < c.n);
  }

  /** true, or why this blueprint is off the menu right now. */
  /**
   * Whether the player may select this piece at all — level and prerequisites.
   *
   * The level test goes through the unlock catalogue rather than reading bp.lvl
   * here, so the crafting menu, the build menu and the level-up notice all agree
   * about what is open. Standing at the right station is a separate question:
   * that changes as you walk around, and is about *where* you are rather than
   * what you have earned.
   */
  unlocked(id) {
    const bp = blueprint(id);
    if (!bp) return 'Unknown';
    const gate = lockReason(buildUnlockId(id));
    if (gate) return gate;
    if (bp.needs && this.station() !== bp.needs) return `Requires a ${bp.needs}`;
    return true;
  }

  buildable(id) {
    const gate = this.unlocked(id);
    if (gate !== true) return gate;
    return this.missingFor(id).length ? 'Not enough materials' : true;
  }

  // ---- aiming ---------------------------------------------------------

  /** Points the ghost at a world position. Returns the target, or null. */
  aim(point, picked = null) {
    // In demolition mode the cursor hunts for the nearest piece instead of a
    // free socket, and the base outlines whatever it found. `picked` is what the
    // ray actually struck, which is the only thing that can tell a roof from the
    // floor under it; proximity is the fallback for pointing at open ground.
    if (this.active && this.removing) {
      this.removeKey = picked ?? (point ? this.base.nearestSocket(point, 2.6) : null);
      this.base.hideGhost();
      this.base.showRemoveTarget(this.removeKey);
      return null;
    }
    this.base?.showRemoveTarget(null);
    if (!this.active || !this.selected || !point) {
      this.target = null;
      this.base?.hideGhost();
      return null;
    }
    const t = this.base.targetFor(this.selected, point);
    if (t) t.rot = this.rot;

    // A socket you could fill but can't pay for still shows green-to-red here,
    // so the reason you can't build is visible before you click.
    if (t?.ok) {
      const gate = this.buildable(this.selected);
      if (gate !== true) { t.ok = false; t.reason = gate; }
    }
    this.target = t;
    this.base.showGhost(t, this.selected);
    return t;
  }

  // ---- doing it -------------------------------------------------------

  place() {
    if (!this.active || !this.selected) return { ok: false };
    const t = this.target;
    if (!t) return { ok: false, msg: 'Nowhere to put that' };
    if (!t.ok) return { ok: false, msg: t.reason ?? 'Can\'t build there' };

    // Re-checked here rather than trusting `t.ok`, which was decided by the last
    // aim() call. This is the only place that spends materials and the only one
    // that puts a piece in the world, so it is the only one entitled to decide a
    // placement is legal — and between aiming and clicking the player can level
    // up, spend the materials elsewhere, or have the ground sold out from under
    // the cursor.
    const gate = this.unlocked(this.selected);
    if (gate !== true) return { ok: false, msg: gate };
    const spot = this.base.checkPlace(this.selected, t);
    if (spot !== true) return { ok: false, msg: spot };

    const bp = blueprint(this.selected);
    for (const [res, n] of Object.entries(bp.cost)) {
      if (countItem(state.inv, res) < n) return { ok: false, msg: 'Not enough materials' };
    }
    for (const [res, n] of Object.entries(bp.cost)) removeItem(state.inv, res, n);

    const key = this.base.place(t, this.selected);
    this.onPlaced(this.selected, key);
    return { ok: true, id: this.selected, key, msg: `${bp.label} built` };
  }

  /** Takes down whatever is nearest the point and refunds half of it. */
  removeAt(point, picked = null) {
    const key = picked ?? (point ? this.base.nearestSocket(point, 2.6) : null);
    if (!key || !this.base.get(key)) return { ok: false, msg: 'Nothing there to take down' };
    const cell = this.base.get(key);
    const bp = blueprint(cell.item);

    // Empty the crate before it goes, or its contents vanish with it.
    if (cell.contents) {
      for (const s of cell.contents) if (s) addItem(state.inv, s.id, s.n, s.dur);
    }
    this.base.remove(key);
    for (const r of refundFor(cell.item)) addItem(state.inv, r.id, r.n);

    this.removeKey = null;
    this.base.showRemoveTarget(null);
    this.onRemoved(cell.item, key);
    return { ok: true, id: cell.item, msg: `${bp?.label ?? 'Piece'} taken down` };
  }
}
