import * as THREE from 'three';
import { ITEMS, FISTS } from '../data/items.js';
import { state, armorRating, carriedWeight, carryLimit } from '../core/state.js';
import { CharacterRig } from './character.js';

const WALK_SPEED = 5.3;
const SPRINT_SPEED = 8.8;
const ACCEL = 44;
const FRICTION = 15;
const HEIGHT = 1.75;

const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, flatShading: true });

/** Fallback body if the character model didn't load. */
function primitiveBody() {
  const rig = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.78, 0.38), mat(0x445a4e));
  torso.position.y = 1.14;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), mat(0xc39a72));
  head.position.y = 1.75;
  rig.add(torso, head);
  const hand = new THREE.Group();
  hand.position.set(-0.4, 1.3, 0.1);
  rig.add(hand);
  rig.userData.hand = hand;
  return rig;
}

export class Player {
  constructor() {
    this.radius = 0.42;
    this.velocity = new THREE.Vector3();
    this.facing = 0;
    this.swingTimer = 0;
    this.swingCd = 0;
    this.hurtFlash = 0;
    this.busy = 0;
    this.searching = false;
    this.wasDead = false;
    this.moveGoal = null;     // set by systems that walk the player somewhere
    this.faceGoal = null;     // set to lock facing while working

    this.mesh = new THREE.Group();

    const body = state.character?.body === 'male' ? 'char_player_male' : 'char_player_female';
    // Gentle tint so the chosen colour reads as clothing, not body paint.
    this.rig = new CharacterRig(body, HEIGHT, state.character?.tint, 0.3);
    if (this.rig.ok) {
      this.mesh.add(this.rig.root);
      this.hand = this.rig.bones.handR ?? this.rig.model;
    } else {
      const body = primitiveBody();
      this.mesh.add(body);
      this.fallbackBody = body;
      this.hand = body.userData.hand;
    }

    // Hang the weapon off the right hand bone. Mixamo skeletons carry their own
    // scale, so counter-scale the slot to keep held items in real metres.
    this.heldSlot = new THREE.Group();
    this.hand.add(this.heldSlot);
    this.hand.updateWorldMatrix(true, false);
    const boneScale = new THREE.Vector3();
    this.hand.getWorldScale(boneScale);
    if (boneScale.x > 0.0001) this.heldSlot.scale.setScalar(1 / boneScale.x);
    this.heldId = undefined;

    this.mesh.traverse((o) => { o.castShadow = true; });
    this.syncEquipment();
  }

  get position() { return this.mesh.position; }
  get hp() { return state.hp; }

  get weapon() {
    const eq = state.equip.weapon;
    if (!eq) return FISTS;
    const def = ITEMS[eq.id];
    if (!def || (def.dur && eq.dur <= 0)) return FISTS;
    return def;
  }

