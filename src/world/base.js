import * as THREE from 'three';
import { ITEMS } from '../data/items.js';
import { state } from '../core/state.js';
import { makeSlots } from '../core/inventory.js';
import { getModel, fitHeight } from './models.js';

export const CELL = 2;
export const GRID = 3; // cells from centre in each direction — a 14x14m plot

/** Half-width of the buildable plot in metres, for whoever needs to draw it. */
export const PLOT_HALF = GRID * CELL + CELL / 2;

/**
 * The camp you start with: a 5x5-cell cabin — 6x6m of floor inside an unbroken
 * wall ring, with a door in the middle of the south side.
 *
 * Built from the ring outwards rather than listed by hand, so the shape stays
 * easy to change: walls fill the perimeter, floorboards fill everything inside.
 */
function starterCabin() {
  const HALF = 2;              // cells from centre to wall — a 5x5 footprint
  const pieces = [];
  for (let gx = -HALF; gx <= HALF; gx++) {
    for (let gz = -HALF; gz <= HALF; gz++) {
      const onRing = Math.abs(gx) === HALF || Math.abs(gz) === HALF;
      if (!onRing) {
        pieces.push({ gx, gz, item: 'floor_wood' });
      } else if (gx === 0 && gz === HALF) {
        pieces.push({ gx, gz, item: 'door_wood' });     // the way in, facing south
      } else {
        pieces.push({ gx, gz, item: 'wall_wood' });
      }
    }
  }
  return pieces;
}

export const STARTER_BASE = starterCabin();

const mat = (c, opts = {}) =>
  new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, flatShading: true, ...opts });

export const cellKey = (gx, gz) => `${gx},${gz}`;
export const inGrid = (gx, gz) => Math.abs(gx) <= GRID && Math.abs(gz) <= GRID;
export const worldToCell = (x, z) => [Math.round(x / CELL), Math.round(z / CELL)];
export const cellToWorld = (gx, gz) => new THREE.Vector3(gx * CELL, 0, gz * CELL);

// Which model each buildable uses, and how tall it should end up in metres.
const PIECE_MODELS = {
  // Timber pieces are built to real size by their generator — boards, joists and
  // nails are all in metres — so they're placed as-is rather than scaled to fit.
  floor_wood:  { key: 'plank_floor_a', height: 0.12, asBuilt: true },
  wall_wood:   { key: 'plank_wall_a',  halfKey: 'plank_wall_half_a', height: 2.1, asBuilt: true },
  wall_stone:  { key: 'wall_metal',  height: 2.5 },
  door_wood:   { key: 'plank_door_a',  height: 2.1,  asBuilt: true },
  box_storage: { key: 'chest',       height: 0.85 },
  campfire:    { key: 'campfire',    height: 0.5 },
  workbench:   { key: 'workbench',   height: 1.15 },
  furnace:     { key: 'workbench_anvil', height: 1.1 },
  garden_bed:  { key: 'bedroll',     height: 0.3 },
};

// yaw turns the model's long axis (X) onto the axis the arm runs along.
const DIRS = [
  { key: 'n', dx: 0, dz: -1, yaw: Math.PI / 2 },
  { key: 's', dx: 0, dz: 1, yaw: Math.PI / 2 },
  { key: 'w', dx: -1, dz: 0, yaw: 0 },
  { key: 'e', dx: 1, dz: 0, yaw: 0 },
];

/** Sides of this cell where the wall line carries on into another wall or door. */
function wallLinks(gx, gz) {
  const links = [];
  for (const d of DIRS) {
    const c = state.base[cellKey(gx + d.dx, gz + d.dz)];
    if (c && (c.build === 'wall' || c.build === 'door')) links.push(d);
  }
  return links;
}

