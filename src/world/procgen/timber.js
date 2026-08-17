import * as THREE from 'three';
import * as BufferGeometryUtils from '../../../vendor/utils/BufferGeometryUtils.js';
import { surfaceMaterial } from '../textures.js';

// Built timber: walls and floors assembled from individual boards.
//
// Every plank is its own box with its own width, length, thickness, tilt and
// colour, warped slightly along its length so no two edges line up perfectly.
// Boards are held together by visible cross-braces and nail heads, and a floor
// sits on joists that stand proud of the ground at the edges — so from a low
// angle you see earth, then the frame, then the boards, rather than a texture
// lying on the dirt.

const NAIL_COLOUR = 0x4a4640;

/**
 * One board.
 *
 * The vertex warp is what separates sawn timber from a primitive: each corner
 * moves a couple of millimetres, so edges are very slightly out of true and
 * catch the light unevenly along their length.
 */
export function plankGeometry(rng, length, width, thickness, opts = {}) {
  const segments = opts.segments ?? 3;
  const geo = new THREE.BoxGeometry(length, thickness, width, segments, 1, 1);

  const pos = geo.attributes.position;
  const warp = opts.warp ?? 0.0035;
  const bow = rng.range(-1, 1) * (opts.bow ?? 0.006);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const t = (v.x / length) + 0.5;
    // Cupping along the board plus a little independent jitter per vertex.
    v.y += Math.sin(t * Math.PI) * bow;
    v.y += (rng() - 0.5) * warp;
    v.z += (rng() - 0.5) * warp;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  // Every board is modelled around its own origin, so without a random offset
  // they would all show the identical patch of grain and a wall would come out
  // looking woven. The offset is what makes each board a different board.
  //
  // The grain also runs at a slightly different scale on each board, because two
  // planks off different logs never have the same ring spacing.
  const tile = (opts.tile ?? GRAIN_TILE) * rng.range(0.82, 1.24);
  worldUV(geo, tile, rng() * 9, rng() * 9, width);
  return markEndGrain(geo);
}

/**
 * Flags the two sawn ends of a board.
 *
 * A board is laid out with its length on X, so the ±X faces are the cut ends —
 * the only faces that should show growth rings rather than long fibres. Marked
 * per vertex here, while the board is still axis-aligned, because callers rotate
 * it immediately afterwards and the information would be lost.
 */
function markEndGrain(geo) {
  const nor = geo.attributes.normal;
  const flag = new Float32Array(nor.count);
  for (let i = 0; i < nor.count; i++) {
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    const nz = Math.abs(nor.getZ(i));
    flag[i] = nx >= ny && nx >= nz ? 1 : 0;
  }
  geo.setAttribute('endGrain', new THREE.BufferAttribute(flag, 1));
  return geo;
}

/**
 * Splits a geometry into its face-grain and end-grain halves.
 *
 * They need different textures, and a shader that blends two full PBR sets per
 * pixel costs more than simply drawing the ends as their own small mesh.
 */
function splitEndGrain(geo) {
  if (!geo.getAttribute('endGrain')) return { face: geo, end: null };
  const g = geo.index ? geo.toNonIndexed() : geo;
  const flag = g.getAttribute('endGrain');
  const names = Object.keys(g.attributes).filter((n) => n !== 'endGrain');
  const tris = flag.count / 3;

  const build = (want) => {
    const picked = [];
    for (let t = 0; t < tris; t++) {
      if ((flag.getX(t * 3) > 0.5 ? 1 : 0) === want) picked.push(t);
    }
    if (!picked.length) return null;
    const out = new THREE.BufferGeometry();
    for (const name of names) {
      const src = g.attributes[name];
      const n = src.itemSize;
      const arr = new Float32Array(picked.length * 3 * n);
      let o = 0;
      for (const t of picked) {
        for (let k = 0; k < 3; k++) {
          for (let c = 0; c < n; c++) arr[o++] = src.array[(t * 3 + k) * n + c];
        }
      }
      out.setAttribute(name, new THREE.BufferAttribute(arr, n));
    }
    return out;
  };

  return { face: build(0), end: build(1) };
}

/** Metres of timber per texture repeat — about one knot per board. */
const GRAIN_TILE = 1.9;

