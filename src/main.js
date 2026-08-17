import * as THREE from 'three';
import { makeRng } from './core/rng.js';
import { initInput, input } from './core/input.js';
import { state, level, resetRun, resizeInventory, carriedWeight, carryLimit } from './core/state.js';
import { save, load } from './core/save.js';
import { addItem, removeItem, removeAt, countItem, drainAll, freeSlots, makeSlots } from './core/inventory.js';
import { ITEMS } from './data/items.js';
import { LOCATIONS, locationById, ENERGY_MAX, ENERGY_REGEN_PER_SEC } from './data/locations.js';
import { rollDrops } from './data/loot.js';
import { buildLocation, SHADOW_RES, SHADOW_EXTENT } from './world/location.js';
import { Base } from './world/base.js';
import { BuildController } from './core/build.js';
import {
  initBuildMenu, open as openBuildMenu, close as closeBuildMenu,
  isBuildMenuOpen, refreshBuildMenu, refreshBuildHint,
} from './ui/buildmenu.js';
import { Player } from './entities/player.js';
import { Zombie } from './entities/zombie.js';
import { HarvestController } from './entities/harvest.js';
import { IMPACT_FX } from './data/harvest.js';
import { spawnImpact, updateFx, resetFx, addShake, shakeOffset, rumble } from './world/fx.js';
import { playSound, unlockAudio } from './core/audio.js';
import { updateHud, hideLoader, setLoaderText, showDeath, onRespawn } from './ui/hud.js';
import { loadModels, buildGenerated } from './world/models.js';
import { openCreator } from './ui/creator.js';
import { initPanels, openPanel, closePanels, isPanelOpen, refreshPanels, currentPanel } from './ui/panels.js';
import { toast } from './ui/toast.js';
import { report, reportTravel, onMissionEvent, activeMission } from './core/missions.js';

// Camera sits on a fixed angle; the wheel slides it along that line.
const CAMERA_DIR = new THREE.Vector3(0, 12.5, 10.5).normalize();
const CAMERA_MIN = 6;
const CAMERA_MAX = 30;
let camDist = 16.3;

addEventListener('wheel', (e) => {
  camDist = THREE.MathUtils.clamp(camDist + Math.sign(e.deltaY) * 1.4, CAMERA_MIN, CAMERA_MAX);
}, { passive: true });

// ---------------------------------------------------------------- renderer

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;
document.body.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 300);
const clock = new THREE.Clock();
const rng = makeRng(Date.now() & 0xffff);

initInput(renderer.domElement);

// ---------------------------------------------------------------- world

let loc = null;          // { def, scene, sun, nodes, containers, zombies, radius, base, grave }
let player = null;
let colliders = [];
let builder = null;      // BuildController, made once the home base exists
let searching = null;    // { target, progress, total }
let harvester = null;    // HarvestController, built with the player
const tracers = [];

// Browsers won't start audio until the player has interacted with the page.
for (const evt of ['keydown', 'mousedown', 'touchstart']) {
  addEventListener(evt, () => unlockAudio(), { once: true });
}

function rebuildColliders() {
  colliders = [];
  for (const n of loc.nodes) {
    colliders.push({ position: n.position, radius: n.radius, entity: n, get active() { return n.alive; } });
  }
  for (const c of loc.containers) {
    colliders.push({ position: c.position, radius: c.radius, entity: c, active: true });
  }
  for (const z of loc.zombies) {
    colliders.push({ position: z.position, radius: z.radius, entity: z, get active() { return z.alive; } });
  }
  if (loc.decor) colliders.push(...loc.decor);
  if (loc.base) colliders.push(...loc.base.colliders());
  colliders.push({ position: player.position, radius: player.radius, entity: player, active: true });
}

function makeGrave(pos, items) {
  const g = new THREE.Group();
  const bag = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.6, 0.45),
    new THREE.MeshStandardMaterial({ color: 0x6a5a3f, roughness: 0.9, flatShading: true }));
  bag.position.y = 0.3;
  g.add(bag);
  const marker = new THREE.Mesh(
    new THREE.ConeGeometry(0.14, 0.7, 4),
    new THREE.MeshStandardMaterial({ color: 0xd2a545, emissive: 0xd2a545, emissiveIntensity: 1.1, flatShading: true }));
  marker.position.y = 1.35;
  g.add(marker);
  g.position.set(pos.x, 0, pos.z);
  g.traverse((o) => { o.castShadow = true; });
  return { kind: 'grave', mesh: g, marker, items, radius: 0.5, get position() { return g.position; } };
}

