import * as THREE from 'three';
import { GLTFLoader } from 'three/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/SkeletonUtils.js';
import { makeRng } from '../core/rng.js';
import { makeTree } from './procgen/trees.js';
import { makeRock } from './procgen/rocks.js';
import { makeTwig, makeLeafLitter } from './procgen/debris.js';
import { makeBush } from './procgen/bushes.js';
import { makePlankWall, makePlankFloor, makePlankDoor } from './procgen/timber.js';
import {
  makeFoundation, makeRoof, makeStoneWall, makeFence,
  makeCrate, makeWorkbench, makeCampfire, makeFurnace,
} from './procgen/structures.js';
import {
  makeAxe, makePickaxe, makeCrowbar, makeSpear, makeBat, makeMachete,
  makePistol, makeRifle,
} from './procgen/tools.js';
import { makeLog, makeBranch, makeFirewood, makeStump } from './procgen/logs.js';

// Central model registry. Everything the game renders looks up a key here.
//
// A key is served from one of two sources:
//   MODELS     a file on disk (Kenney CC0 packs — see assets/CREDITS.md)
//   GENERATED  grown in code at boot, for anything that wants real per-instance
//              variety rather than the same mesh repeated
//
// Generators run after loading and take precedence, so swapping a generated
// asset for a bought or authored model is one line: delete the GENERATED entry
// and point the same key at a file in MODELS. Nothing downstream changes.

const loader = new GLTFLoader();
const cache = new Map();
const failed = new Set();

export const MODELS = {
  // --- trees, by biome flavour -----------------------------------------
  tree_pine_a: 'nature/tree_pineDefaultA.glb',
  tree_pine_b: 'nature/tree_pineDefaultB.glb',
  tree_pine_c: 'nature/tree_pineRoundA.glb',
  tree_pine_d: 'nature/tree_pineTallA.glb',
  tree_oak_a:  'nature/tree_oak.glb',
  tree_oak_b:  'nature/tree_default.glb',
  tree_oak_c:  'nature/tree_fat.glb',
  tree_dead_a: 'nature/tree_oak_fall.glb',
  tree_dead_b: 'nature/tree_default_fall.glb',
  tree_dead_c: 'nature/tree_cone_fall.glb',
  tree_thin:   'nature/tree_thin.glb',

  // --- ground scatter ---------------------------------------------------
  bush_a: 'nature/plant_bushDetailed.glb',
  bush_b: 'nature/plant_bushLarge.glb',
  bush_c: 'nature/plant_bush.glb',
  grass_a: 'nature/grass.glb',
  grass_b: 'nature/grass_large.glb',
  grass_leaf: 'nature/grass_leafs.glb',
  flower_a: 'nature/flower_purpleA.glb',
  mushroom_a: 'nature/mushroom_red.glb',
  log_a: 'survival/tree-log.glb',
  log_b: 'survival/tree-log-small.glb',
  stump: 'survival/tree-trunk.glb',

  // --- ground pickups ---------------------------------------------------
  // Loose material lying about: the first wood and stone you get, before you own
  // anything to chop or mine with.
  pickup_wood_a:  'survival/resource-wood.glb',
  pickup_wood_b:  'survival/tree-log-small.glb',
  pickup_stone_a: 'survival/resource-stone.glb',
  pickup_stone_b: 'nature/stone_smallB.glb',

  // --- ground -----------------------------------------------------------
  // Kenney's 1x1 ground tile. Flat, two triangles, sits at y = -0.05 in its own
  // space — the terrain builder tiles it into the whole ground plane.
  ground_tile: 'nature/ground_grass.glb',

  // --- rock / ore -------------------------------------------------------
  rock_a: 'nature/rock_largeA.glb',
  rock_b: 'nature/rock_largeD.glb',
  rock_c: 'nature/rock_tallA.glb',
  rock_small_a: 'nature/rock_smallA.glb',
  rock_small_b: 'nature/rock_smallC.glb',
  ore_a: 'nature/stone_largeA.glb',
  ore_b: 'nature/stone_tallA.glb',
  ore_c: 'survival/resource-stone-large.glb',

  // --- containers -------------------------------------------------------
  crate:        'survival/box.glb',
  crate_open:   'survival/box-open.glb',
  crate_big:    'survival/box-large.glb',
  crate_big_open:'survival/box-large-open.glb',
  barrel:       'survival/barrel.glb',
  barrel_open:  'survival/barrel-open.glb',
  chest:        'survival/chest.glb',
  bucket:       'survival/bucket.glb',

  // --- stations & structures -------------------------------------------
  campfire:      'survival/campfire-pit.glb',
  campfire_stand:'survival/campfire-stand.glb',
  workbench:     'survival/workbench.glb',
  workbench_anvil:'survival/workbench-anvil.glb',
  workbench_grind:'survival/workbench-grind.glb',
  floor:         'survival/structure-floor.glb',
  floor_old:     'survival/floor-old.glb',
  wall_metal:    'survival/structure-metal-wall.glb',
  door_metal:    'survival/structure-metal-doorway.glb',
  fence:         'survival/fence.glb',
  fence_forti:   'survival/fence-fortified.glb',
  fence_door:    'survival/fence-doorway.glb',
  tent:          'survival/tent.glb',
  bedroll:       'survival/bedroll.glb',
  signpost:      'survival/signpost.glb',

  // --- wrecks -----------------------------------------------------------
  wreck_sedan:  'cars/sedan.glb',
  wreck_truck:  'cars/truck.glb',
  wreck_van:    'cars/delivery.glb',
  wreck_suv:    'cars/suv.glb',
  wreck_taxi:   'cars/taxi.glb',
  wreck_police: 'cars/police.glb',
  wreck_ambo:   'cars/ambulance.glb',
  debris_tire:  'cars/debris-tire.glb',
  debris_door:  'cars/debris-door.glb',
  debris_plate: 'cars/debris-plate-a.glb',

  // --- characters: skinned Mixamo humanoids, smooth deformation ---------
  // Xbot is the lean civilian build. Soldier is bulkier, so it only shows up as
  // an occasional zombie and the brute — and it donates locomotion to the rest.
  char_player_male:   'people/Xbot.glb',
  char_player_female: 'people/Michelle.glb',
  char_zombie_a: 'people/Xbot.glb',
  char_zombie_b: 'people/Soldier.glb',
  char_zombie_c: 'people/Xbot.glb',
  char_brute:    'people/Soldier.glb',
  anim_donor:    'people/Soldier.glb',
};

