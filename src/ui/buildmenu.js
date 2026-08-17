import { state } from '../core/state.js';
import { countItem } from '../core/inventory.js';
import { ITEMS } from '../data/items.js';
import { BUILDING, BUILD_TABS, blueprintsIn } from '../data/building.js';

// The build menu, and the strip along the bottom while you're placing.
//
// Both are drawn straight from the catalogue, so a new blueprint appears in the
// menu under its layer's tab without anything here being told about it.

const $ = (id) => document.getElementById(id);

// The controller is rebuilt whenever the home base is, so the menu holds a
// getter rather than the object itself.
let getCtrl = () => null;
let tab = BUILD_TABS[0].id;

export function initBuildMenu(controllerFn) {
  getCtrl = controllerFn;
  $('bm-close').addEventListener('click', () => close());
  $('bm-tabs').addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (!t) return;
    tab = t.dataset.tab;
    render();
  });
  $('bm-list').addEventListener('click', (e) => {
    const card = e.target.closest('[data-bp]');
    if (!card) return;
    getCtrl()?.select(card.dataset.bp);
    close();
    renderHint();
  });
}

export function isBuildMenuOpen() { return $('buildmenu').classList.contains('on'); }

export function open() {
  $('buildmenu').classList.add('on');
  render();
}

export function close() {
  $('buildmenu').classList.remove('on');
}

/** Redraw whatever is on screen — call it when the bag changes. */
export function refreshBuildMenu() {
  if (isBuildMenuOpen()) render();
  renderHint();
}

const resName = (id) => ITEMS[id]?.name ?? id;
const resIcon = (id) => ITEMS[id]?.icon ?? '•';

function render() {
  const ctrl = getCtrl();
  if (!ctrl) return;
  $('bm-tabs').innerHTML = BUILD_TABS.map((t) =>
    `<div class="bm-tab${t.id === tab ? ' on' : ''}" data-tab="${t.id}">${t.name}</div>`).join('');

  const active = BUILD_TABS.find((t) => t.id === tab) ?? BUILD_TABS[0];
  $('bm-list').innerHTML = blueprintsIn(active).map((id) => {
    const bp = BUILDING[id];
    const gate = ctrl.unlocked(id);
    const locked = gate !== true;
    const missing = ctrl.missingFor(id);
    const poor = missing.length > 0;

    const cost = Object.entries(bp.cost).map(([res, n]) => {
      const have = countItem(state.inv, res);
      return `<span class="bm-cost${have < n ? ' short' : ''}" title="${resName(res)}">
        ${resIcon(res)} <b>${have}</b>/${n}</span>`;
    }).join('');

    return `<div class="bm-card${locked ? ' locked' : poor ? ' poor' : ''}" data-bp="${id}">
      <div class="bm-icon">${bp.icon}</div>
      <div class="bm-body">
        <div class="bm-name">${bp.label}</div>
        <div class="bm-hint">${locked ? gate : bp.hint}</div>
        <div class="bm-costs">${cost}</div>
      </div>
    </div>`;
  }).join('');
}

/** The strip that says what you're holding and which keys do what. */
function renderHint() {
  const ctrl = getCtrl();
  const el = $('buildhint');
  if (!ctrl?.active) { el.classList.remove('on'); return; }
  el.classList.add('on');

  if (ctrl.removing) {
    el.innerHTML = `<span class="bh-pick bh-demo">✕ <b>Demolition</b> <i>half the materials come back</i></span>
      <span class="bh-keys">
        <b>CLICK</b> take down &nbsp; <b>X</b> back to building &nbsp; <b>ESC</b> exit</span>`;
    return;
  }

  const id = ctrl.selected;
  if (!id) {
    el.innerHTML = `<span class="bh-pick">Nothing selected</span>
      <span class="bh-keys"><b>B</b> menu &nbsp; <b>X</b> demolish &nbsp; <b>ESC</b> leave build mode</span>`;
    return;
  }
  const bp = BUILDING[id];
  const cost = Object.entries(bp.cost)
    .map(([res, n]) => `${resIcon(res)}${n}`).join(' ');
  el.innerHTML = `<span class="bh-pick">${bp.icon} <b>${bp.label}</b> <i>${cost}</i></span>
    <span class="bh-keys">
      <b>CLICK</b> place &nbsp; <b>X</b> demolish &nbsp;
      <b>R</b> rotate &nbsp; <b>B</b> menu &nbsp; <b>ESC</b> exit</span>`;
}

export { renderHint as refreshBuildHint };
