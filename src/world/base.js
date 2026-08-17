import * as THREE from 'three';
import { state } from '../core/state.js';
import { makeSlots } from '../core/inventory.js';
import { getModel } from './models.js';
import {
  LAYERS, blueprint, socketOf,
  CELL, WALL_H, FOUND_TOP, DECK_TOP, PLOT, CAMP_CLEAR_HALF,
} from '../data/building.js';

// The base the player builds, held as sockets rather than as whole cells.
//
// Every cell carries one slot per layer — a foundation, a floor, a roof and one
// object — plus a wall slot on each of its four boundaries. So a square can hold
// a floor, four walls and a crate at the same time, which a one-piece-per-cell
// grid cannot.
//
// Walls living on the boundary rather than inside a square is the whole point:
// a floor fills its square right out to the edge and the wall stands exactly on
// the seam, so the two meet with no gap and no overlap, and a room is the size
// of the squares inside it.

export { CELL, PLOT, DECK_TOP, WALL_H, FOUND_TOP, CAMP_CLEAR_HALF };

// 'n' is the boundary between (gx,gz) and (gx,gz-1); 'w' between (gx,gz) and
// (gx-1,gz). Every boundary has exactly one name, so two squares can never each
// build their own copy of the wall between them.
const SIDES = {
  n: { dx: 0, dz: -0.5, yaw: 0,           cells: [[0, 0], [0, -1]] },
  w: { dx: -0.5, dz: 0, yaw: Math.PI / 2, cells: [[0, 0], [-1, 0]] },
};

const NEIGHBOURS = [[0, -1], [0, 1], [-1, 0], [1, 0]];

export const cellKey = (layer, gx, gz) => `${layer}:${gx},${gz}`;
export const wallKey = (gx, gz, side) => `wall:${gx},${gz},${side}`;

export const worldToCell = (x, z) => [Math.round(x / CELL), Math.round(z / CELL)];
export const cellToWorld = (gx, gz) => new THREE.Vector3(gx * CELL, 0, gz * CELL);
export const inPlot = (gx, gz) => Math.abs(gx) <= PLOT && Math.abs(gz) <= PLOT;

/** Splits a socket key back into its parts. */
export function parseKey(key) {
  const [layer, rest] = key.split(':');
  const bits = rest.split(',');
  return {
    layer, gx: +bits[0], gz: +bits[1],
    side: bits[2] ?? null,
    socket: LAYERS[layer].socket,
  };
}

/** Where a socket sits in the world, and which way its piece faces. */
export function socketTransform(t) {
  const y = LAYERS[t.layer].y;
  if (t.socket === 'edge') {
    const s = SIDES[t.side];
    return {
      pos: new THREE.Vector3((t.gx + s.dx) * CELL, y, (t.gz + s.dz) * CELL),
      yaw: s.yaw,
    };
  }
  return { pos: new THREE.Vector3(t.gx * CELL, y, t.gz * CELL), yaw: 0 };
}

export const keyOf = (t) =>
  (t.socket === 'edge' ? wallKey(t.gx, t.gz, t.side) : cellKey(t.layer, t.gx, t.gz));

/** The four boundaries of a cell, as socket descriptors. */
const cellEdges = (gx, gz) => [
  { layer: 'wall', socket: 'edge', gx, gz, side: 'n' },
  { layer: 'wall', socket: 'edge', gx, gz: gz + 1, side: 'n' },
  { layer: 'wall', socket: 'edge', gx, gz, side: 'w' },
  { layer: 'wall', socket: 'edge', gx: gx + 1, gz, side: 'w' },
];

/** Cells from the camp centre that come already decked. A 3x3, so 6x6 metres. */
const STARTER_PLOT = 1;

