import * as THREE from 'three';
import * as BufferGeometryUtils from '../../../vendor/utils/BufferGeometryUtils.js';
import { surfaceMaterial } from '../textures.js';

// Hand tools and weapons, built the way the real things are made: a shaft, a
// head, and something holding the two together.
//
// Every tool is modelled around the grip at the origin with the working end
// pointing down its local -Y, because that is how the character's hand slot
// expects to receive it. Nothing here knows about the player — the pieces are
// plain meshes that get parented to a hand bone.
//
// Materials are shared across all tools so a rack of them is a handful of draw
// calls, and each part is merged per material.

const sharedMats = new Map();

function materials() {
  if (sharedMats.size) return sharedMats;
  sharedMats.set('wood', surfaceMaterial('timber', {
    repeat: 3, roughness: 0.86, seed: 7, normalScale: 1.0,
  }));
  sharedMats.set('steel', surfaceMaterial('metal', {
    repeat: 2, roughness: 1, metalness: 0.85, seed: 11, normalScale: 1.2,
  }));
  sharedMats.set('iron', surfaceMaterial('metalRust', {
    repeat: 2, roughness: 1, metalness: 0.7, seed: 13, normalScale: 1.3,
  }));
  sharedMats.set('stone', surfaceMaterial('flint', {
    repeat: 2.5, roughness: 0.95, seed: 17, normalScale: 1.4,
  }));
  sharedMats.set('cord', new THREE.MeshStandardMaterial({
    color: 0x6b5a3e, roughness: 0.95, metalness: 0,
  }));
  sharedMats.set('leather', new THREE.MeshStandardMaterial({
    color: 0x4a3a2a, roughness: 0.88, metalness: 0,
  }));
  return sharedMats;
}