// Every Mixamo character here shares one skeleton and identical bone names, so
// clips authored for one bind straight onto another. Michelle and Xbot ship
// without locomotion, so they borrow Soldier's Idle / Walk / Run.
export const ANIM_SOURCE = {
  char_player_male:   'anim_donor',
  char_player_female: 'anim_donor',
  char_zombie_a: 'anim_donor',
  char_zombie_b: 'anim_donor',
  char_zombie_c: 'anim_donor',
};

/**
 * Assets grown in code rather than loaded.
 *
 * Each entry gets its own fixed seed, so a given variant is identical every run
 * — the world is reproducible, and the five oaks are five genuinely different
 * trees rather than one tree at five rotations.
 */
export const GENERATED = {
  tree_oak_a:  (rng) => makeTree(rng, 'oak'),
  tree_oak_b:  (rng) => makeTree(rng, 'oak'),
  tree_oak_c:  (rng) => makeTree(rng, 'oak'),
  tree_oak_d:  (rng) => makeTree(rng, 'oak'),
  tree_oak_e:  (rng) => makeTree(rng, 'oak'),

  tree_pine_a: (rng) => makeTree(rng, 'pine'),
  tree_pine_b: (rng) => makeTree(rng, 'pine'),
  tree_pine_c: (rng) => makeTree(rng, 'pine'),
  tree_pine_d: (rng) => makeTree(rng, 'pine'),
  tree_pine_e: (rng) => makeTree(rng, 'pine'),

  tree_dead_a: (rng) => makeTree(rng, 'dead'),
  tree_dead_b: (rng) => makeTree(rng, 'dead'),
  tree_dead_c: (rng) => makeTree(rng, 'dead'),

  rock_a: (rng) => makeRock(rng, 'boulder'),
  rock_b: (rng) => makeRock(rng, 'block'),
  rock_c: (rng) => makeRock(rng, 'slab'),
  rock_d: (rng) => makeRock(rng, 'wedge'),
  rock_e: (rng) => makeRock(rng, 'boulder', 'warm'),

  rock_small_a: (rng) => makeRock(rng, 'rubble'),
  rock_small_b: (rng) => makeRock(rng, 'block'),
  rock_small_c: (rng) => makeRock(rng, 'slab'),

  ore_a: (rng) => makeRock(rng, 'block', 'warm'),
  ore_b: (rng) => makeRock(rng, 'wedge', 'warm'),
  ore_c: (rng) => makeRock(rng, 'boulder', 'warm'),

  pickup_stone_a: (rng) => makeRock(rng, 'rubble'),
  pickup_stone_b: (rng) => makeRock(rng, 'block'),

  bush_a: (rng) => makeBush(rng, 'leafy'),
  bush_b: (rng) => makeBush(rng, 'leafy'),
  bush_c: (rng) => makeBush(rng, 'twiggy'),
  bush_d: (rng) => makeBush(rng, 'twiggy'),
  bush_e: (rng) => makeBush(rng, 'low'),
  bush_f: (rng) => makeBush(rng, 'low'),

  // The buildable kit. Several variants of each, so a row of walls isn't one
  // board pattern repeated down the line.
  //
  // Nothing here decks its own cell any more: walls stand on the boundary
  // between two cells and floors fill the cells themselves, so the two already
  // meet with no gap and no overlap.
  plank_wall_a: (rng) => makePlankWall(rng),
  plank_wall_b: (rng) => makePlankWall(rng),
  plank_wall_c: (rng) => makePlankWall(rng, { brace: false }),
  plank_floor_a: (rng) => makePlankFloor(rng),
  plank_floor_b: (rng) => makePlankFloor(rng),
  plank_floor_c: (rng) => makePlankFloor(rng),
  plank_door_a: (rng) => makePlankDoor(rng),
  plank_door_b: (rng) => makePlankDoor(rng),

  found_a: (rng) => makeFoundation(rng),
  found_b: (rng) => makeFoundation(rng),
  roof_a: (rng) => makeRoof(rng),
  roof_b: (rng) => makeRoof(rng),
  stonewall_a: (rng) => makeStoneWall(rng),
  stonewall_b: (rng) => makeStoneWall(rng),
  fence_a: (rng) => makeFence(rng),
  fence_b: (rng) => makeFence(rng),
  crate_a: (rng) => makeCrate(rng),
  crate_b: (rng) => makeCrate(rng),
  bench_a: (rng) => makeWorkbench(rng),
  bench_b: (rng) => makeWorkbench(rng),
  firepit_a: (rng) => makeCampfire(rng),
  firepit_b: (rng) => makeCampfire(rng),
  furnace_a: (rng) => makeFurnace(rng),

  // Hand tools and weapons. Keys match the item ids in data/items.js so the
  // player can look one up directly by what it has equipped.
  tool_axe_stone:  (rng) => makeAxe(rng, 'stone'),
  tool_axe_iron:   (rng) => makeAxe(rng, 'iron'),
  tool_pick_stone: (rng) => makePickaxe(rng, 'stone'),
  tool_pick_iron:  (rng) => makePickaxe(rng, 'iron'),
  tool_crowbar:    (rng) => makeCrowbar(rng),
  tool_spear:      (rng) => makeSpear(rng),
  tool_bat:        (rng) => makeBat(rng),
  tool_machete:    (rng) => makeMachete(rng),
  tool_pistol:     (rng) => makePistol(rng),
  tool_rifle:      (rng) => makeRifle(rng),

  // Round timber. Bark outside, growth rings on every cut face — the kit models
  // these replace carried their own texture and no longer matched the boards.
  pickup_wood_a: (rng) => makeFirewood(rng),
  pickup_wood_b: (rng) => makeLog(rng, { length: 0.62, radius: 0.09 }),
  log_a: (rng) => makeLog(rng, { length: 1.5, radius: 0.16 }),
  log_b: (rng) => makeLog(rng, { length: 0.9, radius: 0.12 }),
  branch_a: (rng) => makeBranch(rng),
  stump: (rng) => makeStump(rng),

  twig_a: (rng) => makeTwig(rng),
  twig_b: (rng) => makeTwig(rng),
  twig_c: (rng) => makeTwig(rng),
  leaf_litter_a: (rng) => makeLeafLitter(rng),
  leaf_litter_b: (rng) => makeLeafLitter(rng),
};