/** Frees GPU memory for the location we're leaving — travel happens a lot. */
function disposeScene(scene, keep) {
  scene.traverse((o) => {
    if (keep && (o === keep || keep.getObjectById(o.id))) return;
    o.geometry?.dispose?.();
    const m = o.material;
    if (Array.isArray(m)) m.forEach((x) => x.dispose?.());
    else m?.dispose?.();
  });
}

function loadLocation(def) {
  if (loc?.scene) {
    loc.scene.remove(player.mesh);
    disposeScene(loc.scene);
  }
  const built = buildLocation(def, makeRng(Date.now() & 0x7fffffff));
  loc = { def, ...built, base: null, grave: null };

  player = player ?? new Player();
  player.position.set(0, 0, 0);
  player.velocity.set(0, 0, 0);
  player.moveGoal = null;
  player.faceGoal = null;
  loc.scene.add(player.mesh);
  harvester = harvester ?? new HarvestController(player, rng);
  harvester.stop();
  resetFx();   // the particle pool belongs to the scene we just replaced

  if (def.id === 'home') {
    loc.base = new Base(loc.scene);
    loc.base.obstructed = obstructedAt;
    builder = makeBuilder();
  } else {
    builder = null;
  }
  // Grass grows everywhere and only gives way to what's actually been built.
  if (loc.grass) {
    loc.grass.blocked = (x, z) => loc.base?.occupiedAt(x, z) ?? false;
    loc.grass.refresh(player.position);
  }

  const g = state.graves[def.id];
  if (g && g.items?.length) {
    loc.grave = makeGrave({ x: g.x, z: g.z }, g.items);
    loc.scene.add(loc.grave.mesh);
  }

  rebuildColliders();
  setBuildMode(false);
}

function travelTo(id, free = false) {
  const def = locationById(id);
  if (!def) return;
  if (!free) {
    if (state.energy < def.energy) { toast('Not enough energy', 'bad'); return; }
    if (def.requires && countItem(state.inv, def.requires) < 1) { toast('You need a keycard', 'bad'); return; }
    state.energy -= def.energy;
    if (def.requires) removeItem(state.inv, def.requires, 1);
  }
  state.locationId = id;
  state.timeLeft = def.timer;
  if (def.timer > 0) state.stats.runs++;
  if (!state.seenLocations.includes(id)) state.seenLocations.push(id);

  loadLocation(def);
  showDeath(false);
  reportTravel(id);
  toast(`Arrived at ${def.name}`, 'info');
  save();
}

// ---------------------------------------------------------------- combat

/** The harvestable the player is most likely aiming at, if any. */
function nearestHarvestable(range = 6) {
  const facing = new THREE.Vector3(Math.sin(player.mesh.rotation.y), 0, Math.cos(player.mesh.rotation.y));
  const to = new THREE.Vector3();
  let best = null;
  let bestScore = Infinity;

  for (const n of loc.nodes) {
    if (!n.alive || n.dying) continue;
    to.subVectors(n.position, player.position);
    to.y = 0;
    const d = to.length() - n.radius;
    if (d > range) continue;
    // Prefer what's in front, but don't require it — at arm's length the player
    // is clearly working on the thing they're standing against.
    const aim = d < 1.2 ? 1 : to.normalize().dot(facing);
    if (aim < -0.2) continue;
    const score = d - aim * 1.5;
    if (score < bestScore) { bestScore = score; best = n; }
  }
  return best;
}