/**
 * Lays the platform the player spawns standing on.
 *
 * Deliberately only ground: a foundation and a floor, no walls, no roof, no
 * door. It is not a house — it is the answer to "where does my base go", which
 * an empty field does not give you. Everything above it is still the player's
 * to put up, and the opening mission still asks them to lay a foundation and a
 * floor of their own, because goals count what you build rather than what is
 * standing.
 *
 * Only ever runs on an empty plot, so it can be called on every boot and will
 * never overwrite something the player put there.
 */
export function ensureStarterPlot() {
  if (Object.keys(state.base).length > 0) return false;
  for (let gx = -STARTER_PLOT; gx <= STARTER_PLOT; gx++) {
    for (let gz = -STARTER_PLOT; gz <= STARTER_PLOT; gz++) {
      for (const layer of ['foundation', 'floor']) {
        const id = layer === 'foundation' ? 'foundation_wood' : 'floor_wood';
        state.base[cellKey(layer, gx, gz)] = {
          item: id, hp: blueprint(id)?.hp ?? 100, rot: 0,
        };
      }
    }
  }
  return true;
}

/** Stable per-socket variant pick, so a wall keeps its board pattern on reload. */
function variantFor(key, models) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) & 0x7fffffff;
  return models[h % models.length];
}

// ---------------------------------------------------------------- placement rules

const has = (key) => !!state.base[key];

/**
 * Is there something for this blueprint to stand on?
 *
 * One rule per layer, and the reasons read back to the player as written. A new
 * buildable picks a layer in the catalogue instead of teaching the base about
 * itself.
 */
function canSupport(bp, t) {
  switch (bp.layer) {
    case 'foundation':
      return true;

    case 'floor':
      return has(cellKey('foundation', t.gx, t.gz)) ? true : 'Needs a foundation under it';

    case 'wall': {
      if (bp.freestanding) return true;
      const ok = SIDES[t.side].cells
        .some(([dx, dz]) => has(cellKey('floor', t.gx + dx, t.gz + dz)));
      return ok ? true : 'Needs a floor beside it';
    }

    case 'roof': {
      const walled = cellEdges(t.gx, t.gz).some((e) => has(keyOf(e)));
      if (walled) return true;
      // Or carry on from a roof that is already up, so a room wider than one
      // cell can be covered without walling every square inside it.
      const joins = NEIGHBOURS.some(([dx, dz]) => has(cellKey('roof', t.gx + dx, t.gz + dz)));
      return joins ? true : 'Needs a wall to sit on';
    }

    case 'object':
      return has(cellKey('floor', t.gx, t.gz)) ? true : 'Needs a floor under it';

    default:
      return true;
  }
}

// ---------------------------------------------------------------- piece meshes

/**
 * Builds one piece's mesh.
 *
 * Models come out of the generators at true size and already centred on their
 * own socket, so nothing here rescales or re-centres them — a 25mm board stays
 * 25mm whichever socket it lands in.
 */
function buildPiece(id, key = id) {
  const bp = blueprint(id);
  const g = new THREE.Group();
  if (!bp) return g;

  const model = getModel(variantFor(key, bp.models));
  if (model) {
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      if (!o.userData.noReceiveShadow) o.receiveShadow = true;
    });
    // Looked up by name rather than read out of userData: getModel returns a
    // clone, and cloning puts userData through JSON, so any object reference in
    // there arrives as a plain copy with no live rotation to drive.
    g.userData.leaf = model.getObjectByName('door_leaf') ?? null;
    g.userData.flame = model.getObjectByName('flame') ?? null;
    g.add(model);
  }

  // Roofs have to be able to disappear when you walk under them, and materials
  // are shared between every piece that uses them — so a roof gets its own.
  if (bp.layer === 'roof') {
    g.userData.fade = [];
    g.traverse((o) => {
      if (!o.isMesh) return;
      o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
      for (const m of [].concat(o.material)) {
        m.transparent = true;
        g.userData.fade.push(m);
      }
    });
  }
  return g;
}

// ---------------------------------------------------------------- the base

export class Base {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.meshes = new Map();
    scene.add(this.root);

