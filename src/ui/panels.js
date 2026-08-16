import { ITEMS } from '../data/items.js';
import { STATIONS } from '../data/recipes.js';
import { LOCATIONS, locationById } from '../data/locations.js';
import { state, level, slotCount, carryLimit, carriedWeight, resizeInventory } from '../core/state.js';
import { addItem, removeAt, countItem, freeSlots } from '../core/inventory.js';
import { recipesFor, recipeStatus, craft } from '../core/crafting.js';
import { toast } from './toast.js';

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
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) closePanels(); });
}

export const isPanelOpen = () => current !== null;
export const currentPanel = () => current;

export function openPanel(name, opts = {}) {
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
    c.addEventListener('click', () => onClick(Number(c.dataset.i), where));
  });
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

  $('equip-list').innerHTML = EQUIP_SLOTS.map(([key, label]) => {
    const s = state.equip[key];
    const def = s ? ITEMS[s.id] : null;
    return `<div class="eslot${s ? '' : ' none'}" data-eq="${key}">
      <span class="ic">${def?.icon ?? '·'}</span>
      <span class="tx"><b>${label}</b><span>${def?.name ?? 'empty'}</span></span>
    </div>`;
  }).join('');

  $('equip-list').querySelectorAll('.eslot').forEach((el) => {
    el.addEventListener('click', () => unequip(el.dataset.eq));
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
  if (def.tool) lines.push(`Efficient for <b>${def.tool}</b> nodes`);
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
    const key = def.cat === 'armor' ? def.slot : 'weapon';
    const taken = removeAt(state.inv, i, 1);
    const prev = state.equip[key];
    state.equip[key] = taken;
    if (prev) addItem(state.inv, prev.id, prev.n, prev.dur);
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
    renderStorage();
    ctx.onChange?.();
  });
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
    const locked = lv.lvl < r.lvl;
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
      <div class="ing">${ings}</div>
      <button class="btn" data-r="${i}" ${st.ok ? '' : 'disabled'}>${st.ok ? 'CRAFT' : st.why.toUpperCase()}</button>
    </div>`;
  }).join('') || `<div style="opacity:.4;font-size:11px">Nothing craftable here yet.</div>`;

  $('craft-list').querySelectorAll('[data-r]').forEach((b) => {
    b.addEventListener('click', () => {
      const r = list[Number(b.dataset.r)];
      const res = craft(r);
      if (res.ok) toast(`Crafted ${res.made} <span style="opacity:.6">+${res.xp} XP</span>`);
      else toast(res.why, 'bad');
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