// Groups the world generator picks from, so variety is data not code.
export const VARIANTS = {
  tree_forest: ['tree_pine_a', 'tree_pine_b', 'tree_pine_c', 'tree_pine_d', 'tree_pine_e'],
  tree_field:  ['tree_oak_a', 'tree_oak_b', 'tree_oak_c', 'tree_oak_d', 'tree_oak_e'],
  tree_dead:   ['tree_dead_a', 'tree_dead_b', 'tree_dead_c'],
  bush:        ['bush_a', 'bush_b', 'bush_c', 'bush_d', 'bush_e', 'bush_f'],
  rock:        ['rock_a', 'rock_b', 'rock_c', 'rock_d', 'rock_e'],
  ore:         ['ore_a', 'ore_b', 'ore_c'],
  wreck:       ['wreck_sedan', 'wreck_truck', 'wreck_van', 'wreck_suv', 'wreck_taxi', 'wreck_police'],
  zombie:      ['char_zombie_a', 'char_zombie_b', 'char_zombie_c'],
  // Ground litter only. No fallen logs — anything branch-shaped and gatherable is
  // a pickup, and scenery that looks gatherable but isn't is a lie the player has
  // to learn by walking up to it. Grass no longer comes from here either: the
  // grass field covers the floor, so kit tufts would fight it.
  scatter:     ['rock_small_a', 'rock_small_b', 'rock_small_c',
                'twig_a', 'twig_b', 'twig_c', 'leaf_litter_a', 'leaf_litter_b'],
  pickup_wood: ['pickup_wood_a', 'pickup_wood_b'],
  pickup_stone:['pickup_stone_a', 'pickup_stone_b'],
};

