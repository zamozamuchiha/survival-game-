import * as THREE from 'three';
import { quality } from '../core/quality.js';
import { ResourceNode } from './nodes.js';
import { scatterContainers } from './containers.js';
import { scatterPickups } from './pickups.js';
import { getModel, getParts, pickVariant, fitHeight } from './models.js';
import { InstanceBatch, instanceOf } from './instancing.js';
import { CAMP_CLEAR_HALF } from './base.js';
import { CELL } from '../data/building.js';
import { LAND_HALF_CELLS } from '../data/land.js';
import { resolveVariant } from '../data/vehicles.js';
import { PEACEFUL } from '../data/locations.js';
import { surfaceMaterial } from './textures.js';
import { GrassField } from './grass.js';
import { Zombie } from '../entities/zombie.js';

// Shadow map resolution and the half-width of the area it covers, in metres.
// Exported so the render loop can snap the light to the same texel grid.
// Read through functions, not constants: the graphics setting can change
// between location loads, and the shadow map is rebuilt with the scene.
export const SHADOW_RES = 2048;          // the ceiling, for callers that size buffers
export const shadowRes = () => quality().shadowRes;
export const shadowExtent = () => quality().shadowExtent;
export const SHADOW_EXTENT = 26;

// Metres per ground tile. Kenney's tile is authored 1x1, so this doubles as the
// instance scale.
const TILE = 2;

/**
 * Deterministic two-octave value noise: broad colour regions with a finer
 * break-up laid over them. Seeded off the location rng, so re-entering a map
 * rebuilds the same ground rather than reshuffling it.
 */
function groundNoise(rng) {
  const seed = rng() * 1000;
  const hash = (x, z) => {
    const n = Math.sin(x * 127.1 + z * 311.7 + seed) * 43758.5453;
    return n - Math.floor(n);
  };
  const smooth = (x, z) => {
    const xi = Math.floor(x);
    const zi = Math.floor(z);
    // Smoothstep the cell fraction, otherwise the lattice shows up as a grid.
    const ux = (x - xi) * (x - xi) * (3 - 2 * (x - xi));
    const uz = (z - zi) * (z - zi) * (3 - 2 * (z - zi));
    const a = hash(xi, zi);
    const b = hash(xi + 1, zi);
    const c = hash(xi, zi + 1);
    const d = hash(xi + 1, zi + 1);
    return (a + (b - a) * ux) * (1 - uz) + (c + (d - c) * ux) * uz;
  };
  // Two smoothed octaves average out around the middle of the range, which would
  // only ever sample the middle of the palette. Stretch the contrast so the
  // extremes — the darkest and lightest tints — actually show up on the map.
  return (x, z) => {
    const v = smooth(x / 11, z / 11) * 0.7 + smooth(x / 3.5, z / 3.5) * 0.3;
    return (v - 0.5) * 2.1 + 0.5;
  };
}

/**
 * The ground: one textured plane, shaded per vertex from the noise field.
 *
 * This started as a disc with colour decals floating a centimetre above it.
 * Those decals sat inside the shadow bias, so shadows cut straight through them.
 * Then it was a field of tiles, which fixed that but couldn't carry a real
 * surface — kit tiles have no UV space to put one on. A single plane with its own
 * UVs takes the soil texture, and the colour variation moves into vertex colours,
 * so there is still only one surface for a shadow to land on.
 */
function buildGroundPlane(rng, biome, radius, plotHalf = 0) {
  const reach = (radius + 6) * 2;
  const segments = 110;                      // ~1m per vertex: enough for soft patches
  const geo = new THREE.PlaneGeometry(reach, reach, segments, segments);
  geo.rotateX(-Math.PI / 2);

  const noise = groundNoise(rng);
  const shades = [new THREE.Color(biome.ground), ...biome.patch.map((c) => new THREE.Color(c))];
  const tint = (v) => {
    const f = THREE.MathUtils.clamp(v, 0, 0.999) * (shades.length - 1);
    const i = Math.floor(f);
    return shades[i].clone().lerp(shades[i + 1], f - i);
  };
  // The plot reads as ground that gets walked on: shifted towards the biome's
  // bare-dirt tone, but only halfway. It used to be full dirt, which — with the
  // grass kept off it — made the camp look like a bald patch in the field.
  const plotShade = new THREE.Color(biome.ground)
    .lerp(new THREE.Color(biome.patch[1] ?? biome.ground), 0.45)
    .multiplyScalar(0.96);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const onPlot = plotHalf > 0 && Math.abs(x) <= plotHalf && Math.abs(z) <= plotHalf;
    c.copy(onPlot ? plotShade : tint(noise(x, z)));
    // Gentle undulation so the plane isn't dead flat under raking light. Kept to
    // a few centimetres — the player walks on y = 0 and must not float or sink.
    pos.setY(i, onPlot ? 0 : (noise(x * 0.5, z * 0.5) - 0.5) * 0.06);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const material = surfaceMaterial(biome.dryGround ? 'groundDry' : 'ground', {
    // One texture tile per two metres, so the grain reads at walking distance
    // without turning into a visible repeat from the camera height.
    repeat: reach / 2,
    roughness: 1,
    seed: 5,
    normalScale: 0.85,
  });
  material.vertexColors = true;

  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  return mesh;
}