/**
 * Replaces a box's UVs with ones measured in metres.
 *
 * A BoxGeometry gives every face the same 0..1 square whatever its real size, so
 * one repeat of the grain covers 2.4m up a wall board and 0.2m across it — a
 * twelvefold stretch that turns sawn timber into dark vertical streaking. Laying
 * the UVs out in world units instead means the grain is the same size on every
 * board in the game, however long or wide it is.
 *
 * U always follows the board's own length, so once a plank is stood on end the
 * fibres run up it rather than banding across it.
 */
export function worldUV(geo, tile = GRAIN_TILE, offU = 0, offV = 0, width = 0) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const uv = geo.attributes.uv;
  if (!uv) return geo;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    const nz = Math.abs(nor.getZ(i));

    // Project onto whichever plane the face is closest to lying in.
    let u, v;
    if (nx >= ny && nx >= nz) {
      // A sawn end. Its texture is a set of growth rings centred on the pith, so
      // it is mapped across the board's own cross-section rather than tiled in
      // world units — one board end, one set of rings. Both axes are divided by
      // the width so the rings stay round: dividing v by the thickness instead
      // would smear them into stripes on anything thinner than it is wide.
      const w = width > 1e-6 ? width : tile;
      u = z / w + 0.5;
      v = y / w + 0.5;
      uv.setXY(i, u, v);
      continue;
    }
    if (ny >= nz) { u = x; v = z; }                    // face up or down
    else { u = x; v = y; }                             // face front or back
    uv.setXY(i, u / tile + offU, v / tile + offV);
  }
  uv.needsUpdate = true;
  return geo;
}

