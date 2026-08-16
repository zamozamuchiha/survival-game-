import * as THREE from 'three';
import { surfaceMaterial } from '../textures.js';

// Ground litter: fallen twigs and dry leaves.
//
// Small, cheap, and scattered thinly. Their job is to break up the grass mat so
// the floor reads as woodland rather than as a mown lawn — anything more
// elaborate would be detail nobody sees from the camera height.

const sharedMats = new Map();

function litterMaterial(kind) {
  if (sharedMats.has(kind)) return sharedMats.get(kind);
  const mat = kind === 'leaf'
    ? new THREE.MeshStandardMaterial({
      color: 0x8a7340, roughness: 0.95, metalness: 0, side: THREE.DoubleSide,
    })
    : surfaceMaterial('bark', { repeat: 2.5, roughness: 0.95, seed: 4, normalScale: 0.8 });
  sharedMats.set(kind, mat);
  return mat;
}

/** A twig: a thin bent stick, sometimes with one small fork. */
export function makeTwig(rng) {
  const group = new THREE.Group();
  const mat = litterMaterial('twig');

  const build = (length, radius, bend) => {
    const pts = [];
    const steps = 5;
    let x = 0;
    let y = 0;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      x += length / steps;
      y += bend * (t - 0.5) * length * 0.25;
      pts.push(new THREE.Vector3(x, radius + y, rng.range(-0.02, 0.02) * length));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    // Five sides is plenty at this size and keeps a field of litter cheap.
    const geo = new THREE.TubeGeometry(curve, 6, radius, 5, false);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };

  const len = rng.range(0.35, 0.75);
  const rad = len * rng.range(0.020, 0.035);
  group.add(build(len, rad, rng.range(-1, 1)));

  if (rng.chance(0.5)) {
    const fork = build(len * rng.range(0.3, 0.5), rad * 0.7, rng.range(-1, 1));
    fork.position.set(len * rng.range(0.4, 0.7), 0, 0);
    fork.rotation.y = rng.range(0.5, 1.2) * (rng.chance(0.5) ? 1 : -1);
    group.add(fork);
  }
  group.rotation.y = rng.range(0, Math.PI * 2);
  return group;
}

/** A few dry leaves lying flat, curled at the edges. */
export function makeLeafLitter(rng) {
  const group = new THREE.Group();
  const mat = litterMaterial('leaf');
  const count = rng.int(3, 6);

  for (let i = 0; i < count; i++) {
    const w = rng.range(0.07, 0.13);
    const l = w * rng.range(1.3, 1.9);
    const geo = new THREE.PlaneGeometry(w, l, 1, 2);
    // Curl: lift the ends so a leaf doesn't lie perfectly flat on the ground.
    const pos = geo.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const t = Math.abs(pos.getY(v)) / (l / 2);
      pos.setZ(v, t * t * w * rng.range(0.25, 0.6));
    }
    geo.computeVertexNormals();

    const leaf = new THREE.Mesh(geo, mat);
    leaf.rotation.x = -Math.PI / 2 + rng.range(-0.25, 0.25);
    leaf.rotation.z = rng.range(0, Math.PI * 2);
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(0, 0.16);
    leaf.position.set(Math.cos(a) * d, 0.006 + i * 0.004, Math.sin(a) * d);
    leaf.receiveShadow = true;
    group.add(leaf);
  }
  return group;
}