function buildTerrain(rng, biome, radius, plotHalf = 0) {
  const g = new THREE.Group();
  const upAxis = new THREE.Vector3(0, 1, 0);

  g.add(buildGroundPlane(rng, biome, radius, plotHalf));

  // Nothing scatters onto the plot — you shouldn't have to clear logs and boulders
  // out of your own camp before you can build in it.
  const offPlot = (x, z) => plotHalf <= 0 || Math.abs(x) > plotHalf || Math.abs(z) > plotHalf;

  // Ground litter: the grit, twigs and dead leaves that stop a lawn reading as a
  // lawn. Sparse on purpose — the grass carries the cover, this carries the mess.
  // Sized by longest side, not height: these all lie flat.
  const LITTER_SIZE = {
    twig: [0.30, 0.60],
    leaf_litter: [0.16, 0.30],
    rock_small: [0.14, 0.34],
  };
  const props = new InstanceBatch();
  for (let i = 0; i < 260; i++) {
    const key = pickVariant('scatter', rng);
    if (!key) break;
    const a = rng.range(0, Math.PI * 2);
    const d = Math.sqrt(rng()) * radius;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (!offPlot(x, z)) continue;
    const family = Object.keys(LITTER_SIZE).find((k) => key.startsWith(k));
    const range = LITTER_SIZE[family] ?? [0.2, 0.4];
    props.add(key, rng.range(range[0], range[1]), new THREE.Vector3(x, 0, z),
      rng.range(0, Math.PI * 2), 'span');
  }
  g.add(props.build());

  // Enclosing treeline so the map edge reads as impassable forest — 240 cones
  // in a single instanced draw.
  const ringGeo = new THREE.ConeGeometry(1.5, 6, 5);
  const ringMats = [];
  for (let i = 0; i < 240; i++) {
    const a = (i / 240) * Math.PI * 2 + rng.range(-0.02, 0.02);
    const d = radius + rng.range(2, 10);
    const s = rng.range(0.85, 1.55);
    ringMats.push(new THREE.Matrix4().compose(
      new THREE.Vector3(Math.cos(a) * d, rng.range(2.4, 3.6), Math.sin(a) * d),
      new THREE.Quaternion().setFromAxisAngle(upAxis, rng.range(0, Math.PI * 2)),
      new THREE.Vector3(s, s, s)));
  }
  // Unlit, and tinted towards the horizon.
  //
  // These cones are a silhouette standing in for a forest fifty metres out, not
  // objects anyone inspects. Lit like real geometry, the side facing away from
  // the sun goes black — invisible from overhead, a black wedge across the sky
  // at eye level. A flat colour part-way to the sky lets the fog finish the job
  // and reads as distance rather than as a prop.
  const ringColour = new THREE.Color(biome.tree)
    .lerp(new THREE.Color(biome.skyHorizon ?? biome.fog), 0.42);
  const ring = instanceOf(
    ringGeo,
    new THREE.MeshBasicMaterial({ color: ringColour, fog: true }),
    ringMats);
  ring.frustumCulled = false;
  ring.castShadow = false;
  ring.receiveShadow = false;
  g.add(ring);

  return g;
}

function scatterNodes(scene, rng, counts, biome, radius, clear) {
  const nodes = [];
  const wanted = [];
  for (const [type, n] of Object.entries(counts)) {
    for (let i = 0; i < n; i++) wanted.push(type);
  }
  // Shuffle so one type doesn't claim all the good spots.
  for (let i = wanted.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [wanted[i], wanted[j]] = [wanted[j], wanted[i]];
  }

  let guard = 0;
  for (const type of wanted) {
    let placed = false;
    while (!placed && guard++ < wanted.length * 40) {
      const a = rng.range(0, Math.PI * 2);
      const d = Math.sqrt(rng()) * (radius - 2);
      const pos = new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d);
      if (pos.length() < clear) continue;
      if (nodes.some((n) => n.position.distanceTo(pos) < 3.0)) continue;
      const node = new ResourceNode(type, pos, rng, biome);
      nodes.push(node);
      node.addTo(scene);
      placed = true;
    }
  }
  return nodes;
}