/** Collects geometry per material, then builds one mesh per material. */
function builder() {
  const parts = new Map();
  return {
    add(material, geo) {
      if (!parts.has(material)) parts.set(material, []);
      parts.get(material).push(geo);
      return this;
    },
    build() {
      const mats = materials();
      const group = new THREE.Group();
      for (const [name, list] of parts) {
        const merged = list.length === 1 ? list[0] : BufferGeometryUtils.mergeGeometries(list, false);
        if (!merged) continue;
        const mesh = new THREE.Mesh(merged, mats.get(name));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
      return group;
    },
  };
}

/**
 * A shaft: a slightly tapered, slightly bent rod.
 *
 * Real handles are never perfectly straight — they follow the grain of the wood
 * they were cut from. The bend is small enough that you read it as craft rather
 * than as damage.
 */
function shaft(rng, length, radius, opts = {}) {
  const bend = opts.bend ?? rng.range(0.006, 0.018);
  const taper = opts.taper ?? 0.82;
  const segments = 7;
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    pts.push(new THREE.Vector3(Math.sin(t * Math.PI) * bend * length, -length * t, 0));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const geo = new THREE.TubeGeometry(curve, segments * 2, radius, 8, false);

  // Taper towards the head end and swell slightly at the grip.
  const pos = geo.attributes.position;
  const centre = new THREE.Vector3();
  const v = new THREE.Vector3();
  const rings = segments * 2 + 1;
  const perRing = 9;
  for (let r = 0; r < rings; r++) {
    const t = r / (rings - 1);
    curve.getPointAt(Math.min(1, t), centre);
    const swell = 1 + Math.exp(-t * 9) * (opts.swell ?? 0.22);
    const k = (1 - t * (1 - taper)) * swell;
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

/** Cord or leather wrapped round the grip. */
function wrapping(rng, from, to, radius) {
  const turns = Math.max(3, Math.round((to - from) / 0.022));
  const parts = [];
  for (let i = 0; i < turns; i++) {
    const y = from + (to - from) * (i / (turns - 1 || 1));
    const geo = new THREE.TorusGeometry(radius * 1.06, radius * 0.17, 4, 9);
    geo.rotateX(Math.PI / 2);
    geo.rotateZ(rng.range(-0.12, 0.12));
    geo.translate(rng.range(-0.002, 0.002), -y, 0);
    parts.push(geo);
  }
  return parts;
}

/**
 * A blade or head: a wedge that thins to an edge.
 *
 * Built from a box whose vertices are pulled in along one face, so the edge is a
 * real thin line rather than a flat plane, and dented slightly so it catches
 * light unevenly the way beaten metal does.
 */
function wedge(rng, length, height, thickness, opts = {}) {
  const geo = new THREE.BoxGeometry(length, height, thickness, 4, 3, 1);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const edgeAt = opts.edgeAt ?? -length / 2;     // which end sharpens
  const sharp = opts.sharp ?? 0.12;

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // Distance from the cutting end, 0 at the edge, 1 at the back.
    const t = Math.min(1, Math.abs(v.x - edgeAt) / length);
    v.z *= sharp + (1 - sharp) * Math.pow(t, 0.65);
    // Curve the profile so the edge bellies out rather than running straight.
    v.y *= 1 - Math.pow(1 - t, 2) * (opts.belly ?? 0.25);
    // Forge dents.
    v.z += (rng() - 0.5) * thickness * 0.14;
    v.y += (rng() - 0.5) * height * 0.02;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------- the tools

/**
 * An axe. `head` picks the material and shape family: knapped stone is thick and
 * lashed on, forged iron is thinner with a proper eye and a poll behind it.
 */
export function makeAxe(rng, head = 'stone') {
  const b = builder();
  const stone = head === 'stone';
  const len = stone ? 0.62 : 0.74;
  const r = stone ? 0.019 : 0.017;

  b.add('wood', shaft(rng, len, r, { bend: rng.range(0.010, 0.022) }));
  for (const g of wrapping(rng, len * 0.02, len * 0.26, r)) b.add('leather', g);

  const mat = stone ? 'stone' : 'iron';
  const headY = -len + (stone ? 0.045 : 0.035);

  if (stone) {
    // Knapped blade, thick and asymmetric, lashed against the shaft.
    const blade = wedge(rng, 0.20, 0.135, 0.055, { sharp: 0.16, belly: 0.3 });
    blade.rotateZ(rng.range(-0.06, 0.06));
    blade.translate(-0.055, headY, 0);
    b.add(mat, blade);

    // The lashing that holds it — the whole point of a stone axe.
    for (let i = 0; i < 6; i++) {
      const cord = new THREE.TorusGeometry(0.030, 0.0045, 4, 10);
      cord.rotateY(Math.PI / 2);
      cord.rotateZ(rng.range(-0.3, 0.3));
      cord.translate(-0.012, headY + 0.03 - i * 0.014, 0);
      b.add('cord', cord);
    }
  } else {
    // Forged head: bit, eye and poll as separate masses.
    const bit = wedge(rng, 0.19, 0.115, 0.030, { sharp: 0.07, belly: 0.35 });
    bit.translate(-0.078, headY, 0);
    b.add(mat, bit);

    const eye = new THREE.CylinderGeometry(0.028, 0.026, 0.062, 8);
    eye.translate(0.002, headY, 0);
    b.add(mat, eye);

    const poll = new THREE.BoxGeometry(0.046, 0.058, 0.040);
    poll.translate(0.040, headY, 0);
    b.add(mat, poll);
  }
  return b.build();
}

/** A pickaxe: two opposed points on a central eye. */
export function makePickaxe(rng, head = 'stone') {
  const b = builder();
  const stone = head === 'stone';
  const len = stone ? 0.64 : 0.76;
  const r = stone ? 0.019 : 0.017;

  b.add('wood', shaft(rng, len, r, { bend: rng.range(0.008, 0.018) }));
  for (const g of wrapping(rng, len * 0.02, len * 0.24, r)) b.add('leather', g);

  const mat = stone ? 'stone' : 'iron';
  const headY = -len + 0.035;

  // Long point one side, shorter chisel the other.
  const point = wedge(rng, 0.24, 0.052, 0.048, { sharp: 0.10, belly: 0.15 });
  point.rotateZ(0.16);
  point.translate(-0.10, headY + 0.014, 0);
  b.add(mat, point);

  const chisel = wedge(rng, 0.15, 0.056, 0.046, { sharp: 0.18, belly: 0.1, edgeAt: 0.075 });
  chisel.rotateZ(-0.14);
  chisel.translate(0.072, headY + 0.010, 0);
  b.add(mat, chisel);

  const eye = new THREE.CylinderGeometry(0.026, 0.024, stone ? 0.070 : 0.058, 8);
  eye.translate(0, headY, 0);
  b.add(mat, eye);

  if (stone) {
    for (let i = 0; i < 5; i++) {
      const cord = new THREE.TorusGeometry(0.029, 0.0045, 4, 10);
      cord.rotateY(Math.PI / 2);
      cord.translate(0, headY + 0.024 - i * 0.013, 0);
      b.add('cord', cord);
    }
  }
  return b.build();
}

/** A crowbar: one bent, flattened bar with a split claw. */
export function makeCrowbar(rng) {
  const b = builder();
  const pts = [];
  const len = 0.68;
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    // Straight for most of its length, then hooks over at the end.
    const hook = t > 0.78 ? Math.pow((t - 0.78) / 0.22, 2) * 0.10 : 0;
    pts.push(new THREE.Vector3(hook, -len * t, 0));
  }
  const bar = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 18, 0.0135, 7, false);
  // Flatten it — a crowbar is oval in section, not round.
  const pos = bar.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setZ(i, pos.getZ(i) * 0.62);
  bar.computeVertexNormals();
  b.add('iron', bar);

  // Flattened, split prying end.
  const claw = wedge(rng, 0.075, 0.042, 0.020, { sharp: 0.10, belly: 0.2 });
  claw.rotateZ(-0.55);
  claw.translate(0.118, -len + 0.012, 0);
  b.add('iron', claw);

  // A chisel end at the grip end too.
  const tip = wedge(rng, 0.05, 0.032, 0.018, { sharp: 0.14 });
  tip.translate(-0.012, 0.014, 0);
  b.add('iron', tip);
  return b.build();
}

/** A spear: long shaft, lashed point. */
export function makeSpear(rng) {
  const b = builder();
  const len = 1.42;
  const r = 0.015;
  b.add('wood', shaft(rng, len, r, { bend: 0.006, taper: 0.9, swell: 0.1 }));
  for (const g of wrapping(rng, len * 0.30, len * 0.44, r)) b.add('cord', g);

  const point = wedge(rng, 0.20, 0.048, 0.026, { sharp: 0.08, belly: 0.15 });
  point.rotateZ(Math.PI / 2);
  point.translate(0, -len - 0.075, 0);
  b.add('stone', point);

  for (let i = 0; i < 5; i++) {
    const cord = new THREE.TorusGeometry(0.017, 0.004, 4, 9);
    cord.rotateX(Math.PI / 2);
    cord.translate(0, -len + 0.004 - i * 0.011, 0);
    b.add('cord', cord);
  }
  return b.build();
}

/** A nailed bat: turned club with nails driven through the business end. */
export function makeBat(rng) {
  const b = builder();
  const len = 0.78;
  // Thin at the grip, fat at the end — the opposite taper of a tool handle.
  const geo = shaft(rng, len, 0.020, { bend: 0.004, taper: 1.9, swell: 0.15 });
  b.add('wood', geo);
  for (const g of wrapping(rng, 0.01, 0.16, 0.021)) b.add('leather', g);

  // Nails, driven in at angles around the head.
  const nails = 9;
  for (let i = 0; i < nails; i++) {
    const y = -len * rng.range(0.58, 0.94);
    const a = (i / nails) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const shank = new THREE.CylinderGeometry(0.0028, 0.0022, 0.062, 5);
    shank.rotateZ(Math.PI / 2);
    shank.translate(0.030, 0, 0);
    shank.rotateY(a);
    shank.rotateX(rng.range(-0.2, 0.2));
    shank.translate(0, y, 0);
    b.add('steel', shank);
  }
  return b.build();
}

/** A machete: long single-edged blade, wrapped grip, small guard. */
export function makeMachete(rng) {
  const b = builder();
  const gripLen = 0.16;
  const grip = shaft(rng, gripLen, 0.016, { bend: 0.01, taper: 1.15, swell: 0.18 });
  b.add('wood', grip);
  for (const g of wrapping(rng, 0.015, gripLen - 0.02, 0.017)) b.add('cord', g);

  const guard = new THREE.BoxGeometry(0.052, 0.012, 0.026);
  guard.translate(0, -gripLen - 0.004, 0);
  b.add('steel', guard);

  // Blade widens towards the tip, the way a machete is weighted for chopping.
  const blade = wedge(rng, 0.40, 0.052, 0.008, { sharp: 0.05, belly: 0.32, edgeAt: 0.2 });
  blade.rotateZ(Math.PI / 2);
  blade.translate(0.004, -gripLen - 0.215, 0);
  b.add('steel', blade);
  return b.build();
}

/** A pistol: slide, frame, grip, trigger guard. */
export function makePistol(rng) {
  const b = builder();
  // Barrel runs along -Y like every other tool, so the hand slot needs no
  // special case for guns.
  const slide = new THREE.BoxGeometry(0.032, 0.175, 0.042);
  slide.translate(0, -0.075, 0.004);
  b.add('steel', slide);

  const frame = new THREE.BoxGeometry(0.028, 0.058, 0.036);
  frame.translate(0, -0.012, 0);
  b.add('steel', frame);

  const grip = new THREE.BoxGeometry(0.030, 0.105, 0.040);
  grip.rotateX(-0.24);
  grip.translate(0, 0.052, -0.016);
  b.add('wood', grip);

  const guard = new THREE.TorusGeometry(0.023, 0.005, 5, 10, Math.PI);
  guard.rotateY(Math.PI / 2);
  guard.rotateZ(Math.PI);
  guard.translate(0, 0.006, -0.004);
  b.add('steel', guard);
  return b.build();
}

/** A hunting rifle: barrel, receiver, wooden stock, scope. */
export function makeRifle(rng) {
  const b = builder();
  const barrel = new THREE.CylinderGeometry(0.010, 0.0115, 0.62, 8);
  barrel.translate(0, -0.34, 0.004);
  b.add('steel', barrel);

  const receiver = new THREE.BoxGeometry(0.036, 0.16, 0.052);
  receiver.translate(0, -0.02, 0);
  b.add('steel', receiver);

  // Stock and fore-end in wood, the two pieces a rifle is actually held by.
  const stock = new THREE.BoxGeometry(0.040, 0.30, 0.062);
  stock.rotateX(-0.06);
  stock.translate(0, 0.155, -0.008);
  b.add('wood', stock);

  const fore = new THREE.BoxGeometry(0.038, 0.24, 0.046);
  fore.translate(0, -0.20, -0.006);
  b.add('wood', fore);

  const scope = new THREE.CylinderGeometry(0.016, 0.016, 0.15, 8);
  scope.translate(0, -0.06, 0.048);
  b.add('steel', scope);

  for (const y of [-0.005, -0.115]) {
    const mount = new THREE.BoxGeometry(0.018, 0.014, 0.030);
    mount.translate(0, y, 0.034);
    b.add('steel', mount);
  }
  return b.build();
}

/**
 * An AK-74.
 *
 * Built around the grip at the origin like every other tool here, with the
 * muzzle down local -Y, so the hand slot carries it the same way it carries an
 * axe. The silhouette is what has to read at a glance: the long curved magazine
 * ahead of the trigger, the gas tube above the barrel, and the muzzle brake — a
 * shape nobody mistakes for the bolt-action hunting rifle already in the game.
 */
export function makeAK(rng) {
  const b = builder();

  // Barrel, gas block and the slotted brake at the end.
  const barrel = new THREE.CylinderGeometry(0.0085, 0.0095, 0.44, 8);
  barrel.translate(0, -0.30, 0.004);
  b.add('steel', barrel);

  const brake = new THREE.CylinderGeometry(0.016, 0.014, 0.075, 8);
  brake.translate(0, -0.545, 0.004);
  b.add('steel', brake);

  const gasTube = new THREE.CylinderGeometry(0.009, 0.009, 0.22, 6);
  gasTube.translate(0, -0.235, 0.026);
  b.add('steel', gasTube);

  const gasBlock = new THREE.BoxGeometry(0.020, 0.045, 0.034);
  gasBlock.translate(0, -0.35, 0.018);
  b.add('steel', gasBlock);

  // Receiver, the body everything hangs off.
  const receiver = new THREE.BoxGeometry(0.030, 0.20, 0.062);
  receiver.translate(0, -0.045, 0.002);
  b.add('steel', receiver);

  const dustCover = new THREE.BoxGeometry(0.032, 0.15, 0.020);
  dustCover.translate(0, -0.03, 0.036);
  b.add('steel', dustCover);

  // The curved magazine, in banana sections — the one silhouette everybody knows.
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const seg = new THREE.BoxGeometry(0.024, 0.048, 0.038 - t * 0.004);
    // Each section leans a little further forward than the last, which is the
    // curve. Stepping it beats bending a box and costs four extra faces.
    seg.rotateX(-0.13 * t);
    seg.translate(0, -0.135 - t * 0.045, -0.030 - t * 0.030);
    b.add('iron', seg);
  }

  // Furniture. Wood on a 74 is usually laminate or polymer, but a warm brown
  // reads better against the grey than another slab of grey would.
  const fore = new THREE.BoxGeometry(0.034, 0.17, 0.042);
  fore.translate(0, -0.20, -0.010);
  b.add('wood', fore);

  const upperHand = new THREE.BoxGeometry(0.026, 0.13, 0.028);
  upperHand.translate(0, -0.225, 0.030);
  b.add('wood', upperHand);

  const grip = new THREE.BoxGeometry(0.028, 0.095, 0.034);
  grip.rotateX(0.30);
  grip.translate(0, 0.045, -0.028);
  b.add('wood', grip);

  const stock = new THREE.BoxGeometry(0.032, 0.26, 0.050);
  stock.rotateX(-0.04);
  stock.translate(0, 0.185, -0.014);
  b.add('wood', stock);

  // Sights: rear notch on the receiver, front post on the gas block.
  const rear = new THREE.BoxGeometry(0.016, 0.012, 0.022);
  rear.translate(0, -0.125, 0.048);
  b.add('steel', rear);
  const front = new THREE.CylinderGeometry(0.005, 0.006, 0.038, 6);
  front.translate(0, -0.355, 0.042);
  b.add('steel', front);

  const trigger = new THREE.BoxGeometry(0.008, 0.026, 0.010);
  trigger.rotateX(0.2);
  trigger.translate(0, -0.012, -0.014);
  b.add('steel', trigger);

  return b.build();
}
