import * as THREE from 'three';
import * as BufferGeometryUtils from '../../../vendor/utils/BufferGeometryUtils.js';
import { surfaceMaterial } from '../textures.js';
import { leafBuffer, leafGeometry, leafSpray, pushLeaf } from './foliage.js';

// Grown trees rather than modelled ones.
//
// A trunk is a swept tube along a curve that wanders as it rises and tapers as
// it goes, with the cross-section pushed in and out so no two rings match. Limbs
// recurse off it at natural angles, thinning each generation, and foliage sits in
// clumps at the ends of the thin ones.
//
// Everything merges down to two geometries — bark and leaves — so a whole tree
// is two draw calls and can still be instanced across a forest.

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Bark relief, as a fraction of the radius to cut away.
 *
 * Layered sine bands in the angular direction give ridges of varying width, and
 * because the phase barely moves with t they run up the trunk the way real
 * furrows do. Taking the absolute value turns the smooth waves into sharp
 * valleys with rounded ridges between them, which is the shape of bark.
 *
 * This is displacement, not a texture: it changes the silhouette, so the trunk
 * still reads as bark where it crosses the sky and where it catches raking light
 * — the two places a normal map gives itself away.
 */
function barkFurrow(a, t, seed) {
  let v = Math.sin(a * 9 + seed * 1.7 + t * 1.4) * 0.52
        + Math.sin(a * 17 + seed * 3.1 - t * 0.9) * 0.3
        + Math.sin(a * 29 + seed * 5.3 + t * 2.6) * 0.18;
  // Cross-breaks, so the furrows are plates rather than uninterrupted combing.
  v *= 0.82 + Math.sin(t * 33 + a * 2.3 + seed) * 0.18;
  return Math.min(1, Math.abs(v));
}

/**
 * A tapered, irregular tube along a path.
 *
 * Radius wobble is driven off the point index and angle rather than random per
 * vertex, so the surface stays continuous instead of turning into noise.
 * `relief` carves bark furrows into it — see barkFurrow.
 */
function limbGeometry(points, radii, { radial = 7, wobble = 0.16, seed = 0, relief = 0 }) {
  const curve = new THREE.CatmullRomCurve3(points);
  const steps = Math.max(2, points.length * 3);
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  const frames = curve.computeFrenetFrames(steps, false);
  const p = new THREE.Vector3();
  const nrm = new THREE.Vector3();

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    curve.getPointAt(t, p);
    const N = frames.normals[Math.min(i, steps - 1)];
    const B = frames.binormals[Math.min(i, steps - 1)];

    // Radius interpolated along the supplied profile, then dented.
    const fr = t * (radii.length - 1);
    const i0 = Math.floor(fr);
    const baseR = THREE.MathUtils.lerp(radii[i0], radii[Math.min(radii.length - 1, i0 + 1)], fr - i0);

    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const dent = 1
        + Math.sin(a * 3 + seed + t * 4) * wobble
        + Math.sin(a * 7 - seed * 2 + t * 9) * wobble * 0.45;
      // Bark eats into the radius rather than standing proud of it, so the
      // trunk keeps the thickness its profile asked for.
      const r = baseR * dent * (relief > 0 ? 1 - barkFurrow(a, t, seed) * relief : 1);
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      nrm.set(N.x * cos + B.x * sin, N.y * cos + B.y * sin, N.z * cos + B.z * sin);
      positions.push(p.x + nrm.x * r, p.y + nrm.y * r, p.z + nrm.z * r);
      normals.push(nrm.x, nrm.y, nrm.z);
      // V follows real length so bark grain keeps its scale up the trunk.
      uvs.push(j / radial, t * curve.getLength() * 0.55);
    }
  }

  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j;
      const b = i * radial + ((j + 1) % radial);
      const c = (i + 1) * radial + j;
      const d = (i + 1) * radial + ((j + 1) % radial);
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  // The analytic normals above point straight out from the spine, which is only
  // true for a smooth tube. Once the surface is furrowed they have to come from
  // the geometry, or the ridges are lit as though they were not there.
  if (relief > 0) geo.computeVertexNormals();
  return geo;
}

