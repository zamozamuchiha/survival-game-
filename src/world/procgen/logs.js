import * as THREE from 'three';
import { surfaceMaterial } from '../textures.js';
import { timberMaterials } from './timber.js';

// Round timber: logs, firewood, branches and the stump a felled tree leaves.
//
// Every one of these is the same three surfaces in different proportions —
// furrowed bark round the outside, sawn ends showing growth rings, and where a
// billet has been split, a face of long grain. Keeping them as separate meshes
// with separate materials is the whole point: a log wrapped in one texture gives
// itself away the moment the player looks at the end of it.

const sharedMats = new Map();

function barkMaterial() {
  if (!sharedMats.has('bark')) {
    sharedMats.set('bark', surfaceMaterial('bark', {
      repeat: 1, roughness: 0.97, seed: 4, normalScale: 1.25, size: 512,
    }));
  }
  return sharedMats.get('bark');
}

/**
 * Bark relief as a fraction of the radius, the same shape of function the trunks
 * use — so a log looks like a piece of the tree it came off.
 */
function furrow(a, t, seed) {
  let v = Math.sin(a * 8 + seed * 1.7 + t * 1.2) * 0.52
        + Math.sin(a * 15 + seed * 3.1 - t * 0.8) * 0.3
        + Math.sin(a * 27 + seed * 5.3 + t * 2.4) * 0.18;
  v *= 0.82 + Math.sin(t * 26 + a * 2.3 + seed) * 0.18;
  return Math.min(1, Math.abs(v));
}

/**
 * The round side of a length of timber, lying along X.
 *
 * `arc` under a full turn leaves the billet open down one side, which is what a
 * split log is: bark round the back, a flat face where the axe went through.
 */
