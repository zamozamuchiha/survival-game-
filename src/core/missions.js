import { MISSIONS, missionById, FIRST_MISSION } from '../data/missions.js';
import { state } from './state.js';

// Mission tracking.
//
// The game calls report() when something happens; this file decides whether that
// advances the current mission. Nothing else in the codebase needs to know a
// mission exists — the call sites just say what the player did.
//
// Progress lives in state.missions so it saves with everything else:
//   { active, done: [ids], progress: { goalIndex: count } }

let listener = null;

/** Called with (mission, kind) when a mission is completed or a goal ticks. */
export function onMissionEvent(fn) { listener = fn; }

function ensure() {
  if (!state.missions) {
    state.missions = { active: FIRST_MISSION, done: [], progress: {} };
  }
  // A save from before a mission existed, or from a build where the chain was
  // extended: pick up wherever the player left off rather than starting over.
  if (state.missions.active === undefined) state.missions.active = FIRST_MISSION;
  return state.missions;
}

export function activeMission() {
  const m = ensure();
  return m.active ? missionById(m.active) : null;
}

/** Progress counts for the active mission's goals, in goal order. */
export function activeProgress() {
  const m = ensure();
  const mission = activeMission();
  if (!mission) return [];
  return mission.goals.map((g, i) => Math.min(g.n, m.progress[i] ?? 0));
}

export function isComplete(mission, progress) {
  return mission.goals.every((g, i) => (progress[i] ?? 0) >= g.n);
}

/**
 * Records something the player did.
 *
 * @param kind  'collect' | 'craft' | 'harvest' | 'kill' | 'build' | 'store' | 'travel'
 * @param what  item id, node type, zombie type or location id
 * @param n     how many
 */
export function report(kind, what, n = 1) {
  const m = ensure();
  const mission = activeMission();
  if (!mission || n <= 0) return;

  let ticked = false;
  mission.goals.forEach((goal, i) => {
    if (goal.kind !== kind) return;
    if (goal.what !== 'any' && goal.what !== what) return;
    const before = m.progress[i] ?? 0;
    if (before >= goal.n) return;
    m.progress[i] = Math.min(goal.n, before + n);
    ticked = true;
  });
  if (!ticked) return;

  const progress = mission.goals.map((g, i) => m.progress[i] ?? 0);
  if (isComplete(mission, progress)) finish(mission);
  else listener?.(mission, 'progress');
}

function finish(mission) {
  const m = ensure();
  if (mission.reward?.xp) state.xp += mission.reward.xp;
  m.done.push(mission.id);
  m.active = mission.next ?? null;
  m.progress = {};
  listener?.(mission, 'complete');
}

/**
 * Goals like "reach Pine Bushes" then "get back to camp" are the same kind and
 * must be satisfied in order, so travel is reported through here — it only ticks
 * the first unmet travel goal rather than every matching one.
 */
export function reportTravel(locationId) {
  const m = ensure();
  const mission = activeMission();
  if (!mission) return;

  const i = mission.goals.findIndex((g, idx) =>
    g.kind === 'travel' && (m.progress[idx] ?? 0) < g.n);
  if (i < 0) return;
  if (mission.goals[i].what !== locationId) return;

  m.progress[i] = mission.goals[i].n;
  const progress = mission.goals.map((g, idx) => m.progress[idx] ?? 0);
  if (isComplete(mission, progress)) finish(mission);
  else listener?.(mission, 'progress');
}

/** For the map/journal: everything, with its state. */
export function missionList() {
  const m = ensure();
  return MISSIONS.map((mission) => ({
    mission,
    state: m.done.includes(mission.id) ? 'done'
      : mission.id === m.active ? 'active'
      : 'locked',
  }));
}