function attack() {
  // Working a resource takes priority: aim at a tree and the swing becomes a
  // chop, complete with walking into range first.
  const node = nearestHarvestable();
  if (node) {
    const refused = harvester.begin(node, player.weapon);
    if (refused) toast(refused, 'bad');
    return;
  }

  if (!player.trySwing()) return;
  const w = player.weapon;
  if (w.ranged) return fireRanged(w);

  const facing = new THREE.Vector3(Math.sin(player.mesh.rotation.y), 0, Math.cos(player.mesh.rotation.y));
  const to = new THREE.Vector3();
  const reach = w.reach ?? 2.5;
  let connected = false;

  const inArc = (target, extra) => {
    to.subVectors(target.position, player.position);
    to.y = 0;
    if (to.length() - extra > reach) return false;
    return to.normalize().dot(facing) > Math.cos(1.0);
  };

  for (const z of loc.zombies) {
    if (!z.alive || !inArc(z, z.radius)) continue;
    const killed = z.damage(w.dmg);
    z.position.addScaledVector(facing, 0.35);
    connected = true;
    if (killed) onZombieKilled(z);
  }

  if (connected) wearWeapon();
}

function fireRanged(w) {
  const eq = state.equip.weapon;
  if (countItem(state.inv, w.ammo) < 1) { toast('Out of ammo', 'bad'); return; }
  removeItem(state.inv, w.ammo, 1);

  const yaw = player.mesh.rotation.y + (rng() - 0.5) * w.spread * 2;
  const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const origin = player.position.clone().setY(1.4);

  let hit = null;
  let hitDist = w.maxRange;
  const rel = new THREE.Vector3();
  for (const z of loc.zombies) {
    if (!z.alive) continue;
    rel.subVectors(z.position, player.position);
    rel.y = 0;
    const along = rel.dot(dir);
    if (along <= 0 || along > hitDist) continue;
    const perp = Math.abs(rel.x * dir.z - rel.z * dir.x);
    if (perp > z.radius + 0.25) continue;
    hit = z;
    hitDist = along;
  }

  const end = origin.clone().addScaledVector(dir, hitDist);
  const geo = new THREE.BufferGeometry().setFromPoints([origin, end]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.9 }));
  loc.scene.add(line);
  tracers.push({ line, life: 0.07 });

  if (hit) {
    const killed = hit.damage(w.dmg);
    hit.position.addScaledVector(dir, 0.5);
    if (killed) onZombieKilled(hit);
  }
  wearWeapon();
}

/**
 * Turns one landed swing into everything the player sees and hears: debris,
 * sound, a nudge on the camera, a buzz on the phone, and the payout.
 *
 * All of it is driven off the resource's fx profile, so a new harvestable is a
 * data entry rather than another branch in here.
 */
function onHarvestEvent(ev) {
  const profile = IMPACT_FX[ev.node.def.fx] ?? IMPACT_FX.stone;

  spawnImpact(loc.scene, rng, ev.point, ev.dir, profile);
  // Detune per hit so a run of swings doesn't sound like a loop.
  playSound(profile.sound, rng.range(0.92, 1.09));
  addShake(profile.shake);
  rumble(14);

  if (ev.drops.length) give(ev.drops);
  wearWeapon();

  if (ev.type === 'depleted') {
    report('harvest', ev.node.type, 1);
    state.xp += 5;
    state.stats.harvested = (state.stats.harvested ?? 0) + 1;
  } else {
    state.xp += 1;
  }
}

/** A tree hitting the ground, or a rock coming apart. */
function onNodeDeathEvent(node, ev) {
  const profile = IMPACT_FX[node.def.fx] ?? IMPACT_FX.stone;
  const dust = { ...profile, chips: { ...profile.chips, count: (profile.chips?.count ?? 6) + 4 } };
  spawnImpact(loc.scene, rng, ev.position, new THREE.Vector3(rng.range(-1, 1), 0, rng.range(-1, 1)), dust);
  playSound(ev.mode === 'topple' ? 'timber' : 'shatter', rng.range(0.94, 1.06));
  addShake(ev.mode === 'topple' ? 0.3 : 0.2);
  rumble(ev.mode === 'topple' ? 45 : 22);
}

function wearWeapon() {
  const eq = state.equip.weapon;
  if (!eq || eq.dur === undefined) return;
  eq.dur -= 1;
  if (eq.dur <= 0) {
    toast(`${ITEMS[eq.id].name} broke`, 'bad');
    state.equip.weapon = null;
  }
}

function onZombieKilled(z) {
  report('kill', z.type, 1);
  state.xp += z.def.xp;
  state.stats.kills++;
  const drops = rollDrops(z.type, rng);
  if (drops.length) give(drops);
}

