import * as THREE from 'three';
import * as BufferGeometryUtils from '../../../vendor/utils/BufferGeometryUtils.js';
import { surfaceMaterial } from '../textures.js';

// Bushes built the same way the grass is: out of the actual parts.
//
// A woody frame of stems rises from the base and forks a couple of times, and
// individual leaves are attached along the thin ends — each one a small tapered
// blade with a raised midrib, so it has a curved surface that catches light on
// one side and shades on the other. Up close you can pick out single leaves and
// the twigs holding them; from across the clearing they read as one dense mass.
//
// Everything merges into two geometries, stems and leaves, so a bush stays two
// draw calls and can be instanced across a map.

const LEAF_SEGMENTS = 3;

/**
 * One leaf: a strip whose width follows a leaf profile — narrow at the stalk,
 * widest a third of the way along, tapering to a point.
 *
 * Three vertices per ring with the middle lifted gives the midrib and the fold
 * either side of it, which is what stops it reading as a flat cut-out.
 */
function pushLeaf(target, rng, origin, dir, up, length, width) {
  const base = target.position.length / 3;

  // Frame: `dir` runs along the leaf, `side` across it, `lift` off its face.
  const side = new THREE.Vector3().crossVectors(dir, up).normalize();
  if (side.lengthSq() < 0.001) side.set(1, 0, 0);
  const lift = new THREE.Vector3().crossVectors(side, dir).normalize();

  // Leaves droop under their own weight rather than sticking out straight.
  const droop = rng.range(0.15, 0.5);
  const shade = rng.range(0.78, 1.12);
  const warm = rng.range(-0.05, 0.08);

  const p = new THREE.Vector3();
  for (let s = 0; s <= LEAF_SEGMENTS; s++) {
    const t = s / LEAF_SEGMENTS;
    // Widest at ~a third along, pinched at both ends.
    const profile = Math.sin(Math.pow(t, 0.62) * Math.PI) * (1 - t * 0.25);
    const halfW = (width * 0.5) * profile;
    const rise = halfW * 0.55;                       // midrib height

    p.copy(origin)
      .addScaledVector(dir, length * t)
      .addScaledVector(up, -droop * length * t * t);

    const offsets = [-halfW, 0, halfW];
    for (let k = 0; k < 3; k++) {
      const o = offsets[k];
      const vx = p.x + side.x * o + (k === 1 ? lift.x * rise : 0);
      const vy = p.y + side.y * o + (k === 1 ? lift.y * rise : 0);
      const vz = p.z + side.z * o + (k === 1 ? lift.z * rise : 0);
      target.position.push(vx, vy, vz);

      // Face normal tilted out at the folded edges — then biased hard towards
      // the sky. Leaves point every which way, and lit by their true normals the
      // half facing away from the sun goes black, because there's no bounce light
      // in the scene to fill them. Weighting the normal upwards is the standard
      // foliage cheat: the canopy lights as a mass, with enough of the real
      // normal left to keep individual leaves readable.
      const tilt = k === 1 ? 0 : Math.sign(o) * 0.3;
      const fx = lift.x + side.x * tilt;
      const fy = lift.y + side.y * tilt;
      const fz = lift.z + side.z * tilt;
      const nx = fx * 0.35;
      const ny = Math.abs(fy) * 0.35 + 0.72;
      const nz = fz * 0.35;
      const len = Math.hypot(nx, ny, nz) || 1;
      target.normal.push(nx / len, ny / len, nz / len);

      // Darker at the stalk, where a leaf sits inside the canopy.
      const bright = (0.86 + t * 0.34) * shade;
      target.color.push(bright * (1 + warm), bright, bright * (1 - warm * 0.6));
    }
  }

  for (let s = 0; s < LEAF_SEGMENTS; s++) {
    const a = base + s * 3;
    const b = a + 3;
    target.index.push(a, b, a + 1, a + 1, b, b + 1);
    target.index.push(a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
  }
}

/** A woody stem along a path, tapering as it goes. */
function stemGeometry(points, radius) {
  const curve = new THREE.CatmullRomCurve3(points);
  const geo = new THREE.TubeGeometry(curve, points.length * 2, radius, 5, false);
  // Taper by hand: TubeGeometry has one radius, and a stem that doesn't thin out
  // towards the tip looks like plumbing.
  const pos = geo.attributes.position;
  const centre = new THREE.Vector3();
  const v = new THREE.Vector3();
  const rings = points.length * 2 + 1;
  const perRing = 6;
  for (let r = 0; r < rings; r++) {
    const t = r / (rings - 1);
    curve.getPointAt(Math.min(1, t), centre);
    const k = 1 - t * 0.75;
    for (let j = 0; j <= perRing; j++) {
      const i = r * (perRing + 1) + j;
      if (i >= pos.count) break;
      v.fromBufferAttribute(pos, i).sub(centre).multiplyScalar(k).add(centre);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

export const BUSH_PROFILES = {
  // Broad, leafy, garden-hedge shape.
  leafy:  { height: [0.75, 1.15], stems: [5, 7], forks: 2, leaves: [10, 16], leafLen: [0.075, 0.125], leafW: [0.045, 0.075], colour: 0x8fae5c },
  // Sparser and twiggier, more visible structure.
  twiggy: { height: [0.65, 1.0],  stems: [6, 9], forks: 2, leaves: [6, 11],  leafLen: [0.055, 0.095], leafW: [0.03, 0.05],  colour: 0x99ab64 },
  // Low, wide and dense — the kind you push through.
  low:    { height: [0.45, 0.7],  stems: [7, 10], forks: 1, leaves: [9, 14], leafLen: [0.06, 0.10],  leafW: [0.04, 0.062], colour: 0x82a154 },
};

const sharedMats = new Map();

function materialsFor(species, colour) {
  if (sharedMats.has(species)) return sharedMats.get(species);
  const leaf = new THREE.MeshStandardMaterial({
    color: colour,
    roughness: 0.92,
    metalness: 0,
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  const stem = surfaceMaterial('bark', {
    repeat: 3, roughness: 0.95, seed: species.length + 2, normalScale: 0.9,
  });
  const set = { leaf, stem };
  sharedMats.set(species, set);
  return set;
}

/** Grows one bush, origin at the base. */
export function makeBush(rng, species = 'leafy') {
  const profile = BUSH_PROFILES[species] ?? BUSH_PROFILES.leafy;
  const height = rng.range(profile.height[0], profile.height[1]);

  const stems = [];
  const leaves = { position: [], normal: [], color: [], index: [] };
  const up = new THREE.Vector3(0, 1, 0);

  /** Leaves along the last stretch of a twig, spiralling round it. */
  const dressTwig = (from, to, count) => {
    const along = new THREE.Vector3().subVectors(to, from);
    const len = along.length();
    if (len < 0.001) return;
    along.normalize();

    for (let i = 0; i < count; i++) {
      const t = rng.range(0.15, 1.0);
      const at = new THREE.Vector3().copy(from).addScaledVector(along, len * t);
      // Fan out around the twig, angled away from it and tilted up to the light.
      const a = rng.range(0, Math.PI * 2);
      const outward = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const dir = outward.multiplyScalar(rng.range(0.6, 1.0))
        .addScaledVector(up, rng.range(0.15, 0.75))
        .normalize();
      pushLeaf(leaves, rng, at, dir, up,
        rng.range(profile.leafLen[0], profile.leafLen[1]),
        rng.range(profile.leafW[0], profile.leafW[1]));
    }
  };

  const growStem = (from, dir, len, radius, depth) => {
    const pts = [from.clone()];
    const cur = from.clone();
    const step = dir.clone();
    const segs = 3;
    for (let i = 0; i < segs; i++) {
      step.y += 0.18;                       // stems arch upward
      step.normalize();
      cur.addScaledVector(step, len / segs);
      cur.x += rng.range(-0.06, 0.06) * len;
      cur.z += rng.range(-0.06, 0.06) * len;
      pts.push(cur.clone());
    }
    stems.push(stemGeometry(pts, radius));

    const tip = pts[pts.length - 1];
    if (depth < profile.forks) {
      const kids = rng.int(2, 3);
      for (let k = 0; k < kids; k++) {
        const a = rng.range(0, Math.PI * 2);
        const spread = rng.range(0.5, 1.0);
        const kidDir = new THREE.Vector3(Math.cos(a) * spread, rng.range(0.5, 1.0), Math.sin(a) * spread).normalize();
        growStem(pts[pts.length - 2], kidDir, len * rng.range(0.55, 0.78), radius * 0.62, depth + 1);
      }
      // A few leaves on the woody part too, so the inside isn't bare.
      dressTwig(pts[1], tip, Math.round(rng.int(profile.leaves[0], profile.leaves[1]) * 0.35));
    } else {
      dressTwig(pts[0], tip, rng.int(profile.leaves[0], profile.leaves[1]));
    }
  };

  const count = rng.int(profile.stems[0], profile.stems[1]);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rng.range(-0.4, 0.4);
    const spread = rng.range(0.25, 0.6);
    const dir = new THREE.Vector3(Math.cos(a) * spread, 1, Math.sin(a) * spread).normalize();
    const from = new THREE.Vector3(Math.cos(a) * rng.range(0, 0.05), 0, Math.sin(a) * rng.range(0, 0.05));
    growStem(from, dir, height * rng.range(0.45, 0.62), height * 0.030, 0);
  }

  const mats = materialsFor(species, profile.colour);
  const group = new THREE.Group();

  const stemMesh = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(stems, false), mats.stem);
  stemMesh.castShadow = true;
  stemMesh.receiveShadow = true;
  group.add(stemMesh);

  const leafGeo = new THREE.BufferGeometry();
  leafGeo.setAttribute('position', new THREE.Float32BufferAttribute(leaves.position, 3));
  leafGeo.setAttribute('normal', new THREE.Float32BufferAttribute(leaves.normal, 3));
  leafGeo.setAttribute('color', new THREE.Float32BufferAttribute(leaves.color, 3));
  leafGeo.setIndex(leaves.index);
  leafGeo.computeBoundingSphere();

  const leafMesh = new THREE.Mesh(leafGeo, mats.leaf);
  leafMesh.castShadow = true;
  // Leaves cast but don't receive. They're a few millimetres thick and the sun's
  // shadow map uses a 2.2cm normal bias, so the depth lookup misses the leaf and
  // returns "in shadow" for every one of them — a bush that renders as a black
  // blob. The stems, being solid, still take shadows normally.
  leafMesh.receiveShadow = false;
  // The registry re-applies shadow flags to everything it hands out; this opts
  // the leaves out of that.
  leafMesh.userData.noReceiveShadow = true;
  group.add(leafMesh);

  return group;
}