const BASE = './assets/models/';

function loadOne(url) {
  return new Promise((resolve) => {
    loader.load(url, resolve, undefined, () => resolve(null));
  });
}

/**
 * Runs the procedural generators into the same cache the loader fills.
 *
 * Deliberately after loading: a generator overrides a file of the same key, so
 * replacing a grown asset with a real one only means deleting its entry.
 */
export function buildGenerated(onProgress) {
  const entries = Object.entries(GENERATED);
  let done = 0;
  for (const [key, build] of entries) {
    // One fixed seed per key: the same variant every session.
    let seed = 0;
    for (let i = 0; i < key.length; i++) seed = (seed * 31 + key.charCodeAt(i)) & 0x7fffffff;
    const root = build(makeRng(seed));
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      // Thin foliage opts out: see the note in procgen/bushes.js.
      o.receiveShadow = !o.userData.noReceiveShadow;
    });
    cache.set(key, { scene: root, animations: [] });
    failed.delete(key);
    onProgress?.(++done, entries.length);
  }
  return entries.length;
}

/** Loads every registered model. Never rejects — missing files are skipped. */
export async function loadModels(onProgress) {
  const entries = Object.entries(MODELS);
  let done = 0;
  await Promise.all(entries.map(async ([key, path]) => {
    const gltf = await loadOne(BASE + path);
    if (gltf) {
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        // Kenney meshes ship double-sided; single-sided halves the shadow cost.
        // Leave shadowSide alone — three defaults it to BackSide for front-facing
        // materials, and forcing FrontSide makes closed meshes shadow themselves
        // into solid black.
        if (o.material) o.material.side = THREE.FrontSide;
      });
      cache.set(key, gltf);
    } else {
      failed.add(key);
    }
    onProgress?.(++done, entries.length);
  }));
  return { loaded: cache.size, missing: [...failed] };
}

export const hasModel = (key) => cache.has(key);

/** A fresh instance of a model, or null if unavailable. */
export function getModel(key) {
  const gltf = cache.get(key);
  if (!gltf) return null;
  const rigged = gltf.animations?.length > 0;
  const root = rigged ? cloneSkinned(gltf.scene) : gltf.scene.clone(true);
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = !o.userData.noReceiveShadow;
    // A SkinnedMesh's bounding volume is computed from the bind pose and goes
    // stale (or collapses) once the skeleton moves, so the culler throws the
    // character away at some camera angles. Always draw them.
    if (o.isSkinnedMesh) o.frustumCulled = false;
  });
  return root;
}

/**
 * Strips translation tracks from a clip, keeping rotation and scale.
 *
 * Two reasons. First, Mixamo clips animate hip POSITION in the source model's
 * unit scale — donate Soldier's walk to Xbot, whose skeleton is ~100x smaller
 * in local units, and the whole mesh is flung far off screen while its bind
 * pose still measures correctly. Second, we move entities in code, so baked
 * root motion would fight the movement system anyway.
 */
