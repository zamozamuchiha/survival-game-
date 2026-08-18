import { ITEMS } from '../data/items.js';
import { STATIONS } from '../data/recipes.js';
import { LOCATIONS, locationById } from '../data/locations.js';
import { state, level, slotCount, carryLimit, carriedWeight, resizeInventory } from '../core/state.js';
import { addItem, removeAt, countItem, freeSlots, moveSlot } from '../core/inventory.js';
import { recipesFor, recipeStatus, craft } from '../core/crafting.js';
import { TOOL_PURPOSE } from '../data/harvest.js';
import { toast } from './toast.js';
import { playSound } from '../core/audio.js';
import { equipToSlot, activeIndex, selectSlot, stowSlot, hotbarView } from '../core/hotbar.js';
import { PLOTS } from '../data/land.js';
import { plotStatus, buyPlot } from '../core/land.js';
import { getBalance, formatMoney, SURV } from '../core/wallet.js';
import { lockReason, isUnlocked, playerLevel } from '../core/progress.js';
import { recipeUnlockId, UNLOCKS } from '../data/unlocks.js';

const $ = (id) => document.getElementById(id);
const wrap = $('panels');

let ctx = {};
let current = null;
let selected = null;         // { where:'inv'|'store', index }
let craftStation = 'hands';
let storageCell = null;

export function initPanels(hooks) {
  ctx = hooks;
  $('p-inv').querySelector('[data-goto="craft"]').addEventListener('click', () => openPanel('craft'));
  $('p-inv').querySelector('[data-goto="unlocks"]').addEventListener('click', () => openPanel('unlocks'));
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) closePanels(); });
  // Dragging is tracked on the document, not on the cell it started from: the
  // pointer leaves that cell immediately, and the grid it lands on is a
  // different element entirely.
  document.addEventListener('pointermove', onDragMove);
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', () => cancelDrag());
  addEventListener('keydown', (e) => { if (e.code === 'Escape' && drag) cancelDrag(); });
}

export const isPanelOpen = () => current !== null;
export const currentPanel = () => current;

export function openPanel(name, opts = {}) {
  if (current !== name) playSound('ui');
  current = name;
  selected = null;
  if (name === 'craft') craftStation = opts.station ?? ctx.nearbyStation?.() ?? 'hands';
  if (name === 'store') storageCell = opts.cell ?? null;

  wrap.classList.add('on');
  for (const p of wrap.querySelectorAll('.panel')) p.classList.remove('on');
  $(`p-${name}`).classList.add('on');
  render();
}

export function closePanels() {
  if (current) playSound('ui', 0.8);
  current = null;
  selected = null;
  storageCell = null;
  wrap.classList.remove('on');
  for (const p of wrap.querySelectorAll('.panel')) p.classList.remove('on');
}

export function refreshPanels() { if (current) render(); }

function render() {
  if (current === 'inv') renderInventory();
  else if (current === 'store') renderStorage();
  else if (current === 'craft') renderCrafting();
  else if (current === 'land') renderLand();
  else if (current === 'unlocks') renderUnlocks();
  else if (current === 'map') renderMap();
}

// ---------------------------------------------------------------- helpers

function cellHtml(slot, index, where) {
  if (!slot) return `<div class="cell empty" data-i="${index}" data-w="${where}"></div>`;
  const def = ITEMS[slot.id] ?? {};
  const sel = selected && selected.where === where && selected.index === index ? ' sel' : '';
  const count = slot.n > 1 ? `<span class="n">${slot.n}</span>` : '';
  let dur = '';
  if (def.dur && slot.dur !== undefined) {
    const pct = Math.max(0, Math.min(1, slot.dur / def.dur)) * 100;
    dur = `<span class="d"><i style="width:${pct}%"></i></span>`;
  }
  return `<div class="cell${sel}" data-i="${index}" data-w="${where}" title="${def.name ?? slot.id}">${def.icon ?? '?'}${count}${dur}</div>`;
}

function gridHtml(slots, where) {
  return slots.map((s, i) => cellHtml(s, i, where)).join('');
}