/**
 * A wall built out of half-segments, one running from the cell centre to each
 * side that continues into another wall.
 *
 * A full-cell wall can only face one way, so a corner left a gap: the two lines
 * meeting there are a cell apart, and neither piece reaches the other. Half
 * segments each stop exactly on the cell edge, which is where the neighbour
 * starts — straights, corners, tees and crossings all close up with no gap and
 * no overlap, and the wall orients itself from its neighbours.
 */
function buildWallSegments(spec, links) {
  const g = new THREE.Group();
  for (const d of links) {
    // Prefer a purpose-built half piece; fall back to squeezing a full one.
    const model = getModel(spec.halfKey ?? spec.key);
    if (!model) continue;
    if (!spec.asBuilt) fitHeight(model, spec.height);
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    if (!spec.halfKey) {
      const centre = bounds.getCenter(new THREE.Vector3());
      model.position.x -= centre.x;
      model.position.z -= centre.z;
      // Squeeze the span to half a cell, then push it out to fill that half.
      if (size.x > 0.001) model.scale.x *= (CELL / 2) / size.x;
    }
    model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

    const arm = new THREE.Group();
    arm.add(model);
    arm.position.set(d.dx * CELL / 4, 0, d.dz * CELL / 4);
    arm.rotation.y = d.yaw;
    g.add(arm);
  }
  return g;
}

function buildPiece(itemId, links = null) {
  const spec = PIECE_MODELS[itemId];
  // Walls knit themselves into their neighbours; everything else is a whole piece.
  if (spec && ITEMS[itemId]?.build === 'wall' && links?.length) {
    return buildWallSegments(spec, links);
  }
  const model = spec && getModel(spec.key);
  if (model) {
    const g = new THREE.Group();
    // Generated timber already measures correctly; rescaling it would undo the
    // board thicknesses and nail sizes it was built with.
    if (!spec.asBuilt) fitHeight(model, spec.height);
    // Floors tile edge-to-edge; everything else keeps its natural footprint.
    if (spec.fill) {
      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      box.getSize(size);
      const w = Math.max(size.x, size.z);
      // Footprint only. The kit's floor panel is nearly as tall as it is wide, so
      // scaling uniformly to fill a 2m cell dragged the height up with it and
      // turned the floorboards into a 2.2m plinth.
      if (w > 0.001) {
        model.scale.x *= CELL / w;
        model.scale.z *= CELL / w;
      }
      model.position.y = 0;
    }
    // Centre the footprint on the cell. Kit models don't all have their origin in
    // the middle, and an off-centre origin swings the piece sideways the moment
    // it's rotated — two walls turned the same way end up at different distances
    // from the room they're supposed to enclose. Generated timber is already
    // built around its own centre.
    if (!spec.asBuilt) {
      const bounds = new THREE.Box3().setFromObject(model);
      const centre = bounds.getCenter(new THREE.Vector3());
      model.position.x -= centre.x;
      model.position.z -= centre.z;
    }
    model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.add(model);
    if (itemId === 'campfire') {
      const light = new THREE.PointLight(0xff9040, 7, 10, 2);
      light.position.y = 1.0;
      g.add(light);
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.24, 0.6, 5),
        new THREE.MeshStandardMaterial({ color: 0xff8a3a, emissive: 0xff6a1a, emissiveIntensity: 2, flatShading: true }));
      flame.position.y = 0.5;
      g.add(flame);
      g.userData.flame = flame;
    }
    return g;
  }
  return buildPiecePrimitive(itemId);
}

