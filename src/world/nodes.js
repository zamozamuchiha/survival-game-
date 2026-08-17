import * as THREE from 'three';
import { getModel, pickVariant, fitHeight } from './models.js';
import { harvestDef } from '../data/harvest.js';

// Physical shape and wording per node type. Everything about how hard it is to
// break, what it pays and how it dies lives in data/harvest.js — this file only
// knows how to build one and how to play its reactions.
export const NODE_TYPES = {
  tree:  { label: 'Chop',    radius: 0.8 },
  bush:  { label: 'Gather',  radius: 0.55 },
  rock:  { label: 'Mine',    radius: 0.9 },
  iron:  { label: 'Mine',    radius: 0.9 },
  wreck: { label: 'Salvage', radius: 1.5 },
};

/** Rolls a yield table into concrete drops. */
export function rollYield(table, rng) {
  const out = [];
  for (const y of table ?? []) {
    const n = rng.int(y.min, y.max);
    if (n > 0) out.push({ id: y.id, n });
  }
  return out;
}

const fallbackMat = (c) =>
  new THREE.MeshStandardMaterial({ color: c, roughness: 0.95, flatShading: true });

/** Last-resort stand-in if a model failed to load, so the world is never empty. */
function fallback(type, rng) {
  const g = new THREE.Group();
  const colors = { tree: 0x3f5c34, bush: 0x4a6b3a, rock: 0x6b6f73, iron: 0x7a6a55, wreck: 0x7a3b30 };
  const h = type === 'tree' ? 3.4 : type === 'wreck' ? 1.5 : 1.1;
  const box = new THREE.Mesh(new THREE.BoxGeometry(1, h, 1), fallbackMat(colors[type] ?? 0x888888));
  box.position.y = h / 2;
  g.add(box);
  return g;
}

/** Rusts a car so it reads as a wreck rather than a parked vehicle. */
function rustify(model, rng) {
  model.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    o.material = o.material.clone();
    if (o.material.color) {
      o.material.color.multiplyScalar(rng.range(0.42, 0.62));
      o.material.color.offsetHSL(rng.range(-0.03, 0.01), -0.12, 0);
    }
    o.material.roughness = 1;
    o.material.metalness = 0;
  });
}

function buildMesh(type, rng, biome) {
  const holder = new THREE.Group();
  let model = null;

  switch (type) {
    case 'tree': {
      const key = pickVariant(biome.trees ?? 'tree_forest', rng);
      model = key && getModel(key);
      if (model) fitHeight(model, rng.range(3.0, 4.8));
      break;
    }
    case 'bush': {
      const key = pickVariant('bush', rng);
      model = key && getModel(key);
      if (model) fitHeight(model, rng.range(0.6, 1.0));
      break;
    }
    case 'rock': {
      const key = pickVariant('rock', rng);
      model = key && getModel(key);
      if (model) fitHeight(model, rng.range(0.9, 1.7));
      break;
    }
    case 'iron': {
      const key = pickVariant('ore', rng);
      model = key && getModel(key);
      if (model) {
        fitHeight(model, rng.range(1.1, 1.8));
        // Ore veins so a metal node reads differently from plain stone.
        const veinMat = new THREE.MeshStandardMaterial({
          color: 0xc87a2e, emissive: 0x5a2c08, emissiveIntensity: 0.7, roughness: 0.5, flatShading: true,
        });
        for (let i = 0; i < 6; i++) {
          const v = new THREE.Mesh(new THREE.IcosahedronGeometry(rng.range(0.09, 0.16), 0), veinMat);
          const a = rng.range(0, Math.PI * 2);
          v.position.set(Math.cos(a) * rng.range(0.2, 0.5), rng.range(0.25, 1.1), Math.sin(a) * rng.range(0.2, 0.5));
          v.castShadow = true;
          holder.add(v);
        }
      }
      break;
    }
    case 'wreck': {
      const key = pickVariant('wreck', rng);
      model = key && getModel(key);
      if (model) {
        fitHeight(model, rng.range(1.35, 1.7));
        rustify(model, rng);
        model.rotation.z = rng.range(-0.06, 0.06);   // settled unevenly
        model.rotation.x = rng.range(-0.04, 0.04);
      }
      break;
    }
  }

  if (!model) return fallback(type, rng);
  model.rotation.y += rng.range(0, Math.PI * 2);
  holder.add(model);
  return holder;
}

export class ResourceNode {
  constructor(type, position, rng, biome) {
    this.kind = 'node';
    this.type = type;
    this.shape = NODE_TYPES[type];
    this.def = harvestDef(type) ?? {};
    this.maxHp = this.def.maxHp ?? 4;
    this.hp = this.maxHp;
    this.radius = this.shape.radius;
    this.respawnIn = 0;
    this.shake = 0;
    this.dying = null;         // running death animation, see beginDeath()

    this.mesh = buildMesh(type, rng, biome);
    this.mesh.position.copy(position);
    this.baseQuat = this.mesh.quaternion.clone();
    this.mesh.traverse((o) => {
      o.castShadow = true;
      // Thin foliage opts out of receiving — see procgen/bushes.js.
      o.receiveShadow = !o.userData.noReceiveShadow;
    });

    // A felled tree leaves the stump behind so the spot still reads as a tree
    // you cut, not as ground that never had one.
    if (type === 'tree') {
      const stump = getModel('stump');
      if (stump) {
        fitHeight(stump, 0.45);
        stump.rotation.y = rng.range(0, Math.PI * 2);
        stump.visible = false;
        stump.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        stump.position.copy(position);
        // Set into the ground rather than stood on it. fitHeight puts the flare's
        // rim exactly on y=0, and the terrain is not perfectly flat, so anything
        // shallower leaves the rim hanging over a dip with daylight under it.
        // A real stump is buried to its root collar anyway.
        stump.position.y -= 0.16;
        this.stump = stump;
      }
    }
  }