function bindGrid(el, where, onClick) {
  el.querySelectorAll('.cell').forEach((c) => {
    const index = Number(c.dataset.i);
    // A drag ends with a click on the cell it started from, which would then
    // fire the click handler and move the stack a second time.
    c.addEventListener('click', () => { if (!justDragged) onClick(index, where); });
    c.addEventListener('pointerdown', (e) => beginDrag(e, where, index, c));
  });
}

// ---------------------------------------------------------------- drag & drop
//
// Clicking still shifts a whole stack to the other side in one go — that stays
// the quick way to empty your pockets into a box. Dragging is for putting a
// stack in a particular slot, in either direction, and for tidying up within one
// grid. Both end in moveSlot(), which merges onto a matching stack when it can
// and swaps the two slots when it can't.

const DRAG_SLOP = 5;      // px of travel before a press counts as a drag, so a
                          // slightly shaky click is still a click
let drag = null;          // { where, index, cell, x, y, ghost }
let justDragged = false;

/** The live slot array behind a grid. */
const slotsFor = (where) => (where === 'store' ? storageCell?.contents ?? null : state.inv);

function cellUnder(x, y) {
  const el = document.elementFromPoint(x, y)?.closest?.('.cell');
  if (!el || el.dataset.i === undefined) return null;
  return { where: el.dataset.w, index: Number(el.dataset.i), el };
}

function beginDrag(e, where, index, cell) {
  if (e.button !== 0) return;
  cancelDrag();                               // never leave an old one running
  if (justDragged) return;
  if (!slotsFor(where)?.[index]) return;      // nothing in this slot to pick up
  drag = { where, index, cell, x: e.clientX, y: e.clientY, ghost: null };
}

function onDragMove(e) {
  if (!drag) return;
  // If the button came up somewhere we never heard about — the pointer left the
  // window, another element captured it — the ghost would otherwise stay stuck
  // to the cursor for good. Finish the drag on the next movement instead.
  if (!(e.buttons & 1)) return endDrag(e);
  if (!drag.ghost) {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < DRAG_SLOP) return;
    const slot = slotsFor(drag.where)?.[drag.index];
    if (!slot) return cancelDrag();
    const def = ITEMS[slot.id] ?? {};
    drag.ghost = document.createElement('div');
    drag.ghost.id = 'dragghost';
    drag.ghost.innerHTML = `${def.icon ?? '?'}${slot.n > 1 ? `<span class="n">${slot.n}</span>` : ''}`;
    document.body.appendChild(drag.ghost);
    drag.cell.classList.add('dragging');
  }
  drag.ghost.style.left = `${e.clientX}px`;
  drag.ghost.style.top = `${e.clientY}px`;

  for (const el of document.querySelectorAll('.cell.drop')) el.classList.remove('drop');
  const over = cellUnder(e.clientX, e.clientY);
  if (over && !(over.where === drag.where && over.index === drag.index)) over.el.classList.add('drop');
}

function endDrag(e) {
  if (!drag) return;
  const dragged = !!drag.ghost;
  const from = drag;
  cancelDrag();
  if (!dragged) return;

  // Swallow the click the browser fires after the pointer is released.
  justDragged = true;
  setTimeout(() => { justDragged = false; }, 0);

  const over = cellUnder(e.clientX, e.clientY);
  if (!over) return;                                   // dropped outside: put it back
  if (over.where === from.where && over.index === from.index) return;
  if (dropStack(from.where, from.index, over.where, over.index)) {
    playSound('pickup', 0.9);
    // The detail pane is keyed to a slot index, and the slots just moved.
    selected = null;
    render();
    ctx.onChange?.();
  }
}

function cancelDrag() {
  if (!drag) return;
  drag.ghost?.remove();
  drag.cell.classList.remove('dragging');
  for (const el of document.querySelectorAll('.cell.drop')) el.classList.remove('drop');
  drag = null;
}

