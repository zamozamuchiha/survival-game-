import * as THREE from 'three';
import * as BufferGeometryUtils from '../../../vendor/utils/BufferGeometryUtils.js';
import { surfaceMaterial } from '../textures.js';
import { plankGeometry, worldUV, tint, nailGeometry, timberMaterials, assemble } from './timber.js';
import { CELL, WALL_H, FOUND_TOP } from '../../data/building.js';

// The rest of the buildable kit: the pieces that aren't just boards.
//
// Everything here is modelled at true size around its socket's origin — a tile
// piece fills a CELL square centred on the cell, an edge piece runs CELL along X
// with its face on Z, and a prop stands on the ground at its own centre. The
// base places them without rescaling, so a board is a board at every socket.

const stoneMats = new Map();

function stoneMaterial(kind = 'stone') {
  if (stoneMats.has(kind)) return stoneMats.get(kind);
  const mat = surfaceMaterial(kind, { repeat: 2.2, roughness: 0.95, seed: 11, normalScale: 1.2 });
  mat.vertexColors = true;
  stoneMats.set(kind, mat);
  return mat;
}

/** Per-block shade, so a wall of stone isn't one flat grey. */
function paint(geo, rng, base = 1) {
  const count = geo.attributes.position.count;
  const colors = new Float32Array(count * 3);
  const k = base * rng.range(0.78, 1.18);
  const warm = rng.range(-0.04, 0.06);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = k * (1 + warm);
    colors[i * 3 + 1] = k;
    colors[i * 3 + 2] = k * (1 - warm);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

/**
 * One rough block.
 *
 * A box with every vertex knocked off its corner — quarried stone is flat-faced
 * but never square, and the uneven corners are what stop a course of them
 * reading as a row of crates.
 */
function blockGeometry(rng, w, h, d, rough = 0.03) {
  const geo = new THREE.BoxGeometry(w, h, d, 2, 1, 2);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    v.x += rng.range(-rough, rough);
    v.y += rng.range(-rough, rough) * 0.7;
    v.z += rng.range(-rough, rough);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  // Same story as timber: without a per-block offset every stone in a course
  // shows the identical face and the wall reads as a printed pattern.
  return worldUV(geo, 1.1, rng() * 9, rng() * 9);
}

function stoneMesh(parts, kind = 'stone') {
  const mesh = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(parts, false), stoneMaterial(kind));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Lays a course of blocks along a line, filling it exactly.
 *
 * Block widths vary but the course always ends flush, and each course starts at
 * a different offset, so vertical joints stagger the way laid stone does.
 */
function course(rng, length, minW, maxW, make) {
  let x = -length / 2;
  const first = rng.range(minW * 0.45, minW);   // stagger the joints course to course
  let w = Math.min(first, length);
  while (x < length / 2 - 0.01) {
    w = Math.min(w, length / 2 - x);
    if (w < 0.03) break;
    make(x + w / 2, w);
    x += w;
    w = rng.range(minW, maxW);
  }
}

// ---------------------------------------------------------------- foundation

/**
 * A stone plinth: three courses of blocks around the rim, a buried core, and a
 * flagged top.
 *
 * Built a little wider than the cell so it shows as a ledge under the floor it
 * carries — earth, then footing, then frame, then boards, which is the join that
 * makes a building look founded rather than dropped on the grass.
 */
export function makeFoundation(rng) {
  const parts = [];
  const span = CELL + 0.07;
  const half = span / 2;
  const bottom = -0.36;
  const capT = 0.14;
  const capTop = FOUND_TOP;
  const wallTop = capTop - capT;

  // Rim courses. Only the top one shows above the grass, but the buried ones
  // mean a foundation on a slope or beside a dug-out floor still reads as stone.
  const courses = 3;
  for (let c = 0; c < courses; c++) {
    const y0 = bottom + (wallTop - bottom) * (c / courses);
    const y1 = bottom + (wallTop - bottom) * ((c + 1) / courses);
    const h = y1 - y0;
    for (const axis of [0, 1]) {
      for (const dir of [-1, 1]) {
        course(rng, span, 0.26, 0.46, (t, w) => {
          const geo = axis === 0
            ? blockGeometry(rng, w, h * rng.range(0.94, 1.02), 0.3)
            : blockGeometry(rng, 0.3, h * rng.range(0.94, 1.02), w);
          geo.rotateY(rng.range(-0.03, 0.03));
          if (axis === 0) geo.translate(t, y0 + h / 2, dir * (half - 0.15));
          else geo.translate(dir * (half - 0.15), y0 + h / 2, t);
          parts.push(paint(geo, rng, 0.95));
        });
      }
    }
  }

  // Core, so nothing shows through from a low angle.
  const core = new THREE.BoxGeometry(span - 0.5, wallTop - bottom, span - 0.5);
  core.translate(0, (wallTop + bottom) / 2, 0);
  parts.push(paint(core, rng, 0.7));

  // Flagged cap: irregular slabs with a mortar gap between them.
  const n = 3;
  for (let ix = 0; ix < n; ix++) {
    for (let iz = 0; iz < n; iz++) {
      const w = span / n - rng.range(0.01, 0.03);
      const d = span / n - rng.range(0.01, 0.03);
      const geo = blockGeometry(rng, w, capT, d, 0.012);
      geo.rotateY(rng.range(-0.02, 0.02));
      geo.translate(-half + (ix + 0.5) * (span / n), capTop - capT / 2, -half + (iz + 0.5) * (span / n));
      parts.push(paint(geo, rng, 1.06));
    }
  }

  const g = new THREE.Group();
  g.add(stoneMesh(parts));
  return g;
}

// ---------------------------------------------------------------- roof

/**
 * A shed roof: rafters, a board deck, and overlapping shingle courses.
 *
 * Laid flat rather than pitched. Pitch only works if a piece knows where the
 * building ends, and a modular tile doesn't — every tile would tilt the same way
 * and a two-cell roof would come out as a sawtooth.
 */
export function makeRoof(rng) {
  const wood = [];
  const nails = [];
  const span = CELL + 0.06;         // laps its neighbours so no seam shows sky

  // Rafters below the deck, sitting on the wall heads.
  const rafters = 3;
  for (let i = 0; i < rafters; i++) {
    const z = -span / 2 + (i + 0.5) * (span / rafters);
    const geo = plankGeometry(rng, span, 0.1, 0.14, { bow: 0.004 });
    geo.translate(0, -0.09, z);
    wood.push(tint(geo, rng, 0.74));
  }
  for (const dir of [-1, 1]) {
    const geo = plankGeometry(rng, span, 0.09, 0.12, { bow: 0.003 });
    geo.rotateY(Math.PI / 2);
    geo.translate(dir * (span / 2 - 0.06), -0.09, 0);
    wood.push(tint(geo, rng, 0.8));
  }

  // Deck boards across the rafters.
  let x = -span / 2;
  while (x < span / 2 - 0.02) {
    const w = Math.min(rng.range(0.16, 0.24), span / 2 - x);
    if (w < 0.03) break;
    const geo = plankGeometry(rng, span, w, 0.035, { bow: 0.004 });
    geo.rotateY(Math.PI / 2);
    geo.translate(x + w / 2, 0, 0);
    wood.push(tint(geo, rng, 0.9));
    x += w + 0.002;
  }

  // Shingles: short split boards in overlapping courses, each one a shade
  // different and a degree off square.
  const rows = 6;
  for (let r = 0; r < rows; r++) {
    const z = -span / 2 + (r + 0.5) * (span / rows);
    let sx = -span / 2 + (r % 2 ? rng.range(0.05, 0.13) : 0);
    while (sx < span / 2 - 0.04) {
      const w = Math.min(rng.range(0.17, 0.3), span / 2 - sx);
      if (w < 0.05) break;
      const geo = plankGeometry(rng, span / rows + 0.07, w, 0.022, { bow: 0.006 });
      geo.rotateY(Math.PI / 2 + rng.range(-0.02, 0.02));
      geo.translate(sx + w / 2, 0.03 + rng.range(0, 0.006), z);
      wood.push(tint(geo, rng, 0.86));

      const nail = nailGeometry(rng);
      nail.rotateX(-Math.PI / 2);
      nail.translate(sx + w / 2, 0.045, z - span / rows * 0.34);
      nails.push(nail);
      sx += w - rng.range(0.002, 0.01);
    }
  }

  return assemble(wood, nails);
}

// ---------------------------------------------------------------- stone wall

/** Coursed stone on an edge socket: same footprint as a plank wall, far tougher. */
export function makeStoneWall(rng) {
  const parts = [];
  const height = WALL_H;
  const thickness = 0.36;
  const courses = 7;

  for (let c = 0; c < courses; c++) {
    const y0 = (height * c) / courses;
    const h = (height / courses) * rng.range(0.94, 1.02);
    course(rng, CELL, 0.22, 0.42, (t, w) => {
      const geo = blockGeometry(rng, w - 0.012, h, thickness * rng.range(0.88, 1.0), 0.022);
      geo.rotateY(rng.range(-0.025, 0.025));
      geo.translate(t, y0 + h / 2, rng.range(-0.012, 0.012));
      parts.push(paint(geo, rng, c === courses - 1 ? 1.05 : 1));
    });
  }

  const g = new THREE.Group();
  g.add(stoneMesh(parts));

  // A timber wall plate on top, so a roof has something to bear on and the two
  // materials meet the way they would on a real building.
  const wood = [];
  const plate = plankGeometry(rng, CELL, thickness * 0.8, 0.07, { bow: 0.003 });
  plate.rotateX(Math.PI / 2);
  plate.translate(0, height + 0.03, 0);
  wood.push(tint(plate, rng, 0.9));
  g.add(assemble(wood, []));
  return g;
}

// ---------------------------------------------------------------- fence

/** Two rails and split pickets — a cheap perimeter you can see over. */
export function makeFence(rng) {
  const wood = [];
  const nails = [];
  const height = 1.2;

  for (const dir of [-1, 1]) {
    const h = height * rng.range(1.0, 1.06);
    const geo = plankGeometry(rng, h, 0.11, 0.11, { bow: 0.006 });
    geo.rotateZ(Math.PI / 2);
    geo.rotateY(rng.range(-0.03, 0.03));
    geo.translate(dir * (CELL / 2 - 0.06), h / 2, 0);
    wood.push(tint(geo, rng, 0.9));
  }

  const railY = [height * 0.32, height * 0.76];
  for (const y of railY) {
    const geo = plankGeometry(rng, CELL, 0.1, 0.04, { bow: 0.005 });
    geo.rotateX(Math.PI / 2);
    geo.translate(0, y, -0.03);
    wood.push(tint(geo, rng, 0.94));
  }

  let x = -CELL / 2 + 0.12;
  while (x < CELL / 2 - 0.12) {
    const w = rng.range(0.08, 0.13);
    const h = height * rng.range(0.82, 1.0);
    const geo = plankGeometry(rng, h, w, 0.03, { bow: 0.008 });
    geo.rotateZ(Math.PI / 2);
    geo.rotateY(Math.PI / 2 + rng.range(-0.05, 0.05));
    geo.translate(x, h / 2, 0.01);
    wood.push(tint(geo, rng, 1.0));
    for (const y of railY) {
      const n = nailGeometry(rng);
      n.translate(x, y, 0.03);
      nails.push(n);
    }
    x += w + rng.range(0.07, 0.13);
  }

  return assemble(wood, nails);
}

// ---------------------------------------------------------------- crate

/** A nailed crate with a strapped lid. */
export function makeCrate(rng) {
  const wood = [];
  const nails = [];
  const w = 1.05;
  const d = 0.8;
  const h = 0.78;
  const t = 0.035;

  // Four boarded sides. Boards run upright, the way a crate is knocked together.
  for (const [axis, dir] of [[0, -1], [0, 1], [1, -1], [1, 1]]) {
    const span = axis === 0 ? w : d;
    const off = axis === 0 ? d / 2 : w / 2;
    let x = -span / 2;
    while (x < span / 2 - 0.01) {
      const bw = Math.min(rng.range(0.15, 0.24), span / 2 - x);
      if (bw < 0.04) break;
      const geo = plankGeometry(rng, h, bw, t, { bow: 0.003 });
      geo.rotateZ(Math.PI / 2);
      geo.rotateY(axis === 0 ? Math.PI / 2 : 0);
      const cx = x + bw / 2;
      geo.translate(axis === 0 ? cx : dir * off, h / 2, axis === 0 ? dir * off : cx);
      wood.push(tint(geo, rng));
      x += bw - 0.002;
    }
  }

  // Corner battens, and nails where they cross the boards.
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const geo = plankGeometry(rng, h * 1.02, 0.07, 0.07, { bow: 0.002 });
    geo.rotateZ(Math.PI / 2);
    geo.translate(sx * (w / 2 - 0.02), h / 2, sz * (d / 2 - 0.02));
    wood.push(tint(geo, rng, 0.86));
    for (const y of [h * 0.16, h * 0.84]) {
      const n = nailGeometry(rng);
      n.translate(sx * (w / 2 - 0.02), y, sz * (d / 2 + 0.02));
      nails.push(n);
    }
  }

  // Lid boards, proud of the box on every side like a real crate top.
  let z = -d / 2 - 0.02;
  while (z < d / 2) {
    const bw = Math.min(rng.range(0.17, 0.26), d / 2 + 0.02 - z);
    if (bw < 0.05) break;
    const geo = plankGeometry(rng, w + 0.05, bw, 0.04, { bow: 0.004 });
    geo.translate(0, h + 0.02, z + bw / 2);
    wood.push(tint(geo, rng, 1.05));
    z += bw + 0.004;
  }

  const iron = [];
  for (const sz of [-1, 1]) {
    const strap = new THREE.BoxGeometry(0.05, 0.1, d * 0.42);
    strap.translate(0, h + 0.01, sz * d * 0.24);
    iron.push(strap);
  }
  const latch = new THREE.BoxGeometry(0.1, 0.13, 0.03);
  latch.translate(0, h - 0.06, d / 2 + 0.02);
  iron.push(latch);

  const mats = timberMaterials();
  const ironMesh = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(iron, false), mats.metal);
  ironMesh.castShadow = true;

  return assemble(wood, nails, [ironMesh]);
}