function barkTube(rng, { length, r0, r1, radial, relief, seed, arc = Math.PI * 2, shape = null, steps = 6 }) {
  const pos = [];
  const uv = [];
  const idx = [];
  const closed = arc >= Math.PI * 2 - 1e-6;
  const cols = closed ? radial : radial + 1;
  // Slight bend, so nothing in a woodpile is a perfect cylinder.
  const bend = rng.range(-0.05, 0.05) * length;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = -length / 2 + t * length;
    const sag = Math.sin(t * Math.PI) * bend;
    const baseR = r0 + (r1 - r0) * t;

    for (let j = 0; j < cols; j++) {
      const a = (j / radial) * arc - arc / 2;
      // `shape` swells the section where a caller wants it — that is how a
      // stump's foot grows its root buttresses out of the trunk itself rather
      // than having sticks glued to the outside of it.
      const swell = shape ? shape(a, t) : 1;
      const r = baseR * swell * (1 - furrow(a, t, seed) * relief);
      pos.push(x, Math.cos(a) * r + sag, Math.sin(a) * r);
      // Bark keeps a constant world scale whatever the log's size.
      uv.push(a * baseR * 1.5, x * 1.5);
    }
  }

  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < (closed ? radial : radial); j++) {
      const a = i * cols + j;
      const b = i * cols + ((j + 1) % cols);
      const c = (i + 1) * cols + j;
      const d = (i + 1) * cols + ((j + 1) % cols);
      idx.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/**
 * A sawn end: a disc of growth rings.
 *
 * UVs run across the disc rather than tiling, so the rings sit concentric on the
 * pith at the middle of the cut — one log end, one set of rings, whatever size
 * the log is.
 */
function endCap(radius, atX, dir, seed, relief, opts = {}) {
  const radial = opts.radial ?? 24;
  const rings = opts.rings ?? 4;
  // A drying check: the split that opens from the bark towards the heart as the
  // cut face dries out. Given as an angle to run along, or null for a fresh cut.
  const crack = opts.crack ?? null;
  const crackW = opts.crackWidth ?? 0.11;
  const crackD = opts.crackDepth ?? 0.05;

  const pos = [];
  const uv = [];
  const idx = [];

  // Centre, then a grid of rings out to the rim. The subdivision exists purely
  // so the check can be a notch in the surface rather than a dark line painted
  // on it — a crack you cannot see the depth of does not read as a crack.
  pos.push(atX, 0, 0);
  uv.push(0.5, 0.5);

  const rimAt = (a) => radius * (1 - furrow(a, dir > 0 ? 1 : 0, seed) * relief);

  for (let ring = 1; ring <= rings; ring++) {
    const tr = ring / rings;
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const r = rimAt(a) * tr;
      let sink = 0;
      if (crack !== null) {
        // Signed angular distance to the crack line, wrapped.
        let d = Math.abs(((a - crack + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        d = Math.min(d, crackW * 3);
        // Wide and deep at the bark, closing to nothing at the pith — that is
        // the direction a check actually opens.
        const along = Math.pow(tr, 0.7);
        sink = Math.max(0, 1 - d / crackW) * crackD * along;
      }
      pos.push(atX - dir * sink, Math.cos(a) * r, Math.sin(a) * r);
      uv.push((Math.sin(a) * r) / (radius * 2) + 0.5, (Math.cos(a) * r) / (radius * 2) + 0.5);
    }
  }

  const at = (ring, j) => (ring === 0 ? 0 : 1 + (ring - 1) * radial + (j % radial));
  for (let ring = 0; ring < rings; ring++) {
    for (let j = 0; j < radial; j++) {
      const a0 = at(ring, j);
      const a1 = at(ring, j + 1);
      const b0 = at(ring + 1, j);
      const b1 = at(ring + 1, j + 1);
      if (ring === 0) {
        if (dir > 0) idx.push(a0, b0, b1); else idx.push(a0, b1, b0);
      } else if (dir > 0) {
        idx.push(a0, b0, b1, a0, b1, a1);
      } else {
        idx.push(a0, b1, b0, a0, a1, b1);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Fills in the per-vertex colour the timber materials multiply by.
 *
 * Both of them are built with vertexColors on, because boards carry their
 * board-to-board variation that way. A geometry handed to them without a colour
 * attribute is multiplied by nothing and renders black — which is exactly how
 * these came out the first time.
 */
function paint(geo, rng, base = 1) {
  const n = geo.attributes.position.count;
  const c = new Float32Array(n * 3);
  const k = base * (rng ? rng.range(0.85, 1.15) : 1);
  const warm = rng ? rng.range(-0.05, 0.08) : 0;
  for (let i = 0; i < n; i++) {
    c[i * 3] = k * (1 + warm);
    c[i * 3 + 1] = k;
    c[i * 3 + 2] = k * (1 - warm * 0.8);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}

function meshOf(geo, material) {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** A round log, bark all round, cut square at both ends. */
export function makeLog(rng, opts = {}) {
  const length = opts.length ?? rng.range(0.75, 1.25);
  const r0 = opts.radius ?? rng.range(0.085, 0.14);
  const r1 = r0 * rng.range(0.86, 1.0);          // logs taper towards the top
  const seed = rng() * 6;
  const relief = 0.16;
  const g = new THREE.Group();

  g.add(meshOf(barkTube(rng, { length, r0, r1, radial: 14, relief, seed }), barkMaterial()));
  const end = timberMaterials().end;
  // Logs have been lying about long enough to open a check at one end.
  const crack = rng.chance(0.6) ? rng.range(0, Math.PI * 2) : null;
  g.add(meshOf(paint(endCap(r0, -length / 2, -1, seed, relief,
    { radial: 16, rings: 3, crack, crackDepth: r0 * 0.3 }), rng), end));
  g.add(meshOf(paint(endCap(r1, length / 2, 1, seed, relief,
    { radial: 16, rings: 3 }), rng), end));

  g.rotation.z = rng.range(-0.05, 0.05);
  return g;
}

/** A thin branch: bark, taper, and one small cut end where it came off. */
export function makeBranch(rng, opts = {}) {
  const length = opts.length ?? rng.range(0.5, 0.9);
  const r0 = opts.radius ?? rng.range(0.022, 0.04);
  const seed = rng() * 6;
  const g = new THREE.Group();

  g.add(meshOf(
    barkTube(rng, { length, r0, r1: r0 * 0.45, radial: 8, relief: 0.1, seed }),
    barkMaterial()));
  g.add(meshOf(paint(endCap(r0, -length / 2, -1, seed, 0.1,
    { radial: 10, rings: 2 }), rng), timberMaterials().end));
  return g;
}

/**
 * A split billet: bark round the back, one flat riven face, rings at both ends.
 *
 * The split face shows long grain, not rings — an axe follows the fibres, it
 * does not cut across them. That is why it takes the board material rather than
 * the end-grain one.
 */
export function makeBillet(rng, opts = {}) {
  const length = opts.length ?? rng.range(0.3, 0.46);
  const r = opts.radius ?? rng.range(0.06, 0.095);
  const seed = rng() * 6;
  const relief = 0.14;
  const arc = Math.PI * rng.range(1.05, 1.35);
  const g = new THREE.Group();

  g.add(meshOf(barkTube(rng, { length, r0: r, r1: r * 0.97, radial: 10, relief, seed, arc }),
    barkMaterial()));

  // The riven face, closing the open side of the arc.
  const half = arc / 2;
  const y0 = Math.cos(half) * r;
  const z0 = Math.sin(half) * r;
  const face = new THREE.PlaneGeometry(length, Math.hypot(z0 * 2, 0));
  face.rotateY(Math.PI / 2);
  face.translate(0, y0 * 0.98, 0);
  const uvs = face.attributes.uv;
  for (let i = 0; i < uvs.count; i++) {
    // Grain runs down the billet, at the same world scale as sawn boards.
    uvs.setXY(i, uvs.getX(i) * length * 0.55, uvs.getY(i) * r * 1.4);
  }
  g.add(meshOf(paint(face, rng, 1.05), timberMaterials().wood));

  const end = timberMaterials().end;
  g.add(meshOf(paint(endCap(r, -length / 2, -1, seed, relief,
    { radial: 12, rings: 2 }), rng), end));
  g.add(meshOf(paint(endCap(r * 0.97, length / 2, 1, seed, relief,
    { radial: 12, rings: 2 }), rng), end));
  return g;
}

/** A few billets and offcuts, the pile you actually pick up off the ground. */
export function makeFirewood(rng) {
  const g = new THREE.Group();
  const n = rng.int(2, 3);
  for (let i = 0; i < n; i++) {
    const piece = rng.chance(0.6) ? makeBillet(rng) : makeLog(rng, {
      length: rng.range(0.34, 0.5), radius: rng.range(0.05, 0.075),
    });
    piece.position.set(rng.range(-0.07, 0.07), 0.06 + i * 0.075, rng.range(-0.07, 0.07));
    piece.rotation.y = rng.range(0, Math.PI * 2);
    piece.rotation.z += rng.range(-0.18, 0.18);
    g.add(piece);
  }
  return g;
}

/**
 * What a felled tree leaves behind: a flared stub with the saw cut on top.
 *
 * The cut face is the whole point of a stump — it is the one place in the world
 * where the player is looking straight down at the inside of a tree.
 */
export function makeStump(rng, opts = {}) {
  const height = opts.height ?? rng.range(0.3, 0.46);
  const r = opts.radius ?? rng.range(0.2, 0.3);
  const seed = rng() * 6;
  const relief = 0.2;
  const g = new THREE.Group();

  // Root buttresses, as part of the trunk rather than sticks leant against it.
  //
  // A tree's foot is not a cylinder that stops: it swells into three or four
  // ribs that carry the load out into the ground. Modelling them as a swell in
  // the trunk's own cross-section means bark runs unbroken from the stump out
  // over the root, which is the join that gives a bolted-on root away.
  const lobes = rng.int(3, 4);
  const phase = rng.range(0, Math.PI * 2);
  const lobeSize = rng.range(0.34, 0.5);
  // One deep drying check, running from the cut face down into the bark. A
  // stump that has stood a summer always has one, and it is the single detail
  // that separates a stump from a length of dowel.
  const crackAngle = rng.range(0, Math.PI * 2);
  const buttress = (a, t) => {
    // t runs 0 at the foot to 1 at the cut, so the swell dies away upwards —
    // gently, over most of the stump's height, the way a flare actually does.
    const foot = Math.pow(1 - t, 1.7);
    // The flare runs the whole way round and the ribs sit on top of it. Letting
    // it fall back to the bare radius between them leaves the stump standing on
    // legs with daylight between, rather than on a foot.
    const rib = Math.max(0, Math.cos((a - phase) * lobes));

    // The check carries on down the side as a groove, deepest at the cut and
    // closing as it runs down — so the split on top has somewhere to go rather
    // than stopping dead at the rim.
    let d = Math.abs(((a - crackAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    const split = Math.max(0, 1 - d / 0.16) * 0.1 * Math.pow(t, 1.4);

    // Tuck the last of the flare back under itself. The tube is open at the
    // bottom, and with back faces culled an open rim means you see through the
    // stump wherever the ground dips away from it; closing the foot fixes that
    // at the geometry rather than relying on how deep it happens to be buried.
    const tuck = t < 0.1 ? 0.3 + 0.7 * (t / 0.1) : 1;

    return tuck * (1 + foot * lobeSize * (0.5 + 0.5 * Math.pow(rib, 0.55)) - split);
  };

  // Built lying along X by the tube helper, then stood up. Plenty of rings up
  // its length, or the flare has nowhere to develop and appears as a collar.
  const side = barkTube(rng, {
    length: height, r0: r * 1.05, r1: r, radial: 30, steps: 12,
    relief, seed, shape: buttress,
  });
  side.rotateZ(Math.PI / 2);
  side.translate(0, height / 2, 0);
  g.add(meshOf(side, barkMaterial()));

  const top = endCap(r, height / 2, 1, seed, relief, {
    radial: 30, rings: 5, crack: crackAngle, crackWidth: 0.14, crackDepth: r * 0.24,
  });
  top.rotateZ(Math.PI / 2);
  top.translate(0, height / 2, 0);
  g.add(meshOf(paint(top, rng), timberMaterials().end));

  // The foot is tucked in by the shape function above, so all that is left to
  // close is the small ring it converges to.
  const floor = endCap(r * 0.34, -height / 2, -1, seed, relief, { radial: 12, rings: 1 });
  floor.rotateZ(Math.PI / 2);
  floor.translate(0, height / 2, 0);
  g.add(meshOf(floor, barkMaterial()));

  // No separate roots laid round the foot. Tried it, and tapered tubes tipped
  // almost flat read as blades stuck on rather than as roots — and they tripled
  // the stump's footprint, which matters because the game scales the model by
  // its height and would have left a metre-wide stump behind every sapling. The
  // buttresses above already carry the trunk into the ground, and they do it
  // with the bark running unbroken over them.
  return g;
}