/** Tints a geometry per board so a wall isn't one flat colour. */
export function tint(geo, rng, base = 1) {
  const count = geo.attributes.position.count;
  const colors = new Float32Array(count * 3);
  // Boards come from different trees and weather differently. A wide spread on
  // purpose: a stack of planks cut on the same day still ranges from straw to
  // dark honey, and matching them all is what makes timber look manufactured.
  const k = base * rng.range(0.72, 1.22);
  const warm = rng.range(-0.09, 0.11);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = k * (1 + warm);
    colors[i * 3 + 1] = k;
    colors[i * 3 + 2] = k * (1 - warm * 0.8);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

/** A nail head: a small flattened cylinder, slightly proud of the wood. */
export function nailGeometry(rng) {
  const r = rng.range(0.008, 0.012);
  const geo = new THREE.CylinderGeometry(r, r * 0.85, 0.006, 6);
  geo.rotateX(Math.PI / 2);
  return geo;
}

const sharedMats = new Map();

export function timberMaterials() {
  if (sharedMats.has('timber')) return sharedMats.get('timber');
  // repeat 1: plankGeometry lays its UVs out in metres, so the tiling is
  // already set by the geometry rather than by the material.
  //
  // A big map, because the whole point is that it survives being walked up to:
  // at 1024 across roughly two metres of board a growth ring is several pixels
  // wide instead of one, which is the difference between grain and noise.
  const wood = surfaceMaterial('timber', {
    repeat: 1, roughness: 1, seed: 6, normalScale: 0.75, size: 1024,
  });
  wood.vertexColors = true;

  // The sawn ends: rings, rays and drying checks, mapped per board end.
  const end = surfaceMaterial('timberEnd', {
    repeat: 1, roughness: 1, seed: 6, normalScale: 1.0, size: 512,
  });
  end.vertexColors = true;

  const metal = new THREE.MeshStandardMaterial({
    color: NAIL_COLOUR, roughness: 0.55, metalness: 0.8,
  });
  const set = { wood, end, metal };
  sharedMats.set('timber', set);
  return set;
}

export function assemble(woodParts, nailParts, extra = []) {
  const mats = timberMaterials();
  const group = new THREE.Group();

  if (woodParts.length) {
    // Faces and ends are drawn separately so each can carry the texture that
    // belongs to it: long fibres down the board, growth rings across the cut.
    const faces = [];
    const ends = [];
    for (const part of woodParts) {
      const split = splitEndGrain(part);
      if (split.face) faces.push(split.face);
      if (split.end) ends.push(split.end);
    }

    for (const [parts, material] of [[faces, mats.wood], [ends, mats.end]]) {
      if (!parts.length) continue;
      const mesh = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(parts, false), material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  for (const o of extra) group.add(o);

  if (nailParts.length) {
    const nails = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(nailParts, false), mats.metal);
    nails.castShadow = false;      // too small to cast anything readable
    nails.receiveShadow = true;
    group.add(nails);
  }
  return group;
}

/**
 * Deck boards over a rectangle, on joists, with a rim.
 *
 * Shared by the floor piece and by walls: a wall occupies a whole grid cell but
 * only stands in the middle of it, so without decking its cell the floor inside
 * a hut stops most of a metre short of the wall and the two read as separate
 * objects sitting near each other.
 */
function deckInto(wood, nails, rng, spanX, spanZ, boardT, joistH, tight = false) {
  const joistCount = Math.max(2, Math.round(spanZ / 0.7));
  for (let i = 0; i < joistCount; i++) {
    const z = -spanZ / 2 + (i + 0.5) * (spanZ / joistCount);
    const geo = plankGeometry(rng, spanX * 0.99, 0.10, joistH, { bow: 0.003 });
    geo.translate(0, joistH / 2, z);
    wood.push(tint(geo, rng, 0.78));        // in shadow under the deck
  }

  // Rim boards, so no edge shows a hollow underside.
  for (const [rot, dx, dz, len] of [
    [0, 0, -spanZ / 2, spanX], [0, 0, spanZ / 2, spanX],
    [Math.PI / 2, -spanX / 2, 0, spanZ], [Math.PI / 2, spanX / 2, 0, spanZ]]) {
    const geo = plankGeometry(rng, len, 0.09, joistH * 0.9, { bow: 0.002 });
    geo.rotateY(rot);
    geo.translate(dx, joistH * 0.45, dz);
    wood.push(tint(geo, rng, 0.84));
  }

  // Boards across the joists.
  let z = -spanZ / 2;
  const y = joistH + boardT / 2;
  // Floor tiles butt up against their neighbours, so in tight mode the boards run
  // the full span and the seams close: anything less and every cell boundary
  // shows a centimetre of daylight straight through the deck.
  const seam = tight ? 0.0015 : 0.0055;
  while (z < spanZ / 2 - 0.02) {
    const w = Math.min(rng.range(0.13, 0.21), spanZ / 2 - z);
    if (w < (tight ? 0.02 : 0.04)) break;
    const centre = z + w / 2;
    const len = tight ? spanX : spanX * rng.range(0.985, 1.0);
    const jitter = tight ? 0 : 0.006;
    const geo = plankGeometry(rng, len, w, boardT * rng.range(0.9, 1.1), { bow: 0.004 });
    geo.rotateY(rng.range(-jitter, jitter));
    geo.translate(rng.range(-jitter, jitter), y, centre);
    wood.push(tint(geo, rng));

    for (let i = 0; i < joistCount; i++) {
      const jz = -spanZ / 2 + (i + 0.5) * (spanZ / joistCount);
      if (Math.abs(jz - centre) > w) continue;
      const n = nailGeometry(rng);
      n.rotateX(-Math.PI / 2);
      n.translate(jz + rng.range(-0.02, 0.02), y + boardT * 0.5, centre + rng.range(-0.015, 0.015));
      nails.push(n);
    }
    z += w + seam;                          // the gap between deck boards
  }
  return joistH + boardT;
}

/**
 * A wall of upright boards on two cross-braces, nailed at every crossing.
 *
 * Boards vary in width and height and lean a fraction of a degree, so the top
 * edge is a ragged line rather than a ruled one — the single clearest tell
 * between built timber and a textured box.
 */
export function makePlankWall(rng, opts = {}) {
  const width = opts.width ?? 2.0;
  const height = opts.height ?? 2.4;
  const thickness = opts.thickness ?? 0.06;

  const wood = [];
  const nails = [];

  // Deck the wall's own cell first, so the hut's floor runs unbroken from the
  // inside right up to and under the wall.
  const deck = opts.deck ?? 0;
  const sill = deck > 0 ? deckInto(wood, nails, rng, width, deck, 0.035, 0.085) : 0;

  const braceY = [sill + height * 0.24, sill + height * 0.78];
  const braceZ = -thickness * 0.9;

  // Fill the width with boards of varying width until it's covered. Boards are
  // laid slightly overlapping rather than gapped: butted timber closes up as it
  // swells, and a wall you can see daylight through reads as a fence.
  let x = -width / 2;
  const boards = [];
  while (x < width / 2 - 0.02) {
    const w = Math.min(rng.range(0.16, 0.27), width / 2 - x);
    if (w < 0.05) break;
    boards.push({ x: x + w / 2, w });
    x += w - rng.range(0.001, 0.005);
  }

  for (const b of boards) {
    const h = height * rng.range(0.955, 1.0);
    const geo = plankGeometry(rng, h, b.w, thickness * rng.range(0.85, 1.1), { bow: 0.008 });
    // Upright, then turned so the board's width runs across the wall rather than
    // through it — plankGeometry lays a board out along X with its width on Z.
    geo.rotateZ(Math.PI / 2);
    geo.rotateY(Math.PI / 2 + rng.range(-0.012, 0.012));   // a fraction off plumb
    // Set into the decking rather than resting on top of it, the way a stud sits
    // into a sole plate.
    geo.translate(b.x, Math.max(0, sill - 0.02) + h / 2, rng.range(-0.006, 0.006));
    wood.push(tint(geo, rng));

    // Two nails per crossing, offset from centre like a real fixing.
    for (const y of braceY) {
      for (const off of [-b.w * 0.24, b.w * 0.24]) {
        const n = nailGeometry(rng);
        n.translate(b.x + off, y + rng.range(-0.012, 0.012), thickness * 0.52);
        nails.push(n);
      }
    }
  }

  // Cross-braces on the back, laid flat against the boards.
  for (const y of braceY) {
    const geo = plankGeometry(rng, width * 0.98, 0.12, 0.045, { bow: 0.004 });
    geo.rotateX(Math.PI / 2);               // width becomes the brace's depth
    geo.translate(0, y, braceZ);
    wood.push(tint(geo, rng, 0.92));
  }

  // A diagonal, because a plank wall without one racks — and because it reads
  // instantly as something someone built.
  if (opts.brace !== false) {
    const len = Math.hypot(width * 0.9, height * 0.5);
    const geo = plankGeometry(rng, len, 0.10, 0.04);
    geo.rotateX(Math.PI / 2);
    geo.rotateZ(Math.atan2(height * 0.5, width * 0.9) * (rng.chance(0.5) ? 1 : -1));
    geo.translate(0, sill + height * 0.5, braceZ - 0.03);
    wood.push(tint(geo, rng, 0.88));
  }

  if (opts.posts !== false) pushEndPosts(wood, nails, rng, width, height, thickness, sill);

  return assemble(wood, nails);
}

/**
 * Squared corner posts at both ends of a wall.
 *
 * Walls stand on the boundary between two cells, so at a corner two of them meet
 * end-on and their boards would otherwise interpenetrate in a mess of edges. A
 * post is what a real frame puts there, and it swallows the joint: whichever wall
 * you look at, the corner reads as one upright timber.
 */
function pushEndPosts(wood, nails, rng, width, height, thickness, sill) {
  const side = 0.115;
  for (const dir of [-1, 1]) {
    const h = height * rng.range(1.0, 1.03);          // posts run a touch proud
    const geo = plankGeometry(rng, h, side, side, { bow: 0.004 });
    geo.rotateZ(Math.PI / 2);
    geo.rotateY(rng.range(-0.008, 0.008));
    geo.translate(dir * (width / 2 - side * 0.42), Math.max(0, sill - 0.02) + h / 2, 0);
    wood.push(tint(geo, rng, 0.94));

    for (const y of [sill + height * 0.2, sill + height * 0.55, sill + height * 0.86]) {
      const n = nailGeometry(rng);
      n.translate(dir * (width / 2 - side * 0.42), y, side * 0.52);
      nails.push(n);
    }
  }
}

/**
 * A floor panel: boards laid on joists, with a rim so the construction is
 * visible from the side rather than looking like a decal on the ground.
 */
export function makePlankFloor(rng, opts = {}) {
  const size = opts.size ?? 2.0;
  const boardT = opts.boardThickness ?? 0.05;
  const joistH = opts.joistHeight ?? 0.13;

  const wood = [];
  const nails = [];
  deckInto(wood, nails, rng, size, size, boardT, joistH, opts.tight ?? true);
  return assemble(wood, nails);
}

/** Raised bearer frame with rough stone pads. It makes a floor read as a real
 * construction rather than boards floating directly over grass. */
export function makeTimberFoundation(rng, opts = {}) {
  const size = opts.size ?? 2;
  const wood = [];
  const nails = [];
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x6a655d, roughness: 0.96, flatShading: true });
  const pads = new THREE.Group();
  for (const x of [-size * 0.38, size * 0.38]) for (const z of [-size * 0.38, size * 0.38]) {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(rng.range(0.17, 0.22), 1), stoneMat);
    rock.scale.y = rng.range(0.45, 0.65);
    rock.position.set(x, 0.07, z);
    pads.add(rock);
  }
  for (const z of [-size * 0.32, size * 0.32]) {
    const beam = plankGeometry(rng, size * 0.92, 0.15, 0.16, { bow: 0.004 });
    beam.translate(0, 0.20, z);
    wood.push(tint(beam, rng, 0.78));
  }
  for (const x of [-size * 0.42, size * 0.42]) {
    const beam = plankGeometry(rng, size * 0.86, 0.12, 0.13, { bow: 0.003 });
    beam.rotateY(Math.PI / 2);
    beam.translate(x, 0.26, 0);
    wood.push(tint(beam, rng, 0.82));
  }
  return assemble(wood, nails, [pads]);
}

