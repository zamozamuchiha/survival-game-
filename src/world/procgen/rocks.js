import * as THREE from 'three';
import { surfaceMaterial } from '../textures.js';

// Rocks that were broken off something, not spheres with noise on them.
//
// The shape comes from three passes over a subdivided icosahedron:
//   1. low-frequency lumps decide the overall mass and stop it being round
//   2. a few cutting planes shear whole faces flat, giving the sharp edges and
//      facets that read as fracture rather than erosion
//   3. high-frequency detail pits the surface
//
// Rounded and sharp features therefore come from different passes, which is what
// keeps a boulder from looking either like a potato or like a crystal.

/** Signed distance from a point to a plane, used for the shearing pass. */
function planeCut(v, normal, offset) {
  return v.x * normal.x + v.y * normal.y + v.z * normal.z - offset;
}

function rockGeometry(rng, opts) {
  const {
    detail = 3,
    lumps = 0.34,
    facets = 3,
    facetDepth = 0.16,
    pitting = 0.055,
    squash = [1, 0.78, 1],
  } = opts;

  const geo = new THREE.IcosahedronGeometry(1, detail);
  // Icosahedron geometry is non-indexed at high detail in some builds; merging
  // by position keeps the surface watertight so lighting stays continuous.
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();

  const seeds = [rng() * 10, rng() * 10, rng() * 10];
  const cuts = [];
  for (let i = 0; i < facets; i++) {
    const n = new THREE.Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).normalize();
    cuts.push({ n, d: rng.range(0.55, 0.86) });
  }

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const dir = v.clone().normalize();

    // 1. mass
    let r = 1
      + Math.sin(dir.x * 2.1 + seeds[0]) * lumps
      + Math.sin(dir.y * 1.7 - seeds[1]) * lumps * 0.85
      + Math.sin(dir.z * 2.4 + seeds[2]) * lumps * 0.7
      + Math.sin((dir.x + dir.z) * 3.3 - seeds[0]) * lumps * 0.4;

    // 3. pitting (applied to the radius before the cuts so facets stay flat)
    r += (Math.sin(dir.x * 17 + seeds[1] * 3) * Math.sin(dir.y * 19 - seeds[2] * 2)
        + Math.sin(dir.z * 23 + seeds[0])) * pitting;

    v.copy(dir).multiplyScalar(Math.max(0.35, r));
    v.x *= squash[0];
    v.y *= squash[1];
    v.z *= squash[2];

    // 2. shear: anything past a cutting plane is pushed back onto it
    for (const c of cuts) {
      const d = planeCut(v, c.n, c.d);
      if (d > 0) v.addScaledVector(c.n, -d * (1 - facetDepth));
    }

    pos.setXYZ(i, v.x, v.y, v.z);
  }

  geo.computeVertexNormals();
  geo.computeBoundingBox();

  // Sit it on the ground: the lowest point becomes y = 0.
  const min = geo.boundingBox.min.y;
  geo.translate(0, -min, 0);
  geo.computeBoundingBox();
  return geo;
}

/** Variant shapes — deliberately different masses, not one shape rotated. */
export const ROCK_PROFILES = {
  // Big weathered boulder, mostly rounded with one or two broken faces.
  boulder:  { detail: 3, lumps: 0.30, facets: 2, facetDepth: 0.22, pitting: 0.05,  squash: [1.0, 0.80, 0.95] },
  // Angular block, clearly fractured.
  block:    { detail: 3, lumps: 0.18, facets: 5, facetDepth: 0.06, pitting: 0.035, squash: [1.0, 0.85, 0.9] },
  // Low flat slab.
  slab:     { detail: 3, lumps: 0.24, facets: 4, facetDepth: 0.10, pitting: 0.045, squash: [1.15, 0.42, 1.0] },
  // Tall wedge standing on end.
  wedge:    { detail: 3, lumps: 0.26, facets: 3, facetDepth: 0.12, pitting: 0.05,  squash: [0.78, 1.25, 0.8] },
  // Rubble: small, chipped, very irregular.
  rubble:   { detail: 2, lumps: 0.38, facets: 4, facetDepth: 0.10, pitting: 0.08,  squash: [1.0, 0.7, 1.05] },
};

const sharedRockMats = new Map();

function rockMaterial(kind, seed) {
  const key = `${kind}:${seed}`;
  if (sharedRockMats.has(key)) return sharedRockMats.get(key);
  const mat = surfaceMaterial(kind === 'warm' ? 'stoneWarm' : 'stone', {
    repeat: 1.6,
    roughness: 0.98,
    seed: 3 + seed,
    normalScale: 1.3,
  });
  sharedRockMats.set(key, mat);
  return mat;
}

/**
 * Builds one rock, origin at the foot, roughly one metre across before scaling.
 *
 * @param variant key into ROCK_PROFILES
 * @param kind    'grey' | 'warm' — mineral tint
 */
export function makeRock(rng, variant = 'boulder', kind = 'grey') {
  const profile = ROCK_PROFILES[variant] ?? ROCK_PROFILES.boulder;
  const geo = rockGeometry(rng, profile);
  const mesh = new THREE.Mesh(geo, rockMaterial(kind, variant.length));
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const group = new THREE.Group();
  group.add(mesh);

  // Bigger rocks get a couple of chips at the base — nothing sits on bare ground
  // without having shed something.
  if (variant === 'boulder' || variant === 'wedge') {
    const chips = rng.int(1, 3);
    for (let i = 0; i < chips; i++) {
      const chip = new THREE.Mesh(rockGeometry(rng, ROCK_PROFILES.rubble), mesh.material);
      const s = rng.range(0.12, 0.24);
      chip.scale.setScalar(s);
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(0.5, 0.85);
      chip.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
      chip.rotation.y = rng.range(0, Math.PI * 2);
      chip.castShadow = true;
      chip.receiveShadow = true;
      group.add(chip);
    }
  }
  return group;
}
