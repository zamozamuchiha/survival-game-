import * as THREE from 'three';
import { getModel, getAnimations, fitHeight, facingOffset } from '../world/models.js';
import {
  findBones, cacheRest, buildSwingClip, buildPunchClip, buildToolSwingClip,
  buildShamblePose, buildDeathClip,
} from './anim.js';

// Wraps a skinned Mixamo character.
//
//  - one looping locomotion action (idle / walk / run), crossfaded
//  - an ADDITIVE swing layered on top, so attacking never interrupts the legs
//  - an optional held additive pose (the zombie hunch)
//  - a full-body death clip that takes over completely
//
// The model ships with locomotion only; swing/shamble/death are authored in
// anim.js against the skeleton.

const clipByName = (clips, ...names) => {
  for (const n of names) {
    const hit = clips.find((c) => c.name.toLowerCase() === n.toLowerCase());
    if (hit) return hit;
  }
  return null;
};

export class CharacterRig {
  constructor(modelKey, height, tint, tintStrength = 0.55) {
    this.root = new THREE.Group();
    this.model = getModel(modelKey);
    this.ok = !!this.model;
    if (!this.ok) return;

    fitHeight(this.model, height);
    // Entities are oriented by their +Z axis, so a model authored facing another
    // way needs a yaw correction. It's per-model data, not a global constant —
    // guessing one value for every character is how you get moon-walking.
    this.model.rotation.y = facingOffset(modelKey);
    this.root.add(this.model);
    if (tint) this.applyTint(tint, tintStrength);

    this.mixer = new THREE.AnimationMixer(this.model);
    const clips = getAnimations(modelKey);

    // Locomotion straight off the model.
    this.loco = {};
    for (const [key, ...aliases] of [
      ['idle', 'idle', 'Idle'],
      ['walk', 'walk', 'Walk'],
      ['run', 'run', 'Run', 'sprint'],
    ]) {
      const clip = clipByName(clips, ...aliases);
      if (clip) this.loco[key] = this.mixer.clipAction(clip);
    }

    // Authored layers.
    this.bones = findBones(this.model);
    cacheRest(this.bones);

    this.swingAction = this.makeAdditive(buildSwingClip(this.bones));
    // One clip per hand, so hits alternate instead of jabbing with the same arm.
    this.punchActions = ['R', 'L'].map((s) => this.makeAdditive(buildPunchClip(this.bones, s)));
    this.punchHand = 0;
    // Work swings, keyed by tool class. Adding a new tool class is one entry
    // here plus one in SWING_STYLES — no resource ever names an animation.
    this.toolActions = {};
    for (const style of ['chop', 'mine']) {
      this.toolActions[style] = this.makeAdditive(buildToolSwingClip(this.bones, style));
    }
    this.deathAction = this.mixer.clipAction(buildDeathClip(this.bones));
    this.deathAction.setLoop(THREE.LoopOnce, 1);
    this.deathAction.clampWhenFinished = true;

    this.base = null;
    this.dead = false;
    this.setBase('idle');
  }

  makeAdditive(clip) {
    const a = this.mixer.clipAction(clip);
    a.blendMode = THREE.AdditiveAnimationBlendMode;
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = false;
    return a;
  }

  /** Turns on a permanent additive offset (used for the zombie hunch). */
  setHeldPose(strength = 1) {
    if (!this.ok || this.poseAction) return;
    this.poseAction = this.makeAdditive(buildShamblePose(this.bones));
    this.poseAction.setLoop(THREE.LoopRepeat, Infinity);
    this.poseAction.clampWhenFinished = true;
    this.poseAction.setEffectiveWeight(strength);
    this.poseAction.play();
  }

  applyTint(color, strength = 0.55) {
    const c = new THREE.Color(color);
    this.model.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const wasArray = Array.isArray(o.material);
      const tinted = (wasArray ? o.material : [o.material]).map((m) => {
        const cl = m.clone();
        if (cl.color) cl.color.lerp(c, strength);
        cl.roughness = 1;
        cl.metalness = 0;
        return cl;
      });
      // A single-material mesh must stay single — handing it an array renders black.
      o.material = wasArray ? tinted : tinted[0];
    });
  }

  /** Crossfades locomotion. `speed` scales playback to match ground speed. */
  setBase(name, speed = 1) {
    if (!this.ok || this.dead) return;
    const next = this.loco[name] ?? this.loco.idle;
    if (!next) return;
    next.timeScale = speed;
    if (this.base === next) return;
    if (this.base) this.base.fadeOut(0.22);
    next.reset().fadeIn(0.22).play();
    this.base = next;
  }

  /** Layers a swing over whatever is playing. */
  swing(speed = 1) {
    if (!this.ok || this.dead || !this.swingAction) return;
    this.stopAttacks();
    this.swingAction.timeScale = speed;
    this.swingAction.setEffectiveWeight(1);
    this.swingAction.reset().play();
  }

  /** Same, but a straight punch — alternating hands. Used when unarmed. */
  punch(speed = 1) {
    if (!this.ok || this.dead || !this.punchActions) return;
    const action = this.punchActions[this.punchHand];
    this.punchHand ^= 1;
    this.stopAttacks();
    action.timeScale = speed;
    action.setEffectiveWeight(1);
    action.reset().play();
  }

  /**
   * A work swing: chopping, mining, prying. `style` is the tool's class, and
   * `duration` is how long the whole swing should take — the clip is authored at
   * one second and scaled to fit, which keeps the impact frame at a fixed
   * fraction of the swing whatever the tool's speed.
   */
  toolSwing(style, duration = 0.8) {
    if (!this.ok || this.dead) return false;
    const action = this.toolActions?.[style];
    if (!action) return false;
    this.stopAttacks();
    action.timeScale = 1 / Math.max(0.1, duration);
    action.setEffectiveWeight(1);
    action.reset().play();
    return true;
  }

  /**
   * Additive layers accumulate, so a second attack has to clear the first —
   * otherwise two half-finished arm poses add up into a shrug.
   */
  stopAttacks() {
    this.swingAction?.stop();
    for (const a of this.punchActions ?? []) a.stop();
    for (const a of Object.values(this.toolActions ?? {})) a.stop();
  }

  die() {
    if (!this.ok || this.dead) return;
    this.dead = true;
    if (this.base) this.base.fadeOut(0.2);
    if (this.swingAction) this.swingAction.fadeOut(0.15);
    for (const a of this.punchActions ?? []) a.fadeOut(0.15);
    for (const a of Object.values(this.toolActions ?? {})) a.fadeOut(0.15);
    if (this.poseAction) this.poseAction.fadeOut(0.3);
    this.deathAction.reset().fadeIn(0.2).play();
  }

  revive() {
    if (!this.ok) return;
    this.dead = false;
    this.deathAction.stop();
    this.base = null;
    if (this.poseAction) this.poseAction.reset().play();
    this.setBase('idle');
  }

  update(dt) { this.mixer?.update(dt); }
}