/**
 * Non-harvestable scenery. This is what makes a location feel like a place
 * rather than a field with props on it — harvestable nodes stay rare so the
 * economy holds, while decor carries the density.
 */
function scatterDecor(scene, rng, counts, biome, radius, avoid, clear) {
  const batch = new InstanceBatch();
  const solids = [];
  // Scenery trees, recorded so the game can turn one into a real, choppable
  // tree when the player walks up to it. Drawn as instances until then.
  const trees = [];
  const taken = avoid.map((o) => ({ p: o.position, r: 2.6 }));

  const place = (type, count) => {
    for (let i = 0; i < count; i++) {
      let pos = null;
      for (let tries = 0; tries < 24 && !pos; tries++) {
        const a = rng.range(0, Math.PI * 2);
        const d = Math.sqrt(rng()) * (radius - 1);
        const c = new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d);
        if (c.length() < clear + 0.5) continue;             // keep the arrival clearing open
        if (taken.some((t) => t.p.distanceTo(c) < t.r)) continue;
        pos = c;
      }
      if (!pos) continue;

      let key = null;
      let height = 1;
      let radiusOut = 0;
      if (type === 'tree') {
        key = pickVariant(biome.trees ?? 'tree_forest', rng);
        height = rng.range(2.8, 5.2);
        radiusOut = 0.7;
      } else if (type === 'bush') {
        key = pickVariant('bush', rng);
        height = rng.range(0.5, 1.0);
        radiusOut = 0;                                       // walk straight through
      } else {
        key = rng.chance(0.5) ? pickVariant('rock', rng) : 'rock_small_a';
        height = rng.range(0.4, 1.5);
        radiusOut = height > 0.9 ? 0.7 : 0;
      }

      const pid = key && batch.add(key, height, pos, rng.range(0, Math.PI * 2));
      if (!pid) continue;

      taken.push({ p: pos, r: type === 'tree' ? 2.2 : 1.3 });
      const solid = radiusOut > 0
        ? { position: pos, radius: radiusOut, active: true, entity: null }
        : null;
      if (solid) solids.push(solid);
      if (type === 'tree') trees.push({ pid, position: pos, height, solid, node: null });
    }
  };

  place('tree', counts.tree ?? 0);
  place('rock', counts.rock ?? 0);
  place('bush', counts.bush ?? 0);

  scene.add(batch.build());
  return { solids, trees, batch };
}

/**
 * Ruins, placed as small holdings rather than scattered pieces.
 *
 * A lone broken wall in a field reads as set dressing. Three of them round a
 * rectangle, with rubble where the fourth would be and a cold fire beside it,
 * reads as somewhere a family lived — and that is the whole difference between a
 * prop and a story.
 *
 * Home has a handful too, but only out past the land the player can build on —
 * see dressHomeSurrounds() for why the middle is kept empty.
 */