const UP_VEC = new THREE.Vector3(0, 1, 0);

/**
 * Fills the inside of a leaf cluster — with more leaves, not with a shape.
 *
 * A canopy made only of outward-facing sprays is full of holes. The obvious fix
 * is a blob behind them, but a smooth sphere between sharp-edged leaves reads as
 * two different art styles in one model. So the filler is the same leaf, just
 * smaller, shorter and pointing every which way, packed into the interior where
 * it closes the gaps without ever being identifiable as a separate thing.
 */
function innerLeaves(target, rng, at, radius, count) {
  for (let i = 0; i < count; i++) {
    // Even-ish spread over a sphere, biased inwards.
    const theta = rng.range(0, Math.PI * 2);
    const phi = Math.acos(rng.range(-1, 1));
    const dir = new THREE.Vector3(
      Math.sin(phi) * Math.cos(theta),
      Math.cos(phi) * 0.8,
      Math.sin(phi) * Math.sin(theta)).normalize();

    const r = radius * Math.pow(rng(), 0.4);   // more towards the outside
    const from = new THREE.Vector3(
      at.x + dir.x * r * 0.55,
      at.y + dir.y * r * 0.55,
      at.z + dir.z * r * 0.55);

    pushLeaf(target, rng, from, dir, UP_VEC,
      radius * rng.range(0.55, 0.95),
      radius * rng.range(0.26, 0.44));
  }
}

/**
 * Grows one tree.
 *
 * @param rng     seeded rng
 * @param profile shape parameters (see TREE_PROFILES)
 * @returns { barkGeo, leafGeo, height }
 */