/**
 * Moves one slot onto another, across grids or within one.
 *
 * Anything that ends up in a storage box has to be reported, or the "store an
 * item" objective would only ever notice the click route. Counting the box
 * before and after is the honest way: a partial merge into a nearly full stack
 * stores fewer than were picked up.
 */
function dropStack(fromWhere, fromIndex, toWhere, toIndex) {
  const from = slotsFor(fromWhere);
  const to = slotsFor(toWhere);
  if (!from || !to || !from[fromIndex]) return false;

  const id = from[fromIndex].id;
  const before = toWhere === 'store' && fromWhere !== 'store' ? countItem(to, id) : 0;
  if (!moveSlot(from, fromIndex, to, toIndex)) return false;

  if (toWhere === 'store' && fromWhere !== 'store') {
    const stored = countItem(to, id) - before;
    if (stored > 0) ctx.onStore?.(id, stored);
  }
  return true;
}

const EQUIP_SLOTS = [
  ['weapon', 'WEAPON'], ['head', 'HEAD'], ['body', 'BODY'], ['feet', 'FEET'], ['back', 'BACKPACK'],
];

// ---------------------------------------------------------------- inventory

function renderInventory() {
  resizeInventory();
  $('inv-sub').textContent =
    `${slotCount() - freeSlots(state.inv)}/${slotCount()} slots · ${carriedWeight().toFixed(1)}/${carryLimit()} kg`;

  const grid = $('inv-grid');
  grid.innerHTML = gridHtml(state.inv, 'inv');
  bindGrid(grid, 'inv', (i) => {
    selected = state.inv[i] ? { where: 'inv', index: i } : null;
    renderInventory();
  });

  // Both hotbar slots are listed, not only the one in hand — the second is real
  // equipment and has to be visible and removable like anything else.
  const hot = hotbarView().map((h) => `
    <div class="eslot${h.item ? '' : ' none'}${h.active ? ' hot' : ''}" data-hot="${h.index}">
      <span class="ic">${h.icon ?? '·'}</span>
      <span class="tx"><b>SLOT ${h.key}</b><span>${h.name ?? 'empty'}</span></span>
    </div>`).join('');

  const worn = EQUIP_SLOTS.filter(([key]) => key !== 'weapon').map(([key, label]) => {
    const s = state.equip[key];
    const def = s ? ITEMS[s.id] : null;
    return `<div class="eslot${s ? '' : ' none'}" data-eq="${key}">
      <span class="ic">${def?.icon ?? '·'}</span>
      <span class="tx"><b>${label}</b><span>${def?.name ?? 'empty'}</span></span>
    </div>`;
  }).join('');

  $('equip-list').innerHTML = hot + worn;

  $('equip-list').querySelectorAll('.eslot').forEach((el) => {
    el.addEventListener('click', () => {
      if (el.dataset.hot === undefined) return unequip(el.dataset.eq);
      // Clicking a hotbar slot selects it; clicking the one already in hand
      // puts it away. One control, and the common action is the cheap one.
      const i = Number(el.dataset.hot);
      if (i === activeIndex()) {
        if (!stowSlot(i)) toast('No room in bag', 'bad');
      } else {
        selectSlot(i);
      }
      resizeInventory();
      renderInventory();
      ctx.onChange?.();
    });
  });

  renderDetail();
}