function scatterRuins(scene, rng, count, radius, avoid, clear) {
  const batch = new InstanceBatch();
  const solids = [];
  const taken = avoid.map((o) => ({ p: o.position, r: 3.2 }));

  for (let i = 0; i < count; i++) {
    let at = null;
    // Reach right out to the treeline. Capped six metres short of it, the outer
    // ring of every map came out empty — and the outer ring is where the trees
    // are thickest, so the "keep clear of scenery" test rejected most of what
    // did get proposed out there. The band nobody could build in ended up being
    // exactly the band that most needed something in it.
    const inner = clear + 6;
    const outer = radius - 3;
    for (let tries = 0; tries < 40 && !at; tries++) {
      const a = rng.range(0, Math.PI * 2);
      // Uniform over the ring's area rather than its radius, so the wide outer
      // band gets its fair share instead of the same count as the narrow middle.
      const d = Math.sqrt(rng.range((inner / outer) ** 2, 1)) * outer;
      const c = new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d);
      if (taken.some((t) => t.p.distanceTo(c) < t.r + 3.5)) continue;
      at = c;
    }
    if (!at) continue;
    taken.push({ p: at, r: 7 });

    // A footprint, and which of its sides are still up.
    const w = rng.range(3.5, 5.5);
    const d2 = rng.range(3.0, 4.5);
    const yaw = rng.range(0, Math.PI * 2);
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const put = (lx, lz, key, size, rot) => {
      const p = new THREE.Vector3(at.x + lx * cos - lz * sin, 0, at.z + lx * sin + lz * cos);
      if (batch.add(key, size, p, yaw + rot)) {
        solids.push({ position: p, radius: 0.8, active: true, entity: null });
      }
    };

    // Walls along the long sides, in segments, most of them missing.
    const segs = Math.max(2, Math.round(w / 2));
    for (const side of [-1, 1]) {
      for (let sIdx = 0; sIdx < segs; sIdx++) {
        if (rng.chance(0.42)) continue;
        const lx = -w / 2 + (sIdx + 0.5) * (w / segs);
        put(lx, side * d2 / 2, pickVariant('ruin_wall', rng), rng.range(1.6, 2.3), 0);
      }
    }
    // One end wall, sometimes.
    if (rng.chance(0.55)) {
      put(-w / 2, 0, pickVariant('ruin_wall', rng), rng.range(1.5, 2.2), Math.PI / 2);
    }
    // The frame of whatever stood at the other end.
    if (rng.chance(0.6)) put(w / 2 - 0.6, 0, pickVariant('ruin_frame', rng), rng.range(2.0, 2.8), 0);

    // Rubble inside and out, and the fire someone sat at.
    for (let k = 0; k < rng.int(2, 4); k++) {
      const lx = rng.range(-w / 2, w / 2);
      const lz = rng.range(-d2, d2);
      const p = new THREE.Vector3(at.x + lx * cos - lz * sin, 0, at.z + lx * sin + lz * cos);
      batch.add(pickVariant('rubble', rng), rng.range(0.35, 0.6), p, rng.range(0, Math.PI * 2), 'span');
    }
    if (rng.chance(0.5)) {
      const a2 = rng.range(0, Math.PI * 2);
      const r2 = rng.range(3.5, 6);
      batch.add('dead_fire_a', 0.28,
        new THREE.Vector3(at.x + Math.cos(a2) * r2, 0, at.z + Math.sin(a2) * r2),
        rng.range(0, Math.PI * 2));
    }
  }

  scene.add(batch.build());
  return solids;
}

function spawnZombies(scene, rng, mix, radius) {
  const list = [];
  if (PEACEFUL) return list;
  for (const [type, n] of Object.entries(mix)) {
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(16, radius - 4);
      const z = new Zombie(type, new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d), rng);
      list.push(z);
      scene.add(z.mesh);
    }
  }
  return list;
}

/**
 * Gradient sky dome. A flat background colour is the single biggest thing that
 * makes a scene read as a tech demo — a horizon-to-zenith gradient that the fog
 * blends into costs one draw call and does most of the work.
 */
/**
 * The camp's surroundings: somewhere people lived, and then stopped.
 *
 * Everything here sits in the ring *outside* the buildable land. That is the
 * whole design constraint — the middle has to stay legible and empty because a
 * player will eventually put a large base on it, and dressing that has to be
 * demolished before you can build is dressing that makes the game worse. So the
 * story is told at the treeline and the ground in between is left alone.
 *
 * Placement is by rejection against what is already there rather than on a
 * pattern, so nothing lines up and no two camps read the same. Everything is
 * built from models the game already generates; swapping in authored assets
 * later is a change to the key names in PROPS and nothing else.
 */
