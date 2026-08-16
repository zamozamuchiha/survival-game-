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
function plankGeometry(rng, length, width, thickness, opts = {}) {
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
  return geo;
}

/**
 * Swaps U and V.
 *
 * The timber texture runs its fibres along U, which is right for a board lying
 * flat but wrong once the same board is stood on end — the grain then bands
 * across the plank instead of running up it, which is the single thing that most
 * makes sawn wood look like printed paper.
 */
function swapUV(geo) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i);
    uv.setXY(i, uv.getY(i), u);
  }
  uv.needsUpdate = true;
  return geo;
}

/** Tints a geometry per board so a wall isn't one flat colour. */
function tint(geo, rng, base = 1) {
  const count = geo.attributes.position.count;
  const colors = new Float32Array(count * 3);
  // Boards come from different trees and weather differently.
  const k = base * rng.range(0.82, 1.14);
  const warm = rng.range(-0.05, 0.07);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = k * (1 + warm);
    colors[i * 3 + 1] = k;
    colors[i * 3 + 2] = k * (1 - warm * 0.8);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

/** A nail head: a small flattened cylinder, slightly proud of the wood. */
function nailGeometry(rng) {
  const r = rng.range(0.008, 0.012);
  const geo = new THREE.CylinderGeometry(r, r * 0.85, 0.006, 6);
  geo.rotateX(Math.PI / 2);
  return geo;
}

const sharedMats = new Map();

function timberMaterials() {
  if (sharedMats.has('timber')) return sharedMats.get('timber');
  const wood = surfaceMaterial('timber', {
    repeat: 1.6, roughness: 0.92, seed: 6, normalScale: 1.1,
  });
  wood.vertexColors = true;
  const metal = new THREE.MeshStandardMaterial({
    color: NAIL_COLOUR, roughness: 0.55, metalness: 0.8,
  });
  const set = { wood, metal };
  sharedMats.set('timber', set);
  return set;
}

function assemble(woodParts, nailParts) {
  const mats = timberMaterials();
  const group = new THREE.Group();

  const wood = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(woodParts, false), mats.wood);
  wood.castShadow = true;
  wood.receiveShadow = true;
  group.add(wood);

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
function deckInto(wood, nails, rng, spanX, spanZ, boardT, joistH) {
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
  while (z < spanZ / 2 - 0.02) {
    const w = Math.min(rng.range(0.13, 0.21), spanZ / 2 - z);
    if (w < 0.04) break;
    const centre = z + w / 2;
    const geo = plankGeometry(rng, spanX * rng.range(0.985, 1.0), w, boardT * rng.range(0.9, 1.1), { bow: 0.004 });
    geo.rotateY(rng.range(-0.006, 0.006));
    geo.translate(rng.range(-0.006, 0.006), y, centre);
    wood.push(tint(geo, rng));

    for (let i = 0; i < joistCount; i++) {
      const jz = -spanZ / 2 + (i + 0.5) * (spanZ / joistCount);
      if (Math.abs(jz - centre) > w) continue;
      const n = nailGeometry(rng);
      n.rotateX(-Math.PI / 2);
      n.translate(jz + rng.range(-0.02, 0.02), y + boardT * 0.5, centre + rng.range(-0.015, 0.015));
      nails.push(n);
    }
    z += w + rng.range(0.003, 0.008);       // the gap between deck boards
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
  const height = opts.height ?? 2.1;
  const thickness = opts.thickness ?? 0.05;

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
    wood.push(tint(swapUV(geo), rng));

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

  return assemble(wood, nails);
}

/**
 * A floor panel: boards laid on joists, with a rim so the construction is
 * visible from the side rather than looking like a decal on the ground.
 */
export function makePlankFloor(rng, opts = {}) {
  const size = opts.size ?? 2.0;
  const boardT = opts.boardThickness ?? 0.035;
  const joistH = opts.joistHeight ?? 0.085;

  const wood = [];
  const nails = [];
  deckInto(wood, nails, rng, size, size, boardT, joistH);
  return assemble(wood, nails);
}

/** A doorway: the same plank wall with an opening and a framed head. */
export function makePlankDoor(rng, opts = {}) {
  const width = opts.width ?? 2.0;
  const height = opts.height ?? 2.1;
  const thickness = opts.thickness ?? 0.05;
  const openW = width * 0.46;

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
      wood.push(tint(swapUV(geo), rng));

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

  return assemble(wood, nails);
}
