import { ITEMS, FISTS } from '../data/items.js';
import { state, level, carriedWeight, carryLimit, armorRating } from '../core/state.js';
import { ENERGY_MAX } from '../data/locations.js';
import { getBalance, SURV } from '../core/wallet.js';
import { hotbarView } from '../core/hotbar.js';
import { activeMissions, progressOf, goalTarget, goalNote, onMissionEvent, chapterProgress }
  from '../core/missions.js';

const $ = (id) => document.getElementById(id);

const fill = {
  hp: $('v-hp').querySelector('i'),
  food: $('v-food').querySelector('i'),
  water: $('v-water').querySelector('i'),
  stam: $('v-stam').querySelector('i'),
  xp: $('v-xp').querySelector('i'),
};
const els = {
  lvl: $('lvl'), locName: $('loc-name'), locTier: $('loc-tier'),
  timer: $('timer'), energy: $('energy'),
  hotbar: $('hotbar'), weight: $('chip-weight'), armor: $('chip-armor'),
  surv: $('chip-surv'),
  prompt: $('prompt'), promptText: $('prompt-text'),
  searchbar: $('searchbar'), searchFill: $('searchbar').querySelector('i'),
  mission: $('mission'), missionStep: $('mission-step'), missionChapter: $('mission-chapter'),
  missionTitle: $('mission-title'), missionGoals: $('mission-goals'),
  missionSide: $('mission-side'),
};

// Rebuilding the objective list every frame would fight the CSS transitions and
// churn the DOM for nothing, so it's only redrawn when the text would change.
let missionSignature = '';

// A finished mission is held on screen for a moment with everything ticked off,
// so the player sees it complete rather than the tracker silently swapping to
// the next objective. The delay matches the toast that announces the next one.
const HOLD_MS = 2200;
let celebrating = null;
onMissionEvent((mission, kind) => {
  if (kind === 'complete') celebrating = { mission, until: performance.now() + HOLD_MS };
});

const goalRow = (goal, have) => {
  // Measured goals have no fixed target, so ask for it rather than reading goal.n.
  const need = goalTarget(goal);
  const done = have >= need;
  // The counter says how far along you are; the note says what the rest costs.
  const note = done ? null : goalNote(goal);
  // A bar earns its place when the number is too big to feel. "0/1" is already
  // a bar with two states, and drawing one under it is clutter.
  const pct = need > 0 ? Math.min(100, (have / need) * 100) : 0;
  const bar = need >= 3 ? `<div class="bar"><u style="width:${pct.toFixed(1)}%"></u></div>` : '';
  return `<div class="goal${done ? ' done' : ''}${bar ? '' : ' plain'}">
      <div class="row"><span>${goal.label}</span><i>${have}/${need}</i></div>
      ${bar}${note ? `<div class="gnote">${note}</div>` : ''}
    </div>`;
};

/**
 * Draws the objective tracker: which required mission you are on, its goals with
 * live counters, and any optional mission running alongside it.
 *
 * The hint only shows while nothing has been done yet — once the player is
 * clearly getting on with it, telling them which key to press is noise.
 */
function updateMission() {
  const holding = celebrating && performance.now() < celebrating.until;
  if (!holding) celebrating = null;

  const open = activeMissions();
  const mission = holding ? celebrating.mission : open.find((m) => !m.optional) ?? open[0];
  if (!mission) {
    // Everything done — say so rather than leaving a blank corner.
    if (missionSignature !== 'all-done') {
      missionSignature = 'all-done';
      els.missionChapter.textContent = '';
      els.missionStep.textContent = '';
      els.missionTitle.textContent = 'All objectives complete';
      els.missionGoals.innerHTML = '<div class="mhint">Survive.</div>';
      els.missionSide.innerHTML = '';
    }
    els.mission.classList.remove('hide');
    return;
  }
  els.mission.classList.remove('hide');

  const progress = holding ? mission.goals.map(goalTarget) : progressOf(mission);
  const side = open.filter((m) => m.optional && m !== mission);
  const sideBits = side.map((m) => `${m.id}:${progressOf(m).join('.')}`).join('|');

  // Position within the chapter, not across the whole game: "2 of 2" tells you
  // the chapter is about to close, where "2 of 5" tells you nothing you can act on.
  const place = chapterProgress(mission);

  const notes = mission.goals.map(goalNote).join('~');
  const signature = `${mission.id}|${progress.join(',')}|${holding}|${sideBits}|${notes}`;
  if (signature === missionSignature) return;
  missionSignature = signature;

  // "CH 2 · SHELTER" rather than the full word: the panel is narrow, and the
  // chapter's name is the part that carries meaning.
  els.missionChapter.textContent = place
    ? `CH ${place.chapter.n} · ${place.chapter.title.toUpperCase()}` : '';
  els.missionStep.textContent = place ? `${place.step}/${place.total}` : '';
  els.missionTitle.textContent = mission.title;

  const untouched = progress.every((p) => p === 0);
  els.missionGoals.innerHTML = mission.goals.map((g, i) => goalRow(g, progress[i] ?? 0)).join('')
    + (holding ? '<div class="mdone">Mission complete</div>' : '')
    + (!holding && untouched && mission.hint ? `<div class="mhint">${mission.hint}</div>` : '');

  els.missionSide.innerHTML = side.map((m) => {
    const p = progressOf(m);
    return `<div class="mside">
      <div class="mhead"><span>OPTIONAL</span></div>
      <div class="stitle">${m.title}</div>
      ${m.goals.map((g, i) => goalRow(g, p[i] ?? 0)).join('')}</div>`;
  }).join('');
}