function stripRootMotion(clip) {
  // Scale tracks stay. Measuring a model leaves its skeleton in the bind pose
  // (see localBounds), which costs the bones their rest scale — so the clips are
  // the only thing left putting it back, every frame. Strip them and the whole
  // skeleton collapses to a couple of centimetres and the character vanishes.
  //
  // These once caused the tool in the character's hand to come out the wrong
  // size. That is now handled where it belongs, in Player.fitHeldSlot, which
  // re-derives the hand slot's counter-scale every frame and so does not care
  // what the animation does to the bone.
  const tracks = clip.tracks.filter((t) => !t.name.endsWith('.position'));
  if (tracks.length === clip.tracks.length) return clip;
  const out = clip.clone();
  out.tracks = tracks;
  return out;
}

export function getAnimations(key) {
  const own = cache.get(key)?.animations ?? [];
  const donorKey = ANIM_SOURCE[key];
  if (!donorKey) return own;

  const names = new Set(own.map((c) => c.name.toLowerCase()));
  const donated = (cache.get(donorKey)?.animations ?? [])
    .filter((c) => !names.has(c.name.toLowerCase()))
    .map(stripRootMotion);

  // Keep any clips the model brought itself; fill the gaps from the donor.
  return [...own, ...donated];
}

/**
 * Yaw correction per model, in radians, so its front lines up with +Z.
 * These three Mixamo exports all already face +Z, so they need nothing — but
 * the hook exists because the value genuinely varies between sources, and a
 * wrong global guess shows up as a character walking backwards.
 */
export const MODEL_FACING = {
  char_player_male: 0,
  char_player_female: 0,
  char_zombie_a: 0,
  char_zombie_b: 0,
  char_zombie_c: 0,
  char_brute: 0,
};

export const facingOffset = (key) => MODEL_FACING[key] ?? 0;

const protoCache = new Map();

/**
 * The static meshes of a model, with each one's transform relative to the model
 * root. Geometry and materials are shared, not cloned — this is the input to
 * instancing, so hundreds of trees collapse into a handful of draw calls.
 */
export function getParts(key) {
  if (protoCache.has(key)) return protoCache.get(key);
  const gltf = cache.get(key);
  if (!gltf) return null;

  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const parts = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh) return;
    parts.push({
      geometry: o.geometry,
      material: o.material,
      local: new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld),
      noReceiveShadow: !!o.userData.noReceiveShadow,
    });
  });

  const box = localBounds(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  const info = {
    parts,
    height: size.y || 1,
    minY: box.min.y,
    // Longest side. Sizing a twig or a leaf by height stretches it into a log —
    // flat things have to be scaled by their span instead.
    span: Math.max(size.x, size.y, size.z) || 1,
  };
  protoCache.set(key, info);
  return info;
}

/** Picks a variant key from a VARIANTS group, skipping any that failed to load. */
export function pickVariant(group, rng) {
  const keys = (VARIANTS[group] ?? []).filter(hasModel);
  return keys.length ? keys[Math.floor(rng() * keys.length)] : null;
}

/**
 * Bounds of a model in its own local space, measured from geometry.
 *
 * Box3.setFromObject() is unreliable here: on a SkinnedMesh it measures the
 * *posed* skeleton, which before the first mixer update collapses to near
 * nothing — that's how a 1.8m soldier ends up scaled 394x. Walking the raw
 * geometry boxes instead gives a stable bind-pose measurement.
 */
function localBounds(root) {
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  const rel = new THREE.Matrix4();
  root.updateMatrixWorld(true);

  // Measure in the root's PARENT space, not its own. Some exports put a
  // Z-up -> Y-up correction on the root node itself; inverting that out makes a
  // standing character measure as if it were lying down.
  const inv = new THREE.Matrix4();
  if (root.parent) {
    root.parent.updateMatrixWorld(true);
    inv.copy(root.parent.matrixWorld).invert();
  }

  root.traverse((o) => {
    if (!o.geometry) return;
    rel.multiplyMatrices(inv, o.matrixWorld);

    if (o.isSkinnedMesh && o.skeleton) {
      // A skinned mesh's raw vertices are in bind space, which for Mixamo rigs
      // is ~100x off from the space the bones actually live in. Measuring the
      // geometry directly reports a 1.8m human as 1.8cm. Pose the skeleton and
      // let three transform the vertices through it for a true measurement.
      //
      //
      // This leaves the skeleton posed, and that is deliberate: the bind pose is
      // the pose the locomotion clips are authored against, so it is also the
      // right pose to leave the model standing in. What it costs is the bones'
      // rest position and scale, which the clips must therefore carry — see
      // stripRootMotion.
      o.skeleton.pose();
      o.updateMatrixWorld(true);
      o.computeBoundingBox();
      if (o.boundingBox) {
        tmp.copy(o.boundingBox).applyMatrix4(rel);
        box.union(tmp);
      }

      return;
    }

    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    if (!o.geometry.boundingBox) return;
    tmp.copy(o.geometry.boundingBox).applyMatrix4(rel);
    box.union(tmp);
  });
  return box;
}