/** Adds loot, reporting anything that wouldn't fit. */
function give(drops) {
  const gained = [];
  let dropped = 0;
  for (const d of drops) {
    const left = addItem(state.inv, d.id, d.n);
    if (left < d.n) gained.push({ id: d.id, n: d.n - left });
    dropped += left;
  }
  if (gained.length) {
    toast(gained.map((g) => `${ITEMS[g.id].icon} ${ITEMS[g.id].name} ×${g.n}`).join('<br>'));
  }
  if (dropped > 0) toast('Bag full — some loot left behind', 'bad');
  refreshPanels();
  return dropped;
}

// ---------------------------------------------------------------- interaction

function nearestInteractable() {
  let best = null;
  let bestD = 2.7;

  if (loc.grave) {
    const d = loc.grave.position.distanceTo(player.position);
    if (d < bestD) { bestD = d; best = { type: 'grave', obj: loc.grave, label: 'Recover Bag' }; }
  }
  for (const p of loc.pickups) {
    const d = p.position.distanceTo(player.position) - p.radius;
    if (d < bestD) { bestD = d; best = { type: 'pickup', obj: p, label: p.label }; }
  }
  for (const c of loc.containers) {
    if (c.opened && c.empty) continue;
    const d = c.position.distanceTo(player.position) - c.radius;
    if (d < bestD) { bestD = d; best = { type: 'container', obj: c, label: c.label }; }
  }
  if (loc.base) {
    const near = loc.base.nearest(player.position);
    if (near) {
      const label = near.bp.capacity ? `Open ${near.bp.label}` : `Use ${near.bp.label}`;
      best = { type: 'base', obj: near, label };
    }
  }
  return best;
}

function interactPress(target) {
  if (!target) return;
  if (target.type === 'grave') {
    const left = [];
    for (const s of target.obj.items) {
      const rem = addItem(state.inv, s.id, s.n, s.dur);
      if (rem > 0) left.push({ ...s, n: rem });
    }
    target.obj.items = left;
    if (left.length === 0) {
      loc.scene.remove(target.obj.mesh);
      loc.grave = null;
      delete state.graves[loc.def.id];
      toast('Recovered your bag');
    } else {
      state.graves[loc.def.id].items = left;
      toast('Bag full — some of it is still there', 'bad');
    }
    save();
  } else if (target.type === 'pickup') {
    // Whatever won't fit stays on the ground, so a full bag never eats the pile.
    const left = [];
    for (const d of target.obj.items) {
      const rem = addItem(state.inv, d.id, d.n);
      if (rem > 0) left.push({ id: d.id, n: rem });
      if (rem < d.n) toast(`${ITEMS[d.id].icon} ${ITEMS[d.id].name} ×${d.n - rem}`);
    }
    for (const d of target.obj.items) {
      const kept = d.n - (left.find((l) => l.id === d.id)?.n ?? 0);
      if (kept > 0) report('collect', d.id, kept);
    }
    target.obj.items = left;
    refreshPanels();
    if (left.length) { toast('Bag full', 'bad'); return; }
    loc.scene.remove(target.obj.mesh);
    loc.pickups.splice(loc.pickups.indexOf(target.obj), 1);
    state.xp += 1;
  } else if (target.type === 'base') {
    const { cell, bp } = target.obj;
    if (bp.capacity) {
      if (!cell.contents) cell.contents = makeSlots(bp.capacity);
      openPanel('store', { cell });
    } else if (cell.station) {
      openPanel('craft', { station: cell.station });
    }
  }
}

function updateSearch(dt, target) {
  const wants = target && target.type === 'container' && input.interactHeld && player.busy <= 0;
  if (!wants) {
    if (searching) { searching.target.cancel(); searching = null; }
    return;
  }
  const c = target.obj;
  if (!searching || searching.target !== c) searching = { target: c, progress: c.progress, total: c.searchTime };

  const got = c.search(dt);
  searching.progress = c.progress;
  if (got) {
    const leftover = [];
    for (const d of got) {
      const rem = addItem(state.inv, d.id, d.n);
      if (rem > 0) leftover.push({ id: d.id, n: rem });
      if (rem < d.n) toast(`${ITEMS[d.id].icon} ${ITEMS[d.id].name} ×${d.n - rem}`);
    }
    if (leftover.length) { c.putBack(leftover); toast('Bag full', 'bad'); }
    state.xp += 5;
    searching = null;
    refreshPanels();
  }
}