function grow(rng, profile) {
  const barkParts = [];
  const leaves = leafBuffer();

  const height = rng.range(profile.height[0], profile.height[1]);
  const baseRadius = height * rng.range(profile.thickness[0], profile.thickness[1]);

  // --- trunk: a wandering, tapering spine ---------------------------------
  const rings = 7;
  const spine = [];
  const radii = [];
  let drift = new THREE.Vector3(rng.range(-1, 1), 0, rng.range(-1, 1)).normalize();
  let x = 0;
  let z = 0;

  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    // Leans a little and never in a straight line.
    x += drift.x * height * profile.lean * rng.range(0.4, 1.0) / rings;
    z += drift.z * height * profile.lean * rng.range(0.4, 1.0) / rings;
    spine.push(new THREE.Vector3(x, t * height * profile.trunkRun, z));
    // Flared foot, steady taper, thin tip.
    const taper = Math.pow(1 - t, profile.taper);
    const flare = t < 0.14 ? 1 + (0.14 - t) * 4.5 : 1;
    radii.push(baseRadius * (0.25 + taper * 0.75) * flare);
  }

  // The trunk is what the player walks up to, so it gets the segment count that
  // lets bark exist as geometry: at 9 around there is nowhere to put a furrow.
  barkParts.push(limbGeometry(spine, radii, {
    radial: 20, wobble: profile.gnarl, seed: rng() * 6, relief: profile.barkRelief ?? 0.16,
  }));

  // --- limbs: recurse off the trunk, thinning each generation --------------
  const branchAt = (from, dir, len, radius, depth) => {
    const pts = [from.clone()];
    const step = dir.clone();
    const cur = from.clone();
    const segs = depth === 0 ? 4 : 3;
    for (let i = 0; i < segs; i++) {
      // Limbs curve upward as they reach for light.
      step.y += profile.reach / segs;
      step.normalize();
      cur.addScaledVector(step, len / segs);
      // and wander sideways as they go
      cur.x += rng.range(-0.12, 0.12) * len;
      cur.z += rng.range(-0.12, 0.12) * len;
      pts.push(cur.clone());
    }
    const prof = [radius, radius * 0.62, radius * 0.3, radius * 0.14];
    barkParts.push(limbGeometry(pts, prof, {
      radial: depth === 0 ? 10 : 5, wobble: 0.2, seed: rng() * 6,
      relief: depth === 0 ? (profile.barkRelief ?? 0.16) * 0.6 : 0,
    }));

    const tip = pts[pts.length - 1];
    if (depth < profile.depth) {
      const kids = rng.int(2, 3);
      for (let k = 0; k < kids; k++) {
        const a = rng.range(0, Math.PI * 2);
        const spread = rng.range(0.45, 0.95);
        const kidDir = new THREE.Vector3(Math.cos(a) * spread, rng.range(0.5, 1.1), Math.sin(a) * spread).normalize();
        const from = pts[Math.max(1, pts.length - 1 - (k % 2))];
        branchAt(from, kidDir, len * rng.range(0.5, 0.72), radius * 0.55, depth + 1);
      }
    } else {
      // Real leaves on the thin ends, sprayed around the twig rather than a blob
      // standing in for a canopy. Sprays overlap into each other, which is what
      // closes the silhouette without needing a solid shape underneath.
      const sprays = rng.int(profile.clumps[0], profile.clumps[1]);
      const size = profile.leafSize * height * 0.1;
      // Fill the middle of the cluster before spraying the outside of it.
      if (profile.mass > 0) {
        innerLeaves(leaves, rng, tip, size * profile.mass * rng.range(0.9, 1.2),
          Math.round(profile.leaves[0] * 0.9));
      }
      for (let c = 0; c < sprays; c++) {
        const at = new THREE.Vector3(
          tip.x + rng.range(-0.5, 0.5) * size,
          tip.y + rng.range(-0.35, 0.55) * size,
          tip.z + rng.range(-0.5, 0.5) * size);
        leafSpray(leaves, rng, at, UP_VEC,
          rng.int(profile.leaves[0], profile.leaves[1]),
          [size * 0.30, size * 0.55],
          [size * 0.14, size * 0.24],
          1.0);
      }
    }
  };

  const limbCount = rng.int(profile.limbs[0], profile.limbs[1]);
  const startAt = profile.branchFrom;
  for (let i = 0; i < limbCount; i++) {
    // Spiral the limbs up the trunk rather than ringing them at one height.
    const t = startAt + (1 - startAt) * (i / Math.max(1, limbCount - 1)) * rng.range(0.85, 1.0);
    const idx = Math.min(rings, Math.floor(t * rings));
    const from = spine[idx].clone();
    const a = (i / limbCount) * Math.PI * 2 * profile.spiral + rng.range(-0.5, 0.5);
    const outward = rng.range(0.55, 1.0);
    const dir = new THREE.Vector3(Math.cos(a) * outward, rng.range(0.35, 0.8), Math.sin(a) * outward).normalize();
    const len = height * rng.range(profile.limbLen[0], profile.limbLen[1]) * (1 - t * 0.35);
    branchAt(from, dir, len, radii[idx] * rng.range(0.4, 0.6), 0);
  }

  // A crown on top so the silhouette closes rather than fraying out.
  if (profile.crown > 0) {
    const top = spine[rings];
    const size = profile.leafSize * profile.crown * height * 0.1;
    const sprays = rng.int(5, 7);
    for (let c = 0; c < sprays; c++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(0, size * 0.8);
      const at = new THREE.Vector3(
        top.x + Math.cos(a) * r,
        top.y + rng.range(-0.25, 0.5) * size,
        top.z + Math.sin(a) * r);
      if (profile.mass > 0 && c % 2 === 0) {
        innerLeaves(leaves, rng, at, size * profile.mass * rng.range(0.9, 1.2),
          Math.round(profile.leaves[0] * 0.9));
      }
      leafSpray(leaves, rng, at, UP_VEC,
        rng.int(profile.leaves[0], profile.leaves[1]),
        [size * 0.26, size * 0.48],
        [size * 0.12, size * 0.21],
        1.15);
    }
  }

  return {
    barkGeo: BufferGeometryUtils.mergeGeometries(barkParts, false),
    // Inner fill and outer sprays are the same leaves in the same buffer, so the
    // whole canopy is one geometry with nothing to merge and no style seam.
    leafGeo: leafGeometry(leaves),
    height: height * profile.trunkRun,
  };
}

