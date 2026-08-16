import * as THREE from 'three';
import { rollContainer } from '../data/loot.js';
import { getModel, fitHeight } from './models.js';

const mat = (c, rough = 0.9) =>
  new THREE.MeshStandardMaterial({ color: c, roughness: rough, flatShading: true });

// `model`/`openModel` swap the whole mesh when searched, which reads far better
// than hinging a lid we don't control the pivot of.
const KINDS = {
  crate:  { name: 'Wooden Crate', time: 2.2, radius: 0.55, height: 0.8,
            model: 'crate', openModel: 'crate_open' },
  locker: { name: 'Metal Barrel', time: 3.2, radius: 0.5, height: 1.1,
            model: 'barrel', openModel: 'barrel_open' },
  duffel: { name: 'Supply Chest', time: 1.9, radius: 0.55, height: 0.7,
            model: 'chest', openModel: 'chest' },
  case:   { name: 'Supply Case',  time: 4.0, radius: 0.75, height: 1.0,
            model: 'crate_big', openModel: 'crate_big_open' },
};

function buildCrate() {
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.9), mat(0x8a6a42));
  box.position.y = 0.35;
  g.add(box);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.12, 0.96), mat(0x6f5334));
  lid.position.y = 0.74;
  g.add(lid);
  g.userData.lid = lid;
  return g;
}

function buildLocker() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.6, 0.5), mat(0x53707a));
  body.position.y = 0.8;
  g.add(body);
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.66, 1.5, 0.06), mat(0x44606a));
  door.position.set(0, 0.8, 0.27);
  g.add(door);
  g.userData.lid = door;
  return g;
}

function buildDuffel() {
  const g = new THREE.Group();
  const bag = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.7, 3, 8), mat(0x4c5241));
  bag.rotation.z = Math.PI / 2;
  bag.position.y = 0.3;
  g.add(bag);
  g.userData.lid = bag;
  return g;
}

function buildCase() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, 0.8), mat(0x3f5546));
  body.position.y = 0.25;
  g.add(body);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.16, 0.84), mat(0x33463a));
  lid.position.y = 0.56;
  g.add(lid);
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0xd8a03a, emissive: 0xd8a03a, emissiveIntensity: 2 }));
  light.position.set(0.4, 0.62, 0);
  g.add(light);
  g.userData.lid = lid;
  return g;
}

const BUILDERS = { crate: buildCrate, locker: buildLocker, duffel: buildDuffel, case: buildCase };

export class Container {
  constructor(kind, position, lootTable, rng) {
    this.kind = 'container';
    this.type = kind;
    this.def = KINDS[kind];
    this.radius = this.def.radius;
    this.searchTime = this.def.time;
    this.progress = 0;
    this.opened = false;
    this.contents = rollContainer(lootTable, rng);

    this.mesh = new THREE.Group();
    this.mesh.position.copy(position);
    this.mesh.rotation.y = rng.range(0, Math.PI * 2);
    this.setVisual(this.def.model);
  }

  /** Swaps in a model, falling back to the primitive build if it's unavailable. */
  setVisual(modelKey) {
    this.mesh.clear();
    const m = modelKey && getModel(modelKey);
    if (m) {
      fitHeight(m, this.def.height);
      this.mesh.add(m);
    } else {
      this.mesh.add(BUILDERS[this.type]());
    }
    this.mesh.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
  }

  get position() { return this.mesh.position; }
  get empty() { return this.contents.length === 0; }
  get label() { return this.opened ? (this.empty ? null : 'Take') : 'Search'; }

  /** Call every frame E is held nearby. Returns contents once the bar fills. */
  search(dt) {
    if (this.opened) return this.empty ? null : this.takeAll();
    this.progress += dt;
    if (this.progress < this.searchTime) return null;
    this.opened = true;
    this.setVisual(this.def.openModel);
    return this.takeAll();
  }

  takeAll() {
    const out = this.contents;
    this.contents = [];
    return out;
  }

  /** Anything that didn't fit in the player's bag goes back in. */
  putBack(items) { this.contents = items; }

  cancel() { if (!this.opened) this.progress = 0; }
}

export function scatterContainers(scene, rng, count, lootTable, worldRadius, avoid) {
  const list = [];
  const kinds = lootTable === 'green' ? ['crate', 'duffel']
    : lootTable === 'yellow' ? ['crate', 'locker', 'duffel']
    : ['locker', 'case', 'crate', 'duffel'];

  let guard = 0;
  while (list.length < count && guard++ < count * 60) {
    const a = rng.range(0, Math.PI * 2);
    const d = Math.sqrt(rng()) * worldRadius;
    const pos = new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d);
    if (pos.length() < 8) continue;
    if (avoid.some((o) => o.position.distanceTo(pos) < 2.4)) continue;
    if (list.some((c) => c.position.distanceTo(pos) < 4)) continue;
    list.push(new Container(rng.pick(kinds), pos, lootTable, rng));
  }
  list.forEach((c) => scene.add(c.mesh));
  return list;
}