/**
 * Stands a skinned model up without turning it round.
 *
 * These exports come out of the measurement pose inverted — head below feet —
 * while already facing the right way. There is exactly one rotation that fixes
 * "up" and leaves "forward" alone, and it is the half turn about Z: a half turn
 * about X would fix up by swinging the model through its own facing, which is
 * how you get a character that walks backwards.
 *
 * The cost is that left and right are mirrored, which for a humanoid is the
 * unavoidable half of the trade — no rotation fixes up, keeps forward, and keeps
 * handedness all at once.
 *
 * Measured, not hardcoded: the convention varies between sources, and judging it
 * has to happen with a clip actually driving the bones, since the rest pose on
 * its own always reads upright.
 */
export function uprightSkeleton(root) {
  root.updateMatrixWorld(true);

  let head = null;
  let foot = null;
  root.traverse((o) => {
    if (!o.isBone) return;
    const n = o.name.toLowerCase();
    if (!head && n.includes('head')) head = o;
    if (!foot && n.includes('foot')) foot = o;
  });
  if (!head || !foot) return root;

  if (head.getWorldPosition(new THREE.Vector3()).y
    < foot.getWorldPosition(new THREE.Vector3()).y) {
    root.rotateZ(Math.PI);
    root.updateMatrixWorld(true);
    // Recorded so anything hung off a bone can undo it. A tool is modelled
    // around its grip with the working end down, and it inherits this turn from
    // the skeleton — leave it uncorrected and the axe is carried head-up.
    root.userData.uprightFlipped = true;
  }

  // Re-seat the feet. The turn swings the figure about the model origin, so the
  // ground offset fitHeight worked out is now upside down with it.
  const box = posedBounds(root);
  if (!box.isEmpty()) {
    root.position.y -= box.min.y;
    root.updateMatrixWorld(true);
  }
  return root;
}

/**
 * Measures a skinned model as it is actually posed right now, in its parent's
 * space.
 *
 * Box3.setFromObject reads the bind-pose bounding box and ignores skinning
 * entirely — it happily reports a correct size for a character that renders as a
 * speck. Pushing the vertices through the bone transforms is the only
 * measurement that reflects what ends up on screen.
 */
function posedBounds(root) {
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  const inv = new THREE.Matrix4();
  root.updateMatrixWorld(true);
  if (root.parent) {
    root.parent.updateMatrixWorld(true);
    inv.copy(root.parent.matrixWorld).invert();
  }

  root.traverse((o) => {
    if (!o.isSkinnedMesh || !o.geometry?.attributes?.position) return;
    // updateMatrixWorld does not refresh the bone matrices — those are rebuilt
    // during render. Without this the samples come from the pose as it was one
    // step ago, which is how a re-seated character ends up hovering.
    o.skeleton.update();
    const pos = o.geometry.attributes.position;
    // A few hundred samples is plenty for an extent, and keeps this off the
    // frame budget on a 30k-vertex character.
    const step = Math.max(1, Math.floor(pos.count / 600));
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i);
      o.applyBoneTransform(i, v);
      v.applyMatrix4(o.matrixWorld).applyMatrix4(inv);
      box.expandByPoint(v);
    }
  });
  return box;
}

/** Scales a model so it stands `height` metres tall with its feet on y=0. */
export function fitHeight(object, height) {
  object.scale.setScalar(1);
  object.position.set(0, 0, 0);
  const box = localBounds(object);
  if (box.isEmpty()) return object;

  const size = new THREE.Vector3();
  box.getSize(size);
  const s = size.y > 1e-6 ? height / size.y : 1;
  object.scale.setScalar(s);
  object.position.y = -box.min.y * s;
  object.userData.fitSize = size.clone().multiplyScalar(s);

  return object;
}

/** Horizontal footprint radius — used to size collision from the actual mesh. */
export function footprint(object) {
  const size = object.userData.fitSize;
  if (size) return Math.max(size.x, size.z) * 0.5;
  const box = localBounds(object);
  const s = new THREE.Vector3();
  box.getSize(s);
  return Math.max(s.x, s.z) * 0.5 * object.scale.x;
}
