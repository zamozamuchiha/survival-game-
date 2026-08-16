import * as THREE from 'three';

// The Mixamo characters ship with locomotion only (Idle / Walk / Run). Combat
// and death clips are authored here directly on the skeleton.
//
// Swing and shamble are built as ADDITIVE clips so they layer on top of
// whatever locomotion is playing — you can swing mid-run and the legs keep
// running, which is what makes it read as fluid instead of snapping between
// whole-body poses.

const BONES = {
  hips: 'Hips',
  spine: 'Spine', spine1: 'Spine1', spine2: 'Spine2',
  neck: 'Neck', head: 'Head',
  armL: 'LeftArm', foreL: 'LeftForeArm', handL: 'LeftHand',
  armR: 'RightArm', foreR: 'RightForeArm', handR: 'RightHand',
  upLegL: 'LeftUpLeg', legL: 'LeftLeg',
  upLegR: 'RightUpLeg', legR: 'RightLeg',
};

/**
 * Finds bones by their Mixamo name, whatever mangling the exporter applied.
 * GLTFLoader strips the ':' from "mixamorig:Hips", so match on a normalised
 * name rather than any particular separator.
 */
const normaliseBone = (n) =>
  n.replace(/^mixamorig/i, '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();

export function findBones(root) {
  const found = {};
  const wanted = Object.entries(BONES).map(([key, suffix]) => [key, suffix.toLowerCase()]);
  root.traverse((o) => {
    if (!o.isBone) return;
    const name = normaliseBone(o.name);
    for (const [key, suffix] of wanted) {
      if (!found[key] && name === suffix) found[key] = o;
    }
  });
  return found;
}

const e = new THREE.Euler();
const q = new THREE.Quaternion();

/** Local rotation = the bone's rest pose nudged by an XYZ delta, in radians. */
function poseQuat(bone, dx = 0, dy = 0, dz = 0) {
  q.setFromEuler(e.set(dx, dy, dz));
  return bone.userData._rest.clone().multiply(q);
}

/** Caches each bone's bind-pose rotation so deltas are always relative to rest. */
export function cacheRest(bones) {
  for (const b of Object.values(bones)) {
    if (b && !b.userData._rest) b.userData._rest = b.quaternion.clone();
  }
}

function quatTrack(bone, times, quats) {
  const values = [];
  for (const qq of quats) values.push(qq.x, qq.y, qq.z, qq.w);
  return new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, values);
}

function vecTrack(bone, times, vecs) {
  const values = [];
  for (const v of vecs) values.push(v.x, v.y, v.z);
  return new THREE.VectorKeyframeTrack(`${bone.name}.position`, times, values);
}

/**
 * Overhead melee swing. Frame 0 is the rest pose so makeClipAdditive turns the
 * whole thing into a delta layer.
 */
export function buildSwingClip(bones) {
  const t = [0, 0.13, 0.3, 0.5];
  const tracks = [];

  if (bones.armR) {
    tracks.push(quatTrack(bones.armR, t, [
      poseQuat(bones.armR, 0, 0, 0),
      poseQuat(bones.armR, -1.5, 0.2, -0.35),   // wind up and back
      poseQuat(bones.armR, 0.95, -0.15, 0.25),  // drive through
      poseQuat(bones.armR, 0, 0, 0),
    ]));
  }
  if (bones.foreR) {
    tracks.push(quatTrack(bones.foreR, t, [
      poseQuat(bones.foreR, 0, 0, 0),
      poseQuat(bones.foreR, -1.05, 0, 0),
      poseQuat(bones.foreR, -0.2, 0, 0),
      poseQuat(bones.foreR, 0, 0, 0),
    ]));
  }
  // Torso rotation is what sells weight behind the swing.
  for (const key of ['spine', 'spine1', 'spine2']) {
    const b = bones[key];
    if (!b) continue;
    tracks.push(quatTrack(b, t, [
      poseQuat(b, 0, 0, 0),
      poseQuat(b, -0.06, 0.22, 0),
      poseQuat(b, 0.1, -0.26, 0),
      poseQuat(b, 0, 0, 0),
    ]));
  }
  if (bones.armL) {
    tracks.push(quatTrack(bones.armL, t, [
      poseQuat(bones.armL, 0, 0, 0),
      poseQuat(bones.armL, 0.25, 0, 0),
      poseQuat(bones.armL, -0.3, 0, 0),
      poseQuat(bones.armL, 0, 0, 0),
    ]));
  }

  const clip = new THREE.AnimationClip('swing', 0.5, tracks);
  return THREE.AnimationUtils.makeClipAdditive(clip);
}

/**
 * A straight punch — chamber, drive, recover — mirrored per side so that
 * consecutive hits alternate hands and read as a combination rather than one
 * arm twitching twice.
 *
 * The shape that sells a punch is the elbow, not the shoulder: the fist starts
 * cocked by the chin, the arm snaps straight at contact, then folds back. The
 * off hand stays up as a guard the whole time.
 */