/**
 * Shape families. Varying these — not just rotation — is what stops a forest
 * from reading as one tree stamped everywhere.
 */
export const TREE_PROFILES = {
  oak: {
    height: [4.2, 6.4], thickness: [0.045, 0.062], taper: 1.5, trunkRun: 0.70,
    lean: 0.10, gnarl: 0.19, limbs: [5, 7], limbLen: [0.20, 0.30], branchFrom: 0.42,
    // clumps = leaf sprays per twig end, leaves = individual leaves per spray.
    depth: 1, reach: 0.55, spiral: 1.6, clumps: [5, 6], leaves: [18, 26],
    leafSize: 1.05, crown: 1.2, mass: 0.60,
    bark: 'bark', barkRelief: 0.20, leaf: 0x8fae5c,
  },
  pine: {
    height: [6.0, 8.6], thickness: [0.028, 0.038], taper: 2.4, trunkRun: 0.94,
    lean: 0.04, gnarl: 0.12, limbs: [8, 11], limbLen: [0.16, 0.26], branchFrom: 0.28,
    depth: 1, reach: 0.15, spiral: 2.4, clumps: [4, 5], leaves: [16, 22],
    leafSize: 0.7, crown: 0.95, mass: 0.55,
    bark: 'barkDark', barkRelief: 0.15, leaf: 0x6f9450,
  },
  dead: {
    height: [3.8, 5.6], thickness: [0.040, 0.055], taper: 1.7, trunkRun: 0.78,
    lean: 0.16, gnarl: 0.28, limbs: [4, 6], limbLen: [0.26, 0.40], branchFrom: 0.35,
    depth: 2, reach: 0.35, spiral: 1.2, clumps: [0, 0], leaves: [0, 0],
    leafSize: 0, crown: 0, mass: 0,
    bark: 'barkPale', barkRelief: 0.26, leaf: 0x6b6a4a,
  },
};

/**
 * Builds one tree as a ready-to-place Object3D, origin at the foot.
 *
 * Materials are shared per profile so a forest of the same species batches.
 */
const sharedMaterials = new Map();

function materialsFor(profile, key) {
  if (sharedMaterials.has(key)) return sharedMaterials.get(key);
  const set = {
    bark: surfaceMaterial(profile.bark, {
      repeat: 1, roughness: 0.95, seed: key.length + 3, normalScale: 1.15,
    }),
    // Individual leaves carry their own colour and shading in vertex colours, so
    // the canopy no longer needs a texture to fake detail it now actually has.
    leaf: new THREE.MeshStandardMaterial({
      color: profile.leaf,
      roughness: 0.92,
      metalness: 0,
      vertexColors: true,
      side: THREE.DoubleSide,
    }),
  };
  sharedMaterials.set(key, set);
  return set;
}

export function makeTree(rng, species = 'oak') {
  const profile = TREE_PROFILES[species] ?? TREE_PROFILES.oak;
  const { barkGeo, leafGeo } = grow(rng, profile);
  const mats = materialsFor(profile, species);

  const group = new THREE.Group();
  const trunk = new THREE.Mesh(barkGeo, mats.bark);
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  group.add(trunk);

  if (leafGeo) {
    const canopy = new THREE.Mesh(leafGeo, mats.leaf);
    canopy.castShadow = true;
    // Millimetre-thin leaves against a 2.2cm shadow bias come back shadowed every
    // time — see the note in procgen/bushes.js.
    canopy.receiveShadow = false;
    canopy.userData.noReceiveShadow = true;
    group.add(canopy);
  }
  return group;
}