// ---------------------------------------------------------------- workbench

/** A heavy bench: thick top, braced legs, a vice and a scatter of iron. */
export function makeWorkbench(rng) {
  const wood = [];
  const nails = [];
  const w = 1.75;
  const d = 0.8;
  const topY = 0.92;

  let z = -d / 2;
  while (z < d / 2 - 0.01) {
    const bw = Math.min(rng.range(0.16, 0.23), d / 2 - z);
    if (bw < 0.05) break;
    const geo = plankGeometry(rng, w, bw, 0.07, { bow: 0.004 });
    geo.translate(0, topY, z + bw / 2);
    wood.push(tint(geo, rng, 1.02));
    z += bw + 0.003;
  }

  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const geo = plankGeometry(rng, topY, 0.11, 0.11, { bow: 0.004 });
    geo.rotateZ(Math.PI / 2);
    geo.rotateY(rng.range(-0.02, 0.02));
    geo.translate(sx * (w / 2 - 0.1), topY / 2, sz * (d / 2 - 0.1));
    wood.push(tint(geo, rng, 0.88));
  }

  // Rails, and a shelf under the top for the look of a bench in use.
  for (const sz of [-1, 1]) {
    const geo = plankGeometry(rng, w - 0.2, 0.1, 0.05, { bow: 0.003 });
    geo.rotateX(Math.PI / 2);
    geo.translate(0, 0.26, sz * (d / 2 - 0.1));
    wood.push(tint(geo, rng, 0.84));
  }
  const shelf = plankGeometry(rng, w - 0.24, d - 0.26, 0.04, { bow: 0.004 });
  shelf.translate(0, 0.32, 0);
  wood.push(tint(shelf, rng, 0.8));

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const n = nailGeometry(rng);
      n.rotateX(-Math.PI / 2);
      n.translate(sx * (w / 2 - 0.1), topY + 0.036, sz * (d / 2 - 0.1));
      nails.push(n);
    }
  }

  const iron = [];
  const viceBody = new THREE.BoxGeometry(0.26, 0.17, 0.2);
  viceBody.translate(w / 2 - 0.24, topY + 0.11, -0.06);
  iron.push(viceBody);
  const viceJaw = new THREE.BoxGeometry(0.06, 0.19, 0.24);
  viceJaw.translate(w / 2 - 0.4, topY + 0.11, -0.06);
  iron.push(viceJaw);
  const screw = new THREE.CylinderGeometry(0.024, 0.024, 0.3, 6);
  screw.rotateZ(Math.PI / 2);
  screw.translate(w / 2 - 0.36, topY + 0.11, -0.06);
  iron.push(screw);
  // A few offcuts of stock left on the bench.
  for (let i = 0; i < 3; i++) {
    const bar = new THREE.BoxGeometry(rng.range(0.2, 0.42), 0.025, 0.05);
    bar.rotateY(rng.range(-0.5, 0.5));
    bar.translate(rng.range(-0.6, 0.2), topY + 0.05, rng.range(-0.2, 0.25));
    iron.push(bar);
  }

  const mats = timberMaterials();
  const ironMesh = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(iron, false), mats.metal);
  ironMesh.castShadow = true;

  return assemble(wood, nails, [ironMesh]);
}