// ---------------------------------------------------------------- survival

function survivalTick(dt) {
  state.energy = Math.min(ENERGY_MAX, state.energy + ENERGY_REGEN_PER_SEC * dt);
  if (state.hp <= 0) return;

  // Safe zones hold everything still: no hunger or thirst ticking down, no
  // damage, and poison wears off harmlessly while you recover.
  if (loc.def.safe) {
    state.poison = Math.max(0, state.poison - dt * 4);
    if (state.hp < state.maxHp) state.hp = Math.min(state.maxHp, state.hp + dt * 3);
    return;
  }

  state.hunger = Math.max(0, state.hunger - dt * 0.55);
  state.thirst = Math.max(0, state.thirst - dt * 0.8);

  let drain = 0;
  if (state.hunger === 0) drain += 2.2;
  if (state.thirst === 0) drain += 3.0;
  if (state.poison > 0) {
    drain += 1.6;
    state.poison = Math.max(0, state.poison - dt * 2);
  }
  if (drain > 0) state.hp = Math.max(0, state.hp - drain * dt);
  else if (state.hunger > 45 && state.thirst > 45 && state.hp < state.maxHp) {
    state.hp = Math.min(state.maxHp, state.hp + dt * 1.1);
  }

  if (state.hp <= 0) die();
}

function useItem(index) {
  const slot = state.inv[index];
  if (!slot) return;
  const def = ITEMS[slot.id];
  if (def.cat !== 'food' && def.cat !== 'med') return;

  removeAt(state.inv, index, 1);
  if (def.food) state.hunger = Math.min(100, state.hunger + def.food);
  if (def.water) state.thirst = Math.min(100, state.thirst + def.water);
  if (def.hp) state.hp = Math.max(0, Math.min(state.maxHp, state.hp + def.hp));
  if (def.cure) state.poison = 0;
  player.busy = def.use ?? 1;
  toast(`Used ${def.name}`, 'info');
  if (state.hp <= 0) die();
}

let deathHandled = false;

function die() {
  if (deathHandled) return;
  deathHandled = true;
  const items = drainAll(state.inv);
  for (const key of ['weapon', 'head', 'body', 'feet']) {
    if (state.equip[key]) { items.push(state.equip[key]); state.equip[key] = null; }
  }
  state.stats.deaths++;
  if (items.length) {
    state.graves[state.locationId] = { x: player.position.x, z: player.position.z, items };
  }
  closePanels();
  setBuildMode(false);
  showDeath(true,
    `You went down in <b>${loc.def.name}</b>.<br>Your bag is still there — go back for it.<br>` +
    `<span style="opacity:.6">Kills ${state.stats.kills} · Runs ${state.stats.runs} · Deaths ${state.stats.deaths}</span>`);
  save();
}

function respawn() {
  resetRun();
  deathHandled = false;
  showDeath(false);
  player.respawned();
  travelTo('home', true);
}

// ---------------------------------------------------------------- building

const buildMode = () => !!builder?.active;

function setBuildMode(on) {
  if (!builder || loc?.def.id !== 'home') { closeBuildMenu(); return; }
  if (on) {
    builder.open();
    // Straight into the menu the first time, so the first thing you see is what
    // you can build rather than an empty cursor.
    if (!builder.selected) openBuildMenu();
  } else {
    builder.close();
    closeBuildMenu();
  }
  refreshBuildHint();
}

const shakeVec = new THREE.Vector3();
const pointer = new THREE.Vector2(0, 0);
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hitPoint = new THREE.Vector3();

addEventListener('mousemove', (e) => {
  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / innerHeight) * 2 + 1;
});

/** Where the cursor meets the ground, in world metres. */
function cursorOnGround() {
  raycaster.setFromCamera(pointer, camera);
  return raycaster.ray.intersectPlane(groundPlane, hitPoint) ? hitPoint : null;
}

/** Everything a piece must not be dropped on top of. */
function obstructedAt(x, z) {
  for (const n of loc.nodes) {
    if (!n.alive) continue;
    if ((n.position.x - x) ** 2 + (n.position.z - z) ** 2 < (n.radius + 0.4) ** 2) return true;
  }
  for (const c of loc.containers) {
    if ((c.position.x - x) ** 2 + (c.position.z - z) ** 2 < (c.radius + 0.4) ** 2) return true;
  }
  return false;
}

