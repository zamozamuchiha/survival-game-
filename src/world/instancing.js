import * as THREE from 'three';
import { getParts } from './models.js';

/**
 * Batches repeated static props into InstancedMeshes.
 *
 * Scenery is the same handful of models placed hundreds of times, so drawing
 * each one individually costs ~1000 draw calls per frame — and twice that once
 * the shadow pass runs. Instancing collapses that to one call per distinct
 * (geometry, material) pair: roughly 20 for a whole location.
 */
export class InstanceBatch {
  constructor() {
    this.groups = new Map();   // "key#partIndex" -> { geometry, material, matrices }
  }

  /**
   * Queues one placement.
   * @param key    model registry key
   * @param size   desired world size in metres
   * @param pos    THREE.Vector3 ground position
   * @param yaw    rotation about Y
   * @param fit    'height' (default) or 'span' — measure size against the model's
   *               height or its longest side. Flat litter needs 'span', or a
   *               10cm-tall twig gets scaled up until it's a fallen tree.
   */
  add(key, size, pos, yaw = 0, fit = 'height') {
    const info = getParts(key);
    if (!info || !info.parts.length) return false;

    const s = size / (fit === 'span' ? info.span : info.height);
    const placement = new THREE.Matrix4().compose(
      new THREE.Vector3(pos.x, pos.y - info.minY * s, pos.z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
      new THREE.Vector3(s, s, s));

    info.parts.forEach((part, i) => {
      const id = `${key}#${i}`;
      let g = this.groups.get(id);
      if (!g) {
        g = {
          geometry: part.geometry,
          material: part.material,
          matrices: [],
          noReceiveShadow: part.noReceiveShadow,
        };
        this.groups.set(id, g);
      }
      g.matrices.push(new THREE.Matrix4().multiplyMatrices(placement, part.local));
    });
    return true;
  }

  /** Builds the InstancedMeshes. Call once, after every add(). */
  build() {
    const root = new THREE.Group();
    for (const g of this.groups.values()) {
      if (!g.matrices.length) continue;
      const im = new THREE.InstancedMesh(g.geometry, g.material, g.matrices.length);
      g.matrices.forEach((m, i) => im.setMatrixAt(i, m));
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = true;
      // Thin foliage renders black if it takes shadows — see procgen/bushes.js.
      im.receiveShadow = !g.noReceiveShadow;
      // Instances are spread across the whole map, so the batch's bounds are
      // effectively the map — culling it as one unit only ever costs us.
      im.frustumCulled = false;
      root.add(im);
    }
    return root;
  }

  get drawCalls() { return this.groups.size; }
}

/** Convenience for a single geometry+material repeated with arbitrary matrices. */
export function instanceOf(geometry, material, matrices) {
  const im = new THREE.InstancedMesh(geometry, material, matrices.length);
  matrices.forEach((m, i) => im.setMatrixAt(i, m));
  im.instanceMatrix.needsUpdate = true;
  im.castShadow = true;
  im.receiveShadow = true;
  return im;
}