  /** Adds the node's meshes to a scene. The stump is a sibling, not a child —
   *  it has to stay upright while the trunk goes over. */
  addTo(scene) {
    scene.add(this.mesh);
    if (this.stump) scene.add(this.stump);
  }

  removeFrom(scene) {
    scene.remove(this.mesh);
    if (this.stump) scene.remove(this.stump);
  }

  get alive() { return this.hp > 0; }
  get position() { return this.mesh.position; }
  get label() { return this.shape.label; }
  get toolClass() { return this.def.tool ?? null; }

  /** Where a swing should visually connect, in world space. */
  impactPoint(out = new THREE.Vector3()) {
    return out.set(this.position.x, this.def.hitAt ?? 0.8, this.position.z);
  }

  /**
   * Applies one landed swing.
   *
   * `from` is the direction the blow came from, used to decide which way a tree
   * goes over. Returns what the caller needs to pay out and to play feedback —
   * the node itself knows nothing about inventories, particles or sound.
   */
  hit(damage, rng, from = null) {
    if (!this.alive || this.dying) return { landed: false, depleted: false, drops: [] };

    this.hp = Math.max(0, this.hp - damage);
    this.shake = 0.22;

    const depleted = this.hp === 0;
    const drops = rollYield(depleted ? this.def.reward : this.def.perHit, rng);
    if (depleted) this.beginDeath(from, rng);
    return { landed: true, depleted, drops, hpLeft: this.hp };
  }

  /**
   * Starts the death animation. The node stays in the world until it finishes,
   * so the wood arrives with the tree still going over rather than after it.
   */
  beginDeath(from, rng) {
    const mode = this.def.death ?? 'shrink';
    // Fall away from the blow, with a little scatter so a row of trees doesn't
    // drop in formation.
    const dir = from ? from.clone().setY(0).normalize() : new THREE.Vector3(1, 0, 0);
    if (dir.lengthSq() < 0.001) dir.set(1, 0, 0);
    const jitter = rng ? rng.range(-0.4, 0.4) : 0;
    dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), jitter);

    this.dying = {
      mode,
      t: 0,
      angle: 0,
      speed: 0,
      landed: false,
      axis: new THREE.Vector3(-dir.z, 0, dir.x).normalize(),   // horizontal, across the fall
    };
    this.respawnIn = this.def.respawn ?? 40;
  }

  /**
   * Advances shake, death and respawn.
   *
   * Returns an event when something worth hearing happens, so the caller can
   * play a sound and throw particles without this file importing either.
   */
  update(dt) {
    let event = null;

    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      // A quick decaying wobble around the base, in the same plane every time.
      const wobble = Math.sin(this.shake * 90) * this.shake * (this.dying ? 0 : 0.28);
      this.mesh.quaternion.copy(this.baseQuat);
      this.mesh.rotateZ(wobble);
    }

    if (this.dying) {
      event = this.updateDeath(dt);
      return event;
    }

    if (this.alive) {
      const s = this.mesh.scale.x;
      if (s < 1) this.mesh.scale.setScalar(Math.min(1, s + dt * 1.6));
      return null;
    }

    // Dead and done falling: wait out the respawn, then grow back.
    this.respawnIn -= dt;
    if (this.respawnIn <= 0) {
      this.hp = this.maxHp;
      this.mesh.visible = true;
      this.mesh.scale.setScalar(0.05);
      this.mesh.quaternion.copy(this.baseQuat);
      if (this.stump) this.stump.visible = false;
    }
    return null;
  }

  updateDeath(dt) {
    const d = this.dying;
    d.t += dt;

    if (d.mode === 'topple') {
      // Accelerate over like a hinge at the base rather than lerping an angle.
      d.speed += dt * 4.2;
      const step = Math.min(d.speed * dt, Math.PI / 2 - d.angle);
      d.angle += step;
      this.mesh.rotateOnWorldAxis(d.axis, step);

      if (!d.landed && d.angle >= Math.PI / 2 - 0.02) {
        d.landed = true;
        d.t = 0;
        if (this.stump) this.stump.visible = true;
        return { type: 'landed', mode: 'topple', position: this.position.clone() };
      }
      if (d.landed && d.t > 0.9) this.finishDeath();
      return null;
    }

    if (d.mode === 'shatter') {
      // A short jolt, then collapse into itself.
      if (d.t < 0.12) {
        this.mesh.position.y = Math.sin(d.t * 60) * 0.05;
        return null;
      }
      this.mesh.position.y = 0;
      const k = Math.max(0, 1 - (d.t - 0.12) * 4);
      this.mesh.scale.setScalar(k);
      if (!d.landed) {
        d.landed = true;
        return { type: 'landed', mode: 'shatter', position: this.impactPoint() };
      }
      if (k <= 0.01) this.finishDeath();
      return null;
    }

    // shrink
    const k = Math.max(0, 1 - d.t * 3);
    this.mesh.scale.setScalar(k);
    if (k <= 0.01) this.finishDeath();
    return null;
  }

  finishDeath() {
    this.dying = null;
    this.mesh.visible = false;
    this.mesh.scale.setScalar(0.001);
    this.mesh.position.y = 0;
    this.mesh.quaternion.copy(this.baseQuat);
  }
}