function dressHomeSurrounds(scene, rng, radius, inner, avoid) {
  const batch = new InstanceBatch();
  const solids = [];
  // Clearance around things already in the world. A tree trunk is about this
  // wide; using a larger figure here was what stopped the ruins ever finding
  // room — every candidate spot fell inside somebody's exclusion disc and the
  // whole pass quietly placed nothing.
  const taken = avoid.map((o) => ({ p: o.position, r: 1.6 }));

  // The land is a square grid, so the keep-off test has to be square too. A
  // circle of the same reach leaves the corners of the grid outside it, and
  // dressing was landing on buildable ground there — the one place it must never
  // be. `inner` stays the radial start of the ring; this is the hard edge.
  const offLand = (p) => Math.abs(p.x) > inner || Math.abs(p.z) > inner;

  const findSpot = (clearance, lo = inner, hi = radius - 3) => {
    for (let tries = 0; tries < 60; tries++) {
      const a = rng.range(0, Math.PI * 2);
      // Uniform over area rather than radius, so the wide outer band gets its
      // share instead of the same count as the narrow inner one.
      const d = Math.sqrt(rng.range((lo / hi) ** 2, 1)) * hi;
      const p = new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d);
      if (!offLand(p)) continue;
      if (taken.some((t) => t.p.distanceTo(p) < t.r + clearance)) continue;
      return p;
    }
    return null;
  };

  // ---- vehicles ----------------------------------------------------------
  // Placed as three readings of the same idea, because a field of evenly spaced
  // cars is a car park and nothing else:
  //
  //   a lay-by    two or three nose to tail on a shared heading, as if the road
  //               ran through and they stopped where they ran out
  //   a yard      a loose cluster facing every which way, the way a verge fills
  //               up when people abandon vehicles rather than park them
  //   a stray     one on its own, slewed round
  //
  // Collision is a single circle from the variant's config, not the body shape:
  // the player only needs keeping out of it. Decoration, collider and the loot
  // flag stay separate all the way through — a scenery-only vehicle is still
  // solid, and may still be worth opening later.
  const DEBRIS = ['debris_tire', 'debris_door', 'debris_plate', 'debris_plate_b',
                  'debris_bumper', 'debris_drive', 'debris_window'];

  /** One vehicle, its collider and the mess around it. */
  const dropVehicle = (p, yaw) => {
    if (!offLand(p) || p.length() > radius - 3) return false;
    const key = pickVariant('wreck', rng);
    if (!key) return false;
    const variant = resolveVariant(key);
    // Placed at the length its body class says it is, not at the model's own
    // span — the kit is authored at roughly half scale, so using the raw span
    // puts a saloon on the ground at two and a half metres. Vehicle size is the
    // one proportion every player can judge on sight, and getting it wrong reads
    // as a toy however good the surface is.
    const metres = (variant?.body.length ?? 4.5) * rng.range(0.98, 1.03);
    if (!batch.add(key, metres, p, yaw, 'span')) return false;

    const r = variant?.collider.radius ?? 1.4;
    taken.push({ p, r: r + 1.6 });
    solids.push({
      position: p, radius: r, active: true, entity: null,
      // Carried for later: a searchable vehicle is a container the loot system
      // could adopt without any of this needing to change.
      vehicle: { variant: key, loot: variant?.loot ?? 'none' },
    });

    // What came off it, and what has grown up around it since.
    for (let d = 0; d < 1 + ((rng() * 3) | 0); d++) {
      const off = new THREE.Vector3(rng.range(-3, 3), 0, rng.range(-3, 3));
      batch.add(DEBRIS[(rng() * DEBRIS.length) | 0], rng.range(0.4, 0.85),
        p.clone().add(off), rng.range(0, Math.PI * 2), 'span');
    }
    // Weeds at the wheels. No collider — walking routes stay clear.
    for (let w = 0; w < 2 + ((rng() * 3) | 0); w++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(1.0, 2.4);
      batch.add(pickVariant('bush', rng), rng.range(0.35, 0.7),
        p.clone().add(new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d)),
        rng.range(0, Math.PI * 2));
    }
    return true;
  };

  // A lay-by: a shared heading, stopped where the road would have been.
  for (let i = 0; i < 2; i++) {
    const at = findSpot(4);
    if (!at) continue;
    const road = rng.range(0, Math.PI * 2);
    const step = new THREE.Vector3(Math.cos(road), 0, Math.sin(road));
    for (let n = 0; n < 2 + ((rng() * 2) | 0); n++) {
      const p = at.clone().addScaledVector(step, n * rng.range(6, 7.5))
        .add(new THREE.Vector3(rng.range(-1, 1), 0, rng.range(-1, 1)));
      dropVehicle(p, road + rng.range(-0.3, 0.3) + (rng.chance(0.2) ? Math.PI : 0));
    }
    // A cone or two left behind says somebody was working here before it stopped
    // being a road at all.
    if (rng.chance(0.5)) {
      batch.add(rng.chance(0.5) ? 'road_cone' : 'road_cone_flat', rng.range(0.5, 0.7),
        at.clone().add(new THREE.Vector3(rng.range(-3, 3), 0, rng.range(-3, 3))),
        rng.range(0, Math.PI * 2), 'span');
    }
  }

  // A yard: a knot of them at every angle.
  if (rng.chance(0.8)) {
    const at = findSpot(5);
    if (at) {
      for (let n = 0; n < 2 + ((rng() * 3) | 0); n++) {
        const a = rng.range(0, Math.PI * 2);
        const d = rng.range(2.5, 6);
        dropVehicle(at.clone().add(new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d)),
          rng.range(0, Math.PI * 2));
      }
    }
  }

  // Strays, out on their own.
  for (let i = 0; i < 2; i++) {
    const p = findSpot(3.5);
    if (p) dropVehicle(p, rng.range(0, Math.PI * 2));
  }

  // ---- ruined buildings --------------------------------------------------
  // Proper footprints: wall segments laid end to end along the sides of a
  // rectangle, most of them missing. The spacing is the segment's own width, so
  // the pieces that remain line up as a wall — scattering them at random offsets
  // instead piles them into each other and the whole thing reads as a woodpile
  // rather than as a house somebody lived in.
  const SEG = 2.2;                         // a wall segment, laid at its own width

  for (let i = 0; i < 5; i++) {
    const at = findSpot(4.5);
    if (!at) continue;
    // Whole numbers of segments, so the corners meet.
    const wSegs = 2 + ((rng() * 2) | 0);
    const dSegs = 2 + ((rng() * 2) | 0);
    const w = wSegs * SEG;
    const d = dSegs * SEG;
    const yaw = rng.range(0, Math.PI * 2);
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    taken.push({ p: at, r: Math.max(w, d) * 0.7 + 2.5 });

    const local = (lx, lz) =>
      new THREE.Vector3(at.x + lx * cos - lz * sin, 0, at.z + lx * sin + lz * cos);

    const put = (lx, lz, key, size, rot, solid) => {
      const p = local(lx, lz);
      if (!offLand(p)) return;
      if (batch.add(key, size, p, yaw + rot, 'span') && solid) {
        solids.push({ position: p, radius: solid, active: true, entity: null });
      }
    };

    // Each side is either mostly standing or mostly gone, decided per side — a
    // building with every wall half-there looks eaten rather than ruined.
    const sides = [
      { std: rng.chance(0.6), n: wSegs, along: 'x', at: -d / 2, rot: 0 },
      { std: rng.chance(0.5), n: wSegs, along: 'x', at: d / 2, rot: 0 },
      { std: rng.chance(0.55), n: dSegs, along: 'z', at: -w / 2, rot: Math.PI / 2 },
      { std: rng.chance(0.35), n: dSegs, along: 'z', at: w / 2, rot: Math.PI / 2 },
    ];
    for (const side of sides) {
      const span = side.n * SEG;
      for (let n = 0; n < side.n; n++) {
        if (rng.chance(side.std ? 0.2 : 0.75)) continue;
        const t = -span / 2 + (n + 0.5) * SEG;
        const [lx, lz] = side.along === 'x' ? [t, side.at] : [side.at, t];
        put(lx, lz, pickVariant('ruin_wall', rng), SEG, side.rot, 0.8);
      }
    }

    // A doorframe left standing in one of the gable ends.
    if (rng.chance(0.55)) {
      const endX = rng.chance(0.5) ? -w / 2 : w / 2;
      put(endX, 0, pickVariant('ruin_frame', rng), SEG * 1.1, Math.PI / 2, 0.5);
    }

    // Rubble spilling outward from the sides that went, clear of the walls that
    // did not — collapsed masonry lies outside the line it fell from.
    for (let n = 0; n < 4 + ((rng() * 4) | 0); n++) {
      const edge = rng() * 4 | 0;
      const out = rng.range(0.8, 2.6);
      const t = rng.range(-0.45, 0.45);
      const [lx, lz] = edge === 0 ? [w * t, -d / 2 - out]
        : edge === 1 ? [w * t, d / 2 + out]
        : edge === 2 ? [-w / 2 - out, d * t]
        : [w / 2 + out, d * t];
      put(lx, lz, pickVariant('rubble', rng), rng.range(0.6, 1.2), rng.range(0, Math.PI * 2), 0.45);
    }

    // Somebody camped in the shell of it afterwards.
    if (rng.chance(0.5)) put(rng.range(-w, w) * 0.25, rng.range(-d, d) * 0.25,
      'dead_fire_a', rng.range(0.8, 1.1), 0, 0);
  }

  // ---- what is left of the fences ---------------------------------------
  // Short runs only, and always beside something — a fence in open grass is
  // noise, a fence along the side of a ruin is a boundary nobody kept up.
  const PANEL = 1.8;
  for (let i = 0; i < 3; i++) {
    const start = findSpot(3);
    if (!start) continue;
    const yaw = rng.range(0, Math.PI * 2);
    const step = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw)).multiplyScalar(PANEL);
    const len = 3 + ((rng() * 4) | 0);
    for (let n = 0; n < len; n++) {
      taken.push({ p: start.clone().addScaledVector(step, n), r: 1.4 });
    }
    for (let n = 0; n < len; n++) {
      if (rng.chance(0.35)) continue;
      const p = start.clone().addScaledVector(step, n);
      if (!offLand(p) || p.length() > radius - 2) continue;
      const lean = rng.chance(0.3) ? rng.range(-0.3, 0.3) : 0;
      if (batch.add(rng.chance(0.5) ? 'fence_a' : 'fence_b', PANEL, p, yaw + Math.PI / 2 + lean)) {
        solids.push({ position: p, radius: 0.28, active: true, entity: null });
      }
    }
  }

  scene.add(batch.build());
  return solids;
}