/** A compact pitched roof tile. Each tile is a framed, boarded roof section so
 * neighbouring cells expand into one continuous roof rather than a prefab hut. */
export function makeTimberRoof(rng, opts = {}) {
  const size = opts.size ?? 2;
  const rise = opts.rise ?? 0.68;
  const wood = [];
  const nails = [];
  for (const side of [-1, 1]) {
    const angle = Math.atan2(rise, size / 2);
    const slope = Math.hypot(size / 2, rise);
    for (let i = 0; i < 7; i++) {
      const z = -size / 2 + (i + 0.5) * (size / 7);
      const board = plankGeometry(rng, slope * 1.08, 0.12, 0.035, { bow: 0.003 });
      board.rotateZ(side * angle);
      board.translate(side * size * 0.25, 0.15 + rise * 0.5, z);
      wood.push(tint(board, rng, 0.88));
    }
    for (const z of [-size * 0.36, size * 0.36]) {
      const rafter = plankGeometry(rng, slope * 1.05, 0.10, 0.08, { bow: 0.002 });
      rafter.rotateZ(side * angle);
      rafter.translate(side * size * 0.25, 0.11 + rise * 0.5, z);
      wood.push(tint(rafter, rng, 0.75));
    }
  }
  const ridge = plankGeometry(rng, size * 1.04, 0.14, 0.07, { bow: 0.002 });
  ridge.rotateY(Math.PI / 2);
  ridge.translate(0, rise + 0.18, 0);
  wood.push(tint(ridge, rng, 0.82));
  return assemble(wood, nails);
}