function renderDetail() {
  const box = $('inv-detail');
  if (!selected || selected.where !== 'inv' || !state.inv[selected.index]) {
    box.innerHTML = `<div class="stats" style="opacity:.4">Select an item.</div>`;
    return;
  }
  const slot = state.inv[selected.index];
  const def = ITEMS[slot.id];
  const lines = [];

  if (def.dmg) lines.push(`Damage <b>${def.dmg}</b> · Speed <b>${def.speed}s</b>${def.reach ? ` · Reach <b>${def.reach}m</b>` : ''}`);
  if (def.ranged) lines.push(`Ranged · uses <b>${ITEMS[def.ammo].name}</b> · you have <b>${countItem(state.inv, def.ammo)}</b>`);
  if (def.tool) lines.push(`<b>${TOOL_PURPOSE[def.tool] ?? ''}</b>`);
  if (def.armor) lines.push(`Absorbs <b>${Math.round(def.armor * 100)}%</b> damage`);
  if (def.slots) lines.push(`+<b>${def.slots}</b> slots · +<b>${def.carry}</b> kg carry`);
  if (def.food) lines.push(`Hunger <b>+${def.food}</b>`);
  if (def.water) lines.push(`Thirst <b>+${def.water}</b>`);
  if (def.hp) lines.push(`Health <b>${def.hp > 0 ? '+' : ''}${def.hp}</b>`);
  if (def.cure) lines.push(`Cures poison`);
  if (def.dur && slot.dur !== undefined) lines.push(`Durability <b>${slot.dur}/${def.dur}</b>`);
  if (def.build) lines.push(`Placeable at home — press <kbd>B</kbd>`);
  lines.push(`Weight <b>${(def.weight * slot.n).toFixed(1)} kg</b>`);

  const acts = [];
  if (def.cat === 'food' || def.cat === 'med') acts.push(`<button class="btn" data-a="use">USE</button>`);
  if (def.cat === 'weapon' || def.cat === 'tool' || def.cat === 'armor') acts.push(`<button class="btn" data-a="equip">EQUIP</button>`);
  acts.push(`<button class="btn ghost" data-a="drop">DROP${slot.n > 1 ? ' ALL' : ''}</button>`);

  box.innerHTML = `<h4>${def.icon} ${def.name}</h4>
    <div class="cat">${def.cat.toUpperCase()}</div>
    <div class="stats">${lines.join('<br>')}</div>
    <div class="acts">${acts.join('')}</div>`;

  box.querySelectorAll('[data-a]').forEach((b) => {
    b.addEventListener('click', () => itemAction(b.dataset.a));
  });
}

function itemAction(action) {
  const i = selected.index;
  const slot = state.inv[i];
  if (!slot) return;
  const def = ITEMS[slot.id];

  if (action === 'drop') {
    removeAt(state.inv, i, Infinity);
    selected = null;
    toast(`Dropped ${def.name}`, 'info');
  } else if (action === 'equip') {
    const taken = removeAt(state.inv, i, 1);
    if (def.cat === 'armor') {
      const prev = state.equip[def.slot];
      state.equip[def.slot] = taken;
      if (prev) addItem(state.inv, prev.id, prev.n, prev.dur);
    } else {
      // Weapons and tools go to a hotbar slot: the free one if there is one, so
      // an axe and a pickaxe end up on 1 and 2 without anyone being asked.
      const displaced = equipToSlot(taken);
      if (displaced) addItem(state.inv, displaced.id, displaced.n, displaced.dur);
    }
    resizeInventory();
    selected = null;
    toast(`Equipped ${def.name}`, 'info');
  } else if (action === 'use') {
    ctx.onUse?.(i);
    selected = null;
  }
  renderInventory();
  ctx.onChange?.();
}

function unequip(key) {
  // The weapon "slot" is a view of the active hotbar slot, so putting it away
  // has to go through the hotbar or the two would disagree about what is in hand.
  if (key === 'weapon') {
    if (!stowSlot(activeIndex())) toast('No room in bag', 'bad');
    resizeInventory();
    renderInventory();
    ctx.onChange?.();
    return;
  }
  const s = state.equip[key];
  if (!s) return;
  if (key === 'back' && freeSlots(state.inv) < 1) { toast('No room to unpack', 'bad'); return; }
  state.equip[key] = null;
  const left = addItem(state.inv, s.id, s.n, s.dur);
  if (left > 0) { state.equip[key] = s; toast('No room in bag', 'bad'); }
  resizeInventory();
  renderInventory();
  ctx.onChange?.();
}

// ---------------------------------------------------------------- storage

