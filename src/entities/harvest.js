import * as THREE from 'three';
import { swingStyle, swingDamage, toolClassFor, TOOL_NAMES } from '../data/harvest.js';

// Drives the whole "walk up to it and work on it" interaction.
//
// The point of doing this as a small state machine rather than inline in the
// attack handler is synchronisation: the resource must not lose a hit point when
// the button goes down, but when the head of the tool arrives. That means the
// swing owns a clock, and the hit is an event fired part-way through it.
//
//   idle -> approach -> swing --(impact)--> swing -> recover -> swing -> ...
//
// Nothing here knows what a tree is. It reads the tool class off the target and
// the timing out of the swing style, so ore, crates and metal work the same way.

const APPROACH_SPEED_LIMIT = 12;   // metres; further than this and we don't auto-walk
const STOP_SLACK = 0.35;           // how close to the ideal spot counts as arrived

export class HarvestController {
  constructor(player, rng) {
    this.player = player;
    this.rng = rng;
    this.target = null;
    this.phase = 'idle';
    this.timer = 0;
    this.impactAt = 0;
    this.impactDone = false;
    this.style = null;
    this.held = false;
  }

  get busy() { return this.phase !== 'idle'; }

  /** True while the player is being walked somewhere by this controller. */
  get steering() { return this.phase === 'approach'; }

  /**
   * Aims at a node. Returns null on success, or a reason string the caller can
   * put on screen ("You need an axe for this").
   */
  begin(node, weapon) {
    if (!node?.alive) return null;
    const need = toolClassFor(node.type);
    if (need && swingDamage(node.type, weapon) <= 0) {
      return `You need ${TOOL_NAMES[need] ?? 'the right tool'} for this`;
    }
    if (this.target !== node) {
      this.target = node;
      this.phase = 'approach';
      this.timer = 0;
    }
    this.held = true;
    return null;
  }

  /** Called every frame the harvest button is not held. */
  release() {
    this.held = false;
  }

  stop() {
    this.target = null;
    this.phase = 'idle';
    this.timer = 0;
    this.player.moveGoal = null;
    this.player.faceGoal = null;
  }

  /** The spot to stand on: just outside the node, on the side we came from. */
  idealStand(node, out = new THREE.Vector3()) {
    const p = this.player.position;
    const away = new THREE.Vector3(p.x - node.position.x, 0, p.z - node.position.z);
    if (away.lengthSq() < 0.0001) away.set(1, 0, 0);
    away.normalize();
    const reach = node.radius + this.player.radius + 0.45;
    return out.set(
      node.position.x + away.x * reach, 0,
      node.position.z + away.z * reach);
  }

  /**
   * @returns null, or an event: { type:'impact'|'depleted', node, drops, point, dir }
   */
  update(dt, weapon, interrupted) {
    if (!this.busy) return null;
    const node = this.target;
    const player = this.player;

    // Anything that invalidates the job: it died under someone else, the player
    // walked off, or the tool changed to one that can't touch it.
    if (!node || !node.alive || node.dying || interrupted) {
      this.stop();
      return null;
    }

    const dmg = swingDamage(node.type, weapon);
    if (dmg <= 0) { this.stop(); return null; }

    const toNode = new THREE.Vector3(
      node.position.x - player.position.x, 0,
      node.position.z - player.position.z);
    const dist = toNode.length();
    const facing = Math.atan2(toNode.x, toNode.z);

    if (this.phase === 'approach') {
      if (dist > APPROACH_SPEED_LIMIT) { this.stop(); return null; }
      const stand = this.idealStand(node);
      const gap = Math.hypot(stand.x - player.position.x, stand.z - player.position.z);
      const inReach = dist <= node.radius + player.radius + 0.8;

      if (inReach || gap <= STOP_SLACK) {
        player.moveGoal = null;
        this.startSwing(node, weapon);
      } else {
        // Walk in under the controller rather than the keyboard, and face the
        // work the whole way in.
        player.moveGoal = stand;
        player.faceGoal = facing;
      }
      return null;
    }

    // Locked on target for the whole swing: no drifting, no walking through it.
    player.moveGoal = null;
    player.faceGoal = facing;

    this.timer += dt;

    if (this.phase === 'swing') {
      if (!this.impactDone && this.timer >= this.impactAt) {
        this.impactDone = true;
        return this.land(node, weapon, dmg, toNode);
      }
      if (this.timer >= this.style.duration) {
        this.phase = 'recover';
      }
      return null;
    }

    if (this.phase === 'recover') {
      if (this.timer >= this.cooldown) {
        if (this.held) this.startSwing(node, weapon);
        else this.stop();
      }
      return null;
    }

    return null;
  }

  startSwing(node, weapon) {
    const style = swingStyle(node.toolClass ?? 'none');
    // The clip is stretched to the resource's cooldown so a slow resource reads
    // as a heavy swing rather than a fast swing followed by standing still.
    const duration = Math.min(node.def.hitCooldown ?? 0.8, style.duration);
    this.style = { ...style, duration };
    // Impact keeps its place within the swing however long the swing runs for.
    this.impactAt = duration * (style.impactAt / style.duration);
    this.cooldown = node.def.hitCooldown ?? 0.8;
    this.phase = 'swing';
    this.timer = 0;
    this.impactDone = false;

    this.player.busy = Math.max(this.player.busy, duration * 0.9);
    this.player.rig?.toolSwing?.(style.clip, duration);
  }

  land(node, weapon, dmg, toNode) {
    const result = node.hit(dmg, this.rng, toNode.clone().negate());
    if (!result.landed) { this.stop(); return null; }

    const point = node.impactPoint();
    // Push debris back towards the player — that's where the tool came from.
    const dir = toNode.clone().normalize().negate();

    return {
      type: result.depleted ? 'depleted' : 'impact',
      node,
      drops: result.drops,
      hpLeft: result.hpLeft,
      point,
      dir,
    };
  }
}