export function buildPunchClip(bones, side = 'R') {
  const right = side === 'R';
  const arm = right ? bones.armR : bones.armL;
  const fore = right ? bones.foreR : bones.foreL;
  const guard = right ? bones.armL : bones.armR;
  const guardFore = right ? bones.foreL : bones.foreR;
  // On this skeleton the arm bones run down their own X axis, so X is pure
  // twist: the shoulder swings the arm forward around Y and the elbow bends
  // around Y too. The sign of Y flips between the left and right chains.
  const s = right ? 1 : -1;

  //     rest  chamber  impact  hold  recover
  const t = [0, 0.09, 0.2, 0.3, 0.46];
  const tracks = [];
  const seq = (bone, frames) => {
    if (!bone) return;
    tracks.push(quatTrack(bone, t, frames.map((f) => poseQuat(bone, f[0], f[1] ?? 0, f[2] ?? 0))));
  };

  // Punching arm: cocks back, then drives forward across the centre line.
  seq(arm, [
    [0, 0, 0],
    [0, 0.40 * s, 0.26 * s],
    [0, 1.15 * s, 0.34 * s],
    [0, 0.95 * s, 0.30 * s],
    [0, 0, 0],
  ]);
  // Elbow: folded at the chin, snapped straight on contact, folded again.
  // The X twist rolls the fist over as it lands.
  seq(fore, [
    [0, 0, 0],
    [0.30 * s, 1.80 * s, 0],
    [-0.55 * s, -0.15 * s, 0],
    [-0.30 * s, 0.50 * s, 0],
    [0, 0, 0],
  ]);

  // Off hand keeps a guard up rather than hanging.
  seq(guard, [
    [0, 0, 0],
    [0, -0.45 * s, -0.16 * s],
    [0, -0.55 * s, -0.18 * s],
    [0, -0.50 * s, -0.16 * s],
    [0, 0, 0],
  ]);
  seq(guardFore, [
    [0, 0, 0],
    [0, -1.55 * s, 0],
    [0, -1.75 * s, 0],
    [0, -1.65 * s, 0],
    [0, 0, 0],
  ]);

  // Coil the torso away, then rotate into the punch — this is where the power
  // reads from. Split across the three spine bones so no single joint bends far.
  for (const key of ['spine', 'spine1', 'spine2']) {
    seq(bones[key], [
      [0, 0, 0],
      [0.03, -0.09 * s, 0],
      [-0.04, 0.13 * s, 0],
      [-0.02, 0.08 * s, 0],
      [0, 0, 0],
    ]);
  }
  // Counter-rotate the head so it keeps looking at what it's hitting.
  seq(bones.neck, [
    [0, 0, 0],
    [0, 0.08 * s, 0],
    [0.06, -0.16 * s, 0],
    [0.03, -0.10 * s, 0],
    [0, 0, 0],
  ]);

  const clip = new THREE.AnimationClip(`punch${side}`, 0.46, tracks);
  return THREE.AnimationUtils.makeClipAdditive(clip);
}

/**
 * A two-handed tool swing, shaped by the tool's class rather than by what it is
 * hitting — an axe comes round diagonally, a pickaxe goes up over the head and
 * drives straight down.
 *
 * Both arms are driven so it reads as a two-handed grip even though the tool
 * hangs off the right hand. Times are normalised to a one-second clip and the
 * mixer scales it to the resource's hit cooldown, so the impact frame always
 * lands at the same fraction of the swing.
 *
 * Shoulders and elbows on this skeleton both bend around Y (X runs down the bone
 * and is pure twist), and the axis flips sign between the left and right chains.
 */
export function buildToolSwingClip(bones, style = 'chop') {
  const mine = style === 'mine';
  const impact = mine ? 0.46 : 0.40;

  const wind = mine ? -1.95 : -1.45;      // how far back and up it cocks
  const drive = mine ? 1.05 : 1.35;       // where it finishes
  const elbowWind = mine ? 1.55 : 1.15;
  const lean = mine ? 0.20 : 0.13;        // forward lean as it lands

  const t = [0, impact * 0.72, impact, impact + 0.16, 1.0];
  const tracks = [];
  const seq = (bone, frames) => {
    if (!bone) return;
    tracks.push(quatTrack(bone, t, frames.map((f) => poseQuat(bone, f[0], f[1] ?? 0, f[2] ?? 0))));
  };

  // s flips the bend axis between the two arms.
  const arm = (bone, s) => seq(bone, [
    [0, 0, 0],
    [0, wind * s, 0.10 * s],
    [0, drive * s, 0.18 * s],
    [0, drive * 0.78 * s, 0.15 * s],
    [0, 0, 0],
  ]);
  const elbow = (bone, s) => seq(bone, [
    [0, 0, 0],
    [0, elbowWind * s, 0],
    [0, -0.18 * s, 0],
    [0, 0.25 * s, 0],
    [0, 0, 0],
  ]);

  arm(bones.armR, 1);
  arm(bones.armL, -1);
  elbow(bones.foreR, 1);
  elbow(bones.foreL, -1);

  // The body is where the weight comes from: rock back, then throw forward.
  for (const key of ['spine', 'spine1', 'spine2']) {
    seq(bones[key], [
      [0, 0, 0],
      [-0.07, 0, 0],
      [lean, 0, 0],
      [lean * 0.65, 0, 0],
      [0, 0, 0],
    ]);
  }
  // Keep the head down on the work rather than following the shoulders back.
  seq(bones.neck, [
    [0, 0, 0],
    [0.10, 0, 0],
    [0.06, 0, 0],
    [0.04, 0, 0],
    [0, 0, 0],
  ]);

  const clip = new THREE.AnimationClip(style, 1.0, tracks);
  return THREE.AnimationUtils.makeClipAdditive(clip);
}