/**
 * A soft-edged smudge, as a texture.
 *
 * The first version of this stacked translucent discs, and it looked exactly
 * like what it was: circles on the grass. A circle with a hard edge reads as a
 * decal however dark it is, and several overlapping read as several decals.
 *
 * One texture with a radial falloff and noise eaten out of it has no edge to
 * see, so a single quad carries the whole mark. Built once and shared.
 */
let smudgeTex = null;
function smudgeTexture() {
  if (smudgeTex) return smudgeTex;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const px = img.data;

  const hash = (x, y) => {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const value = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const mix = (a, b, t) => a + (b - a) * t;
    return mix(mix(hash(xi, yi), hash(xi + 1, yi), u),
               mix(hash(xi, yi + 1), hash(xi + 1, yi + 1), u), v);
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x / size - 0.5) * 2;
      const dy = (y / size - 0.5) * 2;
      const d = Math.hypot(dx, dy);
      // Smooth falloff to nothing at the rim, so there is no edge at all.
      let a = Math.max(0, 1 - d);
      a *= a;
      // Noise at two scales breaks the circle into something ragged.
      a *= 0.45 + value(x / 14, y / 14) * 0.75;
      a *= 0.6 + value(x / 5, y / 5) * 0.6;
      const i = (y * size + x) * 4;
      px[i] = px[i + 1] = px[i + 2] = 255;
      px[i + 3] = Math.max(0, Math.min(255, a * 255));
    }
  }
  ctx.putImageData(img, 0, 0);
  smudgeTex = new THREE.CanvasTexture(canvas);
  smudgeTex.needsUpdate = true;
  return smudgeTex;
}

