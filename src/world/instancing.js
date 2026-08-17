import * as THREE from 'three';
import { quality } from '../core/quality.js';

// Collapses an instance to a point — cheaper than rebuilding the mesh without it.
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
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
    this.placed = new Map();   // placement id -> [{ im, i, m }] after build()
    this.nextId = 1;
  }

  /**
   * Takes one placement out of the crowd, or puts it back.
   *
   * Scaling an instance to nothing collapses its triangles to a point, which
   * costs a matrix upload rather than a rebuild. Used to swap a distant
   * instanced tree for a real one the moment the player is close enough to
   * swing at it, and to swap it back when they walk away.
   */
  setVisible(pid, visible) {
    const slots = this.placed.get(pid);
    if (!slots) return false;
    for (const s of slots) {
      s.im.setMatrixAt(s.i, visible ? s.m : ZERO);
      s.im.instanceMatrix.needsUpdate = true;
    }
    return true;
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
    // Every placement gets an id so a caller can pull one instance out later —
    // that is how a tree standing in the crowd becomes a tree you can fell
    // without giving every tree on the map its own draw call.
    const pid = this.nextId++;

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
          pids: [],
          noReceiveShadow: part.noReceiveShadow,
        };
        this.groups.set(id, g);
      }
      g.matrices.push(new THREE.Matrix4().multiplyMatrices(placement, part.local));
      g.pids.push(pid);
    });
    return pid;
  }

  /**
   * Builds the InstancedMeshes, split into spatial blocks.
   *
   * One batch per model spread over the whole map has map-sized bounds, so the
   * only options are to draw all of it or none of it — which is why this used to
   * disable frustum culling entirely and pay for every tree behind the camera.
   *
   * Chopping each batch into BLOCK-metre tiles gives every mesh bounds the
   * culler can actually use. It costs more draw calls in principle, but only the
   * blocks in view are submitted, and with a camera that sees a fraction of the
   * map that is a large net win.
   */
  build({ block = 26 } = {}) {
    const root = new THREE.Group();
    const pos = new THREE.Vector3();

    for (const [id, g] of this.groups) {
      if (!g.matrices.length) continue;

      // Bucket this group's instances by which tile their origin falls in.
      const tiles = new Map();
      g.matrices.forEach((m, mi) => {
        pos.setFromMatrixPosition(m);
        const key = `${Math.floor(pos.x / block)},${Math.floor(pos.z / block)}`;
        if (!tiles.has(key)) tiles.set(key, []);
        tiles.get(key).push({ m, pid: g.pids[mi] });
      });

      for (const list of tiles.values()) {
        const im = new THREE.InstancedMesh(g.geometry, g.material, list.length);
        list.forEach((entry, i) => {
          im.setMatrixAt(i, entry.m);
          let slots = this.placed.get(entry.pid);
          if (!slots) { slots = []; this.placed.set(entry.pid, slots); }
          slots.push({ im, i, m: entry.m });
        });
        im.instanceMatrix.needsUpdate = true;
        // 2.4M triangles of trees and rocks go through the shadow pass every
        // frame when this is on. It is the largest single cost in the renderer,
        // so the low setting drops it and keeps shadows for what the player
        // built and for anything that moves.
        im.castShadow = quality().sceneryShadows;
        // Thin foliage renders black if it takes shadows — see procgen/bushes.js.
        im.receiveShadow = !g.noReceiveShadow;
        im.frustumCulled = true;
        // three's own bounds ignore instance transforms on some paths; deriving
        // the sphere from the instance positions keeps the culler honest.
        im.computeBoundingSphere();
        root.add(im);
      }
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