function buildPiecePrimitive(itemId) {
  const def = ITEMS[itemId];
  const g = new THREE.Group();

  switch (def.build) {
    case 'floor': {
      const f = new THREE.Mesh(new THREE.BoxGeometry(CELL, 0.12, CELL), mat(0x8a6a42));
      f.position.y = 0.06;
      g.add(f);
      for (let i = 0; i < 3; i++) {
        const plank = new THREE.Mesh(new THREE.BoxGeometry(CELL * 0.96, 0.02, 0.06), mat(0x6f5334));
        plank.position.set(0, 0.13, -0.6 + i * 0.6);
        g.add(plank);
      }
      break;
    }
    case 'wall': {
      const stone = itemId === 'wall_stone';
      const w = new THREE.Mesh(
        new THREE.BoxGeometry(CELL, stone ? 2.6 : 2.4, stone ? 0.42 : 0.3),
        mat(stone ? 0x8b8b86 : 0x8a6a42));
      w.position.y = (stone ? 2.6 : 2.4) / 2;
      g.add(w);
      if (!stone) {
        for (let i = 0; i < 3; i++) {
          const beam = new THREE.Mesh(new THREE.BoxGeometry(CELL * 0.95, 0.1, 0.36), mat(0x6f5334));
          beam.position.set(0, 0.45 + i * 0.85, 0);
          g.add(beam);
        }
      }
      break;
    }
    case 'door': {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(CELL, 2.4, 0.22), mat(0x6f5334));
      frame.position.y = 1.2;
      g.add(frame);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(CELL * 0.66, 2.0, 0.3), mat(0xa07b4a));
      panel.position.y = 1.0;
      g.add(panel);
      g.userData.panel = panel;
      break;
    }
    case 'storage': {
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 0.9), mat(0x7d5f3c));
      box.position.y = 0.45;
      g.add(box);
      const lid = new THREE.Mesh(new THREE.BoxGeometry(1.26, 0.14, 0.96), mat(0x5f4830));
      lid.position.y = 0.95;
      g.add(lid);
      break;
    }
    case 'garden': {
      const soil = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.32, 1.7), mat(0x4a3a2a));
      soil.position.y = 0.16;
      g.add(soil);
      for (let i = 0; i < 4; i++) {
        const sprout = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.4, 4), mat(0x6f9b4a));
        sprout.position.set(-0.45 + (i % 2) * 0.9, 0.5, -0.45 + Math.floor(i / 2) * 0.9);
        g.add(sprout);
      }
      break;
    }
    case 'station': {
      if (def.station === 'campfire') {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.16, 5, 9), mat(0x6b6f73));
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.16;
        g.add(ring);
        for (let i = 0; i < 4; i++) {
          const log = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.8, 5), mat(0x4a3728));
          log.rotation.set(Math.PI / 2.4, (i / 4) * Math.PI * 2, 0);
          log.position.y = 0.25;
          g.add(log);
        }
        const flame = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.7, 5),
          mat(0xff8a3a, { emissive: 0xff6a1a, emissiveIntensity: 1.6 }));
        flame.position.y = 0.62;
        g.add(flame);
        g.userData.flame = flame;
        const light = new THREE.PointLight(0xff9040, 6, 9, 2);
        light.position.y = 1.0;
        g.add(light);
      } else if (def.station === 'workbench') {
        const top = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.16, 0.9), mat(0x8a6a42));
        top.position.y = 0.95;
        g.add(top);
        for (const [x, z] of [[-0.7, -0.32], [0.7, -0.32], [-0.7, 0.32], [0.7, 0.32]]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.9, 0.14), mat(0x6f5334));
          leg.position.set(x, 0.45, z);
          g.add(leg);
        }
        const vice = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.24, 0.24), mat(0x6b6f73));
        vice.position.set(0.6, 1.15, 0);
        g.add(vice);
      } else {
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.85, 1.5, 7), mat(0x6b6560));
        body.position.y = 0.75;
        g.add(body);
        const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.7, 6), mat(0x565049));
        chimney.position.y = 1.75;
        g.add(chimney);
        const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.2),
          mat(0xff7a2a, { emissive: 0xff5a10, emissiveIntensity: 1.4 }));
        mouth.position.set(0, 0.6, 0.78);
        g.add(mouth);
      }
      break;
    }
  }

  g.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
  return g;
}