/** A doorway: the same plank wall with an opening and a framed head. */
export function makePlankDoor(rng, opts = {}) {
  const width = opts.width ?? 2.0;
  const height = opts.height ?? 2.4;
  const thickness = opts.thickness ?? 0.06;
  const openW = opts.openWidth ?? 1.0;

  const wood = [];
  const nails = [];

  // The threshold is decked too, so the floor carries through the doorway.
  const deck = opts.deck ?? 0;
  const sill = deck > 0 ? deckInto(wood, nails, rng, width, deck, 0.035, 0.085) : 0;

  // Jambs either side of the opening, boarded like the wall.
  for (const dir of [-1, 1]) {
    let x = dir * (openW / 2);
    const edge = dir * (width / 2);
    while (Math.abs(edge - x) > 0.06) {
      const w = Math.min(rng.range(0.15, 0.25), Math.abs(edge - x));
      const cx = x + dir * (w / 2);
      const h = height * rng.range(0.955, 1.0);
      const geo = plankGeometry(rng, h, w, thickness * rng.range(0.85, 1.1), { bow: 0.008 });
      geo.rotateZ(Math.PI / 2);
      geo.rotateY(rng.range(-0.012, 0.012));
      geo.translate(cx, Math.max(0, sill - 0.02) + h / 2, rng.range(-0.006, 0.006));
      wood.push(tint(geo, rng));

      const n = nailGeometry(rng);
      n.translate(cx, sill + height * 0.72, thickness * 0.52);
      nails.push(n);
      x += dir * (w - rng.range(0.001, 0.005));
    }
  }

  // Head over the opening plus a lintel across the whole width.
  const head = plankGeometry(rng, width * 0.98, 0.16, 0.05, { bow: 0.003 });
  head.rotateX(Math.PI / 2);
  head.translate(0, sill + height * 0.88, 0);
  wood.push(tint(head, rng, 0.9));

  const lintel = plankGeometry(rng, openW * 1.25, 0.12, 0.06, { bow: 0.002 });
  lintel.rotateX(Math.PI / 2);
  lintel.translate(0, sill + height * 0.74, -thickness * 0.7);
  wood.push(tint(lintel, rng, 0.86));

  for (const dir of [-1, 1]) {
    const n = nailGeometry(rng);
    n.translate(dir * openW * 0.5, sill + height * 0.74, thickness * 0.5);
    nails.push(n);
  }

  pushEndPosts(wood, nails, rng, width, height, thickness, sill);

  // The leaf hangs in its own group so the base can swing it open. Its geometry
  // runs from the hinge outwards, which puts the pivot on the group's origin —
  // rotate the group and the door turns on its hinges instead of about its middle.
  const leaf = makeDoorLeaf(rng, openW - 0.03, Math.min(height * 0.86, sill + height * 0.86) - sill);
  leaf.position.set(-openW / 2 + 0.015, sill, 0);

  // Named, not stashed in userData: getModel hands out clones, and cloning
  // round-trips userData through JSON — an object reference in there comes back
  // as a lifeless copy of its own fields.
  leaf.name = 'door_leaf';
  return assemble(wood, nails, [leaf]);
}