    /** Set by the game: world positions already taken by trees, rocks, wrecks. */
    this.obstructed = null;

    this.gridHelper = this.makeGrid();
    this.gridHelper.visible = false;
    scene.add(this.gridHelper);

    this.ghost = new THREE.Group();
    this.ghost.visible = false;
    scene.add(this.ghost);
    this.ghostId = null;

    // Outline drawn round the piece the cursor would take down. Demolition
    // without it is a guess: you click, something within a couple of metres
    // vanishes, and you find out afterwards whether it was the one you meant.
    this.removeMarker = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: 0xe2624a, depthTest: false, transparent: true, opacity: 0.95 }));
    this.removeMarker.renderOrder = 999;
    this.removeMarker.visible = false;
    scene.add(this.removeMarker);
    this.roofFade = 1;

    this.rebuild();
  }

  makeGrid() {
    const g = new THREE.Group();
    const size = PLOT * 2 * CELL + CELL;
    const grid = new THREE.GridHelper(size, PLOT * 2 + 1, 0x9fd8a0, 0x486b4c);
    grid.position.y = 0.02;
    grid.material.opacity = 0.22;
    grid.material.transparent = true;
    g.add(grid);
    return g;
  }

  rebuild() {
    for (const m of this.meshes.values()) this.root.remove(m);
    this.meshes.clear();
    for (const key of Object.keys(state.base)) this.refresh(key);
  }

  refresh(key) {
    const old = this.meshes.get(key);
    if (old) {
      this.root.remove(old);
      this.meshes.delete(key);
    }
    const cell = state.base[key];
    if (!cell) return;

    const t = parseKey(key);
    const mesh = buildPiece(cell.item, key);
    const { pos, yaw } = socketTransform(t);
    mesh.position.copy(pos);
    mesh.rotation.y = yaw + (cell.rot ?? 0) * (Math.PI / 2);
    mesh.userData.socket = t;
    mesh.userData.socketKey = key;
    this.root.add(mesh);
    this.meshes.set(key, mesh);
  }

  get(key) { return state.base[key] ?? null; }

  // ---- targeting ------------------------------------------------------

  /**
   * Which socket a click at this point should fill.
   *
   * The cursor picks the nearest socket, but a blocked one steps aside for the
   * next nearest that would actually work — so dragging a wall along a deck
   * lands each piece in the next free slot instead of stalling on the one you
   * already built.
   */
  targetFor(id, point) {
    const bp = blueprint(id);
    if (!bp) return null;
    const candidates = socketOf(bp) === 'edge'
      ? this.edgeCandidates(point)
      : this.cellCandidates(bp, point);

    let fallback = null;
    for (const t of candidates) {
      const reason = this.checkPlace(id, t);
      if (reason === true) return { ...t, ok: true, reason: null };
      fallback = fallback ?? { ...t, ok: false, reason };
    }
    return fallback;
  }

  /** The cell under the point, then its neighbours, nearest first. */
  cellCandidates(bp, point) {
    const [gx, gz] = worldToCell(point.x, point.z);
    const mk = (x, z) => ({ layer: bp.layer, socket: 'cell', gx: x, gz: z });
    const ranked = NEIGHBOURS
      .map(([dx, dz]) => mk(gx + dx, gz + dz))
      .sort((a, b) => this.distTo(a, point) - this.distTo(b, point));
    return [mk(gx, gz), ...ranked];
  }

  /** The four boundaries of the cell under the point, nearest first. */
  edgeCandidates(point) {
    const [gx, gz] = worldToCell(point.x, point.z);
    return cellEdges(gx, gz).sort((a, b) => this.distTo(a, point) - this.distTo(b, point));
  }

  distTo(t, point) {
    const { pos } = socketTransform(t);
    return (pos.x - point.x) ** 2 + (pos.z - point.z) ** 2;
  }

  /** true, or the reason this blueprint can't go in this socket. */
  checkPlace(id, t) {
    const bp = blueprint(id);
    if (!inPlot(t.gx, t.gz)) return 'Outside your plot';
    if (state.base[keyOf(t)]) return 'Something is already here';

    const support = canSupport(bp, t);
    if (support !== true) return support;

    if (this.obstructed && t.socket !== 'edge') {
      const { pos } = socketTransform(t);
      if (this.obstructed(pos.x, pos.z)) return 'Something is in the way';
    }
    return true;
  }

  // ---- building and taking down ---------------------------------------

  place(t, id) {
    const bp = blueprint(id);
    const key = keyOf(t);
    const cell = { item: id, hp: bp.hp ?? 100, rot: t.rot ?? 0 };
    if (bp.station) cell.station = bp.station;
    if (bp.capacity) cell.contents = makeSlots(bp.capacity);

    state.base[key] = cell;
    this.refresh(key);
    return key;
  }

  remove(key) {
    const cell = state.base[key];
    if (!cell) return null;
    delete state.base[key];
    this.refresh(key);
    // Pulling a floor out from under a wall leaves the wall unsupported, but
    // knocking it down too would cascade through a whole building on one click.
    // The wall stays; it just can't be rebuilt there until the floor is back.
    return cell;
  }

  /**
   * The piece the cursor is actually pointing at.
   *
   * Distance on the ground plane cannot separate a roof from the floor beneath
   * it — every layer of a cell shares the same x and z, so whichever happened to
   * be inserted first always won and a ceiling could never be selected at all.
   * Hitting the meshes with the real ray is the only way to tell a stack apart.
   *
   * Returns null when the ray misses the base entirely; callers fall back to
   * proximity so pointing at bare ground beside a piece still finds it.
   */
  pickKey(raycaster) {
    // A piece placed this frame has not had its world matrix computed yet, and
    // raycasting against a stale matrix quietly returns whatever was underneath
    // it instead. Cheap next to the intersection test itself.
    this.root.updateMatrixWorld(true);
    const hits = raycaster.intersectObject(this.root, true);
    for (const h of hits) {
      let o = h.object;
      while (o && o !== this.root) {
        if (o.userData.socketKey) return o.userData.socketKey;
        o = o.parent;
      }
    }
    return null;
  }

  /** The piece nearest this point, for when the ray hits nothing. */
  nearestSocket(point, range = 2.2) {
    let best = null;
    let bestD = range * range;
    for (const key of Object.keys(state.base)) {
      const { pos } = socketTransform(parseKey(key));
      const d = (pos.x - point.x) ** 2 + (pos.z - point.z) ** 2;
      if (d < bestD) { bestD = d; best = key; }
    }
    return best;
  }

  // ---- what the rest of the game asks ---------------------------------

  /**
   * Solid pieces to bump into.
   *
   * A wall is a 2m line, not a blob in the middle of a square, so it gets a row
   * of small circles strung along its length.
   *
   * The circles are deliberately tiny. A circle keeps the player its own radius
   * plus theirs away, so a fat one would hold you the better part of a metre off
   * your own wall; at 0.12 you stop about half a metre from it, which reads as
   * standing against the boards. Five of them at 0.4m spacing is close enough
   * that nobody fits between two — a 0.42m body would have to pass within 0.2m
   * of one — and the end circles sit near enough to the cell corner that the next
   * wall's end circle closes the join.
   */
  colliders() {
    const out = [];
    for (const [key, cell] of Object.entries(state.base)) {
      const bp = blueprint(cell.item);
      if (!bp || !bp.solid) continue;
      const t = parseKey(key);
      const { pos, yaw } = socketTransform(t);
      if (t.socket === 'edge') {
        const ax = Math.cos(yaw);
        const az = -Math.sin(yaw);
        for (const s of [-0.8, -0.4, 0, 0.4, 0.8]) {
          out.push({
            position: new THREE.Vector3(pos.x + ax * s, 0, pos.z + az * s),
            radius: bp.solid, active: true, entity: null,
          });
        }
      } else {
        out.push({ position: new THREE.Vector3(pos.x, 0, pos.z), radius: bp.solid, active: true, entity: null });
      }
    }
    return out;
  }

  /** Keeps grass from growing up through what you've built. */
  occupiedAt(x, z, inset = 0.1) {
    for (const [key, cell] of Object.entries(state.base)) {
      const bp = blueprint(cell.item);
      if (!bp?.clears) continue;
      const t = parseKey(key);
      const { pos, yaw } = socketTransform(t);

      if (t.socket === 'edge') {
        // A band along the wall line rather than a circle, so the grass stops in
        // a straight edge against the boards.
        const dx = x - pos.x;
        const dz = z - pos.z;
        const along = Math.abs(Math.cos(yaw) * dx - Math.sin(yaw) * dz);
        const across = Math.abs(Math.sin(yaw) * dx + Math.cos(yaw) * dz);
        if (along <= CELL / 2 && across <= bp.clears / 2) return true;
      } else if (bp.layer === 'foundation' || bp.layer === 'floor') {
        const half = CELL / 2 - inset;
        if (Math.abs(x - pos.x) <= half && Math.abs(z - pos.z) <= half) return true;
      } else if ((x - pos.x) ** 2 + (z - pos.z) ** 2 <= bp.clears ** 2) {
        return true;
      }
    }
    return false;
  }

  /** How high the ground is here — you step up onto your own deck. */
  surfaceY(x, z) {
    const [gx, gz] = worldToCell(x, z);
    const c = cellToWorld(gx, gz);
    const half = CELL / 2;
    if (Math.abs(x - c.x) > half || Math.abs(z - c.z) > half) return 0;
    if (has(cellKey('floor', gx, gz))) return DECK_TOP;
    if (has(cellKey('foundation', gx, gz))) return FOUND_TOP;
    return 0;
  }

  /** Nearest thing worth pressing E on. */
  nearest(pos, range = 2.6) {
    let best = null;
    let bestD = range;
    for (const [key, cell] of Object.entries(state.base)) {
      const bp = blueprint(cell.item);
      if (!bp || (!bp.capacity && !bp.station)) continue;
      const d = socketTransform(parseKey(key)).pos.distanceTo(pos);
      if (d < bestD) { bestD = d; best = { key, cell, bp }; }
    }
    return best;
  }

  /** Which crafting station the player is standing next to, if any. */
  stationAt(pos, range = 3.2) {
    for (const [key, cell] of Object.entries(state.base)) {
      if (!cell.station) continue;
      if (socketTransform(parseKey(key)).pos.distanceTo(pos) <= range) return cell.station;
    }
    return null;
  }

  // ---- ghost ----------------------------------------------------------

  showGhost(target, id) {
    if (!target || !id) { this.hideGhost(); return; }
    if (id !== this.ghostId) {
      this.ghost.clear();
      const g = buildPiece(id);
      g.traverse((o) => {
        if (!o.isMesh) return;
        o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
        for (const m of [].concat(o.material)) {
          m.transparent = true;
          m.opacity = 0.5;
          m.depthWrite = false;
        }
        o.castShadow = false;
        o.receiveShadow = false;
      });
      this.ghost.add(g);
      this.ghostId = id;
    }
    const { pos, yaw } = socketTransform(target);
    this.ghost.visible = true;
    this.ghost.position.copy(pos);
    this.ghost.rotation.y = yaw + (target.rot ?? 0) * (Math.PI / 2);

    const glow = target.ok ? 0x2f6b2a : 0x6b2020;
    this.ghost.traverse((o) => {
      for (const m of [].concat(o.material ?? [])) m.emissive?.setHex(glow);
    });
  }

  hideGhost() { this.ghost.visible = false; }

  /**
   * Outlines the piece at `key`, or clears the outline when given nothing.
   *
   * The box is sized by layer rather than measured off the mesh: a wall is a
   * slab on a boundary, a floor is a whole cell, and an outline that hugged the
   * actual boards would be a mess of edges instead of one readable shape.
   */
  showRemoveTarget(key) {
    if (!key || !state.base[key]) { this.removeMarker.visible = false; return; }
    const t = parseKey(key);
    const { pos, yaw } = socketTransform(t);
    const m = this.removeMarker;

    if (t.socket === 'edge') m.scale.set(CELL, WALL_H, 0.3);
    else if (t.layer === 'roof') m.scale.set(CELL, 0.3, CELL);
    else if (t.layer === 'object') m.scale.set(1.3, 1.2, 1.3);
    else m.scale.set(CELL, DECK_TOP + 0.16, CELL);

    m.position.set(pos.x, pos.y + m.scale.y / 2, pos.z);
    m.rotation.y = yaw;
    m.visible = true;
  }

  setBuildMode(on) {
    this.gridHelper.visible = on;
    if (!on) { this.hideGhost(); this.removeMarker.visible = false; }
  }

  // ---- per-frame ------------------------------------------------------

  animate(t, playerPos, dt = 1 / 60, cameraY = Infinity) {
    // Exponential, not a fixed step per frame: a fixed step makes the door open
    // twice as fast at 120fps as at 60, and crawl on a slow machine.
    const k = 1 - Math.exp(-dt * 9);

    // A roof you can't see under is a roof you can't play under — but only when
    // the camera is above it. Looking down from overhead, a solid roof hides the
    // whole room and the fade is the only way in. Standing inside at eye level,
    // the camera is under the roof already: fading it there means the ceiling of
    // your own hut turns to glass and you watch the sky through it.
    //
    // So the test is where the camera is, not where the player is. That covers
    // every view at once, including the shoulder camera when it slides out
    // through a doorway, without any of them naming themselves here.
    const above = cameraY > LAYERS.roof.y + 0.35;
    const want = playerPos && above && this.isSheltered(playerPos) ? 0.12 : 1;
    if (Math.abs(this.roofFade - want) > 0.002) {
      this.roofFade += (want - this.roofFade) * k;
      const solid = this.roofFade > 0.5;
      for (const mesh of this.meshes.values()) {
        if (!mesh.userData.fade) continue;
        for (const m of mesh.userData.fade) m.opacity = this.roofFade;
        // A faded roof that still casts leaves the room pitch dark and you
        // cannot see your own character. Once it's see-through, it stops
        // shading too.
        mesh.traverse((o) => { if (o.isMesh) o.castShadow = solid; });
      }
    }

    for (const mesh of this.meshes.values()) {
      const flame = mesh.userData.flame;
      if (flame) {
        flame.scale.setScalar(0.85 + Math.sin(t * 9 + mesh.position.x) * 0.15);
        flame.rotation.y = t * 2;
      }
      const leaf = mesh.userData.leaf;
      if (leaf && playerPos) this.swingDoor(mesh, leaf, playerPos, k);
    }
  }

  isSheltered(pos) {
    const [gx, gz] = worldToCell(pos.x, pos.z);
    return has(cellKey('roof', gx, gz));
  }

  /** Doors open away from whoever walks up to them. */
  swingDoor(mesh, leaf, playerPos, k) {
    const dx = playerPos.x - mesh.position.x;
    const dz = playerPos.z - mesh.position.z;
    const near = dx * dx + dz * dz < 2.6 * 2.6;
    // Which side of the wall the player is standing on decides which way it goes.
    const facing = Math.sin(mesh.rotation.y) * dx + Math.cos(mesh.rotation.y) * dz;
    const want = near ? (facing >= 0 ? -1 : 1) * 1.5 : 0;
    leaf.rotation.y += (want - leaf.rotation.y) * k;
  }
}
