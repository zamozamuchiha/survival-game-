import * as THREE from 'three';

// Shared leaf builder, used by both bushes and trees so the vegetation is made
// of the same parts throughout.
//
// A leaf is a strip whose width follows a leaf profile — narrow at the stalk,
// widest a third of the way along, tapering to a point — with three vertices per
// ring and the middle one lifted. That gives it a midrib and a fold either side,
// which is what stops it reading as a flat cut-out.

export const LEAF_SEGMENTS = 3;

/** An empty accumulator for leaf geometry. */
export const leafBuffer = () => ({ position: [], normal: [], color: [], index: [] });

/**
 * Appends one leaf.
 *
 * @param target  buffer from leafBuffer()
 * @param origin  where the stalk attaches
 * @param dir     direction the leaf runs in
 * @param up      world up, for the droop and the normal bias
 */
export function pushLeaf(target, rng, origin, dir, up, length, width) {
  const base = target.position.length / 3;

  const side = new THREE.Vector3().crossVectors(dir, up).normalize();
  if (side.lengthSq() < 0.001) side.set(1, 0, 0);
  const lift = new THREE.Vector3().crossVectors(side, dir).normalize();

  const droop = rng.range(0.15, 0.5);
  const shade = rng.range(0.78, 1.12);
  const warm = rng.range(-0.05, 0.08);

  const p = new THREE.Vector3();
  for (let s = 0; s <= LEAF_SEGMENTS; s++) {
    const t = s / LEAF_SEGMENTS;
    const profile = Math.sin(Math.pow(t, 0.62) * Math.PI) * (1 - t * 0.25);
    const halfW = (width * 0.5) * profile;
    const rise = halfW * 0.55;

    p.copy(origin)
      .addScaledVector(dir, length * t)
      .addScaledVector(up, -droop * length * t * t);

    const offsets = [-halfW, 0, halfW];
    for (let k = 0; k < 3; k++) {
      const o = offsets[k];
      target.position.push(
        p.x + side.x * o + (k === 1 ? lift.x * rise : 0),
        p.y + side.y * o + (k === 1 ? lift.y * rise : 0),
        p.z + side.z * o + (k === 1 ? lift.z * rise : 0));

      // Face normal, tilted out at the folds, then biased hard towards the sky.
      // Leaves point every which way and the scene has no bounce light, so lit by
      // their true normals half of them go black. Weighting upwards lights the
      // canopy as a mass while leaving enough real normal to read single leaves.
      const tilt = k === 1 ? 0 : Math.sign(o) * 0.3;
      const fx = lift.x + side.x * tilt;
      const fy = lift.y + side.y * tilt;
      const fz = lift.z + side.z * tilt;
      const nx = fx * 0.35;
      const ny = Math.abs(fy) * 0.35 + 0.72;
      const nz = fz * 0.35;
      const len = Math.hypot(nx, ny, nz) || 1;
      target.normal.push(nx / len, ny / len, nz / len);

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

/** Turns a leaf buffer into geometry. */
export function leafGeometry(target) {
  if (!target.position.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(target.position, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(target.normal, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(target.color, 3));
  geo.setIndex(target.index);
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Scatters leaves around a point, fanning out and tilting up to the light.
 * Used for the sprays at the ends of twigs and branches.
 */
export function leafSpray(target, rng, at, up, count, lengthRange, widthRange, spread = 1) {
  for (let i = 0; i < count; i++) {
    const a = rng.range(0, Math.PI * 2);
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a))
      .multiplyScalar(rng.range(0.6, 1.0) * spread)
      .addScaledVector(up, rng.range(0.05, 0.8))
      .normalize();
    // Stalks start close together so the leaves fan out from a common point and
    // overlap; scattering the origins as well leaves visible holes.
    const from = new THREE.Vector3(
      at.x + rng.range(-0.12, 0.12) * lengthRange[1],
      at.y + rng.range(-0.15, 0.15) * lengthRange[1],
      at.z + rng.range(-0.12, 0.12) * lengthRange[1]);
    pushLeaf(target, rng, from, dir, up,
      rng.range(lengthRange[0], lengthRange[1]),
      rng.range(widthRange[0], widthRange[1]));
  }
}