/**
 * A ledged and braced door: vertical boards held by three ledges and a diagonal,
 * hung on two iron straps.
 *
 * Built from x = 0 (the hinge stile) outwards so the group's origin is the pivot.
 */
function makeDoorLeaf(rng, leafW, leafH) {
  const wood = [];
  const nails = [];
  const t = 0.045;

  const ledgeY = [leafH * 0.14, leafH * 0.52, leafH * 0.88];

  let x = 0;
  while (x < leafW - 0.02) {
    const w = Math.min(rng.range(0.14, 0.2), leafW - x);
    if (w < 0.05) break;
    const geo = plankGeometry(rng, leafH, w, t * rng.range(0.9, 1.1), { bow: 0.005 });
    geo.rotateZ(Math.PI / 2);
    geo.rotateY(Math.PI / 2);
    geo.translate(x + w / 2, leafH / 2, 0);
    wood.push(tint(geo, rng, 1.04));       // a newer board than the wall

    for (const y of ledgeY) {
      const n = nailGeometry(rng);
      n.translate(x + w / 2, y + rng.range(-0.01, 0.01), t * 0.6);
      nails.push(n);
    }
    x += w - rng.range(0.001, 0.004);
  }

  for (const y of ledgeY) {
    const geo = plankGeometry(rng, leafW * 0.96, 0.11, 0.035, { bow: 0.003 });
    geo.rotateX(Math.PI / 2);
    geo.translate(leafW / 2, y, -t * 0.8);
    wood.push(tint(geo, rng, 0.9));
  }

  const rise = ledgeY[2] - ledgeY[0];
  const diag = plankGeometry(rng, Math.hypot(leafW * 0.92, rise), 0.09, 0.03);
  diag.rotateX(Math.PI / 2);
  diag.rotateZ(Math.atan2(rise, leafW * 0.92));
  diag.translate(leafW / 2, (ledgeY[0] + ledgeY[2]) / 2, -t * 0.8);
  wood.push(tint(diag, rng, 0.86));

  const iron = [];
  for (const y of [ledgeY[0], ledgeY[2]]) {
    const strap = new THREE.BoxGeometry(leafW * 0.55, 0.055, 0.012);
    strap.translate(leafW * 0.3, y, t * 0.72);
    iron.push(strap);
    const pin = new THREE.CylinderGeometry(0.022, 0.022, 0.09, 6);
    pin.translate(0.01, y, t * 0.4);
    iron.push(pin);
  }
  const handle = new THREE.TorusGeometry(0.055, 0.011, 5, 10);
  handle.rotateX(Math.PI / 2);
  handle.translate(leafW * 0.86, leafH * 0.46, t * 0.7);
  iron.push(handle);

  const mats = timberMaterials();
  const ironMesh = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(iron, false), mats.metal);
  ironMesh.castShadow = true;

  return assemble(wood, nails, [ironMesh]);
}
