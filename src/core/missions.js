import { MISSIONS, missionById, CHAPTERS, chapterByNumber } from '../data/missions.js';
import { state } from './state.js';
import { addXp } from './progress.js';

// Mission tracking.
//
// The game calls report() when something happens; this file decides whether that
// advances anything. No call site needs to know a mission exists — it just says
// what the player did, and the table in data/missions.js decides what that means.
//
// Status is derived, never stored. A mission is
//   completed  its id is in done[]
//   active     not completed, and every id in requires[] is completed
//   locked     otherwise
// Deriving it means the chain can be reordered or extended in the data file and
// old saves still land in the right place — there is no stored "current mission"
// to go stale.
//
// Saved shape (state.missions, persisted by core/save.js):
//   { done: [id], progress: { [missionId]: [countPerGoal] }, seen: [id] }
// Progress is filed per mission rather than in one shared bag, so an optional
// side mission running alongside the required line cannot overwrite it.

export const LOCKED = 'locked';
export const ACTIVE = 'active';
export const COMPLETED = 'completed';

const listeners = [];

/** Called with (mission, 'progress' | 'complete' | 'unlocked'). */
export function onMissionEvent(fn) { listeners.push(fn); }
const emit = (mission, kind) => listeners.forEach((fn) => fn(mission, kind));

// Goals that measure the world instead of counting events.
//
// "Gather 10 wood" is a tally of things that happened. "Wall in your floor" is a
// fact about the world right now: put a wall up and it goes up, take one down
// and it goes back down, and the target itself moves when the deck grows. Those
// cannot be counted from events, so the goal kind is handed a measuring function
// by whoever owns the thing being measured — this file never learns what a floor
// is. A measure returns { have, need }.
const measures = {};

/** @param fn () => { have, need } */
export function registerMeasure(kind, fn) { measures[kind] = fn; }

/**
 * A measured goal's one-line status, when its measure offers one.
 *
 * The count alone says how far along you are; it can't say what the rest will
 * cost. Only whoever owns the measurement knows that, so the note comes back
 * with the measurement.
 */
export function goalNote(goal) {
  return measures[goal.kind]?.(goal)?.note ?? null;
}

/**
 * How many a goal needs: fixed for counted goals, live for measured ones.
 *
 * A measured target of zero is taken at face value — "gather enough stone for
 * the walls" when the walls are already up asks for nothing, and should say so.
 * A measure that must never read as finished says so by reporting at least one.
 */
export function goalTarget(goal) {
  const measure = measures[goal.kind];
  return measure ? Math.max(0, measure(goal).need) : goal.n;
}

// Missions renamed since the first release. Without this a player who had
// already finished them would be sent back to do them again.
const RENAMED = {
  first_gather: 'gather_basics',
  first_shelter: 'first_walls',
};

function ensure() {
  let m = state.missions;
  if (!m || typeof m !== 'object') m = {};

  // Old saves kept { active, done, progress: { goalIndex: count } } — one shared
  // progress bag belonging to whichever mission was current. Move it under that
  // mission's id and drop the stored `active`, which is derived now.
  if (m.progress && !Array.isArray(m.progress[Object.keys(m.progress)[0]])
      && typeof Object.values(m.progress)[0] === 'number') {
    const owner = RENAMED[m.active] ?? m.active;
    const counts = m.progress;
    m.progress = {};
    if (owner) {
      const mission = missionById(owner);
      if (mission) m.progress[owner] = mission.goals.map((_, i) => counts[i] ?? 0);
    }
  }
  delete m.active;

  m.done = (m.done ?? []).map((id) => RENAMED[id] ?? id).filter((id) => missionById(id));
  m.done = [...new Set(m.done)];
  m.progress = m.progress ?? {};
  m.seen = m.seen ?? [];

  state.missions = m;
  return m;
}

export function missionStatus(mission) {
  const m = ensure();
  const def = typeof mission === 'string' ? missionById(mission) : mission;
  if (!def) return LOCKED;
  if (m.done.includes(def.id)) return COMPLETED;
  const ready = (def.requires ?? []).every((id) => m.done.includes(id));
  return ready ? ACTIVE : LOCKED;
}

/** Counts for one mission's goals, in goal order, clamped to the target. */
export function progressOf(mission) {
  const m = ensure();
  const def = typeof mission === 'string' ? missionById(mission) : mission;
  if (!def) return [];
  const done = m.done.includes(def.id);
  const counts = m.progress[def.id] ?? [];
  return def.goals.map((g, i) => {
    const target = goalTarget(g);
    if (done) return target;
    const measure = measures[g.kind];
    return Math.min(target, measure ? measure(g).have : counts[i] ?? 0);
  });
}

/** Every mission the player may work on right now, required ones first. */
export function activeMissions() {
  return MISSIONS.filter((def) => missionStatus(def) === ACTIVE)
    .sort((a, b) => (a.optional ? 1 : 0) - (b.optional ? 1 : 0));
}

/** The one the HUD tracks: the required line takes priority over side work. */
export function activeMission() {
  return activeMissions()[0] ?? null;
}

export function activeProgress() {
  const mission = activeMission();
  return mission ? progressOf(mission) : [];
}

export function isComplete(mission, progress) {
  return mission.goals.every((g, i) => (progress[i] ?? 0) >= goalTarget(g));
}