function renderStorage() {
  if (!storageCell) return closePanels();
  const box = storageCell.contents;

  const g1 = $('store-grid');
  g1.innerHTML = gridHtml(box, 'store');
  bindGrid(g1, 'store', (i) => {
    const taken = removeAt(box, i, Infinity);
    if (!taken) return;
    const left = addItem(state.inv, taken.id, taken.n, taken.dur);
    if (left > 0) addItem(box, taken.id, left, taken.dur);
    renderStorage();
    ctx.onChange?.();
  });

  const g2 = $('store-inv');
  g2.innerHTML = gridHtml(state.inv, 'inv');
  bindGrid(g2, 'inv', (i) => {
    const taken = removeAt(state.inv, i, Infinity);
    if (!taken) return;
    const left = addItem(box, taken.id, taken.n, taken.dur);
    if (left > 0) addItem(state.inv, taken.id, left, taken.dur);
    const stored = taken.n - left;
    if (stored > 0) ctx.onStore?.(taken.id, stored);
    renderStorage();
    ctx.onChange?.();
  });
}

// ---------------------------------------------------------------- unlocks
//
// Everything the game has to give, in the order it gives it.
//
// Grouped by level rather than listed A to Z, because the level is what the
// player is actually working on: a flat list answers "what exists", and this has
// to answer "what is next". Locked entries are shown in full — name, icon and
// what it is for — since a reward you cannot see is not a reward you can aim at.

const UNLOCK_FILTERS = [
  { id: 'all', name: 'All' },
  { id: 'recipe', name: 'Crafting' },
  { id: 'building_piece', name: 'Building' },
  { id: 'land_plot', name: 'Land' },
];
const TYPE_LABEL = { recipe: 'RECIPE', building_piece: 'BUILDING', land_plot: 'LAND' };
let unlockFilter = 'all';

function renderUnlocks() {
  const lv = playerLevel();
  const shown = UNLOCKS.filter((u) => unlockFilter === 'all' || u.type === unlockFilter);
  const open = shown.filter((u) => isUnlocked(u.id)).length;

  $('unlocks-sub').textContent = `Level ${lv} · ${open} of ${shown.length} unlocked`;

  $('unlock-tabs').innerHTML = UNLOCK_FILTERS.map((f) =>
    `<button class="tab${f.id === unlockFilter ? ' on' : ''}" data-uf="${f.id}">${f.name.toUpperCase()}</button>`).join('');
  $('unlock-tabs').querySelectorAll('[data-uf]').forEach((b) => {
    b.addEventListener('click', () => { unlockFilter = b.dataset.uf; playSound('ui'); renderUnlocks(); });
  });

  // Bucket by level, then walk the levels in order so the list reads as a road
  // ahead rather than as a table.
  const byLevel = new Map();
  for (const u of shown) {
    if (!byLevel.has(u.lvl)) byLevel.set(u.lvl, []);
    byLevel.get(u.lvl).push(u);
  }
  const levels = [...byLevel.keys()].sort((a, b) => a - b);

  $('unlocks-list').innerHTML = levels.map((n) => {
    const entries = byLevel.get(n);
    const reached = lv >= n;
    const cards = entries.map((u) => {
      const got = isUnlocked(u.id);
      // A prerequisite that is still missing is worth saying: the level alone
      // does not explain why something at or below your level is still shut.
      const why = got ? null : lockReason(u.id);
      return `<div class="ucard ${got ? 'open' : 'shut'}">
        <div class="uic">${u.icon}</div>
        <div>
          <div class="un">${u.title}</div>
          <div class="ud">${got ? u.desc : why ?? u.desc}</div>
          <div class="ut">${TYPE_LABEL[u.type] ?? u.type}</div>
        </div>
      </div>`;
    }).join('');
    return `<div class="lvgroup ${reached ? 'reached' : 'locked'}">
      <div class="lvhead"><b>LEVEL ${n}</b>
        <span class="cnt">${reached ? 'unlocked' : `${entries.length} to come`}</span></div>
      <div class="ugrid">${cards}</div>
    </div>`;
  }).join('') || '<div style="opacity:.4;font-size:11px">Nothing in this category.</div>';
}

// ---------------------------------------------------------------- land

// Which plot the player has selected in the grid. Kept out of the world so
// opening the panel twice does not carry a stale selection back in.
let landPick = null;