/**
 * Burn scars and a worn track.
 *
 * Flat, collider-free and no height at all, which is why these are the one part
 * of the dressing allowed on buildable ground: they cannot block a foundation or
 * hide a socket. Bare grass with nothing on it reads as a lawn rather than as
 * somewhere that has been lived in and left.
 */
function groundMarks(rng, radius, keepOff = 0) {
  const g = new THREE.Group();
  const tex = smudgeTexture();
  const mark = (color, opacity) => new THREE.MeshBasicMaterial({
    color, map: tex, transparent: true, opacity, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });

  // Burn scars, kept off the middle: a scorched patch under the base would read
  // as damage to the base rather than as history.
  for (let i = 0; i < 8; i++) {
    let x = 0, z = 0;
    for (let tries = 0; tries < 20; tries++) {
      const a = rng.range(0, Math.PI * 2);
      const d = Math.sqrt(rng.range(0.15, 1)) * (radius - 5);
      x = Math.cos(a) * d; z = Math.sin(a) * d;
      if (Math.abs(x) > keepOff || Math.abs(z) > keepOff) break;
    }
    if (Math.abs(x) <= keepOff && Math.abs(z) <= keepOff) continue;
    const r = rng.range(2.4, 5.5);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(r, r * rng.range(0.7, 1.3)),
      mark(0x2b2620, rng.range(0.3, 0.5)));
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = rng.range(0, Math.PI * 2);
    m.position.set(x, 0.012, z);
    g.add(m);
  }

  // A track worn across the camp and out past the treeline, wandering rather
  // than straight — nobody walks a survey line. This one may cross the middle:
  // a path through where people lived is the point of it.
  const heading = rng.range(0, Math.PI * 2);
  let x = Math.cos(heading) * -(radius - 6);
  let z = Math.sin(heading) * -(radius - 6);
  let dir = heading;
  for (let i = 0; i < 60; i++) {
    dir += rng.range(-0.14, 0.14);
    x += Math.cos(dir) * 1.1;
    z += Math.sin(dir) * 1.1;
    if (Math.hypot(x, z) > radius - 2) break;
    const w = rng.range(1.6, 2.4);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w),
      mark(0x6a5c46, rng.range(0.16, 0.26)));
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = rng.range(0, Math.PI * 2);
    m.position.set(x, 0.011, z);
    g.add(m);
  }
  return g;
}