// ---------------------------------------------------------------- fire, furnace

/** A stone ring round an ember bed, with split logs stacked over it. */
export function makeCampfire(rng) {
  const g = new THREE.Group();
  const stones = [];
  const ring = 0.52;
  const count = 11;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rng.range(-0.1, 0.1);
    const r = ring * rng.range(0.94, 1.08);
    const geo = blockGeometry(rng, rng.range(0.16, 0.26), rng.range(0.16, 0.24), rng.range(0.14, 0.2), 0.035);
    geo.rotateY(a + rng.range(-0.4, 0.4));
    geo.translate(Math.cos(a) * r, rng.range(0.06, 0.11), Math.sin(a) * r);
    stones.push(paint(geo, rng, 0.9));
  }
  g.add(stoneMesh(stones));

  const wood = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const len = rng.range(0.5, 0.7);
    const geo = plankGeometry(rng, len, rng.range(0.07, 0.11), rng.range(0.07, 0.1), { bow: 0.01 });
    geo.rotateZ(rng.range(0.5, 0.85));
    geo.rotateY(a);
    geo.translate(Math.cos(a) * 0.14, 0.2, Math.sin(a) * 0.14);
    wood.push(tint(geo, rng, 0.42));      // charred
  }
  g.add(assemble(wood, []));

  const embers = new THREE.Mesh(
    new THREE.CircleGeometry(0.36, 12),
    new THREE.MeshStandardMaterial({ color: 0xff5a18, emissive: 0xff4a10, emissiveIntensity: 2.2, roughness: 1 }));
  embers.rotation.x = -Math.PI / 2;
  embers.position.y = 0.05;
  g.add(embers);

  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.26, 0.66, 6),
    new THREE.MeshStandardMaterial({
      color: 0xffa23a, emissive: 0xff7a1a, emissiveIntensity: 2.4,
      transparent: true, opacity: 0.85, flatShading: true,
    }));
  flame.position.y = 0.5;
  flame.name = 'flame';
  g.add(flame);

  const light = new THREE.PointLight(0xff9040, 6, 9, 2);
  light.position.y = 0.9;
  g.add(light);
  return g;
}