/** Opens the panel already looking at one plot — used when clicking the ground. */
export function focusPlot(id) { landPick = id; if (current === 'land') renderLand(); }

function renderLand() {
  $('land-balance').textContent = formatMoney(getBalance(SURV));

  // Laid out as it sits in the world: north at the top, matching the overhead
  // camera, so the square you press is the ground you were just looking at.
  const cells = [];
  for (let pz = -1; pz <= 1; pz++) {
    for (let px = -1; px <= 1; px++) {
      const plot = PLOTS.find((p) => p.px === px && p.pz === pz);
      if (!plot) { cells.push('<div></div>'); continue; }
      const st = plotStatus(plot.id);
      const cls = [
        'lp',
        plot.free ? 'home' : '',
        st.owned ? 'owned' : '',
        !st.owned && !st.levelOk ? 'locked-lvl' : '',
        landPick === plot.id ? 'sel' : '',
      ].filter(Boolean).join(' ');
      const foot = plot.free ? 'Home' : st.owned ? 'Owned'
        : !st.levelOk ? `Lv ${plot.lvl}` : formatMoney(plot.price).replace(' $SURV', '');
      cells.push(`<div class="${cls}" data-plot="${plot.id}">
        <div class="lpn">${plot.name}</div><div class="lpp">${foot}</div></div>`);
    }
  }
  $('land-grid').innerHTML = cells.join('');
  $('land-grid').querySelectorAll('[data-plot]').forEach((el) => {
    el.addEventListener('click', () => { landPick = el.dataset.plot; playSound('ui'); renderLand(); });
  });

  renderLandInfo();
}

function renderLandInfo() {
  const box = $('land-info');
  if (!landPick) {
    box.innerHTML = '<div class="row" style="opacity:.5">Pick a plot to see what it costs.</div>';
    return;
  }
  const st = plotStatus(landPick);
  if (!st) { box.innerHTML = ''; return; }
  const { plot } = st;

  const rows = [
    `<div class="row"><span>Size</span><span>${plot.max.gx - plot.min.gx + 1} × ${plot.max.gz - plot.min.gz + 1} cells</span></div>`,
  ];
  if (!plot.free) {
    rows.push(`<div class="row"><span>Price</span><span>${formatMoney(plot.price)}</span></div>`);
    if (plot.lvl > 1) rows.push(`<div class="row"><span>Requires</span><span>Level ${plot.lvl}</span></div>`);
  }
  rows.push(`<div class="row"><span>Your balance</span><span>${formatMoney(st.balance)}</span></div>`);

  const action = st.owned || plot.free
    ? `<div class="owned">✓ This ground is yours — build on it.</div>`
    : `<button class="btn${st.canBuy ? '' : ' ghost'}" id="land-buy"${st.canBuy ? '' : ' disabled'}>UNLOCK PLOT</button>`
      + (st.reason ? `<div class="why">${st.reason}</div>` : '');

  box.innerHTML = `<h4>${plot.name}</h4>${rows.join('')}<div style="margin-top:10px">${action}</div>`;

  const btn = $('land-buy');
  if (!btn) return;
  btn.addEventListener('click', () => {
    // Disabled immediately: the land system refuses a second purchase anyway,
    // but a button that still looks pressable after the first click invites the
    // second one.
    btn.disabled = true;
    const res = buyPlot(plot.id);
    if (res.ok) {
      playSound('craft');
      toast(`<b>${res.plot.name}</b> unlocked`, 'info');
    } else {
      playSound('deny');
      toast(res.reason ?? 'Could not unlock that', 'bad');
    }
    renderLand();
    ctx.onChange?.();
  }, { once: true });
}

// ---------------------------------------------------------------- crafting

