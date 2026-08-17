import * as THREE from 'three';
import * as BufferGeometryUtils from '../../../vendor/utils/BufferGeometryUtils.js';
import { plankGeometry, tint, nailGeometry, timberMaterials, assemble } from './timber.js';
import { surfaceMaterial } from '../textures.js';

// What people built and left behind.
//
// The world outside the camp had nothing man-made in it except crashed cars, so
// it read as wilderness rather than as somewhere emptied out. These are the same
// boards the player builds with, taken apart: gaps where cladding has come away,
// frames stripped back to their posts, and the charred ends of something that
// burned. The point is recognition — you can see it was a wall, and you can see
// what happened to it.

const CHAR = 0.34;        // how dark a burnt board goes

/**
 * A wall that has lost most of itself.
 *
 * Boards are dropped at random and the survivors are shortened from the top, so
 * the ragged edge is where the cladding rotted or burned away rather than a
 * straight line someone drew.
 */
export function makeRuinWall(rng, opts = {}) {
  const width = opts.width ?? 2.0;
  const height = opts.height ?? rng.range(1.5, 2.4);
  const burnt = opts.burnt ?? rng.chance(0.45);
  const survival = opts.survival ?? rng.range(0.35, 0.75);

  const wood = [];
  const nails = [];

  // The frame nearly always outlives the cladding — posts and rails are heavier
  // timber and better fixed, which is why a ruin is mostly skeleton.
  for (const dir of [-1, 1]) {
    const h = height * rng.range(0.85, 1.05);
    const geo = plankGeometry(rng, h, 0.12, 0.12, { bow: 0.006 });
    geo.rotateZ(Math.PI / 2);
    geo.rotateY(rng.range(-0.05, 0.05));
    geo.translate(dir * (width / 2 - 0.06), h / 2, rng.range(-0.03, 0.03));
    wood.push(tint(geo, rng, burnt ? CHAR : 0.8));
  }
  const railY = height * rng.range(0.34, 0.52);
  const rail = plankGeometry(rng, width * 0.98, 0.13, 0.05, { bow: 0.005 });
  rail.rotateX(Math.PI / 2);
  rail.rotateZ(rng.range(-0.04, 0.04));
  rail.translate(0, railY, -0.05);
  wood.push(tint(rail, rng, burnt ? CHAR * 1.2 : 0.86));

  // Cladding, most of it gone.
  let x = -width / 2;
  while (x < width / 2 - 0.02) {
    const w = Math.min(rng.range(0.16, 0.27), width / 2 - x);
    if (w < 0.05) break;
    if (rng() < survival) {
      // Survivors are shorter than they were, and the break is never level.
      const h = height * rng.range(0.3, 0.95);
      const geo = plankGeometry(rng, h, w, 0.05, { bow: 0.012 });
      geo.rotateZ(Math.PI / 2);
      geo.rotateY(Math.PI / 2 + rng.range(-0.05, 0.05));
      geo.translate(x + w / 2, h / 2 - 0.02, rng.range(-0.01, 0.01));
      // Burnt boards are darkest at the top, where the fire ran.
      wood.push(tint(geo, rng, burnt ? CHAR * rng.range(0.8, 1.5) : rng.range(0.6, 0.95)));

      if (h > railY) {
        const n = nailGeometry(rng);
        n.translate(x + w / 2, railY, 0.03);
        nails.push(n);
      }
    }
    x += w - rng.range(0.001, 0.004);
  }

  const g = assemble(wood, nails);
  g.rotation.z = rng.range(-0.06, 0.06);      // nothing left standing is plumb
  return g;
}

/** A stripped frame: four posts and what is left of the plate across them. */
export function makeRuinFrame(rng) {
  const w = rng.range(1.8, 2.6);
  const d = rng.range(1.6, 2.4);
  const h = rng.range(1.8, 2.6);
  const burnt = rng.chance(0.5);
  const wood = [];

  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    if (rng.chance(0.15)) continue;           // one corner has gone entirely
    const ph = h * rng.range(0.55, 1.0);
    const geo = plankGeometry(rng, ph, 0.14, 0.14, { bow: 0.008 });
    geo.rotateZ(Math.PI / 2);
    geo.rotateY(rng.range(-0.06, 0.06));
    geo.translate(sx * w / 2, ph / 2, sz * d / 2);
    wood.push(tint(geo, rng, burnt ? CHAR : 0.82));
  }

  // Whatever is left of the wall plate, sagging between the posts it still has.
  for (const [rot, dx, dz, len] of [
    [0, 0, -d / 2, w], [0, 0, d / 2, w],
    [Math.PI / 2, -w / 2, 0, d], [Math.PI / 2, w / 2, 0, d]]) {
    if (rng.chance(0.4)) continue;
    const geo = plankGeometry(rng, len * rng.range(0.7, 1.0), 0.12, 0.09, { bow: 0.02 });
    geo.rotateY(rot);
    geo.rotateZ(rng.range(-0.08, 0.08));
    geo.translate(dx, h * rng.range(0.72, 0.95), dz);
    wood.push(tint(geo, rng, burnt ? CHAR * 1.3 : 0.78));
  }
  return assemble(wood, []);
}

