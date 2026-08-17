import { ITEMS, FISTS } from '../data/items.js';
import { state, level, carriedWeight, carryLimit, armorRating } from '../core/state.js';
import { ENERGY_MAX } from '../data/locations.js';
import { activeMission, activeProgress } from '../core/missions.js';

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
  weapon: $('chip-weapon'), weight: $('chip-weight'), armor: $('chip-armor'),
  prompt: $('prompt'), promptText: $('prompt-text'),
  searchbar: $('searchbar'), searchFill: $('searchbar').querySelector('i'),
  mission: $('mission'), missionTitle: $('mission-title'), missionGoals: $('mission-goals'),
};

// Rebuilding the objective list every frame would fight the CSS transitions and
// churn the DOM for nothing, so it's only redrawn when the text would change.
let missionSignature = '';

/**
 * Draws the objective tracker.
 *
 * The hint only shows while nothing has been done yet — once the player is
 * clearly getting on with it, telling them which key to press is noise.
 */
function updateMission() {
  const mission = activeMission();
  if (!mission) {
    els.mission.classList.add('hide');
    missionSignature = '';
    return;
  }
  els.mission.classList.remove('hide');

  const progress = activeProgress();
  const signature = `${mission.id}|${progress.join(',')}`;
  if (signature === missionSignature) return;
  missionSignature = signature;

  els.missionTitle.textContent = mission.title;
  const untouched = progress.every((p) => p === 0);
  els.missionGoals.innerHTML = mission.goals.map((g, i) => {
    const have = progress[i] ?? 0;
    return `<div class="goal${have >= g.n ? ' done' : ''}">
      <span>${g.label}</span><i>${have}/${g.n}</i></div>`;
  }).join('') + (untouched && mission.hint ? `<div class="mhint">${mission.hint}</div>` : '');
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

  // weapon chip with durability
  const eq = state.equip.weapon;
  const def = eq ? ITEMS[eq.id] : null;
  els.weapon.querySelector('em').textContent = def ? def.name : FISTS.name;
  const dur = els.weapon.querySelector('.durbar');
  if (def?.dur && eq.dur !== undefined) {
    const pct = Math.max(0, eq.dur / def.dur);
    dur.style.display = 'block';
    dur.querySelector('i').style.width = `${pct * 100}%`;
    dur.className = `durbar${pct < 0.15 ? ' crit' : pct < 0.35 ? ' low' : ''}`;
  } else {
    dur.style.display = 'none';
  }

  const w = carriedWeight();
  const cap = carryLimit();
  els.weight.querySelector('em').textContent = `${w.toFixed(1)} / ${cap} kg`;
  els.weight.className = `chip${w > cap ? ' warn' : ''}`;
  els.armor.querySelector('em').textContent = `${Math.round(armorRating() * 100)}%`;

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
