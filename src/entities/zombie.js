import * as THREE from 'three';
import { ZOMBIE_TYPES } from '../data/zombies.js';
import { resolveCollisions } from './player.js';
import { CharacterRig } from './character.js';
import { pickVariant, getModel, fitHeight } from '../world/models.js';

const ATTACK_RANGE = 1.9;
const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, flatShading: true });

function primitiveBody(def) {
  const rig = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.74, 0.34), mat(def.rag));
  torso.position.y = 1.08;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), mat(def.flesh));
  head.position.y = 1.66;
  rig.add(torso, head);
  return rig;
}

/** Dogs aren't in the character pack — build a low quadruped from primitives. */
function buildDog(def) {
  const rig = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.42, 1.0), mat(def.flesh));
  body.position.y = 0.62;
  rig.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.32, 0.42), mat(def.flesh));
  head.position.set(0, 0.72, 0.66);
  rig.add(head);
  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.16, 0.24), mat(def.rag));
  snout.position.set(0, 0.64, 0.94);
  rig.add(snout);

  const legGeo = new THREE.BoxGeometry(0.15, 0.5, 0.16);
  legGeo.translate(0, -0.25, 0);
  const legs = [];
  for (const [x, z] of [[-0.16, 0.34], [0.16, 0.34], [-0.16, -0.34], [0.16, -0.34]]) {
    const l = new THREE.Group();
    l.position.set(x, 0.5, z);
    l.add(new THREE.Mesh(legGeo, mat(def.rag)));
    rig.add(l);
    legs.push(l);
  }
  rig.userData.legs = legs;
  return rig;
}

export class Zombie {
  constructor(type, position, rng) {
    this.kind = 'zombie';
    this.type = type;
    this.def = ZOMBIE_TYPES[type];
    this.rng = rng;

    const scale = this.def.scale ?? 1;
    this.radius = 0.44 * scale;
    this.maxHp = this.def.hp;
    this.hp = this.def.hp;
    this.state = 'wander';
    this.attackCd = 0;
    this.hurtFlash = 0;
    this.deathTimer = 0;
    this.phase = rng.range(0, Math.PI * 2);
    this.wanderTarget = position.clone();
    this.wanderCd = 0;
    this.dying = false;

    this.mesh = new THREE.Group();
    this.mesh.position.copy(position);

    if (this.def.quad) {
      this.rig = { ok: false };
      this.dogBody = buildDog(this.def);
      this.dogBody.scale.setScalar(scale);
      this.mesh.add(this.dogBody);
    } else {
      const key = type === 'brute' ? 'char_brute' : pickVariant('zombie', rng);
      this.rig = new CharacterRig(key, 1.78 * scale, this.def.flesh);
      if (this.rig.ok) {
        this.mesh.add(this.rig.root);
        // A permanent additive hunch turns a clean mocap walk into a shamble.
        this.rig.setHeldPose(this.def.speed > 4 ? 0.55 : 1);
        this.rig.setBase('walk', 0.55);
      } else {
        this.fallbackBody = primitiveBody(this.def);
        this.fallbackBody.scale.setScalar(scale);
        this.mesh.add(this.fallbackBody);
      }
    }

    this.materials = [];
    this.mesh.traverse((o) => {
      o.castShadow = true;
      if (o.isMesh && o.material?.emissive) this.materials.push(o.material);
    });
  }

  get alive() { return this.hp > 0; }
  get position() { return this.mesh.position; }

  /** Returns true on the killing blow. */
  damage(amount) {
    if (!this.alive) return false;
    this.hp -= amount;
    this.hurtFlash = 0.2;
    this.state = 'chase';
    if (this.hp <= 0) {
      this.deathTimer = 4;
      this.dying = true;
      if (this.rig.ok) this.rig.die();
      return true;
    }
    return false;
  }

  update(dt, player, colliders) {
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    const flash = this.hurtFlash > 0 ? 0x992222 : 0x000000;
    for (const m of this.materials) m.emissive.setHex(flash);

    if (!this.alive) {
      if (this.rig.ok) this.rig.update(dt);
      else {
        const body = this.dogBody ?? this.fallbackBody;
        body.rotation.x = Math.min(Math.PI / 2, body.rotation.x + dt * 4);
      }
      this.deathTimer -= dt;
      return;
    }

    this.attackCd = Math.max(0, this.attackCd - dt);

    const toPlayer = new THREE.Vector3().subVectors(player.position, this.position);
    toPlayer.y = 0;
    const dist = toPlayer.length();
    const playerDown = player.hp <= 0;

    if (playerDown) this.state = 'wander';
    else if (this.state === 'wander' && dist < this.def.aggro) this.state = 'chase';
    else if (this.state === 'chase' && dist > this.def.lose) this.state = 'wander';

    const move = new THREE.Vector3();
    let speed = this.def.wanderSpeed;

    if (this.state === 'chase') {
      speed = this.def.speed;
      const reach = ATTACK_RANGE * (this.def.scale ?? 1);
      if (dist > reach) {
        move.copy(toPlayer).normalize();
      } else if (this.attackCd === 0) {
        const knock = this.def.knock
          ? toPlayer.clone().normalize().multiplyScalar(this.def.knock)
          : null;
        player.damage(this.def.dmg, { poison: this.def.poison, knock });
        this.attackCd = this.def.atkCd;
        if (this.rig.ok) this.rig.swing(1.25);
      }
    } else {
      this.wanderCd -= dt;
      if (this.wanderCd <= 0 || this.position.distanceTo(this.wanderTarget) < 1) {
        const a = this.rng.range(0, Math.PI * 2);
        const d = this.rng.range(4, 14);
        this.wanderTarget.set(this.position.x + Math.cos(a) * d, 0, this.position.z + Math.sin(a) * d);
        this.wanderCd = this.rng.range(3, 7);
      }
      move.subVectors(this.wanderTarget, this.position);
      move.y = 0;
      if (move.lengthSq() > 0.01) move.normalize();
    }

    this.position.addScaledVector(move, speed * dt);

    if (move.lengthSq() > 0.001) {
      const target = Math.atan2(move.x, move.z);
      const delta = ((target - this.mesh.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      this.mesh.rotation.y += delta * Math.min(1, dt * 7);
      this.phase += dt * speed * 2.4;
    }

    this.animate(dt, move.lengthSq() > 0.001);
    resolveCollisions(this, colliders);
  }

  animate(dt, moving) {
    if (this.rig.ok) {
      // Walkers shamble even when chasing; runners actually run.
      const fast = this.def.speed > 4;
      if (!moving) this.rig.setBase('idle', 0.7);
      else if (this.state === 'chase' && fast) this.rig.setBase('run', 1);
      else this.rig.setBase('walk', this.state === 'chase' ? 0.85 : 0.5);
      this.rig.update(dt);
      // Slow uneven sway on top of the hunch — never a rigid upright walk.
      this.rig.root.rotation.z = Math.sin(this.phase * 0.55) * 0.05;
      return;
    }

    if (this.dogBody) {
      const s = Math.sin(this.phase);
      const legs = this.dogBody.userData.legs;
      legs[0].rotation.x = s * 0.7;
      legs[1].rotation.x = -s * 0.7;
      legs[2].rotation.x = -s * 0.7;
      legs[3].rotation.x = s * 0.7;
      this.dogBody.position.y = Math.abs(s) * 0.06;
    }
  }
}