/** Fallen boards and broken masonry, heaped where a wall came down. */
export function makeRubble(rng) {
  const wood = [];
  const stones = [];

  const n = rng.int(4, 8);
  for (let i = 0; i < n; i++) {
    const len = rng.range(0.5, 1.5);
    const geo = plankGeometry(rng, len, rng.range(0.12, 0.24), 0.045, { bow: 0.02 });
    geo.rotateZ(rng.range(-0.25, 0.25));
    geo.rotateY(rng.range(0, Math.PI * 2));
    geo.translate(rng.range(-0.5, 0.5), 0.03 + i * 0.05, rng.range(-0.5, 0.5));
    wood.push(tint(geo, rng, rng.chance(0.5) ? CHAR : rng.range(0.55, 0.9)));
  }

  for (let i = 0; i < rng.int(3, 7); i++) {
    const s = new THREE.BoxGeometry(rng.range(0.14, 0.3), rng.range(0.1, 0.2), rng.range(0.14, 0.3));
    s.rotateY(rng.range(0, Math.PI * 2));
    s.translate(rng.range(-0.6, 0.6), 0.07, rng.range(-0.6, 0.6));
    const c = new Float32Array(s.attributes.position.count * 3).fill(rng.range(0.7, 1.0));
    s.setAttribute('color', new THREE.BufferAttribute(c, 3));
    stones.push(s);
  }

  const g = assemble(wood, []);
  if (stones.length) {
    const mat = surfaceMaterial('stone', { repeat: 2, roughness: 0.97, seed: 13 });
    mat.vertexColors = true;
    const mesh = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(stones, false), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
  }
  return g;
}

/**
 * A cold fire someone else sat at.
 *
 * Reads at a glance and costs almost nothing: a ring of stones with grey ash and
 * a couple of burnt ends. Evidence that people passed through, which is the one
 * thing an empty landscape cannot say by itself.
 */
export function makeDeadFire(rng) {
  const g = new THREE.Group();
  const stones = [];
  const count = rng.int(6, 10);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const r = rng.range(0.34, 0.46);
    const s = new THREE.BoxGeometry(rng.range(0.12, 0.2), rng.range(0.1, 0.16), rng.range(0.1, 0.16));
    s.rotateY(a + rng.range(-0.3, 0.3));
    s.translate(Math.cos(a) * r, 0.05, Math.sin(a) * r);
    const c = new Float32Array(s.attributes.position.count * 3).fill(rng.range(0.6, 0.95));
    s.setAttribute('color', new THREE.BufferAttribute(c, 3));
    stones.push(s);
  }
  const mat = surfaceMaterial('stone', { repeat: 2.4, roughness: 0.98, seed: 17 });
  mat.vertexColors = true;
  const ring = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(stones, false), mat);
  ring.castShadow = true;
  ring.receiveShadow = true;
  g.add(ring);

  const ash = new THREE.Mesh(
    new THREE.CircleGeometry(0.3, 10),
    new THREE.MeshStandardMaterial({ color: 0x4a4741, roughness: 1 }));
  ash.rotation.x = -Math.PI / 2;
  ash.position.y = 0.012;
  g.add(ash);

  const wood = [];
  for (let i = 0; i < rng.int(2, 4); i++) {
    const a = rng.range(0, Math.PI * 2);
    const geo = plankGeometry(rng, rng.range(0.3, 0.5), 0.07, 0.06, { bow: 0.01 });
    geo.rotateY(a);
    geo.translate(Math.cos(a) * 0.12, 0.06, Math.sin(a) * 0.12);
    wood.push(tint(geo, rng, 0.22));         // burnt right through
  }
  g.add(assemble(wood, []));
  return g;
}