function renderCrafting() {
  const available = ctx.availableStations?.() ?? ['hands'];

  $('craft-tabs').innerHTML = Object.entries(STATIONS).map(([id, s]) => {
    const usable = available.includes(id);
    return `<button class="tab${id === craftStation ? ' on' : ''}" data-st="${id}" ${usable ? '' : 'disabled'}>${s.icon} ${s.name.toUpperCase()}</button>`;
  }).join('');
  $('craft-tabs').querySelectorAll('.tab').forEach((b) => {
    b.addEventListener('click', () => { craftStation = b.dataset.st; renderCrafting(); });
  });

  const lv = level();
  $('craft-sub').textContent = `Level ${lv.lvl} · ${lv.into}/${lv.need} XP`;

  const list = recipesFor(craftStation);
  $('craft-list').innerHTML = list.map((r, i) => {
    const st = recipeStatus(r);
    const out = ITEMS[r.out.id];
    // Locked recipes stay on the list rather than being hidden: knowing what is
    // coming, and at which level, is half of what makes levelling feel like it
    // leads somewhere. The reason comes from the unlock catalogue so it also
    // covers a missing prerequisite, not only the level.
    const gate = lockReason(recipeUnlockId(r.out.id));
    const locked = !!gate;
    const ings = r.in.map((ing) => {
      const have = countItem(state.inv, ing.id);
      const cls = have >= ing.n ? 'ok' : 'no';
      return `<span class="${cls}">${ITEMS[ing.id].icon} ${have}/${ing.n}</span>`;
    }).join('');
    return `<div class="rec${locked ? ' locked' : ''}">
      <div class="top">
        <span class="ic">${out.icon}</span>
        <span class="nm">${out.name}${r.out.n > 1 ? ` ×${r.out.n}` : ''}</span>
        <span class="lv">LV ${r.lvl}</span>
      </div>
      ${out.tool ? `<div class="purpose">${TOOL_PURPOSE[out.tool] ?? ''}</div>` : ''}
      ${locked ? `<div class="gate">🔒 ${gate}</div>` : `<div class="ing">${ings}</div>`}
      <button class="btn" data-r="${i}" ${st.ok ? '' : 'disabled'}>${st.ok ? 'CRAFT' : st.why.toUpperCase()}</button>
    </div>`;
  }).join('') || `<div style="opacity:.4;font-size:11px">Nothing craftable here yet.</div>`;

  $('craft-list').querySelectorAll('[data-r]').forEach((b) => {
    b.addEventListener('click', () => {
      const r = list[Number(b.dataset.r)];
      const res = craft(r);
      if (res.ok) {
        toast(`Crafted ${res.made} <span style="opacity:.6">+${res.xp} XP</span>`);
        playSound('craft');
      } else {
        toast(res.why, 'bad');
        playSound('deny');
      }
      renderCrafting();
      ctx.onChange?.();
    });
  });
}

// ---------------------------------------------------------------- map

function renderMap() {
  $('map-sub').textContent = `⚡ ${Math.floor(state.energy)} energy`;

  $('map-list').innerHTML = LOCATIONS.map((l) => {
    const here = state.locationId === l.id;
    const grave = state.graves[l.id]?.length;
    const needKey = l.requires && countItem(state.inv, l.requires) < 1;
    const noEnergy = state.energy < l.energy;
    const disabled = here || needKey || noEnergy;
    const why = here ? 'YOU ARE HERE' : needKey ? 'NEEDS KEYCARD' : noEnergy ? 'NOT ENOUGH ENERGY' : 'TRAVEL';
    return `<div class="loc t${l.tier}">
      <h4>${l.name}</h4>
      <div class="meta">${l.timer ? `${Math.floor(l.timer / 60)} MIN LIMIT` : 'NO TIME LIMIT'}</div>
      <p>${l.desc}</p>
      ${grave ? `<div class="grave">⚰ Your bag is here — ${grave} stack${grave > 1 ? 's' : ''}</div>` : ''}
      <div class="cost">⚡ ${l.energy} energy${l.requires ? ` · 🎫 keycard` : ''}</div>
      <button class="btn" data-loc="${l.id}" ${disabled ? 'disabled' : ''}>${why}</button>
    </div>`;
  }).join('');

  $('map-list').querySelectorAll('[data-loc]').forEach((b) => {
    b.addEventListener('click', () => { closePanels(); ctx.onTravel?.(b.dataset.loc); });
  });
}