/**
 * Records something the player did.
 *
 * Applies to every active mission at once, so a side mission and the required
 * line can both watch for the same event without either stealing it.
 *
 * @param kind  'collect' | 'craft' | 'harvest' | 'kill' | 'build' | 'store' | 'travel'
 * @param what  item id, node type, blueprint id, zombie type or location id
 * @param n     how many
 */
export function report(kind, what, n = 1) {
  if (!(n > 0)) return;
  const m = ensure();
  const finished = [];
  let ticked = false;

  for (const mission of activeMissions()) {
    // Built lazily so a mission nothing has touched leaves nothing in the save.
    const counts = m.progress[mission.id] ?? [];
    let hit = false;

    mission.goals.forEach((goal, i) => {
      if (goal.kind !== kind || measures[goal.kind]) return;
      if (goal.what !== 'any' && goal.what !== what) return;
      const before = counts[i] ?? 0;
      // Already met: counting past the target would let one goal's overflow
      // stand in for progress the player has not actually made.
      if (before >= goal.n) return;
      counts[i] = Math.min(goal.n, before + n);
      hit = true;
    });

    if (!hit) continue;
    m.progress[mission.id] = counts;
    ticked = true;
    if (isComplete(mission, counts)) finished.push(mission);
  }

  // Finish after the sweep: completing a mission unlocks others, and those must
  // not pick up the event that completed their prerequisite.
  finished.forEach(finish);
  if (ticked && !finished.length) emit(activeMission(), 'progress');
  // The same event usually moved the bag as well, and a stockpile goal watches
  // the bag rather than the event.
  refreshMeasured();
}

/**
 * Goals like "reach Pine Bushes" then "get back to camp" are the same kind and
 * must be met in order, so travel goes through here: it ticks only the first
 * unmet travel goal instead of every one that matches.
 */
export function reportTravel(locationId) {
  const m = ensure();
  const finished = [];
  let ticked = false;

  for (const mission of activeMissions()) {
    const counts = m.progress[mission.id] ?? [];
    const i = mission.goals.findIndex((g, idx) =>
      g.kind === 'travel' && (counts[idx] ?? 0) < g.n);
    if (i < 0 || mission.goals[i].what !== locationId) continue;

    counts[i] = mission.goals[i].n;
    m.progress[mission.id] = counts;
    ticked = true;
    if (isComplete(mission, counts)) finished.push(mission);
  }

  finished.forEach(finish);
  if (ticked && !finished.length) emit(activeMission(), 'progress');
  refreshMeasured();
}

function finish(mission) {
  const m = ensure();
  // The one gate against a mission paying out twice. Everything that can
  // complete a mission goes through here, so nothing else needs to check.
  if (m.done.includes(mission.id)) return;

  m.done.push(mission.id);
  delete m.progress[mission.id];
  if (mission.reward?.xp) addXp(mission.reward.xp, 'mission');

  emit(mission, 'complete');
  // Whatever this opened up announces itself, once.
  for (const next of activeMissions()) {
    if (m.seen.includes(next.id)) continue;
    m.seen.push(next.id);
    emit(next, 'unlocked');
  }
}

/**
 * Re-checks goals that measure the world.
 *
 * Nothing reports "the base changed shape", so whoever changes it calls this:
 * putting up a wall, taking one down, or extending the deck can all move a
 * measured goal, in either direction.
 */
export function refreshMeasured() {
  const finished = [];
  for (const mission of activeMissions()) {
    if (!mission.goals.some((g) => measures[g.kind])) continue;
    if (isComplete(mission, progressOf(mission))) finished.push(mission);
  }
  // Only completion is announced. The tracker reads the measure live every
  // frame, so it needs no nudge to show a counter moving.
  finished.forEach(finish);
}

// ---------------------------------------------------------------- chapters
//
// Chapters are a reading of the mission list, not a second set of rules. Nothing
// unlocks because a chapter opened; a chapter is open because one of its
// missions is.

/** Required missions in a chapter, in table order. */
const chapterMissions = (n) =>
  MISSIONS.filter((m) => m.chapter === n && !m.optional);

/** The chapter the tracker should name: the earliest one not finished. */
export function currentChapter() {
  for (const chapter of CHAPTERS) {
    const missions = chapterMissions(chapter.n);
    if (missions.some((m) => missionStatus(m) !== COMPLETED)) return chapter;
  }
  return CHAPTERS[CHAPTERS.length - 1] ?? null;
}

/**
 * Where a mission sits inside its chapter, and how long the chapter is.
 *
 * Counting within the chapter rather than across the whole game is what makes
 * the number mean something: "2 of 2" says the chapter is about to close, where
 * "2 of 5" says nothing a player can act on.
 */
export function chapterProgress(mission) {
  const chapter = chapterByNumber(mission?.chapter) ?? currentChapter();
  if (!chapter) return null;
  const missions = chapterMissions(chapter.n);
  const done = missions.filter((m) => missionStatus(m) === COMPLETED).length;
  const index = mission && !mission.optional ? missions.indexOf(mission) : -1;
  return {
    chapter,
    total: missions.length,
    // The mission in hand counts as the one you are on; if it is optional, fall
    // back to how many of the chapter are behind you.
    step: Math.min(missions.length, index >= 0 ? index + 1 : done + 1),
    done,
  };
}

/** For the journal: every mission with its status and counts. */
export function missionList() {
  return MISSIONS.map((mission) => ({
    mission,
    status: missionStatus(mission),
    progress: progressOf(mission),
  }));
}