function afterBuildChange() {
  loc.grass?.refresh(player.position);   // grass gives way, or grows back
  rebuildColliders();
  refreshBuildMenu();
  save();
}

function makeBuilder() {
  return new BuildController({
    base: loc.base,
    station: () => loc.base?.stationAt(player.position) ?? null,
    onPlaced: (id) => {
      state.xp += 2;
      report('build', id, 1);
      playSound('chop', 0.9);
      afterBuildChange();
    },
    onRemoved: () => afterBuildChange(),
  });
}

renderer.domElement.addEventListener('mousedown', (e) => {
  if (!buildMode() || isBuildMenuOpen()) return;
  e.preventDefault();
  if (e.button === 0) {
    const r = builder.place();
    if (!r.ok && r.msg) toast(r.msg, 'bad');
  }
  if (e.button === 2) {
    const point = cursorOnGround();
    const r = point ? builder.removeAt(point) : { ok: false };
    if (r.ok) toast(r.msg);
  }
});

// ---------------------------------------------------------------- panels wiring

initPanels({
  onTravel: (id) => travelTo(id),
  onUse: (i) => useItem(i),
  onChange: () => { rebuildColliders(); refreshBuildMenu(); save(); },
  nearbyStation: () => (loc?.base ? loc.base.stationAt(player.position) : null),
  availableStations: () => {
    const list = ['hands'];
    const st = loc?.base?.stationAt(player.position);
    if (st && !list.includes(st)) list.push(st);
    return list;
  },
});
onRespawn(respawn);

// Missions announce themselves; the HUD tracker handles the quiet updates.
onMissionEvent((mission, kind) => {
  if (kind !== 'complete') return;
  const xp = mission.reward?.xp ?? 0;
  toast(`<b>${mission.title}</b> — done${xp ? ` · +${xp} XP` : ''}`, 'info');
  playSound('pickup', 1.15);
  const next = activeMission();
  if (next) setTimeout(() => toast(`<b>New objective</b><br>${next.brief}`, 'info'), 2200);
  save();
});

function handlePanelKeys() {
  if (state.hp <= 0) return;   // while you're down, the only option is respawn
  if (input.consumePress('Escape')) {
    if (isBuildMenuOpen()) closeBuildMenu();
    else if (isPanelOpen()) closePanels();
    else if (buildMode()) setBuildMode(false);
    return;
  }
  if (input.consumePress('Tab')) {
    isPanelOpen() && currentPanel() === 'inv' ? closePanels() : openPanel('inv');
  }
  if (input.consumePress('KeyC')) {
    isPanelOpen() && currentPanel() === 'craft'
      ? closePanels()
      : openPanel('craft', { station: loc.base?.stationAt(player.position) ?? 'hands' });
  }
  if (input.consumePress('KeyM')) {
    isPanelOpen() && currentPanel() === 'map' ? closePanels() : openPanel('map');
  }
  if (input.consumePress('KeyB')) {
    if (loc.def.id !== 'home') toast('You can only build at home', 'bad');
    else if (!buildMode()) { closePanels(); setBuildMode(true); }
    else if (isBuildMenuOpen()) closeBuildMenu();
    else openBuildMenu();     // in build mode, B toggles the catalogue back up
  }
}

// ---------------------------------------------------------------- loop