// The hotbar is rebuilt only when it would look different — it is redrawn every
// frame otherwise, and swapping innerHTML sixty times a second for no reason
// throws away the CSS transitions along with the cycles.
let hotbarSignature = '';

function updateHotbar() {
  const view = hotbarView();
  const signature = view.map((h) =>
    `${h.index}${h.active ? '*' : ''}:${h.item?.id ?? '-'}:${h.wear === null ? '' : Math.round(h.wear * 40)}`
  ).join('|');
  if (signature === hotbarSignature) return;
  hotbarSignature = signature;

  els.hotbar.innerHTML = view.map((h) => {
    // An empty slot in hand still shows what you are actually swinging.
    const name = h.item ? (h.broken ? `${h.name} (broken)` : h.name)
      : h.active ? FISTS.name : 'empty';
    const bar = h.wear === null ? '' :
      `<div class="dur${h.wear < 0.15 ? ' crit' : h.wear < 0.35 ? ' low' : ''}">
         <i style="width:${Math.max(0, h.wear) * 100}%"></i></div>`;
    return `<div class="hslot${h.active ? ' on' : ''}${h.item ? '' : ' empty'}">
      <span class="num">${h.key}</span>
      <span class="ic">${h.icon ?? '✊'}</span>
      <span class="nm">${name}</span>${bar}</div>`;
  }).join('');
}

const TIER_LABEL = ['STARTING AREA', 'LOW THREAT', 'MODERATE THREAT', 'EXTREME THREAT'];

const mmss = (s) => {
  const m = Math.floor(Math.max(0, s) / 60);
  const ss = Math.floor(Math.max(0, s) % 60);
  return `${m}:${String(ss).padStart(2, '0')}`;
};

export function updateHud(locDef, prompt, search) {
  updateMission();
  fill.hp.style.width = `${state.hp}%`;
  fill.food.style.width = `${state.hunger}%`;
  fill.water.style.width = `${state.thirst}%`;
  fill.stam.style.width = `${state.stamina}%`;

  const lv = level();
  els.lvl.textContent = `LV ${lv.lvl}`;
  fill.xp.style.width = `${(lv.into / lv.need) * 100}%`;

  els.locName.textContent = locDef.name;
  els.locTier.textContent = TIER_LABEL[locDef.tier] ?? '';

  if (locDef.timer > 0) {
    els.timer.textContent = mmss(state.timeLeft);
    els.timer.className = `timer${state.timeLeft < 30 ? ' crit' : state.timeLeft < 60 ? ' warn' : ''}`;
  } else {
    els.timer.textContent = '';
    els.timer.className = 'timer';
  }
  els.energy.textContent = `⚡ ${Math.floor(state.energy)} / ${ENERGY_MAX}`;

  updateHotbar();

  const w = carriedWeight();
  const cap = carryLimit();
  els.weight.querySelector('em').textContent = `${w.toFixed(1)} / ${cap} kg`;
  els.weight.className = `chip${w > cap ? ' warn' : ''}`;
  els.armor.querySelector('em').textContent = `${Math.round(armorRating() * 100)}%`;
  // Grouped: a seven-figure balance is unreadable as a run of digits.
  els.surv.querySelector('em').textContent = getBalance(SURV).toLocaleString('en-US');

  if (prompt) {
    els.promptText.innerHTML = prompt;
    els.prompt.classList.add('on');
  } else {
    els.prompt.classList.remove('on');
  }

  if (search && search.total > 0) {
    els.searchbar.classList.add('on');
    els.searchFill.style.width = `${Math.min(1, search.progress / search.total) * 100}%`;
  } else {
    els.searchbar.classList.remove('on');
  }
}

export function hideLoader() { $('load')?.remove(); }
export function setLoaderText(t) { const l = $('load'); if (l) l.textContent = t; }

export function showDeath(on, text = '') {
  $('dead').classList.toggle('on', on);
  if (on) $('dead-text').innerHTML = text;
}

export function onRespawn(fn) { $('dead-btn').addEventListener('click', fn); }