function buildSky(biome) {
  const top = new THREE.Color(biome.skyTop ?? biome.sky).clone();
  const horizon = new THREE.Color(biome.skyHorizon ?? biome.fog).clone();

  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: top },
      horizonColor: { value: horizon },
      offset: { value: 12 },
      exponent: { value: 0.72 },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPosition = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform float offset;
      uniform float exponent;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
        float t = pow(max(h, 0.0), exponent);
        gl_FragColor = vec4(mix(horizonColor, topColor, t), 1.0);
      }`,
  });

  // Inside the camera's far plane, or it is clipped away and the sky renders as
  // the cleared background — which is black. The overhead camera hides that,
  // because looking down there is barely any sky on screen; at eye level it is
  // half the picture. frustumCulled is off so the dome is never dropped as a
  // whole, but that does nothing about per-fragment far clipping.
  const sky = new THREE.Mesh(new THREE.SphereGeometry(280, 24, 14), mat);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  return sky;
}

export function buildLocation(def, rng) {
  const biome = def.biome;
  const radius = def.radius;

  const scene = new THREE.Scene();
  scene.add(buildSky(biome));
  // Exponential fog reads far more naturally than a linear band, and matching
  // it to the horizon tint makes the treeline dissolve into the sky.
  scene.fog = new THREE.FogExp2(biome.skyHorizon ?? biome.fog, 0.0135);

  // Cool skylight against a warm sun is what gives outdoor scenes their depth.
  scene.add(new THREE.HemisphereLight(0xa8c4e0, biome.ground, 1.45));
  const fill = new THREE.DirectionalLight(0x9fb8d8, 0.35);
  fill.position.set(-20, 14, -16);
  scene.add(fill);

  // Light coming up off the ground.
  //
  // Nothing needed this while the only camera looked down: you never saw the
  // underside of anything. At eye level you see them constantly — the soffit of
  // a roof, the inside of a canopy — and with a sun overhead and no bounce at
  // all they render flat black. Leaves are the worst of it, because their
  // material is double-sided and three flips the shading normal downwards on the
  // far face, pointing it away from every light in the scene.
  //
  // Weak and warm, aimed straight up. It is the cheapest stand-in for radiosity
  // there is, and it costs one more light rather than a second render pass.
  const bounce = new THREE.DirectionalLight(0xbcae8e, 0.55);
  bounce.position.set(0, -10, 0);
  scene.add(bounce);

  const sun = new THREE.DirectionalLight(0xffeccc, 2.9);
  sun.position.set(26, 40, 18);
  sun.castShadow = true;
  // A tight frustum around the player beats a huge one: same texel budget over a
  // much smaller area, so contact shadows stay crisp instead of blocky.
  sun.shadow.mapSize.set(shadowRes(), shadowRes());
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 110;
  Object.assign(sun.shadow.camera, {
    left: -shadowExtent(), right: shadowExtent(),
    top: shadowExtent(), bottom: -shadowExtent(),
  });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.00015;
  sun.shadow.normalBias = 0.022;
  scene.add(sun, sun.target);

  // Home is generated with an apron of clear ground to start building on;
  // everywhere else just keeps the arrival spot clear.
  const plotHalf = def.id === 'home' ? CAMP_CLEAR_HALF : 0;
  const clear = plotHalf > 0 ? Math.hypot(plotHalf, plotHalf) + 1 : 5;
  // Where the camp's own dressing begins: two metres past the furthest land the
  // player can buy, so a wreck or a ruin never lands in the middle of the base.
  // Trees, rocks and bushes are a different matter and keep their old spread — a
  // camp with a wood to fell at the edge of it is the point of the map, and
  // expanding onto ground with a tree on it means felling the tree.
  const landReach = LAND_HALF_CELLS * CELL + 2;

  scene.add(buildTerrain(rng, biome, radius, plotHalf));

  const nodes = scatterNodes(scene, rng, def.nodes ?? {}, biome, radius, clear);
  const containers = def.containers
    ? scatterContainers(scene, rng, def.containers, def.loot, radius - 3, nodes)
    : [];
  const scenery = scatterDecor(scene, rng, def.decor ?? {}, biome, radius, [...nodes, ...containers], clear);
  const decor = scenery.solids;
  if (def.ruins) decor.push(...scatterRuins(scene, rng, def.ruins, radius, [...nodes, ...containers], clear));

  // Home gets its own dressing pass, laid strictly outside the buildable land.
  if (def.id === 'home') {
    decor.push(...dressHomeSurrounds(scene, rng, radius, landReach, [...nodes, ...containers]));
    scene.add(groundMarks(rng, radius, landReach));
  }
  const pickups = scatterPickups(scene, rng, def.pickups, radius, clear, [...nodes, ...containers]);
  const zombies = spawnZombies(scene, rng, def.zombies ?? {}, radius);

  // Short grass over the whole map — including the build plot. What clears it is
  // construction, wired up by the caller once the base exists.
  const grass = new GrassField(scene, rng, radius, {
    color: new THREE.Color(biome.ground).offsetHSL(0.01, 0.10, 0.06).getHex(),
  });

  return {
    scene, sun, nodes, containers, zombies, decor, pickups, grass, radius,
    // Scenery trees the player can promote to real ones by walking up to them.
    scenery,
  };
}