  /** Rebuilds the held-item mesh whenever the equipped weapon changes. */
  syncEquipment() {
    const id = state.equip.weapon?.id ?? null;
    if (id === this.heldId) return;
    this.heldId = id;
    this.heldSlot.clear();
    if (!id) return;

    const def = ITEMS[id];
    const g = new THREE.Group();

    if (def.ranged) {
      const long = def.maxRange > 40;
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, long ? 0.85 : 0.42), mat(0x33383d));
      barrel.position.z = long ? 0.4 : 0.2;
      g.add(barrel);
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.22), mat(0x4a4f55));
      g.add(body);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.09), mat(0x3b2f24));
      grip.position.y = -0.16;
      g.add(grip);
    } else {
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.72, 6), mat(0x6b4b2f));
      handle.position.y = -0.3;
      g.add(handle);
      const metal = id.includes('iron') || id === 'machete' ? 0xc2cad1 : id === 'bat' ? 0x8a6a42 : 0x9aa3aa;
      if (def.tool === 'mine') {
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.09, 0.1), mat(metal));
        head.position.y = -0.62;
        g.add(head);
      } else if (id === 'spear') {
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.26, 5), mat(metal));
        tip.position.y = -0.74;
        tip.rotation.x = Math.PI;
        g.add(tip);
      } else {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.3, 0.22), mat(metal));
        blade.position.set(0, -0.6, 0.08);
        g.add(blade);
      }
    }

    // Tip it forward out of the fist. Guns point ahead; melee hangs down the arm.
    g.rotation.x = def.ranged ? -Math.PI / 2 : -0.45;
    g.scale.setScalar(1.35);   // the arm is scaled down inside the rig
    g.traverse((o) => { o.castShadow = true; });
    this.heldSlot.add(g);
  }

  trySwing() {
    if (state.hp <= 0 || this.swingCd > 0 || this.busy > 0) return false;
    const w = this.weapon;
    if (state.stamina < 6) return false;
    this.swingCd = w.speed ?? 0.5;
    this.swingTimer = Math.min(0.3, (w.speed ?? 0.5) * 0.55);
    state.stamina = Math.max(0, state.stamina - 5);

    // Additive, so the legs keep running while you swing.
    const rate = Math.max(0.75, 0.5 / (w.speed ?? 0.5));
    // Bare hands throw a punch; anything you're holding gets swung.
    if (w === FISTS) this.rig.punch?.(rate);
    else this.rig.swing?.(rate);
    return true;
  }

  damage(amount, opts = {}) {
    if (state.hp <= 0) return;
    state.hp = Math.max(0, state.hp - amount * (1 - armorRating()));
    this.hurtFlash = 0.25;
    if (opts.poison) state.poison = Math.min(60, state.poison + opts.poison);
    if (opts.knock) this.velocity.addScaledVector(opts.knock, 1);
    this.wearArmor();
  }

  /** Getting hit chips away at whatever you're wearing. */
  wearArmor() {
    for (const key of ['head', 'body', 'feet']) {
      const s = state.equip[key];
      if (!s || s.dur === undefined || s.dur <= 0) continue;
      s.dur -= 1;
      if (s.dur <= 0) state.equip[key] = null;
    }
  }

  respawned() {
    this.wasDead = false;
    this.mesh.rotation.set(0, 0, 0);
    if (this.rig.ok) this.rig.revive();
    else this.fallbackBody.rotation.x = 0;
  }

  update(dt, input, colliders, canMove) {
    this.swingCd = Math.max(0, this.swingCd - dt);
    this.swingTimer = Math.max(0, this.swingTimer - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    this.busy = Math.max(0, this.busy - dt);
    this.syncEquipment();

    if (state.hp <= 0) {
      if (!this.wasDead) {
        this.wasDead = true;
        if (this.rig.ok) this.rig.die();
      }
      if (!this.rig.ok) {
        this.fallbackBody.rotation.x = Math.min(Math.PI / 2, this.fallbackBody.rotation.x + dt * 3.5);
      }
      this.rig.update?.(dt);
      return;
    }

    const wish = new THREE.Vector3();
    if (this.moveGoal) {
      // Being walked somewhere by another system (harvesting, cutscenes). It
      // takes priority over the stick so the approach can't be fought mid-swing.
      const dx = this.moveGoal.x - this.position.x;
      const dz = this.moveGoal.z - this.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.12) wish.set(dx / d, 0, dz / d);
    } else if (canMove && this.busy <= 0) {
      wish.set(
        (input.right ? 1 : 0) - (input.left ? 1 : 0), 0,
        (input.back ? 1 : 0) - (input.forward ? 1 : 0));
    }

    const moving = wish.lengthSq() > 0;
    if (moving) wish.normalize();

    // Overloaded packs slow you to a crawl — the weight limit has teeth.
    const load = carriedWeight() / carryLimit();
    const loadPenalty = load > 1 ? Math.max(0.42, 1 - (load - 1) * 1.1) : 1;

    const wantsSprint = input.sprint && moving && state.stamina > 1;
    const topSpeed = (wantsSprint ? SPRINT_SPEED : WALK_SPEED) * loadPenalty;

    if (wantsSprint) state.stamina = Math.max(0, state.stamina - dt * 20);
    else state.stamina = Math.min(100, state.stamina + dt * 16);

    this.velocity.addScaledVector(wish, ACCEL * dt);
    this.velocity.multiplyScalar(moving ? 1 : Math.max(0, 1 - FRICTION * dt));
    if (this.velocity.length() > topSpeed) this.velocity.setLength(topSpeed);
    this.position.addScaledVector(this.velocity, dt);

    // An explicit facing wins: while working, the character stays squared up to
    // what it's hitting even as the approach nudges it around.
    if (this.faceGoal !== null && this.faceGoal !== undefined) this.facing = this.faceGoal;
    else if (moving) this.facing = Math.atan2(wish.x, wish.z);
    const delta = ((this.facing - this.mesh.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this.mesh.rotation.y += delta * Math.min(1, dt * 16);

    resolveCollisions(this, colliders);
    this.animate(dt, moving, wantsSprint);
  }

  animate(dt, moving, sprinting) {
    if (this.rig.ok) {
      // Match playback rate to ground speed so the feet don't skate.
      if (this.searching || this.busy > 0) this.rig.setBase('idle', 1);
      else if (!moving) this.rig.setBase('idle', 1);
      else if (sprinting) this.rig.setBase('run', THREE.MathUtils.clamp(this.velocity.length() / SPRINT_SPEED, 0.7, 1.3));
      else this.rig.setBase('walk', THREE.MathUtils.clamp(this.velocity.length() / WALK_SPEED, 0.6, 1.5));
      this.rig.update(dt);
    } else {
      this.fallbackBody.position.y = moving ? Math.abs(Math.sin(performance.now() / 110)) * 0.06 : 0;
    }

    const flash = this.hurtFlash > 0;
    this.mesh.traverse((o) => {
      if (o.isMesh && o.material?.emissive) o.material.emissive.setHex(flash ? 0x772020 : 0x000000);
    });
  }
}

export function resolveCollisions(entity, colliders) {
  for (const c of colliders) {
    if (c.entity === entity || !c.active) continue;
    const dx = entity.position.x - c.position.x;
    const dz = entity.position.z - c.position.z;
    const minDist = entity.radius + c.radius;
    const distSq = dx * dx + dz * dz;
    if (distSq >= minDist * minDist || distSq === 0) continue;
    const dist = Math.sqrt(distSq);
    const push = (minDist - dist) / dist;
    entity.position.x += dx * push;
    entity.position.z += dz * push;
  }
}