let saveTimer = 0;

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  const dead = state.hp <= 0;
  const paused = isPanelOpen() || dead;

  handlePanelKeys();

  const target = paused ? null : nearestInteractable();

  if (!paused) {
    if (input.consumePress('KeyE')) interactPress(target);
    updateSearch(dt, target);
    // Holding the button keeps swinging — the swing cooldown paces it.
    const wantsAttack = input.consumeAttack() || input.attackHeld;
    if (!buildMode() && wantsAttack) attack();
    else harvester.release();
  } else {
    input.consumeAttack();
    harvester.release();
  }

  // Taking the stick back cancels the job — the auto-walk must never feel like
  // it has taken the controls off you.
  const steered = input.forward || input.back || input.left || input.right;
  const ev = harvester.update(dt, player.weapon, paused || buildMode() || steered);
  if (ev) onHarvestEvent(ev);

  player.searching = !!searching;
  player.update(dt, input, colliders, !paused && !buildMode() && !searching);

  // Death can come from any source (zombies, starvation, bad food) — catch it here
  // rather than in whichever system happened to land the last point of damage.
  if (state.hp <= 0) die();

  // Keep the player inside the treeline.
  const r = Math.hypot(player.position.x, player.position.z);
  if (r > loc.radius) player.position.multiplyScalar(loc.radius / r);

  if (!paused) {
    for (const n of loc.nodes) {
      const done = n.update(dt);
      if (done) onNodeDeathEvent(n, done);
    }
    for (const z of loc.zombies) z.update(dt, player, colliders);
    survivalTick(dt);

    if (loc.def.timer > 0) {
      state.timeLeft -= dt;
      if (state.timeLeft <= 0) {
        toast('The area is overrun — falling back home', 'bad');
        travelTo('home', true);
        return;
      }
    }
  }

  // clear out corpses
  let structural = false;
  for (let i = loc.zombies.length - 1; i >= 0; i--) {
    const z = loc.zombies[i];
    if (z.alive || z.deathTimer > 0) continue;
    loc.scene.remove(z.mesh);
    loc.zombies.splice(i, 1);
    structural = true;
  }
  // Pressure keeps up: the horde refills over time in hostile zones.
  if (loc.def.timer > 0) {
    const want = Object.values(loc.def.zombies).reduce((a, b) => a + b, 0);
    if (loc.zombies.length < want && rng() < dt * 0.25) {
      const types = Object.keys(loc.def.zombies);
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(24, loc.radius - 3);
      const z = new Zombie(rng.pick(types),
        new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d), rng);
      loc.zombies.push(z);
      loc.scene.add(z.mesh);
      structural = true;
    }
  }
  if (structural) rebuildColliders();

  for (let i = tracers.length - 1; i >= 0; i--) {
    tracers[i].life -= dt;
    if (tracers[i].life <= 0) { loc.scene.remove(tracers[i].line); tracers.splice(i, 1); }
  }

  // Grass sways and parts around whoever is standing in it.
  loc.grass?.update(dt, player.position);

  if (loc.base) {
    loc.base.animate(clock.elapsedTime, player.position, dt);
    // You step up onto your own deck rather than wading through it.
    player.setStandHeight(loc.base.surfaceY(player.position.x, player.position.z), dt);
  }
  if (loc.grave) loc.grave.marker.rotation.y += dt * 2;

  if (buildMode()) {
    if (input.consumePress('KeyR')) builder.rotate();
    const t = isBuildMenuOpen() ? null : builder.aim(cursorOnGround());
    const why = document.getElementById('buildwhy');
    const msg = t && !t.ok ? t.reason : null;
    why.textContent = msg ?? '';
    why.classList.toggle('on', !!msg);
  } else {
    document.getElementById('buildwhy').classList.remove('on');
  }

  // Rigid follow — no smoothing, so the camera never lags or sways behind the player.
  const knock = shakeOffset(dt, shakeVec);
  camera.position.set(
    player.position.x + CAMERA_DIR.x * camDist + knock.x,
    CAMERA_DIR.y * camDist + knock.y,
    player.position.z + CAMERA_DIR.z * camDist + knock.z);
  camera.lookAt(player.position.x, 1.1, player.position.z);
  updateFx(dt, camera);

  // Snap the shadow frustum to whole texels, otherwise the shadow edges crawl
  // as the light box slides along with the player.
  const texel = (SHADOW_EXTENT * 2) / SHADOW_RES;
  const sx = Math.round(player.position.x / texel) * texel;
  const sz = Math.round(player.position.z / texel) * texel;
  loc.sun.position.set(sx + 26, 40, sz + 18);
  loc.sun.target.position.set(sx, 0, sz);
  loc.sun.target.updateMatrixWorld();

  // The interact prompt wins; otherwise show what a swing would work on, so it's
  // clear a tree is a thing you can act on before you take a swing at it.
  const workable = !paused && !buildMode() && !target ? nearestHarvestable(3.2) : null;
  const promptText = buildMode() ? null
    : target ? `<kbd>E</kbd> ${target.label}`
    : workable ? `<kbd>SPACE</kbd> ${workable.label}`
    : null;
  updateHud(loc.def, promptText, searching);

  saveTimer += dt;
  if (saveTimer > 12) { saveTimer = 0; save(); }

  input.clearFrame();
  renderer.render(loc.scene, camera);
}

