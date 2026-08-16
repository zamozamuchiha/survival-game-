import * as THREE from 'three';

// Impact feedback: chips, dust and a camera nudge.
//
// One shared pool of flat quads rather than a system per resource — a wood chip
// and a stone chip differ only in colour, size and how fast they leave, all of
// which come from the caller's profile. Anything that can be hit can use this.

const MAX_BITS = 220;

const bits = [];          // { mesh, vel, life, ttl, spin }
let pool = null;          // THREE.InstancedMesh
let live = 0;

const dummy = new THREE.Object3D();
const tmpColor = new THREE.Color();

function ensurePool(scene) {
  if (pool && pool.parent === scene) return pool;
  // A new location means a new scene; rebuild rather than carry meshes across.
  pool = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }),
    MAX_BITS);
  pool.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  pool.frustumCulled = false;
  pool.count = 0;
  scene.add(pool);
  bits.length = 0;
  live = 0;
  return pool;
}

/** Drops every particle — call when the scene is torn down. */
export function resetFx() {
  pool = null;
  bits.length = 0;
  live = 0;
}

const between = (rng, range) => rng.range(range[0], range[1]);

function emit(rng, origin, away, spec) {
  for (let i = 0; i < (spec.count ?? 0) && live < MAX_BITS; i++) {
    const speed = between(rng, spec.speed);
    // Spray outward along the swing, with enough spread that it reads as debris
    // rather than a jet.
    const dir = new THREE.Vector3(
      away.x + rng.range(-0.8, 0.8),
      rng.range(0.35, 1.1),
      away.z + rng.range(-0.8, 0.8)).normalize();

    bits.push({
      pos: origin.clone().add(new THREE.Vector3(rng.range(-0.12, 0.12), rng.range(-0.1, 0.1), rng.range(-0.12, 0.12))),
      vel: dir.multiplyScalar(speed),
      size: between(rng, spec.size),
      color: spec.color,
      ttl: between(rng, spec.life),
      life: 0,
      spin: rng.range(-9, 9),
      angle: rng.range(0, Math.PI * 2),
    });
    live++;
  }
}

/**
 * Sprays one impact's worth of debris.
 *
 * @param origin  world point the tool connected at
 * @param away    horizontal direction the debris should fly (from hitter to hit)
 * @param profile entry from IMPACT_FX
 */
export function spawnImpact(scene, rng, origin, away, profile) {
  if (!profile) return;
  ensurePool(scene);
  if (profile.chips) emit(rng, origin, away, profile.chips);
  if (profile.dust) emit(rng, origin, away, profile.dust);
}

/** Advances every particle and writes the instance buffer. */
export function updateFx(dt, camera) {
  if (!pool) return;

  for (let i = bits.length - 1; i >= 0; i--) {
    const b = bits[i];
    b.life += dt;
    if (b.life >= b.ttl) {
      bits.splice(i, 1);
      live--;
      continue;
    }
    b.vel.y -= 9.4 * dt;               // gravity
    b.vel.multiplyScalar(1 - 1.6 * dt); // drag
    b.pos.addScaledVector(b.vel, dt);
    if (b.pos.y < 0.02) {              // settle on the ground rather than sink
      b.pos.y = 0.02;
      b.vel.set(0, 0, 0);
    }
    b.angle += b.spin * dt;
  }

  pool.count = bits.length;
  for (let i = 0; i < bits.length; i++) {
    const b = bits[i];
    dummy.position.copy(b.pos);
    dummy.quaternion.copy(camera.quaternion);   // billboard
    dummy.rotateZ(b.angle);
    // Shrink out over the last third of its life instead of vanishing.
    const fade = Math.min(1, (1 - b.life / b.ttl) * 3);
    dummy.scale.setScalar(b.size * fade);
    dummy.updateMatrix();
    pool.setMatrixAt(i, dummy.matrix);
    pool.setColorAt(i, tmpColor.setHex(b.color));
  }
  pool.instanceMatrix.needsUpdate = true;
  if (pool.instanceColor) pool.instanceColor.needsUpdate = true;
}

// ---------------------------------------------------------------- camera shake

let shakeAmount = 0;
let shakeTime = 0;

/** Adds a knock to the camera. Strength is in metres of peak offset. */
export function addShake(strength) {
  shakeAmount = Math.min(0.35, shakeAmount + strength);
}

/**
 * Current camera offset, decaying over time. Deliberately small and fast —
 * a mobile survival game wants a tap on the lens, not an earthquake.
 */
export function shakeOffset(dt, out) {
  shakeTime += dt;
  shakeAmount = Math.max(0, shakeAmount - dt * 1.6);
  if (shakeAmount <= 0) return out.set(0, 0, 0);
  const a = shakeAmount;
  return out.set(
    Math.sin(shakeTime * 61) * a,
    Math.sin(shakeTime * 47) * a * 0.7,
    Math.cos(shakeTime * 53) * a);
}

/** Buzzes the device, where that exists. Silently does nothing on desktop. */
export function rumble(ms = 18) {
  navigator.vibrate?.(ms);
}
