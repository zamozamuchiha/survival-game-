import * as THREE from 'three';
import { getModel, pickVariant } from './models.js';

// Loose material lying on the ground — branches and loose stones you pick up by
// hand. Without these the game opens on a deadlock: every tool needs wood and
// stone, and every tree and boulder wants a tool you don't have yet.
//
// These are deliberately not ResourceNodes. A node has to be hit, has health and
// respawns; a pickup is one press of E and it's gone.

const KINDS = {
  branches: {
    group: 'pickup_wood',
    label: 'Gather Branches',
    span: [0.7, 1.1],
    slimness: 0.45,
    drop: 'wood',
    amount: [2, 4],
  },
  stones: {
    group: 'pickup_stone',
    label: 'Gather Stones',
    span: [0.35, 0.6],
    drop: 'stone',
    amount: [1, 3],
  },
};

/**
 * Scales a model by its longest side, optionally thins it across the other two,
 * and drops it onto the ground.
 *
 * Sizing by height is wrong for these: a log lying on its side is low and long,
 * so forcing its height up to half a metre stretches it into a four-metre trunk.
 *
 * `slimness` narrows everything but the length. The kit's wood models are cut
 * logs — at full thickness a gatherable branch reads as a felled trunk, which is
 * exactly the thing the player shouldn't have to walk up to before knowing
 * whether it's loot or scenery.
 */
function fitSpan(model, target, slimness = 1) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z);
  if (longest > 0.001) model.scale.multiplyScalar(target / longest);
  if (slimness !== 1) {
    if (size.x < longest) model.scale.x *= slimness;
    if (size.y < longest) model.scale.y *= slimness;
    if (size.z < longest) model.scale.z *= slimness;
  }
  const settled = new THREE.Box3().setFromObject(model);
  model.position.y -= settled.min.y;
}

function makePickup(kind, spec, pos, rng) {
  const key = pickVariant(spec.group, rng);
  const model = key && getModel(key);
  if (!model) return null;

  const mesh = new THREE.Group();
  fitSpan(model, rng.range(spec.span[0], spec.span[1]), spec.slimness ?? 1);
  model.rotation.y = rng.range(0, Math.PI * 2);
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
  });
  mesh.add(model);
  mesh.position.set(pos.x, 0, pos.z);

  return {
    kind,
    mesh,
    label: spec.label,
    items: [{ id: spec.drop, n: rng.int(spec.amount[0], spec.amount[1]) }],
    radius: 0.35,
    get position() { return mesh.position; },
  };
}

/**
 * Scatters pickups across a location, keeping clear of the arrival area and of
 * anything already placed.
 *
 * @param counts  { branches: n, stones: n }
 * @param clear   radius around the origin to leave empty
 * @param avoid   already-placed objects to keep a little distance from
 */
export function scatterPickups(scene, rng, counts, radius, clear, avoid = []) {
  const out = [];
  const taken = avoid.map((o) => o.position);

  for (const [kind, count] of Object.entries(counts ?? {})) {
    const spec = KINDS[kind];
    if (!spec) continue;

    for (let i = 0; i < count; i++) {
      let pos = null;
      for (let tries = 0; tries < 24 && !pos; tries++) {
        const a = rng.range(0, Math.PI * 2);
        const d = Math.sqrt(rng()) * (radius - 2);
        const c = new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d);
        if (c.length() < clear) continue;
        if (taken.some((p) => p.distanceTo(c) < 1.6)) continue;
        pos = c;
      }
      if (!pos) continue;

      const item = makePickup(kind, spec, pos, rng);
      if (!item) continue;
      taken.push(item.position);
      scene.add(item.mesh);
      out.push(item);
    }
  }
  return out;
}