/** A stone stack with a clay throat and an iron mouth. */
export function makeFurnace(rng) {
  const g = new THREE.Group();
  const parts = [];
  const courses = 8;
  const height = 1.45;

  for (let c = 0; c < courses; c++) {
    const y = (height * (c + 0.5)) / courses;
    const r = 0.62 - (y / height) * 0.16;
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + c * 0.35;
      // Leave the mouth open on the front face of the bottom two courses.
      if (c < 2 && Math.abs(((a + Math.PI) % (Math.PI * 2)) - Math.PI) > Math.PI - 0.55) continue;
      const geo = blockGeometry(rng, rng.range(0.3, 0.42), (height / courses) * rng.range(0.9, 1.02), 0.3, 0.026);
      geo.rotateY(-a);
      geo.translate(Math.cos(a) * r, y, Math.sin(a) * r);
      parts.push(paint(geo, rng, 0.95));
    }
  }
  // Chimney.
  for (let c = 0; c < 3; c++) {
    const y = height + 0.09 + c * 0.17;
    const n = 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + c * 0.5;
      const geo = blockGeometry(rng, 0.2, 0.17, 0.16, 0.02);
      geo.rotateY(-a);
      geo.translate(Math.cos(a) * 0.26, y, Math.sin(a) * 0.26);
      parts.push(paint(geo, rng, 0.88));
    }
  }
  g.add(stoneMesh(parts));

  const mouth = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.34, 0.12),
    new THREE.MeshStandardMaterial({ color: 0xff7a2a, emissive: 0xff5210, emissiveIntensity: 2, roughness: 1 }));
  mouth.position.set(0, 0.3, 0.58);
  mouth.name = 'flame';
  g.add(mouth);

  const lintel = [];
  const bar = new THREE.BoxGeometry(0.56, 0.07, 0.16);
  bar.translate(0, 0.52, 0.58);
  lintel.push(bar);
  for (const sx of [-1, 1]) {
    const post = new THREE.BoxGeometry(0.06, 0.5, 0.14);
    post.translate(sx * 0.25, 0.26, 0.6);
    lintel.push(post);
  }
  const iron = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(lintel, false), timberMaterials().metal);
  iron.castShadow = true;
  g.add(iron);

  const light = new THREE.PointLight(0xff8030, 3.5, 6, 2);
  light.position.set(0, 0.5, 0.7);
  g.add(light);
  return g;
}