// Handy for poking at a live session from the console. `renderer.info` is the
// only way to see what culling actually saved: renderer.info.render.triangles
// counts what was drawn, not what exists in the scene.
window.game = {
  get player() { return player; },
  get loc() { return loc; },
  state, travelTo, renderer, camera,
};

function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', resize);
addEventListener('beforeunload', () => {
  save();
  // Without this the GL context survives the reload and the browser eventually
  // refuses to hand out new ones.
  renderer.dispose();
  renderer.forceContextLoss();
});

// ---------------------------------------------------------------- boot

/**
 * Clears bases saved in the old one-piece-per-cell format.
 *
 * Old keys were bare coordinates ("2,-1"); every socket now names its layer
 * ("floor:2,-1"), and the pieces themselves changed shape — walls moved from the
 * middle of a cell onto its boundary. There is no sensible way to reinterpret
 * the old layout, and what it held was the auto-placed starter cabin nobody
 * chose to build. The materials come back so nothing is actually lost.
 */
function migrateBase() {
  const keys = Object.keys(state.base ?? {});
  if (!keys.some((k) => !k.includes(':'))) return;

  let refunded = 0;
  for (const cell of Object.values(state.base)) {
    if (cell.contents) {
      for (const s of cell.contents) if (s) addItem(state.inv, s.id, s.n, s.dur);
    }
    refunded++;
  }
  state.base = {};

  // Buildables used to be crafted into inventory items first. Anything still
  // sitting in the bag would now be unusable, so it goes back to raw materials.
  for (let i = 0; i < state.inv.length; i++) {
    const slot = state.inv[i];
    if (!slot || ITEMS[slot.id]?.cat !== 'build') continue;
    refunded += slot.n;
    state.inv[i] = null;
  }
  addItem(state.inv, 'wood', Math.min(120, refunded * 6));
  addItem(state.inv, 'stone', Math.min(80, refunded * 3));
  setTimeout(() => toast(
    'Your camp was cleared for the new building system — materials returned', 'info'), 1200);
}

setLoaderText('LOADING MODELS');
const assets = await loadModels((d, t) => setLoaderText(`LOADING MODELS  ${d}/${t}`));
// Trees and rocks are grown rather than loaded, so the world gets real shape
// variety instead of the same mesh stamped everywhere.
setLoaderText('GROWING TREES AND ROCKS');
await new Promise((r) => setTimeout(r, 0));   // let the loader text paint first
buildGenerated((d, t) => setLoaderText(`BUILDING WORLD  ${d}/${t}`));
if (assets.missing.length) {
  console.warn(`[assets] ${assets.loaded} loaded, ${assets.missing.length} missing:`, assets.missing);
}

const returning = load();
resizeInventory();
migrateBase();
initBuildMenu(() => builder);

// Build a character before the world exists. Keyed off the character itself,
// not off save presence — an autosave can fire before the creator ever runs.
if (!state.character?.created) {
  hideLoader();
  const made = await openCreator(renderer, camera);
  state.character = { body: made.body, name: made.name, tint: made.tint, created: true };
  save();
}

if (!returning) {
  addItem(state.inv, 'wood', 12);
  addItem(state.inv, 'stone', 8);
  addItem(state.inv, 'berries', 3);
  addItem(state.inv, 'dirty_water', 2);
}
loadLocation(locationById(state.locationId ?? 'home'));
resize();
hideLoader();
frame();

if (returning) {
  toast('Save loaded', 'info');
} else {
  // First-run onboarding: the three verbs that unlock everything else.
  const hints = [
    ['Hold <kbd>SPACE</kbd> near a tree or rock to gather', 0],
    ['Press <kbd>C</kbd> to craft — a Stone Axe needs 12 wood + 8 stone', 6000],
    ['Press <kbd>B</kbd> at camp to build — start with a foundation', 13000],
    ['Press <kbd>M</kbd> to travel once you are equipped', 20000],
  ];
  for (const [text, delay] of hints) setTimeout(() => toast(text, 'info'), delay);
}