/** A held pose — arms reaching, spine hunched — layered over a slowed walk. */
export function buildShamblePose(bones) {
  const t = [0, 1];
  const tracks = [];
  const hold = (bone, dx, dy, dz) => {
    if (!bone) return;
    const p = poseQuat(bone, dx, dy, dz);
    tracks.push(quatTrack(bone, t, [poseQuat(bone, 0, 0, 0), p]));
  };

  hold(bones.armR, -1.15, 0, -0.22);
  hold(bones.armL, -1.05, 0, 0.26);
  hold(bones.foreR, -0.45, 0, 0);
  hold(bones.foreL, -0.55, 0, 0);
  hold(bones.spine, 0.16, 0, 0.05);
  hold(bones.spine1, 0.12, 0, -0.04);
  hold(bones.neck, 0.14, 0.12, 0);
  hold(bones.head, 0.1, -0.16, 0.12);

  const clip = new THREE.AnimationClip('shamble', 1, tracks);
  const additive = THREE.AnimationUtils.makeClipAdditive(clip);
  // Freeze on the posed end so it acts as a constant offset, not a loop.
  for (const tr of additive.tracks) tr.times = new Float32Array([0, 1e-4]);
  additive.duration = 1e-4;
  return additive;
}

/** Full-body collapse. Not additive — when you're dead nothing else plays. */
export function buildDeathClip(bones) {
  const t = [0, 0.35, 0.8, 1.25];
  const tracks = [];

  const seq = (bone, frames) => {
    if (!bone) return;
    tracks.push(quatTrack(bone, t, frames.map((f) => poseQuat(bone, f[0], f[1] ?? 0, f[2] ?? 0))));
  };

  seq(bones.spine,  [[0, 0, 0], [-0.25, 0, 0.1], [0.55, 0, 0.2], [0.7, 0, 0.25]]);
  seq(bones.spine1, [[0, 0, 0], [-0.15, 0, 0.08], [0.4, 0, 0.15], [0.5, 0, 0.18]]);
  seq(bones.neck,   [[0, 0, 0], [-0.3, 0, 0], [0.4, 0, 0], [0.55, 0, 0]]);
  seq(bones.armR,   [[0, 0, 0], [-0.6, 0, -0.4], [0.5, 0, -0.9], [0.65, 0, -1.0]]);
  seq(bones.armL,   [[0, 0, 0], [-0.5, 0, 0.4], [0.45, 0, 0.85], [0.6, 0, 0.95]]);
  seq(bones.upLegR, [[0, 0, 0], [0.2, 0, 0], [-0.9, 0, 0.15], [-1.15, 0, 0.2]]);
  seq(bones.upLegL, [[0, 0, 0], [0.15, 0, 0], [-0.75, 0, -0.1], [-1.0, 0, -0.15]]);
  seq(bones.legR,   [[0, 0, 0], [-0.1, 0, 0], [1.0, 0, 0], [1.25, 0, 0]]);
  seq(bones.legL,   [[0, 0, 0], [-0.1, 0, 0], [0.9, 0, 0], [1.15, 0, 0]]);

  if (bones.hips) {
    const rest = bones.hips.position.clone();
    tracks.push(vecTrack(bones.hips, t, [
      rest.clone(),
      rest.clone().add(new THREE.Vector3(0, rest.length() * 0.06, 0)),
      rest.clone().add(new THREE.Vector3(0, -rest.length() * 0.62, 0)),
      rest.clone().add(new THREE.Vector3(0, -rest.length() * 0.74, 0)),
    ]));
    tracks.push(quatTrack(bones.hips, t, [
      poseQuat(bones.hips, 0, 0, 0),
      poseQuat(bones.hips, 0.1, 0, 0.05),
      poseQuat(bones.hips, -0.5, 0.15, 0.3),
      poseQuat(bones.hips, -0.62, 0.2, 0.38),
    ]));
  }

  return new THREE.AnimationClip('death', 1.25, tracks);
}