/**
 * Stamps the starter shelter into an empty plot. Anything already built is left
 * untouched, so this is safe to call on every boot — including for saves made
 * before the shelter existed.
 */
export function ensureStarterBase() {
  if (Object.keys(state.base).length > 0) return false;
  for (const piece of STARTER_BASE) {
    const def = ITEMS[piece.item];
    state.base[cellKey(piece.gx, piece.gz)] = {
      item: piece.item,
      build: def.build,
      hp: def.hp ?? 100,
      rot: piece.rot ?? 0,
    };
  }
  return true;
}

export class Base {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.meshes = new Map();
    scene.add(this.root);

    this.gridHelper = this.makeGrid();
    this.gridHelper.visible = false;
    scene.add(this.gridHelper);

    this.ghost = new THREE.Group();
    this.ghost.visible = false;
    scene.add(this.ghost);
    this.ghostId = null;

    this.rebuild();
  }

  makeGrid() {
    const g = new THREE.Group();
    const size = GRID * 2 * CELL + CELL;
    const grid = new THREE.GridHelper(size, GRID * 2 + 1, 0x9fd8a0, 0x5d7a5e);
    grid.position.y = 0.03;
    grid.material.opacity = 0.35;
    grid.material.transparent = true;
    g.add(grid);
    return g;
  }

  rebuild() {
    for (const m of this.meshes.values()) this.root.remove(m);
    this.meshes.clear();
    for (const key of Object.keys(state.base)) {
      const [gx, gz] = key.split(',').map(Number);
      this.refresh(gx, gz);
    }
  }

  /** (Re)builds one cell's mesh from its current neighbours. */
  refresh(gx, gz) {
    const key = cellKey(gx, gz);
    const old = this.meshes.get(key);
    if (old) {
      this.root.remove(old);
      this.meshes.delete(key);
    }
    const cell = state.base[key];
    if (!cell) return;

    const joins = cell.build === 'wall' || cell.build === 'door' ? wallLinks(gx, gz) : null;
    const mesh = buildPiece(cell.item, joins);
    mesh.position.copy(cellToWorld(gx, gz));
    if (cell.build === 'wall' && joins?.length) {
      mesh.rotation.y = 0;                     // the segments carry their own aim
    } else if (cell.build === 'door' && joins?.length) {
      // Sit square in the wall line the door interrupts.
      mesh.rotation.y = joins.some((d) => d.dz !== 0) ? Math.PI / 2 : 0;
    } else {
      mesh.rotation.y = cell.rot ?? 0;
    }
    this.root.add(mesh);
    this.meshes.set(key, mesh);
  }

  /** A piece changing shape changes its neighbours' shapes too. */
  refreshAround(gx, gz) {
    this.refresh(gx, gz);
    for (const d of DIRS) this.refresh(gx + d.dx, gz + d.dz);
  }

  get(gx, gz) { return state.base[cellKey(gx, gz)] ?? null; }

  canPlace(gx, gz, itemId) {
    if (!inGrid(gx, gz)) return 'Outside the plot';
    const def = ITEMS[itemId];
    const existing = this.get(gx, gz);
    if (!existing) return def.build === 'floor' ? true : true;
    if (existing.item === itemId) return 'Already here';
    // A floor can sit under nothing else; everything else replaces.
    return true;
  }

  place(gx, gz, itemId, rot = 0) {
    const def = ITEMS[itemId];
    const cell = {
      item: itemId,
      build: def.build,
      hp: def.hp ?? 100,
      rot,
    };
    if (def.build === 'station') cell.station = def.station;
    if (def.build === 'storage') cell.contents = makeSlots(def.capacity ?? 12);

    const key = cellKey(gx, gz);
    const old = state.base[key];
    state.base[key] = cell;
    this.refreshAround(gx, gz);
    return old ?? null;
  }

  remove(gx, gz) {
    const key = cellKey(gx, gz);
    const cell = state.base[key];
    if (!cell) return null;
    delete state.base[key];
    this.refreshAround(gx, gz);
    return cell;
  }

  showGhost(gx, gz, itemId, valid, rot = 0) {
    if (!itemId) { this.ghost.visible = false; return; }
    if (itemId !== this.ghostId) {
      this.ghost.clear();
      const g = buildPiece(itemId);
      g.traverse((o) => {
        if (!o.material) return;
        o.material = o.material.clone();
        o.material.transparent = true;
        o.material.opacity = 0.55;
        o.castShadow = false;
      });
      this.ghost.add(g);
      this.ghostId = itemId;
    }
    this.ghost.visible = true;
    this.ghost.position.copy(cellToWorld(gx, gz));
    this.ghost.rotation.y = rot;
    this.ghost.traverse((o) => {
      if (o.material && o.material.color) {
        o.material.emissive?.setHex(valid ? 0x224422 : 0x552222);
      }
    });
  }

  hideGhost() { this.ghost.visible = false; }
  setBuildMode(on) { this.gridHelper.visible = on; if (!on) this.hideGhost(); }

  /**
   * Solid pieces the player and zombies bump into.
   *
   * Doorways are walk-through — a door you can't pass is just an expensive wall,
   * and with whole-cell pieces it would seal the room it's meant to open.
   * Walls use 0.8 rather than a full half-cell: the collider is a circle around
   * the cell centre, so a full 1.0 reaches right across the neighbouring cell and
   * makes a 2x2m room too tight to stand in. At 0.8 the gap between two adjacent
   * walls is 0.4m — still far too narrow for a 0.84m-wide body to slip through.
   */
  colliders() {
    const out = [];
    for (const [key, cell] of Object.entries(state.base)) {
      if (cell.build === 'floor' || cell.build === 'door') continue;
      const [gx, gz] = key.split(',').map(Number);
      out.push({
        position: cellToWorld(gx, gz),
        radius: cell.build === 'wall' ? 0.8 : 0.75,
        active: true,
        entity: null,
      });
    }
    return out;
  }

  /**
   * Is this world position inside a built cell? Used to keep grass from growing
   * up through floors and walls.
   *
   * Slightly inset from the cell edge so blades right at a floor's rim aren't
   * culled — they read as grass creeping up against the boards.
   */
  occupiedAt(x, z, inset = 0.12) {
    const [gx, gz] = worldToCell(x, z);
    if (!state.base[cellKey(gx, gz)]) return false;
    const centre = cellToWorld(gx, gz);
    const half = CELL / 2 - inset;
    return Math.abs(x - centre.x) <= half && Math.abs(z - centre.z) <= half;
  }

  /** Nearest interactable base cell (storage/station) within range. */
  nearest(pos, range = 2.6) {
    let best = null;
    let bestD = range;
    for (const [key, cell] of Object.entries(state.base)) {
      if (cell.build !== 'storage' && cell.build !== 'station' && cell.build !== 'garden') continue;
      const [gx, gz] = key.split(',').map(Number);
      const d = cellToWorld(gx, gz).distanceTo(pos);
      if (d < bestD) { bestD = d; best = { key, cell, gx, gz }; }
    }
    return best;
  }

  /** Which crafting station the player is standing next to, if any. */
  stationAt(pos, range = 3.2) {
    for (const [key, cell] of Object.entries(state.base)) {
      if (cell.build !== 'station') continue;
      const [gx, gz] = key.split(',').map(Number);
      if (cellToWorld(gx, gz).distanceTo(pos) <= range) return cell.station;
    }
    return null;
  }

  animate(t) {
    for (const mesh of this.meshes.values()) {
      const flame = mesh.userData.flame;
      if (flame) {
        flame.scale.setScalar(0.85 + Math.sin(t * 9 + mesh.position.x) * 0.15);
        flame.rotation.y = t * 2;
      }
    }
  }
}
